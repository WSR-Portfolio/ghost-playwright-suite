/**
 * Admin UI — Pages (AU-017 through AU-019)
 *
 * Pages are a distinct resource type from posts in Ghost's data model. They use
 * different API endpoints (/ghost/api/admin/pages/ vs /ghost/api/admin/posts/),
 * have different default visibility behavior, and appear in a separate section
 * of the Ghost admin UI. Testing them independently validates that Ghost's page
 * CRUD flows are wired correctly — a suite that only tests posts and assumes pages
 * work identically has incomplete coverage.
 *
 * All tests start with the stored admin session from .auth/admin.json.
 */

import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import path from 'path';

test.use({ storageState: path.resolve('.auth/admin.json') });

let cleanupIds: string[] = [];

test.afterEach(async ({ adminApi }) => {
  for (const id of cleanupIds) {
    await adminApi.deletePage(id);
  }
  cleanupIds = [];
});

async function waitForSave(page: Page): Promise<void> {
  await page.keyboard.press('Meta+S');
  await expect(page.getByText('Saved')).toBeVisible();
}

test.describe('Admin UI — Pages', () => {
  /**
   * AU-017: Create a new page via the Ghost admin UI.
   * Pages share Ghost's Lexical editor with posts but are created at
   * /ghost/#/editor/page and are served at standalone URLs outside the post feed.
   */
  test('AU-017: create a new page', async ({ page }) => {
    await page.goto('/ghost/#/editor/page');
    await expect(page).toHaveURL(/\/editor\/page/);

    await page.getByRole('textbox', { name: /page title/i }).fill('AU-017 Test Page');

    const editorBody = page.locator('[data-kg="editor"]').first();
    await editorBody.click();
    await page.keyboard.type('AU-017 test page body content.');

    // For a new page Ghost creates the record and updates the URL on first save
    // (from /editor/page to /editor/page/{id}), so the "Saved" toast races with
    // the URL change. Wait for the ID-bearing URL instead of the toast.
    await page.keyboard.press('Meta+S');
    await page.waitForURL(/\/editor\/page\/[a-f0-9]+/, { timeout: 15000 });

    // Capture the page ID from the URL for afterEach cleanup
    const url = page.url();
    const match = url.match(/\/editor\/page\/([a-f0-9]+)/);
    if (match) cleanupIds.push(match[1]);

    await expect(page.getByRole('textbox', { name: /page title/i })).toHaveValue('AU-017 Test Page');
  });

  /**
   * AU-018: Edit a page title and confirm the change persists after navigating away.
   * Navigating away flushes React component state and forces the editor to reload
   * from the database — confirming the edit was persisted, not just held in memory.
   */
  test('AU-018: edit a page; changes persist after navigating away', async ({ page, adminApi }) => {
    const ghostPage = await adminApi.createPage({ title: 'AU-018 Original Page Title' });
    cleanupIds.push(ghostPage.id);

    await page.goto(`/ghost/#/editor/page/${ghostPage.id}`);

    const titleInput = page.getByRole('textbox', { name: /page title/i });
    await titleInput.clear();
    await titleInput.fill('AU-018 Updated Page Title');

    await waitForSave(page);

    // Navigate away to clear local state, then navigate back
    await page.goto('/ghost/#/pages');
    await expect(page).toHaveURL(/\/#\/pages/);

    await page.goto(`/ghost/#/editor/page/${ghostPage.id}`);
    await expect(page.getByRole('textbox', { name: /page title/i })).toHaveValue('AU-018 Updated Page Title');
  });

  /**
   * AU-019: Delete a page via the admin UI and confirm it no longer appears in the page list.
   */
  test('AU-019: delete a page; page no longer appears in page list', async ({ page, adminApi }) => {
    // Include a timestamp to avoid strict mode violations from leftover pages
    // created by previous failed test runs that share the same title.
    const pageTitle = `AU-019 Page to Delete ${Date.now()}`;
    const ghostPage = await adminApi.createPage({ title: pageTitle });
    // Not tracked in cleanupIds — the UI deletion is the assertion

    // Ghost v6 removed the hover kebab/more menu from the page list.
    // Delete is accessible from within the page editor's settings sidebar.
    await page.goto(`/ghost/#/editor/page/${ghostPage.id}`);
    // Ghost's SPA router may render the editor asynchronously — wait for network idle
    // before asserting editor elements to avoid a race on fresh page loads.
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('textbox', { name: /page title/i })).toBeVisible({ timeout: 15000 });

    // Open the page settings sidebar
    await page.getByRole('button', { name: /settings/i }).click();
    await expect(page.locator('.settings-menu, [data-testid="post-settings"], .gh-editor-sidebar').first()).toBeVisible();

    // "Delete page" appears at the bottom of the settings sidebar
    await page.getByRole('button', { name: /delete page/i }).click();

    // Ghost shows a confirmation dialog before permanent deletion
    await page.getByRole('button', { name: /delete/i }).last().click();

    // After deletion Ghost redirects to the page list; the page should not appear
    await expect(page).toHaveURL(/\/#\/pages/);
    await expect(page.getByText(pageTitle)).not.toBeVisible();
  });
});
