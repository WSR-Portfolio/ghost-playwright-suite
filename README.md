# Ghost CMS — Playwright Test Suite

A Playwright TypeScript test suite for [Ghost CMS](https://ghost.org), targeting a self-hosted Ghost instance at `https://ghost.wsrportfolio.dev`. Part of a professional QA portfolio demonstrating senior-level test automation across multiple layers: REST API, browser UI, and a non-standard passwordless authentication flow.

---

## Overview

Ghost is a Node.js publishing platform with a publishing-focused feature set: posts, pages, tags, member management, newsletters, and a tiered content access model. It exposes two REST APIs — the Admin API (authenticated, full CRUD) and the Content API (public-facing, read-only) — and two distinct user experiences: the admin panel for content creators and the public site for members.

Ghost was chosen as a test target because it offers genuine complexity without artificial setup. The Admin API uses JWT authentication that requires non-trivial token generation. Member authentication uses magic links exclusively — there are no passwords — which requires an SMTP intercept service to test end-to-end. Content visibility is enforced at both the API and UI layers independently, creating meaningful security boundary tests. These are the kinds of challenges that produce interesting test design decisions.

The test target is a self-hosted Ghost instance (v6.43.1) running in Docker on a dedicated Linux host (Intel i7, 16 GB RAM), exposed through a Cloudflare Tunnel. It is a controlled environment with no real users.

---

## Test Architecture

### Four Test Layers

| Layer | Location | Description |
|---|---|---|
| **Admin API** | `tests/api/` | Full CRUD coverage of the Ghost Admin API using Playwright's API testing capabilities. Validates authentication, error handling, pagination, filtering, and all major resource types. Also serves as the fixture layer for UI tests. |
| **Content API** | `tests/api/content-api.spec.ts` | Coverage of Ghost's public-facing read API. Includes a critical security boundary test verifying that members-only content is not accessible to unauthenticated API consumers. |
| **Admin UI** | `tests/admin-ui/` | Browser-based tests against the Ghost admin panel. Covers the workflows a real publisher performs daily: creating and editing content, managing members, configuring settings. |
| **Member UI** | `tests/member-ui/` | Browser-based tests simulating the member (subscriber) experience. Includes the full magic link authentication flow using Mailpit to intercept emails, and gated content access verification. |

### Stack

- **Test runner:** [Playwright](https://playwright.dev) (TypeScript)
- **Node.js:** 24 (CI runtime; 20+ works locally)
- **Auth intercept:** [Mailpit](https://mailpit.axllent.org) — local SMTP service that captures Ghost magic link emails
- **JWT generation:** `jsonwebtoken` — required for Ghost Admin API authentication
- **CI:** GitHub Actions on a self-hosted runner

### CI: Self-Hosted Runner

Tests run on a self-hosted GitHub Actions runner deployed as a Docker container on the same host as Ghost (a dedicated Intel i7 / 16 GB machine; the instance was previously on a low-powered NAS).

**Why not a GitHub-hosted runner?** The member authentication tests require access to Mailpit, which runs on the LAN and is intentionally not exposed to the internet — magic link tokens are single-use authentication credentials and should not transit public infrastructure. Connecting a GitHub-hosted runner via Tailscale was evaluated and rejected: introducing an ephemeral external device into the tailnet creates an attack surface that is not justified for a portfolio project with no real user data.

**How test authenticity is preserved:** All Playwright tests target `https://ghost.wsrportfolio.dev` exclusively. Every request travels through the Cloudflare Tunnel exactly as it would from any external client. The runner's LAN position affects only the Mailpit API calls, which are testing infrastructure, not the application under test. This mirrors a common real-world pattern: teams frequently run self-hosted CI runners inside their own infrastructure while testing against production-equivalent URLs.

---

## Project Structure

```
ghost-playwright-suite/
├── playwright.config.ts              # Playwright config (baseURL, parallel workers, setup-project deps, timeouts)
├── .env.example                      # Template of required env vars (no secrets; copy to .env)
├── .github/
│   └── workflows/
│       └── playwright.yml            # GitHub Actions CI workflow (self-hosted runner)
├── tests/
│   ├── fixtures/
│   │   ├── admin-api.fixture.ts      # AdminApiHelper class — Ghost Admin API calls and Playwright fixture
│   │   ├── mailpit.fixture.ts        # MailpitHelper class — email retrieval and magic link extraction
│   │   ├── test-data.ts              # Shared constants and generateTestEmail() helper
│   │   └── index.ts                  # Single import point for the custom test/expect fixtures
│   ├── api/
│   │   ├── admin-auth.spec.ts        # AA-001–003: API key authentication and rejection
│   │   ├── admin-posts.spec.ts       # AA-004–016: Post CRUD, publish, schedule, visibility, pagination
│   │   ├── admin-pages.spec.ts       # AA-017–019: Page CRUD
│   │   ├── admin-tags.spec.ts        # AA-020–024: Tag CRUD including internal tag convention
│   │   ├── admin-members.spec.ts     # AA-025–030: Member CRUD, duplicate rejection, email search
│   │   ├── admin-newsletters.spec.ts # AA-031–032: Newsletter list and update
│   │   ├── admin-images.spec.ts      # AA-033–034: Image upload (valid and invalid file types)
│   │   ├── admin-webhooks.spec.ts    # AA-035–037: Webhook CRUD
│   │   ├── admin-tiers.spec.ts       # AA-038: Default free tier presence
│   │   ├── admin-errors.spec.ts      # AA-039: Malformed request body handling
│   │   ├── content-api.spec.ts       # CA-001–016: Content API coverage including security boundary
│   │   └── rate-limit.spec.ts        # RL-001: verifies the member sign-in rate limiter engages
│   ├── admin-ui/
│   │   ├── auth.spec.ts              # AU-001–003: Admin login, failure state, session persistence
│   │   ├── posts.spec.ts             # AU-004–016: Post creation, editing, publish/unpublish, scheduling
│   │   ├── pages.spec.ts             # AU-017–019: Page CRUD via UI
│   │   ├── tags.spec.ts              # AU-020–023: Tag management including internal tags
│   │   ├── members.spec.ts           # AU-024–026: Member list, add, delete via UI
│   │   └── settings.spec.ts          # AU-027: Navigation settings persistence
│   ├── member-ui/
│   │   ├── registration.spec.ts      # MU-001–003: Signup portal, validation, duplicate detection
│   │   ├── auth.spec.ts              # MU-004: Full magic link authentication flow via Mailpit
│   │   └── content-access.spec.ts    # MU-005–010: Gated content, public content, logout
│   ├── global-setup.ts               # Runs before all tests — resets Ghost's rate-limit (brute) table
│   └── global-teardown.ts            # Runs after all tests — deletes all members and Mailpit messages
└── docs/
    ├── test-plan.md                  # Full test plan with inventory, scope, and rationale
    └── decisions.md                  # Architecture decision records (ADRs 1–11)
```

---

## Test Coverage

| Area | Spec File(s) | Cases | Types |
|---|---|---|---|
| Admin API — Auth | `admin-auth.spec.ts` | 3 | Happy path, negative |
| Admin API — Posts | `admin-posts.spec.ts` | 13 | Happy path, negative, pagination, filtering |
| Admin API — Pages | `admin-pages.spec.ts` | 3 | Happy path |
| Admin API — Tags | `admin-tags.spec.ts` | 5 | Happy path, negative |
| Admin API — Members | `admin-members.spec.ts` | 6 | Happy path, negative |
| Admin API — Newsletters | `admin-newsletters.spec.ts` | 2 | Happy path |
| Admin API — Images | `admin-images.spec.ts` | 2 | Happy path, negative |
| Admin API — Webhooks | `admin-webhooks.spec.ts` | 3 | Happy path |
| Admin API — Tiers | `admin-tiers.spec.ts` | 1 | Happy path |
| Admin API — Error handling | `admin-errors.spec.ts` | 1 | Negative |
| Content API | `content-api.spec.ts` | 16 | Happy path, negative, security boundary, pagination |
| Admin UI — Auth | `auth.spec.ts` | 3 | Happy path, negative |
| Admin UI — Posts | `posts.spec.ts` | 13 | Happy path |
| Admin UI — Pages | `pages.spec.ts` | 3 | Happy path |
| Admin UI — Tags | `tags.spec.ts` | 4 | Happy path |
| Admin UI — Members | `members.spec.ts` | 3 | Happy path |
| Admin UI — Settings | `settings.spec.ts` | 1 | Happy path |
| Member UI — Registration | `registration.spec.ts` | 3 | Happy path, negative |
| Member UI — Auth | `auth.spec.ts` | 1 | Happy path |
| Member UI — Content access | `content-access.spec.ts` | 6 | Happy path, security boundary |
| Security — Rate limiting | `rate-limit.spec.ts` | 1 | Security boundary |
| **Total** | | **93** | |

For the full test case inventory with IDs and descriptions, see [`docs/test-plan.md`](docs/test-plan.md).

---

## Key Design Decisions

### Ghost Admin API JWT Authentication

The Ghost Admin API does not accept the API key directly as a Bearer token. The key is a credential pair in the format `{id}:{secret}` and must be used to generate a short-lived JWT on every request:

```typescript
import jwt from 'jsonwebtoken';

function generateAdminToken(adminApiKey: string): string {
  const [id, secret] = adminApiKey.split(':');
  return jwt.sign({}, Buffer.from(secret, 'hex'), {
    keyid: id,
    algorithm: 'HS256',
    expiresIn: '5m',
    audience: '/admin/',
  });
}
```

Every Admin API request uses the header `Authorization: Ghost {token}`. Using the raw key as a Bearer token produces a 401 with no diagnostic information — a common mistake for anyone new to the Ghost API. The fixture layer handles token generation automatically so spec files never deal with it directly.

### Magic Link Authentication via Mailpit

Ghost members have no passwords. Every authentication flow — sign-up confirmation, sign-in — uses a magic link sent to the member's email address. Testing this flow end-to-end requires intercepting that email.

Mailpit runs as an additional container in the Ghost Docker stack on the same host. Ghost's SMTP is configured to route all outbound email through Mailpit. During member tests, the suite:

1. Triggers a magic link request via the Ghost membership portal
2. Queries the Mailpit API to retrieve the email addressed to the test recipient
3. Extracts the magic link URL from the HTML body
4. Navigates the browser to the URL to complete authentication

The alternative — injecting an authenticated session via the Admin API and skipping the email flow — was rejected. That approach tests that a pre-authenticated member can access content; it does not test that Ghost's authentication pipeline works. The full flow is exercised deliberately.

### Admin API as Both Test Subject and Fixture Layer

The `AdminApiHelper` class used in the API test specs is also imported directly into UI test files to create and clean up test data. This dual-purpose design means the API tests validate the fixture functions before the UI tests depend on them. It also keeps UI tests focused: a post editing test creates its post via API and tests only the edit behavior, rather than coupling setup and assertion in a single long browser flow.

### Global Member Teardown

Member registration is left open on this instance — it must be, to test the signup portal. Global teardown deletes all members unconditionally after every test run. Any real person who registers during a run loses their account at the end of the next CI run. This is documented behavior, not a bug. The instance has no real users.

### Parallel Execution with Setup-Project Dependencies

The suite runs with `workers: 4` and `fullyParallel: false` — spec files run in parallel while tests within a file stay ordered. Two Playwright *setup projects* run first and create the sessions the rest of the suite restores via `storageState`: `admin-auth` (AU-001–003 → `.auth/admin.json`) and `member-auth` (MU-004 magic-link login → `.auth/member.json`). The `main` (API + Admin UI) and `member` projects declare these as dependencies, so session creation is guaranteed before the parallel tests run — on a cold CI checkout as much as locally. `main` depends only on `admin-auth`, so a member-side issue can never block the API/Admin-UI tests. Member deletion is owned solely by global teardown to avoid one spec wiping another's state mid-run.

### Rate-Limit Configuration and Brute-Table Reset

Ghost rate-limits authentication via `express-brute` (admin login, member sign-in, and a per-IP aggregate), with state stored in a MySQL `brute` table. Rather than coding around lockouts, the test instance raises the `spam` thresholds for legitimate test volume, and a `globalSetup` clears the `brute` table before every run — using a DB user scoped to `DELETE` on that one table — so each run starts from a clean slate. The limiter is not disabled: **RL-001** deliberately trips it and asserts it still returns `429` after the configured threshold. The suite therefore both avoids false lockouts and proves the guardrail still defends against abuse. *(This relaxed configuration is for the test instance only and must never be applied to a production Ghost.)*

For full rationale on all design decisions, see [`docs/decisions.md`](docs/decisions.md).

---

## Non-Obvious Test Cases

The following cases reflect deeper Ghost product knowledge and would not be obvious to a tester unfamiliar with Ghost's design:

- **AA-021 / AU-021 — Internal tags (`#` prefix):** Ghost treats tags prefixed with `#` as internal organizational tags that are not displayed publicly. Testing this validates that Ghost correctly distinguishes internal from public tags — a behavior invisible to casual users of the admin panel.

- **CA-004 — Members-only post not visible to unauthenticated Content API:** This is a security boundary test. A regression here means paid or members-only content is publicly readable via the API even if the UI gates it correctly. The UI passing does not imply the API is also enforcing the boundary.

- **CA-007 — Deleted post returns 404, not cached content:** Verifies that Ghost does not serve stale cached responses after content deletion. Relevant in any deployment with a reverse proxy — this instance routes through Cloudflare.

- **AA-035–037 — Webhook CRUD:** Webhooks are how Ghost notifies external systems of content events (post published, member created, etc.). Testing these validates a real integration surface that most introductory test suites skip entirely.

- **AU-013 / AA-011 — Scheduled posts:** Scheduling requires Ghost's internal job scheduler to be running. Asserting that the `scheduled` status is set and persists via both UI indicator and an independent Admin API read is a meaningful cross-layer functional check.

- **MU-006 — Unauthenticated access to members-only content (UI):** Explicitly verifies the frontend access boundary independently of CA-004. Both layers must enforce the boundary. A passing CA-004 does not guarantee the UI is also enforcing it.

- **MU-004 — Magic link auth via Mailpit:** Ghost members do not use passwords. Testers unfamiliar with Ghost will look for a password login flow and find none. Rather than working around this with an API session injection, the suite exercises the real authentication chain from email request through browser navigation.

- **RL-001 — Rate limiter engages at the configured threshold:** The whole suite is built to *avoid* Ghost's brute-force limiter; this one test does the opposite — it deliberately drives the member sign-in endpoint past `freeRetries` and asserts a `429`. Because the relaxed `spam` config is a deliberate weakening of a security control, this proves the control still fires. It runs isolated (its own project, last and alone) and resets the `brute` table before and after itself so it never disturbs the other tests.

---

## Running Locally

### Prerequisites

- Node.js 24 (CI uses 24; 20+ works locally)
- Access to the Ghost test instance (`https://ghost.wsrportfolio.dev`)
- Access to the Mailpit instance on the LAN (`http://<mailpit-host>:8025`) — required for member auth tests

### Setup

1. Clone the repository and install dependencies:

   ```bash
   git clone https://github.com/WSR-Portfolio/ghost-playwright-suite.git
   cd ghost-playwright-suite
   npm ci
   ```

2. Install Playwright browsers:

   ```bash
   npx playwright install --with-deps chromium
   ```

3. Create your `.env` from the template and fill in real values (`.env` is gitignored — never commit it):

   ```bash
   cp .env.example .env
   ```

   Required:

   ```
   GHOST_URL=https://ghost.wsrportfolio.dev
   GHOST_ADMIN_API_KEY=<id>:<secret>
   GHOST_CONTENT_API_KEY=<key>
   GHOST_ADMIN_EMAIL=<admin email>
   GHOST_ADMIN_PASSWORD=<admin password>
   MAILPIT_URL=http://<mailpit-host>:8025
   ```

   Optional — DB credentials for the rate-limit reset in `global-setup.ts` (use a user scoped to `DELETE` on the `brute` table). If omitted, the reset no-ops with a warning and the suite still runs (the tuned `spam` config protects a single run); RL-001 skips when they're absent or the DB is unreachable:

   ```
   DB_HOST=<mysql-host>
   DB_PORT=3306
   DB_NAME=<ghost-db-name>
   DB_USER=<brute-reset-user>
   DB_PASSWORD=<brute-reset-password>
   ```

### Commands

| Command | Description |
|---|---|
| `npx playwright test` | Run the full suite |
| `npx playwright test tests/api/` | Run all Admin and Content API tests |
| `npx playwright test tests/admin-ui/` | Run all Admin UI tests |
| `npx playwright test tests/member-ui/` | Run all Member UI tests |
| `npx playwright test --grep "AA-004"` | Run a single test by ID |
| `npx playwright show-report` | Open the HTML report from the last run |

---

## CI/CD

The GitHub Actions workflow at `.github/workflows/playwright.yml` triggers on push and pull request to `main`. It runs on a self-hosted runner deployed as a Docker container on the same host as the Ghost test target.

The workflow:
1. Checks out the repository
2. Sets up Node.js 24 with npm cache
3. Installs dependencies (`npm ci`)
4. Installs the Chromium browser (`npx playwright install --with-deps chromium`)
5. Runs the full suite in parallel (`workers: 4`) with all secrets injected from GitHub repository secrets — Playwright's global setup resets Ghost's rate-limit (`brute`) table before the tests start
6. Uploads the Playwright HTML report as a workflow artifact (always, including on failure) with 30-day retention

Secrets required in the repository settings: `GHOST_URL`, `GHOST_ADMIN_API_KEY`, `GHOST_CONTENT_API_KEY`, `GHOST_ADMIN_EMAIL`, `GHOST_ADMIN_PASSWORD`, `MAILPIT_URL`. Plus, for the brute-table reset and RL-001: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` (a DB user scoped to `DELETE` on the `brute` table).

For the full rationale on the self-hosted runner decision, see [Test Architecture](#ci-self-hosted-runner) above and [`docs/decisions.md`](docs/decisions.md).

---

## Out of Scope

| Feature | Rationale |
|---|---|
| Paid tiers / Stripe integration | Requires a connected Stripe account with live payment credentials. No Stripe integration is configured on this instance. Excluded by environment constraint. |
| Newsletter delivery | Ghost newsletter sending requires an external mail service (Mailgun, SendGrid, etc.). Bulk delivery to real inboxes is not testable here. Magic link email delivery via Mailpit is in scope and is tested. |
| Theme upload and switching | Low-risk, low-frequency operation with minimal business logic. Excluded as a scope decision — it does not demonstrate meaningful test design insight relative to the effort. |
| Tinybird analytics | Requires Ghost's newer Docker Preview deployment method. This instance uses the classic Docker Compose approach and cannot support Tinybird without a full redeployment. Excluded by environment constraint. |
| Offers (discount codes) | A Stripe-dependent feature. Excluded for the same reason as paid tiers. |
| ActivityPub / Bluesky federation | Ghost v6 social federation features require external social accounts and may not be stable on this instance version. Out of scope. |
| Admin mobile responsiveness | The Ghost admin panel is not a mobile-first surface. Testing it would add significant complexity for low portfolio value. |
