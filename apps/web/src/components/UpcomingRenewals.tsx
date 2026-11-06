import { daysBetween, formatMoney, money } from '@renewal/domain';

import type { Subscription } from '../api/client.js';

type Props = {
  items: Subscription[];
  windowDays: 30 | 60 | 90;
  onWindowChange: (days: 30 | 60 | 90) => void;
  today: string;
};

/** Subscriptions that renew within the window, soonest first. Cancelled ones are out. */
export function UpcomingRenewals({ items, windowDays, onWindowChange, today }: Props) {
  const upcoming = items
    .filter((s) => s.status !== 'cancelled')
    .map((s) => ({ ...s, inDays: daysBetween(today, s.renewsOn) }))
    .filter((s) => s.inDays >= 0 && s.inDays <= windowDays)
    .sort((a, b) => a.inDays - b.inDays);

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Upcoming renewals</h2>
        <div className="segmented" role="group" aria-label="window">
          {([30, 60, 90] as const).map((d) => (
            <button
              key={d}
              className={d === windowDays ? 'active' : ''}
              onClick={() => onWindowChange(d)}
              aria-pressed={d === windowDays}
            >
              {d} days
            </button>
          ))}
        </div>
      </header>
      {upcoming.length === 0 ? (
        <p className="muted">Nothing renews in the next {windowDays} days.</p>
      ) : (
        <ul className="list">
          {upcoming.map((s) => (
            <li key={s.id}>
              <span>
                <strong>{s.vendor}</strong> {s.plan && <span className="muted">{s.plan}</span>}
              </span>
              <span className="muted">
                {s.inDays === 0 ? 'today' : s.inDays === 1 ? 'tomorrow' : `in ${s.inDays} days`}
                {s.status === 'cancelling' ? ', then ends' : ''}
              </span>
              <span className="num">{formatMoney(money(s.costCents, s.currency))}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
