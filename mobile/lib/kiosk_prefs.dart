import 'dart:math';
import 'package:shared_preferences/shared_preferences.dart';

const String kKioskPairingTokenKey = 'kiosk_pairing_token';

const String kKioskDeviceIdKey = 'kiosk_device_id';

Future<String> getOrCreateDeviceId() async {
  final prefs = await SharedPreferences.getInstance();
  final existing = prefs.getString(kKioskDeviceIdKey);
  if (existing != null && existing.isNotEmpty) return existing;

  final random = Random.secure();
  final id = List.generate(32, (_) => random.nextInt(16).toRadixString(16)).join();
  await prefs.setString(kKioskDeviceIdKey, id);
  return id;
}
