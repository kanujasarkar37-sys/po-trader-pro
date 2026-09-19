# ─────────────────────────────────────────────────────────────────────────────
# PO Trader Pro — production image (Bun runtime)
# Single process: Next.js + trading engine (socket.io at /engine) on one port.
# Build:  docker build -t po-trader-pro .
# Run:    docker run -p 3000:3000 -v po-data:/app/db po-trader-pro
# ─────────────────────────────────────────────────────────────────────────────

FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS builder
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Inlined into the client bundle at build time: the browser connects to the
# engine same-origin at /engine (single-server deployment).
ENV NEXT_PUBLIC_ENGINE_PATH=/engine
RUN bunx prisma generate
RUN bun run build

FROM oven/bun:1 AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=file:/app/db/custom.db \
    PORT=3000

# Full node_modules (Next handler + socket.io + Prisma client + engine deps)
COPY --from=builder /app/node_modules ./node_modules
# Next.js build output + static assets
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
# Prisma schema (for db push at container start) + the SQLite directory
COPY --from=builder /app/prisma ./prisma
# Trading engine service + consolidated production server
COPY --from=builder /app/mini-services ./mini-services
COPY --from=builder /app/server.ts ./server.ts
# Next config + manifest files
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/bun.lock ./bun.lock
COPY --from=builder /app/tsconfig.json ./tsconfig.json

RUN mkdir -p /app/db
EXPOSE 3000

# Ensure the SQLite schema exists (no-op on restarts), then boot the
# consolidated server (web + engine, one port).
CMD ["sh", "-c", "bunx prisma db push --accept-data-loss && exec bun server.ts"]
