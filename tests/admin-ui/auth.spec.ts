/**
 * Admin UI — Authentication (AU-001 through AU-003)
 *
 * storageState pattern: AU-001 performs a real login and saves browser storage
 * (cookies + localStorage) to .auth/admin.json after a successful login. Every
 * subsequent admin-ui spec file can declare `use: { storageState: '.auth/admin.json' }`
 * in its project config (or via test.use()) to start each test already logged in,
 * skipping the full login flow entirely. This cuts seconds off every test in the
 * admin-ui suite and avoids hammering the login endpoint on every run.
 */

import { test, expect } from '@playwright/test';
import path from 'path';

const ADMIN_PATH = '/ghost';
const AUTH_FILE = path.resolve('.auth/admin.json');

test.describe('Admin Authentication', () => {
  /**
   * AU-001: Valid credentials reach the dashboard.
   *
   * This is the foundational auth test. It also saves authenticated storage
   * state so all other admin-ui specs can reuse the session without re-logging in.
   */
  test('AU-001: login with valid credentials reaches dashboard', async ({ page }) => {
    const email = process.env.GHOST_ADMIN_EMAIL!;
    const password = process.env.GHOST_ADMIN_PASSWORD!;

    await page.goto(ADMIN_PATH);

    // Ghost redirects unauthenticated requests to the signin page
    await expect(page).toHaveURL(/\/ghost\/#\/signin/);

    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Successful login lands on the Ghost admin dashboard
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
   * rather than silently failing or redirecting. Uses a fresh browser context
   * (no stored auth state) so this test is fully independent of AU-001.
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
   * reload and does not require re-authentication. Reuses the saved storage
   * state from AU-001 to start already logged in.
   */
  test('AU-003: session persists after page reload', async ({ browser }) => {
    // Start from the saved storage state produced by AU-001
    const context = await browser.newContext({ storageState: AUTH_FILE });
    const page = await context.newPage();

    await page.goto(ADMIN_PATH);
    await expect(page).toHaveURL(/\/ghost\/#\/dashboard/);

    // Hard reload — Ghost should restore the session from stored auth tokens
    await page.reload();

    await expect(page).toHaveURL(/\/ghost\/#\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await context.close();
  });
});
