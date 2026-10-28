# ── Keycloak Dockerfile ──────────────────────────────────────
# Development-only configuration with realm auto-import.
# Production must use HTTPS + PostgreSQL + proper secret storage.
# ─────────────────────────────────────────────────────────────

FROM quay.io/keycloak/keycloak@sha256:4883630ef9db14031cde3e60700c9a9a8eaf1b5c24db1589d6a2d43de38ba2a9

# Copy custom login theme
COPY services/keycloak/themes/healthtrackx/ /opt/keycloak/themes/healthtrackx/

# Copy realm configuration outside /opt/keycloak/data/ so a PVC mount
# on that path doesn't hide the import files.
COPY services/keycloak/import/ /opt/keycloak-bootstrap/

ARG KC_ADMIN_USER=admin
ARG KC_ADMIN_PASSWORD=admin

ENV KC_HTTP_ENABLED=true \
    KC_HOSTNAME_STRICT=false \
    KC_BOOTSTRAP_ADMIN_USERNAME=${KC_ADMIN_USER} \
    KC_BOOTSTRAP_ADMIN_PASSWORD=${KC_ADMIN_PASSWORD}

EXPOSE 8080

# At startup, copy staged realm files into the import directory
# (works whether /opt/keycloak/data/ is a PVC or image layer),
# then exec Keycloak with all CMD arguments.
ENTRYPOINT ["/bin/bash", "-c", "mkdir -p /opt/keycloak/data/import && cp /opt/keycloak-bootstrap/*.json /opt/keycloak/data/import/ 2>/dev/null; exec /opt/keycloak/bin/kc.sh \"$@\"", "--"]
CMD ["start-dev", "--import-realm"]
