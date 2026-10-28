# License Analysis

License compatibility assessment for HealthTrack-X.

## Summary

The project uses the **MIT License**. All dependencies are compatible.

Last intermediate re-check: **2026-06-24** via `scripts/check-licenses.ps1`.
The frontend report excludes private root packages so the app package itself is
not counted as an `UNLICENSED` third-party dependency.

## Backend Dependencies

Analysis based on `docs/licenses-backend.json`.

| License | Count | Notable Packages |
|---|---|---|
| MIT | Majority | FastAPI, uvicorn, pydantic, httpx |
| Apache 2.0 | Several | PyNaCl, cryptography, google-* |
| BSD (2/3-Clause) | Several | click, MarkupSafe, idna |
| LGPL 2.1+ | 1 | PyGithub |
| MPL 2.0 | 1 | certifi |
| PSF | Several | Python stdlib wrappers |

### LGPL Note (PyGithub)

PyGithub is licensed under LGPL 2.1+. Since it is used as an unmodified library (imported, not statically linked), this is compatible with MIT distribution. No source disclosure is required for the application itself.

### MPL Note (certifi)

certifi is licensed under MPL 2.0. MPL is file-level copyleft — modifications to certifi itself must be shared, but it does not affect the rest of the project.

## Frontend Dependencies

Analysis based on `docs/licenses-frontend.json`.

All frontend dependencies use permissive licenses:

| License | Count |
|---|---|
| MIT | ~95% |
| ISC | Several |
| BSD | Few |
| Apache 2.0 | Few |

No copyleft licenses in the frontend dependency tree.

## Compliance Checklist

- [x] All licenses reviewed and documented
- [x] No GPL-only dependencies (which would require full source disclosure)
- [x] LGPL dependency (PyGithub) used as dynamic import — compatible with MIT
- [x] MPL dependency (certifi) used unmodified — compatible with MIT
- [x] License files preserved in `node_modules/` and Python packages
- [x] SBOM files generated in `compliance/` (CycloneDX format)

## Regenerating License Data

```powershell
powershell -File scripts/check-licenses.ps1
```
