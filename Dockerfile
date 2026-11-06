# One image for the api, worker and web services; docker compose picks the
# command. Development image: it runs the TypeScript sources with tsx and
# the Vite dev server, which is all this repository needs.
FROM node:22-alpine

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/

RUN pnpm install --frozen-lockfile

COPY . .

CMD ["pnpm", "--filter", "@renewal/api", "start"]
