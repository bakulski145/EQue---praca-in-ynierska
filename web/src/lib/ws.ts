import { getToken } from './api';

const PING_INTERVAL_MS = 20000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export type WsMessage = { type: string; topic?: string; [key: string]: unknown };
type Handler = (message: WsMessage) => void;

class WsClient {
  private socket: WebSocket | null = null;
  private topics: string[] = [];
  private handlers = new Map<string, Set<Handler>>();
  private reconnectHandlers = new Set<() => void>();
  private hasConnectedOnce = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_BASE_MS;
  private closedByClient = false;

  connect(topics: string[]) {
    this.topics = topics;
    this.closedByClient = false;
    this.open();
  }

  updateTopics(topics: string[]) {
    this.topics = topics;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'subscribe', topics }));
    }
  }

  disconnect() {
    this.closedByClient = true;
    this.hasConnectedOnce = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.socket?.close();
    this.socket = null;
  }

  on(type: string, handler: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  onReconnect(handler: () => void): () => void {
    this.reconnectHandlers.add(handler);
    return () => this.reconnectHandlers.delete(handler);
  }

  private open() {
    const token = getToken();
    if (!token) return;

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${wsProtocol}//${window.location.host}/api/v1/ws?token=${encodeURIComponent(token)}`;
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onopen = () => {
      const isReconnect = this.hasConnectedOnce;
      this.hasConnectedOnce = true;
      this.reconnectDelay = RECONNECT_BASE_MS;
      socket.send(JSON.stringify({ type: 'subscribe', topics: this.topics }));
      this.pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
      }, PING_INTERVAL_MS);
      if (isReconnect) this.reconnectHandlers.forEach(h => h());
    };

    socket.onmessage = (event) => {
      let message: WsMessage;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === 'pong' || message.type === 'subscribed') return;
      this.handlers.get(message.type)?.forEach(h => h(message));
    };

    socket.onclose = () => {
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      if (this.closedByClient) return;
      this.reconnectTimer = setTimeout(() => this.open(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    };

    socket.onerror = () => socket.close();
  }
}

export const ws = new WsClient();
