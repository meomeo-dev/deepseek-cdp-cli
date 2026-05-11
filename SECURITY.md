# Security Policy

## Scope

This public repository covers the open source CLI code, tests, and public
documentation for deepseek-cdp-cli.

Primary security risks:

- Local command execution
- Browser runtime and CDP reuse
- Dependency and supply-chain integrity
- Token, cookie, and browser profile leakage

## Supported Versions

- main
- The latest released version

Historical tags do not receive routine security fixes unless maintainers state
otherwise.

## Report a Vulnerability

Do not report exploitable security issues in public issues.

- Prefer GitHub private vulnerability reporting when available.
- If that channel is unavailable, contact the current maintainers privately.
- Include impact, reproduction steps, affected version, and whether real
  credentials, cookies, browser profiles, or local files are involved.

## Public Security Gates

Public CI runs:

- npm ci
- npm run build
- npm run lint
- npm run typecheck
- npm test
- npm run security:audit
- npm run security:secrets
- npm run security:sast

The public repository is exported from a private upstream through an allowlist.
Private plans, release evidence, local runtime stores, and generated artifacts
are not part of the public source tree.
