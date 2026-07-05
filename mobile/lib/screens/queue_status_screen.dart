import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../api_config.dart';
import '../main.dart';
import '../services/queue_socket_service.dart';
import '../theme/eque_theme.dart';
import '../widgets/eque_card.dart';
import '../widgets/eque_logo.dart';
import '../widgets/position_meter.dart';
import '../widgets/ticket_code.dart';

class QueueStatusScreen extends StatefulWidget {
  final String scannedToken;
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

        if (noweOsoby < _osobyPrzedNami) {
          _pokazPowiadomienie(noweOsoby);
        }
        _osobyPrzedNami = noweOsoby;

      } else if (event == 'YOUR_TURN') {
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
      color: EQueColors.brand,
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

  Future<void> _anulujBiletNaSerwerze() async {
    if (_prawdziwyNumerBiletu == null) return;
    try {
      await http.post(
        Uri.parse(ApiConfig.cancelQueueUrl),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'ticket_code': _prawdziwyNumerBiletu}),
      ).timeout(const Duration(seconds: 5));
    } catch (_) {
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
                final prefs = await SharedPreferences.getInstance();
                await prefs.remove('aktywny_bilet');

                await _anulujBiletNaSerwerze();

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
        appBar: AppBar(title: const EQueBrand(markSize: 26, fontSize: 18)),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const CircularProgressIndicator(),
              const SizedBox(height: 16),
              Text('Weryfikacja kodu i pobieranie biletu...', style: GoogleFonts.manrope(color: EQueColors.textMuted)),
            ],
          ),
        ),
      );
    }

    if (_errorMessage != null) {
      return Scaffold(
        appBar: AppBar(title: const EQueBrand(markSize: 26, fontSize: 18)),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.cloud_off, size: 56, color: EQueColors.queueSkipped),
                const SizedBox(height: 16),
                Text(_errorMessage!, textAlign: TextAlign.center, style: GoogleFonts.manrope(color: EQueColors.queueSkipped, fontWeight: FontWeight.w700, fontSize: 15)),
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
                const SizedBox(height: 4),
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

    if (_czyWezwano) return _buildTwojaKolej(context);

    final tekstCzasu = "~$_szacowanyCzasMinuty min";

    return Scaffold(
      appBar: AppBar(title: const EQueBrand(markSize: 26, fontSize: 18)),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20.0),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                EQueCard(
                  radius: EQueRadii.xl2,
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    children: [
                      Text(
                        'TWÓJ BILET',
                        style: GoogleFonts.manrope(fontSize: 12, fontWeight: FontWeight.w800, letterSpacing: 1.2, color: EQueColors.textFaint),
                      ),
                      const SizedBox(height: 8),
                      TicketCode(_prawdziwyNumerBiletu ?? '...', size: TicketCodeSize.xl, tone: TicketCodeTone.brand),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                EQueCard(
                  radius: EQueRadii.xl2,
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _osobyPrzedNami == 0 ? 'Jesteś następny' : 'Czekasz w kolejce',
                        style: GoogleFonts.spaceGrotesk(fontSize: 18, fontWeight: FontWeight.w700, color: EQueColors.textStrong, letterSpacing: -0.01),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _osobyPrzedNami == 0
                            ? 'Czekaj na wezwanie przez operatora'
                            : 'Powiadomimy Cię, gdy zbliży się Twoja kolej',
                        style: GoogleFonts.manrope(fontSize: 13.5, color: EQueColors.textMuted),
                      ),
                      const SizedBox(height: 20),
                      PositionMeter(position: _osobyPrzedNami, total: _poczatkoweOsoby, eta: tekstCzasu),
                    ],
                  ),
                ),
                const SizedBox(height: 24),
                TextButton.icon(
                  onPressed: _potwierdzOpuszczenieKolejki,
                  icon: const Icon(Icons.exit_to_app, size: 18, color: EQueColors.queueSkipped),
                  label: Text('Zrezygnuj z kolejki', style: GoogleFonts.manrope(color: EQueColors.queueSkipped, fontWeight: FontWeight.w700)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildTwojaKolej(BuildContext context) {
    return Scaffold(
      backgroundColor: EQueColors.queueServing,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 24),
          child: Column(
            children: [
              const EQueBrand(markSize: 26, fontSize: 18, inverse: true),
              const Spacer(),
              Container(
                width: 84,
                height: 84,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.18), shape: BoxShape.circle),
                child: const Icon(Icons.notifications_active, size: 40, color: Colors.white),
              ),
              const SizedBox(height: 18),
              Text(
                'TWOJA KOLEJ',
                style: GoogleFonts.manrope(fontSize: 14, fontWeight: FontWeight.w800, letterSpacing: 1.6, color: Colors.white.withValues(alpha: 0.85)),
              ),
              const SizedBox(height: 10),
              TicketCode(_prawdziwyNumerBiletu ?? '...', tone: TicketCodeTone.onDark, fontSizeOverride: 84),
              const SizedBox(height: 12),
              Text(
                'Podejdź do punktu obsługi',
                textAlign: TextAlign.center,
                style: GoogleFonts.spaceGrotesk(fontWeight: FontWeight.w600, fontSize: 20, color: Colors.white),
              ),
              const Spacer(),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Colors.white,
                    side: const BorderSide(color: Colors.white54),
                  ),
                  onPressed: () async {
                    final prefs = await SharedPreferences.getInstance();
                    await prefs.remove('aktywny_bilet');
                    if (!context.mounted) return;
                    Navigator.of(context).pop();
                  },
                  child: const Text('Zakończ'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
