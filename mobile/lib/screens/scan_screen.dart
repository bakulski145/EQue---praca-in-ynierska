import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../theme/eque_theme.dart';
import '../widgets/eque_logo.dart';
import 'queue_status_screen.dart';

class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key});

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
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
            decoration: const InputDecoration(
              hintText: 'np. 4821',
              prefixIcon: Icon(Icons.keyboard),
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
      appBar: AppBar(title: const EQueBrand(markSize: 26, fontSize: 18)),
      body: Column(
        children: [
          Expanded(
            child: Center(
              child: Container(
                margin: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(EQueRadii.xl),
                  border: Border.all(color: EQueColors.brand, width: 3),
                  boxShadow: EQueShadows.md,
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(EQueRadii.xl - 3),
                  child: MobileScanner(
                    onDetect: (capture) {
                      final List<Barcode> barcodes = capture.barcodes;
                      for (final barcode in barcodes) {
                        if (barcode.rawValue != null) {
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
                    onPressed: _pokazOkienkoReczne,
                    icon: const Icon(Icons.keyboard),
                    label: const Text('Wpisz kod zapisu'),
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