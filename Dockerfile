# ---- build stage ----
FROM node:22.12.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# ---- runtime stage ----
FROM node:22.12.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
# bring the built server, prod deps, and the migrate/seed tooling (tsx, drizzle-kit)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
RUN pnpm install --frozen-lockfile tsx drizzle-kit
COPY --from=build /app/.output ./.output
COPY server ./server
COPY drizzle.config.ts ./drizzle.config.ts
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
