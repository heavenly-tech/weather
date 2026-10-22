# syntax=docker/dockerfile:1

# deps: install the toolchain the build needs (dev deps included).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# GitHub may carry a stub lockfile; npm ci needs a fully resolved one.
# --ignore-scripts skips postinstall until sources are copied in the builder.
# The cache mount keeps the npm download cache out of the layer and out of
# the image, and speeds up rebuilds.
RUN --mount=type=cache,target=/root/.npm \
  npm install --ignore-scripts --no-audit --no-fund

# builder: compile the app and emit the standalone server bundle.
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN node scripts/copy-cesium.mjs && npm run build

# runner: node:22-alpine plus the standalone output only. Nothing else from
# the build stage (sources, dev deps, build caches) is shipped.
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=4310
ENV HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4310/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
