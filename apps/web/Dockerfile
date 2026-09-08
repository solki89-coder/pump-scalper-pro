# PUMP SCALPER PRO — Dashboard (Next.js) image.
#
# Next.js inlines every NEXT_PUBLIC_* env var into the client bundle at
# *build* time, not at container start — so the API's URL has to be a
# build ARG, not a runtime `environment:` value the way the API
# container's config works. docker-compose passes it as a build arg (see
# docker-compose.yml); rebuild the image (not just restart the
# container) if the API's public URL changes.
#
# Single-stage, not a trimmed `output: 'standalone'` multi-stage build:
# this workspace imports sibling monorepo packages (@pump-scalper/shared,
# @pump-scalper/solana) that Next's standalone file-tracing doesn't
# always resolve correctly across npm workspace symlinks, and verifying
# that properly was out of scope for this pass. The trade-off is a
# larger image (full node_modules, including devDependencies needed for
# `next build`) — documented rather than silently shipped as if it were
# already optimized.
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/solana/package.json packages/solana/package.json

RUN npm ci

COPY . .

ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NODE_ENV=production

RUN npm run build --workspace apps/web

EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "apps/web"]
