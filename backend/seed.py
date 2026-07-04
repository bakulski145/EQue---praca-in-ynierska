"""
seed.py — zasilanie bazy danych danymi testowymi.

Uruchamianie:
    python seed.py

Skrypt jest idempotentny: jeśli tabela users już zawiera dane, kończy bez zmian.
"""
from datetime import datetime, timedelta, timezone
from database import SessionLocal
from models import User, Location, Tablet, Ticket
from auth import hash_password


def seed_data():
    db = SessionLocal()

    # Guard: nie seeduj drugi raz
    if db.query(User).first():
        print("Baza już zawiera dane. Pomijam seeding.")
        db.close()
        return

    print("Zasilanie bazy danych (Seeding)...")

    # ------------------------------------------------------------------
    # 1. Użytkownicy
    # ------------------------------------------------------------------

    admin = User(
        username="admin",
        full_name="Administrator Systemu",
        role="ADMIN",
        password_hash=hash_password("admin123"),
        is_active=True,
    )

    op1 = User(
        username="jan.kowalski",
        full_name="Jan Kowalski",
        position="Recepcjonista",
        role="OPERATOR",
        password_hash=hash_password("operator123"),
        is_active=True,
    )

    op2 = User(
        username="anna.nowak",
        full_name="Anna Nowak",
        position="Pielęgniarka",
        role="OPERATOR",
        password_hash=hash_password("operator123"),
        is_active=True,
    )

    db.add_all([admin, op1, op2])
    db.commit()   # nadaj UUID-y

    # ------------------------------------------------------------------
    # 2. Lokalizacje
    # ------------------------------------------------------------------

    loc1 = Location(
        name="Rejestracja Ogólna",
        description="Główna rejestracja przy wejściu",
        category="Rejestracja",
        is_active=True,
        queue_code="A",
    )

    loc2 = Location(
        name="Gabinet Kardiologiczny",
        description="Piętro 2, pokój 214",
        category="Kardiologia",
        is_active=True,
        queue_code="B",
    )

    db.add_all([loc1, loc2])
    db.commit()   # nadaj ID

    # ------------------------------------------------------------------
    # 3. Przypisanie operatorów do lokalizacji (user_locations M2M)
    # ------------------------------------------------------------------

    op1.locations = [loc1]          # Jan → Rejestracja
    op2.locations = [loc1, loc2]    # Anna → obie lokalizacje
    db.commit()

    # ------------------------------------------------------------------
    # 4. Tablety
    # ------------------------------------------------------------------

    tab1 = Tablet(
        name="Kiosk Rejestracja",
        location_id=loc1.id,
        is_active=True,
        pairing_token="DEV1-TAB1",
    )

    tab2 = Tablet(
        name="Kiosk Kardiologia",
        location_id=loc2.id,
        is_active=True,
        pairing_token="DEV2-TAB2",
    )

    db.add_all([tab1, tab2])
    db.commit()

    # ------------------------------------------------------------------
    # 5. Testowe bilety (kolejka)
    # ------------------------------------------------------------------

    now = datetime.now(timezone.utc)

    # Rejestracja — 3 oczekujące + 1 obsługiwany. Bez customer_name: apka
    # mobilna dziś nie zbiera imienia/nazwiska przy dołączeniu do kolejki —
    # frontend sam pokazuje wtedy "Zgłoszenie <kod>" (patrz UserQueue.tsx),
    # więc dane testowe mają wyglądać tak, jak realnie dodane zgłoszenie.
    tickets_loc1 = [
        Ticket(
            ticket_code="A01",
            status="SERVING",
            location_id=loc1.id,
            joined_at=now - timedelta(minutes=35),
            called_at=now - timedelta(minutes=2),
            served_by_user_id=op1.id,
        ),
        Ticket(
            ticket_code="A02",
            status="WAITING",
            location_id=loc1.id,
            joined_at=now - timedelta(minutes=25),
        ),
        Ticket(
            ticket_code="A03",
            status="WAITING",
            location_id=loc1.id,
            joined_at=now - timedelta(minutes=15),
        ),
        Ticket(
            ticket_code="A04",
            status="WAITING",
            location_id=loc1.id,
            joined_at=now - timedelta(minutes=5),
            appointment_time="10:30",
        ),
    ]

    # Kardiologia — 2 oczekujące
    tickets_loc2 = [
        Ticket(
            ticket_code="B01",
            status="WAITING",
            location_id=loc2.id,
            joined_at=now - timedelta(minutes=40),
            appointment_time="09:45",
        ),
        Ticket(
            ticket_code="B02",
            status="WAITING",
            location_id=loc2.id,
            joined_at=now - timedelta(minutes=20),
        ),
    ]

    db.add_all(tickets_loc1 + tickets_loc2)
    print(f"   📍 Lokalizacja 1: Rejestracja Ogólna  (ID: {loc1.id})")
    print(f"   📍 Lokalizacja 2: Gabinet Kardiologiczny (ID: {loc2.id})")
    print(f"   📱 Tablet 1: Kiosk Rejestracja  → loc {loc1.id}")
    print(f"   📱 Tablet 2: Kiosk Kardiologia → loc {loc2.id}")
    db.commit()
    db.close()

    print("✅ Seeding zakończony! Dane testowe:")
    print(f"   👤 Admin:     admin / admin123")
    print(f"   👤 Operator1: jan.kowalski / operator123  → Rejestracja Ogólna")
    print(f"   👤 Operator2: anna.nowak / operator123    → Rejestracja Ogólna + Kardiologia")
    print(f"   🎫 Bilety loc1: 3×WAITING + 1×SERVING")
    print(f"   🎫 Bilety loc2: 2×WAITING")


if __name__ == "__main__":
    seed_data()
