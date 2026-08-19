FROM node:22-bookworm-slim AS build
WORKDIR /srv/idlr-pts
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run check && pnpm build

FROM node:22-bookworm-slim AS runtime
WORKDIR /srv/idlr-pts
ENV NODE_ENV=production
COPY --from=build /srv/idlr-pts/package.json /srv/idlr-pts/pnpm-lock.yaml ./
COPY --from=build /srv/idlr-pts/node_modules ./node_modules
COPY --from=build /srv/idlr-pts/dist ./dist
COPY --from=build /srv/idlr-pts/server/data ./server/data
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
