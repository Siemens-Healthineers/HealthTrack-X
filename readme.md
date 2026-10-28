# HealthTrack-X

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](License.md)

A full-stack platform for product data management, Digital Product Passports (DPP),
and supply chain traceability — built with **React**, **FastAPI**, and GitHub-backed
storage, deployed on **Kubernetes**.

> **In-app documentation:** after starting the app, open the *Documentation*
> section for the rendered guides.

## Highlights

- **Product data management** for raw materials, semi-finished goods, and finished products (ROH/HALB/FERT)
- **BOM visualization & search** with an interactive supply-chain view
- **Digital Product Passport** export (JSON-LD) and **AAS** export (IEC 63278)
- **AI material classification** (Critical Raw Materials Act) and a context-aware **chat agent**
- **NATS JetStream** async write pipeline to **GitHub** repositories
- **Keycloak / OIDC** authentication (optional; disabled in the local demo)

See the full capability matrix and edition breakdown in [docs/FEATURES.md](docs/FEATURES.md).

## Documentation

Start at the [Documentation Index](docs/DOCUMENTATION-INDEX.md). Key entries:

| Topic | Document |
|---|---|
| Local setup (Windows double-click or Kubernetes) | [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) |
| Azure (AKS) deployment | [k8s/README.md](k8s/README.md) |
| Authentication (Keycloak / OIDC) | [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) |
| System architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Troubleshooting | [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) |
| Dependency licenses | [docs/LICENSE-ANALYSIS.md](docs/LICENSE-ANALYSIS.md) |
| Publication checklist | [docs/PUBLICATION.md](docs/PUBLICATION.md) |

## Quick Start (Windows, No Containers)

Install **Python 3.12 or newer** and **Node.js 22 LTS**, then double-click
[START.bat](START.bat). No Rancher, Docker, Kubernetes, Java, or administrator
rights are required. Internet access is needed for the first start.

The launcher creates/reuses `.venv`, installs backend/frontend dependencies,
downloads NATS 2.12.1 from the official release with SHA-256 verification, and
starts NATS JetStream, FastAPI, and Vite on loopback only. The browser opens at
http://127.0.0.1:5173 after readiness checks succeed (or at an automatically
selected free port if 5173 is occupied). Keep the start window open;
press Enter there to stop the services. Logs and persistent NATS data are stored
in the git-ignored `.local` directory.

Authentication is disabled in this local mode; Keycloak is not started. Existing
local `.env` files and GitHub configuration are retained, so an existing checkout
may connect to its configured repositories. A fresh checkout contains no demo
repositories or CAD example BOM. GitHub, NX, Ollama, EDC and MCP are optional
integrations and require their own configuration/services when used.

If default ports are occupied, the launcher automatically selects free ports and
opens the matching browser URL. No existing service is stopped. You can also
request fixed ports explicitly; these must be available:

```powershell
.\START.bat -BackendPort 18000 -FrontendPort 15173 -NatsPort 14222 -MonitorPort 18222
```

For a non-mutating prerequisites check or an automated start/stop smoke test:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-native.ps1 -Check
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-native.ps1 -SmokeTest
```

The smoke test checks NATS readiness, the backend, frontend CSS compilation and
CORS, then stops the processes it started. It does not write products to GitHub.
See [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) for troubleshooting.

## Alternative: Rancher Desktop + K3s

> Prerequisites: Rancher Desktop with Kubernetes (K3s) and the **dockerd (moby)**
> container engine, plus `kubectl`. Python and Node.js are **not** required —
> everything runs in containers. Full details in [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md).

```powershell
# 1. Map the local hostnames (one-time, as Administrator)
#    Add to C:\Windows\System32\drivers\etc\hosts:
#    127.0.0.1  htx.local

# 2. Build the images
docker build -t htx-backend:local -f backend/Dockerfile .
docker build -t htx-frontend:local -f frontend/Dockerfile .

# 3. Deploy to the local cluster (Keycloak is disabled in this overlay)
kubectl apply -k k8s/overlays/local

# 4. Wait for the local pods to become ready, then inspect status
kubectl wait --for=condition=ready pod --all -n healthtrack-x --timeout=180s
kubectl get pods -n healthtrack-x
```

Once all pods are `Running`/`Ready`:

A fresh installation starts without configured GitHub repositories or product
data. The CAD view contains no example BOM; it displays only assemblies you
explicitly import from your own NX session. Configure your own repositories in
Settings when needed. Existing persistent volumes retain their data.

| Service | URL |
|---|---|
| Frontend | http://htx.local |
| Backend API | http://htx.local/api |
| Keycloak | disabled in the local overlay (`AUTH_ENABLED=false`) |

For code changes, rebuild the affected image and restart the matching deployment
(for example `kubectl rollout restart deployment/htx-backend -n healthtrack-x`).

## Kubernetes Deployment

Production templates (Kustomize overlays, ingress, secrets) and image publishing
are documented in [k8s/README.md](k8s/README.md). The dev/prod overlays use
`example.com` hostnames and an example registry; configure them before deployment.
Azure AKS is one supported target, not a requirement. On Kubernetes, runtime
configuration comes from a ConfigMap and a Secret — not from `.env` files. Real
deployment secrets should be provided through a secret manager such as Azure Key
Vault or Vault and exposed to the pods through the `htx-secrets` interface.

## Quality Checks

The public-friendly CI workflow runs checks that do not require Azure access,
container registry credentials, or deployment secrets.

Frontend:

```powershell
cd frontend
npm ci
npm run typecheck
npm run lint
```

Backend syntax smoke check:

```powershell
python -m py_compile backend/main.py backend/material_classifier.py backend/schema_validator.py backend/github_config_manager.py backend/keycloak_admin.py backend/job_store.py backend/nats_client.py
python -m unittest discover -s backend/scripts -p test_publication.py -v
```

License/dependency report:

```powershell
.\scripts\check-licenses.ps1
```

## Architecture

```
Frontend (nginx SPA) ──▶ Backend (FastAPI) ──▶ NATS JetStream ──▶ GitHub API
                              │
                              └──▶ Keycloak (OIDC, optional)
```

The backend exposes a REST API, validates data against YAML schemas, and queues
write operations on NATS JetStream; a background worker persists JSON files to the
configured GitHub repository. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for
the full design.

## Status / Limitations

HealthTrack-X is a demonstrator and is not production-ready as-is. The current
write endpoints and AI agent workflow do not enforce fine-grained authorization:
an authenticated and approved user, and the agent acting on that user's behalf,
can read, write, update, and delete repository-backed data. Do not deploy the app
in a production or multi-tenant environment without adding appropriate
authorization controls around write operations and agent actions.

## Tech stack

- **Backend:** FastAPI, Uvicorn, PyGithub, NATS (JetStream), Python 3.12
- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui, Radix UI
- **Infrastructure:** Kubernetes (Kustomize), Traefik (local) / AKS App Routing, Keycloak

## Security

- Secrets are never committed: `.env` files are git-ignored, and Kubernetes secrets
  use placeholders meant to be replaced (ideally via Azure Key Vault).
- The Keycloak backend client secret is shared by the Keycloak realm import and
  the backend Admin API client. Both read `KEYCLOAK_ADMIN_CLIENT_SECRET` from the
  runtime secret interface, so keep the value identical when externalizing it.
- GitHub access uses a **GitHub App** with fine-grained, repository-scoped permissions
  and automatically rotating installation tokens (1-hour expiry).
- CORS is restricted to the configured frontend origin.

## Project layout

```
backend/    FastAPI app, NATS worker, GitHub integration, config templates
frontend/   React + Vite SPA
k8s/        Kustomize base and per-environment overlays (local/dev/prod)
services/   Keycloak (realm import, theme), supporting service assets
docs/        Project documentation
```

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss
the proposed direction.

## License

See [License.md](License.md).

## Trademarks

"Asset Administration Shell" (AAS) and the AAS logo are trademarks of the
Industrial Digital Twin Association (IDTA). They are referenced in this project
for identification and interoperability purposes only.

Other product, service, and organisation names used in this project are the
trademarks of their respective owners and are referenced only for identification
and interoperability — including Keycloak (CNCF), GitHub (Microsoft), NATS
(CNCF/Synadia), and the Catena-X, Tractus-X, and Eclipse Dataspace Connector
(EDC) dataspace projects. Their use does not imply any affiliation with or
endorsement by those owners.
