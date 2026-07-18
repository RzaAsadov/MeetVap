# Contributing to MeetVap

Thank you for improving MeetVap. This repository spans mobile clients, native platform code, a realtime backend, browser applications, an administration console, and supporting PHP surfaces. A small change can cross delivery, storage, and backward-compatibility boundaries, so focused contributions are easier to review and safer to release.

## Before You Start

1. Read the [README](README.md), [product behavior guide](MeetVap.md), and [Code of Conduct](CODE_OF_CONDUCT.md).
2. Search issues and discussions for existing work.
3. Open a discussion before large protocol, database, security, calling, or UX changes.
4. Report vulnerabilities privately through [SECURITY.md](SECURITY.md).

## Development Setup

### Mobile

```bash
npm ci
npm run typecheck
npm run lint
npm start
```

Use `npm run android` or `npm run ios` for a native development build. Native call, notification, screen-sharing, background-location, and purchase behavior cannot be validated in Expo Go.

### Backend

```bash
cp server/.env.example server/.env
cd server
npm ci
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

Use a disposable development database. Never run `prisma migrate dev` against production.

### Browser Applications

```bash
cd web
npm ci
npm run dev

cd ../meet
npm ci
npm run dev
```

### Admin Console

```bash
cd admin
npm ci
cp config.example.json config.json
npm start
```

Keep `admin/config.json` private.

## Branch and Commit Workflow

- Branch from `main` using a short descriptive name such as `fix/duplicate-delivery` or `feature/status-audience`.
- Keep branches short-lived and rebase or merge current `main` before requesting final review.
- Write imperative commit subjects that describe one coherent change.
- Do not combine formatting churn, generated files, and unrelated behavior in one commit.
- Never commit credentials, signing files, production logs, database dumps, or user content.

## Engineering Standards

### Messaging and storage

- Preserve client-generated identifiers and idempotency.
- Persist incoming content locally before acknowledging delivery.
- Treat sent, delivered, and read as distinct states.
- Never replace non-empty local content with a purged/empty server representation.
- Preserve scroll position when prepending local history.
- Test cold start, reconnect, multi-device use, background push, edits, and remote deletion.

### API and database

- Validate untrusted input with Zod or an established route validator.
- Authorize every resource after authentication; possession of an ID is not authorization.
- Add a Prisma migration for every schema change.
- Keep migrations forward-safe and compatible with the deployed application window.
- Do not remove legacy protocol paths until minimum supported client builds have advanced.
- Avoid changing response shapes silently; document contract changes in the pull request.

### Calls and realtime media

- Test Android-to-Android, iOS-to-iOS, cross-platform, and web/mobile calls.
- Verify camera-off state, screen sharing, background transitions, reconnect, and hangup.
- Do not trade startup reliability for aggressive quality adaptation.
- Keep LiveKit diagnostics disabled by default and redact tokens/room credentials.

### UI and accessibility

- Test small/old Android devices and current iPhone layouts.
- Verify keyboard behavior, safe areas, rotation-specific media viewers, dark mode, and localization.
- Avoid unnecessary full-screen rerenders in chat and call surfaces.
- Use existing components, icons, spacing, and interaction patterns.

### Localization

- Add user-facing mobile text to the dictionaries under `src/i18n/`.
- Keep keys aligned across all supported languages; English fallback is not a substitute for a finished translation.
- Verify text expansion and right-to-left implications before adding an RTL language.

## Required Checks

Run the checks relevant to your change:

```bash
npm run lint
npm run typecheck

(cd server && npm run lint && npm run build)
(cd web && npm run build)
(cd meet && npm run build)
node --check admin/server.js
```

There is not yet a comprehensive automated test suite. Include a manual test matrix in the pull request, with device/OS/browser details and failure-path coverage.

## Pull Requests

A reviewable pull request includes:

- the user-visible problem and root cause;
- the chosen design and alternatives considered;
- API/schema/backward-compatibility impact;
- privacy and security impact;
- commands run and manual scenarios tested;
- screenshots or recordings for UI changes;
- deployment and rollback notes;
- documentation and localization updates.

Maintainers may ask for a smaller scope, additional compatibility handling, or migration evidence before merging.

## Generated and Patched Dependencies

Do not edit `node_modules`. Root `npm ci` runs repository-owned post-install scripts under `scripts/`; update those scripts when a dependency patch is still required and explain why it cannot be upstreamed or removed.

## Licensing

By contributing, you agree that your contribution is licensed under the repository's [GNU AGPL v3](LICENSE). Only submit work you have the right to license. Identify third-party code and its license explicitly.
