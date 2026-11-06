import { useEffect, useState } from 'react';

import { api, ApiError, type Identity, type Me } from './api/client.js';
import { SubscriptionsPage } from './pages/SubscriptionsPage.js';

/** The seeded users. Picking one is the development login; there is no password. */
const DEV_USERS = [
  'owner@acme.test',
  'admin@acme.test',
  'member@acme.test',
  'owner@northwind.test',
];

const STORAGE_KEY = 'renewal-tracker.identity';

function loadIdentity(): Identity {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Identity;
  } catch {
    // ignore a bad value
  }
  return { email: DEV_USERS[0]! };
}

export function App() {
  const [identity, setIdentity] = useState<Identity>(loadIdentity);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
    let cancelled = false;
    setMe(null);
    setError(null);
    api
      .me(identity)
      .then((m) => {
        if (cancelled) return;
        setMe(m);
        // The API may have fallen back to the user's first organisation.
        if (m.organization && m.organization.orgId !== identity.orgId) {
          setIdentity({ email: identity.email, orgId: m.organization.orgId });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // A remembered organisation the user no longer belongs to (or a reseeded
        // database): fall back to the user's own first organisation.
        if (err instanceof ApiError && err.status === 403 && identity.orgId) {
          setIdentity({ email: identity.email });
          return;
        }
        setError(err instanceof Error ? err.message : 'failed to sign in');
      });
    return () => {
      cancelled = true;
    };
  }, [identity]);

  return (
    <>
      <header className="topbar">
        <h1>Renewal tracker</h1>
        <div className="identity">
          <label>
            Signed in as
            <select
              value={identity.email}
              onChange={(e) => setIdentity({ email: e.target.value })}
              aria-label="user"
            >
              {DEV_USERS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          {me && me.organizations.length > 0 && (
            <label>
              Organisation
              <select
                value={identity.orgId ?? me.organization?.orgId ?? ''}
                onChange={(e) => setIdentity({ email: identity.email, orgId: e.target.value })}
                aria-label="organisation"
              >
                {me.organizations.map((o) => (
                  <option key={o.orgId} value={o.orgId}>
                    {o.orgName} ({o.role})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </header>
      <p className="notice">
        Development login: pick a seeded user above. Real authentication is out of scope for this
        repository.
      </p>
      {error && <p className="error">{error}</p>}
      {me ? (
        <SubscriptionsPage
          key={`${identity.email}:${me.organization?.orgId}`}
          identity={identity}
          me={me}
        />
      ) : (
        !error && <p className="muted">Loading…</p>
      )}
    </>
  );
}
