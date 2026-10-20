# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter api... --filter @ride-master/shared

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @ride-master/shared build \
  && pnpm --filter api exec prisma generate \
  && pnpm --filter api build

FROM base AS runtime
ENV NODE_ENV=production
ENV APP_PORT=3001
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 3001
# Apply migrations before starting: run the container once with `pnpm db:migrate`
# (or point MIGRATE_ON_START=1) — see docs/DEPLOYMENT.md.
CMD ["node", "dist/main"]
