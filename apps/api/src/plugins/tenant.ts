/**
 * Resolves who is calling and which organisation they act in, then runs the
 * whole request inside one database transaction that carries that identity.
 *
 * Identity comes from a development login: the x-user-email header names a
 * seeded user. There is no password; real authentication is out of scope for
 * this repository and the README says so. Everything after the lookup is what
 * a production version would do with the user id from a verified token.
 *
 * Organisation choice: x-org-id picks one of the user's organisations;
 * without it the first one (alphabetical) is used. A header naming an
 * organisation the user is not a member of is a 403, not a silent fallback.
 */
import {
  applyIdentity,
  listMemberships,
  resolveUserIdByEmail,
  type Database,
  type Db,
  type MembershipRole,
  type MembershipSummary,
  type TenantTrx,
} from '@renewal/db';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { ControlledTransaction } from 'kysely';

export type TenantContext = {
  readonly userId: string;
  readonly orgId: string;
  readonly role: MembershipRole;
  readonly memberships: readonly MembershipSummary[];
  /** The request's transaction. Every query in a route goes through it. */
  readonly db: TenantTrx;
};

declare module 'fastify' {
  interface FastifyRequest {
    tenant: TenantContext;
    /** Opened by the plugin, closed in onSend or onError. */
    trx?: ControlledTransaction<Database> | undefined;
  }
}

export const USER_HEADER = 'x-user-email';
export const ORG_HEADER = 'x-org-id';

/** Paths that need no identity. */
const PUBLIC_PATHS = new Set(['/health']);

type Options = { db: Db };

const tenantPlugin: FastifyPluginAsync<Options> = async (app: FastifyInstance, { db }) => {
  // Reference-typed decorations start as null and are set per request.
  app.decorateRequest('tenant', null as unknown as TenantContext);

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (PUBLIC_PATHS.has(request.routeOptions.url ?? request.url)) return;

    const email = headerValue(request, USER_HEADER);
    if (!email) {
      return reply.code(401).send({ error: `missing ${USER_HEADER} header (development login)` });
    }
    const userId = await resolveUserIdByEmail(db, email);
    if (!userId) {
      return reply.code(401).send({ error: 'unknown user' });
    }

    const trx = await db.startTransaction().execute();
    request.trx = trx;
    try {
      await applyIdentity(trx, { userId, orgId: null });
      const memberships = await listMemberships(trx);
      const requestedOrg = headerValue(request, ORG_HEADER);
      const membership = requestedOrg
        ? memberships.find((m) => m.orgId === requestedOrg)
        : memberships[0];
      if (!membership) {
        await trx.rollback().execute();
        request.trx = undefined;
        return reply
          .code(403)
          .send({ error: requestedOrg ? 'not a member of that organisation' : 'no organisation' });
      }
      await applyIdentity(trx, { userId, orgId: membership.orgId });
      request.tenant = {
        userId,
        orgId: membership.orgId,
        role: membership.role,
        memberships,
        db: trx,
      };
    } catch (err) {
      await trx.rollback().execute();
      request.trx = undefined;
      throw err;
    }
  });

  // Commit when the handler succeeded, roll back when it threw.
  app.addHook('onError', async (request) => {
    if (request.trx) {
      await request.trx.rollback().execute();
      request.trx = undefined;
    }
  });

  app.addHook('onSend', async (request, reply) => {
    if (request.trx) {
      if (reply.statusCode < 400) {
        await request.trx.commit().execute();
      } else {
        await request.trx.rollback().execute();
      }
      request.trx = undefined;
    }
  });
};

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const raw = request.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() || undefined;
}

/** Route guard: owners and admins can write, members can only read. */
export function requireRole(
  request: FastifyRequest,
  reply: FastifyReply,
  roles: MembershipRole[],
): boolean {
  if (roles.includes(request.tenant.role)) return true;
  void reply.code(403).send({ error: `requires one of: ${roles.join(', ')}` });
  return false;
}

export default fp(tenantPlugin, { name: 'tenant' });
