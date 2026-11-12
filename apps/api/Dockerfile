# syntax=docker/dockerfile:1

FROM node:22.14.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY apps/api ./apps/api
RUN npm run api:build

FROM node:22.14.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/migrations ./apps/api/migrations
COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN apk add --no-cache su-exec \
  && mkdir -p /app/media \
  && chmod 755 /usr/local/bin/docker-entrypoint.sh \
  && chown -R node:node /app
EXPOSE 4000
# Starts as root only to fix media-volume ownership, then execs as node.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "apps/api/dist/index.js"]
