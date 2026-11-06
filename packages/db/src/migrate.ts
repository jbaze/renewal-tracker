/**
 * A small migration runner for plain SQL files.
 *
 * Migrations live in ../migrations as NNNN_name.up.sql and NNNN_name.down.sql.
 * Applied names are recorded in schema_migrations. Each migration runs inside
 * one transaction, so a failing file leaves the database as it was.
 *
 *   pnpm db:migrate     apply every pending migration
 *   pnpm db:rollback    revert the most recent one
 *   pnpm db:status      list applied and pending migrations
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export type Migration = { name: string; up: string; down: string };

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = await readdir(dir);
  const names = files
    .filter((f) => f.endsWith('.up.sql'))
    .map((f) => f.replace(/\.up\.sql$/, ''))
    .sort();
  return Promise.all(
    names.map(async (name) => ({
      name,
      up: await readFile(path.join(dir, `${name}.up.sql`), 'utf8'),
      down: await readFile(path.join(dir, `${name}.down.sql`), 'utf8'),
    })),
  );
}

async function ensureTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
}

async function appliedNames(client: pg.PoolClient): Promise<string[]> {
  const res = await client.query<{ name: string }>(
    'SELECT name FROM schema_migrations ORDER BY name',
  );
  return res.rows.map((r) => r.name);
}

async function withClient<T>(
  connectionString: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await ensureTable(client);
    return await fn(client);
  } finally {
    client.release();
    await pool.end();
  }
}

async function runInTransaction(client: pg.PoolClient, statements: string[]): Promise<void> {
  await client.query('BEGIN');
  try {
    for (const sql of statements) {
      await client.query(sql);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

/** Apply every migration that is not yet recorded. Returns the names applied. */
export async function migrateUp(connectionString: string, dir?: string): Promise<string[]> {
  const migrations = await loadMigrations(dir);
  return withClient(connectionString, async (client) => {
    const applied = new Set(await appliedNames(client));
    const done: string[] = [];
    for (const m of migrations) {
      if (applied.has(m.name)) continue;
      await runInTransaction(client, [m.up]);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [m.name]);
      done.push(m.name);
    }
    return done;
  });
}

/** Revert the most recently applied migration. Returns its name, or null if none. */
export async function migrateDown(connectionString: string, dir?: string): Promise<string | null> {
  const migrations = await loadMigrations(dir);
  return withClient(connectionString, async (client) => {
    const applied = await appliedNames(client);
    const last = applied.at(-1);
    if (!last) return null;
    const m = migrations.find((x) => x.name === last);
    if (!m) throw new Error(`migration ${last} is recorded but its file is missing`);
    await runInTransaction(client, [m.down]);
    await client.query('DELETE FROM schema_migrations WHERE name = $1', [m.name]);
    return m.name;
  });
}

export async function migrationStatus(
  connectionString: string,
  dir?: string,
): Promise<{ name: string; applied: boolean }[]> {
  const migrations = await loadMigrations(dir);
  return withClient(connectionString, async (client) => {
    const applied = new Set(await appliedNames(client));
    return migrations.map((m) => ({ name: m.name, applied: applied.has(m.name) }));
  });
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  switch (command) {
    case 'up': {
      const done = await migrateUp(url);
      console.log(done.length ? `applied: ${done.join(', ')}` : 'nothing to apply');
      break;
    }
    case 'down': {
      const name = await migrateDown(url);
      console.log(name ? `reverted: ${name}` : 'nothing to revert');
      break;
    }
    case 'status': {
      for (const s of await migrationStatus(url)) {
        console.log(`${s.applied ? 'applied' : 'pending'}  ${s.name}`);
      }
      break;
    }
    default:
      throw new Error(`usage: migrate.ts up|down|status (got ${command ?? 'nothing'})`);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === new URL(process.argv[1], 'file:').href;

if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
