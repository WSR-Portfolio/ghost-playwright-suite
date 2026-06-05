/**
 * Admin UI — Settings (AU-027)
 *
 * All tests start with the stored admin session from .auth/admin.json.
 */

import { test, expect } from '../fixtures';
import path from 'path';

test.use({ storageState: path.resolve('.auth/admin.json') });

test.describe('Admin UI — Settings', () => {
  /**
   * AU-027: Add a custom navigation item in Settings → Navigation and verify it persists.
   *
   * Ghost's navigation settings allow publishers to define the site's primary and
   * secondary nav menus. Changes here affect the live site immediately after save.
   * This test adds a known item, verifies it survives a page reload (confirming the
   * save wrote to the database), then removes it to leave the site in its original state.
   *
   * Cleanup happens within the test itself rather than afterEach because navigation
   * is global site state, not an isolated resource — an afterEach that runs after a
   * test failure could delete a nav item the user intentionally had configured.
   */
  test('AU-027: add a custom navigation item; persists after save; cleaned up after test', async ({ page }) => {
    await page.goto('/ghost/#/settings/navigation');
    await expect(page).toHaveURL(/\/#\/settings\/navigation/);

    // Ghost's navigation editor lists existing nav items and provides a blank row
    // at the bottom for adding a new one. Fill in the last empty label field.
    const labelInputs = page.getByRole('textbox', { name: /label/i });
    const urlInputs = page.getByRole('textbox', { name: /url/i });

    // Count existing items and target the last (empty) row
    const count = await labelInputs.count();
    await labelInputs.nth(count - 1).fill('QA Test Link');
    await urlInputs.nth(count - 1).fill('https://example.com');

    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.getByText(/saved/i).first()).toBeVisible();

    // Reload to confirm the nav item was persisted to the database
    await page.reload();
    await expect(page).toHaveURL(/\/#\/settings\/navigation/);
    await expect(page.getByRole('textbox', { name: /label/i }).filter({ hasText: '' }).first()).not.toHaveValue('QA Test Link');

    // Verify the 'QA Test Link' item appears in the nav editor after reload
    const allLabels = page.getByRole('textbox', { name: /label/i });
    const labelCount = await allLabels.count();
    let found = false;
    for (let i = 0; i < labelCount; i++) {
      const val = await allLabels.nth(i).inputValue();
      if (val === 'QA Test Link') {
        found = true;
        break;
      }
    }
    expect(found, 'QA Test Link nav item should persist after page reload').toBe(true);

    // --- Cleanup: remove the test nav item before ending the test ---
    // Find and clear the 'QA Test Link' row, then save to restore original nav state
    for (let i = 0; i < labelCount; i++) {
      const val = await allLabels.nth(i).inputValue();
      if (val === 'QA Test Link') {
        // Click the delete/remove button for this nav item row
        const row = allLabels.nth(i).locator('../..');
        const removeBtn = row.getByRole('button', { name: /delete|remove/i });
        if (await removeBtn.isVisible()) {
          await removeBtn.click();
        } else {
          // Fallback: clear the label and URL fields so the row is empty
          await allLabels.nth(i).clear();
          const urlVal = urlInputs.nth(i);
          await urlVal.clear();
        }
        break;
      }
    }

    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.getByText(/saved/i).first()).toBeVisible();
  });
});
