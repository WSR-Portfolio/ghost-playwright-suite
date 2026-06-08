/**
 * Member UI — Magic Link Authentication (MU-004)
 *
 * =============================================================================
 * WHY GHOST USES MAGIC LINKS INSTEAD OF PASSWORDS
 * =============================================================================
 * Ghost made a deliberate product decision to eliminate passwords for members
 * (subscribers) entirely. The rationale is reader-centric: passwords create
 * friction at signup, are frequently forgotten, and require Ghost to store
 * hashed credentials. Magic links trade that friction for a one-tap email
 * verification flow — the reader clicks a link, the session is established, and
 * there is nothing to remember or reset. From Ghost's perspective it also means
 * no password storage surface and no credential-stuffing attack vector against
 * member accounts.
 *
 * This is not a workaround or a missing feature — it is the intended and only
 * authentication mechanism for Ghost members. A tester approaching this without
 * prior Ghost knowledge will attempt to find a password input and will not find
 * one; understanding why is essential before designing any member auth test.
 *
 * =============================================================================
 * WHY MAILPIT IS REQUIRED
 * =============================================================================
 * Because authentication is email-only, there is no way to establish a member
 * session without receiving and acting on a real email. Ghost sends these emails
 * via SMTP. In a production environment that email goes to a real inbox; waiting
 * for delivery and parsing a live inbox from a test runner is slow, fragile, and
 * requires external credentials.
 *
 * Mailpit solves this cleanly: it is a lightweight SMTP server deployed as a
 * Docker service in the same stack as Ghost on the NAS. Ghost is configured to
 * route all outbound mail through Mailpit's SMTP interface. Mailpit catches
 * every message and exposes it immediately via a REST API. The test runner can
 * query that API within milliseconds of the email being sent — no external mail
 * provider, no inbox access, no polling an external service.
 *
 * Mailpit is reachable only on the local network (address via the MAILPIT_URL
 * env var), which is why the CI pipeline runs on a self-hosted runner co-located
 * with it. See the test plan §7 for the full CI architecture rationale.
 *
 * =============================================================================
 * WHY THE REAL FLOW IS TESTED INSTEAD OF AN API SESSION WORKAROUND
 * =============================================================================
 * It is technically possible to establish a Ghost member session without going
 * through the magic link flow: the Admin API can create a member and — with
 * enough knowledge of Ghost's session cookie format — a token could be injected
 * directly into browser storage to simulate an authenticated state. This
 * approach is common in test suites that want to skip slow auth flows.
 *
 * This suite deliberately does not take that shortcut. The reasons:
 *
 *   1. Authenticity. The magic link flow is the product. Bypassing it means the
 *      test never exercises the email dispatch, the Mailpit intercept, the link
 *      extraction, or the token redemption endpoint — all of which are failure
 *      surfaces in a real deployment.
 *
 *   2. Coverage. A session-injection approach would pass even if Ghost stopped
 *      sending magic link emails entirely. The real flow fails fast when email
 *      delivery breaks — which is exactly the kind of regression that matters.
 *
 *   3. Trust. Subsequent member tests (MU-005 through MU-010) that depend on an
 *      authenticated session can inherit the storage state produced by this test.
 *      That state was produced by the real auth mechanism, not a synthetic cookie,
 *      so it behaves identically to a genuine member session in every subsequent
 *      assertion.
 *
 * =============================================================================
 * HOW THIS MAPS TO REAL-WORLD PASSWORDLESS AUTH TESTING
 * =============================================================================
 * Magic link and OTP-based auth patterns are increasingly common outside Ghost:
 * Slack, Notion, Linear, and many SaaS products offer or require passwordless
 * login. The general pattern this test establishes — trigger → intercept →
 * extract → navigate — is directly applicable to any system that sends a
 * one-time URL or code to an email address:
 *
 *   - Point the application's SMTP at a local intercept (Mailpit, MailHog,
 *     smtp4dev, or an equivalent).
 *   - Trigger the auth action from the browser.
 *   - Query the intercept's REST API for the message addressed to the test email.
 *   - Parse the message body to extract the URL or code.
 *   - Complete the auth flow in the browser by navigating to the URL or entering
 *     the code.
 *
 * The same fixture (MailpitHelper) and the same polling pattern used here can be
 * adapted to test any passwordless system without touching external mail
 * infrastructure. That generalisability is part of what makes this test design
 * worth calling out explicitly in a portfolio context.
 * =============================================================================
 */

import { test, expect, generateTestEmail, MEMBER_AUTH_FILE, MEMBER_COOKIES_FILE } from '../fixtures';
import * as fs from 'fs';
import path from 'path';

const PORTAL_SIGNIN_URL = '/#/portal/signin';

// Email address used throughout this spec — stable label so Mailpit lookups are
// unambiguous when filtering by recipient address
const TEST_EMAIL = generateTestEmail('magic-link-test');

// Mailpit is cleared after MU-004 to prevent stale magic-link emails from
// interfering with content-access tests. Members are NOT deleted here — the
// member account must remain active for the saved session cookie to stay valid.
// content-access.spec.ts handles member teardown in its own afterAll.
test.afterAll(async ({ mailpit }) => {
  await mailpit.deleteAllMessages();
});

test.describe('Member UI — Magic Link Authentication', () => {
  /**
   * MU-004: A member can authenticate via the full magic link flow.
   *
   * This test exercises the complete, real end-to-end authentication chain:
   * portal form submission → Ghost sends email → Mailpit intercepts it →
   * Playwright extracts the magic link → browser navigates to it → session
   * is established. No shortcuts or session injection.
   *
   * A members-only post is asserted as accessible after authentication to
   * confirm that the session is fully functional, not just that the redirect
   * landed somewhere plausible.
   */
  test('MU-004: member authenticates via magic link and accesses members-only content', async ({
    page,
    adminApi,
    mailpit,
  }) => {
    // Pre-create the member via Admin API so the email is registered before
    // the magic link request. Ghost requires the member to exist first — it
    // will not create a new account from the signin portal (only from signup).
    await adminApi.createMember({ name: 'MU-004 Magic Link Member', email: TEST_EMAIL });

    // Pre-create a members-only post so there is something to gate-check after
    // authentication. The slug is stable so the URL is predictable in assertions.
    const membersPost = await adminApi.createPost({
      title: 'MU-004 Members Only Post',
      status: 'published',
      visibility: 'members',
    });

    // -------------------------------------------------------------------------
    // Step 1 — Request the magic link via the Ghost portal
    // -------------------------------------------------------------------------
    await page.goto(PORTAL_SIGNIN_URL);

    const portalFrame = page.frameLocator('#ghost-portal-root iframe');

    await portalFrame.getByRole('textbox', { name: /email/i }).fill(TEST_EMAIL);
    await portalFrame.getByRole('button', { name: /send|continue|sign in|magic link/i }).click();

    // Ghost confirms the link has been sent before the email arrives in Mailpit
    await expect(
      portalFrame.getByText(/check your email|magic link/i),
    ).toBeVisible({ timeout: 15_000 });

    // -------------------------------------------------------------------------
    // Step 2 — Retrieve the email from Mailpit
    // -------------------------------------------------------------------------
    // Poll for up to 10 seconds — Ghost's email dispatch is near-instant via
    // Mailpit but a brief queue delay is possible under NAS load
    let message = await mailpit.getLatestEmailTo(TEST_EMAIL);
    const deadline = Date.now() + 10_000;

    while (!message && Date.now() < deadline) {
      // waitForTimeout is intentional here — there is no DOM locator to wait on
      // between Mailpit polls. We are waiting for Ghost's SMTP dispatch to an
      // external service (Mailpit), not for a page element to appear. This is
      // the one case in the suite where a timed wait is the correct tool.
      await page.waitForTimeout(1_000);
      message = await mailpit.getLatestEmailTo(TEST_EMAIL);
    }

    // Fail fast with a clear message rather than letting the next step produce
    // a cryptic "cannot extract link from null" error
    expect(message, 'Magic link email should arrive in Mailpit within 10 seconds').not.toBeNull();

    // -------------------------------------------------------------------------
    // Step 3 — Extract the magic link and navigate to it
    // -------------------------------------------------------------------------
    const magicLink = mailpit.extractMagicLink(message!);

    // Navigate to the magic link URL directly; Ghost's token redemption endpoint
    // sets the session cookie and then redirects the browser to the site
    await page.goto(magicLink);

    // Ghost redirects to the homepage or account page after a successful token
    // redemption — wait for navigation to settle
    await page.waitForLoadState('networkidle');

    // -------------------------------------------------------------------------
    // Step 4 — Assert the session is established
    // -------------------------------------------------------------------------
    // The Ghost portal account button or member-specific UI elements confirm
    // that the browser holds an authenticated member session. Ghost adds a
    // data attribute or renders member-specific controls in the portal widget.
    await page.goto('/#/portal/account');

    const accountFrame = page.frameLocator('#ghost-portal-root iframe');
    // The account screen shows the member's email address when authenticated
    await expect(accountFrame.getByText(TEST_EMAIL)).toBeVisible({ timeout: 15_000 });

    // Persist the authenticated session so content-access.spec.ts can reuse it
    // without requesting a second magic link. Two files are saved:
    //
    //   MEMBER_AUTH_FILE      — storageState (persistent cookies only; session
    //                           cookie is absent — see file header for why)
    //   MEMBER_COOKIES_FILE   — context().cookies() snapshot, which includes ALL
    //                           cookies: both persistent and session-scoped.
    //                           content-access.spec.ts restores this file via
    //                           addCookies() to get the complete two-cookie pair
    //                           that Ghost's member API requires.
    //
    // Ghost's IP-level rate limiter rejects "too many different sign-in attempts"
    // if too many unique magic link requests are sent in a short window. Reusing
    // the session cookie from this snapshot eliminates the second magic link
    // request that would otherwise trip the limiter.
    fs.mkdirSync(path.dirname(MEMBER_AUTH_FILE), { recursive: true });
    await page.context().storageState({ path: MEMBER_AUTH_FILE });

    const allCookies = await page.context().cookies();
    fs.writeFileSync(MEMBER_COOKIES_FILE, JSON.stringify(allCookies));

    // -------------------------------------------------------------------------
    // Step 5 — Assert members-only content is accessible
    // -------------------------------------------------------------------------
    // Navigate to the members-only post by its URL. If the session is not valid,
    // Ghost redirects unauthenticated visitors to the portal signup page instead
    // of serving the post content.
    await page.goto(membersPost.url);

    // The post title appearing on the page confirms the content was served —
    // Ghost would redirect rather than render the title for unauthenticated users
    // Scope to h1 — the post page also renders the title in an h2 nav element,
    // which would cause a strict mode violation with a generic heading selector.
    await expect(page.locator('h1').filter({ hasText: 'MU-004 Members Only Post' })).toBeVisible({
      timeout: 15_000,
    });

    // Confirm we did NOT land on a portal redirect (which would indicate the
    // session was not established correctly)
    await expect(page).not.toHaveURL(/#\/portal/);

    // Teardown: delete the post created for this test
    await adminApi.deletePost(membersPost.id);
  });
});
