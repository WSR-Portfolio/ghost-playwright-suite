/**
 * Admin API — Posts (AA-004 through AA-016)
 *
 * Each test gets a fresh draft post via beforeEach and the afterEach deletes
 * it, keeping Ghost state clean between runs.  deletePost() accepts 404 as a
 * valid response, so AA-016 (which deletes the post itself) does not cause
 * afterEach to fail.
 *
 * Tests that need to make raw HTTP requests (to inspect non-200 status codes
 * that the AdminApiHelper would assert-and-throw on) use the Playwright
 * `request` fixture directly with a fresh JWT from generateAdminToken().
 */

import { test, expect, generateAdminToken } from '../fixtures';
import type { GhostPost } from '../fixtures';

const BASE = (): string => {
  const u = process.env.GHOST_URL;
  if (!u) throw new Error('GHOST_URL not set');
  return u.replace(/\/$/, '');
};

const CONTENT_KEY = (): string => {
  const k = process.env.GHOST_CONTENT_API_KEY;
  if (!k) throw new Error('GHOST_CONTENT_API_KEY not set');
  return k;
};

const authHeaders = () => ({ Authorization: `Ghost ${generateAdminToken()}` });

// ---------------------------------------------------------------------------
// Shared state — reset on every beforeEach
// ---------------------------------------------------------------------------

let seedPost: GhostPost;
let extraPostIds: string[] = [];

test.describe('Admin API — Posts', () => {
  test.beforeEach(async ({ adminApi }) => {
    extraPostIds = [];
    seedPost = await adminApi.createPost({ title: `Seed Post ${Date.now()}` });
  });

  test.afterEach(async ({ adminApi }) => {
    // deletePost is a no-op on 404, so this is safe even when AA-016 already
    // deleted the post inside the test body.
    await adminApi.deletePost(seedPost.id);
    for (const id of extraPostIds) {
      await adminApi.deletePost(id);
    }
  });

  // -------------------------------------------------------------------------
  // AA-004 — Create a draft post
  // Basic creation contract: 201, required fields present, default status=draft.
  // -------------------------------------------------------------------------
  test('AA-004: create a draft post returns 201 with correct fields', async ({ adminApi }) => {
    const title = `AA-004 Draft ${Date.now()}`;
    const post = await adminApi.createPost({ title });
    extraPostIds.push(post.id);

    expect(post.id).toBeTruthy();
    expect(post.title).toBe(title);
    expect(post.status).toBe('draft');
    expect(post.slug).toBeTruthy();
    expect(post.updated_at).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // AA-005 — Create post with tags
  // Tags are passed as display names; Ghost resolves or creates them and
  // returns the association on the post.  Verifies the tag-resolution pipeline.
  // -------------------------------------------------------------------------
  test('AA-005: create post with tags returns the tag association', async ({ adminApi }) => {
    const tagName = `aa-005-tag-${Date.now()}`;
    const post = await adminApi.createPost({
      title: `AA-005 Tagged ${Date.now()}`,
      tags: [tagName],
    });
    extraPostIds.push(post.id);

    expect(post.tags).toHaveLength(1);
    expect(post.tags[0].name).toBe(tagName);
  });

  // -------------------------------------------------------------------------
  // AA-006 — Create published post
  // When status=published is set at creation time, Ghost must immediately
  // set published_at to a non-null timestamp.
  // -------------------------------------------------------------------------
  test('AA-006: create a published post sets status=published and published_at', async ({
    adminApi,
  }) => {
    const post = await adminApi.createPost({
      title: `AA-006 Published ${Date.now()}`,
      status: 'published',
    });
    extraPostIds.push(post.id);

    expect(post.status).toBe('published');
    expect(post.published_at).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // AA-007 — Missing title → 422 ValidationError
  // Title is required.  The response must be 422 (not 400 or 500) and the
  // first error in the errors array must be typed ValidationError so clients
  // can distinguish validation failures from server errors.
  // -------------------------------------------------------------------------
  test('AA-007: create post without title returns 422 with ValidationError', async ({
    request,
  }) => {
    const res = await request.post(`${BASE()}/ghost/api/admin/posts/`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      // title field deliberately omitted
      data: { posts: [{ status: 'draft' }] },
    });

    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors[0].type).toBe('ValidationError');
  });

  // -------------------------------------------------------------------------
  // AA-008 — Duplicate slug: Ghost auto-increments, does not reject
  // Ghost's slug uniqueness behaviour is non-obvious: rather than returning 422,
  // Ghost silently appends a counter suffix to the requested slug (e.g.
  // "my-slug" becomes "my-slug-2") so the second post is created successfully.
  // This prevents accidental URL collisions while preserving the author's intent.
  //
  // The test verifies this deduplication behaviour: both creates succeed (201),
  // the second post's stored slug differs from the requested slug, and the slug
  // starts with the original string (confirming Ghost used it as the base).
  // -------------------------------------------------------------------------
  test('AA-008: creating two posts with the same explicit slug — Ghost deduplicates the slug', async ({
    request,
  }) => {
    const slug = `aa-008-duplicate-slug-${Date.now()}`;

    // First post — gets the requested slug
    const firstRes = await request.post(`${BASE()}/ghost/api/admin/posts/`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: { posts: [{ title: `AA-008 First ${Date.now()}`, slug }] },
    });
    expect(firstRes.status()).toBe(201);
    const firstBody = await firstRes.json();
    extraPostIds.push(firstBody.posts[0].id);
    expect(firstBody.posts[0].slug).toBe(slug);

    // Second post with the same slug — Ghost creates it with a modified slug
    const secondRes = await request.post(`${BASE()}/ghost/api/admin/posts/`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: { posts: [{ title: `AA-008 Second ${Date.now()}`, slug }] },
    });
    expect(secondRes.status()).toBe(201);
    const secondBody = await secondRes.json();
    extraPostIds.push(secondBody.posts[0].id);

    // Ghost deduplicates by appending a counter — slug must differ from the original
    expect(secondBody.posts[0].slug).not.toBe(slug);
    expect(secondBody.posts[0].slug).toMatch(new RegExp(`^${slug}`));
  });

  // -------------------------------------------------------------------------
  // AA-009 — Get post by ID
  // A GET for an existing post ID must return 200 and the exact data that was
  // created.  Validates the read path and response envelope shape.
  // -------------------------------------------------------------------------
  test('AA-009: get post by ID returns 200 with the correct post', async ({ adminApi }) => {
    const fetched = await adminApi.getPost(seedPost.id);

    expect(fetched.id).toBe(seedPost.id);
    expect(fetched.title).toBe(seedPost.title);
    expect(fetched.status).toBe('draft');
  });

  // -------------------------------------------------------------------------
  // AA-010 — Update post title
  // PUT requires the current updated_at value (optimistic concurrency token).
  // After a successful update the response must reflect the new title.
  // -------------------------------------------------------------------------
  test('AA-010: update post title returns the updated title', async ({ adminApi }) => {
    const newTitle = `AA-010 Updated ${Date.now()}`;

    const updated = await adminApi.updatePost(seedPost.id, {
      title: newTitle,
      updated_at: seedPost.updated_at,
    });

    expect(updated.title).toBe(newTitle);
  });

  // -------------------------------------------------------------------------
  // AA-011 — Schedule a post
  // Ghost treats a post with status=scheduled and a future published_at as a
  // scheduled post — it will auto-publish at that time.  This test verifies
  // the scheduled state is persisted correctly.
  //
  // Ghost-specific behaviour: setting status=scheduled without a future
  // published_at is rejected; setting published_at in the past with
  // status=scheduled is also rejected.  The 24-hour offset is large enough
  // to survive any clock skew between the test runner and the NAS host.
  // -------------------------------------------------------------------------
  test('AA-011: scheduled post with future published_at returns status=scheduled', async ({
    adminApi,
  }) => {
    const twentyFourHoursFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const post = await adminApi.createPost({
      title: `AA-011 Scheduled ${Date.now()}`,
      status: 'scheduled',
      publishedAt: twentyFourHoursFromNow,
    });
    extraPostIds.push(post.id);

    expect(post.status).toBe('scheduled');
    // Confirm the stored timestamp matches what we sent (Ghost may normalise to ms precision)
    expect(new Date(post.published_at!).getTime()).toBeGreaterThan(Date.now());
  });

  // -------------------------------------------------------------------------
  // AA-012 — Members-only post visibility is reflected in Content API response
  // Ghost's Content API DOES include members-only posts in browse/listing results
  // — the post metadata (title, slug, visibility field) is returned regardless of
  // visibility tier.  Content gating is enforced at the theme/frontend layer, not
  // the API listing layer.  The visibility field on the post object is the signal
  // that themes use to render a paywall or redirect unauthenticated visitors.
  //
  // This test verifies that Ghost correctly stores and returns the visibility
  // field as 'members' on a post created with that setting, confirming the
  // round-trip from Admin API write to Content API read is correct.
  // -------------------------------------------------------------------------
  test('AA-012: members-only post appears in Content API with visibility=members', async ({
    adminApi,
    request,
  }) => {
    const membersPost = await adminApi.createPost({
      title: `AA-012 Members Only ${Date.now()}`,
      status: 'published',
      visibility: 'members',
    });
    extraPostIds.push(membersPost.id);

    // Fetch the post by slug from the Content API — include visibility field
    const res = await request.get(`${BASE()}/ghost/api/content/posts/slug/${membersPost.slug}/`, {
      params: { key: CONTENT_KEY(), fields: 'slug,visibility' },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.posts[0].slug).toBe(membersPost.slug);
    // Ghost must return visibility=members — this is the signal themes use to gate content
    expect(body.posts[0].visibility).toBe('members');
  });

  // -------------------------------------------------------------------------
  // AA-013 — Featured flag round-trips correctly
  // The featured flag controls homepage promotion in most Ghost themes.
  // This test creates a featured post and re-fetches it by ID to confirm the
  // flag survives the write-read round-trip (not just the creation response).
  // -------------------------------------------------------------------------
  test('AA-013: featured post has featured=true in the GET response', async ({ adminApi }) => {
    const post = await adminApi.createPost({
      title: `AA-013 Featured ${Date.now()}`,
      featured: true,
    });
    extraPostIds.push(post.id);

    // Re-fetch to confirm persistence, not just what the create response echoes back
    const fetched = await adminApi.getPost(post.id);

    expect(fetched.featured).toBe(true);
  });

  // -------------------------------------------------------------------------
  // AA-014 — Publish a draft post via update
  // Changing status from draft to published must set both status and
  // published_at.  Simulates the most common editorial workflow.
  // -------------------------------------------------------------------------
  test('AA-014: updating a draft post to published sets status=published', async ({ adminApi }) => {
    // seedPost is a draft — publish it via update
    const published = await adminApi.updatePost(seedPost.id, {
      status: 'published',
      updated_at: seedPost.updated_at,
    });

    expect(published.status).toBe('published');
    expect(published.published_at).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // AA-015 — Stale updated_at → 409 Conflict
  // Ghost uses the updated_at timestamp as an optimistic concurrency token.
  // A PUT with a timestamp older than the server's current value must be
  // rejected with 409 so concurrent edits are never silently overwritten.
  // -------------------------------------------------------------------------
  test('AA-015: update with stale updated_at returns 409 Conflict', async ({ request }) => {
    const staleTimestamp = '2020-01-01T00:00:00.000Z';

    const res = await request.put(`${BASE()}/ghost/api/admin/posts/${seedPost.id}/`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: { posts: [{ title: 'Should not apply', updated_at: staleTimestamp }] },
    });

    expect(res.status()).toBe(409);
  });

  // -------------------------------------------------------------------------
  // AA-016 — Delete post; subsequent GET returns 404
  // After deletion the resource must no longer be accessible via the Admin API.
  // Uses a raw GET (not adminApi.getPost) because the helper asserts 200 and
  // would throw before we could inspect the status code.
  // -------------------------------------------------------------------------
  test('AA-016: deleted post returns 404 on subsequent GET', async ({ adminApi, request }) => {
    await adminApi.deletePost(seedPost.id);

    const res = await request.get(`${BASE()}/ghost/api/admin/posts/${seedPost.id}/`, {
      headers: authHeaders(),
    });

    expect(res.status()).toBe(404);
    // afterEach will call deletePost(seedPost.id) again — 404 is handled gracefully
  });
});
