/**
 * A client that disconnects while a request is in flight must not leave the
 * request's transaction open on a pooled connection. This needs a real
 * socket, so the app listens on a random port for these tests.
 */
import { createDb, createPool, migrateUp, seed, type Db } from '@renewal/db';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

const adminUrl = process.env.DATABASE_URL;
const appUrl = process.env.APP_DATABASE_URL;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!adminUrl || !appUrl)('api: abandoned requests', () => {
  let admin: Db;
  let db: Db;
  let app: FastifyInstance;
  let port: number;

  beforeAll(async () => {
    await migrateUp(adminUrl!);
    admin = createDb(createPool(adminUrl!, 1));
    await seed(admin);
    // Two connections only: a single leaked transaction would show up fast.
    db = createDb(createPool(appUrl!, 2));
    app = await buildApp({ db });
    // A slow route so the client can hang up while the handler is still running.
    app.get('/slow', async (request) => {
      await sleep(400);
      return { org: request.tenant.orgId };
    });
    // A route that takes over the raw response. Fastify skips onSend for it,
    // so only the onResponse safety net can close its transaction.
    app.get('/hijacked', (request, reply) => {
      reply.hijack();
      reply.raw.writeHead(200, { 'content-type': 'text/plain' });
      reply.raw.end(request.tenant.orgId);
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    port = typeof address === 'object' && address ? address.port : 0;
  });

  afterAll(async () => {
    await app?.close();
    await db?.destroy();
    await admin?.destroy();
  });

  async function openTransactionsForAppRole(): Promise<number> {
    const rows = await sql<{ n: string }>`
      SELECT count(*) AS n FROM pg_stat_activity
      WHERE usename = 'app' AND state = 'idle in transaction'`
      .execute(admin)
      .then((r) => r.rows);
    return Number(rows[0]!.n);
  }

  /** Send a request and hang up before the response arrives. */
  function requestThenHangUp(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.write(
          `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nx-user-email: owner@acme.test\r\nConnection: keep-alive\r\n\r\n`,
        );
        setTimeout(() => {
          socket.destroy();
          resolve();
        }, 100);
      });
      socket.on('error', reject);
    });
  }

  it('rolls back the transaction when the client disconnects mid-request', async () => {
    for (let i = 0; i < 3; i += 1) {
      await requestThenHangUp('/slow');
    }
    // Let the handlers finish and the hooks run.
    await sleep(900);

    expect(await openTransactionsForAppRole()).toBe(0);

    // Both pooled connections are free again: two concurrent requests succeed.
    const [a, b] = await Promise.all([
      app.inject({ method: 'GET', url: '/me', headers: { 'x-user-email': 'owner@acme.test' } }),
      app.inject({
        method: 'GET',
        url: '/me',
        headers: { 'x-user-email': 'owner@northwind.test' },
      }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
  });

  it('a hijacked reply, which skips onSend, still closes its transaction', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/hijacked`, {
      headers: { 'x-user-email': 'owner@acme.test' },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/^[0-9a-f-]{36}$/);
    await sleep(100);
    expect(await openTransactionsForAppRole()).toBe(0);
  });

  it('a completed request leaves nothing open either', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/slow',
      headers: { 'x-user-email': 'owner@acme.test' },
    });
    expect(res.statusCode).toBe(200);
    await sleep(50);
    expect(await openTransactionsForAppRole()).toBe(0);
  });
});
