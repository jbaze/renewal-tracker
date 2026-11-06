import { useState, type FormEvent } from 'react';

import type { Subscription, SubscriptionInput } from '../api/client.js';

type Props = {
  initial?: Subscription | undefined;
  busy?: boolean | undefined;
  serverError?: string | null | undefined;
  onSubmit: (input: SubscriptionInput) => void;
  onCancel: () => void;
};

type FieldErrors = Partial<Record<keyof SubscriptionInput, string>>;

const today = new Date().toISOString().slice(0, 10);

/** "15.00" or "15" to integer cents, or null when it is not a money amount. */
export function parseAmount(text: string): number | null {
  const m = /^\s*(\d+)(?:[.,](\d{1,2}))?\s*$/.exec(text);
  if (!m) return null;
  const whole = Number(m[1]);
  const fraction = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
  return whole * 100 + fraction;
}

export function SubscriptionForm({ initial, busy, serverError, onSubmit, onCancel }: Props) {
  const [vendor, setVendor] = useState(initial?.vendor ?? '');
  const [plan, setPlan] = useState(initial?.plan ?? '');
  const [amount, setAmount] = useState(initial ? (initial.costCents / 100).toFixed(2) : '');
  const [currency, setCurrency] = useState(initial?.currency ?? 'EUR');
  const [billingCycle, setBillingCycle] = useState<SubscriptionInput['billingCycle']>(
    initial?.billingCycle ?? 'monthly',
  );
  const [startedOn, setStartedOn] = useState(initial?.startedOn ?? today);
  const [renewsOn, setRenewsOn] = useState(initial?.renewsOn ?? '');
  const [autoRenew, setAutoRenew] = useState(initial?.autoRenew ?? true);
  const [offsets, setOffsets] = useState((initial?.reminderOffsets ?? [30, 7, 1]).join(', '));
  const [errors, setErrors] = useState<FieldErrors>({});

  function validate(): SubscriptionInput | null {
    const next: FieldErrors = {};
    const costCents = parseAmount(amount);
    const reminderOffsets = offsets
      .split(/[,\s]+/)
      .filter(Boolean)
      .map(Number);

    if (!vendor.trim()) next.vendor = 'Vendor is required';
    if (costCents === null) next.costCents = 'Enter an amount like 15.00';
    if (!/^[A-Z]{3}$/.test(currency)) next.currency = 'Three-letter code, like EUR';
    if (!startedOn) next.startedOn = 'Start date is required';
    if (!renewsOn) next.renewsOn = 'Renewal date is required';
    else if (startedOn && renewsOn < startedOn) next.renewsOn = 'Renewal must be after the start';
    if (
      reminderOffsets.length === 0 ||
      reminderOffsets.some((o) => !Number.isInteger(o) || o < 0)
    ) {
      next.reminderOffsets = 'Days before renewal, like 30, 7, 1';
    }

    setErrors(next);
    if (Object.keys(next).length > 0 || costCents === null) return null;
    return {
      vendor: vendor.trim(),
      plan: plan.trim(),
      costCents,
      currency,
      billingCycle,
      startedOn,
      renewsOn,
      autoRenew,
      reminderOffsets,
    };
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const input = validate();
    if (input) onSubmit(input);
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate aria-label="subscription form">
      <div className="grid">
        <label>
          Vendor
          <input value={vendor} onChange={(e) => setVendor(e.target.value)} autoFocus />
          {errors.vendor && <span className="error">{errors.vendor}</span>}
        </label>
        <label>
          Plan
          <input value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="optional" />
        </label>
        <label>
          Amount
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="15.00"
          />
          {errors.costCents && <span className="error">{errors.costCents}</span>}
        </label>
        <label>
          Currency
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
          />
          {errors.currency && <span className="error">{errors.currency}</span>}
        </label>
        <label>
          Billing cycle
          <select
            value={billingCycle}
            onChange={(e) => setBillingCycle(e.target.value as SubscriptionInput['billingCycle'])}
          >
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </label>
        <label>
          Started on
          <input type="date" value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />
          {errors.startedOn && <span className="error">{errors.startedOn}</span>}
        </label>
        <label>
          Renews on
          <input type="date" value={renewsOn} onChange={(e) => setRenewsOn(e.target.value)} />
          {errors.renewsOn && <span className="error">{errors.renewsOn}</span>}
        </label>
        <label>
          Reminders, days before
          <input value={offsets} onChange={(e) => setOffsets(e.target.value)} />
          {errors.reminderOffsets && <span className="error">{errors.reminderOffsets}</span>}
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={autoRenew}
            onChange={(e) => setAutoRenew(e.target.checked)}
          />
          Renews automatically
        </label>
      </div>
      {serverError && <p className="error">{serverError}</p>}
      <div className="actions">
        <button type="submit" disabled={busy}>
          {initial ? 'Save changes' : 'Add subscription'}
        </button>
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
