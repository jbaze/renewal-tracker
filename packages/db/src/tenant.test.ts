/**
 * Tenant isolation, tested the way an attacker would: as the app role, with
 * hand-written queries that have no WHERE clause.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, createPool, type Db } from './client.js';
import { migrateUp } from './migrate.js';
import { seed } from './seed.js';
import { listMemberships, resolveUserIdByEmail, withTenant } from './tenant.js';

const adminUrl = process.env.DATABASE_URL;
const appUrl = process.env.APP_DATABASE_URL;

describe.skipIf(!adminUrl || !appUrl)('row-level security', () => {
  let admin: Db;
  let app: Db;
  let orgA: string;
  let orgB: string;
  let ownerA: string;
  let ownerB: string;
  let subscriptionB: string;

  beforeAll(async () => {
    await migrateUp(adminUrl!);
    admin = createDb(createPool(adminUrl!, 1));
    app = createDb(createPool(appUrl!, 2));
    await seed(admin);

    const orgs = await admin
      .selectFrom('organizations')
      .select(['id', 'name'])
      .orderBy('name')
      .execute();
    orgA = orgs[0]!.id;
    orgB = orgs[1]!.id;
    ownerA = (await resolveUserIdByEmail(app, 'owner@acme.test'))!;
    ownerB = (await resolveUserIdByEmail(app, 'owner@northwind.test'))!;
    subscriptionB = (
      await admin
        .selectFrom('subscriptions')
        .select('id')
        .where('org_id', '=', orgB)
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await app?.destroy();
    await admin?.destroy();
  });

  it('a query with no WHERE clause returns only the current organisation', async () => {
    const rows = await withTenant(app, { userId: ownerA, orgId: orgA }, (trx) =>
      sql<{ org_id: string }>`SELECT org_id FROM subscriptions`.execute(trx).then((r) => r.rows),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.org_id))).toEqual(new Set([orgA]));
  });

  it('with no identity set, the app role sees nothing', async () => {
    const rows = await sql<{ n: string }>`SELECT count(*) AS n FROM subscriptions`
      .execute(app)
      .then((r) => r.rows);
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it('organisation A cannot read or update organisation B, even by primary key', async () => {
    await withTenant(app, { userId: ownerA, orgId: orgA }, async (trx) => {
      const read = await trx
        .selectFrom('subscriptions')
        .select('id')
        .where('id', '=', subscriptionB)
        .executeTakeFirst();
      expect(read).toBeUndefined();

      const updated = await trx
        .updateTable('subscriptions')
        .set({ vendor: 'hijacked' })
        .where('id', '=', subscriptionB)
        .executeTakeFirst();
      expect(Number(updated.numUpdatedRows)).toBe(0);
    });

    const untouched = await admin
      .selectFrom('subscriptions')
      .select('vendor')
      .where('id', '=', subscriptionB)
      .executeTakeFirstOrThrow();
    expect(untouched.vendor).not.toBe('hijacked');
  });

  it('inserting a row for another organisation is rejected', async () => {
    await expect(
      withTenant(app, { userId: ownerA, orgId: orgA }, (trx) =>
        trx
          .insertInto('subscriptions')
          .values({
            org_id: orgB,
            vendor: 'Smuggled',
            cost_cents: 100,
            currency: 'EUR',
            billing_cycle: 'monthly',
            started_on: '2026-01-01',
            renews_on: '2026-02-01',
            owner_user_id: null,
          })
          .execute(),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('the identity does not leak between transactions on the same pool', async () => {
    const a = await withTenant(app, { userId: ownerA, orgId: orgA }, (trx) =>
      trx.selectFrom('subscriptions').select('org_id').execute(),
    );
    const b = await withTenant(app, { userId: ownerB, orgId: orgB }, (trx) =>
      trx.selectFrom('subscriptions').select('org_id').execute(),
    );
    expect(a.every((r) => r.org_id === orgA)).toBe(true);
    expect(b.every((r) => r.org_id === orgB)).toBe(true);
    expect(b.length).toBeGreaterThan(0);
  });

  it('a user sees only their own memberships and organisations', async () => {
    const memberships = await withTenant(app, { userId: ownerA, orgId: null }, listMemberships);
    expect(memberships.map((m) => m.orgName)).toEqual(['Acme Studio']);

    // Mia Member belongs to both organisations.
    const mia = (await resolveUserIdByEmail(app, 'member@acme.test'))!;
    const both = await withTenant(app, { userId: mia, orgId: null }, listMemberships);
    expect(both.map((m) => m.orgName)).toEqual(['Acme Studio', 'Northwind Labs']);
    expect(both.map((m) => m.role)).toEqual(['member', 'member']);
  });

  it('an unknown email resolves to nothing', async () => {
    expect(await resolveUserIdByEmail(app, 'nobody@example.test')).toBeNull();
  });
});
