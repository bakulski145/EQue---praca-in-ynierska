import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';

/// Długo żyjące połączenie WebSocket kiosku (`/api/v1/ws?tablet_token=...`).
/// Serwer autoryzuje po `pairing_token` i automatycznie subskrybuje ten tablet
/// (`tablet:{id}`) oraz jego lokalizację (`location:{id}`, jeśli przypisana) —
/// klient nie musi nic wysyłać poza okresowym pingiem.
///
/// Auto-reconnect z rosnącym opóźnieniem (jak `web/src/lib/ws.ts`), żeby kiosk
/// sam się pozbierał po zerwaniu sieci bez interwencji.
class KioskSocketService {
  static const _pingInterval = Duration(seconds: 20);
  static const _reconnectBaseMs = 1000;
  static const _reconnectMaxMs = 15000;

  final String wsUrl;
  final void Function(Map<String, dynamic> event) onEvent;
  final void Function()? onReconnect;

  WebSocketChannel? _channel;
  StreamSubscription? _subscription;
  Timer? _pingTimer;
  Timer? _reconnectTimer;
  int _reconnectDelayMs = _reconnectBaseMs;
  bool _closedByClient = false;
  bool _hasConnectedOnce = false;

  KioskSocketService({required this.wsUrl, required this.onEvent, this.onReconnect});

  void connect() {
    _closedByClient = false;
    _open();
  }

  /// Aktualizuje subskrypcję tego gniazda po stronie serwera — potrzebne, gdy
  /// tablet dostaje (lub traci) przypisaną lokalizację już PO nawiązaniu
  /// połączenia: serwer subskrybuje tylko raz przy connect, więc bez tego
  /// zdarzenia `location:{id}` (np. wezwanie/zakończenie biletu) nigdy by nie
  /// dotarły do już otwartego gniazda.
  void resubscribe(List<String> topics) {
    _channel?.sink.add(jsonEncode({'type': 'subscribe', 'topics': topics}));
  }

  void disconnect() {
    _closedByClient = true;
    _hasConnectedOnce = false;
    _reconnectTimer?.cancel();
    _pingTimer?.cancel();
    _subscription?.cancel();
    _channel?.sink.close();
    _channel = null;
  }

  Future<void> _open() async {
    final channel = WebSocketChannel.connect(Uri.parse(wsUrl));
    _channel = channel;

    try {
      await channel.ready;
    } catch (_) {
      _scheduleReconnect();
      return;
    }
    if (_closedByClient) return;

    final isReconnect = _hasConnectedOnce;
    _hasConnectedOnce = true;
    _reconnectDelayMs = _reconnectBaseMs;
    _startPing();
    if (isReconnect) onReconnect?.call();

    _subscription = channel.stream.listen(
      (raw) {
        try {
          final data = jsonDecode(raw as String) as Map<String, dynamic>;
          if (data['type'] == 'pong' || data['type'] == 'subscribed') return;
          onEvent(data);
        } catch (_) {
          // niepoprawny JSON — ignorujemy pojedynczą wiadomość
        }
      },
      onError: (_) => _scheduleReconnect(),
      onDone: _scheduleReconnect,
    );
  }

  void _scheduleReconnect() {
    _pingTimer?.cancel();
    if (_closedByClient) return;
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(Duration(milliseconds: _reconnectDelayMs), _open);
    _reconnectDelayMs = (_reconnectDelayMs * 2).clamp(_reconnectBaseMs, _reconnectMaxMs);
  }

  void _startPing() {
    _pingTimer?.cancel();
    _pingTimer = Timer.periodic(_pingInterval, (_) {
      _channel?.sink.add(jsonEncode({'type': 'ping'}));
    });
  }
}
