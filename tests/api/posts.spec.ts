/**
 * Admin API — Posts (AA-001 through AA-013)
 *
 * These tests exercise the Ghost Admin API posts resource end-to-end: creation
 * in every meaningful state, field persistence, update, delete, list, the
 * optimistic-concurrency guard, and the authentication boundary.
 *
 * A dedicated afterAll cleans up any posts this suite creates so the target
 * Ghost instance is not polluted between runs.
 */

import { test, expect, generateAdminToken } from '../fixtures';
import type { GhostPost } from '../fixtures';

const BASE = (): string => {
  const u = process.env.GHOST_URL;
  if (!u) throw new Error('GHOST_URL not set');
  return u.replace(/\/$/, '');
};

const authHeaders = () => ({ Authorization: `Ghost ${generateAdminToken()}` });

// ---------------------------------------------------------------------------
// State shared across tests in this describe block
// ---------------------------------------------------------------------------

let createdPostIds: string[] = [];

test.describe('Admin API — Posts', () => {
  test.afterAll(async ({ adminApi }) => {
    // Best-effort cleanup — 404 is already handled gracefully inside deletePost
    for (const id of createdPostIds) {
      await adminApi.deletePost(id);
    }
  });

  // -------------------------------------------------------------------------
  // AA-001 — Create draft post
  // Validates the happy-path creation contract: 201, correct title, default
  // status=draft, and required fields (id, slug, updated_at) present.
  // -------------------------------------------------------------------------
  test('AA-001: create a draft post returns 201 with correct fields', async ({ adminApi }) => {
    const title = `AA-001 Draft Post ${Date.now()}`;
    const post = await adminApi.createPost({ title });

    createdPostIds.push(post.id);

    expect(post.id).toBeTruthy();
    expect(post.title).toBe(title);
    expect(post.status).toBe('draft');
    expect(post.slug).toBeTruthy();
    expect(post.updated_at).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // AA-002 — Create published post
  // Confirms that status and published_at are correctly set when a post is
  // created directly in the published state — the most common content workflow.
  // -------------------------------------------------------------------------
  test('AA-002: create a published post sets status and published_at', async ({ adminApi }) => {
    const title = `AA-002 Published Post ${Date.now()}`;
    const post = await adminApi.createPost({ title, status: 'published' });

    createdPostIds.push(post.id);

    expect(post.status).toBe('published');
    expect(post.published_at).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // AA-003 — Create post with tags
  // Tags are passed as display names; Ghost resolves existing ones or creates
  // new ones.  This test verifies the tag association is returned on the post.
  // -------------------------------------------------------------------------
  test('AA-003: create a post with tags returns tags on the post', async ({ adminApi }) => {
    const tagName = `aa-003-tag-${Date.now()}`;
    const post = await adminApi.createPost({
      title: `AA-003 Tagged Post ${Date.now()}`,
      tags: [tagName],
    });

    createdPostIds.push(post.id);

    expect(post.tags).toHaveLength(1);
    expect(post.tags[0].name).toBe(tagName);
  });

  // -------------------------------------------------------------------------
  // AA-004 — Create featured post
  // The featured flag controls homepage promotion; this test ensures Ghost
  // persists the flag and returns it correctly.
  // -------------------------------------------------------------------------
  test('AA-004: create a featured post sets featured=true', async ({ adminApi }) => {
    const post = await adminApi.createPost({
      title: `AA-004 Featured Post ${Date.now()}`,
      featured: true,
    });

    createdPostIds.push(post.id);

    expect(post.featured).toBe(true);
  });

  // -------------------------------------------------------------------------
  // AA-005 — Create members-only post
  // Visibility=members restricts the post to authenticated site members.
  // This is a common content monetisation feature and must round-trip correctly.
  // -------------------------------------------------------------------------
  test('AA-005: create a members-only post persists visibility=members', async ({ adminApi }) => {
    const post = await adminApi.createPost({
      title: `AA-005 Members Post ${Date.now()}`,
      visibility: 'members',
    });

    createdPostIds.push(post.id);

    expect(post.visibility).toBe('members');
  });

  // -------------------------------------------------------------------------
  // AA-006 — Read post by ID
  // Verifies that a post fetched by its ID matches the data that was created,
  // confirming the GET endpoint and response envelope are correct.
  // -------------------------------------------------------------------------
  test('AA-006: get post by ID returns the correct post', async ({ adminApi }) => {
    const title = `AA-006 Get-by-ID Post ${Date.now()}`;
    const created = await adminApi.createPost({ title });
    createdPostIds.push(created.id);

    const fetched = await adminApi.getPost(created.id);

    expect(fetched.id).toBe(created.id);
    expect(fetched.title).toBe(title);
    expect(fetched.status).toBe('draft');
  });

  // -------------------------------------------------------------------------
  // AA-007 — Update post title
  // Exercises the PUT endpoint and Ghost's optimistic-concurrency requirement:
  // updated_at from the last read must be echoed back or the update is rejected.
  // -------------------------------------------------------------------------
  test('AA-007: update post title returns updated title', async ({ adminApi }) => {
    const post = await adminApi.createPost({ title: `AA-007 Original ${Date.now()}` });
    createdPostIds.push(post.id);

    const updatedTitle = `AA-007 Updated ${Date.now()}`;
    const updated = await adminApi.updatePost(post.id, {
      title: updatedTitle,
      updated_at: post.updated_at,
    });

    expect(updated.title).toBe(updatedTitle);
  });

  // -------------------------------------------------------------------------
  // AA-008 — Publish a draft post via update
  // Confirms that changing status from draft to published via PUT sets both
  // the status field and the published_at timestamp.
  // -------------------------------------------------------------------------
  test('AA-008: publishing a draft post via update sets status=published', async ({ adminApi }) => {
    const post = await adminApi.createPost({ title: `AA-008 Publish-via-Update ${Date.now()}` });
    createdPostIds.push(post.id);

    const published = await adminApi.updatePost(post.id, {
      status: 'published',
      updated_at: post.updated_at,
    });

    expect(published.status).toBe('published');
    expect(published.published_at).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // AA-009 — Delete post
  // After a successful delete, a GET for the same ID must return 404.  This
  // confirms the resource is actually removed and not merely soft-deleted in
  // a way that the Admin API still surfaces it.
  // -------------------------------------------------------------------------
  test('AA-009: delete post — subsequent GET returns 404', async ({ adminApi, request }) => {
    const post = await adminApi.createPost({ title: `AA-009 To Delete ${Date.now()}` });

    await adminApi.deletePost(post.id);

    // Do not use adminApi.getPost here — it asserts 200 and would throw.
    // Make a raw request to inspect the actual status code.
    const res = await request.get(`${BASE()}/ghost/api/admin/posts/${post.id}/`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(404);
  });

  // -------------------------------------------------------------------------
  // AA-010 — List posts
  // The listing endpoint must return 200 with a posts array.  This is the
  // primary query surface for editorial tools and must be reliably available.
  // -------------------------------------------------------------------------
  test('AA-010: list posts returns 200 with a posts array', async ({ request }) => {
    const res = await request.get(`${BASE()}/ghost/api/admin/posts/`, {
      headers: authHeaders(),
      params: { limit: 5 },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.posts)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // AA-011 — Optimistic concurrency: stale updated_at → 409 Conflict
  // Ghost uses the updated_at timestamp to detect concurrent edits.  Sending
  // a stale timestamp must be rejected with 409 so edits are never silently
  // lost.  The AdminApiHelper asserts 200 internally, so this test makes a
  // raw request to inspect the actual status code.
  // -------------------------------------------------------------------------
  test('AA-011: update with stale updated_at returns 409 Conflict', async ({
    adminApi,
    request,
  }) => {
    const post = await adminApi.createPost({ title: `AA-011 Concurrency ${Date.now()}` });
    createdPostIds.push(post.id);

    // Use a timestamp that is definitely in the past to simulate a stale read
    const staleTimestamp = '2020-01-01T00:00:00.000Z';

    const res = await request.put(`${BASE()}/ghost/api/admin/posts/${post.id}/`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: { posts: [{ title: 'Should not apply', updated_at: staleTimestamp }] },
    });

    expect(res.status()).toBe(409);
  });

  // -------------------------------------------------------------------------
  // AA-012 — Create post without Authorization header → 401
  // The Admin API must reject requests that carry no credentials.  This guards
  // against accidental exposure of write endpoints to unauthenticated traffic.
  // -------------------------------------------------------------------------
  test('AA-012: create post without Authorization header returns 401', async ({ request }) => {
    const res = await request.post(`${BASE()}/ghost/api/admin/posts/`, {
      data: { posts: [{ title: 'Unauthorized post' }] },
    });

    expect(res.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  // AA-013 — Get non-existent post → 404
  // Using a syntactically valid but non-existent ID must return 404 rather
  // than a 500.  Ensures the API handles unknown resources gracefully.
  // -------------------------------------------------------------------------
  test('AA-013: get non-existent post ID returns 404', async ({ request }) => {
    const fakeId = '000000000000000000000001';

    const res = await request.get(`${BASE()}/ghost/api/admin/posts/${fakeId}/`, {
      headers: authHeaders(),
    });

    expect(res.status()).toBe(404);
  });
});
