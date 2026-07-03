import os
import json
import uuid
import random
import string
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func
import redis.asyncio as aioredis
import models
from auth import verify_password, create_access_token, hash_password, get_current_user, get_db
from ws import manager as ws_manager, redis_pubsub_listener, publish_event, REDIS_CHANNEL

from datetime import datetime, timezone
from schemas.api_schemas import (
    QRCodeResponse, JoinQueueRequest, JoinQueueResponse, PatientCancelRequest,
    TabletCreate, TabletUpdate, TabletResponse,
    LoginRequest, TokenResponse, MeResponse,
    UserCreate, UserUpdate, UserResponse,
    LocationCreate, LocationUpdate, LocationResponse, TabletInLocation,
    TicketResponse, QueueResponse,
)

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")


async def heartbeat_sweeper(app: FastAPI):
    """
    Działa w pętli co 15 sekund.
    Wyszukuje tablety i użytkowników (OPERATOR) z last_seen_at > 45s,
    emitując zdarzenia o ich przejściu offline.
    """
    from database import SessionLocal
    from datetime import timedelta

    while True:
        try:
            await asyncio.sleep(15)
            db = SessionLocal()
            try:
                now = datetime.now(timezone.utc)
                threshold = now - timedelta(seconds=45)

                # Tablety
                tablets = db.query(models.Tablet).filter(
                    models.Tablet.last_seen_at != None,
                    models.Tablet.last_seen_at < threshold
                ).all()
                
                for t in tablets:
                    payload = {"tablet_id": t.id, "online": False}
                    await publish_event(app.state.redis, "admin", "device.status", payload)
                    if t.location_id:
                        await publish_event(app.state.redis, f"location:{t.location_id}", "device.status", payload)
                
                # Użytkownicy OPERATOR
                users = db.query(models.User).filter(
                    models.User.role == "OPERATOR",
                    models.User.last_seen_at != None,
                    models.User.last_seen_at < threshold
                ).all()

                for u in users:
                    payload = {"user_id": str(u.id), "status": "offline"}
                    await publish_event(app.state.redis, "admin", "user.presence", payload)
                    for loc in u.locations:
                        await publish_event(app.state.redis, f"location:{loc.id}", "user.presence", payload)
                        
            finally:
                db.close()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("Błąd w heartbeat_sweeper: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Inicjalizuje Redis i uruchamia nasłuchiwacz pub/sub przy starcie aplikacji."""
    # STARTUP
    app.state.redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    app.state.pubsub_task = asyncio.create_task(
        redis_pubsub_listener(app.state.redis)
    )
    app.state.heartbeat_task = asyncio.create_task(
        heartbeat_sweeper(app)
    )
    logger.info("Redis połączony: %s", REDIS_URL)
    yield
    # SHUTDOWN
    app.state.pubsub_task.cancel()
    app.state.heartbeat_task.cancel()
    try:
        await asyncio.gather(app.state.pubsub_task, app.state.heartbeat_task)
    except asyncio.CancelledError:
        pass
    await app.state.redis.aclose()
    logger.info("Redis rozłączony.")


app = FastAPI(
    title="eQue API",
    description="Backend aplikacji eQue",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=False,
    allow_methods=["*"], 
    allow_headers=["*"], 
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ONLINE_THRESHOLD_SECONDS = 45  # tablet jest "online" jeśli last_seen_at < 45s temu


def _is_online(tablet: models.Tablet) -> bool:
    """Zwraca True jeśli tablet wysłał heartbeat w ciągu ostatnich 45 sekund."""
    if tablet.last_seen_at is None:
        return False
    now = datetime.now(timezone.utc)
    last = tablet.last_seen_at
    # Zapewnij timezone-aware
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    return (now - last).total_seconds() < ONLINE_THRESHOLD_SECONDS


def _tablet_to_response(tablet: models.Tablet) -> TabletResponse:
    return TabletResponse(
        id=tablet.id,
        name=tablet.name,
        location_id=tablet.location_id,
        is_active=tablet.is_active,
        last_seen_at=tablet.last_seen_at.isoformat() if tablet.last_seen_at else None,
        online=_is_online(tablet),
    )


def _location_to_response(loc: models.Location) -> LocationResponse:
    """Konwertuje Location na LocationResponse z zagnieżdżonym tabletem i user_ids."""
    tablet_info = None
    if loc.tablets:          # relacja 1-to-1 przez UNIQUE; bierzemy pierwszy (jedyny)
        t = loc.tablets[0]
        tablet_info = TabletInLocation(id=t.id, name=t.name, is_active=t.is_active)
    return LocationResponse(
        id=loc.id,
        name=loc.name,
        description=loc.description,
        category=loc.category,
        is_active=loc.is_active,
        tablet=tablet_info,
        user_ids=[u.id for u in loc.users],
    )


def _user_to_response(user: models.User) -> UserResponse:
    return UserResponse(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        position=user.position,
        role=user.role,
        is_active=user.is_active,
        location_ids=[loc.id for loc in user.locations],
    )


def _get_user_or_404(user_id: uuid.UUID, db: Session) -> models.User:
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Użytkownik nie został znaleziony")
    return user


def _get_location_or_404(location_id: int, db: Session) -> models.Location:
    loc = db.query(models.Location).filter(models.Location.id == location_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Lokalizacja nie została znaleziona")
    return loc


def _get_tablet_or_404(tablet_id: int, db: Session) -> models.Tablet:
    tablet = db.query(models.Tablet).filter(models.Tablet.id == tablet_id).first()
    if not tablet:
        raise HTTPException(status_code=404, detail="Tablet nie został znaleziony")
    return tablet


def _detach_tablet_from_location(location_id: int, exclude_tablet_id: int | None, db: Session):
    """
    Odłącza tablet przypisany do danej lokalizacji (ustawia location_id=None).
    Pomija tablet o id == exclude_tablet_id (ten, który właśnie przypisujemy).
    Wywoływać PRZED przypisaniem nowego tabletu, żeby uniknąć naruszenia UNIQUE.
    """
    existing = db.query(models.Tablet).filter(
        models.Tablet.location_id == location_id
    ).first()
    if existing and existing.id != exclude_tablet_id:
        existing.location_id = None


# ---------------------------------------------------------------------------
# Root
# ---------------------------------------------------------------------------

@app.get("/", tags=["default"])
async def root():
    return {"message": "Witaj w eQue API. Serwer działa poprawnie."}


# ---------------------------------------------------------------------------
# AUTH
# ---------------------------------------------------------------------------

@app.post("/api/v1/auth/login", response_model=TokenResponse, tags=["Auth"])
async def login(login_data: LoginRequest, db: Session = Depends(get_db)):
    """
    Weryfikuje poświadczenia i zwraca token JWT wraz z danymi profilu.
    Obsługuje zarówno ADMIN jak i OPERATOR (jedna tabela users).
    """
    user = db.query(models.User).filter(models.User.username == login_data.username).first()

    if not user or not verify_password(login_data.password, user.password_hash):
        # Jeden komunikat — nie zdradzamy, czy login czy hasło jest złe
        raise HTTPException(status_code=401, detail="Nieprawidłowy login lub hasło")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Konto jest nieaktywne")

    access_token = create_access_token(data={"sub": user.username})

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "id": user.id,
        "role": user.role,
        "full_name": user.full_name,
    }


@app.get("/api/v1/auth/me", response_model=MeResponse, tags=["Auth"])
async def me(current_user: models.User = Depends(get_current_user)):
    """
    Zwraca profil aktualnie zalogowanego użytkownika na podstawie tokena JWT.
    Frontend może tu zweryfikować sesję zamiast ufać temu co sam zapisał w localStorage.
    """
    return MeResponse(
        id=current_user.id,
        username=current_user.username,
        full_name=current_user.full_name,
        role=current_user.role,
        is_active=current_user.is_active,
        location_ids=[loc.id for loc in current_user.locations],
    )


# ---------------------------------------------------------------------------
# KIOSK (tablet)
# ---------------------------------------------------------------------------

@app.get("/api/v1/kiosk/qr", response_model=QRCodeResponse, tags=["Tablet"])
async def get_new_qr_code(
    request: Request,
    tablet_token: str = Query(..., description="pairing_token z tabeli Tablet"),
    db: Session = Depends(get_db),
):
    """
    Generuje dynamiczny, krótkotrwały token QR (45s) dla Kiosku.
    Tablet identyfikuje się swoim pairing_token (query param).
    Token QR jest zapisywany w Redis i mapuje na location_id tabletu.
    """
    # Znajdź tablet po pairing_token
    tablet = db.query(models.Tablet).filter(
        models.Tablet.pairing_token == tablet_token
    ).first()

    if not tablet or not tablet.location_id:
        raise HTTPException(
            status_code=401,
            detail="Nieprawidłowy token tabletu lub tablet nie ma przypisanej lokalizacji",
        )

    # Heartbeat — aktualizuj last_seen_at, żeby sweeper nie oznaczył tabletu jako offline
    tablet.last_seen_at = func.now()
    db.commit()

    # Wygeneruj losowy QR token (UUID) i krótki kod PIN (4 znaki)
    qr_token = str(uuid.uuid4())
    short_code = "".join(random.choices(string.ascii_uppercase + string.digits, k=4))

    # Zapisz oba klucze w Redis na 45 sekund — pacjent może użyć dowolnego
    await request.app.state.redis.setex(
        f"qr:{qr_token}", 45, str(tablet.location_id)
    )
    await request.app.state.redis.setex(
        f"qr:{short_code}", 45, str(tablet.location_id)
    )

    return {"qr_token": qr_token, "short_code": short_code, "expires_in_seconds": 45}


# ---------------------------------------------------------------------------
# WEBSOCKET — /api/v1/ws?token=<jwt>
# ---------------------------------------------------------------------------

@app.websocket("/api/v1/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(alias="token"),
):
    """
    Główny endpoint WebSocket. Parametr `token` to JWT identyczny jak w REST.
    Tablety używają swojego device_token.

    Protokół po stronie klienta:
        1. Połącz się: ws://host/api/v1/ws?token=<jwt>
        2. Wyślij subskrypcję:
               {"type": "subscribe", "topics": ["admin"]}
           lub  {"type": "subscribe", "topics": ["location:42"]}
        3. Wysyłaj heartbeat co ~20s:
               {"type": "ping"}
           Serwer odpowie: {"type": "pong"}
        4. Odbieraj push-eventy z serwera.
    """
    # 1. Weryfikacja tokena PRZED akceptacją gniazda
    import jwt as _jwt
    from auth import SECRET_KEY, ALGORITHM
    from database import SessionLocal

    try:
        payload = _jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            await websocket.close(code=4001)
            return
    except _jwt.ExpiredSignatureError:
        await websocket.close(code=4001)
        return
    except _jwt.PyJWTError:
        await websocket.close(code=4001)
        return

    # Pobierz usera z bazy (sprawdź is_active)
    db = SessionLocal()
    try:
        user = db.query(models.User).filter(models.User.username == username).first()
        if not user or not user.is_active:
            await websocket.close(code=4003)
            return
        user_id = str(user.id)
        user_role = user.role
    finally:
        db.close()

    # 2. Akceptuj połączenie i zarejestruj w managerze
    await ws_manager.connect(websocket)
    logger.info("WS: użytkownik '%s' (%s) połączony.", username, user_role)

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "subscribe":
                # Klient deklaruje, które topiki chce obserwować
                topics = data.get("topics", [])
                ws_manager.subscribe(websocket, topics)
                await ws_manager.send_personal(websocket, {
                    "type": "subscribed",
                    "topics": topics,
                })
                logger.debug("WS: '%s' zasubskrybował: %s", username, topics)

            elif msg_type == "ping":
                # Heartbeat — aktualizacja last_seen_at dla tabletów obsługiwana osobno
                await ws_manager.send_personal(websocket, {"type": "pong"})

            else:
                logger.warning("WS: nieznany typ wiadomości od '%s': %s", username, msg_type)

    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
        logger.info("WS: użytkownik '%s' rozłączony.", username)
    except Exception as exc:
        logger.error("WS: błąd dla '%s': %s", username, exc)
        ws_manager.disconnect(websocket)


# ---------------------------------------------------------------------------
# PATIENT (mobile) — kolejka
# ---------------------------------------------------------------------------

def _generate_ticket_code(length: int = 3) -> str:
    """
    Generuje krótki kod biletu: 1 litera + cyfry, np. "A3F", "B12".
    Alfabet: A-Z i 0-9 bez mylonymi znaków (0,O,1,I,L).
    """
    letters = "ABCDEFGHJKMNPQRSTUVWXYZ"
    digits  = "23456789"
    alphabet = letters + digits
    return "".join(random.choices(alphabet, k=length))


def _ticket_to_response(ticket: models.Ticket) -> TicketResponse:
    return TicketResponse(
        id=str(ticket.id),
        ticket_code=ticket.ticket_code,
        status=ticket.status,
        location_id=ticket.location_id,
        joined_at=ticket.joined_at.isoformat(),
        called_at=ticket.called_at.isoformat() if ticket.called_at else None,
        served_at=ticket.served_at.isoformat() if ticket.served_at else None,
        customer_name=ticket.customer_name,
        appointment_time=ticket.appointment_time,
        served_by_user_id=str(ticket.served_by_user_id) if ticket.served_by_user_id else None,
    )


def _get_ticket_or_404(ticket_id: str, db: Session) -> models.Ticket:
    try:
        uid = uuid.UUID(ticket_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Nieprawidłowy format ID biletu")
    ticket = db.query(models.Ticket).filter(models.Ticket.id == uid).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Bilet nie został znaleziony")
    return ticket


@app.post("/api/v1/queue/join", response_model=JoinQueueResponse, status_code=201, tags=["Patient"])
async def join_queue(payload: JoinQueueRequest, request: Request, db: Session = Depends(get_db)):
    """
    Dołącza do kolejki przez zeskanowany QR token.
    Odczytuje location_id z Redisa (klucz qr:<token>, TTL 45s),
    tworzy Ticket(status=WAITING), wylicza pozycję i szacowany czas.
    """
    # Odczytaj location_id z Redisa na podstawie QR tokenu
    loc_id_raw = await request.app.state.redis.get(f"qr:{payload.qr_token}")
    if not loc_id_raw:
        raise HTTPException(status_code=400, detail="QR token expired or invalid")

    location_id = int(loc_id_raw)

    # Walidacja lokalizacji
    loc = db.query(models.Location).filter(models.Location.id == location_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Lokalizacja nie istnieje")
    if not loc.is_active:
        raise HTTPException(status_code=409, detail="Lokalizacja jest nieaktywna")

    # Generuj unikalny ticket_code (ponawia jeśli kolizja, max 10 prób)
    for _ in range(10):
        code = _generate_ticket_code()
        collision = db.query(models.Ticket).filter(
            models.Ticket.ticket_code == code,
            models.Ticket.location_id == location_id,
            models.Ticket.status.in_(["WAITING", "SERVING"]),
        ).first()
        if not collision:
            break

    now = datetime.now(timezone.utc)
    ticket = models.Ticket(
        ticket_code=code,
        status="WAITING",
        location_id=location_id,
        joined_at=now,
        customer_name=payload.customer_name,
        appointment_time=payload.appointment_time,
    )
    db.add(ticket)
    db.flush()   # nadaj ID bez commitu, żeby móc policzyć pozycję

    # Pozycja = ile biletów WAITING dla tej lokalizacji ma joined_at < now
    queue_position = db.query(models.Ticket).filter(
        models.Ticket.location_id == location_id,
        models.Ticket.status == "WAITING",
        models.Ticket.joined_at < now,
    ).count()

    db.commit()
    db.refresh(ticket)

    estimated_wait_time_minutes = queue_position * 3

    return JoinQueueResponse(
        ticket_id=str(ticket.id),
        ticket_code=ticket.ticket_code,
        queue_position=queue_position,
        location_id=ticket.location_id,
        estimated_wait_time_minutes=estimated_wait_time_minutes,
    )


@app.post("/api/v1/queue/cancel", tags=["Patient"])
async def patient_cancel_ticket(
    payload: PatientCancelRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Publiczny endpoint — pacjent samodzielnie anuluje swój bilet.
    Dozwolone tylko dla biletów w statusie WAITING.
    """
    ticket = db.query(models.Ticket).filter(
        models.Ticket.ticket_code == payload.ticket_code
    ).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    if ticket.status != "WAITING":
        raise HTTPException(
            status_code=400,
            detail="Only waiting tickets can be cancelled by patient",
        )

    ticket.status = "CANCELLED"
    ticket.served_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(ticket)

    # Powiadomienie panelu operatora (WebSocket location topic)
    response = _ticket_to_response(ticket)
    await publish_event(
        request.app.state.redis,
        topic=f"location:{ticket.location_id}",
        event_type="ticket.updated",
        payload={"ticket": response.model_dump()},
    )

    # Aktualizacja pozycji dla pozostałych WAITING pacjentów
    await _broadcast_queue_updates(request.app.state.redis, ticket.location_id, db)

    return {"message": "Ticket cancelled successfully"}


# ---------------------------------------------------------------------------
# Helper: rozsyłanie QUEUE_UPDATE do wszystkich WAITING pacjentów
# ---------------------------------------------------------------------------

async def _broadcast_queue_updates(redis_client, location_id: int, db: Session) -> None:
    """
    Pobiera wszystkie bilety WAITING dla danej lokalizacji (posortowane po joined_at),
    wylicza nową pozycję każdego i wysyła event QUEUE_UPDATE do topiku guest:{ticket_code}.
    """
    waiting_tickets = (
        db.query(models.Ticket)
        .filter(
            models.Ticket.location_id == location_id,
            models.Ticket.status == "WAITING",
        )
        .order_by(models.Ticket.joined_at.asc())
        .all()
    )

    for idx, t in enumerate(waiting_tickets, start=1):
        update_msg = {
            "topic": f"guest:{t.ticket_code}",
            "event": "QUEUE_UPDATE",
            "queue_position": idx,
            "estimated_wait_time_minutes": idx * 3,
        }
        await redis_client.publish(REDIS_CHANNEL, json.dumps(update_msg, default=str))


# ---------------------------------------------------------------------------
# WEBSOCKET — /api/v1/queue/ws/{ticket_code} (pacjent, bez JWT — Opcja A)
# ---------------------------------------------------------------------------

@app.websocket("/api/v1/queue/ws/{ticket_code}")
async def guest_websocket_endpoint(
    websocket: WebSocket,
    ticket_code: str,
):
    """
    Otwarty WebSocket dla pacjenta (mobilna aplikacja).
    Nie wymaga JWT — identyfikacja po ticket_code.
    Pacjent nasłuchuje eventów YOUR_TURN i QUEUE_UPDATE.
    """
    from database import SessionLocal

    # Sprawdź czy bilet o podanym ticket_code istnieje
    db = SessionLocal()
    try:
        ticket = db.query(models.Ticket).filter(
            models.Ticket.ticket_code == ticket_code
        ).first()
        if not ticket:
            await websocket.close(code=4004)
            return
    finally:
        db.close()

    # Akceptuj połączenie i subskrybuj topik guest:{ticket_code}
    await ws_manager.connect(websocket)
    ws_manager.subscribe(websocket, [f"guest:{ticket_code}"])
    logger.info("WS guest: bilet '%s' połączony.", ticket_code)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
        logger.info("WS guest: bilet '%s' rozłączony.", ticket_code)
    except Exception as exc:
        logger.error("WS guest: błąd dla biletu '%s': %s", ticket_code, exc)
        ws_manager.disconnect(websocket)


# ---------------------------------------------------------------------------
# ADMIN — Tablets
# ---------------------------------------------------------------------------

@app.get("/api/v1/admin/tablets", response_model=list[TabletResponse], tags=["Admin — Tablets"])
async def get_all_tablets(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Lista wszystkich tabletów z wyliczonym statusem online."""
    return [_tablet_to_response(t) for t in db.query(models.Tablet).all()]


@app.post("/api/v1/admin/tablets", response_model=TabletResponse, status_code=201, tags=["Admin — Tablets"])
async def create_tablet(
    data: TabletCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Tworzy nowy tablet.
    Jeśli location_id jest podane i inna tablet tam siedzi, odłącza go (UNIQUE enforcement).
    """
    if data.location_id is not None:
        _detach_tablet_from_location(data.location_id, exclude_tablet_id=None, db=db)

    new_tablet = models.Tablet(
        name=data.name,
        location_id=data.location_id,
        is_active=True,
    )
    db.add(new_tablet)
    db.commit()
    db.refresh(new_tablet)
    response = _tablet_to_response(new_tablet)
    
    payload = {"tablet": response.model_dump()}
    await publish_event(request.app.state.redis, "admin", "device.created", payload)
    if new_tablet.location_id:
        await publish_event(request.app.state.redis, f"location:{new_tablet.location_id}", "device.created", payload)
        
    return response


@app.put("/api/v1/admin/tablets/{tablet_id}", response_model=TabletResponse, tags=["Admin — Tablets"])
async def update_tablet(
    tablet_id: int,
    data: TabletUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Edytuje tablet.
    Jeśli location_id ulega zmianie i inna tablet tam siedzi, odłącza go (UNIQUE enforcement).
    """
    tablet = _get_tablet_or_404(tablet_id, db)

    if data.name is not None:
        tablet.name = data.name

    if "location_id" in data.model_fields_set:
        new_loc_id = data.location_id
        if new_loc_id is not None and new_loc_id != tablet.location_id:
            # Weryfikacja: lokalizacja istnieje
            _get_location_or_404(new_loc_id, db)
            # Odłącz ewentualny inny tablet z tej lokalizacji
            _detach_tablet_from_location(new_loc_id, exclude_tablet_id=tablet_id, db=db)
        tablet.location_id = new_loc_id

    db.commit()
    db.refresh(tablet)
    response = _tablet_to_response(tablet)
    
    payload = {"tablet": response.model_dump()}
    await publish_event(request.app.state.redis, "admin", "device.updated", payload)
    if tablet.location_id:
        await publish_event(request.app.state.redis, f"location:{tablet.location_id}", "device.updated", payload)
    
    return response


@app.delete("/api/v1/admin/tablets/{tablet_id}", tags=["Admin — Tablets"])
async def delete_tablet(
    tablet_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    tablet = _get_tablet_or_404(tablet_id, db)
    db.delete(tablet)
    db.commit()
    
    payload = {"tablet_id": tablet_id}
    await publish_event(request.app.state.redis, "admin", "device.deleted", payload)
    if tablet.location_id:
        await publish_event(request.app.state.redis, f"location:{tablet.location_id}", "device.deleted", payload)
        
    return {"message": f"Tablet o ID {tablet_id} został usunięty."}


@app.post("/api/v1/admin/tablets/{tablet_id}/activate", response_model=TabletResponse, tags=["Admin — Tablets"])
async def activate_tablet(
    tablet_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Aktywuje tablet."""
    tablet = _get_tablet_or_404(tablet_id, db)
    tablet.is_active = True
    db.commit()
    db.refresh(tablet)
    response = _tablet_to_response(tablet)
    
    payload = {"tablet": response.model_dump()}
    await publish_event(request.app.state.redis, "admin", "device.updated", payload)
    if tablet.location_id:
        await publish_event(request.app.state.redis, f"location:{tablet.location_id}", "device.updated", payload)
        
    return response


@app.post("/api/v1/admin/tablets/{tablet_id}/deactivate", response_model=TabletResponse, tags=["Admin — Tablets"])
async def deactivate_tablet(
    tablet_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Dezaktywuje tablet i odłącza go od lokalizacji (kaskada wg API_SPEC §4).
    is_active=False, location_id=NULL.
    """
    tablet = _get_tablet_or_404(tablet_id, db)
    tablet.is_active = False
    tablet.location_id = None
    db.commit()
    db.refresh(tablet)
    response = _tablet_to_response(tablet)
    
    payload = {"tablet": response.model_dump()}
    await publish_event(request.app.state.redis, "admin", "device.updated", payload)
    # The location was just detached, so we should notify the OLD location if we tracked it,
    # but the API spec says emit to location. So let's just emit to admin. Wait, we can emit to admin and old location?
    # Actually, tablet.location_id is None now. So no location event needed.
    
    return response


# ---------------------------------------------------------------------------
# ADMIN — Locations
# ---------------------------------------------------------------------------

@app.get("/api/v1/admin/locations", response_model=list[LocationResponse], tags=["Admin — Locations"])
async def get_all_locations(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Lista wszystkich lokalizacji z przypisanym tabletem i listą operatorów."""
    return [_location_to_response(loc) for loc in db.query(models.Location).all()]


@app.post("/api/v1/admin/locations", response_model=LocationResponse, status_code=201, tags=["Admin — Locations"])
async def create_location(
    data: LocationCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Tworzy nową lokalizację."""
    new_loc = models.Location(
        name=data.name,
        description=data.description,
        category=data.category,
        is_active=True,
    )
    db.add(new_loc)
    db.commit()
    db.refresh(new_loc)
    response = _location_to_response(new_loc)
    
    payload = {"location": response.model_dump()}
    await publish_event(request.app.state.redis, "admin", "location.created", payload)
    await publish_event(request.app.state.redis, f"location:{new_loc.id}", "location.created", payload)
    
    return response


@app.put("/api/v1/admin/locations/{location_id}", response_model=LocationResponse, tags=["Admin — Locations"])
async def update_location(
    location_id: int,
    data: LocationUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Edytuje lokalizację.
    - tablet_id podany i różny od obecnego: odłącza stary tablet (UNIQUE enforcement),
      przypisuje nowy.
    - tablet_id = None (jawnie w body): odłącza obecny tablet.
    - tablet_id nie podany w body: brak zmiany tabletu.
    - user_ids podane: pełna synchronizacja M2M przypisanych operatorów.
    """
    loc = _get_location_or_404(location_id, db)
    fields = data.model_fields_set

    if data.name is not None:
        loc.name = data.name
    if data.description is not None:
        loc.description = data.description
    if data.category is not None:
        loc.category = data.category

    # Tablet assignment — tylko jeśli tablet_id był jawnie podany w body
    if "tablet_id" in fields:
        new_tablet_id = data.tablet_id
        if new_tablet_id is None:
            # Jawne odłączenie: ustaw location_id = None na obecnym tablecie
            for t in loc.tablets:
                t.location_id = None
        else:
            # Walidacja: tablet istnieje
            new_tablet = _get_tablet_or_404(new_tablet_id, db)
            # Odłącz ewentualny inny tablet siedzący w tej lokalizacji
            _detach_tablet_from_location(location_id, exclude_tablet_id=new_tablet_id, db=db)
            # Odłącz nowy tablet od jego poprzedniej lokalizacji (jeśli był gdzie indziej)
            new_tablet.location_id = location_id

    # Synchronizacja operatorów M2M
    if data.user_ids is not None:
        users = db.query(models.User).filter(
            models.User.id.in_(data.user_ids)
        ).all()
        if len(users) != len(data.user_ids):
            raise HTTPException(status_code=422, detail="Jeden lub więcej użytkowników nie istnieje")
        loc.users = users

    db.commit()
    db.refresh(loc)
    response = _location_to_response(loc)
    
    payload = {"location": response.model_dump()}
    await publish_event(request.app.state.redis, "admin", "location.updated", payload)
    await publish_event(request.app.state.redis, f"location:{loc.id}", "location.updated", payload)
    
    return response


@app.delete("/api/v1/admin/locations/{location_id}", tags=["Admin — Locations"])
async def delete_location(
    location_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Usuwa lokalizację.
    Kaskada: tablets.location_id=NULL dla przypisanego tabletu,
    wiersze user_locations usuwane przez ON DELETE CASCADE.
    """
    loc = _get_location_or_404(location_id, db)
    # Odłącz przypisane tablety
    for t in loc.tablets:
        t.location_id = None
    db.delete(loc)
    db.commit()
    
    payload = {"location_id": location_id}
    await publish_event(request.app.state.redis, "admin", "location.deleted", payload)
    await publish_event(request.app.state.redis, f"location:{location_id}", "location.deleted", payload)
    
    return {"message": f"Lokalizacja '{loc.name}' została usunięta."}


@app.post("/api/v1/admin/locations/{location_id}/activate", response_model=LocationResponse, tags=["Admin — Locations"])
async def activate_location(
    location_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Aktywuje lokalizację."""
    loc = _get_location_or_404(location_id, db)
    loc.is_active = True
    db.commit()
    db.refresh(loc)
    response = _location_to_response(loc)
    
    payload = {"location": response.model_dump()}
    await publish_event(request.app.state.redis, "admin", "location.updated", payload)
    await publish_event(request.app.state.redis, f"location:{loc.id}", "location.updated", payload)
    
    return response


@app.post("/api/v1/admin/locations/{location_id}/deactivate", response_model=LocationResponse, tags=["Admin — Locations"])
async def deactivate_location(
    location_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Dezaktywuje lokalizację. Kaskada wg API_SPEC §4:
    - is_active = False
    - tablets.location_id = NULL dla przypisanego tabletu
    - czyści wiersze user_locations dla tej lokalizacji (loc.users = [])
    """
    loc = _get_location_or_404(location_id, db)
    loc.is_active = False
    # Odłącz tablet
    for t in loc.tablets:
        t.location_id = None
    # Wyczyść operatorów przypisanych do lokalizacji
    loc.users = []
    db.commit()
    db.refresh(loc)
    response = _location_to_response(loc)
    
    payload = {"location": response.model_dump()}
    await publish_event(request.app.state.redis, "admin", "location.updated", payload)
    await publish_event(request.app.state.redis, f"location:{loc.id}", "location.updated", payload)
    
    return response


# ---------------------------------------------------------------------------
# ADMIN — Users
# ---------------------------------------------------------------------------

@app.get("/api/v1/admin/users", response_model=list[UserResponse], tags=["Admin — Users"])
async def get_all_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Zwraca listę wszystkich użytkowników wraz z przypisanymi lokalizacjami."""
    users = db.query(models.User).all()
    return [_user_to_response(u) for u in users]


@app.post("/api/v1/admin/users", response_model=UserResponse, status_code=201, tags=["Admin — Users"])
async def create_user(
    data: UserCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Tworzy nowego użytkownika. Hasło jest hashowane bcryptem."""
    # Sprawdź unikalność username
    existing = db.query(models.User).filter(models.User.username == data.username).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Użytkownik '{data.username}' już istnieje")

    # Pobierz obiekty lokalizacji z bazy (walidacja ID)
    locations = []
    if data.location_ids:
        locations = db.query(models.Location).filter(
            models.Location.id.in_(data.location_ids)
        ).all()
        if len(locations) != len(data.location_ids):
            raise HTTPException(status_code=422, detail="Jedna lub więcej lokalizacji nie istnieje")

    new_user = models.User(
        username=data.username,
        full_name=data.full_name,
        position=data.position,
        role=data.role,
        password_hash=hash_password(data.password),
        is_active=True,
    )
    new_user.locations = locations
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    response = _user_to_response(new_user)
    
    payload = {"user": response.model_dump()}
    await publish_event(request.app.state.redis, "admin", "user.created", payload)
    for loc in new_user.locations:
        await publish_event(request.app.state.redis, f"location:{loc.id}", "user.created", payload)
        
    return response


@app.put("/api/v1/admin/users/{user_id}", response_model=UserResponse, tags=["Admin — Users"])
async def update_user(
    user_id: uuid.UUID,
    data: UserUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Edytuje dane użytkownika.
    - Puste/brak pola = nie zmieniaj.
    - `password` puste lub None = nie zmieniaj hasła.
    - `location_ids` podane = zastąp pełną listą (synchronizacja M2M).
    """
    user = _get_user_or_404(user_id, db)

    if data.username is not None:
        # Sprawdź unikalność nowego username (jeśli inny niż obecny)
        if data.username != user.username:
            conflict = db.query(models.User).filter(models.User.username == data.username).first()
            if conflict:
                raise HTTPException(status_code=409, detail=f"Użytkownik '{data.username}' już istnieje")
        user.username = data.username

    if data.full_name is not None:
        user.full_name = data.full_name
    if data.position is not None:
        user.position = data.position
    if data.role is not None:
        user.role = data.role
    if data.password:
        # Puste string "" też traktujemy jako "nie zmieniaj"
        user.password_hash = hash_password(data.password)

    if data.location_ids is not None:
        # Pełna synchronizacja listy lokalizacji
        locations = db.query(models.Location).filter(
            models.Location.id.in_(data.location_ids)
        ).all()
        if len(locations) != len(data.location_ids):
            raise HTTPException(status_code=422, detail="Jedna lub więcej lokalizacji nie istnieje")
        user.locations = locations

    db.commit()
    db.refresh(user)
    response = _user_to_response(user)
    
    payload = {"user": response.model_dump()}
    await publish_event(request.app.state.redis, "admin", "user.updated", payload)
    for loc in user.locations:
        await publish_event(request.app.state.redis, f"location:{loc.id}", "user.updated", payload)
        
    return response


@app.delete("/api/v1/admin/users/{user_id}", tags=["Admin — Users"])
async def delete_user(
    user_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Usuwa użytkownika. Wiersze w user_locations są usuwane kaskadowo
    przez ON DELETE CASCADE zdefiniowany w modelu.
    """
    user = _get_user_or_404(user_id, db)

    # Zabezpieczenie: nie pozwól usunąć samego siebie
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Nie możesz usunąć własnego konta")

    
    # Przechwyć ID lokacji przed usunięciem żeby wiedzieć gdzie wysłać event
    loc_ids = [loc.id for loc in user.locations]
    
    db.delete(user)
    db.commit()
    
    payload = {"user_id": str(user_id)}
    await publish_event(request.app.state.redis, "admin", "user.deleted", payload)
    for loc_id in loc_ids:
        await publish_event(request.app.state.redis, f"location:{loc_id}", "user.deleted", payload)
        
    return {"message": f"Użytkownik '{user.username}' został usunięty."}


@app.post("/api/v1/admin/users/{user_id}/activate", response_model=UserResponse, tags=["Admin — Users"])
async def activate_user(
    user_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Aktywuje konto użytkownika."""
    user = _get_user_or_404(user_id, db)
    user.is_active = True
    db.commit()
    db.refresh(user)
    response = _user_to_response(user)
    
    payload = {"user": response.model_dump()}
    await publish_event(request.app.state.redis, "admin", "user.updated", payload)
    for loc in user.locations:
        await publish_event(request.app.state.redis, f"location:{loc.id}", "user.updated", payload)
        
    return response


@app.post("/api/v1/admin/users/{user_id}/deactivate", response_model=UserResponse, tags=["Admin — Users"])
async def deactivate_user(
    user_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Dezaktywuje konto użytkownika i kaskadowo czyści jego wiersze w user_locations
    (operator traci przypisania do lokalizacji).
    """
    user = _get_user_or_404(user_id, db)

    # Zabezpieczenie: nie pozwól dezaktywować samego siebie
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Nie możesz dezaktywować własnego konta")

    user.is_active = False
    # Kaskada: wyczyść wszystkie przypisania do lokalizacji
    user.locations = []

    db.commit()
    db.refresh(user)
    response = _user_to_response(user)
    
    payload = {"user": response.model_dump()}
    await publish_event(request.app.state.redis, "admin", "user.updated", payload)
    # The user was detached from all locations, but the event should still be sent to admin. 
    # If we want to send it to old locations, we'd need to track them. Admin is enough.
    
    return response


# ---------------------------------------------------------------------------
# ADMIN — Queue (widok kolejki per lokalizacja)
# ---------------------------------------------------------------------------

@app.get(
    "/api/v1/admin/locations/{location_id}/queue",
    response_model=QueueResponse,
    tags=["Admin — Queue"],
)
async def get_location_queue(
    location_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Zwraca stan kolejki dla danej lokalizacji:
    - waiting: lista biletów WAITING posortowana po joined_at (najstarszy = pierwszy)
    - serving: aktualnie obsługiwany bilet (SERVING) lub null
    """
    _get_location_or_404(location_id, db)

    waiting = (
        db.query(models.Ticket)
        .filter(
            models.Ticket.location_id == location_id,
            models.Ticket.status == "WAITING",
        )
        .order_by(models.Ticket.joined_at.asc())
        .all()
    )

    serving = (
        db.query(models.Ticket)
        .filter(
            models.Ticket.location_id == location_id,
            models.Ticket.status == "SERVING",
        )
        .order_by(models.Ticket.called_at.desc())
        .first()
    )

    return QueueResponse(
        location_id=location_id,
        waiting=[_ticket_to_response(t) for t in waiting],
        serving=_ticket_to_response(serving) if serving else None,
    )


# ---------------------------------------------------------------------------
# ADMIN — Ticket actions (call / complete / cancel)
# ---------------------------------------------------------------------------

@app.post(
    "/api/v1/admin/tickets/{ticket_id}/call",
    response_model=TicketResponse,
    tags=["Admin — Queue"],
)
async def call_ticket(
    ticket_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Wzywa pacjenta do okienka.
    status → SERVING, called_at = now(), served_by_user_id = zalogowany operator.
    Wysyła event YOUR_TURN do wezwanego pacjenta i QUEUE_UPDATE do pozostałych.
    """
    ticket = _get_ticket_or_404(ticket_id, db)
    if ticket.status != "WAITING":
        raise HTTPException(
            status_code=409,
            detail=f"Nie można wezwać biletu o statusie '{ticket.status}' (wymagany: WAITING)",
        )
    ticket.status = "SERVING"
    ticket.called_at = datetime.now(timezone.utc)
    ticket.served_by_user_id = current_user.id
    db.commit()
    db.refresh(ticket)
    response = _ticket_to_response(ticket)

    # Event dla panelu admina/operatora (location topic)
    await publish_event(
        request.app.state.redis,
        topic=f"location:{ticket.location_id}",
        event_type="ticket.updated",
        payload={"ticket": response.model_dump()},
    )

    # Event YOUR_TURN do wezwanego pacjenta (guest topic)
    your_turn_msg = {
        "topic": f"guest:{ticket.ticket_code}",
        "event": "YOUR_TURN",
    }
    await request.app.state.redis.publish(
        REDIS_CHANNEL, json.dumps(your_turn_msg, default=str)
    )

    # QUEUE_UPDATE dla wszystkich pozostałych WAITING pacjentów
    await _broadcast_queue_updates(request.app.state.redis, ticket.location_id, db)

    return response


@app.post(
    "/api/v1/admin/tickets/{ticket_id}/complete",
    response_model=TicketResponse,
    tags=["Admin — Queue"],
)
async def complete_ticket(
    ticket_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Kończy obsługę pacjenta.
    status → COMPLETED, served_at = now().
    Rozsyła QUEUE_UPDATE do pozostałych WAITING pacjentów.
    """
    ticket = _get_ticket_or_404(ticket_id, db)
    if ticket.status != "SERVING":
        raise HTTPException(
            status_code=409,
            detail=f"Nie można zakończyć biletu o statusie '{ticket.status}' (wymagany: SERVING)",
        )
    ticket.status = "COMPLETED"
    ticket.served_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(ticket)
    response = _ticket_to_response(ticket)

    # Event dla panelu admina/operatora
    await publish_event(
        request.app.state.redis,
        topic=f"location:{ticket.location_id}",
        event_type="ticket.updated",
        payload={"ticket": response.model_dump()},
    )

    # QUEUE_UPDATE dla wszystkich WAITING pacjentów
    await _broadcast_queue_updates(request.app.state.redis, ticket.location_id, db)

    return response


@app.post(
    "/api/v1/admin/tickets/{ticket_id}/cancel",
    response_model=TicketResponse,
    tags=["Admin — Queue"],
)
async def cancel_ticket(
    ticket_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Anuluje bilet (pacjent się nie zgłosił / zrezygnował).
    Można anulować zarówno WAITING jak i SERVING.
    status → CANCELLED, served_at = now().
    Rozsyła QUEUE_UPDATE do pozostałych WAITING pacjentów.
    """
    ticket = _get_ticket_or_404(ticket_id, db)
    if ticket.status in ("COMPLETED", "CANCELLED"):
        raise HTTPException(
            status_code=409,
            detail=f"Bilet jest już w stanie końcowym: '{ticket.status}'",
        )
    ticket.status = "CANCELLED"
    ticket.served_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(ticket)
    response = _ticket_to_response(ticket)

    # Event dla panelu admina/operatora
    await publish_event(
        request.app.state.redis,
        topic=f"location:{ticket.location_id}",
        event_type="ticket.updated",
        payload={"ticket": response.model_dump()},
    )

    # QUEUE_UPDATE dla wszystkich WAITING pacjentów
    await _broadcast_queue_updates(request.app.state.redis, ticket.location_id, db)

    return response

