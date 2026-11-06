import { createDb, createPool, migrateUp, seed, type Db } from '@renewal/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MemorySender, type EmailMessage, type EmailSender } from './email.js';
import { runOnce } from './reminders.js';

const adminUrl = process.env.DATABASE_URL;
const workerUrl = process.env.WORKER_DATABASE_URL;

class FailingSender implements EmailSender {
  attempts = 0;
  async send(_message: EmailMessage): Promise<void> {
    this.attempts += 1;
    throw new Error('smtp down');
  }
}

describe.skipIf(!adminUrl || !workerUrl)('reminder worker', () => {
  let admin: Db;
  let db: Db;
  let figmaId: string;

  beforeAll(async () => {
    await migrateUp(adminUrl!);
    admin = createDb(createPool(adminUrl!, 1));
    db = createDb(createPool(workerUrl!, 4));
  });

  beforeEach(async () => {
    await seed(admin);
    figmaId = (
      await admin
        .selectFrom('subscriptions')
        .select('id')
        .where('vendor', '=', 'Figma')
        .executeTakeFirstOrThrow()
    ).id;
    // The seed schedules reminders for every row; these tests want exactly one due.
    await admin
      .updateTable('subscriptions')
      .set({ next_reminder_at: null })
      .where('id', '!=', figmaId)
      .execute();
  });

  afterAll(async () => {
    await db?.destroy();
    await admin?.destroy();
  });

  /** Make one subscription due now: renews in 7 days, reminder at 7 days, instant in the past. */
  async function makeDue(id: string): Promise<{ renewsOn: string; now: Date }> {
    const renewsOn = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    await admin
      .updateTable('subscriptions')
      .set({
        renews_on: renewsOn,
        reminder_offsets: [7],
        next_reminder_at: new Date(Date.now() - 60_000),
      })
      .where('id', '=', id)
      .execute();
    // "now" is late enough in the day that 09:00 in any timezone has passed.
    const now = new Date(`${renewsOn}T00:00:00Z`);
    now.setUTCDate(now.getUTCDate() - 7);
    now.setUTCHours(23, 0, 0, 0);
    return { renewsOn, now };
  }

  it('sends a due reminder once, logs it, and does not send again', async () => {
    const { renewsOn, now } = await makeDue(figmaId);
    const sender = new MemorySender();

    const first = await runOnce(db, sender, now);
    expect(first.sent).toBe(1);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]!.to).toBe('owner@acme.test');
    expect(sender.sent[0]!.subject).toContain('Figma renews in 7 days for €15.00');

    const log = await admin
      .selectFrom('reminder_log')
      .selectAll()
      .where('subscription_id', '=', figmaId)
      .execute();
    expect(log).toHaveLength(1);
    expect(log[0]!.renewal_date).toBe(renewsOn);
    expect(log[0]!.offset_days).toBe(7);

    const after = await admin
      .selectFrom('subscriptions')
      .select('next_reminder_at')
      .where('id', '=', figmaId)
      .executeTakeFirstOrThrow();
    expect(after.next_reminder_at).toBeNull(); // the only offset has been sent

    const second = await runOnce(db, sender, now);
    expect(second.sent).toBe(0);
    expect(sender.sent).toHaveLength(1);
  });

  it('two workers running at the same time send each reminder once', async () => {
    const { now } = await makeDue(figmaId);
    const a = new MemorySender();
    const b = new MemorySender();

    const [ra, rb] = await Promise.all([runOnce(db, a, now), runOnce(db, b, now)]);
    expect(ra.sent + rb.sent).toBe(1);
    expect(a.sent.length + b.sent.length).toBe(1);
  });

  it('rolls back the log row when sending fails, so the reminder is retried', async () => {
    const { now } = await makeDue(figmaId);
    const failing = new FailingSender();

    const failed = await runOnce(db, failing, now);
    expect(failed.failed).toBe(1);
    expect(failing.attempts).toBe(1);

    const log = await admin
      .selectFrom('reminder_log')
      .select('id')
      .where('subscription_id', '=', figmaId)
      .execute();
    expect(log).toHaveLength(0);
    const row = await admin
      .selectFrom('subscriptions')
      .select('next_reminder_at')
      .where('id', '=', figmaId)
      .executeTakeFirstOrThrow();
    expect(row.next_reminder_at).not.toBeNull();

    const sender = new MemorySender();
    const retried = await runOnce(db, sender, now);
    expect(retried.sent).toBe(1);
  });

  it('a reminder that was already logged by hand is skipped, not re-sent', async () => {
    const { renewsOn, now } = await makeDue(figmaId);
    const org = await admin
      .selectFrom('subscriptions')
      .select('org_id')
      .where('id', '=', figmaId)
      .executeTakeFirstOrThrow();
    await admin
      .insertInto('reminder_log')
      .values({
        org_id: org.org_id,
        subscription_id: figmaId,
        renewal_date: renewsOn,
        offset_days: 7,
      })
      .execute();

    const sender = new MemorySender();
    const result = await runOnce(db, sender, now);
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(sender.sent).toHaveLength(0);
  });

  it('renews an auto-renewing subscription whose date has passed and records the event', async () => {
    // Postmark in the seed renewed three days ago (monthly, auto-renew).
    const before = await admin
      .selectFrom('subscriptions')
      .select(['id', 'renews_on'])
      .where('vendor', '=', 'Postmark')
      .executeTakeFirstOrThrow();

    const result = await runOnce(db, new MemorySender(), new Date());
    expect(result.renewed).toBeGreaterThanOrEqual(1);

    const after = await admin
      .selectFrom('subscriptions')
      .select(['renews_on', 'status', 'next_reminder_at'])
      .where('id', '=', before.id)
      .executeTakeFirstOrThrow();
    expect(after.renews_on > before.renews_on).toBe(true);
    expect(after.status).toBe('active');
    expect(after.next_reminder_at).not.toBeNull();

    const events = await admin
      .selectFrom('renewal_events')
      .select(['decision', 'renewal_date'])
      .where('subscription_id', '=', before.id)
      .execute();
    expect(events).toContainEqual({ decision: 'renewed', renewal_date: before.renews_on });
  });

  it('moves a cancelling subscription to cancelled once its date passes', async () => {
    const linear = await admin
      .selectFrom('subscriptions')
      .select('id')
      .where('vendor', '=', 'Linear')
      .executeTakeFirstOrThrow();
    await admin
      .updateTable('subscriptions')
      .set({ renews_on: '2026-01-01' })
      .where('id', '=', linear.id)
      .execute();

    const result = await runOnce(db, new MemorySender(), new Date());
    expect(result.cancelled).toBeGreaterThanOrEqual(1);

    const after = await admin
      .selectFrom('subscriptions')
      .select(['status', 'next_reminder_at'])
      .where('id', '=', linear.id)
      .executeTakeFirstOrThrow();
    expect(after.status).toBe('cancelled');
    expect(after.next_reminder_at).toBeNull();
  });
});
