import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:http/http.dart' as http;
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../api_config.dart';
import '../main.dart';
import '../services/queue_socket_service.dart';

class QueueStatusScreen extends StatefulWidget {
  final String scannedToken;
  // true = scannedToken to już istniejący kod BILETU (powrót z ekranu głównego
  // po odświeżeniu apki) — wtedy NIE wołamy /queue/join drugi raz (to by
  // utworzyło duplikat biletu), tylko dociągamy stan istniejącego biletu.
  // false (domyślnie) = scannedToken to KOD ZAPISU (4 cyfry z ekranu kiosku) do dołączenia.
  final bool resumeExisting;

  const QueueStatusScreen({super.key, required this.scannedToken, this.resumeExisting = false});

  @override
  State<QueueStatusScreen> createState() => _QueueStatusScreenState();
}

class _QueueStatusScreenState extends State<QueueStatusScreen> {
  QueueSocketService? _socketService;

  String? _prawdziwyNumerBiletu;

  int _osobyPrzedNami = 0;
  int _poczatkoweOsoby = 0;
  int _szacowanyCzasMinuty = 0;
  // Prawdziwe "twoja kolej" następuje WYŁĄCZNIE po evencie YOUR_TURN, czyli
  // gdy operator w panelu webowym naciśnie "Wezwij" — samo osiągnięcie
  // pozycji 0 w kolejce (bycie następnym w kolejności) to NIE to samo.
  bool _czyWezwano = false;

  bool _isLoading = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    if (widget.resumeExisting) {
      _wznowIstniejacyBilet();
    } else {
      _dolaczDoKolejki();
    }
  }

  Future<void> _dolaczDoKolejki() async {
    final apiUrl = Uri.parse(ApiConfig.joinQueueUrl);

    try {
      final response = await http.post(
        apiUrl,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'signup_code': widget.scannedToken}),
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200 || response.statusCode == 201) {
        final Map<String, dynamic> data = jsonDecode(response.body);

        if (!mounted) return;
        setState(() {
          _prawdziwyNumerBiletu = data['ticket_code'];
          _osobyPrzedNami = data['queue_position'] ?? 0;
          _poczatkoweOsoby = data['queue_position'] ?? 0;
          _szacowanyCzasMinuty = data['estimated_wait_time_minutes'] ?? 0;
          _isLoading = false;
        });

        if (_prawdziwyNumerBiletu != null) {
          await _zapiszAktywnyBilet(_prawdziwyNumerBiletu!);
          await _poprosOUprawnienia();
          _podlaczWebSocket();
        }
      } else {
        if (!mounted) return;
        String detail = 'Błąd serwera (Kod: ${response.statusCode})';
        try {
          final body = jsonDecode(response.body);
          if (body is Map && body['detail'] is String) detail = body['detail'];
        } catch (_) {}
        setState(() {
          _errorMessage = detail;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = 'Brak połączenia z backendem eQue. Upewnij się, że serwer działa.';
        _isLoading = false;
      });
    }
  }

  /// Wznawia PODGLĄD istniejącego biletu (np. po odświeżeniu apki) — dociąga
  /// jego aktualny stan przez REST zamiast dołączać do kolejki po raz drugi.
  Future<void> _wznowIstniejacyBilet() async {
    _prawdziwyNumerBiletu = widget.scannedToken;
    final ok = await _odswiezStanBiletu(pokazBladPolaczenia: true);
    if (!ok || !mounted) return;

    setState(() => _isLoading = false);
    await _poprosOUprawnienia();
    _podlaczWebSocket();
  }

  Future<void> _poprosOUprawnienia() async {
    if (await Permission.notification.isDenied) {
      await Permission.notification.request();
    }
  }

  Future<void> _zapiszAktywnyBilet(String kod) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('aktywny_bilet', kod);
  }

  /// Publiczny, bezstanowy odczyt aktualnego stanu biletu (GET
  /// /queue/ticket/{code}) — jedyne autorytatywne źródło prawdy, wołane przy
  /// starcie ekranu ORAZ przy każdym (re)połączeniu WS. Bez tego jednorazowy
  /// event YOUR_TURN/QUEUE_UPDATE przegapiony w złym momencie (gniazdo padło
  /// tuż przed wezwaniem, albo dopiero się łączyło) zostawiałby pacjenta na
  /// zawsze z nieaktualnym stanem — WS nie ma pamięci ani powtórek.
  /// Zwraca false, jeśli bilet już nie istnieje / jest w stanie końcowym.
  Future<bool> _odswiezStanBiletu({bool pokazBladPolaczenia = false}) async {
    if (_prawdziwyNumerBiletu == null) return false;
    final url = Uri.parse('${ApiConfig.baseUrl}/api/v1/queue/ticket/$_prawdziwyNumerBiletu');

    try {
      final response = await http.get(url).timeout(const Duration(seconds: 10));

      if (response.statusCode == 404) {
        await _wyczyscZakonczonyBilet();
        return false;
      }
      if (response.statusCode != 200) {
        if (pokazBladPolaczenia && mounted) {
          setState(() {
            _errorMessage = 'Błąd serwera (Kod: ${response.statusCode})';
            _isLoading = false;
          });
        }
        return false;
      }

      final data = jsonDecode(response.body);
      final String status = data['status'] ?? 'WAITING';

      if (status == 'COMPLETED' || status == 'CANCELLED') {
        await _wyczyscZakonczonyBilet();
        return false;
      }

      if (!mounted) return true;
      setState(() {
        if (status == 'SERVING') {
          _czyWezwano = true;
          _osobyPrzedNami = 0;
          _szacowanyCzasMinuty = 0;
        } else {
          _osobyPrzedNami = data['queue_position'] ?? _osobyPrzedNami;
          _szacowanyCzasMinuty = data['estimated_wait_time_minutes'] ?? _szacowanyCzasMinuty;
          if (_poczatkoweOsoby == 0) _poczatkoweOsoby = _osobyPrzedNami;
        }
      });
      return true;
    } catch (_) {
      if (pokazBladPolaczenia && mounted) {
        setState(() {
          _errorMessage = 'Brak połączenia z backendem eQue. Upewnij się, że serwer działa.';
          _isLoading = false;
        });
      }
      return false;
    }
  }

  Future<void> _wyczyscZakonczonyBilet() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('aktywny_bilet');
    if (!mounted) return;
    setState(() {
      _errorMessage = 'Ten bilet został już obsłużony albo anulowany.';
      _isLoading = false;
    });
  }

  void _podlaczWebSocket() {
    if (_prawdziwyNumerBiletu == null) return;
    _socketService = QueueSocketService(
      ticketCode: _prawdziwyNumerBiletu!,
      onEvent: _obsluzZdarzenieWs,
      // Domyka wyścig: nawet gdyby serwer wysłał YOUR_TURN zanim gniazdo
      // zdążyło się podłączyć/zasubskrybować, ten fetch i tak dociągnie
      // prawdziwy stan zaraz po (re)połączeniu.
      onOpen: () => _odswiezStanBiletu(),
    )..connect();
  }

  void _obsluzZdarzenieWs(Map<String, dynamic> data) async {
    if (!mounted) return;
    final String event = data['event'] ?? '';

    setState(() {
      if (event == 'QUEUE_UPDATE') {
        final int noweOsoby = data['queue_position'] ?? _osobyPrzedNami;
        _szacowanyCzasMinuty = data['estimated_wait_time_minutes'] ?? _szacowanyCzasMinuty;

        // To tylko przesunięcie w kolejce (ktoś przed nami został
        // obsłużony) — NIE oznacza wezwania, więc nigdy nie ustawiamy tu
        // _czyWezwano. Nawet przy pozycji 0 czekamy na osobny YOUR_TURN.
        if (noweOsoby < _osobyPrzedNami) {
          _pokazPowiadomienie(noweOsoby);
        }
        _osobyPrzedNami = noweOsoby;

      } else if (event == 'YOUR_TURN') {
        // Jedyny moment, w którym pokazujemy "TWOJA KOLEJ" — operator
        // jawnie nacisnął "Wezwij" przy naszym bilecie w panelu webowym.
        _czyWezwano = true;
        _osobyPrzedNami = 0;
        _szacowanyCzasMinuty = 0;
        _pokazPowiadomienie(0);
      }
    });

    if (event == 'YOUR_TURN') {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove('aktywny_bilet');
    }
  }

  @override
  void dispose() {
    _socketService?.disconnect();
    super.dispose();
  }

  Future<void> _pokazPowiadomienie(int ileOsobZostalo) async {
    const AndroidNotificationDetails androidPlatformChannelSpecifics = AndroidNotificationDetails(
      'eque_kolejka_kanal',
      'Powiadomienia o kolejce',
      channelDescription: 'Informuje, gdy kolejka przesuwa się do przodu',
      importance: Importance.max,
      priority: Priority.high,
      color: Color(0xFF1877F2),
    );
    const NotificationDetails platformChannelSpecifics = NotificationDetails(android: androidPlatformChannelSpecifics);

    if (ileOsobZostalo > 0) {
      await flutterLocalNotificationsPlugin.show(
        id: 0,
        title: 'Kolejka posuwa się do przodu!',
        body: 'Osoba przed Tobą została obsłużona. Zostało osób: $ileOsobZostalo.',
        notificationDetails: platformChannelSpecifics,
      );
    } else {
      await flutterLocalNotificationsPlugin.show(
        id: 1,
        title: '🔔 ZARAZ TWOJA KOLEJ!',
        body: 'Podejdź do punktu obsługi.',
        notificationDetails: platformChannelSpecifics,
      );
    }
  }

  // Wywoływane, gdy pacjent rezygnuje z wizyty
  Future<void> _anulujBiletNaSerwerze() async {
    if (_prawdziwyNumerBiletu == null) return;
    try {
      await http.post(
        Uri.parse(ApiConfig.cancelQueueUrl),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'ticket_code': _prawdziwyNumerBiletu}),
      ).timeout(const Duration(seconds: 5));
    } catch (_) {
      // Ignorujemy błąd sieci przy zamykaniu
    }
  }

  void _potwierdzOpuszczenieKolejki() {
    showDialog(
      context: context,
      builder: (BuildContext dialogContext) {
        return AlertDialog(
          title: const Text('Opuścić kolejkę?', style: TextStyle(fontWeight: FontWeight.bold)),
          content: const Text('Czy na pewno chcesz zrezygnować z miejsca w kolejce? Tej operacji nie będzie można cofnąć.'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Zostaję'),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent),
              onPressed: () async {
                // 1. Wyczyszczenie pamięci lokalnej
                final prefs = await SharedPreferences.getInstance();
                await prefs.remove('aktywny_bilet');

                // 2. Zgłoszenie rezygnacji do backendu
                await _anulujBiletNaSerwerze();

                // 3. Rozłączenie gniazda i wyłączenie powiadomień
                _socketService?.disconnect();
                flutterLocalNotificationsPlugin.cancelAll();

                if (!dialogContext.mounted) return;
                Navigator.of(dialogContext).pop();
                if (!mounted) return;
                Navigator.of(context).pop();
              },
              child: const Text('Tak, rezygnuję'),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return Scaffold(
        appBar: AppBar(title: const Text('Dołączanie do kolejki...')),
        body: const Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              CircularProgressIndicator(),
              SizedBox(height: 16),
              Text('Weryfikacja kodu i pobieranie biletu...'),
            ],
          ),
        ),
      );
    }

    if (_errorMessage != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Błąd połączenia')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.cloud_off, size: 64, color: Colors.redAccent),
                const SizedBox(height: 16),
                Text(_errorMessage!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.redAccent, fontWeight: FontWeight.bold)),
                const SizedBox(height: 24),
                ElevatedButton(
                  onPressed: () {
                    setState(() {
                      _isLoading = true;
                      _errorMessage = null;
                    });
                    if (widget.resumeExisting) {
                      _wznowIstniejacyBilet();
                    } else {
                      _dolaczDoKolejki();
                    }
                  },
                  child: const Text('Spróbuj ponownie'),
                ),
                TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Wróć do skanera'),
                )
              ],
            ),
          ),
        ),
      );
    }

    String tekstCzasu = "~$_szacowanyCzasMinuty min";
    double postep = _poczatkoweOsoby > 0 ? _osobyPrzedNami / _poczatkoweOsoby : 0.0;

    return Scaffold(
      appBar: AppBar(title: const Text('Status Twojej Wizyty')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.grey.shade200),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.04),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('Twój numer biletowy:', style: TextStyle(fontSize: 14, color: Colors.black54)),
                Text(
                  _prawdziwyNumerBiletu ?? '...',
                  style: const TextStyle(fontSize: 56, fontWeight: FontWeight.w900, color: Color(0xFF1877F2), letterSpacing: 2),
                ),
                const Divider(height: 40, thickness: 1),
                if (!_czyWezwano) ...[
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (_osobyPrzedNami == 0) ...[
                        const Text('JESTEŚ NASTĘPNY', style: TextStyle(fontSize: 11, color: Colors.black54, fontWeight: FontWeight.bold)),
                        const SizedBox(height: 4),
                        const Text('Czekaj na wezwanie przez operatora', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.black87)),
                      ] else ...[
                        const Text('STANOWISKO', style: TextStyle(fontSize: 11, color: Colors.black54, fontWeight: FontWeight.bold)),
                        const SizedBox(height: 4),
                        const Text('Okienko 3 (Rejestracja)', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.black87)),
                      ],
                      const SizedBox(height: 24),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('OSOBY PRZED TOBĄ', style: TextStyle(fontSize: 11, color: Colors.black54, fontWeight: FontWeight.bold)),
                              const SizedBox(height: 4),
                              Row(
                                children: [
                                  const Icon(Icons.people, size: 20, color: Colors.black87),
                                  const SizedBox(width: 6),
                                  Text('$_osobyPrzedNami', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: Colors.black87)),
                                ],
                              ),
                            ],
                          ),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              const Text('SZAC. CZAS', style: TextStyle(fontSize: 11, color: Colors.black54, fontWeight: FontWeight.bold)),
                              const SizedBox(height: 4),
                              Text(tekstCzasu, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: Color(0xFF1877F2))),
                            ],
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      TweenAnimationBuilder<double>(
                        tween: Tween<double>(begin: postep, end: postep),
                        duration: const Duration(milliseconds: 500),
                        builder: (context, value, child) {
                          return ClipRRect(
                            borderRadius: BorderRadius.circular(8),
                            child: LinearProgressIndicator(
                              value: value,
                              minHeight: 12,
                              backgroundColor: Colors.grey.shade200,
                              valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFF1877F2)),
                            ),
                          );
                        },
                      ),
                    ],
                  ),
                ] else ...[
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 16),
                    decoration: BoxDecoration(
                      color: Colors.green.shade50,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Colors.green.shade400, width: 2),
                    ),
                    child: const Column(
                      children: [
                        Icon(Icons.check_circle, color: Colors.green, size: 64),
                        SizedBox(height: 16),
                        Text('TWOJA KOLEJ!', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: Colors.green)),
                        SizedBox(height: 8),
                        Text('Podejdź do punktu obsługi', textAlign: TextAlign.center, style: TextStyle(fontSize: 16, color: Colors.black87, fontWeight: FontWeight.bold)),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 32),
                if (!_czyWezwano)
                  TextButton.icon(
                    onPressed: _potwierdzOpuszczenieKolejki,
                    icon: const Icon(Icons.exit_to_app, color: Colors.redAccent),
                    label: const Text('Zrezygnuj z kolejki', style: TextStyle(color: Colors.redAccent, fontWeight: FontWeight.bold)),
                  )
                else
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
                      onPressed: () async {
                        final prefs = await SharedPreferences.getInstance();
                        await prefs.remove('aktywny_bilet');
                        if (!context.mounted) return;
                        Navigator.of(context).pop();
                      },
                      child: const Text('Zakończ wizytę', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                    ),
                  )
              ],
            ),
          ),
        ),
      ),
    );
  }
}
