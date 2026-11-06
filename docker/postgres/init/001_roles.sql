-- Runs once when the Postgres container is first created (docker compose up).
-- Two login roles for the application. Neither is a superuser and neither owns
-- the tables, so row-level security applies to them. The worker role gets
-- BYPASSRLS in a later migration, with the reasoning in docs/adr/003.
-- Passwords are development-only; see .env.example.

CREATE ROLE app LOGIN PASSWORD 'app';
CREATE ROLE worker LOGIN PASSWORD 'worker';
