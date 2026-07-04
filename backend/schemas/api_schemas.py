from pydantic import BaseModel, ConfigDict
from typing import Optional
import uuid


# ---------------------------------------------------------------------------
# SCHEMATY DLA TABLETU (KIOSKU)
# ---------------------------------------------------------------------------

class QRCodeResponse(BaseModel):
    qr_token: str
    short_code: str
    expires_in_seconds: int


# ---------------------------------------------------------------------------
# SCHEMATY DLA MOBILKI / KOLEJKI (PACJENT)
# ---------------------------------------------------------------------------

class JoinQueueRequest(BaseModel):
    """Body POST /queue/join — dołączenie do kolejki przez zeskanowany QR token."""
    qr_token: str                             # token z kodu QR (UUID, ważny ~45s w Redis)
    customer_name: Optional[str] = None       # imię/nazwisko (opcjonalne)
    appointment_time: Optional[str] = None    # np. "09:15" dla wizyt z rejestracji

class JoinQueueResponse(BaseModel):
    """Odpowiedź po dołączeniu do kolejki."""
    ticket_id: str                  # UUID biletu jako string
    ticket_code: str                # krótki kod, np. "A3F"
    queue_position: int             # ile osób przede mną (0 = jestem pierwszy)
    location_id: int
    estimated_wait_time_minutes: int  # szacowany czas oczekiwania (pozycja * 3 min)

class PatientCancelRequest(BaseModel):
    """Body POST /queue/cancel — pacjent samodzielnie anuluje swój bilet."""
    ticket_code: str


# ---------------------------------------------------------------------------
# SCHEMATY DLA BILETÓW / TICKETÓW
# ---------------------------------------------------------------------------

class TicketResponse(BaseModel):
    """Pełna odpowiedź dla pojedynczego biletu."""
    id: str                                     # UUID jako string
    ticket_code: str
    status: str                                 # WAITING | SERVING | COMPLETED | CANCELLED
    location_id: int
    joined_at: str                              # ISO-8601
    called_at: Optional[str] = None
    served_at: Optional[str] = None
    customer_name: Optional[str] = None
    appointment_time: Optional[str] = None
    served_by_user_id: Optional[str] = None    # UUID jako string

    model_config = ConfigDict(from_attributes=True)

class QueueResponse(BaseModel):
    """Odpowiedź GET /admin/locations/{id}/queue."""
    location_id: int
    waiting: list[TicketResponse]   # WAITING, posortowane po joined_at
    serving: Optional[TicketResponse] = None  # aktualnie obsługiwany (SERVING)


# ---------------------------------------------------------------------------
# SCHEMATY DLA TABLETÓW (ADMIN PANEL)
# ---------------------------------------------------------------------------

class TabletCreate(BaseModel):
    """Body POST /admin/tablets."""
    name: str
    location_id: Optional[int] = None

class TabletUpdate(BaseModel):
    """Body PUT /admin/tablets/{id} — wszystkie pola opcjonalne."""
    name: Optional[str] = None
    location_id: Optional[int] = None

class TabletResponse(BaseModel):
    """Odpowiedź dla pojedynczego tabletu."""
    id: int
    name: str
    location_id: Optional[int] = None
    is_active: bool
    last_seen_at: Optional[str] = None   # ISO-8601 string (frontend przelicza na online/offline)
    online: bool = False                  # liczone po stronie serwera: now - last_seen_at < 45s

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# SCHEMATY DLA LOKALIZACJI (ADMIN PANEL)
# ---------------------------------------------------------------------------

class TabletInLocation(BaseModel):
    """Skrócona informacja o tablecie przypisanym do lokalizacji (lub None)."""
    id: int
    name: str
    is_active: bool

    model_config = ConfigDict(from_attributes=True)

class LocationCreate(BaseModel):
    """Body POST /admin/locations."""
    name: str
    description: Optional[str] = None
    category: str = "Ogólna"

class LocationUpdate(BaseModel):
    """Body PUT /admin/locations/{id} — wszystkie pola opcjonalne."""
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    tablet_id: Optional[int] = None      # przypisz tablet; None = odłącz
    user_ids: Optional[list[uuid.UUID]] = None # pełna synchronizacja przypisanych operatorów

    # Sentinel: rozróżnienie między "nie podano tablet_id" a "celowo wpisano null"
    # Używamy model_config z extra='allow' żeby móc sprawdzić __fields_set__
    model_config = ConfigDict(extra="allow")

class LocationResponse(BaseModel):
    """Odpowiedź dla pojedynczej lokalizacji."""
    id: int
    name: str
    description: Optional[str] = None
    category: str
    is_active: bool
    tablet: Optional[TabletInLocation] = None  # przypisany tablet lub null
    user_ids: list[uuid.UUID] = []             # przypisani operatorzy

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# SCHEMATY DLA LOGOWANIA (AUTH)
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str

class ChangePasswordRequest(BaseModel):
    """Body POST /auth/change-password — samoobsługowa zmiana własnego hasła."""
    current_password: str
    new_password: str

class TokenResponse(BaseModel):
    """Odpowiedź POST /auth/login — token + dane profilu potrzebne frontendowi od razu po logowaniu."""
    access_token: str
    token_type: str = "bearer"
    id: uuid.UUID
    role: str          # "ADMIN" | "OPERATOR"
    full_name: str

class MeResponse(BaseModel):
    """Odpowiedź GET /auth/me — aktualnie zalogowany użytkownik."""
    id: uuid.UUID
    username: str
    full_name: str
    role: str
    is_active: bool
    location_ids: list[int]   # puste dla ADMIN = dostęp globalny

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# SCHEMATY DLA UŻYTKOWNIKÓW (ADMIN PANEL)
# ---------------------------------------------------------------------------

class UserCreate(BaseModel):
    """Body POST /admin/users."""
    username: str
    full_name: str
    password: str
    role: str = "OPERATOR"        # "ADMIN" | "OPERATOR"
    position: Optional[str] = None
    location_ids: list[int] = []  # przypisane lokalizacje (puste = dostęp globalny dla ADMIN)

class UserUpdate(BaseModel):
    """Body PUT /admin/users/{id} — wszystkie pola opcjonalne."""
    username: Optional[str] = None
    full_name: Optional[str] = None
    position: Optional[str] = None
    role: Optional[str] = None
    password: Optional[str] = None     # puste / brak = nie zmieniaj hasła
    location_ids: Optional[list[int]] = None

class UserResponse(BaseModel):
    """Odpowiedź dla pojedynczego użytkownika (lista i szczegóły)."""
    id: uuid.UUID
    username: str
    full_name: str
    position: Optional[str] = None
    role: str
    is_active: bool
    location_ids: list[int] = []
    online: bool = False   # liczone po stronie serwera: now - last_seen_at < 45s (heartbeat przez WS)

    model_config = ConfigDict(from_attributes=True)