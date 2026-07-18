# MeetVap Roadmap

This roadmap translates known code-level debt and release-readiness gaps into reviewable work. It is not a promise of dates. Priorities can change after security findings, production evidence, platform policy updates, or contributor discussion.

## Guiding Principles

1. Message durability is more important than cosmetic consistency.
2. Local history must open immediately and remain authoritative for retained content.
3. Protocol changes must respect the supported mobile-version window.
4. Calls should connect quickly before quality adaptation becomes aggressive.
5. Privacy claims must remain narrower than the guarantees implemented in code.

## Current Priorities

### Reliability and verification

- [ ] Add integration tests for create, deduplicate, deliver, acknowledge, read, edit, delete, schedule, disappear, and purge flows.
- [ ] Add multi-device tests covering mobile and browser sessions on one account.
- [ ] Add migration smoke tests against representative production-schema snapshots with anonymized data.
- [ ] Add call setup/reconnect tests for Android, iOS, browser, screen sharing, and weak-network profiles.
- [ ] Add deterministic tests for status audience filtering and 24-hour cleanup.

### Compatibility retirement

These items correspond to explicit removal markers in the server code. Each requires telemetry, a raised minimum app build, and a rollback plan.

- [ ] Remove legacy mobile attestation compatibility after all supported builds submit the current payload.
- [ ] Remove legacy conversation synchronization endpoints after active clients use the replacement flow.
- [ ] Remove the legacy message-queue branch after delivery acknowledgements are confirmed across supported builds.
- [ ] Remove plain legacy mobile acknowledgements after structured content acknowledgements are universal.

### Deployment and operations

- [ ] Add a complete local-development Compose profile for PostgreSQL, Redis, LiveKit, API, and browser clients.
- [ ] Document production reverse-proxy, TLS, media persistence, backups, restoration, and zero-downtime migration procedures.
- [ ] Define metrics and alerts for queue age, push failures, acknowledgement lag, media failures, call setup, and cleanup workers.
- [ ] Add structured, redacted server logging and a documented retention policy for diagnostics.
- [ ] Document horizontal Socket.IO scaling before claiming multi-instance realtime support.

### API and developer experience

- [ ] Publish an OpenAPI specification for stable REST endpoints.
- [ ] Version externally consumed contracts and document deprecation windows.
- [ ] Add webhook signing/versioning documentation and replay protection tests.
- [ ] Add reproducible seed data for local development.

### Catalog and Mini Apps

- [ ] Define a trust model for Catalog content.
- [ ] Decide whether a manifest, navigation allowlist, capability API, and permission model are required.
- [ ] Add operator documentation for CSP, authentication handoff, and safe WebView integration.
- [ ] Do not enable untrusted third-party packages until isolation and permissions are specified.

### Accessibility and localization

- [ ] Add automated dictionary-key parity checks for all mobile languages.
- [ ] Audit dynamic type, screen readers, focus order, contrast, and reduced-motion behavior.
- [ ] Design and test layout direction before introducing right-to-left languages.
- [ ] Expand localized public and administration surfaces without silently falling back for critical text.

## Longer-Term Research

- [ ] Evaluate end-to-end encryption only through a reviewed protocol and threat model; do not create a bespoke cryptographic scheme.
- [ ] Evaluate identity federation and directory synchronization for organizational deployments.
- [ ] Define a supported object-storage abstraction instead of relying only on a mounted media volume.
- [ ] Evaluate regional LiveKit routing and media-edge placement for geographically distributed deployments.
- [ ] Formalize release channels, signed artifacts, software bills of materials, and provenance attestations.

## Completed Foundations

- [x] Native iOS and Android clients with local SQLite message history.
- [x] Browser messenger with persistent browser storage.
- [x] Direct/group messaging, delivery/read states, offline reconciliation, edits, and deletion workflows.
- [x] LiveKit voice/video calls, voice rooms, public meetings, and screen sharing.
- [x] PostgreSQL/Prisma schema and production migration workflow.
- [x] Redis-backed operational caches.
- [x] APNs/FCM push integrations and native incoming-call surfaces.
- [x] Administration console with scoped admin permissions and remote diagnostics controls.
- [x] Status/story publishing, audiences, replies, views, and cleanup.

## Proposing Roadmap Changes

Open a GitHub Discussion describing the user problem, affected components, compatibility impact, security/privacy implications, and an incremental delivery plan. Roadmap acceptance does not automatically assign a release date or maintainer.
