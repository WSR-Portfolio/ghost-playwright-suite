/**
 * Admin UI — Authentication (AU-001 through AU-003)
 *
 * storageState pattern: AU-001 performs a real login and saves browser storage
 * (cookies + localStorage) to .auth/admin.json after a successful login. Every
 * subsequent admin-ui spec file can declare `use: { storageState: '.auth/admin.json' }`
 * in its project config (or via test.use()) to start each test already logged in,
 * skipping the full login flow entirely. This cuts seconds off every test in the
 * admin-ui suite and avoids hammering the login endpoint on every run.
 *
 * Ghost v6 verification step: Ghost v6 sends a 6-digit verification code to the
 * admin email when logging in from an unrecognized browser (a Playwright run always
 * starts with a fresh browser profile). This code is captured via Mailpit and entered
 * automatically to complete the login flow.
 */

import { test, expect } from '../fixtures';
import type { MailpitHelper } from '../fixtures';
import path from 'path';
import * as fs from 'fs';

const ADMIN_PATH = '/ghost';
const AUTH_FILE = path.resolve('.auth/admin.json');

/**
 * Poll Mailpit for a 6-digit verification code sent to the given address.
 * Ghost v6 sends a login verification code when the browser is unrecognized.
 * Retries up to 10 times with 1-second intervals before throwing.
 */
async function getAdminVerificationCode(mailpit: MailpitHelper, adminEmail: string): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const message = await mailpit.getLatestEmailTo(adminEmail);
    if (message) {
      const source = message.HTML || message.Text || '';
      // Ghost's verification email contains the code as a standalone 6-digit number
      const match = source.match(/\b(\d{6})\b/);
      if (match) return match[1];
    }
    // Wait 1 second between polls — Mailpit delivery is near-instant on local Docker
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`No 6-digit verification code found in Mailpit for ${adminEmail} after 10 attempts`);
}

test.describe('Admin Authentication', () => {
  /**
   * AU-001: Valid credentials reach the dashboard.
   *
   * This is the foundational auth test. It also saves authenticated storage
   * state so all other admin-ui specs can reuse the session without re-logging in.
   *
   * Ghost v6 may redirect to /signin/verify after valid credentials if the browser
   * is unrecognized. When this happens, the test retrieves the 6-digit code from
   * Mailpit and completes the verification step automatically.
   */
  test('AU-001: login with valid credentials reaches dashboard', async ({ page, mailpit }) => {
    const email = process.env.GHOST_ADMIN_EMAIL!;
    const password = process.env.GHOST_ADMIN_PASSWORD!;

    // Ensure the .auth directory exists before trying to write to it
    fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });

    // Clear any stale verification emails from prior runs before triggering a new login
    await mailpit.deleteAllMessages();

    await page.goto(ADMIN_PATH);
    await expect(page).toHaveURL(/\/ghost\/#\/signin/);

    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Ghost v6 sends a verification code when logging in from an unrecognized browser.
    // Check whether we've been redirected to the verification step.
    await page.waitForURL(/\/#\/signin|dashboard/, { timeout: 15_000 });

    if (page.url().includes('/signin/verify')) {
      const code = await getAdminVerificationCode(mailpit, email);
      await page.getByRole('textbox', { name: /code|verify|token/i }).fill(code);
      await page.getByRole('button', { name: /verify/i }).click();
    }

    await expect(page).toHaveURL(/\/ghost\/#\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // Persist the authenticated session for all other admin-ui test files.
    // .auth/ is gitignored — tokens must never be committed.
    await page.context().storageState({ path: AUTH_FILE });
  });

  /**
   * AU-002: Wrong password shows an error message.
   *
   * Validates that Ghost rejects bad credentials with a visible user-facing error
   * rather than silently failing or redirecting.
   */
  test('AU-002: login with invalid password shows error message', async ({ page }) => {
    const email = process.env.GHOST_ADMIN_EMAIL!;

    await page.goto(ADMIN_PATH);
    await expect(page).toHaveURL(/\/ghost\/#\/signin/);

    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill('definitely-not-the-right-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Ghost displays an inline error when credentials are rejected
    await expect(page.getByText(/your password is incorrect/i)).toBeVisible();
  });

  /**
   * AU-003: Session persists after a full page reload.
   *
   * Confirms that Ghost's auth cookie / localStorage token survives a hard
   * reload. Reuses the saved storage state from AU-001.
   */
  test('AU-003: session persists after page reload', async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH_FILE });
    const page = await context.newPage();

    await page.goto(ADMIN_PATH);
    await expect(page).toHaveURL(/\/ghost\/#\/dashboard/);

    await page.reload();

    await expect(page).toHaveURL(/\/ghost\/#\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await context.close();
  });
});
