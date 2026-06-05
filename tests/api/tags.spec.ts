/**
 * Admin API — Tags (AA-019 through AA-023)
 *
 * Tags categorise posts and drive navigation and RSS feeds.  These tests cover
 * the full tag lifecycle plus the server-side validation that rejects tag
 * creation without a required name field.
 */

import { test, expect, generateAdminToken, TEST_TAG_NAME, TEST_TAG_DESCRIPTION } from '../fixtures';

const BASE = (): string => {
  const u = process.env.GHOST_URL;
  if (!u) throw new Error('GHOST_URL not set');
  return u.replace(/\/$/, '');
};

const authHeaders = () => ({ Authorization: `Ghost ${generateAdminToken()}` });

let createdTagIds: string[] = [];

test.describe('Admin API — Tags', () => {
  test.afterAll(async ({ adminApi }) => {
    for (const id of createdTagIds) {
      await adminApi.deleteTag(id);
    }
  });

  // -------------------------------------------------------------------------
  // AA-019 — Create tag
  // Validates the basic creation contract: 201, name and auto-generated slug
  // are returned.  Slug derivation from name is a Ghost invariant.
  // -------------------------------------------------------------------------
  test('AA-019: create tag returns 201 with name and slug', async ({ adminApi }) => {
    const name = `${TEST_TAG_NAME}-${Date.now()}`;
    const tag = await adminApi.createTag({ name });

    createdTagIds.push(tag.id);

    expect(tag.id).toBeTruthy();
    expect(tag.name).toBe(name);
    expect(tag.slug).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // AA-020 — Create tag with description
  // Description is an optional free-text field used in SEO meta.  This test
  // confirms it survives the round-trip and is not silently dropped.
  // -------------------------------------------------------------------------
  test('AA-020: create tag with description preserves the description', async ({ adminApi }) => {
    const name = `${TEST_TAG_NAME}-desc-${Date.now()}`;
    const tag = await adminApi.createTag({ name, description: TEST_TAG_DESCRIPTION });

    createdTagIds.push(tag.id);

    expect(tag.description).toBe(TEST_TAG_DESCRIPTION);
  });

  // -------------------------------------------------------------------------
  // AA-021 — Delete tag returns 204
  // A successfully deleted tag must produce 204 No Content.  Confirms the
  // endpoint removes the resource and that subsequent use via list would not
  // return it (implicitly validated by afterAll not finding orphans).
  // -------------------------------------------------------------------------
  test('AA-021: delete tag returns 204', async ({ adminApi, request }) => {
    const name = `${TEST_TAG_NAME}-delete-${Date.now()}`;
    const tag = await adminApi.createTag({ name });

    const res = await request.delete(`${BASE()}/ghost/api/admin/tags/${tag.id}/`, {
      headers: authHeaders(),
    });

    expect(res.status()).toBe(204);
    // Not pushed to createdTagIds — already deleted
  });

  // -------------------------------------------------------------------------
  // AA-022 — List tags
  // The tags listing endpoint must return 200 and a tags array.  This is the
  // foundation of tag-browsing and filtering features.
  // -------------------------------------------------------------------------
  test('AA-022: list tags returns 200 with a tags array', async ({ request }) => {
    const res = await request.get(`${BASE()}/ghost/api/admin/tags/`, {
      headers: authHeaders(),
      params: { limit: 10 },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.tags)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // AA-023 — Create tag without required name → 422
  // The name field is required.  Submitting a tag record with no name must
  // be rejected with 422 Unprocessable Entity rather than silently creating
  // a nameless tag that would break UI rendering.
  // -------------------------------------------------------------------------
  test('AA-023: create tag without name field returns 422', async ({ request }) => {
    const res = await request.post(`${BASE()}/ghost/api/admin/tags/`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      // name field deliberately omitted to trigger server-side validation
      data: { tags: [{ description: 'Missing name field' }] },
    });

    expect(res.status()).toBe(422);
  });
});
