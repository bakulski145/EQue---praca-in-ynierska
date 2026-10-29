import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../main.dart'; // import themeNotifier

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _isDarkMode = false;

  @override
  void initState() {
    super.initState();
    _isDarkMode = themeNotifier.value == ThemeMode.dark;
  }

  Future<void> _toggleTheme(bool value) async {
    setState(() {
      _isDarkMode = value;
    });
    
    // Zmiana motywu w locie
    themeNotifier.value = value ? ThemeMode.dark : ThemeMode.light;
    
    // Zapisanie wyboru do pamięci urządzenia
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('is_dark_mode', value);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Ustawienia'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16.0),
        children: [
          Text(
            'WYGLĄD I DOSTĘPNOŚĆ',
            style: GoogleFonts.manrope(
              fontSize: 12,
              fontWeight: FontWeight.w800,
              letterSpacing: 1.2,
              color: Colors.grey,
            ),
          ),
          const SizedBox(height: 8),
          SwitchListTile(
            title: const Text('Tryb ciemny (Dark Mode)'),
            subtitle: const Text('Zmniejsza zmęczenie wzroku w nocy'),
            secondary: const Icon(Icons.dark_mode_outlined),
            value: _isDarkMode,
            onChanged: _toggleTheme,
            activeColor: Colors.teal, // Dostosuj do swojego EQueColors.brand
          ),
          // Tutaj w przyszłości dodamy kolejne opcje:
          // SwitchListTile(title: Text('Tryb dla daltonistów'), ...),
          // SwitchListTile(title: Text('Wibracje (Haptic Feedback)'), ...),
        ],
      ),
    );
  }
}