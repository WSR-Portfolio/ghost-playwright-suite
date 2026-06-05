/**
 * Admin API — Pages (AA-017 through AA-019)
 *
 * WHY PAGES ARE TESTED SEPARATELY FROM POSTS
 * -------------------------------------------
 * Pages and posts share a nearly identical JSON shape, which makes it tempting
 * to skip page-specific tests and assume the two resources behave identically.
 * That assumption is incorrect for three reasons:
 *
 * 1. Distinct API endpoints.  Pages live under /ghost/api/admin/pages/ and
 *    /ghost/api/content/pages/, not /posts/.  A routing or middleware
 *    regression that only affects one resource type would be invisible to a
 *    test suite that only exercises posts.
 *
 * 2. Different data model.  In Ghost's data model, pages are standalone
 *    content outside the post stream (About, Contact, etc.).  They are
 *    excluded from the main blog feed and from Content API /posts/ responses
 *    by design — they have their own collection endpoint.  AA-018 asserts this
 *    explicitly.
 *
 * 3. Different default visibility behaviour.  A newly created draft page is
 *    public by default, but it does not inherit the post-stream filtering
 *    logic.  Visibility settings also interact differently with Ghost's
 *    member-gating features for pages vs posts.
 *
 * A test suite that only covers posts has incomplete coverage.  These three
 * tests establish the baseline for the pages resource and prove that the
 * endpoint separation is correctly enforced at the API level.
 */

import { test, expect, generateAdminToken } from '../fixtures';
import type { GhostPage } from '../fixtures';

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

let seedPage: GhostPage;
let extraPageIds: string[] = [];

test.describe('Admin API — Pages', () => {
  test.beforeEach(async ({ adminApi }) => {
    extraPageIds = [];
    seedPage = await adminApi.createPage({ title: `Seed Page ${Date.now()}` });
  });

  test.afterEach(async ({ adminApi }) => {
    // deletePage accepts 404, so this is safe even when AA-019 already deleted
    // the page inside the test body.
    await adminApi.deletePage(seedPage.id);
    for (const id of extraPageIds) {
      await adminApi.deletePage(id);
    }
  });

  // -------------------------------------------------------------------------
  // AA-017 — Create a draft page
  // Validates the basic creation contract for the pages resource: 201, all
  // required fields returned (id, title, slug, status=draft, url).  A slug
  // must be auto-generated from the title — pages without a slug cannot be
  // resolved by Ghost's router.
  // -------------------------------------------------------------------------
  test('AA-017: create a draft page returns 201 with required fields', async ({ adminApi }) => {
    const title = `AA-017 Draft Page ${Date.now()}`;
    const page = await adminApi.createPage({ title });
    extraPageIds.push(page.id);

    expect(page.id).toBeTruthy();
    expect(page.title).toBe(title);
    expect(page.status).toBe('draft');
    expect(page.slug).toBeTruthy();
    expect(page.updated_at).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // AA-018 — Published page is accessible via /pages/ but absent from /posts/
  // This test proves the endpoint separation described in the file header.
  // A published page must appear in the Content API /pages/ collection and
  // must NOT appear in the Content API /posts/ collection.  If a page leaks
  // into /posts/, Ghost's routing logic is broken and themes will display the
  // page in the wrong context (blog feed instead of standalone URL).
  // -------------------------------------------------------------------------
  test('AA-018: published page appears in Content API /pages/ but not /posts/', async ({
    adminApi,
    request,
  }) => {
    const page = await adminApi.createPage({
      title: `AA-018 Published Page ${Date.now()}`,
      status: 'published',
    });
    extraPageIds.push(page.id);

    expect(page.status).toBe('published');

    // Verify the page is present in the Content API /pages/ collection
    const pagesRes = await request.get(`${BASE()}/ghost/api/content/pages/`, {
      params: { key: CONTENT_KEY(), limit: 'all' },
    });
    expect(pagesRes.status()).toBe(200);
    const pagesSlugs: string[] = ((await pagesRes.json()).pages as Array<{ slug: string }>).map(
      (p) => p.slug,
    );
    expect(pagesSlugs).toContain(page.slug);

    // Verify the same slug does NOT appear in the Content API /posts/ collection
    const postsRes = await request.get(`${BASE()}/ghost/api/content/posts/`, {
      params: { key: CONTENT_KEY(), limit: 'all' },
    });
    expect(postsRes.status()).toBe(200);
    const postsSlugs: string[] = ((await postsRes.json()).posts as Array<{ slug: string }>).map(
      (p) => p.slug,
    );
    expect(postsSlugs).not.toContain(page.slug);
  });

  // -------------------------------------------------------------------------
  // AA-019 — Delete page; subsequent GET returns 404
  // After deletion the page must no longer be accessible via the Admin API.
  // Uses a raw GET (not a helper method) because AdminApiHelper.getPost asserts
  // 200 internally — bypassing it lets us assert the actual 404 status.
  // afterEach calls deletePage(seedPage.id) again; the 404-tolerant helper
  // ensures this does not cause a test failure.
  // -------------------------------------------------------------------------
  test('AA-019: deleted page returns 404 on subsequent GET', async ({ adminApi, request }) => {
    await adminApi.deletePage(seedPage.id);

    const res = await request.get(`${BASE()}/ghost/api/admin/pages/${seedPage.id}/`, {
      headers: authHeaders(),
    });

    expect(res.status()).toBe(404);
  });
});
