# Deploy On Ubuntu 24 LTS

These instructions assume PostgreSQL, Redis, and Docker already exist on your Ubuntu server.

## 1. Create Database And User

Run as a PostgreSQL admin user:

```bash
sudo -u postgres psql
```

Inside `psql`:

```sql
CREATE USER messenger WITH PASSWORD 'CHANGE_THIS_PASSWORD';
CREATE DATABASE messenger OWNER messenger;
GRANT ALL PRIVILEGES ON DATABASE messenger TO messenger;
\q
```

## 2. Copy Server Folder

Copy this `server` folder to:

```text
/opt/messenger/server
```

Then:

```bash
cd /opt/messenger/server
cp .env.example .env
nano .env
```

Copy the repository-root `config.json` beside the repository-root `.env` file. It contains retention, upload, cleanup, and send-rate policies.

Set:

```env
NODE_ENV=production
PORT=4000
PUBLIC_API_URL=https://mm.meetvap.com
SERVER_EVENTS_GROUP_ID=cmpnwvdyd04xem526wfymeh43
SERVER_EVENTS_INTERNAL_SECRET=CHANGE_TO_A_LONG_RANDOM_SECRET
DATABASE_URL=postgresql://messenger:CHANGE_THIS_PASSWORD@127.0.0.1:5432/messenger?schema=public
JWT_SECRET=CHANGE_TO_A_LONG_RANDOM_SECRET_AT_LEAST_24_CHARS
CLIENT_ORIGIN=*
UPLOAD_DIR=/home/zrid/messenger/uploads
LIVEKIT_URL=wss://wp.meetvap.com
LIVEKIT_API_KEY=CHANGE_THIS
LIVEKIT_API_SECRET=CHANGE_THIS
```

For two or more LiveKit servers, add a separate JSON file path:

```env
LIVEKIT_SERVERS_CONFIG_PATH=/home/zrid/meetvap/livekit-servers.json
```

If this env value is not set, or the file does not exist, the backend continues using the existing single-server `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` values.

Create `/home/zrid/meetvap/livekit-servers.json`:

```json
[
  {
    "id": "livekit-a",
    "url": "wss://wp.meetvap.com",
    "apiKey": "CHANGE_THIS",
    "apiSecret": "CHANGE_THIS",
    "enabled": true,
    "maxActiveCalls": 100,
    "weight": 1
  },
  {
    "id": "livekit-b",
    "url": "wss://wp2.meetvap.com",
    "apiKey": "CHANGE_THIS",
    "apiSecret": "CHANGE_THIS",
    "enabled": true,
    "maxActiveCalls": 100,
    "weight": 1
  }
]
```

The backend probes configured LiveKit URLs and skips unhealthy servers for new calls. Existing calls remain pinned to the server originally assigned to that call.

Set `SERVER_EVENTS_GROUP_ID` in the root `.env` to receive Turkish `Meetvap Server` messages when LiveKit nodes go down or recover.

## 3. Install And Create Tables

If running directly on the server:

```bash
npm ci
npm run prisma:generate
npm run prisma:deploy
npm run build
npm start
```

Uploads must live outside the `server` folder if you overwrite `server` during deploy. Create the folder once:

```bash
mkdir -p /home/zrid/messenger/uploads
```

The command that creates/updates tables is:

```bash
npm run prisma:deploy
```

It applies SQL from:

```text
prisma/migrations/000001_init/migration.sql
```

If using Docker:

```bash
docker compose -f docker-compose.example.yml build
docker compose -f docker-compose.example.yml run --rm api npx prisma migrate deploy
docker compose -f docker-compose.example.yml up -d
```

## 4. Test

```bash
curl http://127.0.0.1:4000/health
```

Expected:

```json
{"ok":true,"service":"messenger-server"}
```

## 5. Reverse Proxy

Point your domain, for example:

```text
https://chat.example.com
```

to local API:

```text
http://127.0.0.1:4000
```

The mobile app server URL should be:

```text
https://chat.example.com
```
