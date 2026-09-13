# SDODS server image (Cloud Run / any container host).
#
# Single runtime base: the official Playwright image (Ubuntu noble, Node 22, browsers) so that
# UI runs triggered from the web UI work inside the container. Bun is installed only as the
# package manager and web bundler; everything executes on Node 22 through tsx, and native
# modules (better-sqlite3, argon2) resolve prebuilt binaries for Node 22 at install time.

FROM mcr.microsoft.com/playwright:v1.63.0-noble
ENV NODE_ENV=production \
    DB_DRIVER=sqlite \
    SQLITE_PATH=/data/sdods.db \
    SDODS_ARTIFACTS_DIR=/data/runs \
    SDODS_ROOT=/app \
    HOST=0.0.0.0 \
    PORT=8080 \
    BUN_INSTALL=/opt/bun \
    PATH=/opt/bun/bin:$PATH
WORKDIR /app

# Bun 1.4 as package manager + bundler (pinned)
# python3/make/g++ let node-gyp build native modules when no prebuilt binary matches the image's Node ABI
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates python3 make g++ \
    && curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.0" \
    && apt-get purge -y unzip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Dependencies (native modules: prebuilt binaries when available, otherwise compiled above)
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps/docs/package.json ./apps/docs/package.json
COPY apps/www/package.json ./apps/www/package.json
COPY projects ./projects
COPY tsconfig.base.json tsconfig.json sdods.runner.config.ts sdods.workspace.yaml ./
RUN bun install --frozen-lockfile

# Web UI bundle served by the Fastify server
RUN bun run --filter @sdods/web build

COPY deploy/entrypoint.sh /app/deploy/entrypoint.sh
RUN chmod +x /app/deploy/entrypoint.sh \
    && mkdir -p /data /tmp/sdods \
    && chown -R pwuser:pwuser /data /app /tmp/sdods
USER pwuser
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/deploy/entrypoint.sh"]
CMD ["serve"]
