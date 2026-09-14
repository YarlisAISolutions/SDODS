---
'@sdods/core': minor
'@sdods/contracts': minor
---

Email assertions over Mailpit. A new `mail` block in the environment yaml (`provider: mailpit`, `url`, optional basic `auth` with a `${VAR}` password) enables seven steps: clear the inbox for an address, wait for an email with a subject within N seconds, assert the latest email's text or sender, save a link or a one-time code from it, and open its link. "The latest email" is scoped to the scenario: only mail received after the scenario started or after the last clear counts, and the wait step pins the message it matched. `@sdods/core` also exports the `MailInbox` interface and `MailpitInbox` adapter.
