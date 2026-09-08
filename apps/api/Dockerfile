# PUMP SCALPER PRO — API image.
#
# No compiled-JS build step exists for this workspace (apps/api runs
# directly under `tsx`, same as `npm run dev`/`npm run start` locally —
# see package.json). That means devDependencies (tsx, typescript) are
# genuinely needed at *runtime* here, not just to build, so this image
# does a plain `npm ci` rather than `npm ci --omit=dev`. The trade-off is
# a larger image than a compiled-JS + `--omit=dev` build would produce;
# documented here rather than silently shipped. A future optimization
# would add a real `tsc` build step and run the compiled output with
# plain `node`, but that's a separate, deliberate change — not something
# to bolt on unverified during a deployment phase.
FROM node:20-alpine

WORKDIR /app

# Root + every workspace's package.json first, so `npm ci` is cached by
# Docker as long as no dependency changed, even if application code did.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/solana/package.json packages/solana/package.json

RUN npm ci

COPY . .

ENV NODE_ENV=production
EXPOSE 4000

# Migrations are idempotent (tracked in schema_migrations, see
# src/db/migrate.ts) and this is always a single instance — no
# multi-replica migration race to worry about — so running them on every
# container start is safe and means there's no separate manual step to
# forget before the app can serve requests.
CMD ["sh", "-c", "npm run migrate --workspace apps/api && npm run start --workspace apps/api"]
