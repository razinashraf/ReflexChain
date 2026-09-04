# REFLEXCHAIN backend: coordinator + 5 validators + routing gateway, one image.
#
# The Next.js frontend is NOT built here - Vercel serves that. This image only
# needs the workspace root (for the @reflexchain/protocol link), the three
# backend apps, and tsx to run them.
FROM node:22-slim

WORKDIR /app

# Install with the lockfile first so Docker can cache this layer across code edits.
COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/
COPY apps/validator/package.json   apps/validator/
COPY apps/coordinator/package.json apps/coordinator/
COPY apps/gateway/package.json     apps/gateway/
COPY apps/web/package.json         apps/web/

# Dev dependencies are required: tsx runs the TypeScript sources directly, which
# is also what keeps the browser and the validators on one shared protocol source.
RUN npm ci --no-audit --no-fund

COPY packages/protocol   packages/protocol
COPY apps/validator      apps/validator
COPY apps/coordinator    apps/coordinator
COPY apps/gateway        apps/gateway
COPY tsconfig.json       ./

# Each validator writes its own append-only ledger here. On a platform with an
# ephemeral filesystem this resets on redeploy; mount a volume to persist it.
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV RFX_VALIDATOR_COUNT=5
ENV PORT=8080
EXPOSE 8080

CMD ["npx", "tsx", "apps/gateway/src/index.ts"]
