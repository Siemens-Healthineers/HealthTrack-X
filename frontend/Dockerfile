# ── Frontend Dockerfile (multi-stage) ─────────────────────────
# Build:  docker compose build frontend
# Run:    docker compose up frontend
# ──────────────────────────────────────────────────────────────

# ── Stage 1: Build the Vite app ──────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

# Install dependencies first (cached layer)
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

# Copy source and build
COPY frontend/ .

# Empty VITE_API_URL → all fetch() calls use relative paths (same-origin)
# nginx will reverse-proxy /api/* to the backend container
ENV VITE_API_URL=""

# OIDC configuration (set via docker-compose build args)
ARG VITE_OIDC_AUTHORITY=""
ARG VITE_OIDC_CLIENT_ID=""
ENV VITE_OIDC_AUTHORITY=${VITE_OIDC_AUTHORITY}
ENV VITE_OIDC_CLIENT_ID=${VITE_OIDC_CLIENT_ID}

RUN npm run build

# ── Stage 2: Serve with nginx ────────────────────────────────
FROM nginx:alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our custom nginx config
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built static files from Stage 1
COPY --from=build /app/dist /usr/share/nginx/html

# Copy markdown docs so they can be fetched at runtime (under /docs-md/ to
# avoid collision with the /docs SPA route)
COPY docs/ /usr/share/nginx/html/docs-md/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
