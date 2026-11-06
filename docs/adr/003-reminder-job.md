# ADR-003: The reminder job

Status: accepted. Date: 2026-11-06.

## Context

Reminders have to go out once, on time, for every organisation, and the job that sends them will at some point be restarted mid-run, run twice by mistake, or run on two instances at once. The design has to make all of that boring.

## Decision

**A worker process in the same codebase, no queue service.** `apps/worker` is a loop that wakes up every `WORKER_INTERVAL_SECONDS`, runs one pass, and sleeps. Postgres is the queue. For a reminder that is due "today at 09:00", a minute of latency is nothing, and a queue would be one more thing to run and explain.

**`next_reminder_at` is stored, not computed at query time.** When a subscription is saved, the API computes the next reminder instant from the renewal date, the offsets and the organisation's timezone (`nextReminderAt` in `@renewal/domain`) and stores it. The worker's query is then an index lookup on a partial index, not a calculation over every row.

**Claim with `FOR UPDATE SKIP LOCKED`.** The pass selects due rows ordered by `next_reminder_at`, limited to a batch, locking what it takes and skipping what another worker already holds. Two workers never process the same row at the same time, and neither waits for the other.

**Log first, then send, in one transaction per row.** `reminder_log` has a unique key on `(subscription_id, renewal_date, offset_days)`. The worker inserts that row with `ON CONFLICT DO NOTHING` before it sends. No row back means the reminder was already sent by someone, and the email is skipped. If sending throws, the transaction rolls back, the log row disappears, `next_reminder_at` is untouched, and the next pass retries. A duplicate send needs the same key to insert twice, which the database refuses.

**One row per transaction after the claim.** The claim is one short transaction; each row then gets its own, so one failing email does not hold locks on the rest of the batch.

**Renewals roll in the same pass.** Before sending, the worker looks at subscriptions whose renewal date has passed. An auto-renewing one moves to the next anchored date (`afterRenewalDate`) and gets a `renewal_events` row; a cancelling one, or one that does not auto-renew, becomes `cancelled`. "Today" is the organisation's calendar date, not the server's.

**The worker bypasses row-level security, and that is written down here.** It connects as the `worker` role, which migration 0003 gives `BYPASSRLS`. It is the one place that reads across tenants. It never takes input from a request, its queries are fixed, and its tests run as that role so the privilege is exercised rather than assumed. The API role cannot do this.

**Email goes through an adapter.** The worker knows an `EmailSender` interface. Locally that is the console; with `EMAIL_TRANSPORT=smtp` it is Mailpit from docker compose; tests use an in-memory sender and a failing one.

## Consequences

- Running the job twice, or on two workers, sends each reminder once. The tests in `apps/worker/src/reminders.test.ts` do exactly that.
- A worker outage is caught up on restart: overdue reminders are sent (the most recent one per subscription, not every missed offset), and past renewal dates roll forward to the first date on or after today.
- The reminder hour is fixed at 09:00 local. A per-organisation hour is a column and a parameter.
- With a very large number of tenants the single worker becomes the bottleneck; the claim query already supports many workers, so that is a deployment change, not a code change.
- The worker's cross-tenant access is the privilege to protect in a real deployment: a separate credential, no network exposure, and audit logging on that role.
