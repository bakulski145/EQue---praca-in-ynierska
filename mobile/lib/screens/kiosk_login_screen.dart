import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../kiosk_prefs.dart';
import '../theme/eque_theme.dart';
import '../widgets/eque_card.dart';
import 'kiosk_qr_screen.dart';

class KioskLoginScreen extends StatefulWidget {
  final String? initialError;

  const KioskLoginScreen({super.key, this.initialError});

  @override
  State<KioskLoginScreen> createState() => _KioskLoginScreenState();
}

class _KioskLoginScreenState extends State<KioskLoginScreen> {
  final _tokenController = TextEditingController();
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _errorMessage = widget.initialError;
  }

  Future<void> _przejdzDoKiosku() async {
    FocusScope.of(context).unfocus();
    final String wpisanyToken = _tokenController.text.trim();

    if (wpisanyToken.isEmpty) {
      setState(() {
        _errorMessage = 'Wprowadź token urządzenia!';
      });
      return;
    }

    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(kKioskPairingTokenKey, wpisanyToken);

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
      appBar: AppBar(title: const Text('Konfiguracja kiosku')),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: EQueCard(
              padding: const EdgeInsets.all(32.0),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 72,
                    height: 72,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(color: EQueColors.brandSubtle, borderRadius: BorderRadius.circular(EQueRadii.lg)),
                    child: const Icon(Icons.tablet_mac, size: 36, color: EQueColors.brand),
                  ),
                  const SizedBox(height: 20),
                  Text('Parowanie tabletu', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontSize: 22)),
                  const SizedBox(height: 8),
                  Text(
                    'Wprowadź token przypisany do tej lokalizacji w panelu administratora.',
                    textAlign: TextAlign.center,
                    style: GoogleFonts.manrope(color: EQueColors.textMuted, fontSize: 14),
                  ),
                  const SizedBox(height: 28),
                  if (_errorMessage != null) ...[
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: EQueColors.queueSkippedBg,
                        borderRadius: BorderRadius.circular(EQueRadii.md),
                        border: Border.all(color: EQueColors.queueSkippedBorder),
                      ),
                      child: Text(
                        _errorMessage!,
                        style: GoogleFonts.manrope(color: EQueColors.queueSkipped, fontWeight: FontWeight.w600, fontSize: 13.5),
                        textAlign: TextAlign.center,
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],
                  TextField(
                    controller: _tokenController,
                    decoration: const InputDecoration(
                      labelText: 'Token urządzenia (Pairing Token)',
                      hintText: 'np. kiosk-rejestracja-123',
                      prefixIcon: Icon(Icons.key),
                    ),
                  ),
                  const SizedBox(height: 28),
                  SizedBox(
                    width: double.infinity,
                    height: 56,
                    child: ElevatedButton(
                      onPressed: _przejdzDoKiosku,
                      child: const Text('Uruchom kiosk'),
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
