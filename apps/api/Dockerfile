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
RUN chown -R node:node /app
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]
