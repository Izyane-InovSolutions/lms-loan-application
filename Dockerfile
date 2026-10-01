# syntax=docker/dockerfile:1
#
# The loan workspace: the built site and its API in one Node process (server.js).
# Run it with deploy/docker/compose.yaml, which adds Postgres, Redis, HTTPS and backups.
#
#   docker build -t los-app .

ARG NODE_VERSION=24

# --- Build the site --------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# VITE_* values are baked into the site when it is built, not read when it runs, so they
# are build arguments (compose.yaml passes them from deploy/docker/.env). Changing one
# means rebuilding the image.
ARG VITE_CRB_ENABLED=false
ARG VITE_MAP_TILE_URL=https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png
ARG VITE_MAP_ATTRIBUTION="&copy; OpenStreetMap contributors"
ARG VITE_REPORT_DEV_ERRORS=
RUN npm run build

# --- Runtime ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine
WORKDIR /app
# tzdata so TZ (e.g. Africa/Lusaka) sets the local time the daily maintenance runs at.
RUN apk add --no-cache tzdata
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    LOS_LOCAL_BLOB_DIR=/data/blob
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# The API, plus the shared config under src/ that it imports.
COPY server.js ./
COPY api ./api
COPY scripts ./scripts
COPY src ./src
RUN mkdir -p /data/blob && chown -R node:node /data
USER node
EXPOSE 3001
# /healthz answers 200 only while the database does.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/healthz >/dev/null || exit 1
CMD ["node", "server.js"]
