import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'screens/home_screen.dart';
import 'theme/eque_theme.dart'; // Zostawiamy import, może się przydać do kolorów

final FlutterLocalNotificationsPlugin flutterLocalNotificationsPlugin =
    FlutterLocalNotificationsPlugin();

// Globalny przełącznik motywu
final ValueNotifier<ThemeMode> themeNotifier = ValueNotifier(ThemeMode.system);

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  const AndroidInitializationSettings initializationSettingsAndroid =
      AndroidInitializationSettings('@mipmap/ic_launcher');
  const InitializationSettings initializationSettings = InitializationSettings(
    android: initializationSettingsAndroid,
  );

  await flutterLocalNotificationsPlugin.initialize(
    settings: initializationSettings,
  );

  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<ThemeMode>(
      valueListenable: themeNotifier,
      builder: (context, currentMode, child) {
        return MaterialApp(
          title: 'eQue',
          
          // Używamy domyślnych motywów Fluttera (później możemy je ostylować Twoimi kolorami)
          theme: ThemeData.light().copyWith(
            colorScheme: const ColorScheme.light(
              primary: EQueColors.brand,
              secondary: EQueColors.brand,
            )
          ),
          darkTheme: ThemeData.dark().copyWith(
            colorScheme: ColorScheme.dark(
              primary: EQueColors.brand,
              secondary: EQueColors.brand,
            ),
            scaffoldBackgroundColor: const Color(0xFF121212),
            cardColor: const Color(0xFF1E1E1E),
          ),
          
          themeMode: currentMode, // Nasłuchuje zmian z ustawień
          
          builder: (context, child) {
            final MediaQueryData data = MediaQuery.of(context);
            return MediaQuery(
              data: data.copyWith(
                // Ograniczenie skalowania tekstu dla dostępności (WCAG)
                textScaler: data.textScaler.clamp(minScaleFactor: 1.0, maxScaleFactor: 1.5),
              ),
              child: child!,
            );
          },
          home: const HomeScreen(), // Poprawione na Twój ekran
        );
      },
    );
  }
} // DODANE: Poprawnie zamknięta klasa MyApp