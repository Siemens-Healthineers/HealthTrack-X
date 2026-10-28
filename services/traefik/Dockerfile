# ── Traefik Dockerfile ───────────────────────────────────────
# Production reverse proxy with file-based dynamic configuration
# ─────────────────────────────────────────────────────────────

FROM traefik:v3.0

COPY services/traefik/traefik.yml /etc/traefik/traefik.yml
COPY services/traefik/dynamic.yml /etc/traefik/dynamic.yml

EXPOSE 80 443 8080
