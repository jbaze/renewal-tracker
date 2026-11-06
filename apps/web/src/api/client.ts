/**
 * The browser side of the API. Identity is the development login: the
 * chosen user's email and organisation go out as headers on every request.
 */

export type Role = 'owner' | 'admin' | 'member';
export type BillingCycle = 'monthly' | 'yearly';
export type SubscriptionStatus = 'trial' | 'active' | 'cancelling' | 'cancelled';

export type Membership = { orgId: string; orgName: string; timezone: string; role: Role };

export type Me = {
  user: { id: string; email: string; name: string };
  organization: Membership | undefined;
  role: Role;
  organizations: Membership[];
};

export type Subscription = {
  id: string;
  vendor: string;
  plan: string;
  costCents: number;
  currency: string;
  billingCycle: BillingCycle;
  startedOn: string;
  renewsOn: string;
  autoRenew: boolean;
  status: SubscriptionStatus;
  ownerUserId: string | null;
  reminderOffsets: number[];
  nextReminderAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SubscriptionInput = {
  vendor: string;
  plan: string;
  costCents: number;
  currency: string;
  billingCycle: BillingCycle;
  startedOn: string;
  renewsOn: string;
  autoRenew: boolean;
  reminderOffsets: number[];
};

export type Page<T> = { items: T[]; page: number; pageSize: number; total: number };

export type ListParams = {
  status?: SubscriptionStatus;
  vendor?: string;
  renewsBefore?: string;
  renewsAfter?: string;
  sort?: 'renews_on' | 'vendor' | 'cost_cents' | 'created_at';
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
};

export type Identity = { email: string; orgId?: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

async function request<T>(
  identity: Identity,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { 'x-user-email': identity.email };
  if (identity.orgId) headers['x-org-id'] = identity.orgId;
  if (body !== undefined) headers['content-type'] = 'application/json';

  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`/api${path}`, init);
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; issues?: { path: string; message: string }[] };
    throw new ApiError(res.status, err.error ?? res.statusText, err.issues ?? []);
  }
  return data as T;
}

export const api = {
  me: (identity: Identity) => request<Me>(identity, 'GET', '/me'),

  listSubscriptions: (identity: Identity, params: ListParams = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    const qs = query.toString();
    return request<Page<Subscription>>(identity, 'GET', `/subscriptions${qs ? `?${qs}` : ''}`);
  },

  createSubscription: (identity: Identity, input: SubscriptionInput) =>
    request<Subscription>(identity, 'POST', '/subscriptions', input),

  updateSubscription: (identity: Identity, id: string, input: Partial<SubscriptionInput>) =>
    request<Subscription>(identity, 'PATCH', `/subscriptions/${id}`, input),

  cancelSubscription: (identity: Identity, id: string) =>
    request<Subscription>(identity, 'POST', `/subscriptions/${id}/cancel`),
};
