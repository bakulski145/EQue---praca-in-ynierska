# eQue — specyfikacja API, modelu danych i WebSocketu

Dokument dla osoby ogarniającej backend. Cel: zastąpić realnym API wszystko, co
panel admina (`web/`) na razie trzyma w `localStorage` i symuluje w JS
(statusy online/offline, "aktualny kod" na tablecie, obecność operatorów,
logowanie operatorów). Poniżej: co już jest w `backend/`, co trzeba dobudować,
gdzie obecny model danych nie pasuje do tego, co robi frontend, oraz projekt
WebSocketu.

Konwencje nazewnictwa trzymam zgodnie z tym, co już jest w kodzie
(`models.py` używa `is_active`, `snake_case`, SQLAlchemy `Mapped[...]`).

---

## 1. Stan obecny — co już działa

Stack: FastAPI + PostgreSQL (SQLAlchemy + Alembic) + JWT (PyJWT/bcrypt).
Redis jest w `docker-compose.yml` i `requirements.txt`, ale **nic go jeszcze
nie używa** — to się przyda pod WebSocket (patrz sekcja 6).

Tabele: `admins` (id, username, password_hash), `service_points` (id, name,
category, is_active), `tablets` (id, name, location, service_point_id),
`tickets` (id, ticket_code, status, joined_at, service_point_id).

Endpointy: `POST /api/v1/auth/login` (działa, tylko dla admina),
`GET /api/v1/kiosk/status`, `POST /api/v1/queue/join` (oba wdrożone — patrz sekcja 4),
CRUD `GET/POST/PUT/DELETE /api/v1/admin/tablets` (działa na realnej bazie).

**Uwaga historyczna:** ta sekcja opisywała stan projektu sprzed refaktoryzacji
z sekcji 2-4 (parowanie QR, `service_points`, `admins`) — większość z tego
zostało już wdrożone zgodnie z rekomendacjami poniżej; traktuj resztę
dokumentu (sekcje 2-8) jako źródło prawdy o bieżącym modelu i endpointach.

**Ważne, zanim ktokolwiek zacznie kodować:** żaden endpoint `/api/v1/admin/*`
nie jest dziś niczym chroniony — `verify_password`/`create_access_token`
istnieją, ale nie ma `Depends(get_current_user)` na trasach. To trzeba
domknąć równolegle z resztą, bo inaczej cały panel admina zostaje otwarty
bez tokena.

---

## 2. Rozbieżności między backendem a frontendem (decyzje do podjęcia)

1. **`admins` vs koncepcja "Użytkownicy" z frontendu.** Zakładka Użytkownicy
   w panelu trzyma jedną listę osób z polem roli (`Operator` / `Admin`) —
   admin to po prostu wpis z inną rolą, nie osobna tabela. Rekomendacja:
   `admins` → zastąpić jedną tabelą `users` z `role` (`ADMIN`/`OPERATOR`).
   Trzeba przenieść istniejący wpis bootstrapowego admina (seed: `admin` /
   `admin123`) do nowej tabeli.

2. **Operatorzy w ogóle nie mają dziś backendu.** Frontend loguje operatora
   sprawdzając hasło w plaintext w `localStorage` po stronie klienta
   (`LoginForm.tsx`) — to czysta atrapa, zero bezpieczeństwa. Po zmianie z
   pkt. 1 login powinien sprawdzać jedną tabelę `users` niezależnie od roli.

3. **Niespójny "login".** Dziś admin loguje się przez osobne pole
   `username` ("admin"), a operator przez swoje **imię i nazwisko**
   (`fullName`). Rekomendacja: każdy `user` dostaje własne pole `username`
   (ustawiane przy tworzeniu konta, niezależne od `full_name`) — spójne dla
   obu ról i nie psuje się przy zmianie wyświetlanego imienia.

4. **`tablets.location` (tekst) vs `service_point_id` (FK) — realna
   kolizja.** W `seed.py` tablet wejściowy ma `location="Hol Główny"` i
   `service_point_id=None`, czyli "Hol Główny" jako lokalizacja **nie
   istnieje** jako osobny `service_point`. Frontend tak nie działa — w
   panelu "Hol Główny" jest pełnoprawną lokalizacją (`loc1`), do której
   przypisany jest tablet, i cała logika kaskadowej dezaktywacji (patrz
   pkt. niżej) opiera się na jednej relacji FK, nie na dwóch równoległych
   polach. Rekomendacja: **usunąć `tablets.location` (string)**, a każde
   miejsce — łącznie z holem/wejściem — modelować jako realny rekord w
   `locations` (nawet bez aktywnej kolejki, np. `category="Informacja"`).
   Jedno źródło prawdy: `tablets.location_id`.

5. **`tablets` nie ma `is_active`.** Potrzebne pod dezaktywację tabletu
   (patrz sekcja 4).

6. **Nazwy statusów ticketu.** Backend ma `WAITING/SERVING/COMPLETED/CANCELLED`,
   frontendowy mockup (`UserQueue.tsx`) myślał w kategoriach
   waiting/serving/served/skipped. To tylko nazewnictwo — **zostawić
   istniejące wartości w bazie**, frontend zmapuje `COMPLETED → "served"`,
   `CANCELLED → "skipped"` u siebie. Nie ma potrzeby ruszać enuma w DB.

7. **Reguła "1 tablet = max 1 lokalizacja"** jest dziś pilnowana tylko w JS
   (frontend automatycznie odłącza poprzedni tablet przy ponownym
   przypisaniu). Backend powinien to wymusić też na poziomie bazy:
   `UNIQUE` na `tablets.location_id` (Postgres pozwala na wiele wartości
   `NULL` przy `UNIQUE`, więc wiele nieprzypisanych tabletów nie koliduje).

---

## 3. Model danych — docelowy

Legenda: 🆕 nowa tabela, 🔧 zmiana istniejącej, ✅ bez zmian.

### 🔧 `locations` (dziś `service_points`, rekomenduję też zmianę nazwy tabeli/klasy na `Location`, żeby nazewnictwo 1:1 odpowiadało zakładce "Lokalizacje")

| pole | typ | uwagi |
|---|---|---|
| `id` | int, PK | bez zmian |
| `name` | String(100) | bez zmian |
| `description` | String(255), nullable | **nowe** — frontend ma to pole (`AdminLocations.tsx`), dziś go nie ma |
| `category` | String(100) | zostaje, frontend go nie używa, ale niech będzie na przyszłość |
| `is_active` | bool, default `True` | bez zmian — używane przy dezaktywacji |
| `queue_code` | String(2), unique | **wdrożone** — stała litera kolejki (np. "A"), nadawana automatycznie (pierwsza wolna A-Z) przy tworzeniu lokalizacji. Klient wpisuje ją w aplikacji mobilnej, żeby dołączyć do kolejki tej lokalizacji; jest też prefiksem `ticket_code` (np. "A01"). |

Relacje: `1—N` do `tablets` (ale logicznie max 1 aktywny dzięki `UNIQUE`),
`N—N` do `users` przez tabelę łączącą (niżej), `1—N` do `tickets`.

### 🆕 `users` (zastępuje `admins`)

| pole | typ | uwagi |
|---|---|---|
| `id` | UUID, PK | |
| `username` | String(50), unique, indexed | login, niezależny od `full_name` |
| `full_name` | String(120) | "Jan Kowalski" |
| `position` | String(120), nullable | "stanowisko", np. "Lekarz kardiolog" |
| `role` | String(20) — `"ADMIN"` / `"OPERATOR"` | enum string jak przy `tickets.status` |
| `password_hash` | String(255) | bcrypt, jak dziś |
| `is_active` | bool, default `True` | |
| `created_at` | DateTime(timezone=True) | |

### 🆕 `user_locations` (tabela łącząca, many-to-many)

| pole | typ |
|---|---|
| `user_id` | UUID, FK → `users.id`, część PK |
| `location_id` | int, FK → `locations.id`, część PK |

Composite PK `(user_id, location_id)`. Operatorzy z rolą `ADMIN` mają
"dostęp globalny" w UI — w bazie to po prostu brak wierszy w tej tabeli dla
tego usera (frontend już dziś interpretuje pusty `locationIds` u admina
jako "wszędzie", nic do zmiany).

### 🔧 `tablets`

| pole | typ | uwagi |
|---|---|---|
| `id` | int, PK | bez zmian |
| `name` | String(100) | bez zmian, może być pusty string (frontend pokazuje wtedy "Nazwa nie została ustawiona") |
| ~~`location`~~ | — | **usunąć** (patrz pkt. 2.4) |
| `location_id` | int, FK → `locations.id`, nullable, **UNIQUE** | zmiana nazwy z `service_point_id` dla spójności z frontendem (`locationId`) |
| `is_active` | bool, default `True` | **nowe** |
| `last_seen_at` | DateTime(timezone=True), nullable | **nowe** — bije heartbeat przez `GET /kiosk/status`, online = `now - last_seen_at < 45s`. Nie trzymać osobnego boola `online`, bo zostaje "zawieszony" gdy tablet padnie bez grzecznego rozłączenia. |
| `pairing_token` | String(64), nullable | **wdrożone** — generowany automatycznie przy `POST /admin/tablets`, zwrócony w odpowiedzi i wyświetlony w panelu webowym (zakładka Tablety) do ręcznego wpisania w aplikacji mobilnej ("Konfiguracja kiosku"). Stały, nie wygasa — to nie jest już jednorazowy token parowania QR (patrz sekcja 4, "Kiosk"). |

### 🔧 `tickets`

| pole | typ | uwagi |
|---|---|---|
| `id` | UUID, PK | bez zmian |
| `ticket_code` | String(10), indexed | bez zmian |
| `status` | String(20) | bez zmian — `WAITING/SERVING/COMPLETED/CANCELLED` |
| `joined_at` | DateTime(timezone=True) | bez zmian |
| `called_at` | DateTime(timezone=True), nullable | **nowe** — kiedy operator wezwał |
| `served_at` | DateTime(timezone=True), nullable | **nowe** — kiedy zakończono/anulowano |
| `customer_name` | String(120), nullable | **nowe** — opcjonalne imię/nazwisko z formularza dołączenia do kolejki |
| `appointment_time` | String(20), nullable | **nowe** — np. "09:15", jeśli wizyta z rejestracji, nie walk-in |
| `served_by_user_id` | UUID, FK → `users.id`, nullable | **nowe** — który operator obsługuje/obsłużył |
| `location_id` | int, FK → `locations.id` | zmiana nazwy z `service_point_id` |

---

## 4. Endpointy REST

Prefiks i konwencja jak dziś: `/api/v1/...`, zasoby admina pod
`/api/v1/admin/...`, wszystko poza `auth`/`kiosk`/`queue` wymaga nagłówka
`Authorization: Bearer <token>`.

### Auth

| metoda | ścieżka | opis |
|---|---|---|
| POST | `/api/v1/auth/login` | 🔧 dziś sprawdza tylko `admins`; ma sprawdzać `users` (dowolna rola). Response rozszerzyć o `role`, `full_name`, `id` — frontend dziś od razu po loginie potrzebuje wiedzieć kim jest, nie tylko mieć token. |
| GET | `/api/v1/auth/me` | 🆕 zwraca profil aktualnie zalogowanego na podstawie tokena (`id`, `full_name`, `role`, `location_ids`). Frontend dziś *ufa* temu, co sam zapisał w `localStorage` — to jedyne miejsce, gdzie warto to zweryfikować po stronie serwera. |

### Users (zakładka Użytkownicy)

| metoda | ścieżka | opis |
|---|---|---|
| GET | `/api/v1/admin/users` | lista: `id, username, full_name, position, role, is_active, location_ids[]` |
| POST | `/api/v1/admin/users` | `full_name, position?, role, username, password, location_ids?` |
| PUT | `/api/v1/admin/users/{id}` | edycja danych + `location_ids`; `password` opcjonalny (puste = nie zmieniaj, dokładnie jak dziś robi to UI) |
| POST | `/api/v1/admin/users/{id}/activate` | |
| POST | `/api/v1/admin/users/{id}/deactivate` | **kaskada**: `is_active=False`, czyści wszystkie wiersze tego usera w `user_locations` |
| DELETE | `/api/v1/admin/users/{id}` | kaskadowo usuwa wiersze w `user_locations` |

### Locations (zakładka Lokalizacje)

| metoda | ścieżka | opis |
|---|---|---|
| GET | `/api/v1/admin/locations` | lista: `id, name, description, is_active, tablet (id+name albo null), user_ids[]` |
| POST | `/api/v1/admin/locations` | `name, description?` |
| PUT | `/api/v1/admin/locations/{id}` | `name, description, tablet_id?, user_ids[]` — serwer sam odłącza tablet od poprzedniej lokalizacji jeśli `tablet_id` był już gdzie indziej przypisany (constraint `UNIQUE` to wymusi, ale ładniej zrobić to świadomie w logice, nie liczyć na 500 z bazy) |
| POST | `/api/v1/admin/locations/{id}/activate` | |
| POST | `/api/v1/admin/locations/{id}/deactivate` | **kaskada**: `is_active=False`, `tablets.location_id=NULL` dla przypisanego tabletu, czyści wiersze w `user_locations` dla tej lokalizacji |
| DELETE | `/api/v1/admin/locations/{id}` | kaskadowo jak wyżej + usuwa wiersze |

### Tablets (zakładka Tablety)

| metoda | ścieżka | opis |
|---|---|---|
| GET | `/api/v1/admin/tablets` | 🔧 dorzucić do response: `is_active`, `online` (liczone z `last_seen_at`), `current_ticket_code` (kod najnowszego ticketu o statusie `SERVING` dla `location_id` tabletu, albo `null`) |
| POST | `/api/v1/admin/tablets` | 🔧 `name, location_id?` (bez `location` stringa) |
| PUT | `/api/v1/admin/tablets/{id}` | 🔧 `name, location_id?` — wymusza unikalność, patrz wyżej |
| POST | `/api/v1/admin/tablets/{id}/activate` | |
| POST | `/api/v1/admin/tablets/{id}/deactivate` | **kaskada**: `is_active=False`, `location_id=NULL` |
| DELETE | `/api/v1/admin/tablets/{id}` | ✅ już jest |

### Parowanie tabletu — token ręczny, nie QR jednorazowy

Zdecydowano inaczej niż pierwotny projekt tej sekcji: parowanie jest ręczne i
jednorazowe, bez skanowania QR ani wygasających tokenów.

| metoda | ścieżka | opis |
|---|---|---|
| POST | `/api/v1/admin/tablets` | ✅ **wdrożone** — tworzy wiersz w `tablets` (pusta `name`, `location_id=NULL`, `is_active=True`) i **od razu** generuje stały `pairing_token`, zwrócony w odpowiedzi. Panel webowy (zakładka Tablety) wyświetla ten token operatorowi. |
| GET | `/api/v1/kiosk/status` | ✅ **wdrożone** — heartbeat + stan kiosku. Tablet odpytuje cyklicznie (~20s) z `?tablet_token=<pairing_token>` (query param, bez JWT); serwer bije `last_seen_at` i zwraca `queue_code` + `current_ticket_code` lokalizacji przypisanej temu tabletowi (albo `null`, jeśli tablet nie ma jeszcze przypisanej lokalizacji — admin przypisuje ją później w zakładce Tablety/Lokalizacje). |

Instalator wpisuje `pairing_token` ręcznie w aplikacji mobilnej, w zakładce
"Konfiguracja kiosku" — od tego momentu tablet zaczyna odpytywać
`/kiosk/status` i działa jako kiosk, niezależnie od tego, czy ma już
przypisaną lokalizację.

### Queue / Tickets

| metoda | ścieżka | opis |
|---|---|---|
| POST | `/api/v1/queue/join` | ✅ **wdrożone** — body `{ queue_code, customer_name?, appointment_time? }`. `queue_code` to stała litera lokalizacji (np. "A"), wpisana ręcznie przez klienta albo zeskanowana z QR na ekranie kiosku (który koduje tę samą literę). Tworzy `Ticket(status="WAITING")`, generuje `ticket_code` = `queue_code` + dwucyfrowy numer w danym dniu (reset codziennie per lokalizacja, np. "A01", "A02"...), zwraca kod i pozycję w kolejce. |
| GET | `/api/v1/admin/locations/{id}/queue` | ✅ wdrożone — lista oczekujących (`status=WAITING`, sortowane po `joined_at`) + aktualnie obsługiwany (`status=SERVING`) |
| POST | `/api/v1/admin/tickets/{id}/call` | ✅ wdrożone — `status→SERVING`, `served_by_user_id=<zalogowany>`, `called_at=now` |
| POST | `/api/v1/admin/tickets/{id}/complete` | ✅ wdrożone — `status→COMPLETED`, `served_at=now` |
| POST | `/api/v1/admin/tickets/{id}/cancel` | ✅ wdrożone — "nie zgłosił się" → `status→CANCELLED`, `served_at=now` |

### Dashboard (opcjonalnie, ale polecam)

| metoda | ścieżka | opis |
|---|---|---|
| GET | `/api/v1/admin/dashboard/summary` | 🆕 zwraca gotowe liczniki: aktywne/wszystkie tablety, użytkownicy, lokalizacje, ile tabletów online teraz. Pulpit dziś liczy to sam z pełnych list pobranych po REST — przy większej liczbie rekordów lepiej policzyć to raz po stronie bazy (`COUNT`/`WHERE`) niż ciągnąć wszystko do frontu tylko po to, żeby zliczyć. |

---

## 5. WebSocket

Frontend dziś **udaje** czas rzeczywisty: każdy tab ustawia `setInterval`
co 8s i lokalnie losuje, czy dany tablet/operator jest online. To wszystko
ma zniknąć na rzecz prawdziwych push'y z serwera. Cel: jedno długo żyjące
połączenie na klienta, zero pollingu REST.

### Połączenie

`WS /api/v1/ws?token=<jwt>` — jeden endpoint, multipleksowany po typach
zdarzeń, zamiast osobnych socketów per zasób (mniej połączeń = mniej
narzutu po stronie serwera i przeglądarki). Token w query string przy
handshake (WS nie ma nagłówków po stronie przeglądarki w prosty sposób);
ten sam token co REST.

Tablety łączą się tym samym endpointem, ale swoim `device_token` z
parowania zamiast tokena admina/operatora.

### Subskrypcje (filtrowanie po stronie serwera, nie klienta)

Zaraz po połączeniu klient wysyła:

```json
{ "type": "subscribe", "topics": ["admin"] }
```

albo, dla tabletu/kiosku, który obchodzi tylko jego własna lokalizacja:

```json
{ "type": "subscribe", "topics": ["location:42"] }
```

Topik `"admin"` = wszystko (panel admina chce widzieć zmiany wszędzie).
Topik `"location:{id}"` = tylko zdarzenia dotyczące tej lokalizacji
(kolejka, status własnego tabletu). To jest sedno wydajności: tablet na
sali 12 nie powinien dostawać eventów o zmianach w lokalizacji 3 —
filtrowanie ma siedzieć po stronie serwera (przy publikacji do Redis/WS),
nie być ignorowane po stronie klienta.

### Zdarzenia serwer → klient (tylko delta, nie pełny obiekt za każdym razem)

| `type` | payload | kiedy |
|---|---|---|
| `device.status` | `{ tablet_id, online }` | zmiana online/offline (na podstawie heartbeatu) |
| `device.updated` | `{ tablet }` | po CRUD (nazwa/lokalizacja/aktywność) |
| `device.created` / `device.deleted` | `{ tablet_id }` | |
| `user.presence` | `{ user_id, status }` (`online/away/offline`) | zmiana obecności operatora |
| `user.updated` / `user.created` / `user.deleted` | `{ user }` / `{ user_id }` | |
| `location.updated` / `location.created` / `location.deleted` | `{ location }` / `{ location_id }` | |
| `ticket.created` | `{ location_id, ticket }` | dołączenie do kolejki |
| `ticket.updated` | `{ location_id, ticket }` | wezwanie / zakończenie / anulowanie — to jest też sposób, w jaki tablet dowiaduje się o nowym "aktualnym kodzie" bez osobnego eventu |

### Heartbeat = jedyny mechanizm wykrywania online/offline

Zamiast REST-owego pollingu albo ręcznego przełącznika: klient (tablet i
panel operatora) wysyła co ~20s:

```json
{ "type": "ping" }
```

Serwer po każdym pingu aktualizuje `last_seen_at`. Osobny lekki task w tle
(co kilka sekund) przegląda rekordy, których `last_seen_at` jest starsze
niż ~45s i nadal oznaczone jako online — przestawia na offline i emituje
`device.status`/`user.presence`. Rozłączenie samego socketu (`on_disconnect`)
robi to samo natychmiast, bez czekania na timeout — heartbeat jest tylko
siatką bezpieczeństwa na wypadek, gdy klient padnie bez grzecznego
zamknięcia połączenia (np. tablet traci prąd).

To dokładnie zastępuje dzisiejsze `Math.random()` w `AdminDashboard.tsx` /
`AdminUsers.tsx` — różnica jest taka, że stan jest teraz prawdziwy i
identyczny dla każdego podłączonego klienta, bo liczy go serwer, a nie
każda karta przeglądarki osobno.

### Redis — po co, skoro już jest w `docker-compose.yml`

Jeśli backend kiedykolwiek pojedzie na więcej niż jednym procesie/replice
Uvicorna (load balancing, kilka workerów), broadcast "w pamięci" jednego
procesu nie dotrze do klientów podłączonych do innego procesu. Redis
pub/sub jest do tego gotowy i nieużywany — rekomendacja: każda mutacja
(CRUD, zmiana statusu ticketu, heartbeat-timeout) publikuje event na kanał
Redis (np. `eque:events`), a każdy proces backendu ma subskrybenta tego
kanału, który rozsyła dalej do swoich lokalnie podłączonych WebSocketów,
filtrując po `topics` z subskrypcji klienta. Działa identycznie przy jednym
procesie i przy wielu — różnica jest niewidoczna z poziomu klienta, ale
oszczędza przepisywania tego później pod presją.

---

## 6. Sugerowana kolejność wdrożenia

1. Auth: dociągnąć `Depends(get_current_user)` na trasy `/admin/*` (dziś
   nic nie chroni endpointów) + migracja `admins` → `users` z `role`.
2. CRUD `users` + `user_locations` (zakładka Użytkownicy przestaje używać
   `localStorage`).
3. CRUD `locations` (rozszerzenie `service_points` o `description`,
   zmiana nazwy pól) + kaskady dezaktywacji.
4. `tablets`: dodać `is_active`, `location_id` (zamiast `location` stringa
   + `service_point_id`), `last_seen_at`, kaskady, `UNIQUE` na
   `location_id`.
5. Realny `queue/join` + endpointy `call/complete/cancel` na ticketach.
6. WebSocket + heartbeat (na końcu — ma sens dopiero gdy REST-owe zasoby,
   które opisuje, już istnieją).
7. Parowanie QR (`/kiosk/pair`) — może iść równolegle z resztą, jest
   odizolowane.
8. `dashboard/summary` — czysty bonus wydajnościowy, nieblokujący.
