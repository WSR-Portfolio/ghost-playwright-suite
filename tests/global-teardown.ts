/**
 * Global teardown — runs once after all tests complete.
 *
 * MEMBER TEARDOWN POLICY
 * ----------------------
 * Ghost member registration is intentionally left open on this instance because
 * MU-001 through MU-003 require the public signup portal to be functional. This
 * means any real person who discovers the URL during a test run can create an
 * account. Global teardown deletes all members unconditionally so those rogue
 * accounts do not accumulate and do not affect subsequent runs. This is
 * documented behavior, not a bug. This instance has no real users — it is a
 * controlled test target only.
 */

import { request } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import { AdminApiHelper } from './fixtures/admin-api.fixture';
import { MailpitHelper } from './fixtures/mailpit.fixture';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

export default async function globalTeardown(): Promise<void> {
  const requestContext = await request.newContext();

  try {
    const adminApi = new AdminApiHelper(requestContext);
    const mailpit = new MailpitHelper(requestContext);

    await adminApi.deleteAllMembers();
    console.log('[teardown] All members deleted.');

    await mailpit.deleteAllMessages();
    console.log('[teardown] All Mailpit messages deleted.');

    console.log('[teardown] Complete.');
  } finally {
    await requestContext.dispose();
  }
}
