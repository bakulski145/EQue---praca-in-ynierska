import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:qr_flutter/qr_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import '../api_config.dart';
import '../kiosk_prefs.dart';
import '../services/kiosk_socket_service.dart';
import '../theme/eque_theme.dart';
import '../widgets/eque_card.dart';
import '../widgets/eque_logo.dart';
import '../widgets/status_chip.dart';
import '../widgets/ticket_code.dart';
import 'kiosk_login_screen.dart';

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
  String? _signupCode;
  Timer? _signupCodeTimer;
  String? _currentTicketCode;
  bool _hasLocation = false;
  bool _kioskEnabled = true;
  bool _acceptingNewTickets = true;

  KioskSocketService? _socketService;
  Timer? _timerOdswiezania;
  bool _isLoading = true;
  String? _errorMessage;
  String? _deviceId;

  @override
  void initState() {
    super.initState();
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
      onReconnect: _pobierzStatusKiosku,
    )..connect();
  }

  void _obsluzZdarzenieWs(Map<String, dynamic> data) {
    final type = data['type'];

    if (type == 'device.updated' || type == 'device.deleted') {
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
        await _wrocDoLogowania(
          'Token urządzenia jest nieprawidłowy. Wprowadź token ponownie.',
        );
        return;
      } else if (response.statusCode == 409) {
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

      _signupCodeTimer = (_hasLocation && _kioskEnabled && _acceptingNewTickets)
          ? Timer(const Duration(seconds: 5), _pobierzKodZapisu)
          : null;
    } catch (_) {
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
    WakelockPlus.disable();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: _budujZawartosc(),
        ),
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
          const Icon(Icons.wifi_off, size: 64, color: EQueColors.queueSkipped),
          const SizedBox(height: 16),
          Text(_errorMessage!, style: GoogleFonts.manrope(color: EQueColors.queueSkipped, fontWeight: FontWeight.w600)),
        ],
      );
    }

    if (!_kioskEnabled) {
      return _KioskStatusCard(
        icon: Icons.pause_circle_outline,
        iconBg: EQueColors.surfaceSunken,
        iconColor: EQueColors.textFaint,
        title: 'Kolejka została wyłączona',
        body: 'Ten kiosk został wyłączony przez administratora. Włączy się z powrotem automatycznie, bez potrzeby ponownego parowania.',
      );
    }

    if (!_hasLocation) {
      return _KioskStatusCard(
        icon: Icons.hourglass_top,
        iconBg: EQueColors.brandSubtle,
        iconColor: EQueColors.brand,
        title: 'Oczekiwanie na przypisanie lokalizacji',
        body: 'Przypisz ten tablet do lokalizacji w panelu administratora, w zakładce Tablety. Ekran przełączy się automatycznie.',
      );
    }

    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 440),
      child: EQueCard(
        radius: EQueRadii.xl2,
        padding: const EdgeInsets.all(40.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const EQueBrand(markSize: 32, fontSize: 20),
            const SizedBox(height: 6),
            Text(
              _locationName ?? '',
              style: GoogleFonts.manrope(fontSize: 15, fontWeight: FontWeight.w600, color: EQueColors.textMuted),
            ),
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(color: EQueColors.surfaceSunken, borderRadius: BorderRadius.circular(EQueRadii.pill)),
              child: Text(
                'Kod kolejki: ${_queueCode ?? '?'}',
                style: GoogleFonts.manrope(fontSize: 12.5, color: EQueColors.textMuted, fontWeight: FontWeight.w700),
              ),
            ),
            const SizedBox(height: 28),
            if (_acceptingNewTickets) ...[
              Text(
                'KOD ZAPISU',
                style: GoogleFonts.manrope(fontSize: 12.5, fontWeight: FontWeight.w800, letterSpacing: 1.2, color: EQueColors.textFaint),
              ),
              const SizedBox(height: 8),
              TicketCode(
                _signupCode ?? '····',
                tone: TicketCodeTone.brand,
                fontSizeOverride: 72,
                letterSpacing: 6,
              ),
              const SizedBox(height: 16),
              Text(
                'Wpisz ten kod w aplikacji eQue albo zeskanuj kod QR poniżej',
                style: GoogleFonts.manrope(fontSize: 15, color: EQueColors.textMuted),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 28),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(EQueRadii.xl),
                  border: Border.all(color: EQueColors.borderSubtle),
                  boxShadow: EQueShadows.md,
                ),
                child: _signupCode != null
                    ? QrImageView(
                        data: _signupCode!,
                        version: QrVersions.auto,
                        size: 176.0,
                        backgroundColor: Colors.white,
                      )
                    : const SizedBox(
                        width: 176,
                        height: 176,
                        child: Center(child: CircularProgressIndicator()),
                      ),
              ),
            ] else
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 24),
                decoration: BoxDecoration(
                  color: EQueColors.queueWaitingBg,
                  borderRadius: BorderRadius.circular(EQueRadii.xl),
                  border: Border.all(color: EQueColors.queueWaitingBorder, width: 1.5),
                ),
                child: Column(
                  children: [
                    const Icon(Icons.pause_circle_outline, color: EQueColors.queueWaiting, size: 48),
                    const SizedBox(height: 14),
                    Text(
                      'ZAPISY WSTRZYMANE',
                      style: GoogleFonts.spaceGrotesk(fontSize: 22, fontWeight: FontWeight.w700, color: EQueColors.queueWaiting, letterSpacing: 0.5),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Operator tymczasowo wstrzymał przyjmowanie nowych klientów do tej kolejki.',
                      textAlign: TextAlign.center,
                      style: GoogleFonts.manrope(fontSize: 14.5, color: EQueColors.amber700),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 32),
            _NowServingPanel(ticketCode: _currentTicketCode),
          ],
        ),
      ),
    );
  }
}

class _NowServingPanel extends StatelessWidget {
  final String? ticketCode;
  const _NowServingPanel({required this.ticketCode});

  @override
  Widget build(BuildContext context) {
    if (ticketCode == null) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 22),
        decoration: BoxDecoration(color: EQueColors.surfaceSunken, borderRadius: BorderRadius.circular(EQueRadii.xl)),
        child: Column(
          children: [
            Text('AKTUALNIE OBSŁUGIWANY', style: GoogleFonts.manrope(fontSize: 11.5, fontWeight: FontWeight.w800, letterSpacing: 1, color: EQueColors.textFaint)),
            const SizedBox(height: 8),
            Text('—', style: GoogleFonts.spaceGrotesk(fontSize: 32, fontWeight: FontWeight.w700, color: EQueColors.textFaint)),
          ],
        ),
      );
    }
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 24),
      decoration: BoxDecoration(
        color: EQueColors.queueServingBg,
        borderRadius: BorderRadius.circular(EQueRadii.xl),
        border: Border.all(color: EQueColors.queueServingBorder, width: 2),
      ),
      child: Column(
        children: [
          const StatusChip(status: QueueStatus.serving),
          const SizedBox(height: 12),
          TicketCode(ticketCode!, tone: TicketCodeTone.serving, fontSizeOverride: 44),
        ],
      ),
    );
  }
}

class _KioskStatusCard extends StatelessWidget {
  final IconData icon;
  final Color iconBg;
  final Color iconColor;
  final String title;
  final String body;

  const _KioskStatusCard({
    required this.icon,
    required this.iconBg,
    required this.iconColor,
    required this.title,
    required this.body,
  });

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 420),
      child: EQueCard(
        radius: EQueRadii.xl2,
        padding: const EdgeInsets.all(40.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 72,
              height: 72,
              alignment: Alignment.center,
              decoration: BoxDecoration(color: iconBg, shape: BoxShape.circle),
              child: Icon(icon, size: 36, color: iconColor),
            ),
            const SizedBox(height: 24),
            Text(title, textAlign: TextAlign.center, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontSize: 21)),
            const SizedBox(height: 8),
            Text(body, textAlign: TextAlign.center, style: GoogleFonts.manrope(fontSize: 14.5, color: EQueColors.textMuted)),
          ],
        ),
      ),
    );
  }
}
