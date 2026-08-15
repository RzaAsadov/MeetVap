# Server roles

The main server owns login-domain routing and the mobile push provider credentials.

```json
{
  "serverRole": "main"
}
```

A child server remains authoritative for its users, sessions, messages, and push tokens. It relays prepared push requests to the main server and synchronizes a limited administrative user directory:

```json
{
  "serverRole": "child",
  "mainServerHost": "https://mm.meetvap.com",
  "mainServerKey": "copy-the-key-from-the-admin-domain-record"
}
```

In `/admin/sub-domains`, the child record must contain the same key and the public source IP seen by the main API. The main server rejects push, user-directory, and configuration-sync requests when the key, source IP, active state, or expiration does not match.

## Child app-version policy

At startup and every 10 minutes, a child requests `appVersions` from the authenticated main-server API. The main server validates its current `config.json`; the child validates the response, applies it immediately to `/config/client`, and persists it in the child's `config.json` only when the values changed. Conditional requests avoid transferring an unchanged policy.

Deploy the updated main server before updated child servers so the authenticated configuration endpoint exists when child polling begins. A temporary synchronization failure leaves the child's last valid policy active and is retried at the next interval.

## Child user directory

On a child server, registrations, logins, profile/avatar changes, push-token registration, and account deletion enqueue local synchronization events. A worker submits up to 100 events at a time to the main server. Events are removed from the child database only after the main server acknowledges their IDs. Exponential retries and a periodic reconciliation pass recover temporary failures and backfill users that existed before this feature was deployed.

Fresh child registrations also produce a domain-labelled message in `SERVER_EVENTS_GROUP_ID` on the main server. Reconciliation and login events do not produce registration messages, preventing notification floods during deployment. The main `/admin/users` page shows main users with a `Main` server label and a separate read-only child-user directory with each account's subdomain. Child accounts must be managed on their authoritative child server.

The main server stores the mirror in `ChildServerUser`, scoped by the `/admin/sub-domains` record. The Sub-domains details modal shows actual child users separately from usernames that merely requested login routing.

Synchronized fields include username, display name, avatar URL, registration metadata, language, platform, app version/build, installation identifier, device model/OS when supplied, login/seen timestamps, and deletion state. Password hashes, access tokens, attestation material, push-token values, contacts, and message content are never synchronized.

Old app builds continue to work. They may leave device model and OS version empty until a newer mobile build sends `X-MeetVap-Device-Model` and `X-MeetVap-OS-Version`.

Deploy migrations `000069_child_user_sync` and `000070_child_user_sync_reason` to both the main and child databases before restarting their updated server processes.
