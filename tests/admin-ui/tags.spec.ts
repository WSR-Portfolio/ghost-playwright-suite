/**
 * Admin UI — Tags (AU-020 through AU-023)
 *
 * All tests start with the stored admin session from .auth/admin.json.
 */

import { test, expect, generateAdminToken } from '../fixtures';
import path from 'path';

test.use({ storageState: path.resolve('.auth/admin.json') });

const GHOST_URL = (process.env.GHOST_URL ?? '').replace(/\/$/, '');

let cleanupIds: string[] = [];

test.afterEach(async ({ adminApi }) => {
  for (const id of cleanupIds) {
    await adminApi.deleteTag(id);
  }
  cleanupIds = [];
});

test.describe('Admin UI — Tags', () => {
  /**
   * AU-020: Create a new public tag via the Ghost admin UI.
   * Tags are Ghost's primary content organization mechanism. Validates the
   * tag creation form at /ghost/#/tags/new.
   */
  test('AU-020: create a new tag', async ({ page, request }) => {
    await page.goto('/ghost/#/tags/new');
    await expect(page).toHaveURL(/\/#\/tags\/new/);

    await page.getByRole('textbox', { name: /tag name/i }).fill('au-020-ui-tag');
    await page.getByRole('textbox', { name: /description/i }).fill('Created by AU-020 Playwright test');

    await page.getByRole('button', { name: /save/i }).click();

    // Ghost redirects to the tag's edit page after a successful save
    await expect(page).toHaveURL(/hash-au-020-ui-tag|au-020-ui-tag/);
    await expect(page.getByRole('textbox', { name: /tag name/i })).toHaveValue('au-020-ui-tag');

    // Look up the tag via Admin API to get its ID for cleanup
    const res = await request.get(`${GHOST_URL}/ghost/api/admin/tags/slug/au-020-ui-tag/`, {
      headers: { Authorization: `Ghost ${generateAdminToken()}` },
    });
    if (res.status() === 200) {
      const body = await res.json();
      cleanupIds.push(body.tags[0].id);
    }
  });

  /**
   * AU-021: Create an internal tag using the # prefix convention.
   *
   * Ghost treats tags whose names begin with '#' as internal/organizational tags —
   * they are not rendered publicly on the site but are used for content filtering
   * and editorial organization. Ghost normalizes the slug of internal tags by
   * replacing '#' with 'hash-' (e.g. '#qa-internal' → slug 'hash-qa-internal').
   *
   * This is a non-obvious Ghost behavior that would be invisible to a tester
   * unfamiliar with the internal tag convention. A regression here could silently
   * break internal tagging workflows used by editors to organize content behind
   * the scenes.
   */
  test('AU-021: create an internal tag with # prefix; slug normalized to hash-', async ({ page, request }) => {
    await page.goto('/ghost/#/tags/new');

    await page.getByRole('textbox', { name: /tag name/i }).fill('#qa-internal');

    await page.getByRole('button', { name: /save/i }).click();

    // Ghost normalizes internal tag slugs from '#qa-internal' → 'hash-qa-internal'
    await expect(page).toHaveURL(/hash-qa-internal/);

    // Cross-layer: verify via Admin API that the slug starts with 'hash-'
    const res = await request.get(`${GHOST_URL}/ghost/api/admin/tags/slug/hash-qa-internal/`, {
      headers: { Authorization: `Ghost ${generateAdminToken()}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const tag = body.tags[0];
    expect(tag.slug).toMatch(/^hash-/);

    cleanupIds.push(tag.id);
  });

  /**
   * AU-022: Edit a tag description and confirm the change persists after save.
   */
  test('AU-022: edit a tag description; change persists after reload', async ({ page, adminApi }) => {
    const tag = await adminApi.createTag({ name: 'au-022-edit-tag', description: 'Original description' });
    cleanupIds.push(tag.id);

    await page.goto(`/ghost/#/tags/${tag.slug}`);

    const descInput = page.getByRole('textbox', { name: /description/i });
    await descInput.clear();
    await descInput.fill('AU-022 updated description');

    await page.getByRole('button', { name: /save/i }).click();

    // Reload to confirm the description was written to the database, not just held in state
    await page.reload();
    await expect(page.getByRole('textbox', { name: /description/i })).toHaveValue('AU-022 updated description');
  });

  /**
   * AU-023: Delete a tag via the admin UI and confirm it no longer appears in the tag list.
   */
  test('AU-023: delete a tag; tag no longer appears in tag list', async ({ page, adminApi }) => {
    const tag = await adminApi.createTag({ name: 'au-023-delete-tag' });
    // Not tracked in cleanupIds — the UI deletion is the assertion

    await page.goto(`/ghost/#/tags/${tag.slug}`);

    await page.getByRole('button', { name: /delete tag/i }).click();

    // Confirm deletion in the dialog
    await page.getByRole('button', { name: /delete/i }).last().click();

    // Ghost redirects to the tag list after deletion
    await expect(page).toHaveURL(/\/#\/tags/);
    await expect(page.getByRole('link', { name: /au-023-delete-tag/i })).not.toBeVisible();
  });
});
