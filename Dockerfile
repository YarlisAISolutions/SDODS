# AutoMax server image.
# Stage 1 installs with Bun (fast); stage 2 runs on Node 22 (Playwright, native drivers).
# The web build step is added when packages/web lands; until then the image serves the CLI.

FROM oven/bun:1.4 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps ./apps
COPY projects ./projects
COPY tsconfig.base.json tsconfig.json playwright.config.ts* ./
RUN bun install --frozen-lockfile --production=false

FROM mcr.microsoft.com/playwright:v1.62.1-noble AS runtime
ENV NODE_ENV=production \
    DB_DRIVER=sqlite \
    SQLITE_PATH=/data/automax.db \
    AUTOMAX_ARTIFACTS_DIR=/data/runs \
    HOST=0.0.0.0 \
    PORT=4444
WORKDIR /app
COPY --from=deps /app /app
RUN mkdir -p /data && chown -R pwuser:pwuser /data /app
USER pwuser
VOLUME ["/data"]
EXPOSE 4444
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node --import tsx packages/cli/src/bin.ts --version || exit 1
# `automax serve` replaces this entrypoint once packages/server exists.
ENTRYPOINT ["node", "--import", "tsx", "packages/cli/src/bin.ts"]
CMD ["--help"]
