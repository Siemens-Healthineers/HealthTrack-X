# Contributing

Thanks for your interest in HealthTrack-X. This project is being prepared for open-source publication; contribution processes may still evolve while the public child repository is created.

## Development Setup

Use the Kubernetes-based local workflow documented in [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md).

Prerequisites:

- Rancher Desktop with Kubernetes enabled
- Container runtime: dockerd (moby)
- kubectl
- Docker-compatible image build support

Local app startup:

```powershell
docker build -t htx-backend:local -f backend/Dockerfile . ; docker build -t htx-frontend:local -f frontend/Dockerfile .
kubectl apply -k k8s/overlays/local
kubectl get pods -n healthtrack-x
```

Optional Ollama-enabled local overlay:

```powershell
ollama pull mistral:7b
kubectl apply -k k8s/overlays/local-ollama
kubectl rollout restart deployment/htx-backend -n healthtrack-x
```

## Useful Checks

Frontend:

```powershell
cd frontend
npm install
npm run typecheck
npm run lint
```

Backend syntax smoke check:

```powershell
cd backend
python -m py_compile main.py material_classifier.py schema_validator.py
```

License check:

```powershell
.\scripts\check-licenses.ps1
```

## Pull Requests

Before opening a PR:

- Keep changes focused and avoid unrelated refactors.
- Update documentation when behavior or setup changes.
- Run relevant checks and mention any checks you could not run.
- Do not commit secrets, private keys, internal hostnames, real customer data, or local runtime caches.
- Keep deployment-specific values in private overlays, GitHub Secrets, or a secret manager.

## Commit Messages

Use concise Conventional Commit-style subjects where practical:

- `feat: ...`
- `fix: ...`
- `docs: ...`
- `refactor: ...`
- `chore: ...`

## Security Issues

Please do not report vulnerabilities through public issues. Follow [SECURITY.md](SECURITY.md).
