/**
 * Mailpit helper and Playwright fixture.
 *
 * WHY MAILPIT EXISTS IN THIS SUITE
 * ---------------------------------
 * Ghost does not support password-based login for members (subscribers).
 * Every member authentication flow — sign-up, sign-in, email verification —
 * is driven exclusively by a magic link that Ghost sends to the member's
 * email address.  In production that email goes to a real inbox; in this
 * test environment, Ghost's SMTP is pointed at a Mailpit container running
 * on the local Docker network (http://10.0.4.113:8025).
 *
 * Mailpit catches every outbound email and exposes it via a REST API, which
 * means tests can:
 *   1. Trigger a Ghost action that sends an email (e.g. "send magic link").
 *   2. Immediately call getLatestEmailTo() to retrieve that email.
 *   3. Call extractMagicLink() to pull the URL out of the HTML body.
 *   4. Navigate the browser to that URL to complete the auth flow.
 *
 * Without Mailpit, member authentication tests would require a real external
 * inbox, making them slow, flaky, and impossible to run in CI.
 */

import { test as base, expect, APIRequestContext } from '@playwright/test';
import { test as adminApiTest } from './admin-api.fixture';

// ---------------------------------------------------------------------------
// Interfaces — Mailpit API v1 response shapes
// ---------------------------------------------------------------------------

/** Lightweight summary returned by GET /api/v1/messages */
interface MailpitMessageSummary {
  ID: string;
  Subject: string;
  From: { Address: string; Name: string };
  To: { Address: string; Name: string }[];
  Date: string;
  Snippet: string;
}

/** Full message detail returned by GET /api/v1/message/{id} */
export interface MailpitMessage {
  /** Mailpit message ID — used to fetch full body and to delete the message */
  ID: string;
  Subject: string;
  From: { Address: string; Name: string };
  To: { Address: string; Name: string }[];
  Date: string;
  /** Rendered HTML body — primary source for extracting magic links */
  HTML: string;
  /** Plain-text body — fallback if HTML is empty */
  Text: string;
}

// ---------------------------------------------------------------------------
// Helper class
// ---------------------------------------------------------------------------

export class MailpitHelper {
  private readonly apiBase: string;

  constructor(private readonly request: APIRequestContext) {
    const url = process.env.MAILPIT_URL;
    if (!url) throw new Error('MAILPIT_URL is not set');
    this.apiBase = `${url.replace(/\/$/, '')}/api/v1`;
  }

  /**
   * Return the most recent message addressed to `address`, or null if none
   * exists yet.  This is a single-shot check — callers that need to wait for
   * an email to arrive should poll this method themselves.
   */
  async getLatestEmailTo(address: string): Promise<MailpitMessage | null> {
    const res = await this.request.get(`${this.apiBase}/messages`);
    expect(res.status(), 'Mailpit /messages').toBe(200);

    const body = await res.json();
    const messages: MailpitMessageSummary[] = body.messages ?? [];

    // Mailpit returns messages newest-first; find the first one addressed to
    // this recipient (case-insensitive to match real-world email semantics)
    const summary = messages.find((m) =>
      m.To?.some((t) => t.Address.toLowerCase() === address.toLowerCase()),
    );

    if (!summary) return null;

    // Fetch the full message so the caller has access to HTML/Text bodies
    const detailRes = await this.request.get(`${this.apiBase}/message/${summary.ID}`);
    expect(detailRes.status(), `Mailpit message ${summary.ID}`).toBe(200);
    return detailRes.json() as Promise<MailpitMessage>;
  }

  /**
   * Extract the Ghost magic-link URL from a message's HTML body.
   *
   * Ghost magic links contain '/members/' in the path and a 'token' query
   * parameter.  The URL appears as an href in the HTML, so it may contain
   * HTML-encoded ampersands (&amp;) that must be decoded before the browser
   * can navigate to it.
   *
   * Throws a descriptive error if no matching URL is found — this surfaces
   * faster than a browser timeout and points directly at the fixture layer.
   */
  extractMagicLink(message: MailpitMessage): string {
    // Prefer HTML body; fall back to plain-text if HTML is absent
    const source = message.HTML || message.Text || '';

    const match = source.match(
      /https?:\/\/[^\s"'<>]*\/members\/[^\s"'<>]*token=[^\s"'<>]*/,
    );

    if (!match) {
      throw new Error(
        `extractMagicLink: no magic link found in message "${message.Subject}" (ID: ${message.ID}). ` +
          'Expected a URL containing /members/ and a token= parameter.',
      );
    }

    // Decode HTML entities introduced by email clients or Ghost's mailer
    return match[0].replace(/&amp;/g, '&');
  }

  /**
   * Delete all messages in Mailpit.  Call this in beforeAll/afterAll hooks to
   * prevent stale emails from interfering with getLatestEmailTo() lookups
   * across test runs — especially important when the same address is reused.
   */
  async deleteAllMessages(): Promise<void> {
    // Mailpit DELETE /api/v1/messages with an empty IDs array deletes everything
    const res = await this.request.delete(`${this.apiBase}/messages`, {
      data: { IDs: [] },
    });
    // 200 or 204 are both valid success codes depending on Mailpit version
    if (!res.ok()) {
      throw new Error(`deleteAllMessages failed: HTTP ${res.status()}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Playwright fixture — extends adminApi so every spec gets both fixtures
// ---------------------------------------------------------------------------

type MailpitFixtures = { mailpit: MailpitHelper };

export const test = adminApiTest.extend<MailpitFixtures>({
  mailpit: async ({ request }, use) => {
    await use(new MailpitHelper(request));
  },

  /**
   * Centralized navigation hardening for the NAS test target (same rationale as the
   * operation timeouts in ADR §7 — accommodate the environment once, in one place).
   *
   * The Ghost admin is a heavy SPA served through the Cloudflare Tunnel. Waiting for the
   * full 'load' event (every JS bundle, font, and beacon) is fragile under sustained NAS
   * load and can blow past the navigation timeout even when the page is already interactive
   * — observed as `page.goto: Timeout exceeded ... waiting until "load"` on the foundational
   * login. Default every goto to 'domcontentloaded' (the sign-in form and admin shell are
   * usable well before 'load' fires) and give navigations a budget sized for the NAS. Setting
   * this once here means all spec gotos inherit it without scattering per-call overrides —
   * the exact anti-pattern ADR §7 calls out. Callers can still pass an explicit waitUntil to
   * opt back into stricter waiting where a test genuinely needs it.
   */
  page: async ({ page }, use) => {
    page.setDefaultNavigationTimeout(45_000);
    const originalGoto = page.goto.bind(page);
    page.goto = (url, options) =>
      originalGoto(url, { waitUntil: 'domcontentloaded', ...options });
    await use(page);
  },
});

export { expect } from '@playwright/test';
