/**
 * Ghost Admin API helper and Playwright fixture.
 *
 * WHY JWT AND NOT THE RAW API KEY
 * --------------------------------
 * Ghost deliberately does not accept the Admin API key as a static Bearer
 * token.  Instead, the key is a credential pair — {id}:{secret} — used to
 * mint a short-lived JWT on every request.  This design limits the blast
 * radius of a leaked token: even if a JWT is intercepted it expires within
 * 5 minutes and cannot be reused to obtain a long-lived session.
 *
 * The signing process:
 *   1. Split the key on ':' to get the key id and the hex-encoded secret.
 *   2. Decode the secret from hex to raw bytes (Buffer.from(secret, 'hex')).
 *   3. Sign an empty payload with HS256, setting keyid, audience '/admin/',
 *      and a 5-minute expiry.
 *   4. Send every Admin API request with  Authorization: Ghost <token>
 *
 * Skipping any of these steps produces a 401.  Using the raw key as a Bearer
 * token is a common mistake and produces the same opaque 401 with no hint.
 */

import { test as base, expect, APIRequestContext } from '@playwright/test';
import jwt from 'jsonwebtoken';

// ---------------------------------------------------------------------------
// JWT generation — called before every request so tokens never expire mid-suite
// ---------------------------------------------------------------------------

export function generateAdminToken(): string {
  const key = process.env.GHOST_ADMIN_API_KEY;
  if (!key) throw new Error('GHOST_ADMIN_API_KEY is not set');

  const colonIdx = key.indexOf(':');
  if (colonIdx === -1) throw new Error('GHOST_ADMIN_API_KEY must be in format {id}:{secret}');

  const id = key.slice(0, colonIdx);
  const secret = key.slice(colonIdx + 1);

  return jwt.sign({}, Buffer.from(secret, 'hex'), {
    keyid: id,
    algorithm: 'HS256',
    expiresIn: '5m',
    audience: '/admin/',
  });
}

// ---------------------------------------------------------------------------
// Interfaces — fields returned by the Ghost Admin API that tests assert against
// ---------------------------------------------------------------------------

export interface GhostPost {
  id: string;
  uuid: string;
  title: string;
  slug: string;
  status: 'draft' | 'published' | 'scheduled';
  visibility: 'public' | 'members' | 'paid' | 'tiers';
  featured: boolean;
  url: string;
  published_at: string | null;
  updated_at: string;
  tags: GhostTag[];
}

export interface GhostPage {
  id: string;
  uuid: string;
  title: string;
  slug: string;
  status: 'draft' | 'published';
  url: string;
  updated_at: string;
}

export interface GhostTag {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export interface GhostMember {
  id: string;
  uuid: string;
  name: string;
  email: string;
  status: 'free' | 'paid' | 'comped';
  created_at: string;
  labels: { id: string; name: string }[];
}

// ---------------------------------------------------------------------------
// Helper class — one instance per test via the Playwright fixture below
// ---------------------------------------------------------------------------

export class AdminApiHelper {
  private readonly baseUrl: string;

  constructor(private readonly request: APIRequestContext) {
    const url = process.env.GHOST_URL;
    if (!url) throw new Error('GHOST_URL is not set');
    this.baseUrl = url.replace(/\/$/, '');
  }

  // Fresh token per request — avoids expiry issues in long-running suites
  private get headers() {
    return { Authorization: `Ghost ${generateAdminToken()}` };
  }

  // ---- Posts ---------------------------------------------------------------

  /** Create a post.  Tags are passed as display names; Ghost resolves or creates them. */
  async createPost(options: {
    title: string;
    status?: string;
    visibility?: string;
    tags?: string[];
    featured?: boolean;
    publishedAt?: string;
    html?: string;
    lexical?: string;
  }): Promise<GhostPost> {
    const payload: Record<string, unknown> = {
      title: options.title,
      status: options.status ?? 'draft',
    };
    if (options.visibility) payload.visibility = options.visibility;
    if (options.featured !== undefined) payload.featured = options.featured;
    if (options.publishedAt) payload.published_at = options.publishedAt;
    if (options.tags) payload.tags = options.tags.map((name) => ({ name }));
    if (options.html) payload.html = options.html;
    if (options.lexical) payload.lexical = options.lexical;

    // Timeout is governed centrally by actionTimeout in playwright.config.ts (30s),
    // sized for the NAS under load. See docs/decisions.md §7.
    const res = await this.request.post(`${this.baseUrl}/ghost/api/admin/posts/`, {
      headers: this.headers,
      data: { posts: [payload] },
    });
    expect(res.status(), `createPost "${options.title}"`).toBe(201);
    const body = await res.json();
    return body.posts[0] as GhostPost;
  }

  /**
   * Update a post.  Ghost enforces optimistic concurrency via updated_at:
   * the caller must pass the current value returned by a prior read or create.
   * Omitting it produces a 409 Conflict.
   */
  async updatePost(
    id: string,
    options: Partial<GhostPost> & { updated_at: string },
  ): Promise<GhostPost> {
    const res = await this.request.put(`${this.baseUrl}/ghost/api/admin/posts/${id}/`, {
      headers: this.headers,
      data: { posts: [options] },
    });
    expect(res.status(), `updatePost ${id}`).toBe(200);
    const body = await res.json();
    return body.posts[0] as GhostPost;
  }

  async deletePost(id: string): Promise<void> {
    const res = await this.request.delete(`${this.baseUrl}/ghost/api/admin/posts/${id}/`, {
      headers: this.headers,
    });
    // 204 = deleted; 404 = already gone — both are acceptable in teardown.
    // 5xx = Ghost is transiently unavailable; warn and continue rather than
    // failing the test for a teardown that is best-effort anyway.
    if (res.status() !== 204 && res.status() !== 404) {
      if (res.status() >= 500) {
        console.warn(`deletePost ${id} returned HTTP ${res.status()} — skipping teardown cleanup`);
        return;
      }
      throw new Error(`deletePost ${id} failed: HTTP ${res.status()}`);
    }
  }

  async getPost(id: string): Promise<GhostPost> {
    const res = await this.request.get(`${this.baseUrl}/ghost/api/admin/posts/${id}/`, {
      headers: this.headers,
    });
    expect(res.status(), `getPost ${id}`).toBe(200);
    const body = await res.json();
    return body.posts[0] as GhostPost;
  }

  // ---- Pages ---------------------------------------------------------------

  async createPage(options: { title: string; status?: string }): Promise<GhostPage> {
    const res = await this.request.post(`${this.baseUrl}/ghost/api/admin/pages/`, {
      headers: this.headers,
      data: { pages: [{ title: options.title, status: options.status ?? 'draft' }] },
    });
    expect(res.status(), `createPage "${options.title}"`).toBe(201);
    const body = await res.json();
    return body.pages[0] as GhostPage;
  }

  async deletePage(id: string): Promise<void> {
    const res = await this.request.delete(`${this.baseUrl}/ghost/api/admin/pages/${id}/`, {
      headers: this.headers,
    });
    if (res.status() !== 204 && res.status() !== 404) {
      if (res.status() >= 500) {
        console.warn(`deletePage ${id} returned HTTP ${res.status()} — skipping teardown cleanup`);
        return;
      }
      throw new Error(`deletePage ${id} failed: HTTP ${res.status()}`);
    }
  }

  // ---- Tags ----------------------------------------------------------------

  async createTag(options: { name: string; description?: string }): Promise<GhostTag> {
    const res = await this.request.post(`${this.baseUrl}/ghost/api/admin/tags/`, {
      headers: this.headers,
      data: { tags: [options] },
    });
    expect(res.status(), `createTag "${options.name}"`).toBe(201);
    const body = await res.json();
    return body.tags[0] as GhostTag;
  }

  async deleteTag(id: string): Promise<void> {
    const res = await this.request.delete(`${this.baseUrl}/ghost/api/admin/tags/${id}/`, {
      headers: this.headers,
    });
    if (res.status() !== 204 && res.status() !== 404) {
      if (res.status() >= 500) {
        console.warn(`deleteTag ${id} returned HTTP ${res.status()} — skipping teardown cleanup`);
        return;
      }
      throw new Error(`deleteTag ${id} failed: HTTP ${res.status()}`);
    }
  }

  // ---- Members -------------------------------------------------------------

  async createMember(options: { name: string; email: string }): Promise<GhostMember> {
    const res = await this.request.post(`${this.baseUrl}/ghost/api/admin/members/`, {
      headers: this.headers,
      data: { members: [options] },
    });
    expect(res.status(), `createMember "${options.email}"`).toBe(201);
    const body = await res.json();
    return body.members[0] as GhostMember;
  }

  async deleteMember(id: string): Promise<void> {
    const res = await this.request.delete(`${this.baseUrl}/ghost/api/admin/members/${id}/`, {
      headers: this.headers,
    });
    if (res.status() !== 204 && res.status() !== 404) {
      if (res.status() >= 500) {
        console.warn(`deleteMember ${id} returned HTTP ${res.status()} — skipping teardown cleanup`);
        return;
      }
      throw new Error(`deleteMember ${id} failed: HTTP ${res.status()}`);
    }
  }

  /**
   * Delete every member in the site.  Ghost has no single-shot "delete all"
   * endpoint, so this pages through the full member list and deletes in series.
   * Intended for afterAll teardown in member-heavy test suites.
   */
  async deleteAllMembers(): Promise<void> {
    let page = 1;
    while (true) {
      const res = await this.request.get(`${this.baseUrl}/ghost/api/admin/members/`, {
        headers: this.headers,
        params: { limit: 100, page },
      });
      expect(res.status(), 'deleteAllMembers list').toBe(200);
      const body = await res.json();
      const members: GhostMember[] = body.members ?? [];

      for (const m of members) {
        await this.deleteMember(m.id);
      }

      // Stop when the last page has been processed
      if (members.length < 100) break;
      page++;
    }
  }

  async getMemberByEmail(email: string): Promise<GhostMember | null> {
    const res = await this.request.get(`${this.baseUrl}/ghost/api/admin/members/`, {
      headers: this.headers,
      params: { filter: `email:'${email}'` },
    });
    expect(res.status(), `getMemberByEmail "${email}"`).toBe(200);
    const body = await res.json();
    return (body.members[0] as GhostMember) ?? null;
  }
}

// ---------------------------------------------------------------------------
// Playwright fixture
// ---------------------------------------------------------------------------

type AdminApiFixtures = { adminApi: AdminApiHelper };

export const test = base.extend<AdminApiFixtures>({
  adminApi: async ({ request }, use) => {
    await use(new AdminApiHelper(request));
  },
});

export { expect } from '@playwright/test';
