import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

import type { Database } from './schema.js';

// Postgres returns date columns as plain strings so no timezone shift sneaks in.
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

export type Db = Kysely<Database>;

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString, max });
}

export function createDb(pool: pg.Pool): Db {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
