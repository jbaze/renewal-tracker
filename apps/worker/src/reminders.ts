/**
 * The reminder job. Two passes, each safe to run twice and safe to run on
 * two workers at once:
 *
 * 1. sendDueReminders: claim subscriptions whose next_reminder_at has passed
 *    (FOR UPDATE SKIP LOCKED), write the reminder_log row, send the email,
 *    set the next reminder. The unique key on reminder_log makes a second
 *    send for the same reminder impossible; the row is inserted before the
 *    email goes out and the transaction rolls back if sending fails.
 *
 * 2. rollRenewals: subscriptions whose renewal date has passed either renew
 *    to the next anchored date or become cancelled, with a renewal_events row.
 *
 * The worker connects as a role that bypasses row-level security, so these
 * queries see every organisation. See docs/adr/003-reminder-job.md.
 */
import type { Db, Subscription } from '@renewal/db';
import {
  afterRenewalDate,
  dateInTimeZone,
  formatMoney,
  money,
  nextReminderAt,
  reminderSchedule,
  wantsReminders,
} from '@renewal/domain';
import { sql, type Transaction } from 'kysely';
import type { Database } from '@renewal/db';

import type { EmailSender } from './email.js';

export type RunSummary = {
  sent: number;
  skipped: number;
  failed: number;
  renewed: number;
  cancelled: number;
};

type DueRow = Subscription & { org_name: string; timezone: string; owner_email: string | null };

const BATCH = 100;

export async function runOnce(db: Db, sender: EmailSender, now = new Date()): Promise<RunSummary> {
  const summary: RunSummary = { sent: 0, skipped: 0, failed: 0, renewed: 0, cancelled: 0 };
  await rollRenewals(db, now, summary);
  await sendDueReminders(db, sender, now, summary);
  return summary;
}

async function claimDue(trx: Transaction<Database>, now: Date): Promise<DueRow[]> {
  // Owner email comes from a correlated subquery so the lock applies to the
  // subscriptions rows only.
  return trx
    .selectFrom('subscriptions')
    .innerJoin('organizations', 'organizations.id', 'subscriptions.org_id')
    .selectAll('subscriptions')
    .select([
      'organizations.name as org_name',
      'organizations.timezone',
      sql<string | null>`(SELECT email FROM users WHERE users.id = subscriptions.owner_user_id)`.as(
        'owner_email',
      ),
    ])
    .where('subscriptions.next_reminder_at', '<=', now)
    .where('subscriptions.status', 'in', ['trial', 'active', 'cancelling'])
    .orderBy('subscriptions.next_reminder_at')
    .limit(BATCH)
    .forUpdate('subscriptions')
    .skipLocked()
    .execute();
}

async function sendDueReminders(
  db: Db,
  sender: EmailSender,
  now: Date,
  summary: RunSummary,
): Promise<void> {
  // Claim in one short transaction, then handle each row in its own, so one
  // failing email does not hold the whole batch.
  const ids = await db
    .transaction()
    .execute(async (trx) => (await claimDue(trx, now)).map((r) => r.id));

  for (const id of ids) {
    try {
      const outcome = await db.transaction().execute(async (trx) => {
        const [row] = await trx
          .selectFrom('subscriptions')
          .innerJoin('organizations', 'organizations.id', 'subscriptions.org_id')
          .selectAll('subscriptions')
          .select([
            'organizations.name as org_name',
            'organizations.timezone',
            sql<
              string | null
            >`(SELECT email FROM users WHERE users.id = subscriptions.owner_user_id)`.as(
              'owner_email',
            ),
          ])
          .where('subscriptions.id', '=', id)
          .where('subscriptions.next_reminder_at', '<=', now)
          .forUpdate('subscriptions')
          .skipLocked()
          .execute();
        if (!row) return 'skipped' as const; // another worker got it first

        const due = dueReminder(row, now);
        if (!due) {
          await setNextReminder(trx, row, now);
          return 'skipped' as const;
        }

        const logged = await trx
          .insertInto('reminder_log')
          .values({
            org_id: row.org_id,
            subscription_id: row.id,
            renewal_date: row.renews_on,
            offset_days: due.offsetDays,
          })
          .onConflict((oc) =>
            oc.columns(['subscription_id', 'renewal_date', 'offset_days']).doNothing(),
          )
          .returning('id')
          .executeTakeFirst();

        if (logged) {
          await sender.send(reminderEmail(row, due.offsetDays));
        }
        await setNextReminder(trx, row, now);
        return logged ? ('sent' as const) : ('skipped' as const);
      });
      summary[outcome] += 1;
    } catch (err) {
      summary.failed += 1;
      console.error(
        `reminder for subscription ${id} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/** The reminder that is due now: the smallest offset whose instant has passed. */
function dueReminder(row: DueRow, now: Date) {
  if (!wantsReminders(row.status)) return null;
  const passed = reminderSchedule(row.renews_on, row.reminder_offsets, row.timezone).filter(
    (r) => r.at.getTime() <= now.getTime(),
  );
  return passed.at(-1) ?? null;
}

async function setNextReminder(trx: Transaction<Database>, row: DueRow, now: Date): Promise<void> {
  const next = nextReminderAt(
    {
      billingCycle: row.billing_cycle,
      startedOn: row.started_on,
      renewsOn: row.renews_on,
      status: row.status,
      reminderOffsets: row.reminder_offsets,
      timezone: row.timezone,
    },
    now,
  );
  await trx
    .updateTable('subscriptions')
    .set({ next_reminder_at: next })
    .where('id', '=', row.id)
    .execute();
}

export function reminderEmail(row: DueRow, offsetDays: number) {
  const amount = formatMoney(money(row.cost_cents, row.currency));
  const when = offsetDays === 0 ? 'today' : offsetDays === 1 ? 'tomorrow' : `in ${offsetDays} days`;
  const plan = row.plan ? ` (${row.plan})` : '';
  return {
    to: row.owner_email ?? `owners@${row.org_name.toLowerCase().replace(/\s+/g, '-')}.invalid`,
    subject: `${row.vendor} renews ${when} for ${amount}`,
    text: [
      `${row.vendor}${plan} renews on ${row.renews_on} for ${amount} (${row.billing_cycle}).`,
      row.status === 'cancelling'
        ? 'This subscription is set to end on that date and will not renew.'
        : row.auto_renew
          ? 'It will renew automatically unless you cancel it before then.'
          : 'It will not renew automatically.',
      '',
      `Organisation: ${row.org_name}`,
    ].join('\n'),
  };
}

async function rollRenewals(db: Db, now: Date, summary: RunSummary): Promise<void> {
  // The calendar date differs per organisation timezone, so take every row
  // whose date is before tomorrow in UTC and let the domain decide per row.
  const latestToday = dateInTimeZone(new Date(now.getTime() + 24 * 60 * 60 * 1000), 'UTC');
  const ids = await db
    .transaction()
    .execute(async (trx) =>
      (
        await trx
          .selectFrom('subscriptions')
          .select('id')
          .where('renews_on', '<', latestToday)
          .where('status', 'in', ['trial', 'active', 'cancelling'])
          .limit(BATCH)
          .forUpdate()
          .skipLocked()
          .execute()
      ).map((r) => r.id),
    );

  for (const id of ids) {
    await db.transaction().execute(async (trx) => {
      const [row] = await trx
        .selectFrom('subscriptions')
        .innerJoin('organizations', 'organizations.id', 'subscriptions.org_id')
        .selectAll('subscriptions')
        .select('organizations.timezone')
        .where('subscriptions.id', '=', id)
        .forUpdate('subscriptions')
        .skipLocked()
        .execute();
      if (!row) return;

      const today = dateInTimeZone(now, row.timezone);
      const outcome = afterRenewalDate(
        {
          billingCycle: row.billing_cycle,
          startedOn: row.started_on,
          renewsOn: row.renews_on,
          status: row.status,
          reminderOffsets: row.reminder_offsets,
          timezone: row.timezone,
          autoRenew: row.auto_renew,
        },
        today,
      );
      if (outcome.kind === 'unchanged') return;

      await trx
        .insertInto('renewal_events')
        .values({
          org_id: row.org_id,
          subscription_id: row.id,
          renewal_date: row.renews_on,
          amount_cents: row.cost_cents,
          currency: row.currency,
          decision: outcome.kind,
        })
        .execute();

      if (outcome.kind === 'renewed') {
        const next = nextReminderAt(
          {
            billingCycle: row.billing_cycle,
            startedOn: row.started_on,
            renewsOn: outcome.renewsOn,
            status: row.status,
            reminderOffsets: row.reminder_offsets,
            timezone: row.timezone,
          },
          now,
        );
        await trx
          .updateTable('subscriptions')
          .set({ renews_on: outcome.renewsOn, next_reminder_at: next })
          .where('id', '=', row.id)
          .execute();
        summary.renewed += 1;
      } else {
        await trx
          .updateTable('subscriptions')
          .set({ status: 'cancelled', next_reminder_at: null })
          .where('id', '=', row.id)
          .execute();
        summary.cancelled += 1;
      }
    });
  }
}
