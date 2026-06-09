```markdown
# CLAUDE.md — Ghost Playwright Suite

## Project Context

This is a Playwright TypeScript test suite for Ghost CMS (v6.43.1), targeting
https://ghost.wsrportfolio.dev. It is part of a professional QA portfolio (WSR-Portfolio on GitHub)
demonstrating senior-level test automation skills.

The test target is a self-hosted Ghost instance running on a dedicated Linux host (Intel i7,
16 GB RAM) via Docker, exposed through a Cloudflare Tunnel. It is a controlled test environment
with no real users. (It previously ran on a low-powered Synology NAS; several ADRs reference
that earlier hardware as the rationale for environmental accommodations like sequential
execution and enlarged timeouts.)

## Stack

- Language: TypeScript
- Test runner: Playwright
- Node.js: 20+
- Auth intercept: Mailpit (local SMTP, http://<mailpit-host>:8025)

## Environment Variables

All secrets come from .env (local) or GitHub Actions secrets (CI). Never hardcode values.

GHOST_URL            — https://ghost.wsrportfolio.dev
GHOST_ADMIN_API_KEY  — format: {id}:{secret} — used to generate JWT tokens
GHOST_CONTENT_API_KEY — used as a query parameter, not a header
GHOST_ADMIN_EMAIL    — admin login email
GHOST_ADMIN_PASSWORD — admin login password
MAILPIT_URL          — http://<mailpit-host>:8025

## Ghost Admin API Authentication — Critical

The Admin API key CANNOT be used directly as a Bearer token. It must be used to generate a
short-lived JWT on every request.

Key format: {id}:{secret} — split on the colon.

JWT generation:
  - Sign with Buffer.from(secret, 'hex')
  - Algorithm: HS256
  - Audience: '/admin/'
  - Expiry: 5 minutes
  - keyid: the id portion

Request header: Authorization: Ghost {token}

Content API uses: ?key={GHOST_CONTENT_API_KEY} — no JWT, no Authorization header.

## Ghost Member Authentication

Ghost members do not use passwords. Authentication is exclusively via magic links sent to email.
Mailpit intercepts these emails on the local Docker network. Tests retrieve the magic link from
the Mailpit API and navigate to it in the browser.

## Coding Conventions

- TypeScript only — no JavaScript files
- Use Playwright's built-in request fixture for API calls — not fetch or axios
- Use Playwright's expect() for all assertions — no third-party assertion libraries
- Selector priority: data-testid > role > label > text > CSS (last resort)
- Never use page.waitForTimeout() — use expect(locator).toBeVisible() or waitForURL()
- All test email addresses use generateTestEmail() from tests/fixtures/test-data.ts
- Import shared helpers from tests/fixtures/ — never reimplement API calls inline in spec files
- Include professional inline comments on all tests explaining what it is testing and why it matters 

## File Structure

tests/fixtures/     — shared helpers (admin-api.fixture.ts, mailpit.fixture.ts, test-data.ts)
tests/api/          — Admin API and Content API specs
tests/admin-ui/     — Admin persona browser tests
tests/member-ui/    — Member persona browser tests
docs/               — test plan and architecture decision records

## Session Notes

- Work one phase at a time per the blueprint
- Do not write tests for a phase until explicitly asked
- When told to /clear, stop and say so — do not continue into the next phase
- Ghost's Lexical editor (post body) uses a contenteditable div, not a standard input
- The Ghost admin panel uses React — some state changes require waiting for network idle
  after interactions before asserting
```
