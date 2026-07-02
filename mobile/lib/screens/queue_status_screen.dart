import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:http/http.dart' as http;
import '../main.dart'; 
import '../services/queue_socket_service.dart';

class QueueStatusScreen extends StatefulWidget {
  // 1. Odbieramy TOKEN z ekranu skanowania, a nie gotowy bilet
  final String scannedToken; 

  const QueueStatusScreen({super.key, required this.scannedToken});

  @override
  State<QueueStatusScreen> createState() => _QueueStatusScreenState();
}

class _QueueStatusScreenState extends State<QueueStatusScreen> {
  final QueueSocketService _socketService = QueueSocketService();
  StreamSubscription? _socketSubscription;

  // 2. Tworzymy zmienną na właściwy bilet, który zaraz dostaniemy z backendu
  String? _prawdziwyNumerBiletu; 

  int _osobyPrzedNami = 0;
  int _poczatkoweOsoby = 0;
  int _szacowanyCzasMinuty = 0;
  
  bool _isLoading = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _pobierzDaneStartoweIDolacz();
  }

  Future<void> _pobierzDaneStartoweIDolacz() async {
    final apiUrl = Uri.parse('http://10.0.2.2:8000/api/v1/queue/join');

    try {
      final response = await http.post(
        apiUrl,
        headers: {'Content-Type': 'application/json'},
        // 3. Wysyłamy do serwera ZESKANOWANY TOKEN
        body: jsonEncode({'qr_token': widget.scannedToken}), 
      ).timeout(const Duration(seconds: 10));

      // Twój mock w backendzie może zwracać 201 (Created), więc warto to uwzględnić
      if (response.statusCode == 200 || response.statusCode == 201) {
        final Map<String, dynamic> data = jsonDecode(response.body);

        setState(() {
          // 4. Pobieramy i zapisujemy prawdziwy bilet z odpowiedzi (np. "A12")
          _prawdziwyNumerBiletu = data['ticket_code']; 
          
          _osobyPrzedNami = data['queue_position'] ?? 0;
          _poczatkoweOsoby = data['queue_position'] ?? 0;
          _szacowanyCzasMinuty = data['estimated_wait_time_minutes'] ?? 0;
          _isLoading = false;
        });

        // 5. Do WebSocketa łączymy się już używając prawdziwego biletu!
        if (_prawdziwyNumerBiletu != null) {
          _podlaczWebSocket();
        }
      } else {
        setState(() {
          _errorMessage = 'Błąd serwera (Kod: ${response.statusCode})';
          _isLoading = false;
        });
      }
    } catch (e) {
      setState(() {
        _errorMessage = 'Brak połączenia z backendem eQue. Upewnij się, że serwer działa.';
        _isLoading = false;
      });
    }
  }

  void _podlaczWebSocket() {
    // Używamy wyciągniętego z API _prawdziwyNumerBiletu
    _socketSubscription = _socketService.connectToQueue(_prawdziwyNumerBiletu!).listen(
      (data) {
        setState(() {
          final String event = data['event'] ?? '';

          if (event == 'QUEUE_UPDATE') {
            final int noweOsoby = data['queue_position'] ?? _osobyPrzedNami;
            _szacowanyCzasMinuty = data['estimated_wait_time_minutes'] ?? _szacowanyCzasMinuty;

            if (noweOsoby < _osobyPrzedNami) {
              _pokazPowiadomienie(noweOsoby);
            }
            _osobyPrzedNami = noweOsoby;

          } else if (event == 'YOUR_TURN') {
            _osobyPrzedNami = 0;
            _szacowanyCzasMinuty = 0;
            _pokazPowiadomienie(0);
          }
        });
      },
      onError: (error) {
        debugPrint('Błąd WebSocketa: $error');
      },
    );
  }

  @override
  void dispose() {
    _socketSubscription?.cancel();
    _socketService.disconnect();
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
        body: 'Podejdź do wyznaczonego stanowiska (Okienko 3).',
        notificationDetails: platformChannelSpecifics,
      );
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
              onPressed: () {
                _socketSubscription?.cancel();
                _socketService.disconnect();
                flutterLocalNotificationsPlugin.cancelAll();
                Navigator.of(dialogContext).pop();
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
              Text('Weryfikacja kodu i pobieranie biletu...'), // Zmiana tekstu
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
                    _pobierzDaneStartoweIDolacz();
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
                  // 6. Wyświetlamy tutaj bilet z bazy (lub '...' w razie pustej zmiennej)
                  _prawdziwyNumerBiletu ?? '...', 
                  style: const TextStyle(fontSize: 56, fontWeight: FontWeight.w900, color: Color(0xFF1877F2), letterSpacing: 2),
                ),
                const Divider(height: 40, thickness: 1),
                if (_osobyPrzedNami > 0) ...[
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('STANOWISKO', style: TextStyle(fontSize: 11, color: Colors.black54, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 4),
                      const Text('Okienko 3 (Rejestracja)', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.black87)),
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
                        Text('Podejdź do punktu obsługi\n(Okienko 3)', textAlign: TextAlign.center, style: TextStyle(fontSize: 16, color: Colors.black87, fontWeight: FontWeight.bold)),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 32),
                if (_osobyPrzedNami > 0)
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
                      onPressed: () => Navigator.of(context).pop(),
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