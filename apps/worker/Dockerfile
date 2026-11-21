# apps/worker/Dockerfile — the worker Cloud Run Job (docs/03 §9.1, ADR-0006). Multi-stage, non-root.
# Cloud Scheduler starts it with the argument `tick` or `daily` (infra/terraform/envs/staging).
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter @flatrimony/worker...
RUN pnpm turbo run build --filter=@flatrimony/worker
RUN pnpm deploy --filter=@flatrimony/worker --prod --legacy /out

FROM gcr.io/distroless/nodejs22-debian12 AS runtime
WORKDIR /app
COPY --from=build /out .
USER nonroot
ENV NODE_ENV=production
ENTRYPOINT ["/nodejs/bin/node", "dist/main.js"]
CMD ["tick"]
