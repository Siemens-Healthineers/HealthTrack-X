# Documentation Index

Welcome to the HealthTrack-X documentation. HealthTrack-X is deployed as containers, either locally through Rancher Desktop/K3s or on Azure Kubernetes Service.

## Quick Navigation by Target

- **Local development:** Start with [GETTING-STARTED.md](GETTING-STARTED.md) for the Rancher Desktop/K3s setup.
- **Azure deployment:** Use [../k8s/README.md](../k8s/README.md) for AKS manifests, overlays, ingress, and secrets.
- **Authentication:** Read [AUTHENTICATION.md](AUTHENTICATION.md) before changing Keycloak or `AUTH_ENABLED` values.

## Local Development

- [GETTING-STARTED.md](GETTING-STARTED.md) — Prerequisites, setup, first deployment
- [AUTHENTICATION.md](AUTHENTICATION.md) — Auth setup and why the local overlay disables Keycloak by default

## Production Deployment

- [../k8s/README.md](../k8s/README.md) — AKS manifests, overlays, ingress, secrets, and rollout commands

## Features

- [FEATURES.md](FEATURES.md) — Implemented capabilities, use cases, feature matrix

## Architecture

- [ARCHITECTURE.md](ARCHITECTURE.md) — System design, NATS JetStream, GitHub integration, EDC connector

## Operations

- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — Common issues, diagnostic commands, solutions

## Compliance

- [LICENSE-ANALYSIS.md](LICENSE-ANALYSIS.md) — Dependency licenses, compatibility assessment
