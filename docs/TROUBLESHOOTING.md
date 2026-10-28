# Troubleshooting

Common issues and solutions for the local HealthTrack-X environment.

## Pods Not Starting

```powershell
kubectl describe pod <pod-name> -n healthtrack-x
kubectl logs <pod-name> -n healthtrack-x
```

### ImagePullBackOff / ErrImageNeverPull

The container image was not built locally or has the wrong tag.

**Fix:**
```powershell
docker build -t htx-backend:local -f backend/Dockerfile .
docker build -t htx-frontend:local -f frontend/Dockerfile .
# Only needed when explicitly testing local auth:
docker build -t htx-keycloak:local -f services/keycloak/Dockerfile .
```

**Verify:**
```powershell
docker images | Select-String htx
```

### CrashLoopBackOff

Check the previous container's logs:

```powershell
kubectl logs -n healthtrack-x <pod-name> --previous
```

Common causes: missing environment variables, configuration errors, port conflicts.

## NATS Issues

### NATS Not Reachable

Check the NATS pod status:

```powershell
kubectl get pods -n healthtrack-x -l app.kubernetes.io/name=nats
kubectl logs -n healthtrack-x -l app.kubernetes.io/name=nats
```

The backend keeps frontend writes on the NATS queue path. If NATS is unavailable during startup, write requests return a retryable `503`; check backend logs for connection messages:

```powershell
kubectl logs -n healthtrack-x -l app.kubernetes.io/name=backend | Select-String "NATS"
```

### Jobs Stuck in Pending

If jobs stay in `pending` status, the NATS consumer may have disconnected:

```powershell
kubectl rollout restart deployment/htx-backend -n healthtrack-x
```

Check queue depth via the API:

```
GET http://htx.local/api/queue-stats
```

## CORS Errors

### Keycloak CORS

If `Access-Control-Allow-Origin` is missing on Keycloak responses, the realm client doesn't include the frontend origin in `webOrigins`.

**Fix:** Reset the Keycloak realm:
```powershell
kubectl delete statefulset htx-keycloak -n healthtrack-x
kubectl delete pvc keycloak-data -n healthtrack-x
kubectl apply -k k8s/overlays/local
kubectl scale statefulset/htx-keycloak -n healthtrack-x --replicas=1
```

## Login Fails (crypto.subtle)

`crypto.subtle` is `undefined` under HTTP (only available in secure contexts).

**Fix:** Set the Chrome flag — see [Authentication](AUTHENTICATION.md#browser-setup-for-pkce-one-time).

**Alternative:** Authentication is disabled by default in the local overlay (`AUTH_ENABLED=false`).

## GitHub Integration

### Authentication Errors

Test the GitHub connection:

```powershell
python backend/scripts/test_github_connection.py
```

Check that the GitHub App credentials are correctly configured in the Settings UI or in `backend/config/github_config.json`.

### Write Operations Failing

Check backend logs for GitHub API errors:

```powershell
kubectl logs -n healthtrack-x -l app.kubernetes.io/name=backend -f | Select-String "GitHub"
```

Common causes:
- GitHub App not installed on the target repository
- Insufficient permissions (needs Contents: Read/Write)
- Private key expired or incorrectly formatted

## Complete Reset

To start fresh with all data cleared:

```powershell
kubectl delete -k k8s/overlays/local
kubectl apply -k k8s/overlays/local
```

> This deletes all PVCs (Keycloak users, NATS streams). Rebuild images first if code has changed.
