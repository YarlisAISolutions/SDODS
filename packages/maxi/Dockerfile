# Maxi, the SDODS docs assistant (Cloud Run service `sdods-maxi`).
#
# Build context is the repository root:  docker build -f packages/maxi/Dockerfile .
# The service is bundled into one file, so the runtime image is plain Node with no node_modules,
# no browsers and no native modules.

FROM oven/bun:1.4.0 AS build
WORKDIR /repo
COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages
COPY apps/docs/package.json ./apps/docs/package.json
COPY apps/www/package.json ./apps/www/package.json
RUN bun install --frozen-lockfile --ignore-scripts
RUN bun build packages/maxi/src/main.ts --target=node --outfile=/out/maxi.js

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8080 \
    MAXI_STEPS_FILE=/app/data/steps.json
WORKDIR /app
COPY --from=build /out/maxi.js ./maxi.js
COPY packages/maxi/data/steps.json ./data/steps.json
USER node
EXPOSE 8080
CMD ["node", "maxi.js"]
