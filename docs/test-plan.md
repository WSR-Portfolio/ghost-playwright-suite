# Ghost CMS — QA Test Plan
**Project:** WSR QA Portfolio — Ghost Test Suite  
**Target:** https://ghost.wsrportfolio.dev  
**Author:** Scott Roberts  
**Version:** 1.2  
**Date:** 2026-06-05  

---

## 1. Purpose

This document defines the test strategy, scope, rationale, and test case inventory for the Ghost CMS automated test suite. The suite is part of a professional QA portfolio and is designed to demonstrate senior-level test thinking: risk-based prioritization, multi-layer coverage (UI and API), deliberate scope decisions, and documented reasoning for both what is tested and what is not.

Ghost is a Node.js-based open source CMS with a publishing-focused feature set: posts, pages, tags, member management, newsletters, and a tiered content access model. It exposes two REST APIs — the Admin API (authenticated, full CRUD) and the Content API (public-facing, read-only). This suite validates both APIs and two distinct user personas through the Ghost web UI.

---

## 2. Test Target

| Property | Value |
|---|---|
| Application | Ghost CMS (self-hosted) |
| URL | https://ghost.wsrportfolio.dev |
| Hosting | Docker on Synology NAS, exposed via Cloudflare Tunnel |
| Ghost Version | 6.43.1 |
| Admin API version | v5 |
| Content API version | v5 |

---

## 3. Personas

### 3.1 Admin (Content Creator)
A staff-level user with full administrative access. Authenticates via the Ghost admin UI at `/ghost` using email and password. Represents the publisher, editor, or site owner. This persona is responsible for all content creation and site management workflows.

### 3.2 Member (Content Consumer)
A registered site member — not a staff user. Authenticates via Ghost's magic link flow (email-based; Ghost does not use passwords for members). Represents a newsletter subscriber or reader with access to members-only content. This persona has no access to the Ghost admin UI.

---

## 4. Test Layers

| Layer | Tool | Auth Method |
|---|---|---|
| Admin API | Playwright (API testing) | Admin API key (JWT) |
| Content API | Playwright (API testing) | Content API key |
| Admin UI | Playwright (browser) | Email + password |
| Member UI | Playwright (browser) | Magic link (email) |

---

## 5. Scope

### 5.1 In Scope

#### Admin API
Ghost's Admin API provides full programmatic control over site content and configuration. Testing this layer validates the integration surface that real Ghost users rely on for automation, migrations, and third-party tool integration.

- **Posts:** Create, read, update, delete; publish; unpublish; schedule (future publish date); set featured flag; set visibility (public vs. members-only); custom slug; tag assignment; duplicate slug rejection
- **Pages:** Create, read, update, delete; visibility controls — pages are a distinct resource type from posts and must be tested independently despite their similar structure
- **Tags:** Create, read, update, delete; internal tag creation (# prefix convention); tag metadata (description, feature image URL)
- **Members:** Create, read, update, delete; label assignment; newsletter subscription state; adding a member to and removing from a newsletter
- **Newsletters:** Read list; update newsletter settings; verify member subscription state reflects newsletter changes
- **Images:** Upload a valid image; verify a public URL is returned; attempt upload of an unsupported file format and verify rejection
- **Webhooks:** Create, list, delete — webhooks are a real admin workflow for integrations and are non-obvious to less experienced testers
- **Tiers:** Read only — list tiers and verify the default free tier is present
- **Authentication:** Valid API key accepted; invalid/malformed key returns 401; missing Authorization header returns 401
- **Pagination and filtering:** `limit`, `page`, `order`, and `filter` query parameters behave correctly across post and member endpoints
- **Error handling:** Missing required fields return 422; invalid field values return 422; requests for non-existent resources return 404; correct error message structure in response body

#### Content API
The Content API is Ghost's public-facing read layer. It is what frontend applications and headless CMS consumers use to retrieve content. Testing this layer validates the contract between Ghost and any downstream consumer.

- **Posts:** Browse all posts (unauthenticated — should return only public posts); read a single post by slug; read a single post by ID
- **Members-only post:** Attempt to read a members-only post via Content API without authentication — verify the post is not returned in browse results and returns appropriate access denial on direct read. This is a critical security boundary test.
- **Pages:** Browse and read by slug
- **Tags:** Browse; verify primary tag vs. secondary tag ordering in post responses
- **Authors:** Browse; read by slug
- **Settings:** Verify site metadata (title, description) is returned correctly
- **Filtering and pagination:** Validated independently of Admin API — same parameters, different endpoint context
- **Deleted content:** Verify that a post deleted via Admin API returns 404 from the Content API and is not served from cache
- **Invalid API key:** Returns 403

#### Admin UI Persona
Browser-based tests against the Ghost admin panel at `/ghost`. These tests validate the workflows a real publisher would perform daily.

- **Authentication:** Login with valid credentials; login with invalid credentials returns error; session persists across page reload
- **Post creation:** Title, body content, tag assignment, feature image, custom excerpt, SEO title and description fields
- **Post editing:** Update title and body of an existing post; verify changes persist after save
- **Post publish/unpublish:** Toggle publish state; verify status change is reflected in both UI and a subsequent Admin API read
- **Scheduled post:** Set a future publish date and time; verify post status displays as `scheduled`; verify Admin API returns `scheduled` status
- **Post visibility:** Toggle a post between public and members-only; verify the Content API reflects the change (public post appears in unauthenticated browse; members-only post does not)
- **Featured post:** Toggle featured flag; verify it appears in Admin API response
- **Page CRUD:** Create, edit, delete a page — distinct UI flow from posts
- **Tag management:** Create a tag; create an internal tag (using # prefix); edit a tag; delete a tag
- **Member management:** View member list; manually add a member; delete a member
- **Navigation settings:** Add a custom navigation item in Settings → Navigation; verify it persists after save

#### Member UI Persona
Browser-based tests simulating a site visitor becoming a member and accessing gated content. Ghost's member authentication model is non-standard — there are no passwords. Members authenticate exclusively via magic links sent to their email address.

- **Registration:** New member signup via the Ghost membership portal
- **Magic link flow:** Request magic link via Ghost portal; Playwright queries the Mailpit API to retrieve the email; extract the magic link URL from the email body; navigate to the URL in the browser to establish an authenticated session. This tests the real end-to-end authentication flow.
- **Gated content access:** Verify a members-only post is accessible when authenticated as a member
- **Public content access:** Verify a public post is accessible without authentication
- **Gated content blocked:** Verify a members-only post is not accessible when not authenticated (redirects to login/subscribe portal)
- **Member account page:** Authenticated member can view their account/subscription page
- **Newsletter opt-out:** Member can unsubscribe from newsletter via account settings
- **Logout:** Session is cleared after logout; previously accessible gated content is no longer accessible

---

### 5.2 Out of Scope

The following features are explicitly excluded from this suite. Rationale is documented for each.

| Feature | Rationale |
|---|---|
| Paid tiers / Stripe integration | Requires a connected Stripe account. No Stripe integration is configured on this instance. Creating paid tiers or offers would require live payment credentials, which are inappropriate for a portfolio test environment. Excluded by environment constraint, not by choice. |
| Newsletter send delivery | Ghost newsletter sending requires an external mail service (Mailgun, SendGrid, etc.). Bulk newsletter delivery to real inboxes is not testable in this environment and is out of scope. Magic link email delivery IS testable via Mailpit (see Section 6) and IS in scope. |
| Theme upload and switching | Ghost supports custom Handlebars themes uploaded as zip files. This is a low-risk, low-frequency operation with minimal business logic. It is excluded as a portfolio scope decision — it does not demonstrate meaningful test design insight relative to the effort required. |
| Tinybird analytics integration | Requires Ghost's newer Docker Preview deployment method. This instance uses the classic Docker Compose approach and cannot support Tinybird without a full redeployment. Excluded by environment constraint. |
| Offers (discount codes) | Offers are a Stripe-dependent feature — they apply discounts to paid tier subscriptions. Excluded for the same reason as paid tiers. |
| ActivityPub / Bluesky integration | Ghost v6 introduced social federation features. This instance may not be on v6, and these features require external social accounts. Out of scope. |
| Ghost admin mobile responsiveness | Mobile layout testing of the admin UI is out of scope. The admin panel is not a mobile-first surface and testing it would add significant complexity for low portfolio value. |

---

## 6. Test Data Strategy

All test data is managed via the Ghost Admin API. The suite uses an API-first fixture approach:

- **Setup:** Before UI tests run, the Admin API creates necessary content (posts, members, tags) in a known state
- **Teardown:** After tests complete, fixtures are deleted via the Admin API
- **Isolation:** Each test or test group creates and destroys its own data; tests do not depend on pre-existing manual content
- **Credentials:** Admin API key and Content API key stored as GitHub Actions secrets; never hardcoded

This approach makes the Admin API tests dual-purpose: they validate the API as a product feature AND they serve as the fixture layer for UI tests. A post creation test that asserts correct 201 response and schema is also the mechanism that seeds content for a subsequent UI test.

### Member Teardown Policy

Because Ghost member registration is intentionally left open (required for MU-001 through MU-003 test coverage), there is a risk of rogue signups from real people finding the public URL and registering. To keep the member list clean and prevent unexpected state from affecting test runs, **global teardown deletes all members unconditionally** at the end of every test run via the Admin API. This is safe because:

- All member data used by the suite is created fresh at the start of each run
- This instance has no real users — it is a test target, not a production publication
- A clean member list between runs prevents false failures from stale or unexpected member state

### Magic Link Email Testing (Mailpit)

Ghost member authentication uses magic links exclusively — there are no passwords for members. To test this flow end-to-end, Mailpit is deployed as an additional service in the Ghost Docker stack on the NAS. Ghost is configured to route all outbound email through Mailpit's SMTP interface.

During member UI tests, the Playwright suite:
1. Triggers a magic link request via the Ghost portal
2. Queries the Mailpit API to retrieve the email
3. Extracts the magic link URL from the email body
4. Navigates to the URL in the browser to establish an authenticated session

This approach validates the real authentication flow without requiring an external mail service or live inbox access.

---

## 7. CI/CD

Tests will run via GitHub Actions on push and pull request to `main`. The workflow will:

1. Run Admin API tests (and produce fixture state)
2. Run Content API tests
3. Run Admin UI persona tests
4. Run Member UI persona tests
5. Run global teardown — delete all members unconditionally via Admin API
6. Upload Playwright HTML report as a workflow artifact

Admin API key, Content API key, and Mailpit base URL will be stored as repository secrets.

### CI Architecture: Self-Hosted Runner

The GitHub Actions workflow runs on a self-hosted runner deployed as a Docker container on the same NAS that hosts the Ghost test target.

**Why not a GitHub-hosted runner?**
The Member UI persona tests require access to Mailpit, a local SMTP intercept service used to capture Ghost magic link emails. Mailpit runs on the NAS LAN and is intentionally not exposed to the public internet — magic link tokens are single-use authentication credentials and should not transit public infrastructure.

Connecting a GitHub-hosted runner to the LAN via Tailscale was evaluated and rejected. Introducing an ephemeral external device into the tailnet — even a scoped, tagged, ACL-restricted one — creates an attack surface that isn't justified for a portfolio project with no real user data at stake. The self-hosted runner eliminates that surface entirely.

**How authenticity is preserved**
The self-hosted runner does not take shortcuts by hitting Ghost over the local network. All Playwright tests target `https://ghost.wsrportfolio.dev` exclusively — every request travels through the Cloudflare Tunnel exactly as it would from any external client. The only local network call made during a test run is the Mailpit API request to retrieve magic link emails, which is testing infrastructure, not the application under test.

This mirrors a common real-world pattern: teams frequently run self-hosted CI runners inside their own infrastructure while still testing against production-equivalent URLs. The runner's network location is an infrastructure detail; the test surface is unchanged.

**Tradeoffs acknowledged**
A cloud-based runner would provide stronger isolation between the test executor and the test target. If this were a production application with real users, that isolation would be worth the added complexity. For a controlled portfolio environment with a single admin account and no sensitive user data, the self-hosted runner is the appropriate and proportionate choice.

---

## 8. Test Case Inventory

### 8.1 Admin API Tests

| ID | Area | Test Case | Type |
|---|---|---|---|
| AA-001 | Auth | Valid Admin API key returns 200 on GET /posts | Happy path |
| AA-002 | Auth | Invalid API key returns 401 | Negative |
| AA-003 | Auth | Missing Authorization header returns 401 | Negative |
| AA-004 | Posts | Create a post returns 201 with correct response schema | Happy path |
| AA-005 | Posts | Created post appears in subsequent GET /posts | Happy path |
| AA-006 | Posts | Create post with duplicate slug returns 422 | Negative |
| AA-007 | Posts | Create post with missing title returns 422 | Negative |
| AA-008 | Posts | Update post title via PATCH; GET reflects change | Happy path |
| AA-009 | Posts | Publish a draft post; status changes to published | Happy path |
| AA-010 | Posts | Unpublish a post; status reverts to draft | Happy path |
| AA-011 | Posts | Schedule a post with future date; status is scheduled | Happy path |
| AA-012 | Posts | Set post visibility to members; value persists in GET | Happy path |
| AA-013 | Posts | Set featured flag to true; value persists in GET | Happy path |
| AA-014 | Posts | Delete a post returns 204; subsequent GET returns 404 | Happy path |
| AA-015 | Posts | GET /posts with limit=5 returns max 5 results | Pagination |
| AA-016 | Posts | GET /posts with filter by status returns only matching posts | Filtering |
| AA-017 | Pages | Create a page returns 201 | Happy path |
| AA-018 | Pages | Update a page title; GET reflects change | Happy path |
| AA-019 | Pages | Delete a page; subsequent GET returns 404 | Happy path |
| AA-020 | Tags | Create a public tag returns 201 | Happy path |
| AA-021 | Tags | Create an internal tag (name prefixed with #) | Happy path |
| AA-022 | Tags | Update tag description; GET reflects change | Happy path |
| AA-023 | Tags | Delete a tag; subsequent GET returns 404 | Happy path |
| AA-024 | Tags | Create tag with duplicate slug returns 422 | Negative |
| AA-025 | Members | Create a member returns 201 | Happy path |
| AA-026 | Members | Create member with invalid email format returns 422 | Negative |
| AA-027 | Members | Create member with duplicate email returns 422 | Negative |
| AA-028 | Members | Update member name; GET reflects change | Happy path |
| AA-029 | Members | Delete a member; subsequent GET returns 404 | Happy path |
| AA-030 | Members | Search members by email returns correct result | Happy path |
| AA-031 | Newsletters | GET /newsletters returns at least one newsletter | Happy path |
| AA-032 | Newsletters | Update newsletter name; GET reflects change | Happy path |
| AA-033 | Images | Upload a valid PNG returns 201 with public URL | Happy path |
| AA-034 | Images | Upload an unsupported file type returns error | Negative |
| AA-035 | Webhooks | Create a webhook returns 201 | Happy path |
| AA-036 | Webhooks | GET /webhooks lists newly created webhook | Happy path |
| AA-037 | Webhooks | Delete a webhook; no longer appears in list | Happy path |
| AA-038 | Tiers | GET /tiers returns default free tier | Happy path |
| AA-039 | Error handling | POST with malformed JSON body returns 400 | Negative |

### 8.2 Content API Tests

| ID | Area | Test Case | Type |
|---|---|---|---|
| CA-001 | Auth | Valid Content API key returns 200 on GET /posts | Happy path |
| CA-002 | Auth | Invalid Content API key returns 403 | Negative |
| CA-003 | Posts | GET /posts returns only published, public posts | Happy path |
| CA-004 | Posts | Members-only post does not appear in unauthenticated GET /posts | Security boundary |
| CA-005 | Posts | GET /posts/{slug} returns correct post by slug | Happy path |
| CA-006 | Posts | GET /posts/{id} returns correct post by ID | Happy path |
| CA-007 | Posts | GET /posts/{slug} for deleted post returns 404 | Negative |
| CA-008 | Posts | GET /posts with limit and page params returns correct subset | Pagination |
| CA-009 | Pages | GET /pages returns published pages | Happy path |
| CA-010 | Pages | GET /pages/{slug} returns correct page | Happy path |
| CA-011 | Tags | GET /tags returns tag list | Happy path |
| CA-012 | Tags | Post response includes tags in correct primary/secondary order | Happy path |
| CA-013 | Authors | GET /authors returns author list | Happy path |
| CA-014 | Authors | GET /authors/{slug} returns correct author | Happy path |
| CA-015 | Settings | GET /settings returns site title and description | Happy path |
| CA-016 | Filtering | GET /posts?filter=tag:{slug} returns only posts with that tag | Filtering |

### 8.3 Admin UI Tests

| ID | Area | Test Case | Type |
|---|---|---|---|
| AU-001 | Auth | Login with valid credentials reaches dashboard | Happy path |
| AU-002 | Auth | Login with invalid password shows error message | Negative |
| AU-003 | Auth | Session persists after page reload | Happy path |
| AU-004 | Posts | Create a new post with title and body content | Happy path |
| AU-005 | Posts | Assign a tag to a post during creation | Happy path |
| AU-006 | Posts | Add feature image to a post | Happy path |
| AU-007 | Posts | Set custom excerpt on a post | Happy path |
| AU-008 | Posts | Set SEO title and description fields on a post | Happy path |
| AU-009 | Posts | Edit an existing post title; changes persist after save | Happy path |
| AU-010 | Posts | Edit post body content; changes persist after save | Happy path |
| AU-011 | Posts | Publish a draft post; status changes in UI | Happy path |
| AU-012 | Posts | Unpublish a published post; status reverts in UI | Happy path |
| AU-013 | Posts | Schedule a post for future publish; status shows scheduled | Happy path |
| AU-014 | Posts | Set post visibility to members-only; setting persists | Happy path |
| AU-015 | Posts | Toggle featured flag on a post | Happy path |
| AU-016 | Posts | Delete a post; post no longer appears in post list | Happy path |
| AU-017 | Pages | Create a new page | Happy path |
| AU-018 | Pages | Edit a page; changes persist | Happy path |
| AU-019 | Pages | Delete a page | Happy path |
| AU-020 | Tags | Create a new tag | Happy path |
| AU-021 | Tags | Create an internal tag using # prefix | Happy path |
| AU-022 | Tags | Edit a tag description | Happy path |
| AU-023 | Tags | Delete a tag | Happy path |
| AU-024 | Members | View member list in admin | Happy path |
| AU-025 | Members | Manually add a new member via admin UI | Happy path |
| AU-026 | Members | Delete a member via admin UI | Happy path |
| AU-027 | Settings | Add a custom navigation item; persists after save | Happy path |

### 8.4 Member UI Tests

| ID | Area | Test Case | Type |
|---|---|---|---|
| MU-001 | Registration | New visitor can register as a member via portal | Happy path |
| MU-002 | Registration | Registration with invalid email format shows error | Negative |
| MU-003 | Registration | Duplicate email registration shows appropriate message | Negative |
| MU-004 | Auth | Member session established via full magic link flow (Mailpit intercept) | Happy path |
| MU-005 | Content access | Authenticated member can read a members-only post | Happy path |
| MU-006 | Content access | Unauthenticated visitor is redirected away from members-only post | Security boundary |
| MU-007 | Content access | Public post is accessible without authentication | Happy path |
| MU-008 | Account | Authenticated member can view account/subscription page | Happy path |
| MU-009 | Newsletter | Member can unsubscribe from newsletter via account settings | Happy path |
| MU-010 | Auth | Logout clears session; members-only content is no longer accessible | Happy path |

---

## 9. Non-Obvious Test Cases — Reviewer Notes

The following test cases are called out specifically because they reflect deeper product knowledge and would not be obvious to a tester unfamiliar with Ghost's design decisions:

- **AA-021 / AU-021 — Internal tags (#prefix):** Ghost has a convention where tags prefixed with `#` are treated as internal/organizational tags not displayed publicly. Testing this validates that Ghost correctly distinguishes between public and internal tags — a behavior invisible to casual users.
- **CA-004 — Members-only post not visible to unauthenticated Content API:** This is a security boundary test, not just a functional one. A regression here would mean paid/members content is publicly readable via API even if the UI gates it correctly.
- **CA-007 — Deleted post returns 404, not cached content:** Tests that Ghost does not serve stale cached responses after content deletion. Relevant in any deployment with a reverse proxy (this instance uses Cloudflare).
- **AA-035–037 — Webhook CRUD:** Webhooks are how Ghost notifies external systems of content events. Testing these validates a real integration surface that most basic test suites skip entirely.
- **AU-013 / AA-011 — Scheduled posts:** Scheduling requires Ghost's internal job scheduler to be running correctly. Validating that the `scheduled` status is set and persists is a meaningful functional check.
- **MU-006 — Unauthenticated access to members-only content:** Explicitly verifying the redirect/block behavior on the frontend, separate from the API-layer test (CA-004), validates that both layers enforce the access boundary independently.
- **MU-004 — Magic link auth via Mailpit:** Ghost members do not use passwords. Testers unfamiliar with Ghost will attempt to build a standard login flow and fail. Rather than working around this with an API-assisted session hack, the suite uses Mailpit — a local SMTP intercept service — to capture the magic link email and complete the real authentication flow end-to-end.

---

## 10. Risks and Constraints

| Risk | Impact | Mitigation |
|---|---|---|
| Ghost instance unavailable during CI run | Test suite fails entirely | Uptime Kuma monitoring; Cloudflare tunnel health checks |
| Mailpit unavailable during CI run | Member auth tests fail | Mailpit is in the same Docker stack as Ghost; if Ghost is up, Mailpit is up |
| Cloudflare caching interferes with deleted content tests | CA-007 false negatives | Add cache-busting headers or brief wait in teardown |
| NAS performance under parallel test load | Test flakiness | Limit parallelism in Playwright config for this project |
| Ghost version upgrades breaking API contracts | Test failures post-upgrade | Pin Ghost Docker image to a specific version tag |
| Self-hosted runner goes offline | CI cannot run | Runner is a Docker container on NAS; restarts automatically; same availability as Ghost |
