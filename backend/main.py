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
    KioskStatusResponse, SignupCodeResponse, JoinQueueRequest, JoinQueueResponse, PatientCancelRequest,
    TicketStatusResponse,
    TabletCreate, TabletUpdate, TabletResponse,
    LoginRequest, TokenResponse, MeResponse, ChangePasswordRequest,
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

                tablets = db.query(models.Tablet).filter(
                    models.Tablet.last_seen_at != None,
                    models.Tablet.last_seen_at < threshold
                ).all()

                for t in tablets:
                    payload = {"tablet_id": t.id, "online": False}
                    await publish_event(app.state.redis, "admin", "device.status", payload)
                    if t.location_id:
                        await publish_event(app.state.redis, f"location:{t.location_id}", "device.status", payload)

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
    app.state.redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    app.state.pubsub_task = asyncio.create_task(
        redis_pubsub_listener(app.state.redis)
    )
    app.state.heartbeat_task = asyncio.create_task(
        heartbeat_sweeper(app)
    )
    logger.info("Redis połączony: %s", REDIS_URL)
    yield
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


ONLINE_THRESHOLD_SECONDS = 45


def _is_online(entity: models.Tablet | models.User) -> bool:
    """Zwraca True jeśli tablet/użytkownik wysłał heartbeat w ciągu ostatnich 45 sekund."""
    if entity.last_seen_at is None:
        return False
    now = datetime.now(timezone.utc)
    last = entity.last_seen_at
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
        pairing_token=tablet.pairing_token,
    )


def _location_to_response(loc: models.Location) -> LocationResponse:
    """Konwertuje Location na LocationResponse z zagnieżdżonym tabletem i user_ids."""
    tablet_info = None
    if loc.tablets:
        t = loc.tablets[0]
        tablet_info = TabletInLocation(id=t.id, name=t.name, is_active=t.is_active)
    return LocationResponse(
        id=loc.id,
        name=loc.name,
        description=loc.description,
        category=loc.category,
        is_active=loc.is_active,
        queue_code=loc.queue_code,
        accepting_new_tickets=loc.accepting_new_tickets,
        tablet=tablet_info,
        user_ids=[u.id for u in loc.users],
    )


_UNAMBIGUOUS_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def _next_queue_code(db: Session) -> str:
    """Zwraca pierwszą wolną literę A-Z jako kod kolejki nowej lokalizacji."""
    used = {code for (code,) in db.query(models.Location.queue_code).all()}
    for letter in string.ascii_uppercase:
        if letter not in used:
            return letter
    raise HTTPException(status_code=409, detail="Wyczerpano dostępne litery kodów kolejki (A-Z)")


def _generate_pairing_token(db: Session) -> str:
    """Generuje unikalny, czytelny token parowania tabletu (do ręcznego wpisania w apce mobilnej)."""
    for _ in range(10):
        token = "-".join(
            "".join(random.choices(_UNAMBIGUOUS_ALPHABET, k=4)) for _ in range(2)
        )
        collision = db.query(models.Tablet).filter(models.Tablet.pairing_token == token).first()
        if not collision:
            return token
    raise HTTPException(status_code=500, detail="Nie udało się wygenerować unikalnego tokenu parowania")


def _authenticate_kiosk(pairing_token: str, device_id: str, db: Session) -> models.Tablet:
    """
    Znajduje tablet po pairing_token i wymusza regułę "jeden token = jeden
    fizyczny tablet": pierwsze urządzenie, które przyjdzie z danym tokenem,
    "przejmuje" go (zapisuje swój device_id). Każde KOLEJNE urządzenie z tym
    samym tokenem, ale INNYM device_id, dostaje 409 — token trzeba zresetować
    w panelu admina (POST /admin/tablets/{id}/reset-pairing), żeby dało się
    go użyć na nowym urządzeniu.
    """
    tablet = db.query(models.Tablet).filter(models.Tablet.pairing_token == pairing_token).first()
    if not tablet:
        raise HTTPException(status_code=401, detail="Nieprawidłowy token tabletu")

    if tablet.paired_device_id is None:
        tablet.paired_device_id = device_id
        db.commit()
        db.refresh(tablet)
    elif tablet.paired_device_id != device_id:
        raise HTTPException(
            status_code=409,
            detail="Ten token parowania jest już przypisany do innego urządzenia. Poproś administratora o zresetowanie tokenu.",
        )

    return tablet


async def _broadcast_tablet_update(redis_client, tablet: models.Tablet, event_type: str = "device.updated") -> None:
    """
    Powiadamia o zmianie tabletu: panel admina ("admin"), lokalizację, do której
    jest aktualnie przypisany (jeśli jest), oraz samego siebie (topik
    `tablet:{id}`) — dzięki temu kiosk (podłączony przez WS swoim pairing_token,
    zanim jeszcze miał przypisaną lokalizację) natychmiast dowiaduje się o
    przypisaniu/zmianie, zamiast czekać na kolejny cykl pollingu REST.
    """
    payload = {"tablet": _tablet_to_response(tablet).model_dump()}
    await publish_event(redis_client, "admin", event_type, payload)
    if tablet.location_id:
        await publish_event(redis_client, f"location:{tablet.location_id}", event_type, payload)
    await publish_event(redis_client, f"tablet:{tablet.id}", event_type, payload)


def _current_serving_ticket_code(location_id: int, db: Session) -> str | None:
    ticket = (
        db.query(models.Ticket)
        .filter(models.Ticket.location_id == location_id, models.Ticket.status == "SERVING")
        .order_by(models.Ticket.called_at.desc())
        .first()
    )
    return ticket.ticket_code if ticket else None


def _user_to_response(user: models.User) -> UserResponse:
    return UserResponse(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        position=user.position,
        role=user.role,
        is_active=user.is_active,
        location_ids=[loc.id for loc in user.locations],
        online=_is_online(user),
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


def _detach_tablet_from_location(location_id: int, exclude_tablet_id: int | None, db: Session) -> models.Tablet | None:
    """
    Odłącza tablet przypisany do danej lokalizacji (ustawia location_id=None).
    Pomija tablet o id == exclude_tablet_id (ten, który właśnie przypisujemy).
    Wywoływać PRZED przypisaniem nowego tabletu, żeby uniknąć naruszenia UNIQUE.
    Zwraca odłączony tablet (żeby wywołujący mógł go zgłosić przez WS), albo None.
    """
    existing = db.query(models.Tablet).filter(
        models.Tablet.location_id == location_id
    ).first()
    if existing and existing.id != exclude_tablet_id:
        existing.location_id = None
        return existing
    return None


@app.get("/", tags=["default"])
async def root():
    return {"message": "Witaj w eQue API. Serwer działa poprawnie."}


@app.post("/api/v1/auth/login", response_model=TokenResponse, tags=["Auth"])
async def login(login_data: LoginRequest, db: Session = Depends(get_db)):
    """
    Weryfikuje poświadczenia i zwraca token JWT wraz z danymi profilu.
    Obsługuje zarówno ADMIN jak i OPERATOR (jedna tabela users).
    """
    user = db.query(models.User).filter(models.User.username == login_data.username).first()

    if not user or not verify_password(login_data.password, user.password_hash):
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


@app.post("/api/v1/auth/change-password", tags=["Auth"])
async def change_password(
    data: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Samoobsługowa zmiana własnego hasła (ADMIN i OPERATOR).
    Wymaga podania obecnego hasła — w odróżnieniu od PUT /admin/users/{id},
    gdzie admin resetuje hasło komuś innemu bez jego znajomości.
    """
    if not verify_password(data.current_password, current_user.password_hash):
        raise HTTPException(status_code=401, detail="Obecne hasło jest nieprawidłowe")

    if len(data.new_password) < 6:
        raise HTTPException(status_code=422, detail="Nowe hasło musi mieć co najmniej 6 znaków")

    current_user.password_hash = hash_password(data.new_password)
    db.commit()

    return {"message": "Hasło zostało zmienione."}


@app.get("/api/v1/kiosk/status", response_model=KioskStatusResponse, tags=["Tablet"])
async def get_kiosk_status(
    tablet_token: str = Query(..., description="pairing_token z tabeli Tablet"),
    device_id: str = Query(..., description="Identyfikator urządzenia, zapamiętany lokalnie przez apkę mobilną"),
    db: Session = Depends(get_db),
):
    """
    Heartbeat + stan kiosku. Tablet odpytuje ten endpoint cyklicznie (co ~20s):
    aktualizuje last_seen_at (online) i pobiera stałą literę kolejki swojej lokalizacji
    oraz kod aktualnie obsługiwanego biletu, żeby wyświetlić je na ekranie.

    `device_id` wymusza "jeden token = jeden tablet" — patrz _authenticate_kiosk.
    """
    tablet = _authenticate_kiosk(tablet_token, device_id, db)

    tablet.last_seen_at = func.now()
    db.commit()

    if not tablet.is_active:
        return KioskStatusResponse(tablet_id=tablet.id, is_active=False)

    if not tablet.location_id:
        return KioskStatusResponse(tablet_id=tablet.id)

    location = db.query(models.Location).filter(models.Location.id == tablet.location_id).first()
    return KioskStatusResponse(
        tablet_id=tablet.id,
        location_id=location.id,
        location_name=location.name,
        queue_code=location.queue_code,
        accepting_new_tickets=location.accepting_new_tickets,
        current_ticket_code=_current_serving_ticket_code(location.id, db),
    )


_SIGNUP_CODE_TTL_SECONDS = 30
_SIGNUP_CODE_ALPHABET = string.digits


async def _generate_signup_code(redis_client, location_id: int) -> str:
    """
    Generuje nowy, krótkotrwały (30s) kod zapisu dla lokalizacji, unieważniając
    poprzedni od razu (nie czekamy na jego naturalne wygaśnięcie w Redis) —
    inaczej kiosk mógłby pokazać nowy kod, podczas gdy stary wciąż działałby
    jeszcze przez chwilę. To JEDYNY sposób na dołączenie do kolejki — stała
    litera queue_code zostaje tylko informacją, bo zbyt łatwo ją zapamiętać
    i przekazać dalej bez faktycznej obecności w kolejce.
    """
    old_code = await redis_client.get(f"signup_code:{location_id}")
    if old_code:
        await redis_client.delete(f"signup_lookup:{old_code}")

    code = None
    for _ in range(10):
        candidate = "".join(random.choices(_SIGNUP_CODE_ALPHABET, k=4))
        if not await redis_client.get(f"signup_lookup:{candidate}"):
            code = candidate
            break
    if code is None:
        raise HTTPException(status_code=500, detail="Nie udało się wygenerować kodu zapisu")

    await redis_client.setex(f"signup_code:{location_id}", _SIGNUP_CODE_TTL_SECONDS, code)
    await redis_client.setex(f"signup_lookup:{code}", _SIGNUP_CODE_TTL_SECONDS, str(location_id))
    return code


@app.get("/api/v1/kiosk/signup-code", response_model=SignupCodeResponse, tags=["Tablet"])
async def get_kiosk_signup_code(
    request: Request,
    tablet_token: str = Query(..., description="pairing_token z tabeli Tablet"),
    device_id: str = Query(..., description="Identyfikator urządzenia, zapamiętany lokalnie przez apkę mobilną"),
    db: Session = Depends(get_db),
):
    """
    Generuje świeży kod zapisu (30s) dla lokalizacji przypisanej temu tabletowi.
    Kiosk odpytuje to cyklicznie (kilka sekund przed wygaśnięciem poprzedniego),
    żeby ekran i QR zawsze pokazywały wciąż ważny kod.
    """
    tablet = _authenticate_kiosk(tablet_token, device_id, db)
    if not tablet.is_active:
        raise HTTPException(status_code=401, detail="Nieaktywny token tabletu")
    if not tablet.location_id:
        raise HTTPException(status_code=409, detail="Tablet nie ma przypisanej lokalizacji")

    code = await _generate_signup_code(request.app.state.redis, tablet.location_id)
    return SignupCodeResponse(signup_code=code, expires_in_seconds=_SIGNUP_CODE_TTL_SECONDS)


@app.websocket("/api/v1/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str | None = Query(default=None),
    tablet_token: str | None = Query(default=None),
    device_id: str | None = Query(default=None),
):
    """
    Główny endpoint WebSocket. Parametr `token` to JWT identyczny jak w REST
    (operator/admin). Tablety (kioski) łączą się zamiast tego z `tablet_token`
    (ich `pairing_token`) i `device_id` — patrz gałąź TABLET poniżej.

    Protokół po stronie klienta:
        1. Połącz się: ws://host/api/v1/ws?token=<jwt>
           lub (kiosk):  ws://host/api/v1/ws?tablet_token=<pairing_token>&device_id=<...>
        2. Operator/admin wysyła subskrypcję:
               {"type": "subscribe", "topics": ["admin"]}
           Tablet jest auto-subskrybowany przez serwer do `tablet:{id}` i,
           jeśli ma przypisaną lokalizację, do `location:{id}` — nie musi nic
           wysyłać, żeby zacząć odbierać eventy.
        3. Wysyłaj heartbeat co ~20s:
               {"type": "ping"}
           Serwer odpowie: {"type": "pong"}
        4. Odbieraj push-eventy z serwera.
    """
    from database import SessionLocal

    if tablet_token is not None:
        db = SessionLocal()
        try:
            tablet = db.query(models.Tablet).filter(
                models.Tablet.pairing_token == tablet_token
            ).first()
            if not tablet:
                await websocket.close(code=4003)
                return

            if tablet.paired_device_id is None:
                tablet.paired_device_id = device_id
                db.commit()
                db.refresh(tablet)
            elif tablet.paired_device_id != device_id:
                await websocket.close(code=4009)
                return

            tablet_id = tablet.id
            location_id = tablet.location_id
        finally:
            db.close()

        async def _touch_tablet_last_seen():
            db = SessionLocal()
            try:
                db.query(models.Tablet).filter(models.Tablet.id == tablet_id).update(
                    {"last_seen_at": datetime.now(timezone.utc)}
                )
                db.commit()
            finally:
                db.close()

        async def _clear_tablet_last_seen():
            db = SessionLocal()
            try:
                db.query(models.Tablet).filter(models.Tablet.id == tablet_id).update(
                    {"last_seen_at": None}
                )
                db.commit()
            finally:
                db.close()

        async def _broadcast_tablet_status(online: bool):
            payload = {"tablet_id": tablet_id, "online": online}
            await publish_event(websocket.app.state.redis, "admin", "device.status", payload)
            if location_id:
                await publish_event(websocket.app.state.redis, f"location:{location_id}", "device.status", payload)

        await ws_manager.connect(websocket)
        initial_topics = [f"tablet:{tablet_id}"] + ([f"location:{location_id}"] if location_id else [])
        ws_manager.subscribe(websocket, initial_topics)
        await _touch_tablet_last_seen()
        await _broadcast_tablet_status(True)
        logger.info("WS: tablet %s połączony.", tablet_id)

        try:
            while True:
                data = await websocket.receive_json()
                msg_type = data.get("type")

                if msg_type == "subscribe":
                    topics = data.get("topics", [])
                    ws_manager.subscribe(websocket, topics)
                    await ws_manager.send_personal(websocket, {"type": "subscribed", "topics": topics})

                elif msg_type == "ping":
                    await _touch_tablet_last_seen()
                    await ws_manager.send_personal(websocket, {"type": "pong"})

                else:
                    logger.warning("WS: nieznany typ wiadomości od tabletu %s: %s", tablet_id, msg_type)

        except WebSocketDisconnect:
            ws_manager.disconnect(websocket)
            await _clear_tablet_last_seen()
            await _broadcast_tablet_status(False)
            logger.info("WS: tablet %s rozłączony.", tablet_id)
        except Exception as exc:
            logger.error("WS: błąd dla tabletu %s: %s", tablet_id, exc)
            ws_manager.disconnect(websocket)
            await _clear_tablet_last_seen()
            await _broadcast_tablet_status(False)
        return

    if not token:
        await websocket.close(code=4001)
        return

    import jwt as _jwt
    from auth import SECRET_KEY, ALGORITHM

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

    db = SessionLocal()
    try:
        user = db.query(models.User).filter(models.User.username == username).first()
        if not user or not user.is_active:
            await websocket.close(code=4003)
            return
        user_id = str(user.id)
        user_role = user.role
        location_ids = [loc.id for loc in user.locations]
    finally:
        db.close()

    async def _touch_last_seen():
        """Aktualizuje last_seen_at operatora — wywoływane na connect i przy każdym pingu."""
        db = SessionLocal()
        try:
            db.query(models.User).filter(models.User.id == user.id).update(
                {"last_seen_at": datetime.now(timezone.utc)}
            )
            db.commit()
        finally:
            db.close()

    async def _broadcast_presence(status: str):
        payload = {"user_id": user_id, "status": status}
        await publish_event(websocket.app.state.redis, "admin", "user.presence", payload)
        for loc_id in location_ids:
            await publish_event(websocket.app.state.redis, f"location:{loc_id}", "user.presence", payload)

    async def _clear_last_seen():
        """
        Zeruje last_seen_at przy rozłączeniu, żeby REST (_is_online) natychmiast
        zgadzał się z eventem "offline" — inaczej last_seen_at zostaje świeże
        jeszcze do ~45s i kolejny fetch/refresh REST nadpisuje stan z powrotem
        na online, mimo że socket już nie żyje.
        """
        db = SessionLocal()
        try:
            db.query(models.User).filter(models.User.id == user.id).update(
                {"last_seen_at": None}
            )
            db.commit()
        finally:
            db.close()

    await ws_manager.connect(websocket)
    await _touch_last_seen()
    await _broadcast_presence("online")
    logger.info("WS: użytkownik '%s' (%s) połączony.", username, user_role)

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "subscribe":
                topics = data.get("topics", [])
                ws_manager.subscribe(websocket, topics)
                await ws_manager.send_personal(websocket, {
                    "type": "subscribed",
                    "topics": topics,
                })
                logger.debug("WS: '%s' zasubskrybował: %s", username, topics)

            elif msg_type == "ping":
                await _touch_last_seen()
                await ws_manager.send_personal(websocket, {"type": "pong"})

            else:
                logger.warning("WS: nieznany typ wiadomości od '%s': %s", username, msg_type)

    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
        await _clear_last_seen()
        await _broadcast_presence("offline")
        logger.info("WS: użytkownik '%s' rozłączony.", username)
    except Exception as exc:
        logger.error("WS: błąd dla '%s': %s", username, exc)
        ws_manager.disconnect(websocket)
        await _clear_last_seen()
        await _broadcast_presence("offline")


def _generate_ticket_code(location: models.Location, db: Session) -> str:
    """
    Generuje kod biletu = stała litera kolejki lokalizacji + kolejny numer w danym dniu,
    np. "A01", "A02"... Numeracja resetuje się codziennie per lokalizacja.
    """
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    count_today = db.query(models.Ticket).filter(
        models.Ticket.location_id == location.id,
        models.Ticket.joined_at >= today_start,
    ).count()

    number = count_today + 1
    code = f"{location.queue_code}{number:02d}"
    while db.query(models.Ticket).filter(
        models.Ticket.location_id == location.id,
        models.Ticket.ticket_code == code,
        models.Ticket.joined_at >= today_start,
    ).first():
        number += 1
        code = f"{location.queue_code}{number:02d}"
    return code


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
    Dołącza do kolejki przez wpisany (lub zeskanowany) KOD ZAPISU — krótkotrwały
    kod z ekranu kiosku (patrz GET /kiosk/signup-code), rozwiązywany przez Redis
    na location_id. Tworzy Ticket(status=WAITING) z kodem <queue_code><numer_dnia>,
    np. "A01", wylicza pozycję i szacowany czas.
    """
    location_id_raw = await request.app.state.redis.get(f"signup_lookup:{payload.signup_code.strip()}")
    if not location_id_raw:
        raise HTTPException(status_code=404, detail="Nieprawidłowy lub wygasły kod zapisu")

    loc = db.query(models.Location).filter(models.Location.id == int(location_id_raw)).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Lokalizacja nie istnieje")
    if not loc.is_active:
        raise HTTPException(status_code=409, detail="Lokalizacja jest nieaktywna")
    if not loc.accepting_new_tickets:
        raise HTTPException(status_code=409, detail="Zapisy do tej kolejki są tymczasowo wstrzymane")

    location_id = loc.id
    code = _generate_ticket_code(loc, db)

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
    db.flush()

    queue_position = db.query(models.Ticket).filter(
        models.Ticket.location_id == location_id,
        models.Ticket.status == "WAITING",
        models.Ticket.joined_at < now,
    ).count()

    db.commit()
    db.refresh(ticket)

    await publish_event(
        request.app.state.redis,
        topic=f"location:{location_id}",
        event_type="ticket.created",
        payload={"ticket": _ticket_to_response(ticket).model_dump()},
    )

    estimated_wait_time_minutes = queue_position * 3

    return JoinQueueResponse(
        ticket_id=str(ticket.id),
        ticket_code=ticket.ticket_code,
        queue_position=queue_position,
        location_id=ticket.location_id,
        estimated_wait_time_minutes=estimated_wait_time_minutes,
    )


@app.get("/api/v1/queue/ticket/{ticket_code}", response_model=TicketStatusResponse, tags=["Patient"])
async def get_ticket_status(ticket_code: str, db: Session = Depends(get_db)):
    """
    Publiczny, bezstanowy odczyt aktualnego stanu biletu. Aplikacja mobilna
    wywołuje to przy każdym (re)połączeniu WS `/queue/ws/{ticket_code}` — bez
    tego jednorazowy event YOUR_TURN/QUEUE_UPDATE przegapiony w złym momencie
    (np. gniazdo padło tuż przed wezwaniem) zostawiałby pacjenta na zawsze
    z nieaktualnym stanem, bo WS nie ma pamięci ani powtórek.
    """
    ticket = (
        db.query(models.Ticket)
        .filter(models.Ticket.ticket_code == ticket_code.strip().upper())
        .order_by(models.Ticket.joined_at.desc())
        .first()
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Bilet nie został znaleziony")

    queue_position = 0
    estimated_wait_time_minutes = 0
    if ticket.status == "WAITING":
        queue_position = db.query(models.Ticket).filter(
            models.Ticket.location_id == ticket.location_id,
            models.Ticket.status == "WAITING",
            models.Ticket.joined_at < ticket.joined_at,
        ).count()
        estimated_wait_time_minutes = queue_position * 3

    return TicketStatusResponse(
        ticket_code=ticket.ticket_code,
        status=ticket.status,
        queue_position=queue_position,
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

    response = _ticket_to_response(ticket)
    await publish_event(
        request.app.state.redis,
        topic=f"location:{ticket.location_id}",
        event_type="ticket.updated",
        payload={"ticket": response.model_dump()},
    )

    await _broadcast_queue_updates(request.app.state.redis, ticket.location_id, db)

    return {"message": "Ticket cancelled successfully"}


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

    for idx, t in enumerate(waiting_tickets):
        update_msg = {
            "topic": f"guest:{t.ticket_code}",
            "event": "QUEUE_UPDATE",
            "queue_position": idx,
            "estimated_wait_time_minutes": idx * 3,
        }
        await redis_client.publish(REDIS_CHANNEL, json.dumps(update_msg, default=str))


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
    displaced_tablet = None
    if data.location_id is not None:
        displaced_tablet = _detach_tablet_from_location(data.location_id, exclude_tablet_id=None, db=db)

    new_tablet = models.Tablet(
        name=data.name,
        location_id=data.location_id,
        is_active=True,
        pairing_token=_generate_pairing_token(db),
    )
    db.add(new_tablet)
    db.commit()
    db.refresh(new_tablet)
    if displaced_tablet:
        db.refresh(displaced_tablet)
    response = _tablet_to_response(new_tablet)

    payload = {"tablet": response.model_dump()}
    await publish_event(request.app.state.redis, "admin", "device.created", payload)
    if new_tablet.location_id:
        await publish_event(request.app.state.redis, f"location:{new_tablet.location_id}", "device.created", payload)
    if displaced_tablet:
        await _broadcast_tablet_update(request.app.state.redis, displaced_tablet)

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

    displaced_tablet = None
    if "location_id" in data.model_fields_set:
        new_loc_id = data.location_id
        if new_loc_id is not None and new_loc_id != tablet.location_id:
            _get_location_or_404(new_loc_id, db)
            displaced_tablet = _detach_tablet_from_location(new_loc_id, exclude_tablet_id=tablet_id, db=db)
        tablet.location_id = new_loc_id

    db.commit()
    db.refresh(tablet)
    if displaced_tablet:
        db.refresh(displaced_tablet)

    await _broadcast_tablet_update(request.app.state.redis, tablet)
    if displaced_tablet:
        await _broadcast_tablet_update(request.app.state.redis, displaced_tablet)

    return _tablet_to_response(tablet)


@app.delete("/api/v1/admin/tablets/{tablet_id}", tags=["Admin — Tablets"])
async def delete_tablet(
    tablet_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    tablet = _get_tablet_or_404(tablet_id, db)
    old_location_id = tablet.location_id
    db.delete(tablet)
    db.commit()

    payload = {"tablet_id": tablet_id}
    await publish_event(request.app.state.redis, "admin", "device.deleted", payload)
    if old_location_id:
        await publish_event(request.app.state.redis, f"location:{old_location_id}", "device.deleted", payload)
    await publish_event(request.app.state.redis, f"tablet:{tablet_id}", "device.deleted", payload)

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

    await _broadcast_tablet_update(request.app.state.redis, tablet)

    return _tablet_to_response(tablet)


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
    old_location_id = tablet.location_id
    tablet.is_active = False
    tablet.location_id = None
    db.commit()
    db.refresh(tablet)

    await _broadcast_tablet_update(request.app.state.redis, tablet)
    if old_location_id:
        await publish_event(
            request.app.state.redis, f"location:{old_location_id}", "device.updated",
            {"tablet": _tablet_to_response(tablet).model_dump()},
        )

    return _tablet_to_response(tablet)


@app.post("/api/v1/admin/tablets/{tablet_id}/reset-pairing", response_model=TabletResponse, tags=["Admin — Tablets"])
async def reset_tablet_pairing(
    tablet_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Generuje nowy `pairing_token`, unieważniając poprzedni — fizyczne urządzenie,
    które ma zapisany stary token (aplikacja mobilna zapamiętuje go lokalnie),
    dostanie 401 przy najbliższym kontakcie z serwerem i wróci do ekranu
    ręcznego parowania. Używać, gdy tablet fizycznie zmienia przeznaczenie
    albo zgubiono/skradziono urządzenie.
    """
    tablet = _get_tablet_or_404(tablet_id, db)
    tablet.pairing_token = _generate_pairing_token(db)
    tablet.paired_device_id = None
    db.commit()
    db.refresh(tablet)

    await _broadcast_tablet_update(request.app.state.redis, tablet)

    return _tablet_to_response(tablet)


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
    """Tworzy nową lokalizację. Litera kodu kolejki (queue_code) jest nadawana automatycznie."""
    new_loc = models.Location(
        name=data.name,
        description=data.description,
        category=data.category,
        is_active=True,
        queue_code=_next_queue_code(db),
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

    affected_tablets: list[models.Tablet] = []
    if "tablet_id" in fields:
        new_tablet_id = data.tablet_id
        if new_tablet_id is None:
            for t in loc.tablets:
                t.location_id = None
                affected_tablets.append(t)
        else:
            new_tablet = _get_tablet_or_404(new_tablet_id, db)
            displaced_tablet = _detach_tablet_from_location(location_id, exclude_tablet_id=new_tablet_id, db=db)
            if displaced_tablet:
                affected_tablets.append(displaced_tablet)
            new_tablet.location_id = location_id
            affected_tablets.append(new_tablet)

    if data.user_ids is not None:
        users = db.query(models.User).filter(
            models.User.id.in_(data.user_ids)
        ).all()
        if len(users) != len(data.user_ids):
            raise HTTPException(status_code=422, detail="Jeden lub więcej użytkowników nie istnieje")
        loc.users = users

    db.commit()
    db.refresh(loc)
    for t in affected_tablets:
        db.refresh(t)
    response = _location_to_response(loc)

    payload = {"location": response.model_dump()}
    await publish_event(request.app.state.redis, "admin", "location.updated", payload)
    await publish_event(request.app.state.redis, f"location:{loc.id}", "location.updated", payload)

    for t in affected_tablets:
        await _broadcast_tablet_update(request.app.state.redis, t)

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

    Odmawia usunięcia, jeśli lokalizacja ma jakiekolwiek bilety w historii —
    tickets.location_id jest NOT NULL, więc SQLAlchemy próbowałoby je
    wyzerować przy kasowaniu rodzica i baza odrzuciłaby to (NotNullViolation,
    500). Zamiast tego admin powinien dezaktywować lokalizację, żeby
    zachować historię kolejki.
    """
    loc = _get_location_or_404(location_id, db)

    has_tickets = db.query(models.Ticket.id).filter(models.Ticket.location_id == location_id).first() is not None
    if has_tickets:
        raise HTTPException(
            status_code=409,
            detail="Nie można usunąć lokalizacji z historią biletów w kolejce. Dezaktywuj ją zamiast tego.",
        )

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
    for t in loc.tablets:
        t.location_id = None
    loc.users = []
    db.commit()
    db.refresh(loc)
    response = _location_to_response(loc)

    payload = {"location": response.model_dump()}
    await publish_event(request.app.state.redis, "admin", "location.updated", payload)
    await publish_event(request.app.state.redis, f"location:{loc.id}", "location.updated", payload)

    return response


@app.post("/api/v1/admin/locations/{location_id}/pause-queue", response_model=LocationResponse, tags=["Admin — Queue"])
async def pause_location_queue(
    location_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Wstrzymuje NOWE zapisy do kolejki (operator, z zakładki "Kolejka na żywo") —
    inaczej niż dezaktywacja tabletu/lokalizacji przez admina: obsługa już
    czekających biletów trwa dalej, `queue/join` tylko odmawia nowym klientom,
    a kiosk pokazuje to osobnym, mniej inwazyjnym komunikatem.
    """
    loc = _get_location_or_404(location_id, db)
    loc.accepting_new_tickets = False
    db.commit()
    db.refresh(loc)
    response = _location_to_response(loc)

    payload = {"location": response.model_dump()}
    await publish_event(request.app.state.redis, "admin", "location.updated", payload)
    await publish_event(request.app.state.redis, f"location:{loc.id}", "location.updated", payload)

    return response


@app.post("/api/v1/admin/locations/{location_id}/resume-queue", response_model=LocationResponse, tags=["Admin — Queue"])
async def resume_location_queue(
    location_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Wznawia przyjmowanie nowych zapisów do kolejki (patrz pause_location_queue)."""
    loc = _get_location_or_404(location_id, db)
    loc.accepting_new_tickets = True
    db.commit()
    db.refresh(loc)
    response = _location_to_response(loc)

    payload = {"location": response.model_dump()}
    await publish_event(request.app.state.redis, "admin", "location.updated", payload)
    await publish_event(request.app.state.redis, f"location:{loc.id}", "location.updated", payload)

    return response


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
    existing = db.query(models.User).filter(models.User.username == data.username).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Użytkownik '{data.username}' już istnieje")

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
        user.password_hash = hash_password(data.password)

    if data.location_ids is not None:
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

    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Nie możesz usunąć własnego konta")


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

    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Nie możesz dezaktywować własnego konta")

    user.is_active = False
    user.locations = []

    db.commit()
    db.refresh(user)
    response = _user_to_response(user)

    payload = {"user": response.model_dump()}
    await publish_event(request.app.state.redis, "admin", "user.updated", payload)

    return response


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

    await publish_event(
        request.app.state.redis,
        topic=f"location:{ticket.location_id}",
        event_type="ticket.updated",
        payload={"ticket": response.model_dump()},
    )

    your_turn_msg = {
        "topic": f"guest:{ticket.ticket_code}",
        "event": "YOUR_TURN",
    }
    await request.app.state.redis.publish(
        REDIS_CHANNEL, json.dumps(your_turn_msg, default=str)
    )

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

    await publish_event(
        request.app.state.redis,
        topic=f"location:{ticket.location_id}",
        event_type="ticket.updated",
        payload={"ticket": response.model_dump()},
    )

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

    await publish_event(
        request.app.state.redis,
        topic=f"location:{ticket.location_id}",
        event_type="ticket.updated",
        payload={"ticket": response.model_dump()},
    )

    await _broadcast_queue_updates(request.app.state.redis, ticket.location_id, db)

    return response

