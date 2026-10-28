# Authentication

HealthTrack-X uses Keycloak as OIDC identity provider. Authentication is **disabled by default** in the local development overlay (`AUTH_ENABLED=false`). The local overlay also scales Keycloak to 0 replicas for the no-login development path.

## Auth Requirements by Deployment

| Target | Keycloak required? | Default config |
|---|---:|---|
| Local Rancher Desktop/K3s | Optional | `AUTH_ENABLED=false`, `htx-keycloak` replicas `0` |
| Azure dev/prod | Yes | `AUTH_ENABLED=true`, `htx-keycloak` replicas `1` |

Do not use the local no-auth overlay as a model for Azure. Azure deployments inherit the base authentication settings and must have working Keycloak secrets, realm import, and frontend redirect URLs.

## Architecture

- Keycloak realm: `healthtrack-x`
- Frontend: OIDC Authorization Code Flow with PKCE (`oidc-client-ts`)
- Backend: JWT validation on protected `/api/*` endpoints
- Public endpoints: health, status, docs (configurable via `AUTH_PUBLIC_PATHS`)

## Local Keycloak Demonstrator

The local setup runs through the Kubernetes `local` overlay. For the demo path, `kubectl apply -k k8s/overlays/local` keeps authentication disabled and does not start a Keycloak pod.

### Demo Users

Demo user credentials are configured in the Keycloak realm import.
See `services/keycloak/import/` for details.

| User | Role |
|---|---|
| `htx-admin` | `admin` |
| `htx-viewer` | `viewer` |

> **Note:** Passwords are not stored in documentation. Check the env files or Keycloak Admin Console for credentials.

### Browser Setup for PKCE (one-time)

The local environment runs over HTTP. OIDC/PKCE requires `crypto.subtle`, which is only available in secure contexts. For `http://htx.local`:

1. Open Chrome → `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. Enter: `http://htx.local,http://auth.htx.local`
3. Set to **Enabled** → Relaunch

> This is only needed when `AUTH_ENABLED=true`. The local overlay defaults to `false`.

### Manual Keycloak Start

```powershell
docker build -t htx-keycloak:local -f services/keycloak/Dockerfile .
kubectl scale statefulset/htx-keycloak -n healthtrack-x --replicas=1
```

Use this only when explicitly testing local authentication. The default local demo path should remain `AUTH_ENABLED=false`.

### Keycloak Realm Changes

The realm configuration is at `services/keycloak/import/healthtrack-x-realm.json`. Keycloak imports the realm only on an empty database (`IGNORE_EXISTING` strategy).

To apply realm changes, delete the PVC and redeploy:

```powershell
kubectl delete statefulset htx-keycloak -n healthtrack-x
kubectl delete pvc keycloak-data -n healthtrack-x
kubectl apply -k k8s/overlays/local
kubectl scale statefulset/htx-keycloak -n healthtrack-x --replicas=1
```

## Rollout Status

### Phase 1: Local Keycloak ✅

- [x] Keycloak container with dev storage
- [x] Realm `healthtrack-x` with clients, roles, demo users
- [x] Keycloak manifests and realm import prepared for dev/prod and optional local auth testing

### Phase 2: Backend Enforcement 🚧

- [x] Auth middleware with `AUTH_ENABLED` flag
- [x] Public endpoint allowlist (`AUTH_PUBLIC_PATHS`)
- [x] `/api/auth/status` for frontend bootstrapping
- [ ] Role-based access control on write/delete endpoints
- [ ] Verify 401/503 behavior for missing/invalid tokens

### Phase 3: Frontend Login ✅

- [x] OIDC Authorization Code Flow with PKCE
- [x] `AuthProvider` and `AuthGate` around app routes
- [x] Token provider via `setAccessTokenProvider()`
- [x] Redirect unauthenticated users to Keycloak

### Phase 4: Service Accounts

- [ ] Client credentials flow for MCP server
- [ ] Service account for backend-to-backend calls

### Phase 5: Production Hardening

- [ ] HTTPS with proper certificates
- [ ] Exact CORS origins (no wildcards)
- [ ] Persistent Keycloak database (PostgreSQL)
- [ ] Secret management (Azure Key Vault or similar)
