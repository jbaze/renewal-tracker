/**
 * Everything the API does for a tenant happens inside one transaction that
 * carries the user and organisation as transaction-local settings. The RLS
 * policies in migration 0002 read those settings, so a query that forgets its
 * WHERE clause still sees one organisation.
 */
import { sql, type Transaction } from 'kysely';

import type { Db } from './client.js';
import type { Database, MembershipRole } from './schema.js';

export type TenantIdentity = {
  readonly userId: string;
  readonly orgId: string | null;
};

export type TenantTrx = Transaction<Database>;

/** Apply the identity to the current transaction. Settings are local to it. */
export async function applyIdentity(trx: TenantTrx, identity: TenantIdentity): Promise<void> {
  await sql`SELECT set_config('app.user_id', ${identity.userId}, true),
                   set_config('app.org_id', ${identity.orgId ?? ''}, true)`.execute(trx);
}

/** Run fn inside a transaction scoped to one user and organisation. */
export async function withTenant<T>(
  db: Db,
  identity: TenantIdentity,
  fn: (trx: TenantTrx) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await applyIdentity(trx, identity);
    return fn(trx);
  });
}

/**
 * The dev-login lookup. Runs through a SECURITY DEFINER function because no
 * user is known yet and the users table is protected. Returns null when the
 * email is unknown.
 */
export async function resolveUserIdByEmail(db: Db, email: string): Promise<string | null> {
  const row = await sql<{ id: string | null }>`SELECT resolve_user_id(${email}) AS id`
    .execute(db)
    .then((r) => r.rows[0]);
  return row?.id ?? null;
}

export type MembershipSummary = {
  orgId: string;
  orgName: string;
  timezone: string;
  role: MembershipRole;
};

/** The organisations the current user belongs to. Needs app.user_id set. */
export async function listMemberships(trx: TenantTrx): Promise<MembershipSummary[]> {
  const rows = await trx
    .selectFrom('memberships')
    .innerJoin('organizations', 'organizations.id', 'memberships.org_id')
    .select([
      'memberships.org_id as orgId',
      'organizations.name as orgName',
      'organizations.timezone',
      'memberships.role',
    ])
    .where('memberships.user_id', '=', sql<string>`current_user_id()`)
    .orderBy('organizations.name')
    .execute();
  return rows;
}
