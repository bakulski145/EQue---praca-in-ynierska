import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'scan_screen.dart';
import 'map_screen.dart';
import 'kiosk_login_screen.dart';
import 'queue_status_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  String? _zapisanyBilet;

  @override
  void initState() {
    super.initState();
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
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'eQue',
          style: TextStyle(
            color: Color(0xFF1877F2),
            fontWeight: FontWeight.bold,
            fontSize: 24,
          ),
        ),
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(16.0),
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
                child: Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1877F2).withValues(alpha: 0.1),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.layers,
                    size: 64,
                    color: Color(0xFF1877F2),
                  ),
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                'Witaj w eQue',
                style: TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.bold,
                  color: Colors.black87,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Zarządzaj swoim czasem i unikaj kolejek w prosty sposób.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 15, color: Colors.black54),
              ),
              const SizedBox(height: 24),

              // --- BANER PRZYWRACAJĄCY AKTYWNY BILET ---
              if (_zapisanyBilet != null) ...[
                Card(
                  color: Colors.amber.shade50,
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: BorderSide(color: Colors.amber.shade300, width: 1.5),
                  ),
                  child: ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    leading: const Icon(Icons.confirmation_number, color: Colors.amber, size: 36),
                    title: Text(
                      'Masz aktywny bilet: $_zapisanyBilet',
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.black87),
                    ),
                    subtitle: const Text(
                      'Kliknij, aby wrócić do podglądu kolejki.',
                      style: TextStyle(color: Colors.black54, fontSize: 13),
                    ),
                    trailing: const Icon(Icons.arrow_forward_ios, size: 16, color: Colors.amber),
                    onTap: () async {
                      await Navigator.push(
                        context,
                        MaterialPageRoute(
                          // Przekazujemy zapisany bilet (używamy go też jako tokena, skoro bilet już istnieje)
                          builder: (context) => QueueStatusScreen(scannedToken: _zapisanyBilet!),
                        ),
                      );
                      // Po powrocie odświeżamy stan, na wypadek gdyby pacjent zrezygnował z kolejki
                      _sprawdzAktywnyBilet();
                    },
                  ),
                ),
                const SizedBox(height: 16),
              ],
              // -----------------------------------------

              _buildMenuButton(
                context,
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
              const SizedBox(height: 16),

              _buildMenuButton(
                context,
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

  Widget _buildMenuButton(
    BuildContext context, {
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return Card(
      color: Colors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: Colors.grey.shade200),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 20,
          vertical: 12,
        ),
        leading: Icon(icon, color: const Color(0xFF1877F2), size: 32),
        title: Text(
          title,
          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
        ),
        subtitle: Text(
          subtitle,
          style: TextStyle(color: Colors.grey.shade600, fontSize: 13),
        ),
        trailing: const Icon(Icons.arrow_forward_ios, size: 16),
        onTap: onTap,
      ),
    );
  }
}