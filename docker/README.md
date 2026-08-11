# MeetVap Docker deployment

This standalone deployment bundle runs a MeetVap child API, admin panel, LiveKit,
PostgreSQL, Redis, and the two browser applications on one Docker host. It does
not require the MeetVap source repository. Versioned application images are
pulled from GitHub Container Registry.

The nginx image already contains the compiled `web` and `meet` applications.
Nginx serves those files directly; they are not reverse-proxied services. A
generated `runtime-config.js` supplies the installation-specific API domain.

## Public layout

- `https://WEB_DOMAIN` serves the `/web` build.
- `https://MEET_DOMAIN` serves the `/meet` build.
- `https://SERVER_DOMAIN` proxies the API and Socket.IO server.
- `https://ADMIN_DOMAIN` proxies the admin panel.
- `wss://SERVER_DOMAIN/rtc` proxies LiveKit signaling.

Nginx is the only container that binds host ports 80 and 443. LiveKit also
publishes the media and TURN ports required by WebRTC.

## Prerequisites

Install Docker Engine with the Compose plugin. No Node.js, PostgreSQL, Redis,
or application source checkout is required. Before installation:

1. Point the web, meet, server, and admin domain DNS records to the Docker host.
2. Make sure ports 80 and 443 are not occupied by another web server.
3. Open these firewall ports:

```text
80/tcp
443/tcp
3478/udp
5349/tcp
7881/tcp
7882/udp
```

Do not proxy the server domain through a CDN that cannot pass LiveKit
WebSockets and WebRTC traffic.

## Installation

```sh
git clone https://github.com/OWNER/docker-deployment-repository.git
cd docker-deployment-repository
./install.sh
```

The installer asks for the web, meet, child-server, and separate admin domains,
the main server hostname, the child relay key created by the main server
administrator, and the desired local admin username and password. PostgreSQL,
JWT, admin-session, internal-service, and LiveKit secrets are generated
automatically.
The main server defaults to `https://mm.meetvap.com` when the installer prompt
is left empty.

Before installation, create or edit the matching entry in the main server's
Admin > Sub-domains section. Copy its main-server key into the installer and
whitelist the child host's public origin IP. The generated operational config
always uses `serverRole: child`.

The default application images are:

```text
ghcr.io/rzaasadov/meetvap-server
ghcr.io/rzaasadov/meetvap-admin
ghcr.io/rzaasadov/meetvap-nginx
```

These packages must be public for anonymous installation. For private packages,
run `docker login ghcr.io` before `install.sh`.

The installer obtains one Let's Encrypt certificate containing all four
domain names. Certbot renews it in a sidecar, and nginx reloads periodically to
pick up renewed files.

## Generated configuration

Private files are written under `docker/generated/` and ignored by Git:

- `config.json`: operational API policy.
- `admin-config.json`: Docker database URL, admin login, and backend public URL.
- `livekit.yaml`: LiveKit, Redis, RTC, and TURN configuration.
- `livekit-servers.json`: public LiveKit URL and private health URL.
- `nginx.conf`: domain-specific virtual hosts.
- `runtime-config.js`: API hostname consumed by both browser applications.
- `server-optional.env`: App Attest identifiers and optional store credentials.

The admin database URL uses the internal hostname `postgres`. Its
`backendPublicUrl` is always `https://SERVER_DOMAIN`.
Both the API and admin containers read `livekit-servers.json`. Clients receive
the public `wss://SERVER_DOMAIN` URL, while server-side health checks use the
private Docker address `http://livekit:7880` and do not depend on public DNS or
nginx availability.

If `config/config.json` exists, installation uses it as the operational config
template. Otherwise `config/config.example.json` is used. A custom template
must retain the `__MAIN_SERVER_HOST__` and `__MAIN_SERVER_KEY__` placeholders;
the installer replaces them without committing the relay key. Edit the
generated file for operational policy changes, then restart the API and admin
containers.

## Push relay and store credentials

The child server does not use FCM or APNs provider credentials. It stores client
push tokens and relays push requests to the configured main server; the main
server owns Firebase and Apple Push Notification service credentials and sends
provider notifications.

Apple App Store and Google Play purchase verification are separate from push
delivery. If purchases are verified on this child, put those optional billing
credential files in `secrets/`, then update `generated/server-optional.env`.
Paths inside the API container start with `/run/secrets/meetvap/`.

The installer writes MeetVap's non-secret App Attest App ID prefix and iOS
bundle identifier to this file. Keep `APPLE_APP_ATTEST_ALLOW_DEVELOPMENT=false`
on production child servers. App Attest verification does not require an Apple
private key.

Example:

```env
GOOGLE_SERVICE_ACCOUNT_PATH=/run/secrets/meetvap/google-service-account.json
APPLE_APP_ATTEST_APP_ID_PREFIX=4H68W59Z24
APPLE_APP_ATTEST_ALLOW_DEVELOPMENT=false
APPLE_BUNDLE_ID=com.meetvap.app
APPLE_SHARED_SECRET=replace-with-store-shared-secret
```

Restart the API after changing optional environment values:

```sh
docker compose -f compose.yml up -d --force-recreate server
```

## Operations

```sh
./update.sh
./backup.sh
./restore.sh backups/20260804T120000Z
docker compose -f compose.yml ps
docker compose -f compose.yml logs -f server
```

`update.sh` pulls the configured application version, applies Prisma migrations,
and performs a controlled container replacement. Set `MEETVAP_VERSION` in
`.env` to pin an immutable release such as `21.7.0`; use `latest` to follow the
most recently published release. Named volumes preserve PostgreSQL, Redis,
uploads, certificates, and ACME state.

## Publishing application images

The MeetVap source repository publishes images when a `v*` Git tag is pushed.
The source workflow builds the server, admin, and the combined nginx/web/meet
image for both `linux/amd64` and `linux/arm64`. Copy the contents of this
directory into a separate GitHub repository to provide the exact clone and
install flow shown above.

## Testing without publishing images

To test unpublished code, create a minimal build archive from the MeetVap source
repository. It contains only `.dockerignore`, `admin`, `docker`, `meet`,
`server`, and `web`; mobile and unrelated application sources are excluded.

```sh
./docker/export-local-build.sh
scp /tmp/meetvap-local-build.tar.gz user@linux-host:/tmp/
```

On the Linux host, extract it:

```sh
mkdir -p /opt/meetvap-build
tar -xzf /tmp/meetvap-local-build.tar.gz -C /opt/meetvap-build
cd /opt/meetvap-build
```

Then enter the deployment directory and use local-image mode:

```sh
cd docker
./install.sh --local-images
```

This mode builds `meetvap-server:test`, `meetvap-admin:test`, and
`meetvap-nginx:test` directly from the extracted bundle, then pulls only the
third-party PostgreSQL, Redis, LiveKit, and Certbot images.
It never contacts GHCR for MeetVap application images. After later source
changes, replace the extracted source bundle and run `./update.sh`; local mode
automatically rebuilds all three images before applying migrations and replacing
containers.

PostgreSQL and Redis are restricted to the private Docker network. The API,
admin, and LiveKit signaling ports are reachable only through nginx; only the
explicit LiveKit RTC/TURN ports are published directly.
