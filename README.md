# eQue monorepo

System kolejkowy czasu rzeczywistego: klient dołącza do kolejki wpisując/skanując kod z ekranu kiosku, śledzi swoje miejsce na żywo na telefonie i dostaje powiadomienie, gdy operator go wzywa. Operator zarządza kolejką z panelu webowego.

Backend: Python (FastAPI)

Web: React (panel admina/operatora)

Mobile: Flutter (aplikacja klienta + tryb kiosku na tablecie)

---

## 1. Wymagania

Aby poprawnie uruchomić projekt potrzebujemy:
* Środowiska Docker.
* Systemu operacyjnego Windows z WSL2
* Python w wersji 3.10 lub wyższej.
* Node.js (dla frontendu) oraz środowiska Flutter (dla mobile).

---

## 2. Infrastruktura

Platforma - Docker

DB - PostgreSQL (migracje przez Alembic)

Cache / Pub-Sub - Redis (WebSockety na żywo + rotujące kody zapisu do kolejki)

---

## 3. Uruchomienie środowiska (DB, Cache, Web, Backend, Mobile)

Cała infrastruktura bazodanowa, Redis oraz aplikacje frontendowa (React) i mobilna (Flutter Web) są zintegrowane w jednym pliku Docker Compose. Obie działają w trybie Hot Reload — zmiany w kodzie odświeżają się automatycznie (dla Flutter wymaga to restartu kontenera `mobile`, patrz niżej).

### Pierwsze uruchomienie (zbudowanie obrazów, budowanie backendu, seedowanie bazy):
```bash
docker-compose up -d --build
```

### Każde kolejne uruchomienie:
```bash
docker-compose up -d
```

### Zatrzymanie środowiska:
```bash
docker-compose down
```

### Po zmianach w kodzie Flutter (`mobile/`):
Kontener `flutter run` nie podłapuje zmian automatycznie przez sam bind-mount — po edycji kodu trzeba go zrestartować, żeby przebudował aplikację:
```bash
docker-compose restart mobile
```

| Usługa | Adres |
|---|---|
| Panel webowy (Admin/Operator) | http://localhost:5173 |
| Aplikacja mobilna (Flutter Web — klient + kiosk) | http://localhost:3000 |
| Backend API | http://127.0.0.1:8000 |
| Dokumentacja API (Swagger) | http://127.0.0.1:8000/docs |

---

## 4. Konta testowe (dane z seeda)

**Panel webowy:**

| Rola | Login | Hasło | Uwagi |
|---|---|---|---|
| Admin | `admin` | `admin123` | pełny dostęp, wszystkie lokalizacje |
| Operator | `jan.kowalski` | `operator123` | przypisany do „Rejestracja Ogólna" |
| Operator | `anna.nowak` | `operator123` | przypisana do obu lokalizacji |

Hasła zapisane w bazie w formie hasha bcrypt.

**Kioski (tryb tabletu w aplikacji mobilnej — zakładka „Konfiguracja kiosku"):**

| Lokalizacja | Token parowania |
|---|---|
| Rejestracja Ogólna (kod kolejki `A`) | `DEV1-TAB1` |
| Gabinet Kardiologiczny (kod kolejki `B`) | `DEV2-TAB2` |

Token parowania wpisuje się raz — urządzenie zapamiętuje go lokalnie i wraca do trybu kiosku po odświeżeniu strony. Admin może go zresetować w panelu (zakładka Tablety), co wymusza ponowne sparowanie na nowym urządzeniu.

---

## 5. Jak działa kolejka (przepływ end-to-end)

1. **Admin** dodaje lokalizację (panel web, zakładka Lokalizacje) — automatycznie dostaje stałą literę kodu kolejki (np. `A`) i dodaje tablet, który generuje token parowania.
2. **Tablet** (aplikacja mobilna w trybie kiosku) paruje się tym tokenem i wyświetla dwie informacje: stały kod kolejki (informacyjnie) oraz **kod zapisu** — krótkotrwały, 4-cyfrowy kod odświeżany co 30s (+ QR), który jako jedyny pozwala dołączyć do kolejki. To świadome zabezpieczenie: stałej litery nie da się użyć do zapisu, żeby nie dało się jej łatwo przekazać dalej bez fizycznej obecności w kolejce.
3. **Klient** (aplikacja mobilna) wpisuje lub skanuje kod zapisu, dostaje bilet (np. `A05`) i widzi swoją pozycję w kolejce na żywo.
4. **Operator** (panel web, zakładka „Kolejka na żywo") wzywa kolejne osoby — klient dostaje powiadomienie „Twoja kolej" dopiero po jawnym wezwaniu, nigdy automatycznie.
5. Operator może **tymczasowo wstrzymać nowe zapisy** do danej kolejki (np. koniec zmiany) — obsługa już czekających trwa dalej, kiosk pokazuje osobny komunikat „Zapisy wstrzymane" bez kodu/QR.
6. Cały stan (pozycja w kolejce, wezwania, status tabletu, pauzy) synchronizuje się w czasie rzeczywistym przez WebSockety — bez pollingu.

Pełny opis modelu danych, endpointów REST i protokołu WebSocket: [`backend/API_SPEC.md`](backend/API_SPEC.md) i [`mobile/zmianyApi.md`](mobile/zmianyApi.md).

---

## 6. Wygląd / Design system

Panel webowy i aplikacja mobilna dzielą ten sam design system (marka teal `#0FB5AB`, neutralne chłodne szarości, typografia Space Grotesk/Manrope, zaokrąglone karty z miękkim cieniem) — zaimportowany z projektu Claude Design i zaaplikowany 1:1 po obu stronach, łącznie ze wspólnym logiem eQue.

---

## 7. Autoryzacja i standardy API

* **Zabezpieczenie JWT (JSON Web Tokens):** Endpointy panelu admina/operatora są chronione. Frontend najpierw uderza na `POST /api/v1/auth/login` z danymi dostępowymi i w odpowiedzi dostaje token JWT.
* **Autoryzacja:** Token dołącza się do nagłówka każdego chronionego zapytania: `Authorization: Bearer <token>`.
* **Kiosk (tablet):** osobna autoryzacja bez JWT — przez `pairing_token` + `device_id` urządzenia (reguła „jeden token = jeden fizyczny tablet”, wymuszana na REST i WebSocket).
* **Klient (gość):** endpointy dołączenia/śledzenia kolejki (`/queue/join`, `/queue/ticket/{code}`, WS `/queue/ws/{ticket_code}`) są publiczne, bez tokena — identyfikacja po samym kodzie biletu.
* **Dokumentacja kontraktów:** po uruchomieniu backendu wszystkie endpointy, metody (CRUD) i schematy zapytań/odpowiedzi są automatycznie udokumentowane pod `/docs`.
