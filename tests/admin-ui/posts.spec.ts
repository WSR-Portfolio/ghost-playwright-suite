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
    await page.goto('/ghost/#/editor/post');
    await expect(page).toHaveURL(/\/editor\/post/);

    // Title field — contenteditable in Ghost v5/v6; role="textbox" with placeholder
    await page.getByRole('textbox', { name: /post title/i }).fill('AU-004 Test Post');

    // Body — Lexical contenteditable editor, not a standard textarea
    await typeInBody(page, 'AU-004 test post body content.');

    await waitForSave(page);

    // Capture the post ID from the editor URL for afterEach cleanup.
    // Ghost updates the URL to /editor/post/{id} after the first save.
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
    // Pre-create the tag via API so we can type its exact name in the UI
    const tag = await adminApi.createTag({ name: 'au-005-tag' });

    try {
      await page.goto('/ghost/#/editor/post');
      await page.getByRole('textbox', { name: /post title/i }).fill('AU-005 Tagged Post');

      await openPostSettings(page);

      // Type the tag name and press Enter to apply it
      const tagsInput = page.getByRole('textbox', { name: /tags/i });
      await tagsInput.fill('au-005-tag');
      // Select from the dropdown suggestion if it appears, otherwise press Enter
      const suggestion = page.getByRole('option', { name: /au-005-tag/i });
      if (await suggestion.isVisible()) {
        await suggestion.click();
      } else {
        await tagsInput.press('Enter');
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

    // Ghost shows a two-step publish confirmation — confirm immediate publish
    const publishNowBtn = page.getByRole('button', { name: /publish post, right now/i });
    if (await publishNowBtn.isVisible()) {
      await publishNowBtn.click();
    } else {
      // Alternative: single-step confirmation in some Ghost versions
      await page.getByRole('button', { name: /continue/i }).click();
      await page.getByRole('button', { name: /publish post/i }).click();
    }

    // UI should reflect the published state (e.g. the Publish button changes to "Update")
    await expect(page.getByRole('button', { name: /update/i }).first()).toBeVisible();

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

    // For a published post, Ghost exposes a "Revert to draft" option in the post settings
    await openPostSettings(page);
    await page.getByRole('button', { name: /revert to draft/i }).click();

    // Confirm in the dialog if one appears
    const confirmBtn = page.getByRole('button', { name: /revert/i });
    if (await confirmBtn.isVisible()) {
      await confirmBtn.click();
    }

    // UI should now reflect draft state — the Update button should be gone
    // and the Publish button should reappear
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();

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

    // Switch to schedule mode — Ghost may show a toggle or a separate "Schedule" link
    const scheduleOption = page.getByRole('button', { name: /schedule/i });
    if (await scheduleOption.isVisible()) {
      await scheduleOption.click();
    }

    // Set the publish date to 24 hours in the future
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateString = tomorrow.toISOString().split('T')[0]; // YYYY-MM-DD format

    const dateInput = page.getByRole('textbox', { name: /date/i }).first();
    await dateInput.fill(dateString);
    await dateInput.press('Tab'); // Blur to trigger Ghost's date parser

    // Confirm the schedule
    await page.getByRole('button', { name: /schedule post/i }).click();

    // UI should display a scheduled indicator
    await expect(page.getByText(/scheduled/i).first()).toBeVisible();

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

    // Change the visibility setting to "Members only" in the post settings panel
    const visibilitySelect = page.getByRole('combobox', { name: /visibility/i });
    await visibilitySelect.selectOption('members');

    await waitForSave(page);

    // Allow Ghost's data layer and any internal caches to propagate the change
    await page.waitForLoadState('networkidle');

    // Cross-layer verification via Content API (unauthenticated — no admin cookies).
    // The `request` fixture is an isolated API request context that does not share
    // the browser context's admin session. This confirms the change is enforced at
    // the API layer, not just visually in the admin UI.
    const contentRes = await request.get(
      `${GHOST_URL}/ghost/api/content/posts/?key=${CONTENT_API_KEY}&limit=all`,
    );
    expect(contentRes.status()).toBe(200);
    const body = await contentRes.json();
    const returnedIds = (body.posts as { id: string }[]).map((p) => p.id);
    expect(returnedIds).not.toContain(post.id);
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

    // The featured toggle is a checkbox or toggle switch in the settings panel
    const featuredToggle = page.getByRole('checkbox', { name: /feature this post/i });
    await featuredToggle.check();

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
    const post = await adminApi.createPost({ title: 'AU-016 Post to Delete' });

    await page.goto('/ghost/#/posts');

    // Find the post card in the list by title
    const postCard = page.getByRole('link', { name: /AU-016 Post to Delete/i }).first();
    await expect(postCard).toBeVisible();

    // Open the post's action menu (the ⋯ or kebab menu shown on hover)
    await postCard.hover();
    const moreBtn = page.getByRole('button', { name: /more/i }).first();
    await moreBtn.click();

    // Select Delete from the menu
    await page.getByRole('menuitem', { name: /delete/i }).click();

    // Ghost shows a confirmation dialog before permanent deletion
    await page.getByRole('button', { name: /delete/i }).last().click();

    // After deletion the post should no longer appear in the post list
    await expect(page.getByRole('link', { name: /AU-016 Post to Delete/i })).not.toBeVisible();
  });
});
