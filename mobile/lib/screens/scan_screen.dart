import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'queue_status_screen.dart';

class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key});

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  // Zmieniłem nazwę kontrolera z _kodController na _tokenController dla spójności
  final TextEditingController _tokenController = TextEditingController();
  
  bool _isNavigating = false; 

  @override
  void dispose() {
    _tokenController.dispose();
    super.dispose();
  }

  void _przejdzDoKolejki(String zeskanowanyToken) {
    if (zeskanowanyToken.isEmpty || _isNavigating) return;
    
    setState(() {
      _isNavigating = true;
    });

    Navigator.pushReplacement(
      context,
      MaterialPageRoute(
        // TUTAJ ZMIANA: Przekazujemy token bez zmiany wielkości liter
        builder: (context) => QueueStatusScreen(scannedToken: zeskanowanyToken),
      ),
    );
  }

  void _pokazOkienkoReczne() {
    showDialog(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          title: const Text(
            'Wprowadź kod zapisu',
            style: TextStyle(fontWeight: FontWeight.bold),
          ),
          content: TextField(
            controller: _tokenController,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(
              hintText: 'np. 4821',
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
                final String wpisanyToken = _tokenController.text;
                Navigator.of(context).pop();
                _przejdzDoKolejki(wpisanyToken);
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
                  child: MobileScanner(
                    onDetect: (capture) {
                      final List<Barcode> barcodes = capture.barcodes;
                      for (final barcode in barcodes) {
                        if (barcode.rawValue != null) {
                          // Od razu przekazujemy surowy token z kodu QR
                          _przejdzDoKolejki(barcode.rawValue!);
                          break; 
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
                      'Wpisz kod zapisu',
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