# Renewal tracker

A small multi-tenant service that tracks software subscriptions for an organisation and sends renewal reminders before they bill.

Work in progress. The plan:

- Node.js and TypeScript in one pnpm workspace: a Fastify API, a reminder worker, a React web app, and shared packages for the domain rules and the database.
- PostgreSQL with plain SQL migrations and row-level security for tenant isolation.
- Tests against a real database, lint, typecheck and CI on every pull request.

Setup, architecture notes and the list of what is deliberately out of scope will land here as the pieces are built.
