import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../kiosk_prefs.dart';
import 'kiosk_qr_screen.dart';

class KioskLoginScreen extends StatefulWidget {
  // Komunikat pokazywany od razu po wejściu — np. gdy KioskQrScreen odesłał
  // tu z powrotem z powodu nieprawidłowego/skonfliktowanego tokenu.
  final String? initialError;

  const KioskLoginScreen({super.key, this.initialError});

  @override
  State<KioskLoginScreen> createState() => _KioskLoginScreenState();
}

class _KioskLoginScreenState extends State<KioskLoginScreen> {
  // Zamiast loginu i hasła mamy tylko JEDNO pole na token tabletu
  final _tokenController = TextEditingController();
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _errorMessage = widget.initialError;
  }

  Future<void> _przejdzDoKiosku() async {
    FocusScope.of(context).unfocus(); // Ukrywamy klawiaturę
    final String wpisanyToken = _tokenController.text.trim();

    if (wpisanyToken.isEmpty) {
      setState(() {
        _errorMessage = 'Wprowadź token urządzenia!';
      });
      return;
    }

    // Zapamiętujemy token lokalnie — od tej pory tablet sam wraca do trybu
    // kiosku po odświeżeniu/restarcie, bez potrzeby ponownego wpisywania
    // (patrz HomeScreen). Jeśli token okaże się nieprawidłowy, KioskQrScreen
    // go wyczyści przy pierwszym 401 z serwera.
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(kKioskPairingTokenKey, wpisanyToken);

    // NIE ROBIMY ŻADNEGO ZAPYTANIA HTTP DO /auth/login!
    // Od razu otwieramy KioskQrScreen i przekazujemy mu token parowania:
    if (!mounted) return;
    Navigator.pushReplacement(
      context,
      MaterialPageRoute(
        builder: (context) => KioskQrScreen(adminToken: wpisanyToken),
      ),
    );
  }

  @override
  void dispose() {
    _tokenController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF0F2F5),
      appBar: AppBar(
        title: const Text('Konfiguracja Kiosku'),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black87,
        elevation: 0,
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: Card(
            elevation: 4,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            child: Padding(
              padding: const EdgeInsets.all(32.0),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.tablet_mac, size: 64, color: Color(0xFF1877F2)),
                  const SizedBox(height: 16),
                  const Text(
                    'Parowanie Tabletu',
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Wprowadź token przypisany do tej lokalizacji w panelu administratora.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.black54, fontSize: 14),
                  ),
                  const SizedBox(height: 32),
                  if (_errorMessage != null) ...[
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.red.shade50,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        _errorMessage!,
                        style: TextStyle(color: Colors.red.shade700),
                        textAlign: TextAlign.center,
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],
                  // Jedno pole tekstowe na Pairing Token
                  TextField(
                    controller: _tokenController,
                    decoration: InputDecoration(
                      labelText: 'Token urządzenia (Pairing Token)',
                      hintText: 'np. kiosk-rejestracja-123',
                      prefixIcon: const Icon(Icons.key),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                  ),
                  const SizedBox(height: 32),
                  SizedBox(
                    width: double.infinity,
                    height: 50,
                    child: ElevatedButton(
                      onPressed: _przejdzDoKiosku,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF1877F2),
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      child: const Text('Uruchom Kiosk', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}