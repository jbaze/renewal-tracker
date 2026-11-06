import { formatMoney, money, totalPerCurrency } from '@renewal/domain';

import type { Subscription } from '../api/client.js';

/**
 * What the organisation spends per month, one total per currency. Yearly
 * subscriptions count as a twelfth of their price; cancelled ones are out.
 */
export function monthlyEquivalents(items: Subscription[]) {
  return totalPerCurrency(
    items
      .filter((s) => s.status !== 'cancelled')
      .map((s) =>
        money(s.billingCycle === 'yearly' ? Math.round(s.costCents / 12) : s.costCents, s.currency),
      ),
  );
}

export function MonthlyTotal({ items }: { items: Subscription[] }) {
  const totals = Object.values(monthlyEquivalents(items)).sort((a, b) =>
    a.currency.localeCompare(b.currency),
  );
  return (
    <section className="panel">
      <h2>Monthly total</h2>
      {totals.length === 0 ? (
        <p className="muted">No active subscriptions.</p>
      ) : (
        <dl className="totals">
          {totals.map((t) => (
            <div key={t.currency}>
              <dt>{t.currency}</dt>
              <dd>{formatMoney(t)}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="muted small">
        Yearly plans count as one twelfth per month. Totals are per currency; nothing is converted.
      </p>
    </section>
  );
}
