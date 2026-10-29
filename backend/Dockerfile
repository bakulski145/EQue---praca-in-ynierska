FROM --platform=linux/amd64 python:3.11-slim

WORKDIR /app

# Zainstaluj zależności systemowe (często potrzebne dla psycopg2, ale w psycopg2-binary może to nie być aż tak konieczne, mimo to lepiej dodać dla pewności)
RUN apt-get update && apt-get install -y libpq-dev gcc && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Uruchamia migracje, seeding i serwer Uvicorn
CMD ["sh", "-c", "python -m alembic upgrade head && python -m uvicorn main:app --host 0.0.0.0 --port 8000"]
