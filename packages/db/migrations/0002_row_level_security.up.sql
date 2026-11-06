-- Tenant isolation at the database. The API sets two transaction-local
-- settings at the start of every request, app.user_id and app.org_id, and
-- these policies compare rows against them. The app role does not own the
-- tables and has no BYPASSRLS, so a query without a WHERE clause still sees
-- one organisation. See docs/adr/002-row-level-security.md.

CREATE FUNCTION current_org_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;

CREATE FUNCTION current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

-- The one lookup that happens before a user is known: turning the dev-login
-- email into a user id. SECURITY DEFINER runs it as the table owner, so it
-- works while users is protected. A real deployment gets the user id from
-- the identity provider's token and this function goes away.
CREATE FUNCTION resolve_user_id(login_email text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$ SELECT id FROM users WHERE email = lower(login_email) $$;
REVOKE ALL ON FUNCTION resolve_user_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_user_id(text) TO app;

-- Tenant tables: one policy each, for every command.
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subscriptions
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

ALTER TABLE renewal_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE renewal_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON renewal_events
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

ALTER TABLE reminder_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON reminder_log
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

-- Memberships: a user sees their own rows (to pick an organisation) and the
-- rows of the organisation they are acting in (to see colleagues).
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_visibility ON memberships FOR SELECT
  USING (user_id = current_user_id() OR org_id = current_org_id());

-- Organisations: the ones the user belongs to.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_visibility ON organizations FOR SELECT
  USING (
    id = current_org_id()
    OR id IN (SELECT org_id FROM memberships WHERE user_id = current_user_id())
  );

-- Users: yourself and the members of the current organisation.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY user_visibility ON users FOR SELECT
  USING (
    id = current_user_id()
    OR id IN (SELECT user_id FROM memberships WHERE org_id = current_org_id())
  );

-- The API never writes organisations, users or memberships in this version,
-- so those tables have no INSERT, UPDATE or DELETE policy: denied by default.
