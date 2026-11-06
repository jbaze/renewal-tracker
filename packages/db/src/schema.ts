/**
 * Table types for Kysely. Kept by hand next to the SQL migrations so a reader
 * can compare the two; there is no code generation step.
 */
import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

export type MembershipRole = 'owner' | 'admin' | 'member';
export type BillingCycle = 'monthly' | 'yearly';
export type SubscriptionStatus = 'trial' | 'active' | 'cancelling' | 'cancelled';
export type RenewalDecision = 'renewed' | 'cancelled' | 'reviewed';

/** A date column: read as YYYY-MM-DD, written as a string or Date. */
type DateOnly = ColumnType<string, string | Date, string | Date>;
type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface OrganizationsTable {
  id: Generated<string>;
  name: string;
  timezone: Generated<string>;
  created_at: Generated<Timestamp>;
}

export interface UsersTable {
  id: Generated<string>;
  email: string;
  name: string;
  created_at: Generated<Timestamp>;
}

export interface MembershipsTable {
  org_id: string;
  user_id: string;
  role: Generated<MembershipRole>;
  created_at: Generated<Timestamp>;
}

export interface SubscriptionsTable {
  id: Generated<string>;
  org_id: string;
  vendor: string;
  plan: Generated<string>;
  cost_cents: number;
  currency: string;
  billing_cycle: BillingCycle;
  started_on: DateOnly;
  renews_on: DateOnly;
  auto_renew: Generated<boolean>;
  status: Generated<SubscriptionStatus>;
  owner_user_id: string | null;
  reminder_offsets: Generated<number[]>;
  next_reminder_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface RenewalEventsTable {
  id: Generated<string>;
  org_id: string;
  subscription_id: string;
  renewal_date: DateOnly;
  amount_cents: number;
  currency: string;
  decision: RenewalDecision;
  created_at: Generated<Timestamp>;
}

export interface ReminderLogTable {
  id: Generated<string>;
  org_id: string;
  subscription_id: string;
  renewal_date: DateOnly;
  offset_days: number;
  sent_at: Generated<Timestamp>;
}

export interface Database {
  organizations: OrganizationsTable;
  users: UsersTable;
  memberships: MembershipsTable;
  subscriptions: SubscriptionsTable;
  renewal_events: RenewalEventsTable;
  reminder_log: ReminderLogTable;
}

export type Organization = Selectable<OrganizationsTable>;
export type User = Selectable<UsersTable>;
export type Membership = Selectable<MembershipsTable>;
export type Subscription = Selectable<SubscriptionsTable>;
export type NewSubscription = Insertable<SubscriptionsTable>;
export type SubscriptionUpdate = Updateable<SubscriptionsTable>;
export type RenewalEvent = Selectable<RenewalEventsTable>;
export type ReminderLogEntry = Selectable<ReminderLogTable>;
