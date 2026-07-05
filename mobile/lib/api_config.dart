import 'dart:io';
import 'package:flutter/foundation.dart';

class ApiConfig {
  static const String localLanIp = '192.168.101.2';

  static String get _host {
    if (kIsWeb) {
      return 'localhost';
    } else if (Platform.isAndroid) {
      return '10.0.2.2';
    } else {
      return 'localhost';
    }
  }

  static String get baseUrl => 'http://$_host:8000';
  static String get wsUrl => 'ws://$_host:8000';

  static String get loginUrl => '$baseUrl/api/v1/auth/login';
  static String get joinQueueUrl => '$baseUrl/api/v1/queue/join';
  static String get kioskStatusUrl => '$baseUrl/api/v1/kiosk/status';
  static String get kioskSignupCodeUrl => '$baseUrl/api/v1/kiosk/signup-code';
  static String get cancelQueueUrl => '$baseUrl/api/v1/queue/cancel';
}