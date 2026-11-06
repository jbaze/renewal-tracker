import type { FastifyPluginAsync } from 'fastify';

/** Who am I, which organisations can I act in, and which one is this request using. */
export const meRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me', async (request) => {
    const { tenant } = request;
    const user = await tenant.db
      .selectFrom('users')
      .select(['id', 'email', 'name'])
      .where('id', '=', tenant.userId)
      .executeTakeFirstOrThrow();
    return {
      user,
      organization: tenant.memberships.find((m) => m.orgId === tenant.orgId),
      role: tenant.role,
      organizations: tenant.memberships,
    };
  });
};
