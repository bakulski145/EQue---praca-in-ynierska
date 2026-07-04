import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../api_config.dart';

/// Połączenie WebSocket pacjenta (`/api/v1/queue/ws/{ticket_code}`), bez JWT —
/// identyfikacja po samym kodzie biletu.
///
/// Auto-reconnect z rosnącym opóźnieniem: sieć telefonu potrafi zerwać
/// połączenie (przejście w tło, zmiana Wi-Fi/LTE), a to jedyny kanał, którym
/// pacjent dowiaduje się o wezwaniu (YOUR_TURN) — bez reconnectu jednorazowy
/// event przegapiony w złym momencie zostawiałby go na zawsze z nieaktualnym
/// stanem. `onOpen` odpala się przy KAŻDYM udanym (re)połączeniu (także
/// pierwszym), żeby wywołujący mógł dociągnąć REST-em aktualny stan biletu —
/// to domyka to samo ryzyko wyścigu na starcie (bilet mógł zostać wezwany
/// zanim gniazdo zdążyło się zasubskrybować).
class QueueSocketService {
  static const _reconnectBaseMs = 1000;
  static const _reconnectMaxMs = 15000;

  final String ticketCode;
  final void Function(Map<String, dynamic> event) onEvent;
  final void Function() onOpen;

  WebSocketChannel? _channel;
  StreamSubscription? _subscription;
  Timer? _reconnectTimer;
  int _reconnectDelayMs = _reconnectBaseMs;
  bool _closedByClient = false;

  QueueSocketService({required this.ticketCode, required this.onEvent, required this.onOpen});

  void connect() {
    _closedByClient = false;
    _open();
  }

  void disconnect() {
    _closedByClient = true;
    _reconnectTimer?.cancel();
    _subscription?.cancel();
    _channel?.sink.close();
    _channel = null;
  }

  Future<void> _open() async {
    final wsUrl = '${ApiConfig.wsUrl}/api/v1/queue/ws/$ticketCode';
    final channel = WebSocketChannel.connect(Uri.parse(wsUrl));
    _channel = channel;

    try {
      await channel.ready;
    } catch (_) {
      _scheduleReconnect();
      return;
    }
    if (_closedByClient) return;

    _reconnectDelayMs = _reconnectBaseMs;
    onOpen();

    _subscription = channel.stream.listen(
      (raw) {
        try {
          final data = jsonDecode(raw as String) as Map<String, dynamic>;
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
    if (_closedByClient) return;
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(Duration(milliseconds: _reconnectDelayMs), _open);
    _reconnectDelayMs = (_reconnectDelayMs * 2).clamp(_reconnectBaseMs, _reconnectMaxMs);
  }
}
