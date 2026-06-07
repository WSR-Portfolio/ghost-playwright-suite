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
   *
   * Ghost v6 redesigned settings into a modal/panel system. Navigation is accessed
   * by clicking "Navigation" in the left sidebar → clicking "Customize" in the resulting
   * card → editing in a dialog with textbox inputs named "Label" and "URL".
   */
  test('AU-027: add a custom navigation item; persists after save; cleaned up after test', async ({ page }) => {
    // Helper: open the navigation editor dialog from the settings panel.
    // Always navigates to /ghost/#/settings first — Ghost encodes the open modal in the
    // URL, so a reload or re-entry can restore the modal-backdrop overlay without
    // role="dialog", which would block all subsequent clicks. The goto resets this state.
    async function openNavEditor(): Promise<void> {
      await page.goto('/ghost/#/settings');
      await page.waitForLoadState('networkidle');
      // If Ghost restored the modal-backdrop after the goto, the editor is already open.
      if (await page.locator('#modal-backdrop').isVisible()) {
        return;
      }
      // The Navigation card has data-testid="navigation". Click it to reveal the card
      // panel with the "Customize" button. Scoping to the card avoids strict-mode
      // violations with the modal's own "Navigation" heading.
      await page.locator('[data-testid="navigation"]').click();
      await page.waitForLoadState('networkidle');
      // The Navigation card's title is a level-5 heading. Traverse up 2 ancestor levels
      // to the card container, then click its "Customize" button. This avoids matching
      // "Design & branding" and "Announcement bar" which also have "Customize" buttons.
      await page.getByRole('heading', { name: 'Navigation', level: 5 })
        .locator('xpath=ancestor::*[2]')
        .getByRole('button', { name: /customize/i })
        .click();
      await page.waitForLoadState('networkidle');
    }

    await openNavEditor();

    // The navigation editor dialog lists nav items with textbox inputs whose ARIA
    // accessible names are "Label" and "URL" (not placeholder attributes).
    const labelInputs = page.getByRole('textbox', { name: 'Label' });
    const urlInputs = page.getByRole('textbox', { name: 'URL' });

    // Target the last row (the empty new-item row) for the new nav item
    const count = await labelInputs.count();
    await labelInputs.nth(count - 1).fill('QA Test Link');
    await urlInputs.nth(count - 1).fill('https://example.com');

    await page.getByRole('button', { name: /save/i }).click();
    // Ghost's navigation dialog closes on successful save — no "Saved" toast is shown.
    // Wait for the dialog to disappear as the save confirmation signal.
    await expect(page.getByRole('dialog')).toBeHidden();

    // Reload to confirm the nav item was persisted to the database
    await page.reload();
    await page.waitForLoadState('networkidle');

    // After reload, re-open the navigation editor (Ghost v6 returns to the settings index)
    await openNavEditor();

    // Verify the 'QA Test Link' item appears in the nav editor after reload
    const allLabels = page.getByRole('textbox', { name: 'Label' });
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
    const allLabelsFresh = page.getByRole('textbox', { name: 'Label' });
    const freshCount = await allLabelsFresh.count();
    for (let i = 0; i < freshCount; i++) {
      const val = await allLabelsFresh.nth(i).inputValue();
      if (val === 'QA Test Link') {
        // Try clicking the row's delete/trash button (icon button adjacent to the inputs)
        const row = allLabelsFresh.nth(i).locator('../..');
        const removeBtn = row.getByRole('button').last();
        if (await removeBtn.isVisible()) {
          await removeBtn.click();
        } else {
          // Fallback: clear both fields so Ghost treats the row as empty/removed
          await allLabelsFresh.nth(i).clear();
          await page.getByRole('textbox', { name: 'URL' }).nth(i).clear();
        }
        break;
      }
    }

    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  });
});
