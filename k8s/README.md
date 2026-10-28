# HealthTrack-X – Kubernetes Deployment

Kustomize templates for Kubernetes. Azure AKS is an optional deployment target;
the local overlay uses K3s. The dev/prod overlays contain only example hostnames
and registry paths and must be adapted before deployment. No deployment workflow
or credentials for a private environment are included.

## Prerequisites

- Kubernetes cluster and `kubectl` configured for it
- An OCI registry accessible from the cluster
- An ingress controller; adapt `ingressClassName` to your controller (the base uses AKS App Routing)
- For AKS: [App Routing add-on](https://learn.microsoft.com/en-us/azure/aks/app-routing) and optionally Azure Container Registry
- (Optional) cert-manager + ClusterIssuer for auto-TLS

## Architecture

```
                    ┌─── Ingress (AKS App Routing) ───┐
                    │                                   │
        htx.example.com          auth.htx.example.com
                │                          │
        ┌───────▼────────┐      ┌──────────▼──────────┐
        │  htx-frontend  │      │    htx-keycloak     │
        │  (nginx SPA)   │      │    (OIDC IdP)       │
        └───────┬────────┘      └─────────────────────┘
                │ /api/
        ┌───────▼────────┐      ┌─────────────────────┐
        │  htx-backend   │─────▶│     htx-nats        │
        │  (FastAPI)     │      │   (JetStream)       │
        └────────────────┘      └─────────────────────┘
```

## Quick Start

### 1. Build & Push Images to ACR

> Replace `myregistry` below with your own Azure Container Registry name
> for this optional Azure example. Other OCI registries work equally well.
> Set every overlay image mapping to the path you actually push.

```powershell
# Login to ACR
az acr login --name myregistry

# Build and push backend
docker build -t myregistry.azurecr.io/htx-backend:latest -f backend/Dockerfile .
docker push myregistry.azurecr.io/htx-backend:latest

# Build and push frontend (with OIDC build args)
docker build -t myregistry.azurecr.io/htx-frontend:latest \
  --build-arg VITE_OIDC_AUTHORITY=https://auth.htx.example.com/realms/healthtrack-x \
  --build-arg VITE_OIDC_CLIENT_ID=healthtrackx-frontend \
  -f frontend/Dockerfile .
docker push myregistry.azurecr.io/htx-frontend:latest

# Build and push keycloak
docker build -t myregistry.azurecr.io/htx-keycloak:latest -f services/keycloak/Dockerfile .
docker push myregistry.azurecr.io/htx-keycloak:latest
```

### 2. Configure Secrets

The base secret contains insecure placeholders. Keep real values outside the
public tree, preferably using an external secret manager (for example Vault or
Azure Key Vault). Do not apply the base placeholder Secret over an existing
externally managed Secret; exclude it from your private deployment overlay.

```powershell
# Create secrets directly (not recommended for production)
kubectl create namespace healthtrack-x
kubectl -n healthtrack-x create secret generic htx-secrets \
  --from-literal=KC_ADMIN_USER=admin \
  --from-literal=KC_ADMIN_PASSWORD='<secure-password>' \
  --from-literal=KEYCLOAK_ADMIN_CLIENT_SECRET='<shared-keycloak-backend-client-secret>' \
  --from-literal=GITHUB_APP_ID=<your-app-id> \
  --from-literal=GITHUB_APP_INSTALLATION_ID=<your-installation-id> \
  --from-file=GITHUB_APP_PRIVATE_KEY=path/to/private-key.pem \
  --from-literal=GITHUB_REPO=<org/repo-name> \
  --from-literal=GITHUB_BASE_URL=<https://your-ghe-instance/api/v3> \
  --from-literal=JWT_SECRET=$(openssl rand -hex 32) \
  --from-literal=OAUTH_GITHUB_CLIENT_ID=<id> \
  --from-literal=OAUTH_GITHUB_CLIENT_SECRET=<secret>
```

`KEYCLOAK_ADMIN_CLIENT_SECRET` is shared by the Keycloak realm import and the
backend Admin API client. Keycloak substitutes this value into
`services/keycloak/import/healthtrack-x-realm.json` during `--import-realm`, and
the backend reads the same variable from `htx-secrets` at runtime. Keep both sides
on the same value; in production, source it from Azure Key Vault / Vault instead
of committing a real value.

### 3. Update Hostnames

Edit the overlay for your environment:

- **Dev:** `k8s/overlays/dev/kustomization.yaml` → replace `htx-frontend.example.com` and `htx-keycloak.example.com`
- **Prod:** `k8s/overlays/prod/kustomization.yaml` → replace the frontend, backend, and Keycloak `example.com` hosts, including TLS entries

Also update the overlay ConfigMap patches:
- `CORS_ORIGINS` → your frontend domain
- `KEYCLOAK_ISSUER` → your Keycloak public URL

The shipped Keycloak realm allows local URLs only. Add your own frontend origin,
redirect URIs and logout URIs to a private realm import before enabling remote
authentication. Keep these aligned with the frontend's OIDC build arguments.

### 4. Deploy

```powershell
# Preview manifests
kubectl kustomize k8s/overlays/dev

# Apply (dev)
kubectl apply -k k8s/overlays/dev

# Apply (prod)
kubectl apply -k k8s/overlays/prod
```

### 5. Verify

```powershell
kubectl -n healthtrack-x get pods
kubectl -n healthtrack-x get ingress
kubectl -n healthtrack-x logs deployment/htx-backend
```

## Updating the Application

```powershell
# Build new image
docker build -t myregistry.azurecr.io/htx-backend:1.1.0 -f backend/Dockerfile .
docker push myregistry.azurecr.io/htx-backend:1.1.0

# Rolling update
kubectl -n healthtrack-x set image deployment/htx-backend backend=myregistry.azurecr.io/htx-backend:1.1.0
```

Or update the tag in `kustomization.yaml` and re-apply.

## Directory Structure

```
k8s/
├── base/
│   ├── kustomization.yaml      # Ties all base resources together
│   ├── namespace.yaml          # healthtrack-x namespace
│   ├── configmap.yaml          # Non-secret environment variables
│   ├── secrets.yaml            # Secret placeholders (use Key Vault in prod)
│   ├── ingress.yaml            # AKS App Routing ingress rules
│   ├── backend/
│   │   ├── deployment.yaml     # FastAPI app (1+ replicas)
│   │   └── service.yaml        # ClusterIP :8000
│   ├── frontend/
│   │   ├── deployment.yaml     # nginx SPA (1+ replicas)
│   │   ├── service.yaml        # ClusterIP :80
│   │   └── configmap.yaml      # K8s-adapted nginx.conf
│   ├── keycloak/
│   │   ├── statefulset.yaml    # Keycloak with persistent data
│   │   ├── service.yaml        # ClusterIP :8080
│   │   └── pvc.yaml            # 1Gi persistent volume
│   └── nats/
│       ├── statefulset.yaml    # NATS JetStream with PVC
│       ├── service.yaml        # ClusterIP :4222 + :8222
│       └── configmap.yaml      # nats-server.conf
└── overlays/
    ├── dev/
    │   └── kustomization.yaml  # Dev: 1 replica, :latest, no TLS
    └── prod/
        └── kustomization.yaml  # Prod: 2 replicas, TLS, resource limits
```

## Local Development (Rancher Desktop)

Deploy HealthTrack-X on your local K3s cluster (Rancher Desktop) using the `local` overlay.

### Prerequisites

- [Rancher Desktop](https://rancherdesktop.io/) with Kubernetes enabled and container engine set to **dockerd (moby)**
- Add to `C:\Windows\System32\drivers\etc\hosts`:
  ```
  127.0.0.1  htx.local
  ```

### Steps

```powershell
# 1. Build images locally
docker build -t htx-backend:local -f backend/Dockerfile .
docker build -t htx-frontend:local -f frontend/Dockerfile `
  --build-arg VITE_OIDC_AUTHORITY="" `
  --build-arg VITE_OIDC_CLIENT_ID="" .

# 2. Deploy to K3s
kubectl apply -k k8s/overlays/local

# 3. Verify
kubectl get pods -n healthtrack-x
```

Access the app at **http://htx.local** and configure GitHub repositories in **Settings → GitHub**.

### Redeploying after code changes

```powershell
# Rebuild changed image(s)
docker build -t htx-frontend:local -f frontend/Dockerfile --build-arg VITE_OIDC_AUTHORITY="" --build-arg VITE_OIDC_CLIENT_ID="" .
docker build -t htx-backend:local -f backend/Dockerfile .

# Restart affected deployment(s)
kubectl rollout restart deployment htx-frontend -n healthtrack-x
kubectl rollout restart deployment htx-backend -n healthtrack-x
```

### Optional: local Ollama for AI tool testing

Azure/dev/prod overlays do not run Ollama. To test the ChatPanel and the
approval-based tool flow locally, use the dedicated `local-ollama` overlay.
It configures the backend to reach a **natively installed Ollama** on the host
(`host.docker.internal:11434`) — no Ollama container, no image pull required.

**Prerequisites:** [Ollama for Windows](https://ollama.com/download/windows)
installed and `mistral:7b` pulled:

```powershell
ollama pull mistral:7b
# Ollama runs as a background service after installation
```

**Deploy the app with Ollama support:**

```powershell
# Build the app images as usual
docker build -t htx-backend:local -f backend/Dockerfile .
docker build -t htx-frontend:local -f frontend/Dockerfile --build-arg VITE_OIDC_AUTHORITY="" --build-arg VITE_OIDC_CLIENT_ID="" .

# Deploy — backend is pointed to host.docker.internal:11434
kubectl apply -k k8s/overlays/local-ollama

kubectl rollout status deployment/htx-backend -n healthtrack-x
kubectl get pods -n healthtrack-x
```

Open **http://htx.local**, use the AI chat, and ask for a create/update/delete
operation. The model prepares a pending mutation preview and the frontend
approval dialog shows the diff before anything is written to GitHub.

Useful checks:

```powershell
# Confirm Ollama is reachable from the backend pod
kubectl exec -n healthtrack-x deployment/htx-backend -- python3 -c \
  "import urllib.request,json; d=json.load(urllib.request.urlopen('http://host.docker.internal:11434/api/tags')); print([m['name'] for m in d['models']])"

kubectl logs -n healthtrack-x deployment/htx-backend --tail=100 | Select-String "CHAT|Ollama"
```

### Notes (Local)

- The `local` overlay sets `imagePullPolicy: Never` so K3s uses locally built images.
- Auth is disabled (`AUTH_ENABLED=false`) and the local overlay scales Keycloak to 0 replicas.
- Frontend is built without OIDC args to skip the auth redirect.
- K3s-Traefik handles Ingress on port 80 for `htx.local`.

---

## Notes

- **Traefik is NOT used on AKS.** Docker Compose is supplementary only; the canonical local path is the `local` Kustomize overlay.
- **NATS** runs as a single-node StatefulSet. For HA, scale to 3 replicas with NATS clustering config.
- **Keycloak realm import** runs automatically on first start via `--import-realm` when Keycloak is enabled in dev/prod. It uses environment substitution for the backend client secret (`${KEYCLOAK_ADMIN_CLIENT_SECRET}`), so the Keycloak pod and backend pod must receive the same value. Subsequent starts use existing data from the PVC.
- **Frontend OIDC URLs** are baked at build time. Rebuild the image when changing the Keycloak domain.
