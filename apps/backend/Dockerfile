FROM dhi.io/bun:1.3.14-dev AS deps
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/
RUN bun install --frozen-lockfile --production
RUN mkdir -p /state

FROM dhi.io/bun:1.3.14 AS production

LABEL org.opencontainers.image.source=https://github.com/hadestructhor/canireplaceit
LABEL org.opencontainers.image.description="canireplaceit API"

WORKDIR /app

COPY --from=deps /app /app
COPY packages/core ./packages/core
COPY apps/backend ./apps/backend
COPY data ./data

COPY --from=deps --chown=65532:65532 /state /var/lib/canireplaceit

ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_URL=/var/lib/canireplaceit/canireplaceit.db

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=20s \
  CMD ["/usr/local/bin/bun", "-e", "fetch('http://localhost:3001/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["/usr/local/bin/bun", "run", "apps/backend/src/index.ts"]
