import type { Db } from '@renewal/db';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import tenantPlugin from './plugins/tenant.js';
import { healthRoutes } from './routes/health.js';
import { meRoutes } from './routes/me.js';
import { subscriptionRoutes } from './routes/subscriptions.js';

export type AppOptions = {
  db: Db;
  logger?: boolean | { level: string };
};

export async function buildApp({ db, logger = false }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger });

  // Input validation failures become a 400 with one entry per field.
  app.setErrorHandler((error: FastifyError | ZodError, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'validation failed',
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    request.log.error(error);
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    return reply.code(status).send({ error: status === 500 ? 'internal error' : error.message });
  });

  await app.register(healthRoutes);
  await app.register(tenantPlugin, { db });
  await app.register(meRoutes);
  await app.register(subscriptionRoutes);

  return app;
}
