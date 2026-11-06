import type { Db } from '@renewal/db';
import Fastify, { type FastifyInstance } from 'fastify';

import tenantPlugin from './plugins/tenant.js';
import { healthRoutes } from './routes/health.js';
import { meRoutes } from './routes/me.js';

export type AppOptions = {
  db: Db;
  logger?: boolean | { level: string };
};

export async function buildApp({ db, logger = false }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger });

  await app.register(healthRoutes);
  await app.register(tenantPlugin, { db });
  await app.register(meRoutes);

  return app;
}
