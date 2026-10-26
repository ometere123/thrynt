FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core ./packages/core
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/engine ./apps/engine
RUN npm ci --no-audit --no-fund
RUN npm run build -w @thrynt/core && npm run build -w @thrynt/engine
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/core/dist ./packages/core/dist
COPY --from=build /repo/packages/core/package.json ./packages/core/package.json
COPY --from=build /repo/apps/engine/dist ./apps/engine/dist
COPY --from=build /repo/apps/engine/package.json ./apps/engine/package.json
USER node
CMD ["node","apps/engine/dist/index.js"]
