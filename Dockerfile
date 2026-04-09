FROM node:20-slim AS build

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# ── Backend dependencies ───────────────────────────────────────────────────────
COPY package*.json ./
COPY prisma ./prisma

RUN npm ci

# ── Copy all source ───────────────────────────────────────────────────────────
COPY . .

# ── Frontend build ─────────────────────────────────────────────────────────────
RUN cd frontend && npm install && npm run build

# ── Backend build ──────────────────────────────────────────────────────────────
RUN npx prisma generate
RUN npm run build
RUN npx tsc prisma/seed.ts --outDir dist/prisma --esModuleInterop --skipLibCheck --resolveJsonModule
RUN npm prune --omit=dev

# ── Production image ───────────────────────────────────────────────────────────
FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/frontend/dist ./frontend/dist
COPY package*.json ./

RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser && chown -R appuser:appgroup /app
USER appuser

EXPOSE 8000

CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && node dist/server.js"]
