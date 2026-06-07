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
