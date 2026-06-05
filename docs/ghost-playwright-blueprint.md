# Ghost Playwright Suite — Claude Code Blueprint

**Project:** WSR QA Portfolio — Ghost Test Suite  
**Repo:** WSR-Portfolio/ghost-playwright-suite  
**Author:** Scott Roberts  
**Version:** 1.1  
**Date:** 2026-06-05  

---

## How to Use This Blueprint

This document is the complete implementation guide for the Ghost CMS Playwright test suite. Work through it sequentially — each phase depends on the previous one. Do not skip ahead.

At each `/clear` checkpoint, start a new Claude Code session and paste the session-opening context block provided at that phase. Do not attempt to carry context across `/clear` boundaries.

---

## Pre-Phase Preparation

Complete all of the following before opening Claude Code for the first time.

### 1. Initialize the Playwright project

In Terminal, from the repo root:

```bash
cd ~/git/ghost-playwright-suite
npm init playwright@latest
```

When prompted:
- Language: **TypeScript**
- Test directory: **tests**
- GitHub Actions workflow: **No** (we'll write our own)
- Install browsers: **Yes**

This creates `playwright.config.ts`, `tests/`, and `package.json`.

### 2. Install additional dependencies

```bash
npm install --save-dev @types/node jsonwebtoken
```

`jsonwebtoken` is required for Ghost Admin API JWT token generation (see Ghost API Auth note below).

### 3. Create the `.env` file

Create `.env` at the repo root. This file is never committed — add it to `.gitignore` immediately.

```
GHOST_URL=https://ghost.wsrportfolio.dev
GHOST_ADMIN_API_KEY=your_admin_api_key_here
GHOST_CONTENT_API_KEY=your_content_api_key_here
GHOST_ADMIN_EMAIL=your_admin_email_here
GHOST_ADMIN_PASSWORD=your_admin_password_here
MAILPIT_URL=http://10.0.4.113:8025
```

### 4. Update `.gitignore`

Ensure the following are in `.gitignore`:

```
.env
node_modules/
playwright-report/
test-results/
```

### 5. Create the `CLAUDE.md` file

Create `CLAUDE.md` at the repo root before starting any Claude Code session. Claude Code reads this automatically. See the full `CLAUDE.md` content in the appendix at the end of this document.

### 6. Place reference documents in `docs/`

**Do this manually before starting any Claude Code session. Never let Claude Code create these files — it wastes tokens.**

```bash
mkdir -p ~/git/ghost-playwright-suite/docs
cp /path/to/ghost-test-plan.md ~/git/ghost-playwright-suite/docs/test-plan.md
cp /path/to/ghost-playwright-blueprint.md ~/git/ghost-playwright-suite/docs/ghost-playwright-blueprint.md
```

Commit them immediately:

```bash
cd ~/git/ghost-playwright-suite
git add docs/
git commit -m "docs: add test plan and blueprint"
git push
```

Claude Code will read these files when instructed. It should never be asked to create or rewrite them.

### 7. Ghost Admin API authentication — critical background

**Read this before writing any Admin API code.**

Ghost's Admin API does not accept the API key directly as a Bearer token. The key must be used to generate a short-lived JWT token on each request. The Admin API key is in the format `{id}:{secret}` — the id and secret are split on the colon.

Token generation pattern (TypeScript):

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

Every Admin API request must include this header:
```
Authorization: Ghost {token}
```

The Content API uses a simpler key parameter:
```
?key={contentApiKey}
```

Claude Code must use this pattern for all Admin API calls. If it attempts to use the raw key as a Bearer token, the requests will return 401.

---

## Folder and File Structure

The final repo structure when the suite is complete:

```
ghost-playwright-suite/
├── CLAUDE.md                          # Claude Code session context (never commit secrets)
├── README.md                          # Project documentation (written last)
├── .env                               # Local secrets (gitignored)
├── .gitignore
├── package.json
├── playwright.config.ts
├── tests/
│   ├── fixtures/
│   │   ├── admin-api.fixture.ts       # Shared Admin API helper (create/delete posts, members, tags, etc.)
│   │   ├── mailpit.fixture.ts         # Mailpit API helper (retrieve emails, extract magic links)
│   │   └── test-data.ts               # Shared test data constants (email domains, slugs, titles, etc.)
│   ├── api/
│   │   ├── admin-auth.spec.ts         # AA-001–003
│   │   ├── admin-posts.spec.ts        # AA-004–016
│   │   ├── admin-pages.spec.ts        # AA-017–019
│   │   ├── admin-tags.spec.ts         # AA-020–024
│   │   ├── admin-members.spec.ts      # AA-025–030
│   │   ├── admin-newsletters.spec.ts  # AA-031–032
│   │   ├── admin-images.spec.ts       # AA-033–034
│   │   ├── admin-webhooks.spec.ts     # AA-035–037
│   │   ├── admin-tiers.spec.ts        # AA-038
│   │   ├── admin-errors.spec.ts       # AA-039
│   │   └── content-api.spec.ts        # CA-001–016
│   ├── admin-ui/
│   │   ├── auth.spec.ts               # AU-001–003
│   │   ├── posts.spec.ts              # AU-004–016
│   │   ├── pages.spec.ts              # AU-017–019
│   │   ├── tags.spec.ts               # AU-020–023
│   │   ├── members.spec.ts            # AU-024–026
│   │   └── settings.spec.ts           # AU-027
│   └── member-ui/
│       ├── registration.spec.ts       # MU-001–003
│       ├── auth.spec.ts               # MU-004
│       └── content-access.spec.ts     # MU-005–010
└── docs/
    ├── test-plan.md                   # Copy of the test plan
    └── decisions.md                   # Architecture decisions (self-hosted runner rationale, etc.)
```

---

## Phase 0 — Project Configuration

**Goal:** Configure Playwright correctly for this project before writing a single test.  
**`/clear` after this phase.**

### Session-opening context

```
We are building a Playwright TypeScript test suite for Ghost CMS targeting https://ghost.wsrportfolio.dev.
Read CLAUDE.md, docs/test-plan.md, and docs/ghost-playwright-blueprint.md before doing anything else.
We are in Phase 0: configuring playwright.config.ts.
Do not write any tests yet.
```

### Prompt 0.1 — Configure playwright.config.ts

```
Update playwright.config.ts with the following requirements:

- baseURL from process.env.GHOST_URL
- Single browser: Chromium only
- Workers: 1 (sequential execution — the test target is a low-powered NAS)
- Retries: 2 on CI, 0 locally
- Timeout: 30000ms per test
- Expect timeout: 10000ms
- Reporter: ['html', 'list']
- Screenshot: only on failure
- Video: retain-on-failure
- Load .env using dotenv at the top of the config file
- No global setup file yet — we will add that later

Do not create any test files yet.
```

---

## Phase 1 — Fixtures and Helpers

**Goal:** Build the shared fixture layer that all tests depend on.  
**`/clear` after this phase.**

### Session-opening context

```
We are building a Playwright TypeScript test suite for Ghost CMS targeting https://ghost.wsrportfolio.dev.
Read CLAUDE.md, docs/test-plan.md, and docs/ghost-playwright-blueprint.md before doing anything else.
We are in Phase 1: building shared fixtures and helpers.
The fixture files go in tests/fixtures/. Do not write any test spec files yet.
```

### Prompt 1.1 — Admin API fixture helper

```
Create tests/fixtures/admin-api.fixture.ts.

This module exports helper functions used by tests to create and delete test data via the Ghost Admin API.
All functions are async and accept a base URL and admin API key from environment variables.

Ghost Admin API authentication: the Admin API key is in format {id}:{secret}. You must split on the colon
and use jsonwebtoken to generate a JWT signed with the hex-decoded secret, algorithm HS256, audience '/admin/',
expiry 5 minutes, keyid set to the id. Every request uses Authorization: Ghost {token}.

Export the following functions:

createPost(options: { title: string; status?: string; visibility?: string; tags?: string[]; featured?: boolean; publishedAt?: string }): Promise<GhostPost>
updatePost(id: string, options: Partial<GhostPost> & { updated_at: string }): Promise<GhostPost>
deletePost(id: string): Promise<void>
createPage(options: { title: string; status?: string }): Promise<GhostPage>
deletePage(id: string): Promise<void>
createTag(options: { name: string; description?: string }): Promise<GhostTag>
deleteTag(id: string): Promise<void>
createMember(options: { name: string; email: string }): Promise<GhostMember>
deleteMember(id: string): Promise<void>
deleteAllMembers(): Promise<void>
getPost(id: string): Promise<GhostPost>
getMemberByEmail(email: string): Promise<GhostMember | null>

Define TypeScript interfaces for GhostPost, GhostPage, GhostTag, and GhostMember covering the fields
returned by the API that tests will need to assert against.

Include professional inline comments explaining why JWT generation is required rather than using the
raw API key directly. This is non-obvious and important for anyone reading the code.
```

### Prompt 1.2 — Mailpit fixture helper

```
Create tests/fixtures/mailpit.fixture.ts.

This module exports helper functions for interacting with the Mailpit API to support magic link testing.
Mailpit base URL comes from process.env.MAILPIT_URL.

Mailpit API base path: {MAILPIT_URL}/api/v1

Export the following functions:

getLatestEmailTo(address: string): Promise<MailpitMessage | null>
  - Fetches the messages list and returns the most recent message sent to the given address
  - Returns null if no message is found

extractMagicLink(message: MailpitMessage): Promise<string>
  - Fetches the full message body by ID
  - Extracts and returns the Ghost magic link URL from the HTML body
  - The magic link URL pattern is: contains '/members/' and a token parameter
  - Throw a descriptive error if no link is found

deleteAllMessages(): Promise<void>
  - Deletes all messages in Mailpit (used in teardown to keep the inbox clean)

Define a MailpitMessage interface covering id, subject, to, and text/html fields.

Include inline comments explaining the role of Mailpit in the test suite — specifically that Ghost uses
magic links exclusively for member authentication (no passwords), and Mailpit intercepts these emails
on the local Docker network so the full auth flow can be tested end-to-end.
```

### Prompt 1.3 — Test data constants

```
Create tests/fixtures/test-data.ts.

This module exports constants used across the test suite to ensure consistency and avoid magic strings.

Export the following:

TEST_EMAIL_DOMAIN: 'testuser.wsrportfolio.dev'

A function generateTestEmail(label: string): string that returns {label}@testuser.wsrportfolio.dev

Constants for test content titles, slugs, and tag names — use a TEST_ prefix and make them clearly
identifiable as test data (e.g. TEST_POST_TITLE = 'QA Test Post — Admin API').

Add a comment explaining that all test-generated email addresses use a dedicated subdomain so they
are easily identifiable and distinguishable from any real user accounts.
```

---

## Phase 2 — Admin API Tests

**Goal:** Write all Admin API test specs (AA-001 through AA-039).  
**This is the most important phase — these tests also validate the fixture layer.**  
**`/clear` between sub-phases if sessions grow long.**

### Session-opening context

```
We are building a Playwright TypeScript test suite for Ghost CMS targeting https://ghost.wsrportfolio.dev.
Read CLAUDE.md, docs/test-plan.md, and docs/ghost-playwright-blueprint.md before doing anything else.
We are in Phase 2: writing Admin API test specs.
Fixtures are already built in tests/fixtures/. Import from there — do not reimplement API calls inline.
Use Playwright's request fixture for HTTP calls, not fetch or axios.
All tests go in tests/api/.
```

### Prompt 2.1 — Admin API authentication tests

```
Create tests/api/admin-auth.spec.ts.

Cover test cases AA-001, AA-002, AA-003:
- AA-001: Valid Admin API key returns 200 on GET /ghost/api/admin/posts/
- AA-002: Invalid API key (malformed) returns 401
- AA-003: Missing Authorization header returns 401

For AA-002 and AA-003, assert both the status code and that the response body contains an errors array.

Include a comment on each test explaining what it validates and why it matters — AA-002 and AA-003
protect against auth bypass; a regression here means the API is publicly writable.
```

### Prompt 2.2 — Admin API posts tests

```
Create tests/api/admin-posts.spec.ts.

Cover test cases AA-004 through AA-016. Import helper functions from tests/fixtures/admin-api.fixture.ts.
Use beforeEach/afterEach to create and clean up test posts so tests are isolated.

Key requirements:
- AA-011 (scheduled post): set publishedAt to a date 24 hours in the future; assert status === 'scheduled'
- AA-012 (members-only visibility): after setting visibility to 'members', verify the Content API
  GET /ghost/api/content/posts/?key={contentKey} does NOT return this post in its results
- AA-013 (featured flag): assert featured === true in the GET response after setting it
- AA-016 (delete): after deletion, GET /ghost/api/admin/posts/{id} should return 404

For AA-007 (missing title): assert 422 status and that errors[0].type === 'ValidationError'.
For AA-008 (duplicate slug): create two posts with the same explicit slug; assert 422 on the second.

Include inline comments on the non-obvious tests (AA-011, AA-012) explaining the Ghost-specific
behavior being validated.
```

### Prompt 2.3 — Admin API pages tests

```
Create tests/api/admin-pages.spec.ts.

Cover test cases AA-017 through AA-019.

Include a comment block at the top of the file explaining why pages are tested separately from posts
despite their similar structure: they are distinct resource types in Ghost's data model, use different
API endpoints (/ghost/api/admin/pages/ vs /ghost/api/admin/posts/), and have different default
visibility behavior. A test suite that only tests posts and assumes pages work the same way has
incomplete coverage.
```

### Prompt 2.4 — Admin API tags tests

```
Create tests/api/admin-tags.spec.ts.

Cover test cases AA-020 through AA-024.

For AA-021 (internal tag): create a tag with name '#qa-internal-tag'. Assert that the API accepts it
and the slug begins with 'hash-' (Ghost normalizes # prefix tags to hash- slugs). Include a comment
explaining the internal tag convention and why it matters — internal tags are invisible to readers
but used for content organization and filtering; testing them validates a non-obvious Ghost feature.

For AA-024 (duplicate slug): explicitly set the same slug on two tags; assert 422 on the second.
```

### Prompt 2.5 — Admin API members tests

```
Create tests/api/admin-members.spec.ts.

Cover test cases AA-025 through AA-030.

For AA-027 (duplicate email): create a member, then attempt to create another with the same email.
Assert 422 and that the error message references the duplicate.

For AA-030 (search by email): use the filter parameter:
GET /ghost/api/admin/members/?filter=email:{email}
Assert the response contains exactly one member with the correct email.

Use generateTestEmail() from test-data.ts for all test member email addresses.
Clean up all created members in afterAll using deleteAllMembers().
```

### Prompt 2.6 — Admin API newsletters, images, webhooks, tiers, and error handling

```
Create the following files:
- tests/api/admin-newsletters.spec.ts (AA-031–032)
- tests/api/admin-images.spec.ts (AA-033–034)
- tests/api/admin-webhooks.spec.ts (AA-035–037)
- tests/api/admin-tiers.spec.ts (AA-038)
- tests/api/admin-errors.spec.ts (AA-039)

For admin-images.spec.ts:
- AA-033: upload a small valid PNG using multipart/form-data to /ghost/api/admin/images/upload/
- AA-034: attempt to upload a .txt file; assert the response is an error (4xx)
- Include a note in the fixture about creating a minimal PNG buffer in-memory rather than
  depending on a fixture file on disk

For admin-webhooks.spec.ts:
- AA-035: POST to /ghost/api/admin/webhooks/ with event 'post.published' and a target_url of
  'https://example.com/webhook-test'
- Clean up by deleting the webhook in afterEach
- Include a comment explaining that webhooks are Ghost's integration surface — other services
  subscribe to Ghost events via webhooks; testing CRUD here validates a real integration pattern

For admin-errors.spec.ts:
- AA-039: POST to /ghost/api/admin/posts/ with a completely malformed JSON body (send a raw string)
  Assert 400 status
```

---

## Phase 3 — Content API Tests

**Goal:** Write all Content API test specs (CA-001 through CA-016).  
**Depends on Phase 1 (fixtures) and Phase 2 (some tests need a members-only post to exist).**  
**`/clear` before this phase.**

### Session-opening context

```
We are building a Playwright TypeScript test suite for Ghost CMS targeting https://ghost.wsrportfolio.dev.
Read CLAUDE.md, docs/test-plan.md, and docs/ghost-playwright-blueprint.md before doing anything else.
We are in Phase 3: writing Content API test specs.
Fixtures are already built in tests/fixtures/. All Content API tests go in tests/api/content-api.spec.ts.
Content API authentication uses a key query parameter, not a JWT. Use process.env.GHOST_CONTENT_API_KEY.
```

### Prompt 3.1 — Content API tests

```
Create tests/api/content-api.spec.ts.

Cover test cases CA-001 through CA-016.

Important context:
- Content API base URL: {GHOST_URL}/ghost/api/content/
- Authentication: append ?key={GHOST_CONTENT_API_KEY} to every request (no JWT, no Authorization header)
- CA-004 (members-only post not visible): use the Admin API fixture to create a members-only post in
  beforeAll, then assert it does not appear in Content API browse results, then delete it in afterAll.
  Include a prominent comment: this is a security boundary test. A regression here means members-only
  content is publicly readable via the API regardless of what the UI shows.
- CA-007 (deleted post returns 404): create a post via Admin API, capture its slug, delete it via
  Admin API, then assert the Content API returns 404 for that slug. Add a brief wait (1000ms) before
  the Content API check to account for potential Cloudflare cache propagation delay.
- CA-012 (tag ordering): create a post with two tags via Admin API where the first tag is the primary;
  assert the Content API response has the primary tag first in the tags array.
- CA-016 (filter by tag): create a post with a specific tag via Admin API; use the filter param
  filter=tag:{slug} on the Content API; assert only posts with that tag are returned.

Clean up all Admin-API-created content in afterAll.
```

---

## Phase 4 — Admin UI Tests

**Goal:** Write all Admin UI persona test specs (AU-001 through AU-027).  
**`/clear` before this phase.**

### Session-opening context

```
We are building a Playwright TypeScript test suite for Ghost CMS targeting https://ghost.wsrportfolio.dev.
Read CLAUDE.md, docs/test-plan.md, and docs/ghost-playwright-blueprint.md before doing anything else.
We are in Phase 4: writing Admin UI persona test specs.
All tests go in tests/admin-ui/. The admin panel is at {GHOST_URL}/ghost.
Use Playwright's page fixture for browser tests. Prefer role and label selectors over CSS selectors.
Do not use page.waitForTimeout() — use expect(locator).toBeVisible() or waitForURL() instead.
```

### Prompt 4.1 — Admin UI authentication tests

```
Create tests/admin-ui/auth.spec.ts.

Cover test cases AU-001, AU-002, AU-003:
- AU-001: Navigate to /ghost, fill email and password from env vars, submit, assert dashboard loads
- AU-002: Submit with a wrong password, assert an error message is visible on the page
- AU-003: Log in, reload the page, assert the dashboard is still visible (session persists)

For all admin UI tests, save authenticated storage state after AU-001 using Playwright's
storageState feature so subsequent test files can reuse the session without re-logging in.
Store state to .auth/admin.json (gitignored).

Include a comment explaining the storageState pattern and why it matters for test performance —
each test file that reuses the stored state skips the login flow entirely.
```

### Prompt 4.2 — Admin UI post tests

```
Create tests/admin-ui/posts.spec.ts.

Cover test cases AU-004 through AU-016. Use the stored admin auth state from .auth/admin.json.

Key requirements:
- Each test should create its own post via the Admin API fixture (not via the UI) where possible,
  so the UI test can focus on the specific action under test rather than always starting from scratch
- AU-006 (feature image): Ghost's post editor feature image upload uses a file input — use
  page.setInputFiles() to upload a small test image
- AU-009 and AU-010 (edit title/body): after saving, navigate away and back to the post to confirm
  the changes persisted — do not just check the UI immediately after save
- AU-011/012 (publish/unpublish): after toggling, verify both the UI status indicator AND make an
  Admin API call to confirm the status field reflects the change. This cross-layer assertion is
  intentional and should be commented as such.
- AU-013 (scheduled post): use Ghost's schedule UI; after setting a future date/time, assert the
  post card shows a scheduled indicator AND verify via Admin API that status === 'scheduled'
- AU-014 (members-only): toggle visibility setting in post settings panel; verify via Content API
  that the post no longer appears in unauthenticated browse results

Clean up test posts via Admin API in afterEach.
```

### Prompt 4.3 — Admin UI pages, tags, members, and settings tests

```
Create the following files:
- tests/admin-ui/pages.spec.ts (AU-017–019)
- tests/admin-ui/tags.spec.ts (AU-020–023)
- tests/admin-ui/members.spec.ts (AU-024–026)
- tests/admin-ui/settings.spec.ts (AU-027)

All files use stored admin auth state from .auth/admin.json.

For tags.spec.ts AU-021 (internal tag):
- Create a tag named '#qa-internal' via the UI
- After saving, verify via Admin API that the tag exists and its slug starts with 'hash-'
- Include a comment explaining the internal tag convention

For settings.spec.ts AU-027 (navigation):
- Add a nav item with label 'QA Test Link' and URL 'https://example.com'
- Save, reload the settings page, assert the item still appears
- Clean up by deleting the nav item after the test
```

---

## Phase 5 — Member UI Tests

**Goal:** Write all Member UI persona test specs (MU-001 through MU-010).  
**Most complex phase — magic link flow requires Mailpit integration.**  
**`/clear` before this phase.**

### Session-opening context

```
We are building a Playwright TypeScript test suite for Ghost CMS targeting https://ghost.wsrportfolio.dev.
Read CLAUDE.md, docs/test-plan.md, and docs/ghost-playwright-blueprint.md before doing anything else.
We are in Phase 5: writing Member UI persona test specs.
All tests go in tests/member-ui/. Ghost members authenticate via magic links only — there are no passwords.
Mailpit (http://10.0.4.113:8025) intercepts outbound emails from Ghost on the local Docker network.
The Mailpit fixture is in tests/fixtures/mailpit.fixture.ts. Import from there.
```

### Prompt 5.1 — Member registration tests

```
Create tests/member-ui/registration.spec.ts.

Cover test cases MU-001, MU-002, MU-003.

The Ghost member registration portal is triggered by navigating to {GHOST_URL}/#/portal/signup or
clicking a subscribe button on the site. Use the portal URL directly.

- MU-001: Fill and submit the signup form with a valid test email; assert a confirmation or
  "check your email" message appears
- MU-002: Submit with a malformed email (e.g. 'notanemail'); assert an inline validation error
- MU-003: Use the Admin API to pre-create a member, then attempt to register with the same email
  via the portal; assert the response indicates the email is already registered

Use generateTestEmail() from test-data.ts for all email addresses.
Clean up any created members via Admin API deleteAllMembers() in afterAll.
```

### Prompt 5.2 — Member magic link authentication test

```
Create tests/member-ui/auth.spec.ts.

Cover test case MU-004 — this is the most important member test in the suite.

The full flow:
1. Navigate to the Ghost portal signup/signin page
2. Enter a test email address and request a magic link
3. Wait up to 10 seconds for the email to appear in Mailpit using getLatestEmailTo()
4. Extract the magic link URL from the email using extractMagicLink()
5. Navigate the browser to the magic link URL
6. Assert the browser is now on an authenticated member page (e.g. account page or redirected to site)
7. Assert that a members-only post is now accessible

Use generateTestEmail('magic-link-test') for the email address.
Clean up the member and Mailpit messages in afterAll.

Include a detailed comment block at the top of the file explaining:
- Why Ghost uses magic links instead of passwords (by design — simpler for readers, no password management)
- Why Mailpit is needed (Ghost sends real email; without an SMTP intercept we cannot retrieve the link)
- Why this is tested with the real flow rather than an API session workaround (authenticity — the full
  auth chain is exercised, not just the result of being authenticated)
- How this pattern maps to real-world testing of passwordless/magic-link auth systems

This comment block is important portfolio documentation. Make it thorough.
```

### Prompt 5.3 — Member content access tests

```
Create tests/member-ui/content-access.spec.ts.

Cover test cases MU-005 through MU-010.

For MU-005 (authenticated member reads members-only post):
- Reuse the authenticated member session from MU-004 using storageState saved to .auth/member.json
- Navigate to the members-only post created in beforeAll via Admin API fixture
- Assert the post content is visible

For MU-006 (unauthenticated visitor blocked):
- Use a fresh browser context with no stored auth state
- Navigate to the same members-only post URL
- Assert the page shows a subscription/login prompt rather than the post content
- Include a comment: this test validates the frontend access boundary independently of the API-layer
  test (CA-004). Both layers must enforce the boundary — a passing CA-004 does not guarantee the
  UI is also enforcing it.

For MU-009 (newsletter opt-out):
- As an authenticated member, navigate to the account page
- Find and interact with the newsletter subscription toggle
- Assert the UI confirms the change

For MU-010 (logout clears session):
- Log out via the member account page
- Attempt to navigate to the members-only post
- Assert the page no longer shows post content and instead shows the access prompt

Clean up all test content and members in afterAll.
```

---

## Phase 6 — Global Teardown and CI Configuration

**Goal:** Add global teardown, finalize playwright.config.ts, write the GitHub Actions workflow.  
**`/clear` before this phase.**

### Session-opening context

```
We are building a Playwright TypeScript test suite for Ghost CMS targeting https://ghost.wsrportfolio.dev.
Read CLAUDE.md, docs/test-plan.md, and docs/ghost-playwright-blueprint.md before doing anything else.
We are in Phase 6: global teardown and CI configuration.
All test specs are already written. We are now wiring up teardown and the GitHub Actions workflow.
```

### Prompt 6.1 — Global teardown

```
Create tests/global-teardown.ts.

This file runs after all tests complete. It must:
1. Delete all members via the Admin API deleteAllMembers() function
2. Delete all messages in Mailpit via deleteAllMessages()
3. Log a confirmation that teardown completed

Register it in playwright.config.ts as globalTeardown: './tests/global-teardown'.

Include a comment explaining the member teardown policy: Ghost member registration is intentionally
left open for test coverage. Any real person who finds the URL and registers during a test run will
have their account deleted at the end of the next CI run. This is documented behavior, not a bug.
This instance has no real users — it is a test target only.
```

### Prompt 6.2 — GitHub Actions workflow

```
Create .github/workflows/playwright.yml.

Requirements:
- Trigger: push and pull_request to main
- runs-on: self-hosted
- Steps:
  1. Checkout repo
  2. Set up Node.js 20
  3. Install dependencies (npm ci)
  4. Install Playwright browsers (npx playwright install --with-deps chromium)
  5. Run tests (npx playwright test)
  6. Upload HTML report as artifact (always, even on failure) — artifact name: playwright-report,
     retention: 30 days
- Environment variables passed to the test step from GitHub secrets:
  GHOST_URL, GHOST_ADMIN_API_KEY, GHOST_CONTENT_API_KEY, GHOST_ADMIN_EMAIL,
  GHOST_ADMIN_PASSWORD, MAILPIT_URL

Include a comment block at the top of the workflow file explaining the self-hosted runner decision
(same rationale as in the test plan: Mailpit requires LAN access; Tailscale runner rejected as
unnecessary attack surface; all tests hit the public URL through Cloudflare).
```

---

## Phase 7 — README and Documentation

**Goal:** Write the README.md and docs/ files.  
**`/clear` before this phase.**

### Session-opening context

```
We are building a Playwright TypeScript test suite for Ghost CMS targeting https://ghost.wsrportfolio.dev.
Read CLAUDE.md, docs/test-plan.md, and docs/ghost-playwright-blueprint.md before doing anything else.
We are in Phase 7: writing documentation.
The test suite is complete. We are now writing the README.md and docs/decisions.md.
```

### Prompt 7.1 — decisions.md

```
Create docs/decisions.md.

This file documents the key architectural decisions made in this project with full rationale.
Include the following decisions:

1. Self-hosted GitHub Actions runner (full rationale: Mailpit LAN access requirement, Tailscale
   evaluated and rejected as unnecessary attack surface, authenticity preserved by targeting
   public URL, tradeoffs acknowledged)
2. Mailpit for magic link testing (why not API session workaround, why not expose Mailpit publicly)
3. Admin API as fixture layer (dual-purpose: validates API AND seeds test data)
4. Global member teardown (open registration required for test coverage; teardown handles rogue signups)
5. Sequential test execution (low-powered NAS; parallelism causes flakiness)
6. Ghost version pinning (API contract stability)

Write each decision with: Context, Decision, Rationale, Tradeoffs Acknowledged.
```

### Prompt 7.2 — README.md

```
Create README.md.

This is a portfolio README — it will be read by potential employers and senior engineers evaluating
test automation skills. Write it accordingly: clear, professional, thorough without being verbose.

Include the following sections:

## Overview
What this project is, what it tests, why Ghost was chosen as a test target.

## Test Architecture
- Four test layers (Admin API, Content API, Admin UI, Member UI) with brief description of each
- Tools and stack (Playwright, TypeScript, Node.js, Mailpit)
- CI with self-hosted runner — include the full rationale for self-hosted vs cloud runner

## Project Structure
The folder/file tree with a one-line description of each file's purpose.

## Test Coverage
Summary table of test areas and case counts. Reference the test plan for full inventory.

## Key Design Decisions
- Ghost Admin API JWT authentication (non-obvious; raw key doesn't work)
- Magic link auth via Mailpit (why this approach, what it validates)
- Admin API as both test subject and fixture layer
- Global member teardown policy

## Non-Obvious Test Cases
Lift the content from Section 9 of the test plan — the cases that demonstrate deeper Ghost knowledge.

## Running Locally
Prerequisites, .env setup, commands to run the full suite and individual specs.

## CI/CD
How the GitHub Actions workflow operates, what the self-hosted runner is and why it exists.

## Out of Scope
What was explicitly excluded and why (mirror the test plan's out-of-scope table).
```

---

## Appendix — CLAUDE.md Content

Create this file at the repo root before starting any Claude Code session.

```markdown
# CLAUDE.md — Ghost Playwright Suite

## Project Context

This is a Playwright TypeScript test suite for Ghost CMS (v6.43.1), targeting
https://ghost.wsrportfolio.dev. It is part of a professional QA portfolio (WSR-Portfolio on GitHub)
demonstrating senior-level test automation skills.

The test target is a self-hosted Ghost instance running on a Synology NAS via Docker, exposed
through a Cloudflare Tunnel. It is a controlled test environment with no real users.

## Stack

- Language: TypeScript
- Test runner: Playwright
- Node.js: 20+
- Auth intercept: Mailpit (local SMTP, http://10.0.4.113:8025)

## Environment Variables

All secrets come from .env (local) or GitHub Actions secrets (CI). Never hardcode values.

GHOST_URL            — https://ghost.wsrportfolio.dev
GHOST_ADMIN_API_KEY  — format: {id}:{secret} — used to generate JWT tokens
GHOST_CONTENT_API_KEY — used as a query parameter, not a header
GHOST_ADMIN_EMAIL    — admin login email
GHOST_ADMIN_PASSWORD — admin login password
MAILPIT_URL          — http://10.0.4.113:8025

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
- Include professional inline comments on non-obvious decisions and Ghost-specific behavior

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
```

---

## Phase Sequence Summary

| Phase | What Gets Built | `/clear` After? |
|---|---|---|
| Pre-phase | npm init, .env, CLAUDE.md, playwright.config.ts base | — |
| 0 | playwright.config.ts configured | Yes |
| 1 | Fixture helpers (admin-api, mailpit, test-data) | Yes |
| 2 | All Admin API specs (AA-001–039) | Yes (between 2.3 and 2.4 if needed) |
| 3 | Content API specs (CA-001–016) | Yes |
| 4 | Admin UI specs (AU-001–027) | Yes (between 4.1 and 4.2 if needed) |
| 5 | Member UI specs (MU-001–010) | Yes |
| 6 | Global teardown + GitHub Actions workflow | Yes |
| 7 | README.md + docs/decisions.md | Yes |
