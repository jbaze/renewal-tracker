-- The reminder worker has to see every organisation's due subscriptions in
-- one query. It connects as its own role and that role may bypass row-level
-- security. It is the only cross-tenant code path; see docs/adr/003.
ALTER ROLE worker BYPASSRLS;
