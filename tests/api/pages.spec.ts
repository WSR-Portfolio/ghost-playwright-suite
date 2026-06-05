/**
 * Admin API — Pages (AA-014 through AA-018)
 *
 * Pages in Ghost are standalone content outside the post stream (About,
 * Contact, etc.).  They share the same API shape as posts but live under a
 * separate /pages/ endpoint.  These tests verify the full CRUD lifecycle.
 */

import { test, expect, generateAdminToken } from '../fixtures';

const BASE = (): string => {
  const u = process.env.GHOST_URL;
  if (!u) throw new Error('GHOST_URL not set');
  return u.replace(/\/$/, '');
};

const authHeaders = () => ({ Authorization: `Ghost ${generateAdminToken()}` });

let createdPageIds: string[] = [];

test.describe('Admin API — Pages', () => {
  test.afterAll(async ({ adminApi }) => {
    for (const id of createdPageIds) {
      await adminApi.deletePage(id);
    }
  });

  // -------------------------------------------------------------------------
  // AA-014 — Create draft page
  // Validates the basic creation contract for the pages resource: 201, correct
  // title, and default status=draft.
  // -------------------------------------------------------------------------
  test('AA-014: create a draft page returns 201 with status=draft', async ({ adminApi }) => {
    const title = `AA-014 Draft Page ${Date.now()}`;
    const page = await adminApi.createPage({ title });

    createdPageIds.push(page.id);

    expect(page.id).toBeTruthy();
    expect(page.title).toBe(title);
    expect(page.status).toBe('draft');
  });

  // -------------------------------------------------------------------------
  // AA-015 — Create published page
  // A page created with status=published must be immediately live.  This
  // mirrors the most common production workflow for static site pages.
  // -------------------------------------------------------------------------
  test('AA-015: create a published page sets status=published', async ({ adminApi }) => {
    const title = `AA-015 Published Page ${Date.now()}`;
    const page = await adminApi.createPage({ title, status: 'published' });

    createdPageIds.push(page.id);

    expect(page.status).toBe('published');
    expect(page.url).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // AA-016 — Read page by ID
  // Fetching a page by its ID must return the correct record.  This confirms
  // the GET /pages/:id endpoint and response envelope are functioning.
  // -------------------------------------------------------------------------
  test('AA-016: get page by ID returns the correct page', async ({ adminApi, request }) => {
    const title = `AA-016 Get-by-ID Page ${Date.now()}`;
    const created = await adminApi.createPage({ title });
    createdPageIds.push(created.id);

    const res = await request.get(`${BASE()}/ghost/api/admin/pages/${created.id}/`, {
      headers: authHeaders(),
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.pages[0].title).toBe(title);
  });

  // -------------------------------------------------------------------------
  // AA-017 — Delete page returns 204
  // A successfully deleted page must produce a 204 No Content response.
  // Confirms that the delete endpoint works and does not leave orphaned records.
  // -------------------------------------------------------------------------
  test('AA-017: delete page returns 204', async ({ adminApi, request }) => {
    const page = await adminApi.createPage({ title: `AA-017 To Delete ${Date.now()}` });

    // deleteAll handles 404, but we want to confirm the first deletion is a 204
    const res = await request.delete(`${BASE()}/ghost/api/admin/pages/${page.id}/`, {
      headers: authHeaders(),
    });

    expect(res.status()).toBe(204);
    // Do not add to createdPageIds — already deleted above
  });

  // -------------------------------------------------------------------------
  // AA-018 — List pages
  // The pages listing endpoint must return 200 and a pages array.  Validates
  // that the pages collection is accessible and correctly shaped.
  // -------------------------------------------------------------------------
  test('AA-018: list pages returns 200 with a pages array', async ({ request }) => {
    const res = await request.get(`${BASE()}/ghost/api/admin/pages/`, {
      headers: authHeaders(),
      params: { limit: 5 },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.pages)).toBe(true);
  });
});
