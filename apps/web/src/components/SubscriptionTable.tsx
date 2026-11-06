import { formatMoney, money } from '@renewal/domain';

import type { Subscription } from '../api/client.js';

type Props = {
  items: Subscription[];
  canWrite: boolean;
  onEdit: (s: Subscription) => void;
  onCancel: (s: Subscription) => void;
};

const STATUS_LABEL: Record<Subscription['status'], string> = {
  trial: 'Trial',
  active: 'Active',
  cancelling: 'Ends on renewal',
  cancelled: 'Cancelled',
};

export function SubscriptionTable({ items, canWrite, onEdit, onCancel }: Props) {
  if (items.length === 0) return <p className="muted">No subscriptions match.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Vendor</th>
          <th>Plan</th>
          <th className="num">Cost</th>
          <th>Cycle</th>
          <th>Renews on</th>
          <th>Status</th>
          <th>Next reminder</th>
          {canWrite && <th />}
        </tr>
      </thead>
      <tbody>
        {items.map((s) => (
          <tr key={s.id} className={s.status === 'cancelled' ? 'muted' : ''}>
            <td>{s.vendor}</td>
            <td>{s.plan}</td>
            <td className="num">{formatMoney(money(s.costCents, s.currency))}</td>
            <td>{s.billingCycle}</td>
            <td>{s.renewsOn}</td>
            <td>
              <span className={`badge ${s.status}`}>{STATUS_LABEL[s.status]}</span>
            </td>
            <td>{s.nextReminderAt ? new Date(s.nextReminderAt).toLocaleString() : ''}</td>
            {canWrite && (
              <td className="row-actions">
                <button className="link" onClick={() => onEdit(s)}>
                  Edit
                </button>
                {(s.status === 'active' || s.status === 'trial') && (
                  <button className="link danger" onClick={() => onCancel(s)}>
                    Cancel
                  </button>
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
