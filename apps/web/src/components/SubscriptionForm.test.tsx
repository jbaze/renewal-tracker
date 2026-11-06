import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { parseAmount, SubscriptionForm } from './SubscriptionForm.js';

describe('parseAmount', () => {
  it('turns a typed amount into integer cents', () => {
    expect(parseAmount('15')).toBe(1500);
    expect(parseAmount('15.5')).toBe(1550);
    expect(parseAmount('15,05')).toBe(1505);
    expect(parseAmount('0.99')).toBe(99);
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('1.234')).toBeNull();
  });
});

describe('SubscriptionForm', () => {
  it('shows field errors and does not submit an incomplete form', async () => {
    const onSubmit = vi.fn();
    render(<SubscriptionForm onSubmit={onSubmit} onCancel={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'Add subscription' }));

    expect(screen.getByText('Vendor is required')).toBeInTheDocument();
    expect(screen.getByText('Enter an amount like 15.00')).toBeInTheDocument();
    expect(screen.getByText('Renewal date is required')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the typed values as the API input, with cents and parsed offsets', async () => {
    const onSubmit = vi.fn();
    render(<SubscriptionForm onSubmit={onSubmit} onCancel={() => {}} />);

    await userEvent.type(screen.getByLabelText('Vendor'), 'Sentry');
    await userEvent.type(screen.getByLabelText('Plan'), 'Team');
    await userEvent.type(screen.getByLabelText('Amount'), '26.00');
    await userEvent.clear(screen.getByLabelText('Currency'));
    await userEvent.type(screen.getByLabelText('Currency'), 'usd');
    await userEvent.selectOptions(screen.getByLabelText('Billing cycle'), 'yearly');
    await userEvent.clear(screen.getByLabelText('Started on'));
    await userEvent.type(screen.getByLabelText('Started on'), '2026-01-15');
    await userEvent.type(screen.getByLabelText('Renews on'), '2027-01-15');
    await userEvent.clear(screen.getByLabelText('Reminders, days before'));
    await userEvent.type(screen.getByLabelText('Reminders, days before'), '14 3');
    await userEvent.click(screen.getByLabelText('Renews automatically'));

    await userEvent.click(screen.getByRole('button', { name: 'Add subscription' }));

    expect(onSubmit).toHaveBeenCalledWith({
      vendor: 'Sentry',
      plan: 'Team',
      costCents: 2600,
      currency: 'USD',
      billingCycle: 'yearly',
      startedOn: '2026-01-15',
      renewsOn: '2027-01-15',
      autoRenew: false,
      reminderOffsets: [14, 3],
    });
  });

  it('rejects a renewal date before the start date', async () => {
    const onSubmit = vi.fn();
    render(<SubscriptionForm onSubmit={onSubmit} onCancel={() => {}} />);

    await userEvent.type(screen.getByLabelText('Vendor'), 'X');
    await userEvent.type(screen.getByLabelText('Amount'), '1');
    await userEvent.clear(screen.getByLabelText('Started on'));
    await userEvent.type(screen.getByLabelText('Started on'), '2026-06-01');
    await userEvent.type(screen.getByLabelText('Renews on'), '2026-05-01');
    await userEvent.click(screen.getByRole('button', { name: 'Add subscription' }));

    expect(screen.getByText('Renewal must be after the start')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('starts from the existing values when editing', () => {
    render(
      <SubscriptionForm
        initial={{
          id: '1',
          vendor: 'Figma',
          plan: 'Professional',
          costCents: 1500,
          currency: 'EUR',
          billingCycle: 'monthly',
          startedOn: '2025-01-31',
          renewsOn: '2026-11-30',
          autoRenew: true,
          status: 'active',
          ownerUserId: null,
          reminderOffsets: [30, 7, 1],
          nextReminderAt: null,
          createdAt: '',
          updatedAt: '',
        }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByLabelText('Vendor')).toHaveValue('Figma');
    expect(screen.getByLabelText('Amount')).toHaveValue('15.00');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });
});
