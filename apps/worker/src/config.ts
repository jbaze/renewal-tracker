import { z } from 'zod';

const schema = z.object({
  WORKER_DATABASE_URL: z.string().url(),
  WORKER_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(60),
  EMAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  EMAIL_FROM: z.string().email().default('reminders@renewal-tracker.local'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`invalid configuration:\n  ${problems.join('\n  ')}`);
  }
  return parsed.data;
}
