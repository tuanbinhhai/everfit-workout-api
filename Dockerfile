# --- deps: install all dependencies (incl. dev, needed to build) ---
# prisma/schema.prisma must be present before `npm ci` since the
# `postinstall` script runs `prisma generate` against it.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# --- build: compile TypeScript (incl. the generated Prisma client) ---
FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# --- runtime: production dependencies + compiled output only ---
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY prisma ./prisma
# prisma.config.ts (Prisma 7's config model — see prisma.config.ts) supplies
# the datasource URL for `prisma migrate deploy` below; schema.prisma itself
# has no `url` in its datasource block, so without this file the migrate
# step has nothing to connect with.
COPY prisma.config.ts ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

EXPOSE 3000
# Applies pending migrations against DATABASE_URL before starting the app,
# so `docker compose up` alone brings up a working API against a fresh
# database with no manual migration step.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
