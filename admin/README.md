# MeetVap Admin Panel

Standalone admin panel for the MeetVap PostgreSQL backend.

## Setup

1. Edit `config.json`.
   - `databaseUrl`: PostgreSQL connection string for the backend database.
   - `admin.username` / `admin.password`: plaintext admin login for now.
   - `sessionSecret`: change to a long random value.
   - `port`: HTTP port for the admin server.
   - `backendPublicUrl`: backend API base URL, used for webhook URLs and manual-payment server-event notifications.

Set `SERVER_EVENTS_INTERNAL_SECRET` in the repository-root `.env` with the same value used by the backend. Manual subscription grants use it to ask the backend to post the Turkish "Yeni abonelik" message into the configured server-events group.

2. Install dependencies:

```sh
npm install
```

3. Start:

```sh
npm start
```

Then open `http://localhost:4300`.

## Notes

- The admin panel creates `AdminBlockedUser` if it does not already exist.
- The backend migration `000010_admin_blocked_users` also creates this table.
- Blocking a user removes their sessions and the backend rejects future login/API access.
- Phone model is not currently stored by the mobile app. The panel shows available device evidence: push token platform/provider plus session user agent and IP address.
- Dashboard live counters use database state and poll `/api/live` every 5 seconds. Peak online/call counters are tracked in memory since the admin process started; persistent historical online peaks require a backend sampling table.
- New sections include calls, groups, and subscriptions. User detail pages include contacts management, sessions, push devices, reports, calls, groups, and paid entitlements.
- Group detail pages allow admin-side member/admin changes, ownership transfer, and group setting edits.
- Subscription detail pages show Apple/Google identifiers, expiration/renewal state, and the latest raw stored webhook/verification event.
