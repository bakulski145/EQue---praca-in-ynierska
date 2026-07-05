"""
ws.py — WebSocket connection manager + Redis pub/sub listener.

Architektura (wg API_SPEC.md sekcja 5):
- Jeden endpoint WS /api/v1/ws?token=<jwt>
- Klient po połączeniu wysyła: {"type": "subscribe", "topics": ["admin"]}
  lub dla tabletu: {"type": "subscribe", "topics": ["location:42"]}
- Serwer rozsyła eventy tylko do subskrybentów danego topiku.
- Topik "admin" dostaje WSZYSTKIE eventy.
- Backend publikuje eventy na kanał Redis "eque:events" (format JSON).
- Listener w tle odbiera z Redisa i wywołuje ConnectionManager.broadcast_to_topic().
"""

import asyncio
import json
import logging
from fastapi import WebSocket

logger = logging.getLogger(__name__)

REDIS_CHANNEL = "eque:events"


class ConnectionManager:
    """
    Zarządza aktywnymi połączeniami WebSocket i ich subskrypcjami.

    Struktura danych:
        _connections: dict[WebSocket, set[str]]
            klucz   = gniazdo WebSocket
            wartość = zbiór topików, na które gniazdo jest zasubskrybowane

    Topiki:
        "admin"        – subskrybuje WSZYSTKIE eventy (panel admina)
        "location:{id}"– subskrybuje tylko eventy dla konkretnej lokalizacji
    """

    def __init__(self):
        self._connections: dict[WebSocket, set[str]] = {}


    async def connect(self, websocket: WebSocket) -> None:
        """Akceptuje połączenie i rejestruje gniazdo (bez topików na start)."""
        await websocket.accept()
        self._connections[websocket] = set()
        logger.info("WS connect: %d aktywnych połączeń", len(self._connections))

    def disconnect(self, websocket: WebSocket) -> None:
        """Usuwa gniazdo po rozłączeniu (bez wyjątku gdy nie ma)."""
        self._connections.pop(websocket, None)
        logger.info("WS disconnect: %d aktywnych połączeń", len(self._connections))


    def subscribe(self, websocket: WebSocket, topics: list[str]) -> None:
        """
        Zapisuje topiki dla danego gniazda.
        Wywołać po odebraniu wiadomości {"type": "subscribe", "topics": [...]}.
        """
        if websocket in self._connections:
            self._connections[websocket] = set(topics)
            logger.debug("WS subscribe %s → topics: %s", id(websocket), topics)

    def get_topics(self, websocket: WebSocket) -> set[str]:
        return self._connections.get(websocket, set())


    async def broadcast_to_topic(self, topic: str, message: dict) -> None:
        """
        Rozsyła wiadomość do wszystkich gniazd, które subskrybują dany topik.
        Gniazda z topik "admin" dostają WSZYSTKIE wiadomości.

        Algorytm:
            target_topics = {"admin", topic}
            wyślij do każdego gniazda, którego topics ∩ target_topics ≠ ∅
        """
        target = {"admin", topic}
        disconnected: list[WebSocket] = []

        for ws, subscribed in list(self._connections.items()):
            if subscribed & target:
                try:
                    await ws.send_json(message)
                except Exception:
                    disconnected.append(ws)

        for ws in disconnected:
            self.disconnect(ws)

    async def send_personal(self, websocket: WebSocket, message: dict) -> None:
        """Wysyła wiadomość tylko do jednego gniazda (np. ACK po subskrypcji)."""
        try:
            await websocket.send_json(message)
        except Exception:
            self.disconnect(websocket)


manager = ConnectionManager()


async def redis_pubsub_listener(redis_client) -> None:
    """
    Nasłuchuje na kanale Redis REDIS_CHANNEL i przekazuje każdą wiadomość
    do ConnectionManager.broadcast_to_topic().

    Format wiadomości na kanale Redis (JSON string):
        {
            "topic": "location:1",   ← wymagany
            "type": "ticket.created",
            "payload": { ... }
        }

    Wywołać jako asyncio task po starcie FastAPI:
        asyncio.create_task(redis_pubsub_listener(redis_client))
    """
    pubsub = redis_client.pubsub()
    await pubsub.subscribe(REDIS_CHANNEL)
    logger.info("Redis pubsub: nasłuchuję na kanale '%s'", REDIS_CHANNEL)

    try:
        async for raw in pubsub.listen():
            if raw["type"] != "message":
                continue
            try:
                data = json.loads(raw["data"])
            except (json.JSONDecodeError, TypeError):
                logger.warning("Redis: nieprawidłowy JSON na kanale %s: %r", REDIS_CHANNEL, raw["data"])
                continue

            topic = data.get("topic")
            if not topic:
                logger.warning("Redis: brak pola 'topic' w wiadomości: %s", data)
                continue

            await manager.broadcast_to_topic(topic, data)
    except asyncio.CancelledError:
        logger.info("Redis pubsub listener zatrzymany.")
    finally:
        await pubsub.unsubscribe(REDIS_CHANNEL)
        await pubsub.aclose()


async def publish_event(redis_client, topic: str, event_type: str, payload: dict) -> None:
    """
    Publikuje event na kanał Redis. Wywołuj z endpointów REST po każdej mutacji
    (CRUD tabletów, lokalizacji, zmiany statusu biletu itp.).

    Przykład użycia (w endpoincie FastAPI):
        await publish_event(
            request.app.state.redis,
            topic="location:1",
            event_type="ticket.created",
            payload={"ticket": {...}},
        )

    Wiadomość trafi do ConnectionManager i zostanie rozesłana do:
        - wszystkich subskrybentów "admin"
        - subskrybentów "location:1"
    """
    message = {
        "topic": topic,
        "type": event_type,
        **payload,
    }
    await redis_client.publish(REDIS_CHANNEL, json.dumps(message, default=str))
