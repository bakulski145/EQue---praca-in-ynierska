import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:http/http.dart' as http;
import 'package:google_fonts/google_fonts.dart';
import '../theme/eque_theme.dart';
import '../widgets/eque_card.dart';
import '../widgets/eque_logo.dart';
import 'settings_screen.dart';

class Placowka {
  final String id;
  final String name;
  final String adress;
  final LatLng pozycja;
  final int openedWindows;

  Placowka({
    required this.id,
    required this.name,
    required this.adress,
    required this.pozycja,
    required this.openedWindows,
  });

  factory Placowka.fromJson(Map<String, dynamic> json) {
    return Placowka(
      id: json['id'].toString(),
      name: json['name'] ?? 'Nieznana placówka',
      adress: json['adress'] ?? 'Brak adresu',
      pozycja: LatLng(
        (json['lat'] as num?)?.toDouble() ?? 0.0,
        (json['lng'] as num?)?.toDouble() ?? 0.0,
      ),
      openedWindows: json['openedWindows'] ?? 0,
    );
  }
}

class MapScreen extends StatefulWidget {
  const MapScreen({super.key});

  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  List<Placowka> _placowki = [];
  Placowka? _wybranaPlacowka;
  bool _isLoading = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _pobierzPlacowkiZAPI();
  }

  Future<void> _pobierzPlacowkiZAPI() async {
    const String apiUrl = 'https://6a351e41f957779fdb3021c8.mockapi.io/locations';

    try {
      final response = await http.get(Uri.parse(apiUrl)).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        final List<dynamic> data = jsonDecode(response.body);
        
        setState(() {
          _placowki = data.map((json) => Placowka.fromJson(json)).toList();
          if (_placowki.isNotEmpty) {
            _wybranaPlacowka = _placowki.first;
          }
          _isLoading = false;
        });
      } else {
        setState(() {
          _errorMessage = 'Błąd pobierania danych (Kod: ${response.statusCode})';
          _isLoading = false;
        });
      }
    } catch (e) {
      setState(() {
        _errorMessage = 'Brak połączenia z siecią lub błąd API.';
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: EQueBrand(markSize: 26, fontSize: 18,
        inverse: Theme.of(context).brightness == Brightness.dark
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
      body: _budujCialoEkranu(),
    );
  }

  Widget _budujCialoEkranu() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    if (_isLoading) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: 16),
            Text('Pobieranie placówek z API...', style: GoogleFonts.manrope(color: EQueColors.textMuted)),
          ],
        ),
      );
    }

    if (_errorMessage != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.cloud_off, size: 56, color: EQueColors.queueSkipped),
            const SizedBox(height: 16),
            Text(_errorMessage!, style: GoogleFonts.manrope(color: EQueColors.queueSkipped, fontWeight: FontWeight.w700)),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: () {
                setState(() {
                  _isLoading = true;
                  _errorMessage = null;
                });
                _pobierzPlacowkiZAPI();
              },
              child: const Text('Spróbuj ponownie'),
            )
          ],
        ),
      );
    }

    return Stack(
      children: [
        FlutterMap(
          options: const MapOptions(
            initialCenter: LatLng(50.0614, 19.9380),
            initialZoom: 12.5,
          ),
          children: [
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'com.example.eque',
            ),
            MarkerLayer(
              markers: _placowki.map((placowka) {
                final czyWybrana = placowka == _wybranaPlacowka;
                return Marker(
                  point: placowka.pozycja,
                  width: 60,
                  height: 60,
                  child: GestureDetector(
                    onTap: () {
                      setState(() {
                        _wybranaPlacowka = placowka;
                      });
                    },
                    child: Icon(
                      Icons.location_on,
                      color: czyWybrana ? EQueColors.queueSkipped : EQueColors.brand,
                      size: czyWybrana ? 50 : 40,
                    ),
                  ),
                );
              }).toList(),
            ),
          ],
        ),
        if (_wybranaPlacowka != null)
          Positioned(
            bottom: 16,
            left: 16,
            right: 16,
            child: EQueCard(
              padding: const EdgeInsets.all(16.0),
              child: Row(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(color: EQueColors.brandSubtle, borderRadius: BorderRadius.circular(EQueRadii.md)),
                    child: const Icon(Icons.account_balance, color: EQueColors.brand, size: 24),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          _wybranaPlacowka!.name,
                          style: GoogleFonts.manrope(fontWeight: FontWeight.w700, fontSize: 15.5, color: isDark ? Colors.white : EQueColors.textStrong),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          _wybranaPlacowka!.adress,
                          style: GoogleFonts.manrope(color: EQueColors.textMuted, fontSize: 13),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Aktywne okienka: ${_wybranaPlacowka!.openedWindows}',
                          style: GoogleFonts.manrope(color: EQueColors.queueServed, fontSize: 12, fontWeight: FontWeight.w700),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}