import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:qr_flutter/qr_flutter.dart';

class KioskQrScreen extends StatefulWidget {
  final String adminToken; // Token JWT uzyskany podczas logowania

  const KioskQrScreen({super.key, required this.adminToken});

  @override
  State<KioskQrScreen> createState() => _KioskQrScreenState();
}

class _KioskQrScreenState extends State<KioskQrScreen> {
  String? _obecnyKodQr;
  Timer? _timerOdswiezania;
  bool _isLoading = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _pobierzNowyKodQr();
  }

  Future<void> _pobierzNowyKodQr() async {
    final apiUrl = Uri.parse('http://localhost:8000/api/v1/kiosk/qr');

    try {
      final response = await http.get(
        apiUrl,
        headers: {
          'Authorization': 'Bearer ${widget.adminToken}',
          'Content-Type': 'application/json',
        },
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        setState(() {
          _obecnyKodQr = data['qr_token'];
          _isLoading = false;
          _errorMessage = null;
        });

        // Backend podaje "expires_in_seconds" (zazwyczaj 30s)
        final int waznoscS = data['expires_in_seconds'] ?? 30;
        
        // Odpalamy timer, aby tuż przed wygaśnięciem pobrać nowy kod
        _timerOdswiezania?.cancel();
        _timerOdswiezania = Timer(Duration(seconds: waznoscS), _pobierzNowyKodQr);
      } else {
        _ustawBlad('Błąd autoryzacji lub serwera (Kod: ${response.statusCode})');
      }
    } catch (e) {
      _ustawBlad('Brak połączenia z siecią');
    }
  }

  void _ustawBlad(String wiadomosc) {
    setState(() {
      _errorMessage = wiadomosc;
      _isLoading = false;
    });
    // Ponowna próba za 5 sekund w przypadku błędu
    _timerOdswiezania?.cancel();
    _timerOdswiezania = Timer(const Duration(seconds: 5), _pobierzNowyKodQr);
  }

  @override
  void dispose() {
    _timerOdswiezania?.cancel();
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
    if (_isLoading && _obecnyKodQr == null) {
      return const CircularProgressIndicator();
    }

    if (_errorMessage != null && _obecnyKodQr == null) {
      return Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.wifi_off, size: 64, color: Colors.redAccent),
          const SizedBox(height: 16),
          Text(_errorMessage!, style: const TextStyle(color: Colors.redAccent)),
        ],
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
            const Icon(Icons.layers, size: 80, color: Color(0xFF1877F2)),
            const SizedBox(height: 24),
            const Text(
              'Zeskanuj kod w aplikacji eQue',
              style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            const Text(
              'Aby dołączyć do kolejki, użyj skanera w swoim telefonie.',
              style: TextStyle(fontSize: 18, color: Colors.black54),
            ),
            const SizedBox(height: 48),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.grey.shade300, width: 2),
              ),
              child: QrImageView(
                data: _obecnyKodQr ?? 'oczekiwanie',
                version: QrVersions.auto,
                size: 350.0,
                backgroundColor: Colors.white,
              ),
            ),
            const SizedBox(height: 48),
            const Text(
              'Kod odświeża się automatycznie dla Twojego bezpieczeństwa.',
              style: TextStyle(fontSize: 14, color: Colors.grey),
            ),
          ],
        ),
      ),
    );
  }
}