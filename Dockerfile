# MyFit Routine — single full-stack service (Express API + built React app + reminder scheduler)

FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ── Install dependencies (incl. dev deps for the build) ──
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# ── Build client (Vite) and server (esbuild bundle) ──
FROM deps AS build
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

# ── Runtime ──
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/server/index.js"]
