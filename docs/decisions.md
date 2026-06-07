# Architecture Decision Records — Ghost Playwright Suite

---

## 1. Self-Hosted GitHub Actions Runner

**Context**

The Member UI persona tests require access to Mailpit, a local SMTP intercept service used to capture Ghost magic link emails. Mailpit runs on the same Synology NAS as the Ghost Docker stack and is reachable only on the LAN. GitHub-hosted runners have no path to LAN services by default. The alternatives are to expose Mailpit to the public internet or to bridge a cloud runner into the LAN.

**Decision**

Run CI on a self-hosted GitHub Actions runner deployed as a Docker container on the NAS alongside the Ghost test target.

**Rationale**

Exposing Mailpit to the public internet was rejected immediately. Magic link tokens are single-use authentication credentials. Routing them through public infrastructure — even briefly — creates an unnecessary interception risk for a service that exists specifically to capture authentication emails.

Connecting a GitHub-hosted runner via Tailscale was evaluated seriously and rejected. Tailscale would require adding an ephemeral, externally-managed device to the tailnet, configuring ACLs to scope its access, and accepting the ongoing maintenance surface of a Tailscale auth key in CI secrets. For a portfolio project with no real user data and a single admin account, that complexity and attack surface is disproportionate to the benefit. The self-hosted runner eliminates the problem entirely without introducing new network topology.

The self-hosted runner preserves test authenticity. All Playwright tests target `https://ghost.wsrportfolio.dev` exclusively — every request travels through the Cloudflare Tunnel exactly as it would from an external client. The runner's LAN position is an infrastructure detail that affects only the Mailpit API calls, which are testing infrastructure, not the application under test. This mirrors a common real-world pattern: teams frequently run self-hosted CI runners inside their own infrastructure while still testing against production-equivalent URLs.

**Tradeoffs Acknowledged**

A cloud-hosted runner provides stronger isolation between the test executor and the test target. If the runner were compromised, an attacker would have LAN access to the NAS. For a production application with real users and sensitive data, that isolation would justify the added complexity of the Tailscale approach. For a controlled portfolio environment with no sensitive user data, the self-hosted runner is the proportionate choice. The risk profile is understood and accepted.

---

## 2. Mailpit for Magic Link Testing

**Context**

Ghost does not support password-based authentication for members (subscribers). Every member sign-in and sign-up flow is driven exclusively by a magic link emailed to the member's address. A test suite that cannot retrieve and follow magic links cannot test the real member authentication flow.

**Decision**

Deploy Mailpit as an additional service in the Ghost Docker stack on the NAS and configure Ghost's SMTP to route all outbound email through it. Tests use the Mailpit REST API to retrieve emails and extract magic link URLs.

**Rationale**

The alternative — bypassing the magic link flow by injecting an authenticated session via the Ghost Admin API — was considered and rejected. An API session workaround would test that a pre-authenticated member can access content; it would not test that the authentication flow itself works. Ghost's magic link system involves token generation, email delivery, and a browser-side token exchange. A suite that skips those steps has a gap that could hide regressions in Ghost's authentication pipeline.

Exposing Mailpit to the public internet was rejected for the same reason as in Decision 1: magic link tokens are authentication credentials and should not transit public infrastructure.

Mailpit runs in the same Docker network as Ghost, so it intercepts outbound SMTP at the container level before any email would leave the system. It exposes a REST API (`/api/v1/messages`) that tests use to fetch the latest message addressed to a given recipient and extract the magic link URL from the HTML body. The browser then navigates to that URL, completing the real authentication flow end-to-end.

**Tradeoffs Acknowledged**

Mailpit creates a test dependency on the local Docker network. If Mailpit is unavailable, all member auth tests fail. In practice, Mailpit is in the same Docker Compose stack as Ghost — if Ghost is up, Mailpit is up. The risk is considered acceptable and is lower than the risk of having no magic link test coverage at all.

---

## 3. Admin API as Fixture Layer

**Context**

Browser-based UI tests require known, consistent data to act on — specific posts, tags, and members that exist in a predictable state before the test runs. Creating that data manually through the UI would couple fixture setup to the UI workflows under test, making tests fragile and slow.

**Decision**

Use the Ghost Admin API to create and delete all test data. The same `AdminApiHelper` class used in the Admin API spec files is imported directly into UI test files and used in `beforeEach`/`afterEach` and `beforeAll`/`afterAll` hooks.

**Rationale**

The Admin API is a first-class product feature — it is what real Ghost integrations, migration tools, and automation scripts use. Testing it is a suite requirement independent of whether it also serves as a fixture layer. Making it do double duty is not a shortcut; it validates the API as a product feature and produces reliable, fast test data setup as a byproduct.

This approach also makes the test suite more honest. A UI test that uses API-created fixtures is asserting that the UI correctly handles data regardless of how it was created — which is the behavior that matters in production. A test that creates data through the UI before testing the UI is not more realistic; it is more fragile and it obscures which behavior is actually under test.

**Tradeoffs Acknowledged**

If the Admin API fixture functions contain bugs, they can cause test failures in UI specs that have nothing to do with the UI behavior under test. The Admin API specs run first and validate the fixture functions directly, which mitigates this risk. A failure in `createPost` will surface in `admin-posts.spec.ts` before it causes a confusing failure in `posts.spec.ts`.

---

## 4. Global Member Teardown

**Context**

Ghost member registration is open on this instance by design — the MU-001 through MU-003 test cases specifically test the public signup portal. This means the instance is reachable by anyone, and a real person who discovers the URL during a test run could register as a member. Accumulated rogue accounts could affect subsequent test runs if tests make assumptions about the member list state.

**Decision**

Global teardown (`tests/global-teardown.ts`) unconditionally deletes all members via the Admin API after every test run. This runs whether the suite passed or failed.

**Rationale**

Selective teardown — deleting only members created by the current test run — would require tracking created member IDs across the entire run and passing them to the teardown function. This adds complexity and is fragile: if a test crashes before cleanup, its member is orphaned. Unconditional teardown is simpler and more robust.

This approach is safe because the instance has no real users. It is a controlled test target, not a live publication. Deleting all members at teardown time is documented behavior, not a destructive side effect. Any real person who registers during a test run loses their account at the end of the next CI run. This is acknowledged and accepted.

**Tradeoffs Acknowledged**

Unconditional member deletion means that any manual test members created during development are also deleted after a CI run. Anyone using the Ghost admin to manually add members for testing purposes should expect those accounts to be cleared. This is a workflow consideration, not a technical risk.

---

## 5. Sequential Test Execution

**Context**

The Ghost test target runs in Docker on a Synology NAS — a low-powered ARM device with limited CPU and memory. Playwright's default behavior is to run tests in parallel across multiple workers. Under parallel load, the Ghost container exhibits timeout failures and inconsistent API responses that are artifacts of resource contention, not real application bugs.

**Decision**

Set `workers: 1` and `fullyParallel: false` in `playwright.config.ts`. All tests run sequentially in a single worker process.

**Rationale**

Flaky tests caused by infrastructure limits are worse than slow tests. A suite that passes reliably in 20 minutes is more valuable as a portfolio artifact — and more honest — than a suite that runs in 8 minutes but fails intermittently in ways that require hardware knowledge to interpret. Sequential execution eliminates a class of false failures entirely.

Playwright's `workers: 1` setting does not prevent the suite from running multiple spec files; it means spec files run one at a time rather than in parallel. The total test count (100+) is manageable sequentially given that most tests are API calls or focused UI interactions rather than long browser flows.

**Tradeoffs Acknowledged**

Sequential execution means the full suite takes longer to complete than it would on capable hardware. On a cloud runner or a modern desktop machine, parallel execution would be the right default. The `workers: 1` setting is a deliberate environmental accommodation, not a design preference. The config is documented accordingly so a reviewer understands the constraint.

---

## 6. Ghost Version Pinning

**Context**

Ghost's Admin API and Content API are versioned (`v5` at time of writing), but Ghost does not guarantee strict backward compatibility within a major version. Endpoint behavior, response schemas, and error codes can change across Ghost patch releases. An unpinned Docker image that auto-updates to a new Ghost release could break tests in ways that are difficult to distinguish from real application regressions.

**Decision**

Pin the Ghost Docker image to a specific version tag in `docker-compose.yml` on the NAS. Do not use `latest` or a floating minor version tag.

**Rationale**

Test suites validate known behavior against a known target. If the target changes underneath the suite without a deliberate decision to update, test failures are ambiguous — they could mean the application regressed, or they could mean the API changed in a way that invalidates the test assertions. Pinning eliminates that ambiguity. Any Ghost upgrade requires a deliberate version bump in the Compose file, which can be reviewed alongside any test changes required.

This also makes the suite reproducible. Anyone running the suite against a different Ghost version should expect differences and should update the version pin before concluding that tests are broken.

**Tradeoffs Acknowledged**

Pinning means the instance does not automatically receive Ghost security patches or bug fixes. The tradeoff is accepted: this is a portfolio test environment with no real users or sensitive data. Security patches are relevant to production deployments. For this instance, API contract stability outweighs the risk of running an unpatched Ghost version.

---

## 7. Centralized Operation Timeouts Sized for the NAS

**Context**

The test target runs in Docker on a low-powered Synology NAS. Under sustained sequential load — late in a full suite run, after ten-plus minutes of continuous traffic — the Ghost container slows markedly. API calls that normally answer in under a second can take 15–25 seconds to respond before completing successfully. They are slow, not dead.

An earlier configuration set Playwright's `actionTimeout` to 15 seconds. Because the built-in `request` fixture inherits `actionTimeout` as the default timeout for every API request, this 15-second ceiling governed not just UI actions but every Admin API and Mailpit call in the suite. When the NAS slowed under load, calls that would have succeeded at 18–20 seconds were cut off at 15. A single failed fixture call (e.g. `createTag`, `createMember`, or a Mailpit cleanup) would fail its test and, in the admin-UI suite, cascade: the foundational login test (AU-001) clears Mailpit before logging in, so a timed-out Mailpit `DELETE` left the shared `.auth/admin.json` session unrefreshed and every dependent admin-UI test failed in turn.

Two earlier patches addressed symptoms rather than the cause: a `timeout: 30000` override was added to two fixture methods (`createPost`, `updatePost`) but not the dozen others, and `test.setTimeout(60000)` was scattered across six individual UI tests. The result was inconsistent coverage — exactly the gaps that produced the cascade. When the full suite was run on a freshly-idle NAS, the same tests passed; in isolation the admin-UI directory went 27/27 green. This confirmed the failures were environmental (cumulative load), not defects in the test or application code.

Independent infrastructure monitoring corroborated the diagnosis. During the failing run, Uptime Kuma recorded several *other* containers on the NAS becoming unreachable at the same time — the slowdown was system-wide resource contention, not something specific to Ghost or the tests. On the two clean runs after the fix, Uptime Kuma stayed green throughout, consistent with the larger timeouts giving slow-but-alive responses enough runway to complete instead of cascading into failures.

**Decision**

Set operation timeouts once, centrally, in `playwright.config.ts`, sized for the NAS under load:

- `actionTimeout: 30000` — the single governing default for every UI action and every API request routed through the `request` fixture. All current and future requests inherit it automatically.
- `timeout: 60000` (per-test) — sits comfortably above `actionTimeout` so that a single slow operation, including one in `beforeEach`/`beforeAll` setup (whose duration counts toward the per-test budget), cannot exhaust the whole-test allowance.

The scattered per-call `timeout` overrides and per-test `setTimeout` stopgaps were removed in favour of this single source of truth.

**Rationale**

The failures were not caused by the timeout values being wrong in principle; they were caused by the values being applied inconsistently. Raising and consolidating the timeout at the one place that governs all operations fixes the whole class of failure at once — Admin API, Content API checks, and Mailpit alike — and guarantees that any method added later inherits the correct budget without a developer having to remember to set it. That is the precise failure mode that produced the original cascade, and centralization eliminates it structurally.

This is the same reasoning already applied to `workers: 1` (Decision 5): a deliberate, documented accommodation of the test environment's hardware limits, not a design preference. Thirty seconds is generous for an API call, but on this hardware it is the difference between a reliable suite and one that flakes intermittently in ways that require knowledge of the NAS to interpret. A green suite that takes a little longer is more valuable as a portfolio artifact — and more honest — than a fast one that fails under its own load.

**Tradeoffs Acknowledged**

A higher `actionTimeout` means a genuinely hung operation waits 30 seconds rather than 15 before failing, and a hung test waits up to 60 seconds — slower feedback on a true outage. Raising `actionTimeout` also relaxes UI action timeouts (clicks, fills), which could mask a real front-end slowdown as merely-slow rather than broken. Both tradeoffs are accepted: on this hardware the dominant failure mode is transient slowness under load, not hard hangs, and erring toward letting slow-but-alive operations complete removes far more false failures than it hides. On capable hardware (a cloud runner or modern desktop) these timeouts would be set lower; like `workers: 1`, they are an explicit environmental accommodation rather than a universal default.

---

## 8. Admin 2FA Lockdown and CI Run Cadence

**Context**

Ghost v6 sends a six-digit verification code to the admin email when an admin signs in from an unrecognized browser. The suite handles this automatically: AU-001 retrieves the code from Mailpit and completes the verification step (`tests/admin-ui/auth.spec.ts`). To avoid requesting a code on every local run, AU-001 caches the authenticated session to `.auth/admin.json` and reuses it for up to four hours (Decision 7 covers the timeout behaviour; the session-caching fast path is in the same file). Within that window, consecutive local runs reuse the saved session and request **zero** verification codes.

CI does not benefit from this cache. Each CI run starts from a fresh checkout on the self-hosted runner, where `.auth/admin.json` does not exist (it is gitignored and never committed — it holds live session tokens). AU-001 therefore **always takes the full login path in CI and requests one fresh admin verification code per run.**

Ghost rate-limits admin 2FA: requesting too many verification codes in a short window triggers an approximately **30-minute lockdown** during which further code requests are rejected. A single suite run requests at most one code (only AU-001's full-login path; AU-002 uses a deliberately wrong password and AU-003 reuses the stored session). The risk is therefore not within a run but **across runs in quick succession**: two CI runs started within ~30 minutes of each other can request two codes inside the rate-limit window and trip the lockdown, which fails AU-001 and cascades through the entire admin-UI suite.

**Decision**

Treat admin 2FA as a shared, rate-limited resource and pace CI accordingly:

- **Do not re-trigger CI within 30 minutes of a previous run.** This includes manual re-runs of a failed workflow and rapid successive pushes to `main` or an open PR — each push that runs the workflow requests a fresh code.
- **If the lockdown fires** (AU-001 fails to retrieve a code and the admin-UI suite cascades), do not immediately retry. **Wait out the lockdown window (~30 minutes), then re-run once.** Retrying inside the window only extends it.
- Locally, the four-hour session cache makes this a non-issue for back-to-back runs; the constraint is specifically a CI-cadence concern.

**Rationale**

The session cache already eliminates the lockdown risk for the common case (local development). The remaining exposure is structural to CI — a fresh checkout cannot reuse a cached session — and is cheaper to manage operationally than to engineer around. Persisting `.auth/admin.json` across CI runs (e.g. via a cached artifact) was considered and rejected: it would mean storing live admin session tokens in CI caching infrastructure, a credential-exposure tradeoff disproportionate to the inconvenience of spacing out runs. Accepting a run-cadence rule keeps admin session tokens ephemeral and confined to the runner for the duration of a single run.

**Tradeoffs Acknowledged**

The 30-minute cadence rule constrains how quickly CI feedback can be obtained after a fix — a developer who pushes a follow-up commit within half an hour of a previous run may trip the lockdown rather than get a clean result. This is accepted for a portfolio project where CI runs are infrequent and deliberate. A higher-throughput pipeline with frequent merges would need a different approach — for example, a dedicated CI admin account whose browser/IP is pre-trusted so it bypasses the 2FA step entirely, or a Ghost configuration that exempts the runner from the verification requirement. Neither is justified at this project's run frequency.

---

## 9. Member Sign-In Rate Limiter and Self-Skipping Registration Test

**Context**

Ghost applies an IP-level rate limiter to member authentication, distinct from the admin 2FA lockdown in Decision 8. When too many member sign-in or sign-up attempts originate from the same IP in a short window, Ghost rejects further attempts with a "too many different sign-in attempts" error rather than sending the email. This protects the member portal from email-bombing and credential-probing abuse.

Several member tests trigger an email-sending action per run, all from the same runner IP:

- **MU-001** submits a new signup (sends a confirmation/magic link).
- **MU-003** submits a duplicate-email signup (Ghost responds by sending a sign-in link).
- **MU-004** requests a magic link to complete the full authentication flow.

A single suite run stays under the limit comfortably. The exposure, as with the admin 2FA lockdown, is **repeated full runs in quick succession**: across several back-to-back runs the cumulative member email actions from one IP can trip the limiter. When that happens, Ghost replaces the portal's submit button with a "Retry" button and never advances to the confirmation screen.

**Decision**

MU-001 detects the rate-limited state and **skips itself cleanly rather than failing** (`tests/member-ui/registration.spec.ts`). After submitting the form it waits briefly for a "Retry" button; if that button appears, it reads the portal notification text and calls `test.skip()` with that message instead of waiting out a 15-second timeout on a confirmation screen that will never appear.

Operationally, the same cadence guidance as Decision 8 applies: **space out repeated full runs**. Local back-to-back runs during active development will eventually trip the member limiter even though they reuse the admin session; when that happens the registration test skips, which is expected, not a defect.

**Rationale**

A rate-limited signup is an environmental condition, not a product defect or a test bug — the application is behaving correctly by refusing the request. Failing the test in that situation would produce a false red that tells the reader nothing about MU-001's actual subject (that a valid signup is accepted and shows a confirmation). A clean skip carrying Ghost's own notification text communicates precisely what happened and why, and keeps the suite result honest: a skip is visible and explained, whereas a forced pass would hide the condition and a failure would misattribute it.

This mirrors the philosophy applied throughout the suite (Decisions 5, 7, and 8): distinguish genuine application regressions from environmental limits of the test target, and handle the latter explicitly and transparently rather than letting them masquerade as the former.

**Tradeoffs Acknowledged**

A self-skipping test provides no positive signal on the run where it skips — if MU-001 silently skipped on every run, the signup flow would effectively be untested while still appearing green. This is accepted because the skip is the exception, not the norm: a single run, or runs spaced sensibly apart, exercises MU-001 fully. The skip reason is surfaced in the report so a reviewer can see it fired and why. If MU-001 began skipping persistently, that would itself be the signal to investigate — either the runner IP is hitting the limiter chronically (pointing to run cadence) or Ghost's limiter configuration has changed. A higher-throughput setup would address this the same way as the admin case: a dedicated, pre-trusted member-testing path or a limiter exemption for the runner IP, neither justified at this project's run frequency.
