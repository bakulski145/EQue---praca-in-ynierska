import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'queue_status_screen.dart';

class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key}); // Usunięto parametr camera

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  final TextEditingController _kodController = TextEditingController();
  
  // Zabezpieczenie przed wielokrotnym odpaleniem nawigacji przy szybkim skanerze
  bool _isNavigating = false; 

  @override
  void dispose() {
    _kodController.dispose();
    super.dispose();
  }

  void _przejdzDoKolejki(String kod) {
    if (kod.isEmpty || _isNavigating) return;
    
    // Blokujemy możliwość kolejnych nawigacji z tego ekranu
    setState(() {
      _isNavigating = true;
    });

    Navigator.pushReplacement(
      context,
      MaterialPageRoute(
        builder: (context) => QueueStatusScreen(numerBiletu: kod.toUpperCase()),
      ),
    );
  }

  void _pokazOkienkoReczne() {
    showDialog(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          title: const Text(
            'Wprowadź kod ręcznie',
            style: TextStyle(fontWeight: FontWeight.bold),
          ),
          content: TextField(
            controller: _kodController,
            decoration: InputDecoration(
              hintText: 'Wpisz kod np. A12...',
              prefixIcon: const Icon(Icons.keyboard, color: Colors.grey),
              filled: true,
              fillColor: const Color(0xFFF0F2F5),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide.none,
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Anuluj'),
            ),
            ElevatedButton(
              onPressed: () {
                final String wpisanyKod = _kodController.text;
                Navigator.of(context).pop();
                _przejdzDoKolejki(wpisanyKod);
              },
              child: const Text('Zatwierdź'),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Zeskanuj kod QR')),
      body: Column(
        children: [
          Expanded(
            child: Center(
              child: Container(
                margin: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color: const Color(0xFF1877F2),
                    width: 3,
                  ),
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(13),
                  // Używamy gotowego widgetu MobileScanner
                  child: MobileScanner(
                    onDetect: (capture) {
                      // Funkcja wywoływana automatycznie po wykryciu kodu
                      final List<Barcode> barcodes = capture.barcodes;
                      for (final barcode in barcodes) {
                        if (barcode.rawValue != null) {
                          _przejdzDoKolejki(barcode.rawValue!);
                          break; // Przerywamy pętlę po znalezieniu pierwszego kodu
                        }
                      }
                    },
                  ),
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(24.0),
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      side: const BorderSide(color: Color(0xFF1877F2)),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                    onPressed: _pokazOkienkoReczne,
                    icon: const Icon(Icons.keyboard, color: Color(0xFF1877F2)),
                    label: const Text(
                      'Wpisz kod ręcznie',
                      style: TextStyle(
                        color: Color(0xFF1877F2),
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}