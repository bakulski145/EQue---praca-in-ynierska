# API - zmiany

Wszystkie dostępne endpointy REST oraz połączenia WebSocket do integracji aplikacji Web (React) oraz Mobile (Flutter).

---

## 1. ZASADY OGÓLNE I AUTORYZACJA

* **Panel Web (Admin/Operator):** Większość endpointów administracyjnych wymaga tokena JWT przesyłanego w nagłówku: `Authorization: Bearer <twój_token_jwt>`
* **Aplikacja Mobile/Kiosk:** Zastosowano uproszczony model bezobsługowy (Opcja A). Kiosk loguje się podając swój token parowania w URL, a goście (pacjenci) dołączają za pomocą QR (lub krótkiego kodu PIN) i łączą się z WebSocketem używając wyłącznie kodu biletu.
* **Format dat:** Standard ISO 8601 (np. `2023-10-25T14:30:00Z`).

---

## 2. APLIKACJA MOBILNA I KIOSK (FLUTTER) - PRZEPŁYW (FLOW)

Tablet jest parowany raz, ręcznie: admin tworzy tablet w panelu webowym (zakładka
Tablety), co generuje stały `pairing_token` — widoczny w panelu i wpisywany
przez instalatora w aplikacji mobilnej, w zakładce "Konfiguracja kiosku". Od
tego momentu kiosk działa bez dalszej interwencji. Każda lokalizacja ma stałą
literę kodu kolejki (`queue_code`, np. "A"), nadawaną automatycznie przy
tworzeniu lokalizacji — to jest kod, który klienci wpisują (lub skanują z
ekranu kiosku) w aplikacji mobilnej, żeby dołączyć do tej konkretnej kolejki.

### KROK 1: Status kiosku i heartbeat (Kiosk/Tablet)
Tablet cyklicznie (co ~20s) odpytuje ten endpoint — działa jako heartbeat
(podtrzymuje status Online) i zwraca stałą literę kolejki lokalizacji oraz kod
aktualnie obsługiwanego biletu, do wyświetlenia na ekranie kiosku.
* **GET** `/api/v1/kiosk/status?tablet_token=<pairing_token>`
* **Auth:** Brak JWT. Autoryzacja przez query param `tablet_token` (zgodny z bazą).
* **Response (200 OK):**
  ```json
  {
    "tablet_id": 3,
    "location_id": 1,
    "location_name": "Rejestracja Ogólna",
    "queue_code": "A",
    "current_ticket_code": "A02"
  }
  ```
  *(Jeśli tablet nie ma jeszcze przypisanej lokalizacji, `location_id`, `location_name`,
  `queue_code` i `current_ticket_code` są `null` — kiosk pokazuje ekran oczekiwania).*

### KROK 2: Dołączenie do kolejki (Telefon pacjenta)
Pacjent wpisuje literę kodu kolejki wyświetloną na ekranie kiosku (np. "A") —
ręcznie albo skanując wyświetlony obok kod QR, który koduje tę samą literę.
* **POST** `/api/v1/queue/join`
* **Auth:** Brak (Endpoint publiczny)
* **Body:**
  ```json
  {
    "queue_code": "A",
    "customer_name": "Jan Kowalski", 
    "appointment_time": null
  }
  ```
* **Response (200 OK):**
  ```json
  {
    "ticket_id": "uuid-biletu-w-bazie",
    "ticket_code": "A12",
    "queue_position": 4,
    "location_id": 1,
    "estimated_wait_time_minutes": 12
  }
  ```
  *(`ticket_code` = `queue_code` lokalizacji + kolejny numer w danym dniu, np. "A01", "A02"... — numeracja resetuje się codziennie per lokalizacja).*

### KROK 3: WebSocket Pacjenta (Telefon)
Aplikacja mobilna po dołączeniu łączy się z dedykowanym gniazdem do nasłuchu.
* **URL:** `ws://<adres_serwera>/api/v1/queue/ws/{ticket_code}` (np. `/api/v1/queue/ws/A12`)
* **Auth:** **BEZ JWT!** Tylko poprawny `ticket_code` w adresie URL.
* **Zdarzenia JSON na gnieździe:**
  * Bilet wezwany do okienka: `{"event": "YOUR_TURN"}`
  * Zmiana pozycji w kolejce: `{"event": "QUEUE_UPDATE", "queue_position": 3, "estimated_wait_time_minutes": 9}`

### KROK 4: Rezygnacja (Samodzielne anulowanie przez pacjenta)
Jeśli pacjent zrezygnuje z czekania, aplikacja wysyła ten request. Zwalnia to kolejkę i aktualizuje aplikacje innych pacjentów.
* **POST** `/api/v1/queue/cancel`
* **Auth:** Brak (Endpoint publiczny)
* **Body:**
  ```json
  {
    "ticket_code": "A12"
  }
  ```
* **Response (200 OK):** `{"message": "Ticket cancelled successfully"}`

---

## 3. PANEL OPERATORA I ADMINA (REACT WEB) - WEBSOCKET

Aplikacja React utrzymuje jedno centralne połączenie dla operatorów.

* **URL:** `ws://<adres_serwera>/api/v1/ws?token=<TWOJ_TOKEN_JWT>`
* **Subskrypcja (wyślij zaraz po połączeniu):**
  ```json
  {
    "type": "subscribe",
    "topics": ["admin", "location:1"] 
  }
  ```
* **Heartbeat:** Należy co 30 sekund wysyłać ping: `{"type": "ping"}`

---

## 4. ENDPOINTY REST - AUTORYZACJA (WEB)

### `POST /api/v1/auth/login`
Logowanie operatora/admina. Standard OAuth2.
* **Body (x-www-form-urlencoded):** `username=jan.kowalski&password=haslo123`
* **Response:**
  ```json
  {
    "access_token": "jwt...", 
    "token_type": "bearer", 
    "id": "uuid", 
    "role": "ADMIN", 
    "full_name": "Jan Kowalski"
  }
  ```

### `GET /api/v1/auth/me`
* **Auth:** Wymaga JWT. Pobiera profil zalogowanego operatora i jego przypisane okienka (`location_ids`).

---

## 5. ENDPOINTY REST - PANEL OPERATORA (OBSŁUGA BILETÓW)

Każda akcja modyfikuje bazę i wypycha powiadomienia WebSocket (do Web i Mobile). Wymagają JWT.

### `GET /api/v1/admin/locations/{id}/queue`
Zwraca aktualny stan kolejki w danej lokalizacji (kto czeka `waiting[]`, kto jest przy okienku `serving`).

### `POST /api/v1/admin/tickets/{id}/call`
Wzywa bilet do okienka (`WAITING` -> `SERVING`). Wysyła event `YOUR_TURN` do pacjenta.

### `POST /api/v1/admin/tickets/{id}/complete`
Kończy obsługę biletu (`SERVING` -> `COMPLETED`). Wysyła `QUEUE_UPDATE` do reszty oczekujących.

### `POST /api/v1/admin/tickets/{id}/cancel`
Anuluje bilet przez operatora (np. gdy pacjent nie podszedł).

---

## 6. ENDPOINTY REST - ZARZĄDZANIE (TYLKO DLA ADMINA)

Pełny CRUD. Wszystkie mutacje powodują emisję zdarzeń na WebSocket (topik `"admin"`). Wymagają tokena admina.

**Użytkownicy (`/api/v1/admin/users`):**
* `GET /`, `POST /`, `PUT /{id}`, `DELETE /{id}`, `POST /{id}/activate`, `POST /{id}/deactivate`

**Lokalizacje / Okienka (`/api/v1/admin/locations`):**
* `GET /`, `POST /`, `PUT /{id}`, `DELETE /{id}`, `POST /{id}/activate`, `POST /{id}/deactivate`
* `POST /` nadaje automatycznie `queue_code` (pierwsza wolna litera A-Z) — nie da się go ustawić ręcznie ani zmienić.

**Tablety / Kioski (`/api/v1/admin/tablets`):**
* `GET /`, `POST /`, `PUT /{id}`, `DELETE /{id}`, `POST /{id}/activate`, `POST /{id}/deactivate`
* `POST /` generuje automatycznie `pairing_token` (zwracany w odpowiedzi) — panel webowy (zakładka Tablety)
  wyświetla go do przepisania w aplikacji mobilnej, w zakładce "Konfiguracja kiosku".