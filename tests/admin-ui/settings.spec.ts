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
    // The navigation editor dialog lists nav items with textbox inputs whose ARIA
    // accessible names are "Label" and "URL" (not placeholder attributes). These are
    // declared before the helpers below because both use them as the signal for whether
    // the editor has finished opening or closing.
    const labelInputs = page.getByRole('textbox', { name: 'Label' });
    const urlInputs = page.getByRole('textbox', { name: 'URL' });

    /**
     * Reads every nav row's Label value in a single round trip.
     *
     * Looping `labelInputs.nth(i).inputValue()` re-resolves the locator on each call,
     * so a re-render between iterations detaches the element mid-loop and the read
     * times out. Ghost's React settings panel re-renders freely after a reload, which
     * is exactly how this test failed on 6.57.1. Snapshotting all values at once means
     * the DOM is queried once and cannot shift underneath us.
     */
    async function readLabelValues(): Promise<string[]> {
      return labelInputs.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
    }

    /**
     * Helper: open the navigation editor dialog from the settings panel.
     *
     * Ghost encodes the open modal in the URL, so returning to /ghost/#/settings after a
     * reload briefly *restores* the editor and then tears it down as client-side routing
     * settles. That leaves a window in which the Label inputs are present and readable
     * but about to vanish — reads succeed and the next action times out against a closed
     * dialog. Any "is it already open?" shortcut is therefore unsafe on 6.57.1: it cannot
     * distinguish a restored-and-doomed modal from a real one.
     *
     * So this helper never reuses restored state. It lands on a non-modal route first to
     * discard it, asserts the editor is genuinely closed, then opens it by the explicit
     * click path — making every entry identical whether or not a reload preceded it.
     */
    async function openNavEditor(): Promise<void> {
      await page.goto('/ghost/#/posts');
      await page.waitForLoadState('networkidle');
      await page.goto('/ghost/#/settings');
      await page.waitForLoadState('networkidle');
      // Settle point: the settings index has no Label inputs, so this retries until any
      // restored modal has finished being dismissed. Without it the click below can race
      // the teardown and land on a backdrop.
      await expect(labelInputs).toHaveCount(0);
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
      // The editor is only usable once its first Label input has rendered. Waiting on
      // the control the test actually drives — rather than on network idle — is what
      // makes re-entry after a reload deterministic.
      await expect(labelInputs.first()).toBeVisible();
    }

    await openNavEditor();

    // Target the last row (the empty new-item row) for the new nav item
    await labelInputs.last().fill('QA Test Link');
    await urlInputs.last().fill('https://example.com');

    await page.getByRole('button', { name: /save/i }).click();
    // Ghost's navigation dialog closes on successful save — no "Saved" toast is shown.
    // Wait for the dialog to disappear as the save confirmation signal.
    await expect(page.getByRole('dialog')).toBeHidden();

    // Reload to confirm the nav item was persisted to the database
    await page.reload();
    await page.waitForLoadState('networkidle');

    // After reload, re-open the navigation editor (Ghost v6 returns to the settings index)
    await openNavEditor();

    // Verify the 'QA Test Link' item appears in the nav editor after reload. This is the
    // assertion that proves the save reached the database rather than only the UI state.
    const persistedIndex = (await readLabelValues()).indexOf('QA Test Link');
    expect(persistedIndex, 'QA Test Link nav item should persist after page reload')
      .toBeGreaterThanOrEqual(0);

    // --- Cleanup: remove the test nav item before ending the test ---
    // Re-read rather than reusing persistedIndex: the assertion above may have been
    // satisfied before a re-render, and the row order is only guaranteed at read time.
    const cleanupIndex = (await readLabelValues()).indexOf('QA Test Link');
    if (cleanupIndex >= 0) {
      const row = labelInputs.nth(cleanupIndex).locator('../..');
      // Try clicking the row's delete/trash button (icon button adjacent to the inputs)
      const removeBtn = row.getByRole('button').last();
      if (await removeBtn.isVisible()) {
        await removeBtn.click();
      } else {
        // Fallback: clear both fields so Ghost treats the row as empty/removed
        await labelInputs.nth(cleanupIndex).clear();
        await urlInputs.nth(cleanupIndex).clear();
      }
    }

    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  });
});
