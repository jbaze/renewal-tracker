import { createDb, createPool } from '@renewal/db';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const pool = createPool(config.APP_DATABASE_URL);
const db = createDb(pool);

const app = await buildApp({ db, logger: { level: config.LOG_LEVEL } });

app.log.warn('development login is on: requests identify themselves with the x-user-email header');

const shutdown = async (): Promise<void> => {
  await app.close();
  await db.destroy();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await app.listen({ port: config.API_PORT, host: config.API_HOST });
