# Getting Started

HealthTrack-X can run directly on Windows without containers, or on Kubernetes.

## Windows: Double-Click Start

1. Install Python 3.12 or newer with pip and Node.js 22 LTS with npm. Make both
    available on PATH (or install the Python launcher). Restart terminals after
    installing them. Python 3.12 is the reference runtime.
2. Double-click [START.bat](../START.bat) in the repository root.
3. Wait for the browser to open at http://127.0.0.1:5173 (or a free fallback port).
   The first start installs
    dependencies and downloads the official NATS binary with checksum validation.
4. Keep the start window open. Press Enter in that window to stop the services.

No Rancher, Docker, Kubernetes, hosts-file entry or administrator rights are
required. The launcher checks frontend/backend readiness, CSS and CORS before
opening the browser. `AUTH_ENABLED=false` is enforced for this local run; do not
use it as an authenticated production deployment. GitHub, NX, Ollama, EDC and MCP
are optional integrations, not automatically installed services. Local `.env`
and GitHub settings remain in effect, except the launcher overrides local
service addresses, CORS and authentication in its own process environment.

| Service | URL |
|---|---|
| Frontend | http://127.0.0.1:5173 |
| Backend API / OpenAPI | http://127.0.0.1:8000/docs |
| NATS monitoring | http://127.0.0.1:8222 |

Logs (`backend.log`, `backend.error.log`, `frontend.log`, `frontend.error.log`,
`nats.log`, `nats.error.log`) and NATS persistence are stored under `.local`.
Python packages are installed in `.venv`; frontend packages in
`frontend/node_modules`. These directories are not published in Git.

### Native Start Troubleshooting

- **Port occupied:** standard ports automatically fall back to free ports; the
   start window prints the selected addresses and opens the correct browser URL.
   Existing services are never stopped. Explicit ports must be free, for example
   `.\START.bat -BackendPort 18000 -FrontendPort 15173 -NatsPort 14222 -MonitorPort 18222`.
- **Download or certificate failure:** configure your organization's trusted CA
   and proxy for PowerShell, pip and npm. TLS verification is not disabled.
- **Missing runtime:** install Python/Node.js as described above; the launcher
   does not install system runtimes or request elevation.
- **Backend fails:** inspect `.local/backend.error.log`. Existing local
   configuration may refer to container-only hostnames; update optional service
   URLs to native/external endpoints when needed.
- **Unexpected service exit:** inspect the matching `.local` log, press Enter in
   the launcher to clean up its remaining services, then start again.
- **Window forcibly closed:** normal cleanup is guaranteed only when exiting
   with Enter or after a handled startup error. If orphan processes remain, stop
   those processes before restarting; their data is retained.

`START.bat -Check` checks prerequisites and ports without installing or starting
services. `START.bat -SmokeTest` installs missing dependencies, starts the core
stack, tests readiness/CSS/CORS, and stops its services without opening a browser.
The existing [START-LOCAL.bat](../START-LOCAL.bat) and [INSTALL.bat](../INSTALL.bat)
remain Kubernetes start/tooling helpers; neither is needed for the native start.

## Alternative: Rancher Desktop and Kubernetes

## Prerequisites

| Requirement | Notes |
|---|---|
| [Rancher Desktop](https://rancherdesktop.io/) | Kubernetes (K3s) enabled |
| Container Runtime: **dockerd (moby)** | Rancher Desktop → Preferences → Container Engine → dockerd |
| `kubectl` | Included with Rancher Desktop |

> Python and Node.js are **not** required locally — everything runs in containers.

## 1. Configure Hosts File (one-time, as Administrator)

Open `C:\Windows\System32\drivers\etc\hosts` and add:

```
127.0.0.1  htx.local
```

## 2. Configure Environment

Local configuration runs through Kubernetes resources and the app UI. A fresh
installation has no configured GitHub repositories, product records, or CAD
example BOM. Connecting your own data source is optional. After deployment,
enter your GitHub App values in **Settings → GitHub**; the backend stores them
on its persistent volume. Existing installations retain their own stored data.

### GitHub App Setup

1. GitHub Settings → Developer settings → GitHub Apps → **New GitHub App**
2. Set **Repository permissions → Contents: Read and write**
3. Install on your target repository
4. Note the **App ID** and **Installation ID**
5. Generate and download the private key (`.pem` file)

> **Repository profile convention:** product fields and table columns are loaded
> dynamically from each repository's `.github/repository-metadata.yml`. The
> UI profiles are associated by data-folder names containing `raw-material`,
> `semi-finished-good`, `medical-device`, or `finished-product`. Repository names
> are unrestricted. Each profile uses the first configured repository with a
> matching folder. Profiles without a matching folder remain unassigned.

### Optional Compose Authentication

The supplementary `docker compose up --build` stack runs without authentication.
Before enabling `--profile auth`, set your own `KC_ADMIN_PASSWORD` and
`KEYCLOAK_ADMIN_CLIENT_SECRET` in the shell or a root `.env` file. No default
password or backend client secret is supplied. The backend and Keycloak must
receive the same client secret. Never commit your `.env` file.

Convert the private key for environment usage:

```powershell
python backend/scripts/convert_key.py path\to\your-app.private-key.pem
```

## 3. Build Container Images

```powershell
docker build -t htx-backend:local -f backend/Dockerfile . ; docker build -t htx-frontend:local -f frontend/Dockerfile .
```

> NATS is pulled directly from Docker Hub (`nats:alpine`) — no local build needed.

## 4. Deploy to Kubernetes

```powershell
kubectl apply -k k8s/overlays/local
```

The local overlay disables Keycloak (`AUTH_ENABLED=false`, `htx-keycloak` scaled
to 0 replicas), so no local Keycloak image or login setup is required for the
standard demo path.

## 5. Verify

```powershell
kubectl wait --for=condition=ready pod --all -n healthtrack-x --timeout=180s
kubectl get pods -n healthtrack-x
```

Once all pods show `Running`/`Ready`:

| Service | URL |
|---|---|
| Frontend | http://htx.local |
| Backend API | http://htx.local/api |
| Keycloak | disabled in the local overlay |

## 6. Optional: AI Chat with Native Ollama

The core app runs without Ollama. To test the ChatPanel and approval-based AI
mutation flow locally, install Ollama on Windows and use the `local-ollama`
overlay. This overlay points the backend at the host service via
`host.docker.internal:11434`; it does not run an Ollama container in K3s.

```powershell
ollama pull mistral:7b
kubectl apply -k k8s/overlays/local-ollama
kubectl rollout restart deployment/htx-backend -n healthtrack-x
```

Verify from the backend pod:

```powershell
kubectl exec -n healthtrack-x deployment/htx-backend -- python -c "import urllib.request; print(urllib.request.urlopen('http://host.docker.internal:11434/api/tags', timeout=10).read().decode()[:200])"
```

## Quick Reference

| Task | Command |
|---|---|
| Deploy / Update | `kubectl apply -k k8s/overlays/local` |
| Deploy with local Ollama | `kubectl apply -k k8s/overlays/local-ollama` |
| Check status | `kubectl get pods -n healthtrack-x` |
| Restart all services | `kubectl rollout restart deployment,statefulset -n healthtrack-x` |
| Restart backend only | `kubectl rollout restart deployment/htx-backend -n healthtrack-x` |
| Restart frontend only | `kubectl rollout restart deployment/htx-frontend -n healthtrack-x` |
| View logs | `kubectl logs -n healthtrack-x -l app.kubernetes.io/name=backend -f` |
| Remove everything | `kubectl delete -k k8s/overlays/local` |

## Development Workflow

1. Make code changes
2. Rebuild the affected image:
   ```powershell
   docker build -t htx-frontend:local -f frontend/Dockerfile .
   ```
3. Restart the pod:
   ```powershell
   kubectl rollout restart deployment/htx-frontend -n healthtrack-x
   ```

> `rollout restart` performs a rolling restart — backend configuration and NATS streams are preserved in PVCs. Only deleting the PVCs resets persistent data.

## Local Overlay Details

The Kustomize overlay at `k8s/overlays/local` provides:

- 1 replica per deployment (conserve resources)
- Traefik ingress via K3s (`htx.local` only; local authentication is disabled)
- Images from local Docker cache (`htx-backend:local`, etc.)
- `AUTH_ENABLED=false` and `htx-keycloak` scaled to 0 replicas — no login required for local development
- NATS from Docker Hub (`nats:alpine`)

The `local-ollama` overlay inherits `local` and only adds Ollama-related backend
environment variables. Keep Ollama native on the host to avoid large image pulls
in local corporate-network setups.
