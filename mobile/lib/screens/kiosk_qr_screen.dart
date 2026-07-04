import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:qr_flutter/qr_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import '../api_config.dart';
import '../kiosk_prefs.dart';
import '../services/kiosk_socket_service.dart';
import 'kiosk_login_screen.dart';

/// Ekran kiosku: pokazuje stałą literę kolejki lokalizacji (np. "A", tylko
/// informacyjnie — do niczego już nie służy) oraz KOD ZAPISU: krótkotrwały,
/// 4-cyfrowy kod odświeżany co 30s, który jest jedynym sposobem dołączenia do
/// kolejki. Klient wpisuje ten kod ręcznie w swojej aplikacji albo skanuje
/// wyświetlony obok kod QR, który koduje ten sam, aktualny kod zapisu.
/// Świadome ograniczenie bezpieczeństwa: stała litera dałaby się łatwo
/// zapamiętać/przekazać dalej bez faktycznej obecności w kolejce.
///
/// Stan aktualizuje się w czasie rzeczywistym przez WebSocket:
///   - `device.updated` / `device.deleted` — tablet dostał (lub stracił)
///     przypisaną lokalizację w panelu administratora,
///   - `ticket.updated` — operator wezwał/zakończył/anulował bilet,
///   - `location.updated` — operator wstrzymał/wznowił zapisy.
/// Endpoint REST `/kiosk/status` służy tylko do wczytania stanu początkowego
/// i jako rzadki fallback resync (na wypadek zerwania WS). Kod zapisu ma
/// osobny, szybki cykl odświeżania — patrz `_pobierzKodZapisu`.
class KioskQrScreen extends StatefulWidget {
  final String adminToken;

  const KioskQrScreen({super.key, required this.adminToken});

  @override
  State<KioskQrScreen> createState() => _KioskQrScreenState();
}

class _KioskQrScreenState extends State<KioskQrScreen> {
  static const _fallbackResyncInterval = Duration(seconds: 45);

  int? _tabletId;
  int? _locationId;
  String? _locationName;
  String? _queueCode;
  // Rotujący kod zapisu (30s) — jedyny sposób dołączenia do kolejki.
  String? _signupCode;
  Timer? _signupCodeTimer;
  String? _currentTicketCode;
  bool _hasLocation = false;
  // false = admin wyłączył ten tablet — pokazujemy komunikat, ale NIE
  // zapominamy tokenu, żeby po ponownym włączeniu wróciło samo.
  bool _kioskEnabled = true;
  // false = operator wstrzymał NOWE zapisy (zakładka "Kolejka na żywo") —
  // INNE niż _kioskEnabled: obsługa już czekających trwa dalej, więc sekcja
  // "aktualnie obsługiwany" zostaje widoczna, zmienia się tylko zaproszenie do dołączenia.
  bool _acceptingNewTickets = true;

  KioskSocketService? _socketService;
  Timer? _timerOdswiezania;
  bool _isLoading = true;
  String? _errorMessage;
  // Identyfikator TEGO fizycznego urządzenia — wysyłany razem z pairing_token,
  // żeby backend mógł wymusić "jeden token = jeden tablet" (patrz kiosk_prefs.dart).
  String? _deviceId;

  @override
  void initState() {
    super.initState();
    // Blokujemy wygaszanie ekranu, żeby tablet przy wejściu nie zgasł
    WakelockPlus.enable();
    _inicjalizuj();
  }

  Future<void> _inicjalizuj() async {
    _deviceId = await getOrCreateDeviceId();
    if (!mounted) return;
    _pobierzStatusKiosku();
    _polaczWebSocket();
  }

  void _polaczWebSocket() {
    final wsUrl = '${ApiConfig.wsUrl}/api/v1/ws?tablet_token=${widget.adminToken}&device_id=$_deviceId';
    _socketService = KioskSocketService(
      wsUrl: wsUrl,
      onEvent: _obsluzZdarzenieWs,
      // Po zerwaniu i przywróceniu połączenia mogliśmy przegapić eventy —
      // dociągamy pełny stan jednorazowo, tak jak robi to panel webowy.
      onReconnect: _pobierzStatusKiosku,
    )..connect();
  }

  void _obsluzZdarzenieWs(Map<String, dynamic> data) {
    final type = data['type'];

    if (type == 'device.updated' || type == 'device.deleted') {
      // Tablet dostał/stracił przypisaną lokalizację albo zmieniono jego
      // dane — najprościej i najpewniej dociągnąć pełny stan z REST.
      _pobierzStatusKiosku();
      return;
    }

    if (type == 'ticket.updated') {
      final ticket = data['ticket'] as Map<String, dynamic>?;
      if (ticket == null || !mounted) return;
      final status = ticket['status'];
      final code = ticket['ticket_code'];
      setState(() {
        if (status == 'SERVING') {
          _currentTicketCode = code;
        } else if ((status == 'COMPLETED' || status == 'CANCELLED') && code == _currentTicketCode) {
          _currentTicketCode = null;
        }
      });
      return;
    }

    if (type == 'location.updated') {
      // Operator wstrzymał/wznowił zapisy (albo zmieniono nazwę lokalizacji)
      // — bez potrzeby pełnego REST refetchu, payload ma już cały obiekt.
      final location = data['location'] as Map<String, dynamic>?;
      if (location == null || !mounted || location['id'] != _locationId) return;
      setState(() {
        _locationName = location['name'];
        _queueCode = location['queue_code'];
        _acceptingNewTickets = location['accepting_new_tickets'] ?? true;
      });
      _synchronizujKodZapisu();
    }
  }

  Future<void> _pobierzStatusKiosku() async {
    final finalUrl = Uri.parse('${ApiConfig.kioskStatusUrl}?tablet_token=${widget.adminToken}&device_id=$_deviceId');

    try {
      final response = await http.get(
        finalUrl,
        headers: {'Content-Type': 'application/json'},
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (!mounted) return;

        setState(() {
          _tabletId = data['tablet_id'];
          _kioskEnabled = data['is_active'] ?? true;
          _locationId = data['location_id'];
          _hasLocation = data['location_id'] != null;
          _locationName = data['location_name'];
          _queueCode = data['queue_code'];
          _acceptingNewTickets = data['accepting_new_tickets'] ?? true;
          _currentTicketCode = data['current_ticket_code'];
          _isLoading = false;
          _errorMessage = null;
        });

        // Dopasuj subskrypcję gniazda do aktualnie znanej lokalizacji —
        // kluczowe, gdy tablet dostał lokalizację PO nawiązaniu połączenia WS
        // (inaczej `ticket.updated` nigdy by do niego nie dotarło).
        if (_tabletId != null) {
          _socketService?.resubscribe([
            'tablet:$_tabletId',
            if (_locationId != null) 'location:$_locationId',
          ]);
        }

        _timerOdswiezania?.cancel();
        _timerOdswiezania = Timer(_fallbackResyncInterval, _pobierzStatusKiosku);
        _synchronizujKodZapisu();
      } else if (response.statusCode == 401 || response.statusCode == 403) {
        // Token nieznany serwerowi (zresetowany albo tablet usunięty) — to
        // JEDYNY przypadek, w którym zapominamy zapisany token. Samo
        // wyłączenie tabletu (is_active=false) zwraca 200, nie 401 — patrz
        // _budujZawartosc.
        await _wrocDoLogowania(
          'Token urządzenia jest nieprawidłowy. Wprowadź token ponownie.',
        );
        return;
      } else if (response.statusCode == 409) {
        // Token jest znany, ale przypisany do INNEGO urządzenia (reguła
        // "jeden token = jeden tablet") — to urządzenie nie może go używać,
        // dopóki admin nie zresetuje parowania i nie wygeneruje nowego tokenu.
        await _wrocDoLogowania(
          'Ten token jest już używany przez inne urządzenie. Poproś administratora o nowy token parowania.',
        );
        return;
      } else {
        _ustawBlad('Błąd autoryzacji lub serwera (Kod: ${response.statusCode})');
      }
    } catch (e) {
      _ustawBlad('Brak połączenia z siecią');
    }
  }

  /// Zamyka tryb kiosku i wraca do ekranu ręcznego parowania z komunikatem.
  /// Zapomina TYLKO zapisany pairing_token — `device_id` zostaje (identyfikuje
  /// to samo fizyczne urządzenie na potrzeby przyszłego, poprawnego tokenu).
  Future<void> _wrocDoLogowania(String komunikat) async {
    _timerOdswiezania?.cancel();
    _signupCodeTimer?.cancel();
    _socketService?.disconnect();
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(kKioskPairingTokenKey);
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (context) => KioskLoginScreen(initialError: komunikat)),
    );
  }

  void _ustawBlad(String wiadomosc) {
    if (!mounted) return;
    setState(() {
      _errorMessage = wiadomosc;
      _isLoading = false;
    });
    _timerOdswiezania?.cancel();
    _timerOdswiezania = Timer(const Duration(seconds: 5), _pobierzStatusKiosku);
  }

  /// Uruchamia albo zatrzymuje cykl odświeżania kodu zapisu, w zależności od
  /// tego, czy kiosk aktualnie POWINIEN go pokazywać (ma lokalizację, jest
  /// włączony i zapisy nie są wstrzymane). Wołać po każdej zmianie tych
  /// warunków — REST-owej albo z WS.
  bool _pobieranieKoduWToku = false;

  void _synchronizujKodZapisu() {
    final powinienDzialac = _hasLocation && _kioskEnabled && _acceptingNewTickets;
    if (powinienDzialac) {
      if (_signupCodeTimer == null && !_pobieranieKoduWToku) _pobierzKodZapisu();
    } else {
      _signupCodeTimer?.cancel();
      _signupCodeTimer = null;
      if (_signupCode != null && mounted) setState(() => _signupCode = null);
    }
  }

  Future<void> _pobierzKodZapisu() async {
    final url = Uri.parse('${ApiConfig.kioskSignupCodeUrl}?tablet_token=${widget.adminToken}&device_id=$_deviceId');
    // Znacznik "w toku" — zapobiega odpaleniu drugiego, równoległego cyklu
    // przez _synchronizujKodZapisu, zanim ta odpowiedź zdąży wrócić.
    _pobieranieKoduWToku = true;
    try {
      final response = await http.get(url).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (mounted) setState(() => _signupCode = data['signup_code']);

        final int waznoscS = data['expires_in_seconds'] ?? 30;
        final int czasDoOdswiezania = (waznoscS > 3) ? waznoscS - 3 : waznoscS;
        _signupCodeTimer?.cancel();
        _signupCodeTimer = Timer(Duration(seconds: czasDoOdswiezania), _pobierzKodZapisu);
        return;
      }

      // Błąd (401/409) — warunki mogły się właśnie zmienić (np. operator
      // wstrzymał zapisy). Spróbuj ponownie tylko jeśli wciąż powinniśmy
      // pokazywać kod; w przeciwnym razie _synchronizujKodZapisu i tak
      // zatrzyma ten cykl przy najbliższej zmianie stanu.
      _signupCodeTimer = (_hasLocation && _kioskEnabled && _acceptingNewTickets)
          ? Timer(const Duration(seconds: 5), _pobierzKodZapisu)
          : null;
    } catch (_) {
      // Brak połączenia — spróbuj ponownie za chwilę.
      _signupCodeTimer = Timer(const Duration(seconds: 5), _pobierzKodZapisu);
    } finally {
      _pobieranieKoduWToku = false;
    }
  }

  @override
  void dispose() {
    _timerOdswiezania?.cancel();
    _signupCodeTimer?.cancel();
    _socketService?.disconnect();
    // Pozwalamy ekranowi zgasnąć po wyjściu z trybu kiosku
    WakelockPlus.disable();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF0F2F5),
      body: Center(
        child: _budujZawartosc(),
      ),
    );
  }

  Widget _budujZawartosc() {
    if (_isLoading && _queueCode == null) {
      return const CircularProgressIndicator();
    }

    if (_errorMessage != null && _queueCode == null) {
      return Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.wifi_off, size: 64, color: Colors.redAccent),
          const SizedBox(height: 16),
          Text(_errorMessage!, style: const TextStyle(color: Colors.redAccent)),
        ],
      );
    }

    if (!_kioskEnabled) {
      return Card(
        elevation: 8,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        child: Padding(
          padding: const EdgeInsets.all(48.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.pause_circle_outline, size: 72, color: Colors.black45),
              const SizedBox(height: 24),
              const Text(
                'Kolejka została wyłączona',
                style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              const Text(
                'Ten kiosk został wyłączony przez administratora. Włączy się z powrotem automatycznie, bez potrzeby ponownego parowania.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 15, color: Colors.black54),
              ),
            ],
          ),
        ),
      );
    }

    if (!_hasLocation) {
      return Card(
        elevation: 8,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        child: Padding(
          padding: const EdgeInsets.all(48.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const CircularProgressIndicator(),
              const SizedBox(height: 24),
              const Text(
                'Oczekiwanie na przypisanie lokalizacji',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              const Text(
                'Przypisz ten tablet do lokalizacji w panelu administratora, w zakładce Tablety. Ekran przełączy się automatycznie.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 15, color: Colors.black54),
              ),
            ],
          ),
        ),
      );
    }

    return Card(
      elevation: 8,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      child: Padding(
        padding: const EdgeInsets.all(48.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              _locationName ?? '',
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600, color: Colors.black54),
            ),
            const SizedBox(height: 4),
            Text(
              'Kod kolejki: ${_queueCode ?? '?'}',
              style: const TextStyle(fontSize: 14, color: Colors.black38, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 24),
            if (_acceptingNewTickets) ...[
              const Text(
                'Kod zapisu',
                style: TextStyle(fontSize: 16, color: Colors.black54),
              ),
              const SizedBox(height: 8),
              Text(
                _signupCode ?? '····',
                style: const TextStyle(fontSize: 88, fontWeight: FontWeight.w900, color: Color(0xFF1877F2), letterSpacing: 4),
              ),
              const SizedBox(height: 16),
              const Text(
                'Wpisz ten kod w aplikacji eQue albo zeskanuj kod QR poniżej',
                style: TextStyle(fontSize: 16, color: Colors.black54),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 32),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: Colors.grey.shade300, width: 2),
                ),
                child: _signupCode != null
                    ? QrImageView(
                        data: _signupCode!,
                        version: QrVersions.auto,
                        size: 180.0,
                        backgroundColor: Colors.white,
                      )
                    : const SizedBox(
                        width: 180,
                        height: 180,
                        child: Center(child: CircularProgressIndicator()),
                      ),
              ),
            ] else
              // Zapisy wstrzymane: świadomie NIE pokazujemy litery kolejki ani
              // QR-a — nie chcemy, żeby ktoś mimo wszystko spróbował dołączyć.
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 24),
                decoration: BoxDecoration(
                  color: Colors.amber.shade50,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: Colors.amber.shade300, width: 2),
                ),
                child: Column(
                  children: [
                    Icon(Icons.pause_circle_outline, color: Colors.amber.shade800, size: 56),
                    const SizedBox(height: 16),
                    Text(
                      'ZAPISY WSTRZYMANE',
                      style: TextStyle(fontSize: 26, fontWeight: FontWeight.w900, color: Colors.amber.shade900),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Operator tymczasowo wstrzymał przyjmowanie nowych klientów do tej kolejki.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 15, color: Colors.amber.shade800),
                    ),
                  ],
                ),
              ),
            const Divider(height: 48, thickness: 1),
            const Text(
              'AKTUALNIE OBSŁUGIWANY',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.black54),
            ),
            const SizedBox(height: 8),
            Text(
              _currentTicketCode ?? '—',
              style: const TextStyle(fontSize: 40, fontWeight: FontWeight.w900, color: Colors.black87),
            ),
          ],
        ),
      ),
    );
  }
}
