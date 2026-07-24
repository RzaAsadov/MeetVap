# Server roles

The main server owns login-domain routing and the mobile push provider credentials.

```json
{
  "serverRole": "main"
}
```

A child server stores its users and push tokens locally, but relays prepared push requests to the main server:

```json
{
  "serverRole": "child",
  "mainServerHost": "https://mm.meetvap.com",
  "mainServerKey": "copy-the-key-from-the-admin-domain-record"
}
```

In `/admin/sub-domains`, the child record must contain the same key and the public source IP seen by the main API. The main server rejects push requests when the key, source IP, active state, or expiration does not match.
