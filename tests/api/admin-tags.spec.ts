/**
 * Admin API — Tags (AA-020 through AA-024)
 *
 * Each test gets a fresh seed tag via beforeEach and afterEach deletes it.
 * Tests that create additional tags push those IDs to extraTagIds for cleanup.
 * deleteTag() accepts 404, so AA-023 (which deletes the seed tag itself) does
 * not cause afterEach to fail.
 *
 * AA-024 uses raw HTTP requests for both creates because AdminApiHelper.createTag
 * has no slug option and asserts 201 internally — bypassing it is required to
 * both control the slug and inspect a non-201 status code.
 */

import { test, expect, generateAdminToken } from '../fixtures';
import type { GhostTag } from '../fixtures';

const BASE = (): string => {
  const u = process.env.GHOST_URL;
  if (!u) throw new Error('GHOST_URL not set');
  return u.replace(/\/$/, '');
};

const authHeaders = () => ({ Authorization: `Ghost ${generateAdminToken()}` });

// ---------------------------------------------------------------------------
// Shared state — reset on every beforeEach
// ---------------------------------------------------------------------------

let seedTag: GhostTag;
let extraTagIds: string[] = [];

test.describe('Admin API — Tags', () => {
  test.beforeEach(async ({ adminApi }) => {
    extraTagIds = [];
    seedTag = await adminApi.createTag({ name: `seed-tag-${Date.now()}` });
  });

  test.afterEach(async ({ adminApi }) => {
    // 404-tolerant — safe even when AA-023 deletes the seed tag inside the test
    await adminApi.deleteTag(seedTag.id);
    for (const id of extraTagIds) {
      await adminApi.deleteTag(id);
    }
  });

  // -------------------------------------------------------------------------
  // AA-020 — Create a basic tag
  // Validates the creation contract: 201, id present, name round-trips exactly,
  // and Ghost auto-generates a URL-safe slug from the name.  The slug is the
  // public URL key for tag archive pages and must always be populated.
  // -------------------------------------------------------------------------
  test('AA-020: create a tag returns 201 with id, name, and slug', async ({ adminApi }) => {
    const name = `aa-020-tag-${Date.now()}`;
    const tag = await adminApi.createTag({ name });
    extraTagIds.push(tag.id);

    expect(tag.id).toBeTruthy();
    expect(tag.name).toBe(name);
    expect(tag.slug).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // AA-021 — Internal tag: # prefix normalised to hash- slug
  // Ghost supports "internal tags" — tags whose names begin with a # symbol.
  // They are invisible to readers in the public tag listing and in the Content
  // API, but they are fully functional for server-side content organisation
  // and filtering (e.g. a theme can use #podcast or #featured to apply custom
  // layout logic without surfacing those tags to visitors).
  //
  // Because # is not a valid URL character, Ghost normalises the slug by
  // replacing the leading # with the literal string "hash-".  A tag named
  // "#qa-internal-tag" must have a slug that begins with "hash-".
  //
  // Testing this validates a non-obvious Ghost feature: without it, a developer
  // who creates internal tags and queries them by slug would silently get 404s
  // because they expected the slug to start with "#" rather than "hash-".
  // -------------------------------------------------------------------------
  test('AA-021: internal tag with # prefix gets a hash- slug', async ({ adminApi }) => {
    const tag = await adminApi.createTag({ name: '#qa-internal-tag' });
    extraTagIds.push(tag.id);

    expect(tag.name).toBe('#qa-internal-tag');
    expect(tag.slug).toMatch(/^hash-/);
  });

  // -------------------------------------------------------------------------
  // AA-022 — Tag with description preserves the description
  // Description is an optional SEO field rendered in tag archive page meta.
  // This test confirms it survives the write-read round-trip on the create
  // response — a silent truncation or strip would affect all tag pages.
  // -------------------------------------------------------------------------
  test('AA-022: tag description is preserved in the create response', async ({ adminApi }) => {
    const description = 'Created by Playwright test suite — safe to delete';
    const tag = await adminApi.createTag({
      name: `aa-022-tag-${Date.now()}`,
      description,
    });
    extraTagIds.push(tag.id);

    expect(tag.description).toBe(description);
  });

  // -------------------------------------------------------------------------
  // AA-023 — Delete tag; subsequent GET returns 404
  // After deletion the tag must not be accessible via the Admin API.  Uses a
  // raw GET because there is no getTag() helper (it would assert 200 and throw).
  // afterEach calls deleteTag(seedTag.id) again — 404-tolerant, no failure.
  // -------------------------------------------------------------------------
  test('AA-023: deleted tag returns 404 on subsequent GET', async ({ adminApi, request }) => {
    await adminApi.deleteTag(seedTag.id);

    const res = await request.get(`${BASE()}/ghost/api/admin/tags/${seedTag.id}/`, {
      headers: authHeaders(),
    });

    expect(res.status()).toBe(404);
  });

  // -------------------------------------------------------------------------
  // AA-024 — Duplicate slug → 422
  // Tag slugs are the public URL key for archive pages and must be unique.
  // Sending an explicit slug that already belongs to another tag must be
  // rejected with 422 to prevent silent URL collisions.
  //
  // Both requests are raw because AdminApiHelper.createTag has no slug option
  // and asserts 201 internally, so it cannot be used for either the first
  // (slug-controlled) create or the expected-to-fail second create.
  // -------------------------------------------------------------------------
  test('AA-024: creating two tags with the same explicit slug returns 422 on the second', async ({
    request,
  }) => {
    const slug = `aa-024-dup-slug-${Date.now()}`;

    // First tag — must succeed
    const firstRes = await request.post(`${BASE()}/ghost/api/admin/tags/`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: { tags: [{ name: `AA-024 First ${Date.now()}`, slug }] },
    });
    expect(firstRes.status()).toBe(201);
    const firstBody = await firstRes.json();
    extraTagIds.push(firstBody.tags[0].id);

    // Second tag with the same slug — must be rejected
    const secondRes = await request.post(`${BASE()}/ghost/api/admin/tags/`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: { tags: [{ name: `AA-024 Second ${Date.now()}`, slug }] },
    });

    expect(secondRes.status()).toBe(422);
  });
});
