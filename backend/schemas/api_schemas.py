from pydantic import BaseModel, ConfigDict
from typing import Optional
import uuid


class KioskStatusResponse(BaseModel):
    """Odpowiedź GET /kiosk/status — heartbeat + stan kolejki dla ekranu kiosku."""
    tablet_id: int
    is_active: bool = True
    location_id: Optional[int] = None
    location_name: Optional[str] = None
    queue_code: Optional[str] = None
    current_ticket_code: Optional[str] = None
    accepting_new_tickets: bool = True


class SignupCodeResponse(BaseModel):
    """
    Odpowiedź GET /kiosk/signup-code — krótkotrwały (30s) kod zapisu, jedyny
    sposób na faktyczne dołączenie do kolejki. Odświeżany cyklicznie przez
    kiosk, żeby stała litera queue_code nie musiała nigdy służyć do zapisu
    (zbyt łatwa do zapamiętania/przekazania dalej bez fizycznej obecności).
    """
    signup_code: str
    expires_in_seconds: int


class JoinQueueRequest(BaseModel):
    """
    Body POST /queue/join — dołączenie do kolejki przez wpisany (lub zeskanowany)
    KOD ZAPISU: krótkotrwały, 4-cyfrowy kod wyświetlany na ekranie kiosku,
    odświeżany co 30s. To NIE stała litera lokalizacji (queue_code) — ta służy
    już tylko jako informacja na kiosku/w ticket_code, nie da się nią dołączyć.
    """
    signup_code: str
    customer_name: Optional[str] = None
    appointment_time: Optional[str] = None

class JoinQueueResponse(BaseModel):
    """Odpowiedź po dołączeniu do kolejki."""
    ticket_id: str
    ticket_code: str
    queue_position: int
    location_id: int
    estimated_wait_time_minutes: int
    total_in_queue: int | None = None

class PatientCancelRequest(BaseModel):
    """Body POST /queue/cancel — pacjent samodzielnie anuluje swój bilet."""
    ticket_code: str

class TicketStatusResponse(BaseModel):
    """
    Odpowiedź GET /queue/ticket/{ticket_code} — publiczny, bezstanowy odczyt
    aktualnego stanu biletu. Aplikacja mobilna dociąga to przy każdym
    (re)połączeniu WS, żeby nigdy nie utknąć na starym stanie, gdyby
    jednorazowy event YOUR_TURN/QUEUE_UPDATE został przegapiony (np. gniazdo
    padło w złym momencie).
    """
    ticket_code: str
    status: str
    queue_position: int
    estimated_wait_time_minutes: int
    total_in_queue: int | None = None

class TicketResponse(BaseModel):
    """Pełna odpowiedź dla pojedynczego biletu."""
    id: str
    ticket_code: str
    status: str
    location_id: int
    joined_at: str
    called_at: Optional[str] = None
    served_at: Optional[str] = None
    customer_name: Optional[str] = None
    appointment_time: Optional[str] = None
    served_by_user_id: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

class QueueResponse(BaseModel):
    """Odpowiedź GET /admin/locations/{id}/queue."""
    location_id: int
    waiting: list[TicketResponse]
    serving: Optional[TicketResponse] = None


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
    last_seen_at: Optional[str] = None
    online: bool = False
    pairing_token: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


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
    tablet_id: Optional[int] = None
    user_ids: Optional[list[uuid.UUID]] = None

    model_config = ConfigDict(extra="allow")

class LocationResponse(BaseModel):
    """Odpowiedź dla pojedynczej lokalizacji."""
    id: int
    name: str
    description: Optional[str] = None
    category: str
    is_active: bool
    queue_code: str
    accepting_new_tickets: bool = True
    tablet: Optional[TabletInLocation] = None
    user_ids: list[uuid.UUID] = []

    model_config = ConfigDict(from_attributes=True)


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
    role: str
    full_name: str

class MeResponse(BaseModel):
    """Odpowiedź GET /auth/me — aktualnie zalogowany użytkownik."""
    id: uuid.UUID
    username: str
    full_name: str
    role: str
    is_active: bool
    location_ids: list[int]

    model_config = ConfigDict(from_attributes=True)


class UserCreate(BaseModel):
    """Body POST /admin/users."""
    username: str
    full_name: str
    password: str
    role: str = "OPERATOR"
    position: Optional[str] = None
    location_ids: list[int] = []

class UserUpdate(BaseModel):
    """Body PUT /admin/users/{id} — wszystkie pola opcjonalne."""
    username: Optional[str] = None
    full_name: Optional[str] = None
    position: Optional[str] = None
    role: Optional[str] = None
    password: Optional[str] = None
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
    online: bool = False

    model_config = ConfigDict(from_attributes=True)