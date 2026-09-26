# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately through either route:

- **GitHub private vulnerability reporting:** <https://github.com/YarlisAISolutions/SDODS/security/advisories/new>
- **Email:** security@sdods.com

You will get an acknowledgement within 72 hours.

## Supported versions

Security fixes go into the latest minor release of the `@sdods/*` packages (and the matching server image and desktop app). Upgrade to it to receive them; older minors are not patched.

## Design notes that matter for security

- **Secrets never live in YAML or the database.** Configuration references environment variable names (`${VAR}`); a literal that looks like a secret fails validation. Integrations store env var names only.
- **API tokens** are random 256-bit values shown once, stored as SHA-256 hashes, scoped, expiring and revocable. They are free and unlimited by design.
- **Sessions** are HttpOnly, SameSite=Lax cookies with sliding expiry; non-GET requests require a CSRF header.
- **Agents cannot write to your working tree.** Their only output is a proposal directory that a person accepts.
- **Logs, HAR files and screenshots are redacted**: keys matching password/secret/token patterns are masked; `mask` selectors hide sensitive UI regions.
- **Path safety**: the server refuses paths that escape a project directory and only writes under `features/`, `steps/`, `pages/`, `data/`, `envs/`, `recorded/`, `har/` and the project yaml.
