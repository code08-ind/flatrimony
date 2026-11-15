# apps/web/Dockerfile — Next.js standalone output, non-root, minimal (docs/03 §9.1).
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter @flatrimony/web...
RUN pnpm turbo run build --filter=@flatrimony/web

FROM gcr.io/distroless/nodejs22-debian12 AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=8080
# Standalone output keeps the monorepo layout: apps/web/server.js plus a trimmed node_modules.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
USER nonroot
EXPOSE 8080
CMD ["apps/web/server.js"]
