/**
 * Money is stored as integer cents plus an ISO 4217 currency code.
 * These helpers are the only place that turns cents into text.
 */

export type Money = {
  readonly cents: number;
  readonly currency: string;
};

export function money(cents: number, currency: string): Money {
  if (!Number.isInteger(cents)) {
    throw new TypeError(`cents must be an integer, got ${cents}`);
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new TypeError(`currency must be a three-letter ISO code, got ${currency}`);
  }
  return { cents, currency };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new TypeError(`cannot add ${a.currency} to ${b.currency}`);
  }
  return money(a.cents + b.cents, a.currency);
}

/** Sum amounts into one total per currency, so mixed currencies are never added together. */
export function totalPerCurrency(amounts: readonly Money[]): Record<string, Money> {
  const totals: Record<string, Money> = {};
  for (const amount of amounts) {
    const current = totals[amount.currency];
    totals[amount.currency] = current ? addMoney(current, amount) : amount;
  }
  return totals;
}

export function formatMoney(amount: Money, locale = 'en-GB'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: amount.currency,
  }).format(amount.cents / 100);
}
