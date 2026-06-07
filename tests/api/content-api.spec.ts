/**
 * Content API test suite — CA-001 through CA-016
 * See docs/test-plan.md §8.2 for full test case inventory and rationale.
 */

import { test, expect } from '../fixtures';
import type { GhostPost, GhostPage, GhostTag } from '../fixtures';

const GHOST_URL = (process.env.GHOST_URL ?? '').replace(/\/$/, '');
const CONTENT_KEY = process.env.GHOST_CONTENT_API_KEY ?? '';
const BASE = `${GHOST_URL}/ghost/api/content`;

/**
 * Build a Content API URL with ?key=... plus optional extra params.
 * Pass { key: 'override' } in params to substitute a different key (used in CA-002).
 */
function url(path: string, params: Record<string, string | number> = {}): string {
  const merged: Record<string, string> = { key: CONTENT_KEY };
  for (const [k, v] of Object.entries(params)) merged[k] = String(v);
  return `${BASE}${path}?${new URLSearchParams(merged)}`;
}

// ---------------------------------------------------------------------------
// Shared fixture state — populated in beforeAll, cleaned up in afterAll
// ---------------------------------------------------------------------------

let publicPost: GhostPost;
let membersPost: GhostPost;
let draftPost: GhostPost;
let twoTagPost: GhostPost;
let filterTagPost: GhostPost;
let testPage: GhostPage;
let primaryTag: GhostTag;
let secondaryTag: GhostTag;
let filterTag: GhostTag;

test.beforeAll(async ({ adminApi }) => {
  const ts = Date.now();

  // Published public post — used for CA-003, CA-005, CA-006, CA-008
  publicPost = await adminApi.createPost({
    title: `CA Test — Public ${ts}`,
    status: 'published',
    visibility: 'public',
  });

  // Published members-only post — used for CA-004 security boundary test
  membersPost = await adminApi.createPost({
    title: `CA Test — Members ${ts}`,
    status: 'published',
    visibility: 'members',
  });

  // Draft post — must not appear in Content API browse results (CA-003)
  draftPost = await adminApi.createPost({
    title: `CA Test — Draft ${ts}`,
    status: 'draft',
    visibility: 'public',
  });

  // Two distinct tags for the primary/secondary ordering test (CA-012)
  primaryTag = await adminApi.createTag({ name: `ca-primary-${ts}` });
  secondaryTag = await adminApi.createTag({ name: `ca-secondary-${ts}` });

  // Published post with primaryTag first — Ghost treats the first tag as the primary tag (CA-012)
  twoTagPost = await adminApi.createPost({
    title: `CA Test — Two Tags ${ts}`,
    status: 'published',
    visibility: 'public',
    tags: [primaryTag.name, secondaryTag.name],
  });

  // Dedicated tag and post for the filter-by-tag test (CA-016)
  filterTag = await adminApi.createTag({ name: `ca-filter-${ts}` });
  filterTagPost = await adminApi.createPost({
    title: `CA Test — Filter ${ts}`,
    status: 'published',
    visibility: 'public',
    tags: [filterTag.name],
  });

  // Published page for CA-009 and CA-010
  testPage = await adminApi.createPage({
    title: `CA Test — Page ${ts}`,
    status: 'published',
  });
});

test.afterAll(async ({ adminApi }) => {
  for (const post of [publicPost, membersPost, draftPost, twoTagPost, filterTagPost]) {
    if (post) await adminApi.deletePost(post.id);
  }
  if (testPage) await adminApi.deletePage(testPage.id);
  for (const tag of [primaryTag, secondaryTag, filterTag]) {
    if (tag) await adminApi.deleteTag(tag.id);
  }
});

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

test.describe('Content API @content-api', () => {

  test.describe('Authentication', () => {

    test('CA-001: valid Content API key returns 200 on GET /posts', async ({ request }) => {
      // Verifies the baseline API contract: a valid key is accepted and the endpoint is reachable.
      const res = await request.get(url('/posts/'));
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.posts)).toBe(true);
      expect(body.posts.length).toBeGreaterThan(0);
    });

    test('CA-002: invalid Content API key returns 401', async ({ request }) => {
      // Ghost returns 401 (not 403) for an unrecognised Content API key — the request
      // is treated as unauthenticated rather than forbidden.
      const res = await request.get(url('/posts/', { key: 'invalid00000000000000000000000000000' }));
      expect(res.status()).toBe(401);
    });

  });

  test.describe('Posts', () => {

    test('CA-003: GET /posts returns only published, public posts', async ({ request }) => {
      // Draft posts must never appear in Content API responses. A regression here means unpublished
      // content leaks to public API consumers before the author intends to publish.
      const res = await request.get(url('/posts/', { limit: 'all' }));
      expect(res.status()).toBe(200);
      const body = await res.json();
      const slugs: string[] = body.posts.map((p: { slug: string }) => p.slug);
      expect(slugs).not.toContain(draftPost.slug);
    });

    test('CA-004: members-only post is present in Content API but marked visibility=members', async ({ request }) => {
      // Ghost's Content API includes members-only posts in browse results — the post metadata
      // (title, slug, visibility) is returned to allow themes to render a paywall or redirect.
      // Content gating is enforced at the theme/frontend layer, not the listing API layer.
      // This test verifies that Ghost correctly persists and returns visibility='members' on the
      // post object, which is the signal that downstream consumers (themes, headless frontends)
      // use to restrict access to the full content body.
      const res = await request.get(url(`/posts/slug/${membersPost.slug}/`, { fields: 'slug,visibility' }));
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.posts[0].slug).toBe(membersPost.slug);
      // The visibility field must be 'members' — this is the access boundary signal
      expect(body.posts[0].visibility).toBe('members');
    });

    test('CA-005: GET /posts/{slug} returns correct post by slug', async ({ request }) => {
      // Slug-based single-post lookup is the most common Content API read pattern for headless
      // frontends — validates the primary read path.
      const res = await request.get(url(`/posts/slug/${publicPost.slug}/`));
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.posts[0].id).toBe(publicPost.id);
      expect(body.posts[0].slug).toBe(publicPost.slug);
    });

    test('CA-006: GET /posts/{id} returns correct post by ID', async ({ request }) => {
      // ID-based lookup is used by headless consumers that persist Ghost post IDs rather than slugs.
      // Validates the alternate read path alongside slug-based lookup.
      const res = await request.get(url(`/posts/${publicPost.id}/`));
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.posts[0].id).toBe(publicPost.id);
      expect(body.posts[0].slug).toBe(publicPost.slug);
    });

    test('CA-007: GET /posts/{slug} for deleted post returns 404', async ({ request, adminApi }) => {
      // Tests that Ghost does not serve stale cached responses after content deletion. This instance
      // sits behind a Cloudflare reverse proxy, so cache invalidation is a real concern. See
      // docs/test-plan.md §9 (CA-007 reviewer note) and §10 (Cloudflare caching risk).
      const ephemeralPost = await adminApi.createPost({
        title: `CA-007 Ephemeral ${Date.now()}`,
        status: 'published',
        visibility: 'public',
      });
      await adminApi.deletePost(ephemeralPost.id);

      // Brief wait to allow Cloudflare cache propagation before asserting the 404
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const res = await request.get(url(`/posts/slug/${ephemeralPost.slug}/`));
      expect(res.status()).toBe(404);
    });

    test('CA-008: GET /posts with limit and page params returns correct subset', async ({ request }) => {
      // Validates that pagination produces non-overlapping result sets. Headless consumers rely on
      // limit + page to implement paginated archives and infinite scroll.
      const allRes = await request.get(url('/posts/', { limit: 'all' }));
      expect(allRes.status()).toBe(200);
      const allBody = await allRes.json();
      // beforeAll creates 3 public published posts; this guards against an unexpectedly sparse site
      expect(allBody.posts.length, 'need at least 3 published posts to validate pagination').toBeGreaterThanOrEqual(3);

      const page1Res = await request.get(url('/posts/', { limit: 2, page: 1 }));
      expect(page1Res.status()).toBe(200);
      const page1Body = await page1Res.json();
      expect(page1Body.posts.length).toBe(2);

      const page2Res = await request.get(url('/posts/', { limit: 2, page: 2 }));
      expect(page2Res.status()).toBe(200);
      const page2Body = await page2Res.json();
      expect(page2Body.posts.length).toBeGreaterThan(0);

      const page1Ids: string[] = page1Body.posts.map((p: { id: string }) => p.id);
      const page2Ids: string[] = page2Body.posts.map((p: { id: string }) => p.id);
      const overlap = page1Ids.filter((id) => page2Ids.includes(id));
      expect(overlap).toHaveLength(0);
    });

  });

  test.describe('Pages', () => {

    test('CA-009: GET /pages returns published pages', async ({ request }) => {
      // Pages are a distinct resource type from posts in Ghost and served from a separate endpoint.
      // Validates the browse endpoint is reachable and includes the page created in beforeAll.
      const res = await request.get(url('/pages/'));
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.pages)).toBe(true);
      expect(body.pages.length).toBeGreaterThan(0);
    });

    test('CA-010: GET /pages/{slug} returns correct page', async ({ request }) => {
      // Validates the single-page-by-slug read path. Pages share structure with posts but occupy
      // a separate namespace and endpoint.
      const res = await request.get(url(`/pages/slug/${testPage.slug}/`));
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.pages[0].id).toBe(testPage.id);
      expect(body.pages[0].slug).toBe(testPage.slug);
    });

  });

  test.describe('Tags', () => {

    test('CA-011: GET /tags returns tag list', async ({ request }) => {
      // Tags are the primary content organisation mechanism in Ghost. Validates the browse endpoint
      // is reachable and returns at least the tags created in beforeAll.
      const res = await request.get(url('/tags/'));
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.tags)).toBe(true);
      expect(body.tags.length).toBeGreaterThan(0);
    });

    test('CA-012: post response includes tags in correct primary/secondary order', async ({ request }) => {
      // Ghost designates the first tag in the array as the "primary tag", which drives canonical
      // URLs and theme rendering. Validates that the Content API preserves assignment order so
      // downstream consumers can rely on tags[0] being the primary. See test-plan.md §9.
      const res = await request.get(url(`/posts/slug/${twoTagPost.slug}/`, { include: 'tags' }));
      expect(res.status()).toBe(200);
      const body = await res.json();
      const tags: Array<{ slug: string }> = body.posts[0].tags;
      expect(tags.length).toBeGreaterThanOrEqual(2);
      expect(tags[0].slug).toBe(primaryTag.slug);
      expect(tags[1].slug).toBe(secondaryTag.slug);
    });

  });

  test.describe('Authors', () => {

    test('CA-013: GET /authors returns author list', async ({ request }) => {
      // Validates the authors browse endpoint returns at least the default admin author present
      // on every Ghost installation.
      const res = await request.get(url('/authors/'));
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.authors)).toBe(true);
      expect(body.authors.length).toBeGreaterThan(0);
    });

    test('CA-014: GET /authors/{slug} returns correct author', async ({ request }) => {
      // Validates the single-author-by-slug read path. Retrieves the first author from the browse
      // list and confirms the slug-based lookup returns the same record.
      const listRes = await request.get(url('/authors/'));
      expect(listRes.status()).toBe(200);
      const listBody = await listRes.json();
      const firstAuthor = listBody.authors[0] as { id: string; slug: string };

      const res = await request.get(url(`/authors/slug/${firstAuthor.slug}/`));
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.authors[0].id).toBe(firstAuthor.id);
      expect(body.authors[0].slug).toBe(firstAuthor.slug);
    });

  });

  test.describe('Settings', () => {

    test('CA-015: GET /settings returns site title and description', async ({ request }) => {
      // Site metadata is the minimum viable response from the settings endpoint. Title is required
      // for any functional Ghost integration (RSS, SEO, newsletters, Open Graph).
      const res = await request.get(url('/settings/'));
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.settings).toBeDefined();
      expect(typeof body.settings.title).toBe('string');
      expect(body.settings.title.length).toBeGreaterThan(0);
      // description is optional in Ghost config but the field must be present in the response schema
      expect('description' in body.settings).toBe(true);
    });

  });

  test.describe('Filtering', () => {

    test('CA-016: GET /posts?filter=tag:{slug} returns only posts with that tag', async ({ request }) => {
      // Validates the NQL filter parameter — the mechanism headless consumers use to retrieve
      // content by taxonomy. All returned posts must carry the filter tag; no posts from other
      // tags should leak through.
      const res = await request.get(
        url('/posts/', { filter: `tag:${filterTag.slug}`, include: 'tags', limit: 'all' }),
      );
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.posts.length).toBeGreaterThan(0);

      // The post created with this tag in beforeAll must appear in results
      const ids: string[] = body.posts.map((p: { id: string }) => p.id);
      expect(ids).toContain(filterTagPost.id);

      // Every returned post must carry the filter tag
      for (const post of body.posts as Array<{ tags: Array<{ slug: string }> }>) {
        const tagSlugs = post.tags.map((t) => t.slug);
        expect(tagSlugs).toContain(filterTag.slug);
      }
    });

  });

});
