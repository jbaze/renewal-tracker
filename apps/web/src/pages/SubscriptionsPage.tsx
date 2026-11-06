import { useCallback, useEffect, useState } from 'react';

import {
  api,
  ApiError,
  type Identity,
  type Me,
  type Subscription,
  type SubscriptionInput,
  type SubscriptionStatus,
} from '../api/client.js';
import { MonthlyTotal } from '../components/MonthlyTotal.js';
import { SubscriptionForm } from '../components/SubscriptionForm.js';
import { SubscriptionTable } from '../components/SubscriptionTable.js';
import { UpcomingRenewals } from '../components/UpcomingRenewals.js';

type Props = { identity: Identity; me: Me };

type Editing = { kind: 'new' } | { kind: 'edit'; subscription: Subscription } | null;

export function SubscriptionsPage({ identity, me }: Props) {
  const [items, setItems] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<SubscriptionStatus | ''>('');
  const [search, setSearch] = useState('');
  const [windowDays, setWindowDays] = useState<30 | 60 | 90>(30);
  const [editing, setEditing] = useState<Editing>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canWrite = me.role === 'owner' || me.role === 'admin';
  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // One page of a hundred is plenty for a demo organisation.
      const page = await api.listSubscriptions(identity, { pageSize: 100, sort: 'renews_on' });
      setItems(page.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load');
    } finally {
      setLoading(false);
    }
  }, [identity]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(input: SubscriptionInput) {
    if (!editing) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (editing.kind === 'new') await api.createSubscription(identity, input);
      else await api.updateSubscription(identity, editing.subscription.id, input);
      setEditing(null);
      await load();
    } catch (err) {
      setSaveError(
        err instanceof ApiError && err.issues.length
          ? err.issues.map((i) => `${i.path}: ${i.message}`).join('; ')
          : err instanceof Error
            ? err.message
            : 'failed to save',
      );
    } finally {
      setSaving(false);
    }
  }

  async function cancel(subscription: Subscription) {
    if (
      !window.confirm(
        `Cancel ${subscription.vendor}? It stays active until ${subscription.renewsOn}.`,
      )
    )
      return;
    try {
      await api.cancelSubscription(identity, subscription.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to cancel');
    }
  }

  const visible = items.filter(
    (s) =>
      (statusFilter === '' || s.status === statusFilter) &&
      (search === '' || s.vendor.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div className="page">
      <aside className="sidebar">
        <UpcomingRenewals
          items={items}
          windowDays={windowDays}
          onWindowChange={setWindowDays}
          today={today}
        />
        <MonthlyTotal items={items} />
      </aside>

      <main>
        <header className="panel-header">
          <h2>Subscriptions</h2>
          <div className="toolbar">
            <input
              placeholder="Search vendor"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="search vendor"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as SubscriptionStatus | '')}
              aria-label="status filter"
            >
              <option value="">All statuses</option>
              <option value="trial">Trial</option>
              <option value="active">Active</option>
              <option value="cancelling">Ends on renewal</option>
              <option value="cancelled">Cancelled</option>
            </select>
            {canWrite && (
              <button onClick={() => setEditing({ kind: 'new' })} disabled={editing !== null}>
                Add subscription
              </button>
            )}
          </div>
        </header>

        {editing && (
          <div className="panel">
            <h3>
              {editing.kind === 'new' ? 'New subscription' : `Edit ${editing.subscription.vendor}`}
            </h3>
            <SubscriptionForm
              key={editing.kind === 'edit' ? editing.subscription.id : 'new'}
              initial={editing.kind === 'edit' ? editing.subscription : undefined}
              busy={saving}
              serverError={saveError}
              onSubmit={save}
              onCancel={() => {
                setEditing(null);
                setSaveError(null);
              }}
            />
          </div>
        )}

        {error && <p className="error">{error}</p>}
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <SubscriptionTable
            items={visible}
            canWrite={canWrite}
            onEdit={(s) => setEditing({ kind: 'edit', subscription: s })}
            onCancel={cancel}
          />
        )}
        {!canWrite && (
          <p className="muted small">You are a member of this organisation: read only.</p>
        )}
      </main>
    </div>
  );
}
