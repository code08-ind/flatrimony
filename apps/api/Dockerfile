# apps/api/Dockerfile — multi-stage, non-root, minimal (docs/03 §9.1).
# Pin base images by digest for production builds; Dependabot keeps them current.
FROM node:25-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter @flatrimony/api...
RUN pnpm turbo run build --filter=@flatrimony/api
RUN pnpm deploy --filter=@flatrimony/api --prod --legacy /out

FROM gcr.io/distroless/nodejs22-debian12 AS runtime
WORKDIR /app
COPY --from=build /out .
USER nonroot
ENV NODE_ENV=production
EXPOSE 8080
CMD ["dist/server.js"]
