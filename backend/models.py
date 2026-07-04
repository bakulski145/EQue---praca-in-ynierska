import uuid
from datetime import datetime
from sqlalchemy import String, ForeignKey, DateTime, Boolean, Table, Column
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


# TABELA LACZĄCA: Many-to-Many między users a locations (operatorzy przypisani do lokalizacji)

user_locations = Table(
    "user_locations",
    Base.metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("location_id", ForeignKey("locations.id", ondelete="CASCADE"), primary_key=True),
)


# TABELA 1: Użytkownicy (zastępuje admins) — role: ADMIN / OPERATOR

class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    position: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # Rola: "ADMIN" lub "OPERATOR"
    role: Mapped[str] = mapped_column(String(20), default="OPERATOR")
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Lokalizacje przypisane temu użytkownikowi (dla OPERATORa; ADMIN = brak wierszy = dostęp globalny)
    locations: Mapped[list["Location"]] = relationship(
        secondary=user_locations, back_populates="users"
    )
    # Bilety obsługiwane przez tego użytkownika
    served_tickets: Mapped[list["Ticket"]] = relationship(back_populates="served_by_user")


# TABELA 2: Lokalizacje (zastępuje service_points, nazwa zgodna z frontendem)

class Location(Base):
    __tablename__ = "locations"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)  # nowe — AdminLocations.tsx
    category: Mapped[str] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Stała litera kolejki (np. "A") — nadawana automatycznie przy tworzeniu lokalizacji,
    # klient wpisuje ją w aplikacji mobilnej, żeby dołączyć do kolejki tej lokalizacji.
    # Prefiks numerów biletów: "A01", "A02"...
    queue_code: Mapped[str] = mapped_column(String(2), unique=True)
    # Wstrzymanie NOWYCH zapisów przez operatora (np. koniec zmiany) — inne niż
    # is_active/dezaktywacja tabletu przez admina: obsługa już czekających
    # biletów trwa dalej, tylko queue/join odmawia nowym klientom.
    accepting_new_tickets: Mapped[bool] = mapped_column(Boolean, default=True)

    # Jeden-do-wielu: jedna lokalizacja może mieć wiele tabletów (max 1 aktywny dzięki UNIQUE na tablets.location_id)
    tablets: Mapped[list["Tablet"]] = relationship(back_populates="location")
    # Jeden-do-wielu: bilety w kolejce dla tej lokalizacji
    tickets: Mapped[list["Ticket"]] = relationship(back_populates="location")
    # Wiele-do-wielu: operatorzy przypisani do tej lokalizacji
    users: Mapped[list["User"]] = relationship(
        secondary=user_locations, back_populates="locations"
    )


# TABELA 3: Tablety / Kioski

class Tablet(Base):
    __tablename__ = "tablets"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100))           # np. "Tablet Wejściowy"

    # `location` (String) usunięte — zastąpione przez location_id (FK)
    # `service_point_id` przemianowane na location_id dla spójności z frontendem (locationId)
    # UNIQUE: reguła "1 tablet = max 1 lokalizacja"; Postgres dopuszcza wiele NULL przy UNIQUE
    location_id: Mapped[int | None] = mapped_column(
        ForeignKey("locations.id"), nullable=True, unique=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)       # nowe — dezaktywacja tabletu
    last_seen_at: Mapped[datetime | None] = mapped_column(               # nowe — heartbeat WS
        DateTime(timezone=True), nullable=True
    )
    pairing_token: Mapped[str | None] = mapped_column(String(64), nullable=True)  # nowe — parowanie QR
    # Identyfikator konkretnego urządzenia (generowany i zapamiętywany przez apkę
    # mobilną), który "przejmuje" pairing_token przy pierwszym użyciu — wymusza
    # regułę "jeden token = jeden fizyczny tablet". Zerowane przy reset-pairing.
    paired_device_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Relacja zwrotna
    location: Mapped["Location | None"] = relationship(back_populates="tablets")


# TABELA 4: Bilety w kolejce

class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    ticket_code: Mapped[str] = mapped_column(String(10), index=True)

    # Statusy: WAITING, SERVING, COMPLETED, CANCELLED (bez zmian)
    status: Mapped[str] = mapped_column(String(20), default="WAITING")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    called_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)   # nowe — kiedy operator wezwał
    served_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)   # nowe — kiedy zakończono/anulowano

    customer_name: Mapped[str | None] = mapped_column(String(120), nullable=True)    # nowe — imię/nazwisko z formularza
    appointment_time: Mapped[str | None] = mapped_column(String(20), nullable=True)  # nowe — np. "09:15"

    # Który operator obsługuje/obsłużył (nullable)
    served_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    # Lokalizacja (przemianowane z service_point_id)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"))

    # Relacje zwrotne
    location: Mapped["Location"] = relationship(back_populates="tickets")
    served_by_user: Mapped["User | None"] = relationship(back_populates="served_tickets")