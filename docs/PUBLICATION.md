# Public Release Checklist

HealthTrack-X source is licensed under MIT; see [License.md](../License.md).
Dependency licenses, third-party notices, trademarks and rights to visual assets
remain separate obligations. MIT licensing does not grant rights to private data.

## Public Defaults

- No configured GitHub repositories, credentials, product data or CAD example BOM.
- GitHub storage remains optional and configurable for an operator's own repositories.
- Profile association uses data-folder names, not organisation or repository names.
- Repository metadata caches are limited to currently configured repositories.
- Docker builds exclude local configuration, keys, environment files, caches and logs.
- Kubernetes dev/prod files are templates with example domains and registry paths.
- CI checks source without access to private deployment credentials or infrastructure.

Existing local configurations, browser storage, PVCs, NATS queues and CAD caches
are operator data, not public defaults. Do not publish or reuse them for release
screenshots, image builds or clean-install verification. Do not delete operational
volumes to test a release; use an isolated environment with fresh volumes instead.
Compose deliberately mounts the operator's local backend configuration.

## Required Checks

```powershell
npm --prefix frontend ci
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
python -m unittest discover -s backend/scripts -p test_publication.py -v
kubectl kustomize k8s/overlays/local
kubectl kustomize k8s/overlays/dev
kubectl kustomize k8s/overlays/prod
docker compose config --quiet
```

The publication tests reject known internal identifiers and private runtime files
in tracked and non-ignored new files. This is a regression guard, not a complete
secret scanner, history audit, or legal approval.

## Maintainer Release Gates

- [ ] Confirm the private operational repository and deployments work independently.
- [ ] Run a dedicated secret scanner on the final source and every reachable Git ref.
- [ ] Rotate any credentials ever committed; deleting files does not revoke secrets.
- [ ] Prepare a clean public history with approved author metadata. Preserve the private history separately.
- [ ] Review branches, tags, pull-request refs, Actions logs/artifacts, releases, packages and server caches. Involve hosting support where required.
- [ ] Review images, diagrams, PDFs, branding and dependency notices for publication rights and private data.
- [ ] Regenerate and review dependency-license reports and SBOMs for the exact release revision.
- [ ] Verify a fresh clone and fresh-volume installation, including empty repository and CAD views.
- [ ] Enable private vulnerability reporting and publish a private community-reporting contact.
- [ ] Obtain the required legal, security and repository-owner approvals before changing visibility.

These are manual release gates. Source cleanup and passing CI alone do not prove
that the repository is ready to change visibility. Never rewrite remote history,
delete remote refs or make the repository public without explicit owner approval.