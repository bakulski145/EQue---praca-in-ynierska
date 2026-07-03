import 'dart:io';
import 'package:flutter/foundation.dart'; // Potrzebne do kIsWeb

class ApiConfig {
  // 1. WPISZ TUTAJ LOKALNE IP SWOJEGO KOMPUTERA (dla fizycznego telefonu z Wi-Fi)
  // Aby je poznać, wpisz w terminalu Windows: ipconfig (szukaj "IPv4 Address")
  // Na Macu/Linuxie wpisz: ifconfig
  static const String _localLanIp = '192.168.101.2'; // <-- ZMIEŃ NA SWOJE IP

  // 2. Automatyczne wykrywanie właściwego hosta:
  static String get _host {
    if (kIsWeb) {
      // Jeśli uruchamiasz w przeglądarce (Chrome/Edge)
      return 'localhost';
    } else if (Platform.isAndroid) {
      // Poniżej możesz zmienić na _localLanIp, jeśli testujesz na fizycznym telefonie z Androidem!
      // '10.0.2.2' zostaw dla wirtualnego emulatora na komputerze:
      return '10.0.2.2'; 
    } else {
      // Windows Desktop, iOS Simulator, macOS
      return 'localhost';
    }
  }

  // 3. Wygenerowane adresy bazowe:
  static String get baseUrl => 'http://$_host:8000';
  static String get wsUrl => 'ws://$_host:8000';

  // 4. Gotowe endpointy:
  static String get loginUrl => '$baseUrl/api/v1/auth/login';
  static String get joinQueueUrl => '$baseUrl/api/v1/queue/join';
  static String get kioskQrUrl => '$baseUrl/api/v1/kiosk/qr';
  static String get cancelQueueUrl => '$baseUrl/api/v1/queue/cancel';
}