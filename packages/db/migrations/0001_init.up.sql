-- Core schema. Every tenant table carries org_id so row-level security can
-- key on it (added in migration 0002). Money is integer cents plus an ISO
-- 4217 code; there are no floats anywhere near an amount.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'worker') THEN
    RAISE EXCEPTION 'roles app and worker must exist first; see docker/postgres/init/001_roles.sql';
  END IF;
END $$;

CREATE TYPE membership_role AS ENUM ('owner', 'admin', 'member');
CREATE TYPE billing_cycle AS ENUM ('monthly', 'yearly');
CREATE TYPE subscription_status AS ENUM ('trial', 'active', 'cancelling', 'cancelled');
CREATE TYPE renewal_decision AS ENUM ('renewed', 'cancelled', 'reviewed');

CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  timezone   text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL UNIQUE CHECK (email = lower(email)),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  org_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       membership_role NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE subscriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  vendor           text NOT NULL CHECK (length(vendor) BETWEEN 1 AND 120),
  plan             text NOT NULL DEFAULT '',
  cost_cents       integer NOT NULL CHECK (cost_cents >= 0),
  currency         char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  billing_cycle    billing_cycle NOT NULL,
  started_on       date NOT NULL,
  renews_on        date NOT NULL,
  auto_renew       boolean NOT NULL DEFAULT true,
  status           subscription_status NOT NULL DEFAULT 'active',
  owner_user_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  reminder_offsets integer[] NOT NULL DEFAULT '{30,7,1}'
                   CHECK (cardinality(reminder_offsets) >= 1 AND 0 <= ALL (reminder_offsets)),
  next_reminder_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_org_renews_idx ON subscriptions (org_id, renews_on);
-- The worker only ever asks "what is due now?", so index exactly that.
CREATE INDEX subscriptions_due_idx ON subscriptions (next_reminder_at)
  WHERE status IN ('trial', 'active', 'cancelling') AND next_reminder_at IS NOT NULL;
CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE renewal_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES subscriptions (id) ON DELETE CASCADE,
  renewal_date    date NOT NULL,
  amount_cents    integer NOT NULL CHECK (amount_cents >= 0),
  currency        char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  decision        renewal_decision NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX renewal_events_sub_idx ON renewal_events (subscription_id, renewal_date);

CREATE TABLE reminder_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES subscriptions (id) ON DELETE CASCADE,
  renewal_date    date NOT NULL,
  offset_days     integer NOT NULL CHECK (offset_days >= 0),
  sent_at         timestamptz NOT NULL DEFAULT now(),
  -- One reminder per subscription, renewal date and offset. A second send
  -- for the same combination is a constraint violation, not a judgement call.
  UNIQUE (subscription_id, renewal_date, offset_days)
);

GRANT USAGE ON SCHEMA public TO app, worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app, worker;
