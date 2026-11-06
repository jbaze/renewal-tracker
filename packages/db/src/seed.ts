/**
 * Development seed: two organisations with members and a spread of
 * subscriptions, so the API, worker and web app have something to show.
 * Idempotent: it wipes the tenant tables first. Never run it against anything
 * but a local database.
 *
 *   pnpm db:seed
 */
import { nextReminderAt } from '@renewal/domain';
import { sql } from 'kysely';

import { createDb, createPool, type Db } from './client.js';
import type { BillingCycle, MembershipRole, SubscriptionStatus } from './schema.js';

type SeedSubscription = {
  vendor: string;
  plan: string;
  cost_cents: number;
  currency: string;
  billing_cycle: BillingCycle;
  started_on: string;
  renews_on: string;
  status?: SubscriptionStatus;
  auto_renew?: boolean;
};

const today = new Date();

/** YYYY-MM-DD for today plus a number of days, in UTC. */
function inDays(days: number): string {
  const d = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days),
  );
  return d.toISOString().slice(0, 10);
}

export const SEED_ORGANIZATIONS = [
  {
    name: 'Acme Studio',
    timezone: 'Europe/Berlin',
    members: [
      { email: 'owner@acme.test', name: 'Olivia Owner', role: 'owner' as MembershipRole },
      { email: 'admin@acme.test', name: 'Adam Admin', role: 'admin' as MembershipRole },
      { email: 'member@acme.test', name: 'Mia Member', role: 'member' as MembershipRole },
    ],
    subscriptions: [
      {
        vendor: 'Figma',
        plan: 'Professional',
        cost_cents: 1500,
        currency: 'EUR',
        billing_cycle: 'monthly',
        started_on: '2025-01-31',
        renews_on: inDays(6),
      },
      {
        vendor: 'GitHub',
        plan: 'Team',
        cost_cents: 400,
        currency: 'USD',
        billing_cycle: 'monthly',
        started_on: '2024-11-15',
        renews_on: inDays(25),
      },
      {
        vendor: 'Notion',
        plan: 'Plus',
        cost_cents: 9600,
        currency: 'USD',
        billing_cycle: 'yearly',
        started_on: '2025-02-28',
        renews_on: inDays(80),
      },
      {
        vendor: 'Slack',
        plan: 'Pro',
        cost_cents: 725,
        currency: 'EUR',
        billing_cycle: 'monthly',
        started_on: '2025-06-01',
        renews_on: inDays(1),
      },
      {
        vendor: 'Linear',
        plan: 'Standard',
        cost_cents: 800,
        currency: 'USD',
        billing_cycle: 'monthly',
        started_on: '2025-09-10',
        renews_on: inDays(12),
        status: 'cancelling',
        auto_renew: false,
      },
    ] as SeedSubscription[],
  },
  {
    name: 'Northwind Labs',
    timezone: 'America/Toronto',
    members: [
      { email: 'owner@northwind.test', name: 'Nora Northwind', role: 'owner' as MembershipRole },
      { email: 'member@acme.test', name: 'Mia Member', role: 'member' as MembershipRole },
    ],
    subscriptions: [
      {
        vendor: 'Vercel',
        plan: 'Pro',
        cost_cents: 2000,
        currency: 'USD',
        billing_cycle: 'monthly',
        started_on: '2025-03-31',
        renews_on: inDays(30),
      },
      {
        vendor: 'Postmark',
        plan: '10k emails',
        cost_cents: 1500,
        currency: 'USD',
        billing_cycle: 'monthly',
        started_on: '2025-07-01',
        renews_on: inDays(-3),
      },
      {
        vendor: 'JetBrains',
        plan: 'All Products Pack',
        cost_cents: 77900,
        currency: 'EUR',
        billing_cycle: 'yearly',
        started_on: '2025-01-15',
        renews_on: inDays(55),
      },
      {
        vendor: '1Password',
        plan: 'Teams',
        cost_cents: 1995,
        currency: 'USD',
        billing_cycle: 'monthly',
        started_on: '2024-05-20',
        renews_on: inDays(45),
        status: 'cancelled',
        auto_renew: false,
      },
    ] as SeedSubscription[],
  },
];

export async function seed(db: Db): Promise<{ organizations: number; subscriptions: number }> {
  await sql`TRUNCATE reminder_log, renewal_events, subscriptions, memberships, users, organizations CASCADE`.execute(
    db,
  );

  let subscriptions = 0;
  for (const org of SEED_ORGANIZATIONS) {
    const { id: orgId } = await db
      .insertInto('organizations')
      .values({ name: org.name, timezone: org.timezone })
      .returning('id')
      .executeTakeFirstOrThrow();

    const ownerIds: string[] = [];
    for (const member of org.members) {
      const user = await db
        .insertInto('users')
        .values({ email: member.email, name: member.name })
        .onConflict((oc) => oc.column('email').doUpdateSet({ name: member.name }))
        .returning('id')
        .executeTakeFirstOrThrow();
      await db
        .insertInto('memberships')
        .values({ org_id: orgId, user_id: user.id, role: member.role })
        .execute();
      if (member.role === 'owner') ownerIds.push(user.id);
    }

    for (const s of org.subscriptions) {
      const status = s.status ?? 'active';
      const inserted = await db
        .insertInto('subscriptions')
        .values({
          org_id: orgId,
          vendor: s.vendor,
          plan: s.plan,
          cost_cents: s.cost_cents,
          currency: s.currency,
          billing_cycle: s.billing_cycle,
          started_on: s.started_on,
          renews_on: s.renews_on,
          status,
          auto_renew: s.auto_renew ?? true,
          owner_user_id: ownerIds[0] ?? null,
          next_reminder_at: nextReminderAt(
            {
              billingCycle: s.billing_cycle,
              startedOn: s.started_on,
              renewsOn: s.renews_on,
              status,
              reminderOffsets: [30, 7, 1],
              timezone: org.timezone,
            },
            today,
          ),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      subscriptions += 1;

      // One past renewal per yearly subscription, so the history table is not empty.
      if (s.billing_cycle === 'yearly') {
        await db
          .insertInto('renewal_events')
          .values({
            org_id: orgId,
            subscription_id: inserted.id,
            renewal_date: s.started_on,
            amount_cents: s.cost_cents,
            currency: s.currency,
            decision: 'renewed',
          })
          .execute();
      }
    }
  }
  return { organizations: SEED_ORGANIZATIONS.length, subscriptions };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === new URL(process.argv[1], 'file:').href;

if (invokedDirectly) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const pool = createPool(url, 1);
  const db = createDb(pool);
  seed(db)
    .then((r) =>
      console.log(`seeded ${r.organizations} organisations, ${r.subscriptions} subscriptions`),
    )
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => db.destroy());
}
