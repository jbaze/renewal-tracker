import { createDb, createPool, migrateUp, seed, type Db } from '@renewal/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

const adminUrl = process.env.DATABASE_URL;
const appUrl = process.env.APP_DATABASE_URL;

describe.skipIf(!adminUrl || !appUrl)('api: identity and organisation', () => {
  let admin: Db;
  let db: Db;
  let app: FastifyInstance;
  let acmeId: string;
  let northwindId: string;

  beforeAll(async () => {
    await migrateUp(adminUrl!);
    admin = createDb(createPool(adminUrl!, 1));
    await seed(admin);
    const orgs = await admin
      .selectFrom('organizations')
      .select(['id', 'name'])
      .orderBy('name')
      .execute();
    acmeId = orgs[0]!.id;
    northwindId = orgs[1]!.id;
    db = createDb(createPool(appUrl!, 2));
    app = await buildApp({ db });
  });

  afterAll(async () => {
    await app?.close();
    await db?.destroy();
    await admin?.destroy();
  });

  it('health needs no identity', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('rejects requests without the development login header', async () => {
    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an unknown user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { 'x-user-email': 'stranger@example.test' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('defaults to the first organisation and reports the role', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { 'x-user-email': 'admin@acme.test' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.email).toBe('admin@acme.test');
    expect(body.organization.orgId).toBe(acmeId);
    expect(body.role).toBe('admin');
    expect(body.organizations).toHaveLength(1);
  });

  it('switches organisation with the x-org-id header when the user is a member', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { 'x-user-email': 'member@acme.test', 'x-org-id': northwindId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().organization.orgName).toBe('Northwind Labs');
    expect(res.json().organizations).toHaveLength(2);
  });

  it('refuses an organisation the user does not belong to', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { 'x-user-email': 'admin@acme.test', 'x-org-id': northwindId },
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not leave transactions open after a refused request', async () => {
    for (let i = 0; i < 5; i += 1) {
      await app.inject({
        method: 'GET',
        url: '/me',
        headers: { 'x-user-email': 'admin@acme.test', 'x-org-id': northwindId },
      });
    }
    // The pool has two connections; if any request leaked one, this would hang or fail.
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { 'x-user-email': 'owner@northwind.test' },
    });
    expect(res.statusCode).toBe(200);
  });
});
