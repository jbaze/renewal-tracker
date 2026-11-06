import { createDb, createPool } from '@renewal/db';

import { loadConfig } from './config.js';
import { ConsoleSender, SmtpSender, type EmailSender } from './email.js';
import { runOnce } from './reminders.js';

const config = loadConfig();
const pool = createPool(config.WORKER_DATABASE_URL, 4);
const db = createDb(pool);

const sender: EmailSender =
  config.EMAIL_TRANSPORT === 'smtp'
    ? new SmtpSender({ host: config.SMTP_HOST, port: config.SMTP_PORT }, config.EMAIL_FROM)
    : new ConsoleSender();

let stopping = false;
const stop = (): void => {
  stopping = true;
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

console.log(
  `reminder worker: every ${config.WORKER_INTERVAL_SECONDS}s, email via ${config.EMAIL_TRANSPORT}`,
);

while (!stopping) {
  const started = Date.now();
  try {
    const summary = await runOnce(db, sender);
    const touched = Object.values(summary).some((n) => n > 0);
    if (touched) console.log(`${new Date().toISOString()} ${JSON.stringify(summary)}`);
  } catch (err) {
    console.error('run failed:', err instanceof Error ? err.message : err);
  }
  const wait = Math.max(0, config.WORKER_INTERVAL_SECONDS * 1000 - (Date.now() - started));
  await new Promise((resolve) => setTimeout(resolve, wait));
}

await db.destroy();
