# MeetVap Support

Choose the channel that matches the problem. This keeps security reports private and gives maintainers enough information to reproduce product failures.

## Where to Ask

| Need | Channel |
| --- | --- |
| Reproducible software defect | GitHub bug report |
| Feature or protocol proposal | GitHub Discussion first |
| Installation or self-hosting question | GitHub Q&A Discussion |
| Security vulnerability | Private process in `SECURITY.md` |
| Community conduct issue | Private process in `CODE_OF_CONDUCT.md` |
| MeetVap service/account support | In-app support or `support@meetvap.com` |

## Before Reporting a Bug

1. Confirm the issue on the latest available build/commit.
2. Search existing issues.
3. Reduce the problem to the smallest repeatable sequence.
4. Record platform, OS, app version/build, server commit, and network state.
5. Remove JWTs, push tokens, LiveKit credentials, usernames, message content, IP addresses, and other personal data from logs.

For message-delivery issues, include sender/recipient platform, whether each app was foreground/background/terminated, multi-device/browser state, message kind, and expected delivery/read transitions. For call issues, include caller/callee platforms, call type, camera state, network type, setup time, and whether media flowed in each direction.

## What Maintainers Cannot Provide

Community support cannot guarantee production incident response, data recovery, legal/compliance advice, infrastructure operation, App Store/Play Console account management, or private customization. Organizations should establish their own monitoring, backups, escalation path, and deployment ownership.

## Logs and Diagnostics

Do not upload full production logs to public issues. Use the narrowest diagnostic window possible, redact sensitive values, and share security-sensitive evidence privately. Remote diagnostics must be explicitly enabled for the affected user and disabled after collection.
