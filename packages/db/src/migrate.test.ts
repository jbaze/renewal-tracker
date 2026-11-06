import { describe, expect, it } from 'vitest';

import { createDb, createPool } from './client.js';
import { migrateDown, migrateUp, migrationStatus } from './migrate.js';
import { seed } from './seed.js';

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('migrations', () => {
  it('apply, roll back and apply again against a real database', async () => {
    const dsn = url!;

    // Start from whatever state the database is in and bring it to the top.
    await migrateUp(dsn);
    const before = await migrationStatus(dsn);
    expect(before.every((m) => m.applied)).toBe(true);

    // Roll everything back one by one, then the schema must be gone.
    for (let i = 0; i < before.length; i += 1) {
      expect(await migrateDown(dsn)).toBe(before[before.length - 1 - i]!.name);
    }
    expect(await migrateDown(dsn)).toBeNull();
    expect((await migrationStatus(dsn)).some((m) => m.applied)).toBe(false);

    // And back up. The second run must apply exactly the same files.
    const applied = await migrateUp(dsn);
    expect(applied).toEqual(before.map((m) => m.name));
  });

  it('seeds two organisations with members and subscriptions', async () => {
    const dsn = url!;
    await migrateUp(dsn);
    const pool = createPool(dsn, 1);
    const db = createDb(pool);
    try {
      const result = await seed(db);
      expect(result.organizations).toBe(2);
      expect(result.subscriptions).toBeGreaterThan(5);

      const orgs = await db
        .selectFrom('organizations')
        .select(['name', 'timezone'])
        .orderBy('name')
        .execute();
      expect(orgs.map((o) => o.name)).toEqual(['Acme Studio', 'Northwind Labs']);

      // Seeding twice leaves the same rows, not twice as many.
      await seed(db);
      const count = await db
        .selectFrom('subscriptions')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow();
      expect(Number(count.n)).toBe(result.subscriptions);
    } finally {
      await db.destroy();
    }
  });
});
