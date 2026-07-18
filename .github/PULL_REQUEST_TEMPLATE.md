## Summary

<!-- What problem does this change solve? Keep the scope explicit. -->

## Root Cause and Design

<!-- For fixes, explain the root cause. For features, explain the chosen design and alternatives. -->

## Affected Surfaces

- [ ] Android
- [ ] iOS
- [ ] Browser messenger
- [ ] Public Meet client
- [ ] Backend / database
- [ ] Admin console
- [ ] PHP surfaces
- [ ] Documentation only

## Compatibility

<!-- Address existing mobile builds, API contracts, local SQLite/browser data, migrations, queue semantics, and rollback. Write "Not applicable" only when justified. -->

## Security and Privacy

<!-- Describe authorization, new data, permissions, logs, retention, trust boundaries, and abuse implications. -->

## Verification

Commands run:

```text

```

Manual test matrix:

| Platform/device | Scenario | Result |
| --- | --- | --- |
|  |  |  |

## UI Evidence

<!-- Add before/after screenshots or recordings for user-facing changes. Redact personal data. -->

## Deployment and Rollback

<!-- Include migration order, configuration changes, service restarts, compatibility gates, and rollback limits. -->

## Checklist

- [ ] The change is focused and does not include unrelated refactoring.
- [ ] I ran relevant lint, type, and build checks.
- [ ] I added or updated migrations when the schema changed.
- [ ] I preserved backward compatibility or documented the required minimum build.
- [ ] I updated documentation and localization.
- [ ] I did not commit credentials, signing material, production logs, or user data.
- [ ] I reviewed message durability and acknowledgement order where applicable.
