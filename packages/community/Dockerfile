# The SDODS community Q&A backend (Cloud Run service `sdods-community`).
#
# Build context is the repository root:  docker build -f packages/community/Dockerfile .
# The service is bundled into one file, so the runtime image is plain Node with no node_modules.

FROM oven/bun:1.4.2 AS build
WORKDIR /repo
COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages
COPY apps/docs/package.json ./apps/docs/package.json
COPY apps/www/package.json ./apps/www/package.json
RUN bun install --frozen-lockfile --ignore-scripts
RUN bun build packages/community/src/main.ts --target=node --outfile=/out/community.js

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --from=build /out/community.js ./community.js
COPY LICENSE NOTICE ./
USER node
EXPOSE 8080
CMD ["node", "community.js"]
