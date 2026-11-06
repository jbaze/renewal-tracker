# ADR-002: Row-level security for tenant isolation

Status: accepted. Date: 2026-11-06.

## Context

Every organisation's subscriptions live in the same tables. The usual way to keep them apart is a `WHERE org_id = ?` in every query. That works until one query forgets it, and the query that forgets it is never the one that gets reviewed. The job post this repository answers lists tenant isolation as a concern, so the choice deserves a written reason.

## Decision

**Postgres row-level security on every tenant table.** Migration 0002 enables and forces RLS on `subscriptions`, `renewal_events`, `reminder_log`, `memberships`, `organizations` and `users`, with policies that compare each row to two transaction-local settings, `app.user_id` and `app.org_id`.

**The API connects as a role that cannot bypass it.** The `app` role is created by `docker/postgres/init/001_roles.sql` (and by CI). It does not own the tables and has no `BYPASSRLS`, so `FORCE ROW LEVEL SECURITY` applies to it. With no identity set, the role sees zero rows.

**One transaction per request carries the identity.** The `tenant` plugin in `apps/api` resolves the user, opens a transaction, runs `set_config('app.user_id', ..., true)` and `set_config('app.org_id', ..., true)`, and hands that transaction to the route. The third argument makes the settings local to the transaction, so a pooled connection carries nothing over to the next request. Commit on success, rollback on error.

**Write policies use `WITH CHECK`.** Inserting or updating a row into another organisation fails with a policy violation, not a silent no-op.

**The dev login is the one exception, and it is explicit.** Before a user is known, the API needs to turn the login email into a user id while `users` is protected. `resolve_user_id(email)` is a `SECURITY DEFINER` function that does exactly that and nothing else, with `EXECUTE` granted only to `app`. A production deployment gets the user id from the identity provider's token and drops the function.

**The worker is the other exception.** It has to see every organisation's due reminders. It connects as a separate role with `BYPASSRLS`, covered in ADR-003, and it is the only cross-tenant code path.

## Alternatives considered

- **A `WHERE` clause in every query, enforced by review.** Cheaper to set up, no safety net. One missed clause leaks data.
- **A schema per tenant.** Strong isolation, but migrations and connection handling get complicated well before it pays off, and reporting across tenants becomes hard.
- **A database per tenant.** Same trade-off, more so.
- **Application-level query builder wrapper that injects `org_id`.** Helps the common path but can be bypassed by raw SQL, which the tests here deliberately use.

## Consequences

- Every tenant query runs inside `withTenant` or the request transaction. Code that uses the pool directly sees no rows, which is the safe failure.
- Tests in `packages/db/src/tenant.test.ts` run as the `app` role and try hand-written queries with no `WHERE` clause, a primary-key read and update across organisations, and an insert for another organisation. All of them are stopped by the database, not by application code.
- Policies with subqueries (`organizations`, `users`) cost a little on every read. For this data volume that is nothing; for a large deployment they would be rewritten against a membership cache.
- Long-running transactions per request are acceptable here because requests are short. A streaming or batch endpoint would need its own handling.
