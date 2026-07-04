import 'dart:math';
import 'package:shared_preferences/shared_preferences.dart';

/// Klucz SharedPreferences pod którym zapamiętujemy pairing_token kiosku —
/// dzięki temu tablet, raz sparowany, wraca prosto do trybu kiosku po
/// odświeżeniu/restarcie aplikacji, bez potrzeby ponownej interwencji admina.
const String kKioskPairingTokenKey = 'kiosk_pairing_token';

/// Klucz SharedPreferences z identyfikatorem TEGO fizycznego urządzenia —
/// generowany raz i trzymany na stałe. Wysyłany razem z pairing_token do
/// backendu, który wymusza regułę "jeden token = jeden tablet": pierwsze
/// urządzenie z danym tokenem go przejmuje, każde kolejne z innym device_id
/// dostaje odmowę (patrz `_authenticate_kiosk` w backendzie).
const String kKioskDeviceIdKey = 'kiosk_device_id';

/// Zwraca zapamiętany identyfikator urządzenia, generując go przy pierwszym
/// wywołaniu (32 losowe znaki hex — wystarczające jako lokalny identyfikator,
/// nie musi być kryptograficznie idealnym UUID).
Future<String> getOrCreateDeviceId() async {
  final prefs = await SharedPreferences.getInstance();
  final existing = prefs.getString(kKioskDeviceIdKey);
  if (existing != null && existing.isNotEmpty) return existing;

  final random = Random.secure();
  final id = List.generate(32, (_) => random.nextInt(16).toRadixString(16)).join();
  await prefs.setString(kKioskDeviceIdKey, id);
  return id;
}
