# ---- build stage ----
FROM node:22.12.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage ----
FROM node:22.12.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# bring the built server, prod deps, and the migrate/seed tooling
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/.output ./.output
COPY server ./server
COPY drizzle.config.ts ./drizzle.config.ts
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
