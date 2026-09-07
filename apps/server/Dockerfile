# Construir desde la RAÍZ del monorepo:
#   docker build -f apps/server/Dockerfile -t vto-server .
#   docker run -p 2567:2567 -e PORT=2567 vto-server
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN npm ci --workspace apps/server --include-workspace-root=false
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY tsconfig.base.json ./
RUN npm run build -w apps/server && npm prune --omit=dev --workspace apps/server

FROM node:22-alpine
ENV NODE_ENV=production
ENV PORT=2567
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/server/build ./apps/server/build
COPY --from=build /repo/apps/server/package.json ./apps/server/package.json
EXPOSE 2567
CMD ["node", "apps/server/build/index.mjs"]
