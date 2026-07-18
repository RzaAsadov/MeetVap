# Security Policy

MeetVap handles messages, media, device sessions, push tokens, call metadata, and administrative operations. Security reports must be handled privately and with enough detail to reproduce the issue without exposing users.

## Supported Versions

Security fixes are prepared for the current `main` branch and the latest released mobile/server versions. Older mobile builds may remain protocol-compatible, but they do not automatically receive security patches.

| Version | Security support |
| --- | --- |
| Current `main` | Supported |
| Latest published release | Supported |
| Older releases | Best effort; upgrade may be required |

## Reporting a Vulnerability

**Do not open a public GitHub issue for a suspected vulnerability.**

Use GitHub's private vulnerability reporting feature when it is enabled for this repository. Otherwise, email `support@meetvap.com` with the subject `[SECURITY] MeetVap vulnerability report`.

Include:

- the affected component and commit/version;
- a clear impact statement;
- reproducible steps or a minimal proof of concept;
- required account role, device state, or deployment configuration;
- relevant logs with tokens, credentials, message content, and personal data removed;
- any known mitigation;
- whether the issue is already public.

We will acknowledge a complete report as soon as practical, validate the impact, coordinate a fix, and agree on disclosure timing. Response time depends on severity and maintainer availability; submitting a report does not guarantee a bounty.

## Disclosure Expectations

- Give maintainers a reasonable opportunity to investigate and release a fix.
- Do not access, modify, retain, or disclose another person's data.
- Do not degrade production availability, send unsolicited messages, or perform denial-of-service testing.
- Do not publish secrets or production logs.
- Test against systems and accounts you own or have explicit permission to use.

## Security Scope

High-priority areas include:

- authentication, session handling, and account recovery;
- conversation membership and group/admin authorization;
- message, media, status, and location access controls;
- mobile app attestation and push-action authorization;
- LiveKit token scope and meeting access;
- subscription, webhook, and internal service-event validation;
- admin-panel privilege boundaries;
- retention, deletion, and local-storage correctness;
- secret exposure in source, logs, builds, or release artifacts.

## Deployment Responsibility

The repository does not provide end-to-end encryption. Operators are responsible for TLS, network isolation, database and media-volume encryption, backups, secret management, log access, reverse-proxy controls, patching PostgreSQL/Redis/LiveKit, and protecting the admin console.

See the [README security section](README.md#security-and-privacy) for the implemented application controls.
