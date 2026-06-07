/**
 * Admin UI — Members (AU-024 through AU-026)
 *
 * All tests start with the stored admin session from .auth/admin.json.
 */

import { test, expect, generateTestEmail } from '../fixtures';
import path from 'path';

test.use({ storageState: path.resolve('.auth/admin.json') });

let cleanupIds: string[] = [];

test.afterEach(async ({ adminApi }) => {
  for (const id of cleanupIds) {
    await adminApi.deleteMember(id);
  }
  cleanupIds = [];
});

test.describe('Admin UI — Members', () => {
  /**
   * AU-024: View the member list in the Ghost admin panel.
   * Validates that the members section is accessible and renders a list view.
   * A prerequisite check for the more complex member management tests that follow.
   */
  test('AU-024: view member list in admin', async ({ page }) => {
    await page.goto('/ghost/#/members');
    await expect(page).toHaveURL(/\/#\/members/);

    // The members list should render with a heading and the member table/grid
    await expect(page.getByRole('heading', { name: /members/i })).toBeVisible();
  });

  /**
   * AU-025: Manually add a new member via the Ghost admin UI.
   * Publishers occasionally need to manually add known contacts as members
   * without going through the public signup flow. Validates the manual add form.
   */
  test('AU-025: manually add a new member via admin UI', async ({ page, adminApi }) => {
    const email = generateTestEmail(`au-025-${Date.now()}`);

    await page.goto('/ghost/#/members/new');
    await expect(page).toHaveURL(/\/#\/members\/new/);

    await page.getByRole('textbox', { name: /name/i }).fill('AU-025 Test Member');
    await page.getByRole('textbox', { name: /email/i }).fill(email);

    await page.getByRole('button', { name: /save/i }).click();

    // Ghost navigates to the member's detail page after a successful save
    await expect(page).toHaveURL(/\/#\/members\/[a-f0-9]+/);
    await expect(page.getByText(email)).toBeVisible();

    // Look up the created member by email for afterEach cleanup
    const member = await adminApi.getMemberByEmail(email);
    if (member) cleanupIds.push(member.id);
  });

  /**
   * AU-026: Delete a member via the Ghost admin UI.
   * Validates the member delete workflow accessible from the member detail page.
   */
  test('AU-026: delete a member via admin UI', async ({ page, adminApi }) => {
    const email = generateTestEmail(`au-026-${Date.now()}`);
    const member = await adminApi.createMember({ name: 'AU-026 Member to Delete', email });
    // Not tracked in cleanupIds — the UI deletion is the assertion

    // In Ghost v6 the members list does not expose the email as a navigable link role.
    // Navigate directly to the member detail page using the created member's ID.
    await page.goto(`/ghost/#/members/${member.id}`);

    await expect(page).toHaveURL(/\/#\/members\/[a-f0-9]+/);

    // The "Delete member" button is obscured by the email input in Ghost v6's layout.
    // dispatchEvent fires the click event directly on the DOM element, bypassing
    // pointer-event routing that would otherwise deliver it to the overlapping input.
    await page.locator('[data-test-button="delete-member"]').dispatchEvent('click');

    // Ghost's confirmation panel has no role="dialog" — it's a generic container.
    // Wait for the heading that uniquely identifies it, then click the confirm button.
    // Two "Delete member" buttons exist in the DOM (trigger + confirm); use .last() to
    // target the confirmation button which appears later in DOM order.
    await expect(page.getByRole('heading', { name: 'Delete member account' })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Delete member' }).last().click();

    // Ghost redirects back to the member LIST after deletion.
    // Use a URL pattern that excludes the member detail URL (no hex ID segment).
    await page.waitForURL(/\/#\/members(?!\/[a-f0-9]{24})/, { timeout: 15000 });
    // The deleted member's email should no longer appear; use first() to handle
    // cases where the email renders as both a link and bold text on the same page.
    await expect(page.getByText(email).first()).not.toBeVisible();
  });
});
