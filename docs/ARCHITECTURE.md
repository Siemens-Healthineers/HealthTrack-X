# Architecture

System architecture overview for HealthTrack-X.

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Kubernetes (K3s)                         │
│                                                                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │ Frontend  │    │ Backend  │    │   NATS   │    │ Keycloak │  │
│  │ (nginx)   │───▶│ (FastAPI)│───▶│ JetStream│    │  (OIDC)  │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
│       │               │                                │        │
│       │               ▼                                │        │
│  ┌──────────┐    ┌──────────┐                          │        │
│  │ Traefik  │    │  GitHub  │                          │        │
│  │ (Ingress)│    │   API    │                          │        │
│  └──────────┘    └──────────┘                          │        │
└─────────────────────────────────────────────────────────────────┘
```

The local demo runs as pods in a K3s cluster managed by Rancher Desktop. Traefik routes the application through `htx.local`. Authentication is disabled locally by default, and the local overlay does not expose a Keycloak ingress; enabling local authentication requires separate configuration.

## Component Responsibilities

| Component | Technology | Purpose |
|---|---|---|
| Frontend | React 18, Vite, Tailwind, shadcn/ui | SPA with BOM viewer, forms, docs viewer, chat |
| Backend | FastAPI, Python 3.12 | REST API, GitHub operations, NATS publisher |
| NATS | JetStream (`nats:alpine`) | Async message queue for write operations |
| Keycloak | Keycloak 26 | OIDC identity provider (optional, `AUTH_ENABLED`) |
| Traefik | K3s built-in | Ingress controller, TLS termination |

## Backend Modules

| Module | Description |
|---|---|
| `main.py` | FastAPI app, REST endpoints, NATS consumer |
| `nats_client.py` | NATS JetStream connection and publish helpers |
| `job_store.py` | In-memory job status tracking |
| `github_app_service.py` | GitHub App token management |
| `github_config_manager.py` | Multi-repo configuration with encrypted credentials |
| `schema_validator.py` | YAML-driven field validation |
| `material_classifier.py` | Material classification against CRMA dataset |
| `crma_checker.py` | Critical Raw Materials Act compliance checks |
| `edc_connector.py` | Eclipse Dataspace Connector integration |
| `chat_agent.py` | Context-aware chat assistant |
| `auth.py` | Keycloak/OIDC token validation middleware |

---

## NATS JetStream

### Why Async?

Direct GitHub API calls take 3–8 seconds per operation. With NATS JetStream, the backend immediately acknowledges requests (< 50 ms) and processes them asynchronously.

### Request Flow

```
Browser ──▶ FastAPI ──▶ NATS JetStream ──▶ Consumer (in main.py) ──▶ GitHub API
                │                                     │
                ▼                                     ▼
          Job ID returned                      Job status updated
          immediately                          (pending → done/error)
```

### Key Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/write-json-async` | POST | Queue a write operation, returns job ID |
| `/api/job-status/{id}` | GET | Poll job status (pending/processing/done/error) |
| `/api/queue-stats` | GET | Queue depth and consumer status |

### Stream Configuration

- **Stream**: `JOBS`
- **Subject**: `jobs.pending`
- **Retention**: WorkQueue (each message processed once)
- **Max delivery attempts**: 3
- **Ack wait**: 30 seconds

### Queue Availability

If NATS is not ready, the backend returns a retryable `503` instead of writing through a hidden synchronous path. This keeps all frontend writes on the same validated queue/worker flow.

---

## GitHub Integration

### Authentication

HealthTrack-X uses **GitHub Apps** for repository access:

- Fine-grained permissions (Contents: Read/Write only)
- Automatic token rotation (1-hour expiry)
- Per-installation scoping (not tied to a user account)

Credentials are stored encrypted in `backend/config/github_config.json` using Fernet symmetric encryption. The encryption key is at `backend/config/.github_config.key`.

### Multi-Repository Support

The backend supports multiple GitHub repository configurations simultaneously. Each configuration stores:

- GitHub App ID and Installation ID
- Encrypted private key
- Target repository and branch
- Owner/organization

Configurations are managed through the Settings UI in the frontend or via the `/api/github-configs` REST endpoints.

### Data Flow

1. User submits product data through the frontend
2. Backend validates against YAML schema
3. Data is published to NATS JetStream
4. Consumer creates/updates JSON files in the configured GitHub repository
5. Job status is tracked and queryable by the frontend

---

## EDC Connector

The Eclipse Dataspace Connector integration (`edc_connector.py`) enables:

- **Asset registration** of product data in a dataspace catalog
- **Contract negotiation** with dataspace participants
- **Policy management** for data usage agreements
- **Data transfer** via EDC transfer processes

Endpoints are available under `/api/edc/*`.

---

## MCP Server

A Model Context Protocol server (`mcp-server/server.py`) exposes backend capabilities to AI assistants:

- Product data queries
- Repository metadata
- Schema information
- Material classification

Configuration: `mcp-server/mcp.json`

---

## Kubernetes Layout

```
k8s/
├── base/                    # Base manifests (deployments, services, configmaps)
└── overlays/
    ├── local/                # Rancher Desktop/K3s demo overlay
    ├── dev/                  # Azure dev overlay
    └── prod/                 # Azure production overlay
```

The local overlay configures:
- `imagePullPolicy: Never` (use local Docker cache)
- 1 replica per service
- `AUTH_ENABLED=false`
- Keycloak scaled to 0 replicas for the local no-login demo path
- Traefik ingress rules for `htx.local`
