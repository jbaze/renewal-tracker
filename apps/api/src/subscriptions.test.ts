import { createDb, createPool, migrateUp, seed, type Db } from '@renewal/db';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

const adminUrl = process.env.DATABASE_URL;
const appUrl = process.env.APP_DATABASE_URL;

const asOwner = { 'x-user-email': 'owner@acme.test' };
const asMember = { 'x-user-email': 'member@acme.test' };
const asNorthwind = { 'x-user-email': 'owner@northwind.test' };

const validBody = {
  vendor: 'Sentry',
  plan: 'Team',
  costCents: 2600,
  currency: 'USD',
  billingCycle: 'monthly',
  startedOn: '2026-01-15',
  renewsOn: '2026-12-15',
};

describe.skipIf(!adminUrl || !appUrl)('api: subscriptions', () => {
  let admin: Db;
  let db: Db;
  let app: FastifyInstance;

  const call = (opts: InjectOptions) => app.inject(opts);

  beforeAll(async () => {
    await migrateUp(adminUrl!);
    admin = createDb(createPool(adminUrl!, 1));
    await seed(admin);
    db = createDb(createPool(appUrl!, 2));
    app = await buildApp({ db });
  });

  afterAll(async () => {
    await app?.close();
    await db?.destroy();
    await admin?.destroy();
  });

  it('lists only the organisation in use, paginated and sorted', async () => {
    const res = await call({
      method: 'GET',
      url: '/subscriptions?pageSize=2&sort=vendor',
      headers: asOwner,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(5); // the seed gives Acme five subscriptions
    expect(body.items).toHaveLength(2);
    expect(body.items.map((s: { vendor: string }) => s.vendor)).toEqual(['Figma', 'GitHub']);

    const page3 = await call({
      method: 'GET',
      url: '/subscriptions?pageSize=2&sort=vendor&page=3',
      headers: asOwner,
    });
    expect(page3.json().items).toHaveLength(1);
  });

  it('filters by status, vendor and renewal window', async () => {
    const cancelling = await call({
      method: 'GET',
      url: '/subscriptions?status=cancelling',
      headers: asOwner,
    });
    expect(cancelling.json().items.map((s: { vendor: string }) => s.vendor)).toEqual(['Linear']);

    const git = await call({ method: 'GET', url: '/subscriptions?vendor=git', headers: asOwner });
    expect(git.json().items.map((s: { vendor: string }) => s.vendor)).toEqual(['GitHub']);

    const soon = await call({
      method: 'GET',
      url: '/subscriptions?renewsBefore=2000-01-01',
      headers: asOwner,
    });
    expect(soon.json().total).toBe(0);
  });

  it('rejects bad query parameters with field errors', async () => {
    const res = await call({
      method: 'GET',
      url: '/subscriptions?pageSize=500&sort=price',
      headers: asOwner,
    });
    expect(res.statusCode).toBe(400);
    const paths = res.json().issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['pageSize', 'sort']));
  });

  it('validates the body on create and names the fields', async () => {
    const res = await call({
      method: 'POST',
      url: '/subscriptions',
      headers: asOwner,
      payload: { ...validBody, costCents: 12.5, currency: 'usd', startedOn: '2026-02-30' },
    });
    expect(res.statusCode).toBe(400);
    const paths = res.json().issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['costCents', 'currency', 'startedOn']));
  });

  it('a member can read but not write', async () => {
    const read = await call({ method: 'GET', url: '/subscriptions', headers: asMember });
    expect(read.statusCode).toBe(200);

    const write = await call({
      method: 'POST',
      url: '/subscriptions',
      headers: asMember,
      payload: validBody,
    });
    expect(write.statusCode).toBe(403);
  });

  it('creates, reads, updates and cancels a subscription', async () => {
    const created = await call({
      method: 'POST',
      url: '/subscriptions',
      headers: asOwner,
      payload: validBody,
    });
    expect(created.statusCode).toBe(201);
    const sub = created.json();
    expect(sub.status).toBe('active');
    expect(sub.reminderOffsets).toEqual([30, 7, 1]);
    expect(sub.plan).toBe('Team');

    const read = await call({ method: 'GET', url: `/subscriptions/${sub.id}`, headers: asOwner });
    expect(read.json().vendor).toBe('Sentry');

    const updated = await call({
      method: 'PATCH',
      url: `/subscriptions/${sub.id}`,
      headers: asOwner,
      payload: { costCents: 2900, reminderOffsets: [14, 3] },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().costCents).toBe(2900);
    expect(updated.json().reminderOffsets).toEqual([14, 3]);
    expect(updated.json().vendor).toBe('Sentry');

    const empty = await call({
      method: 'PATCH',
      url: `/subscriptions/${sub.id}`,
      headers: asOwner,
      payload: {},
    });
    expect(empty.statusCode).toBe(400);

    const cancelled = await call({
      method: 'POST',
      url: `/subscriptions/${sub.id}/cancel`,
      headers: asOwner,
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe('cancelling');
    expect(cancelled.json().autoRenew).toBe(false);

    const again = await call({
      method: 'POST',
      url: `/subscriptions/${sub.id}/cancel`,
      headers: asOwner,
    });
    expect(again.statusCode).toBe(409);
  });

  it('another organisation cannot see or change it, even by id', async () => {
    const mine = await call({
      method: 'GET',
      url: '/subscriptions?vendor=Sentry',
      headers: asOwner,
    });
    const id = mine.json().items[0].id;

    const read = await call({ method: 'GET', url: `/subscriptions/${id}`, headers: asNorthwind });
    expect(read.statusCode).toBe(404);

    const update = await call({
      method: 'PATCH',
      url: `/subscriptions/${id}`,
      headers: asNorthwind,
      payload: { vendor: 'Taken' },
    });
    expect(update.statusCode).toBe(404);

    const still = await call({ method: 'GET', url: `/subscriptions/${id}`, headers: asOwner });
    expect(still.json().vendor).toBe('Sentry');
  });
});
