import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../kiosk_prefs.dart';
import '../theme/eque_theme.dart';
import '../widgets/eque_card.dart';
import '../widgets/eque_logo.dart';
import '../widgets/ticket_code.dart';
import 'scan_screen.dart';
import 'map_screen.dart';
import 'kiosk_login_screen.dart';
import 'kiosk_qr_screen.dart';
import 'queue_status_screen.dart';
import 'settings_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  String? _zapisanyBilet;
  bool _sprawdzanieKiosku = true;

  @override
  void initState() {
    super.initState();
    _sprawdzTrybKiosku();
  }

  Future<void> _sprawdzTrybKiosku() async {
    final prefs = await SharedPreferences.getInstance();
    final zapisanyToken = prefs.getString(kKioskPairingTokenKey);
    if (!mounted) return;

    if (zapisanyToken != null && zapisanyToken.isNotEmpty) {
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (context) => KioskQrScreen(adminToken: zapisanyToken)),
      );
      return;
    }

    setState(() {
      _sprawdzanieKiosku = false;
    });
    _sprawdzAktywnyBilet();
  }

  Future<void> _sprawdzAktywnyBilet() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    setState(() {
      _zapisanyBilet = prefs.getString('aktywny_bilet');
    });
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    if (_sprawdzanieKiosku) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: EQueBrand(
          markSize: 26,
          fontSize: 18,
          inverse: Theme.of(context).brightness == Brightness.dark,
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            tooltip: 'Ustawienia',
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (context) => const SettingsScreen()),
              );
            },
          ),
        ],
        ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              GestureDetector(
                onLongPress: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (context) => const KioskLoginScreen(),
                    ),
                  );
                },
                child: const EQueLogoMark(size: 84),
              ),
              const SizedBox(height: 28),
              Text('Witaj w eQue', style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 8),
              Text(
                'Zarządzaj swoim czasem i unikaj kolejek w prosty sposób.',
                textAlign: TextAlign.center,
                style: GoogleFonts.manrope(fontSize: 15, color: EQueColors.textMuted),
              ),
              const SizedBox(height: 28),

              if (_zapisanyBilet != null) ...[
                EQueCard(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                  onTap: () async {
                    await Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (context) => QueueStatusScreen(scannedToken: _zapisanyBilet!, resumeExisting: true),
                      ),
                    );
                    _sprawdzAktywnyBilet();
                  },
                  child: Row(
                    children: [
                      Container(
                        width: 52,
                        height: 52,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: EQueColors.queueWaitingBg,
                          borderRadius: BorderRadius.circular(EQueRadii.md),
                          border: Border.all(color: EQueColors.queueWaitingBorder),
                        ),
                        child: TicketCode(_zapisanyBilet!, size: TicketCodeSize.sm, tone: TicketCodeTone.normal),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text('Masz aktywny bilet', style: GoogleFonts.manrope(fontWeight: FontWeight.w700, fontSize: 15, color: isDark ? Colors.white : EQueColors.textStrong)),
                            const SizedBox(height: 2),
                            Text('Kliknij, aby wrócić do podglądu kolejki.', style: GoogleFonts.manrope(fontSize: 12.5, color: EQueColors.textMuted)),
                          ],
                        ),
                      ),
                      const Icon(Icons.chevron_right, size: 20, color: EQueColors.queueWaiting),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
              ],

              _MenuButton(
                icon: Icons.qr_code_scanner,
                title: 'Zeskanuj kod QR',
                subtitle: 'Dołącz do nowej kolejki biletowej',
                onTap: () async {
                  await Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (context) => const ScanScreen(),
                    ),
                  );
                  _sprawdzAktywnyBilet();
                },
              ),
              const SizedBox(height: 14),

              _MenuButton(
                icon: Icons.map_outlined,
                title: 'Mapa placówek',
                subtitle: 'Znajdź najbliższe punkty obsługi',
                onTap: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(builder: (context) => const MapScreen()),
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MenuButton extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _MenuButton({required this.icon, required this.title, required this.subtitle, required this.onTap});

  @override
  Widget build(BuildContext context) {

final isDark = Theme.of(context).brightness == Brightness.dark;

    return EQueCard(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
      onTap: onTap,
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: EQueColors.brandSubtle, borderRadius: BorderRadius.circular(EQueRadii.md)),
            child: Icon(icon, color: EQueColors.brand, size: 26),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(title, style: GoogleFonts.manrope(fontWeight: FontWeight.w700, fontSize: 15.5, color: isDark ? Colors.white : EQueColors.textStrong)),
                const SizedBox(height: 2),
                Text(subtitle, style: GoogleFonts.manrope(fontSize: 13, color: isDark ? Colors.white70 : EQueColors.textMuted)),
              ],
            ),
          ),
          const Icon(Icons.chevron_right, size: 20, color: EQueColors.textFaint),
        ],
      ),
    );
  }
}
