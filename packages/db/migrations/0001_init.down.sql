REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app, worker;
REVOKE USAGE ON SCHEMA public FROM app, worker;

DROP TABLE IF EXISTS reminder_log;
DROP TABLE IF EXISTS renewal_events;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS organizations;

DROP FUNCTION IF EXISTS set_updated_at();

DROP TYPE IF EXISTS renewal_decision;
DROP TYPE IF EXISTS subscription_status;
DROP TYPE IF EXISTS billing_cycle;
DROP TYPE IF EXISTS membership_role;
