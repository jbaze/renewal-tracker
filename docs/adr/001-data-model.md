# ADR-001: Data model

Status: accepted. Date: 2026-11-06.

## Context

The service tracks software subscriptions for more than one organisation and sends reminders before each renewal. The schema has to make three things hard to get wrong: mixing up tenants, mishandling money, and sending the same reminder twice.

## Decision

**Every tenant table carries `org_id`.** `subscriptions`, `renewal_events` and `reminder_log` all have an `org_id` column, even where it could be derived through a join. Row-level security (ADR-002) keys on that column, and a policy that needs a join is slower and easier to get wrong than one that compares a column to a setting.

**Money is integer cents plus an ISO 4217 code.** `cost_cents integer` and `currency char(3)`, with a check that the code is three upper-case letters. Floats never appear near an amount, and totals are per currency: the application never adds EUR to USD. The `@renewal/domain` package has the only code that turns cents into text.

**Enums for closed sets.** `membership_role`, `billing_cycle`, `subscription_status` and `renewal_decision` are Postgres enums. They read well in `psql`, and adding a value is one `ALTER TYPE` in a migration.

**Dates are dates.** `started_on` and `renews_on` are `date` columns, not timestamps. A renewal happens on a calendar day in the organisation's timezone; the reminder time is computed from the date, the offset and `organizations.timezone`, and stored as a `timestamptz` in `next_reminder_at`.

**`reminder_log` has a unique key on `(subscription_id, renewal_date, offset_days)`.** The worker inserts the log row before it sends anything. A second attempt for the same reminder is a constraint violation, so a duplicate send is impossible rather than merely unlikely. ADR-003 covers the worker.

**A partial index for the worker.** The worker only ever asks "what is due now?", so `subscriptions_due_idx` covers `next_reminder_at` for rows whose status can still get reminders. It stays small no matter how many cancelled subscriptions accumulate.

**Plain SQL migrations with a small runner.** Each migration is an `.up.sql` and a `.down.sql` file, applied in a transaction and recorded in `schema_migrations`. A reader can see the whole schema without learning a migration DSL, and CI runs every migration up, down and up again.

**A personal user is an organisation of one.** There is no separate personal mode; the same policies apply.

## Consequences

- Queries always filter by `org_id`, and RLS enforces it even when they do not.
- Reports that sum costs have to group by currency. The UI shows one total per currency.
- Renewal history lives in `renewal_events`, so a subscription row only holds its current state.
- Roles `app` and `worker` must exist before the first migration runs; `docker/postgres/init/001_roles.sql` and the CI workflow create them.
- Schema changes are hand-written SQL plus a matching edit to `packages/db/src/schema.ts`. There is no generator to keep them in sync, so the test suite is what catches drift.
