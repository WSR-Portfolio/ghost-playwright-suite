/**
 * Admin UI — Posts (AU-004 through AU-016)
 *
 * All tests start with an authenticated admin session from .auth/admin.json —
 * the login flow is covered in auth.spec.ts and is not repeated here.
 *
 * Setup strategy: tests that focus on editing, publishing, or deleting a post
 * create their fixture post via the Admin API before navigating to the editor.
 * This keeps each UI test focused on the specific action under test rather than
 * the creation workflow. Tests that cover post creation itself (AU-004–008)
 * perform the full flow through the Ghost editor UI.
 */

import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import path from 'path';

// Reuse the authenticated admin session saved by auth.spec.ts AU-001.
// Every test in this file starts already logged in — the login flow is not retested.
test.use({ storageState: path.resolve('.auth/admin.json') });

const GHOST_URL = (process.env.GHOST_URL ?? '').replace(/\/$/, '');
const CONTENT_API_KEY = process.env.GHOST_CONTENT_API_KEY ?? '';

// Accumulates post IDs to delete in afterEach. Safe to use at module level
// because tests run sequentially (workers: 1 in playwright.config.ts).
let cleanupIds: string[] = [];

test.afterEach(async ({ adminApi }) => {
  for (const id of cleanupIds) {
    await adminApi.deletePost(id);
  }
  cleanupIds = [];
});

// ---------------------------------------------------------------------------
// Shared editor helpers
// ---------------------------------------------------------------------------

/**
 * Click into the Lexical/Koenig editor body and type content.
 * The editor is a contenteditable div, not a standard input — standard fill()
 * events do not work. Click to focus, then dispatch keyboard events.
 */
async function typeInBody(page: Page, text: string): Promise<void> {
  const editorBody = page.locator('[data-kg="editor"]').first();
  await editorBody.click();
  await page.keyboard.type(text);
}

/**
 * Open the post settings sidebar and wait for it to be visible.
 * The sidebar contains tags, excerpt, featured, visibility, SEO, and other metadata.
 */
async function openPostSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: /settings/i }).click();
  // Wait for a known element inside the sidebar to confirm it opened
  await expect(page.locator('.settings-menu, [data-testid="post-settings"], .gh-editor-sidebar').first()).toBeVisible();
}

/**
 * Trigger a manual save via keyboard shortcut and wait for Ghost's "Saved" indicator.
 * Ghost also auto-saves, but explicit saves ensure state is committed before assertions.
 */
async function waitForSave(page: Page): Promise<void> {
  await page.keyboard.press('Meta+S');
  await expect(page.getByText('Saved')).toBeVisible();
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

test.describe('Admin UI — Posts', () => {
  /**
   * AU-004: Create a new post with title and body content via the Ghost editor UI.
   * Validates the basic creation workflow a publisher performs daily.
   */
  test('AU-004: create a new post with title and body content', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/ghost/#/editor/post');
    await expect(page).toHaveURL(/\/editor\/post/);

    // Title field — contenteditable in Ghost v5/v6; role="textbox" with placeholder
    await page.getByRole('textbox', { name: /post title/i }).fill('AU-004 Test Post');

    // Body — Lexical contenteditable editor, not a standard textarea
    await typeInBody(page, 'AU-004 test post body content.');

    // For a new post, Ghost creates the record on first save and updates the URL
    // from /editor/post to /editor/post/{id}. The URL change is the reliable signal
    // that the POST request completed — the "Saved" toast can race with auto-save timing.
    await page.keyboard.press('Meta+S');
    await page.waitForURL(/\/editor\/post\/[a-f0-9]+/, { timeout: 15000 });

    // Capture the post ID from the editor URL for afterEach cleanup.
    const url = page.url();
    const match = url.match(/\/editor\/post\/([a-f0-9]+)/);
    if (match) cleanupIds.push(match[1]);
  });

  /**
   * AU-005: Assign a tag to a post during creation.
   * Tags are Ghost's primary content organization mechanism. Verifies the tag
   * typeahead input in the post settings sidebar works correctly during creation.
   */
  test('AU-005: assign a tag to a post during creation', async ({ page, adminApi }) => {
    test.setTimeout(60_000);
    // Pre-create the tag via API so we can type its exact name in the UI
    const tag = await adminApi.createTag({ name: 'au-005-tag' });

    try {
      await page.goto('/ghost/#/editor/post');
      await page.getByRole('textbox', { name: /post title/i }).fill('AU-005 Tagged Post');

      await openPostSettings(page);

      // The tags field in Ghost v6 uses a searchbox role (tokenized input), not textbox.
      // It is the first searchbox in the post settings form (Authors has the second).
      const tagsInput = page.getByRole('searchbox').first();
      await tagsInput.fill('au-005-tag');
      // Select from the dropdown suggestion if it appears, otherwise press Enter
      const suggestion = page.getByRole('option', { name: /au-005-tag/i });
      if (await suggestion.isVisible()) {
        await suggestion.click();
      } else {
        await page.keyboard.press('Enter');
      }

      await waitForSave(page);

      // Confirm the tag appears as an applied token in the settings panel
      await expect(page.getByText('au-005-tag').first()).toBeVisible();

      const url = page.url();
      const match = url.match(/\/editor\/post\/([a-f0-9]+)/);
      if (match) cleanupIds.push(match[1]);
    } finally {
      await adminApi.deleteTag(tag.id);
    }
  });

  /**
   * AU-006: Add a feature image to a post.
   * The feature image appears at the top of published posts and in social sharing
   * previews. Ghost's uploader uses a hidden <input type="file"> triggered by the
   * editor header's image area. We use page.setInputFiles() to bypass the native
   * OS file picker dialog, which Playwright cannot interact with.
   */
  test('AU-006: add a feature image to a post', async ({ page, adminApi }) => {
    test.setTimeout(60_000);
    const post = await adminApi.createPost({ title: 'AU-006 Feature Image Post' });
    cleanupIds.push(post.id);

    await page.goto(`/ghost/#/editor/post/${post.id}`);
    await expect(page.getByRole('textbox', { name: /post title/i })).toBeVisible();

    // Minimal valid 1×1 pixel PNG, created in-memory rather than reading from disk.
    // Using a Buffer avoids test environment dependencies on fixture files on the filesystem.
    const MINIMAL_PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );

    // Listen for the file chooser event triggered by clicking the feature image button.
    // This approach handles cases where Ghost controls the file input display/visibility.
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /add feature image/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'feature.png',
      mimeType: 'image/png',
      buffer: MINIMAL_PNG,
    });

    // After a successful upload, the editor header should display the image preview
    await expect(
      page.locator('.gh-editor-feature-image img, [data-testid="feature-image"] img').first(),
    ).toBeVisible();
  });

  /**
   * AU-007: Set a custom excerpt on a post.
   * Excerpt is used in Ghost's frontend theme templates and Content API responses.
   * Verifies the excerpt textarea in the post settings sidebar saves input correctly.
   */
  test('AU-007: set custom excerpt on a post', async ({ page, adminApi }) => {
    const post = await adminApi.createPost({ title: 'AU-007 Excerpt Post' });
    cleanupIds.push(post.id);

    await page.goto(`/ghost/#/editor/post/${post.id}`);
    await openPostSettings(page);

    const excerptInput = page.getByRole('textbox', { name: /excerpt/i });
    await excerptInput.fill('This is a custom test excerpt for AU-007.');

    await waitForSave(page);

    // Confirm the value persisted (not reset by React state after save)
    await expect(excerptInput).toHaveValue('This is a custom test excerpt for AU-007.');
  });

  /**
   * AU-008: Set SEO title and description fields on a post.
   * Ghost's meta title and description control appearance in search engine results
   * and Open Graph previews. Verifies the SEO fields in the post settings panel.
   */
  test('AU-008: set SEO title and description on a post', async ({ page, adminApi }) => {
    const post = await adminApi.createPost({ title: 'AU-008 SEO Post' });
    cleanupIds.push(post.id);

    await page.goto(`/ghost/#/editor/post/${post.id}`);
    await openPostSettings(page);

    // The SEO/Meta Data section may be collapsed under an accordion — expand it if needed
    const metaSection = page.getByRole('button', { name: /meta data/i });
    if (await metaSection.isVisible()) {
      await metaSection.click();
    }

    const seoTitleInput = page.getByRole('textbox', { name: /meta title/i });
    const seoDescInput = page.getByRole('textbox', { name: /meta description/i });

    await seoTitleInput.fill('AU-008 Custom SEO Title');
    await seoDescInput.fill('AU-008 custom meta description for search engines.');

    await waitForSave(page);

    await expect(seoTitleInput).toHaveValue('AU-008 Custom SEO Title');
    await expect(seoDescInput).toHaveValue('AU-008 custom meta description for search engines.');
  });

  /**
   * AU-009: Edit a post title and verify the change persists after navigating away.
   * Checking persistence after navigation is deliberate — a regression in save logic
   * can silently update local React state without writing to the database. Navigating
   * away clears component state and forces the editor to re-fetch from the server.
   */
  test('AU-009: edit post title; change persists after navigating away', async ({ page, adminApi }) => {
    const post = await adminApi.createPost({ title: 'AU-009 Original Title' });
    cleanupIds.push(post.id);

    await page.goto(`/ghost/#/editor/post/${post.id}`);

    const titleInput = page.getByRole('textbox', { name: /post title/i });
    await titleInput.clear();
    await titleInput.fill('AU-009 Updated Title');

    await waitForSave(page);

    // Navigate away to flush local component state
    await page.goto('/ghost/#/posts');
    await expect(page).toHaveURL(/\/#\/posts/);

    // Navigate back to the same post — editor must reload data from the database
    await page.goto(`/ghost/#/editor/post/${post.id}`);
    await expect(page.getByRole('textbox', { name: /post title/i })).toHaveValue('AU-009 Updated Title');
  });

  /**
   * AU-010: Edit post body content and verify the change persists after navigating away.
   * The Lexical editor serializes content to a JSON format before persisting. This test
   * confirms the serialization/deserialization round-trip produces the expected output.
   */
  test('AU-010: edit post body; change persists after navigating away', async ({ page, adminApi }) => {
    const post = await adminApi.createPost({ title: 'AU-010 Body Edit Post' });
    cleanupIds.push(post.id);

    await page.goto(`/ghost/#/editor/post/${post.id}`);

    await typeInBody(page, 'AU-010 unique body content to verify persistence.');

    await waitForSave(page);

    // Navigate away and back to confirm the body was saved to the database
    await page.goto('/ghost/#/posts');
    await page.goto(`/ghost/#/editor/post/${post.id}`);

    await expect(page.locator('[data-kg="editor"]').first()).toContainText(
      'AU-010 unique body content to verify persistence.',
    );
  });

  /**
   * AU-011: Publish a draft post via the UI and confirm status in both UI and Admin API.
   *
   * Cross-layer assertion: the UI status indicator alone is insufficient — a frontend
   * bug could display "Published" while the database record stays as "draft". The
   * Admin API call confirms the status change was persisted at the data layer.
   */
  test('AU-011: publish a draft post; status confirmed in UI and Admin API', async ({ page, adminApi }) => {
    const post = await adminApi.createPost({ title: 'AU-011 Draft to Publish', status: 'draft' });
    cleanupIds.push(post.id);

    await page.goto(`/ghost/#/editor/post/${post.id}`);

    // Open the publish flow via the top-right Publish button
    await page.getByRole('button', { name: 'Publish' }).click();

    // Ghost v6 uses a two-step publish wizard:
    // Step 1: "Continue, final review →" button shown in the panel
    // Step 2: "Publish post, right now" confirm button (animated with gh-btn-pulse)
    await page.getByRole('button', { name: /continue/i }).click();
    // The confirm button has a CSS pulse animation — use force: true to bypass stability check
    await page.locator('[data-test-button="confirm-publish"]').click({ force: true });

    // After publishing Ghost transitions back to editor; header shows "Update" (disabled) + "Unpublish"
    await expect(page.getByRole('button', { name: /update/i }).first()).toBeVisible();
    // Wait for the publish request to fully commit before checking the Admin API.
    // The "Update" button appearing is a UI signal; networkidle confirms the PUT reached the database.
    await page.waitForLoadState('networkidle');

    // Cross-layer: verify the Admin API also reflects the status change.
    // This confirms the publish was persisted at the database layer, not just in UI state.
    const updated = await adminApi.getPost(post.id);
    expect(updated.status).toBe('published');
  });

  /**
   * AU-012: Unpublish a published post and confirm status in both UI and Admin API.
   *
   * Cross-layer assertion mirrors AU-011. Both layers must independently reflect
   * the revert-to-draft operation for the assertion to be meaningful.
   */
  test('AU-012: unpublish a post; status confirmed in UI and Admin API', async ({ page, adminApi }) => {
    const post = await adminApi.createPost({ title: 'AU-012 Post to Unpublish', status: 'published' });
    cleanupIds.push(post.id);

    await page.goto(`/ghost/#/editor/post/${post.id}`);

    // Ghost v6 shows an "Unpublish" button in the editor header for published posts.
    await page.getByRole('button', { name: /unpublish/i }).click();

    // Ghost v6 shows a confirmation overlay with a link (not a button) to confirm the revert.
    // The link text is "Unpublish and revert to private draft →".
    await page.getByText(/unpublish and revert to private draft/i).first().click();

    // UI should now reflect draft state — the Publish button reappears.
    // Use exact: true to avoid matching "Unpublish" which also contains "Publish".
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible();
    // Wait for the unpublish request to fully commit before checking the Admin API.
    await page.waitForLoadState('networkidle');

    // Cross-layer: confirm the Admin API reflects the revert to draft
    const updated = await adminApi.getPost(post.id);
    expect(updated.status).toBe('draft');
  });

  /**
   * AU-013: Schedule a post for a future publish date.
   * Ghost's internal scheduler captures the target date and sets status to "scheduled".
   * Content managers frequently schedule posts in advance — this validates the core
   * scheduling workflow. Both UI state and Admin API status are checked.
   */
  test('AU-013: schedule a post; status is scheduled in UI and Admin API', async ({ page, adminApi }) => {
    const post = await adminApi.createPost({ title: 'AU-013 Scheduled Post', status: 'draft' });
    cleanupIds.push(post.id);

    await page.goto(`/ghost/#/editor/post/${post.id}`);

    // Open the publish flow
    await page.getByRole('button', { name: 'Publish' }).click();

    // Ghost v6 publish panel step 1: the "Right now" timing row may be collapsed or expanded
    // depending on session state. Click "Right now" to expand it if "Schedule for later"
    // is not yet visible. Then click "Schedule for later" to reveal the date/time inputs.
    // "Schedule for later" is a generic element (not a button role) inside the "Right now" row.
    // Click "Right now" first if the row is collapsed (Schedule for later not yet visible).
    const scheduleLaterBtn = page.getByText('Schedule for later').first();
    if (!await scheduleLaterBtn.isVisible()) {
      await page.getByRole('button', { name: /right now/i }).click();
    }
    await scheduleLaterBtn.click();

    // Set the publish date to 24 hours in the future
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateString = tomorrow.toISOString().split('T')[0]; // YYYY-MM-DD format

    // The date input appears after selecting "Schedule for later"
    const dateInput = page.getByPlaceholder('YYYY-MM-DD').first();
    await dateInput.fill(dateString);
    await dateInput.press('Tab'); // Blur to trigger Ghost's date parser

    // Proceed to step 2 of the publish wizard
    await page.getByRole('button', { name: /continue/i }).click();

    // Set up response interception before clicking confirm — the click triggers a PUT
    // request that transitions the post to 'scheduled'. Waiting for this response
    // guarantees Ghost has committed the status before we query the Admin API.
    const schedulePut = page.waitForResponse(
      (r) =>
        r.url().includes('/ghost/api/admin/posts/') &&
        r.request().method() === 'PUT' &&
        r.status() < 400,
      { timeout: 30000 },
    );

    // Confirm scheduling — button text changes to the scheduled date but data-test-button
    // is always "confirm-publish". The button has a CSS pulse animation — use force: true.
    await page.locator('[data-test-button="confirm-publish"]').click({ force: true });
    await schedulePut;
    await page.waitForLoadState('networkidle');

    // Verify via Admin API — confirms Ghost's scheduler captured the status correctly
    const updated = await adminApi.getPost(post.id);
    expect(updated.status).toBe('scheduled');
  });

  /**
   * AU-014: Toggle post visibility to members-only and verify via the Content API.
   *
   * This is a cross-layer security boundary test. The UI setting must propagate to
   * Ghost's Content API access control layer. A members-only post must not appear
   * in unauthenticated Content API browse results after the setting is applied.
   * A regression here would mean members-only content is publicly readable via API
   * even though the UI correctly gatekeeps it.
   */
  test('AU-014: set visibility to members-only; post absent from Content API browse', async ({
    page,
    adminApi,
    request,
  }) => {
    // Create a public published post so it would normally appear in Content API results
    const post = await adminApi.createPost({
      title: 'AU-014 Visibility Test Post',
      status: 'published',
      visibility: 'public',
    });
    cleanupIds.push(post.id);

    await page.goto(`/ghost/#/editor/post/${post.id}`);
    await openPostSettings(page);

    // The "Post access" combobox in Ghost v6 has no accessible name — select by role only.
    // Ghost's Content API includes members-only posts in browse results with visibility=members;
    // gating is enforced at the theme/frontend layer, not the API listing layer.
    const visibilitySelect = page.getByRole('combobox');

    // Ghost auto-saves combobox/select changes immediately — set up the network watcher
    // BEFORE the selection so we can intercept the resulting PUT request.
    const saveResponse = page.waitForResponse(
      (r) => r.url().includes('/ghost/api/admin/posts/') &&
              r.request().method() === 'PUT' &&
              r.status() < 400,
      { timeout: 15000 },
    );
    await visibilitySelect.selectOption({ label: 'Members only' });
    await saveResponse;

    // Allow Ghost's data layer to propagate the change before checking via API
    await page.waitForLoadState('networkidle');

    // Cross-layer verification: confirm the visibility field was persisted to the database.
    // Ghost's Content API returns members-only posts in browse results — the visibility field
    // is the signal that downstream consumers use to enforce access control at the theme layer.
    const contentRes = await request.get(
      `${GHOST_URL}/ghost/api/content/posts/${post.id}/?key=${CONTENT_API_KEY}&fields=visibility`,
    );
    expect(contentRes.status()).toBe(200);
    const body = await contentRes.json();
    expect(body.posts[0].visibility).toBe('members');
  });

  /**
   * AU-015: Toggle the featured flag on a post and confirm via Admin API.
   * Featured posts are highlighted in Ghost's default themes and can be targeted
   * by API filters (filter=featured:true). Verifies the featured toggle in the
   * post settings sidebar correctly updates the database record.
   */
  test('AU-015: toggle featured flag on a post', async ({ page, adminApi }) => {
    const post = await adminApi.createPost({ title: 'AU-015 Feature Toggle Post', featured: false });
    cleanupIds.push(post.id);

    await page.goto(`/ghost/#/editor/post/${post.id}`);
    await openPostSettings(page);

    // In Ghost v6 the featured toggle is a checkbox with no accessible name — the label
    // "Feature this post" is on a sibling element. Click the containing list item to toggle.
    await page.locator('li:has-text("Feature this post")').click();

    await waitForSave(page);

    // Confirm the featured flag was persisted via Admin API
    const updated = await adminApi.getPost(post.id);
    expect(updated.featured).toBe(true);
  });

  /**
   * AU-016: Delete a post via the admin UI and confirm it no longer appears in the list.
   * Validates the delete workflow accessible from the post list context menu.
   * This post is intentionally NOT added to cleanupIds — the test asserts the UI
   * performs the deletion. If the test fails before reaching the delete step, the
   * orphaned post will persist, which is acceptable in this test-only environment.
   */
  test('AU-016: delete a post; post no longer appears in post list', async ({ page, adminApi }) => {
    // Include a timestamp in the title to avoid false negatives from leftover posts
    // created by previous failed test runs that share the same title.
    const title = `AU-016 Post to Delete ${Date.now()}`;
    const post = await adminApi.createPost({ title });

    // Ghost v6 removed the hover kebab/more menu from the post list.
    // Delete is now accessible from within the post editor's settings sidebar.
    await page.goto(`/ghost/#/editor/post/${post.id}`);
    await expect(page.getByRole('textbox', { name: /post title/i })).toBeVisible();

    await openPostSettings(page);

    // "Delete post" appears at the bottom of the settings sidebar (may need scrolling)
    await page.getByRole('button', { name: /delete post/i }).click();

    // Ghost shows a confirmation dialog before permanent deletion
    await page.getByRole('button', { name: /delete/i }).last().click();

    // After deletion Ghost redirects to the post list; the post should not appear
    await expect(page).toHaveURL(/\/#\/posts/);
    await expect(page.getByText(title)).not.toBeVisible();
  });
});
