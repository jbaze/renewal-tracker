import { describe, expect, it } from 'vitest';

import { addMoney, formatMoney, money, totalPerCurrency } from './money.js';

describe('money', () => {
  it('rejects fractional cents and bad currency codes', () => {
    expect(() => money(12.5, 'EUR')).toThrow(/integer/);
    expect(() => money(1250, 'eur')).toThrow(/ISO/);
  });

  it('adds amounts in the same currency and refuses mixed ones', () => {
    expect(addMoney(money(1000, 'EUR'), money(250, 'EUR'))).toEqual(money(1250, 'EUR'));
    expect(() => addMoney(money(1, 'EUR'), money(1, 'USD'))).toThrow(/cannot add/);
  });

  it('totals per currency without mixing them', () => {
    const totals = totalPerCurrency([money(1000, 'EUR'), money(500, 'USD'), money(250, 'EUR')]);
    expect(totals).toEqual({ EUR: money(1250, 'EUR'), USD: money(500, 'USD') });
  });

  it('formats cents as a currency string', () => {
    expect(formatMoney(money(1250, 'EUR'))).toBe('€12.50');
    expect(formatMoney(money(99, 'USD'), 'en-US')).toBe('$0.99');
  });
});
