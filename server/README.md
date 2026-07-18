# Messenger Server

Self-hosted backend for the Messenger mobile app.

## Stack

- Node.js + Express
- Prisma ORM
- PostgreSQL
- Socket.IO
- JWT auth

## Local Development

```powershell
cd server
npm install
copy .env.example .env
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

Health check:

```text
GET http://localhost:4000/health
```

## Implemented Endpoints

```text
GET  /health

POST /auth/register
POST /auth/login
GET  /auth/me

GET  /users/search?q=...

GET  /conversations
POST /conversations/direct
GET  /conversations/:conversationId/messages
POST /conversations/:conversationId/messages

POST /media/register
GET  /media/:mediaId

POST /calls
POST /calls/:callId/end
```

## Socket.IO Events

```text
conversation:join
conversation:leave
message:new
typing:start
typing:stop
call:invite
call:ended
presence:ready
```

## Ubuntu Production Shape

Use your existing PostgreSQL and Redis services. This server currently needs PostgreSQL first; Redis will be added when we scale Socket.IO across multiple instances.

```bash
cd /opt/messenger/server
npm ci
npm run prisma:generate
npm run prisma:deploy
npm run build
npm start
```

Set `UPLOAD_DIR` to a persistent folder outside the replaceable `server` directory, for example:

```env
UPLOAD_DIR=/home/zrid/messenger/uploads
PUBLIC_API_URL=https://mm.meetvap.com
```

LiveKit can run with the existing single-server variables:

```env
LIVEKIT_URL=wss://wp.meetvap.com
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

For multiple LiveKit servers, set a path to a separate JSON file. New calls are assigned to the least-loaded enabled server that passes the backend health check:

```env
LIVEKIT_SERVERS_CONFIG_PATH=/home/zrid/meetvap/livekit-servers.json
```

If `LIVEKIT_SERVERS_CONFIG_PATH` is not set, or the file does not exist, the backend falls back to the existing single-server LiveKit variables.

Example `livekit-servers.json`:

```json
[
  {
    "id": "livekit-a",
    "url": "wss://wp.meetvap.com",
    "apiKey": "...",
    "apiSecret": "...",
    "enabled": true,
    "maxActiveCalls": 100,
    "weight": 1
  },
  {
    "id": "livekit-b",
    "url": "wss://wp2.meetvap.com",
    "apiKey": "...",
    "apiSecret": "...",
    "enabled": true,
    "maxActiveCalls": 100,
    "weight": 1
  }
]
```

Copy `config.json` beside the root `.env` file. It controls retention cleanup, attachment limits, send cooldowns, and the message queue hard-delete client build gate. Restart the backend after changing it.

Message queue cleanup is temporarily compatibility-gated. Clients that send hard-delete-ready build headers can have fully ACKed server message rows deleted. Missing/old client builds keep the legacy content-purge behavior. Search `TODO-MEETVAP-REMOVE-LEGACY-MESSAGE-QUEUE` when the legacy branch is safe to remove.

LiveKit pool routing is health-aware. The backend probes configured LiveKit URLs and skips unhealthy servers for new calls. Existing calls remain pinned to the server originally assigned to that call.

If `SERVER_EVENTS_GROUP_ID` is set, LiveKit node down/up transitions are also posted into that group as Turkish server-event messages from `Meetvap Server`.

Full Ubuntu instructions are in [DEPLOY_UBUNTU.md](./DEPLOY_UBUNTU.md).
