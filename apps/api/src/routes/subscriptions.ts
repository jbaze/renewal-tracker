/**
 * Subscriptions: create, list (filter, sort, paginate), read, update, cancel.
 * Every query runs on the request's tenant transaction, so RLS scopes it to
 * the organisation in use. Owners and admins can write; members only read.
 */
import type { Subscription } from '@renewal/db';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireRole } from '../plugins/tenant.js';

/** YYYY-MM-DD that is a real calendar date: 2026-02-30 must not roll over to March. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine((s) => {
    const parsed = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === s;
  }, 'not a calendar date');

const currency = z.string().regex(/^[A-Z]{3}$/, 'expected a three-letter ISO 4217 code');

// Field rules without defaults, shared by create (which adds defaults) and update.
const fields = {
  vendor: z.string().trim().min(1).max(120),
  plan: z.string().trim().max(120),
  costCents: z.number().int().min(0),
  currency,
  billingCycle: z.enum(['monthly', 'yearly']),
  startedOn: isoDate,
  renewsOn: isoDate,
  autoRenew: z.boolean(),
  reminderOffsets: z.array(z.number().int().min(0).max(365)).min(1).max(10),
};

const createSchema = z.object({
  ...fields,
  plan: fields.plan.default(''),
  autoRenew: fields.autoRenew.default(true),
  status: z.enum(['trial', 'active']).default('active'),
  reminderOffsets: fields.reminderOffsets.default([30, 7, 1]),
});

const updateSchema = z
  .object(fields)
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'nothing to update');

const listSchema = z.object({
  status: z.enum(['trial', 'active', 'cancelling', 'cancelled']).optional(),
  vendor: z.string().trim().min(1).max(120).optional(),
  renewsBefore: isoDate.optional(),
  renewsAfter: isoDate.optional(),
  sort: z.enum(['renews_on', 'vendor', 'cost_cents', 'created_at']).default('renews_on'),
  order: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const idSchema = z.object({ id: z.string().uuid() });

export type SubscriptionDto = ReturnType<typeof toDto>;

export function toDto(row: Subscription) {
  return {
    id: row.id,
    vendor: row.vendor,
    plan: row.plan,
    costCents: row.cost_cents,
    currency: row.currency,
    billingCycle: row.billing_cycle,
    startedOn: row.started_on,
    renewsOn: row.renews_on,
    autoRenew: row.auto_renew,
    status: row.status,
    ownerUserId: row.owner_user_id,
    reminderOffsets: row.reminder_offsets,
    nextReminderAt: row.next_reminder_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const WRITERS = ['owner', 'admin'] as const;

export const subscriptionRoutes: FastifyPluginAsync = async (app) => {
  app.get('/subscriptions', async (request) => {
    const q = listSchema.parse(request.query);
    const { db } = request.tenant;

    let query = db.selectFrom('subscriptions');
    if (q.status) query = query.where('status', '=', q.status);
    if (q.vendor) query = query.where('vendor', 'ilike', `%${q.vendor}%`);
    if (q.renewsBefore) query = query.where('renews_on', '<=', q.renewsBefore);
    if (q.renewsAfter) query = query.where('renews_on', '>=', q.renewsAfter);

    const { total } = await query
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .executeTakeFirstOrThrow();
    const items = await query
      .selectAll()
      .orderBy(q.sort, q.order)
      .orderBy('id')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();

    return { items: items.map(toDto), page: q.page, pageSize: q.pageSize, total: Number(total) };
  });

  app.get('/subscriptions/:id', async (request, reply) => {
    const { id } = idSchema.parse(request.params);
    const row = await findOne(request, id);
    if (!row) return notFound(reply);
    return toDto(row);
  });

  app.post('/subscriptions', async (request, reply) => {
    if (!requireRole(request, reply, [...WRITERS])) return;
    const body = createSchema.parse(request.body);
    const { db, orgId, userId } = request.tenant;
    const row = await db
      .insertInto('subscriptions')
      .values({
        org_id: orgId,
        vendor: body.vendor,
        plan: body.plan,
        cost_cents: body.costCents,
        currency: body.currency,
        billing_cycle: body.billingCycle,
        started_on: body.startedOn,
        renews_on: body.renewsOn,
        auto_renew: body.autoRenew,
        status: body.status,
        reminder_offsets: body.reminderOffsets,
        owner_user_id: userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return reply.code(201).send(toDto(row));
  });

  app.patch('/subscriptions/:id', async (request, reply) => {
    if (!requireRole(request, reply, [...WRITERS])) return;
    const { id } = idSchema.parse(request.params);
    const body = updateSchema.parse(request.body);
    const { db } = request.tenant;
    const row = await db
      .updateTable('subscriptions')
      .set({
        ...(body.vendor !== undefined && { vendor: body.vendor }),
        ...(body.plan !== undefined && { plan: body.plan }),
        ...(body.costCents !== undefined && { cost_cents: body.costCents }),
        ...(body.currency !== undefined && { currency: body.currency }),
        ...(body.billingCycle !== undefined && { billing_cycle: body.billingCycle }),
        ...(body.startedOn !== undefined && { started_on: body.startedOn }),
        ...(body.renewsOn !== undefined && { renews_on: body.renewsOn }),
        ...(body.autoRenew !== undefined && { auto_renew: body.autoRenew }),
        ...(body.reminderOffsets !== undefined && { reminder_offsets: body.reminderOffsets }),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    if (!row) return notFound(reply);
    return toDto(row);
  });

  /**
   * Cancelling keeps the subscription usable until the paid period ends:
   * status becomes "cancelling" and it stops auto-renewing. The worker moves
   * it to "cancelled" once renews_on has passed.
   */
  app.post('/subscriptions/:id/cancel', async (request, reply) => {
    if (!requireRole(request, reply, [...WRITERS])) return;
    const { id } = idSchema.parse(request.params);
    const current = await findOne(request, id);
    if (!current) return notFound(reply);
    if (current.status === 'cancelled' || current.status === 'cancelling') {
      return reply.code(409).send({ error: `subscription is already ${current.status}` });
    }
    const row = await request.tenant.db
      .updateTable('subscriptions')
      .set({ status: 'cancelling', auto_renew: false })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return toDto(row);
  });
};

async function findOne(request: FastifyRequest, id: string): Promise<Subscription | undefined> {
  return request.tenant.db
    .selectFrom('subscriptions')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: 'subscription not found' });
}
