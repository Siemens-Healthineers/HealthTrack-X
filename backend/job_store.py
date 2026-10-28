"""In-memory job status tracker for frontend polling."""

import time
from typing import Final, Optional

_jobs: dict[str, dict] = {}
_JOB_TTL: Final[int] = 3600       # prune completed/failed jobs after 1 h
_PRUNE_INTERVAL: Final[int] = 300  # check at most every 5 min
_TERMINAL: Final[frozenset[str]] = frozenset({"completed", "failed"})
_last_prune: float = 0.0


def _maybe_prune() -> None:
    global _last_prune
    now = time.time()
    if now - _last_prune < _PRUNE_INTERVAL:
        return
    _last_prune = now
    cutoff = now - _JOB_TTL
    stale = [jid for jid, j in _jobs.items()
             if j["status"] in _TERMINAL and j["updated_at"] < cutoff]
    for jid in stale:
        del _jobs[jid]


def create_job(job_id: str, payload: dict) -> dict:
    """Register a new job with status 'queued'."""
    _maybe_prune()
    now = time.time()
    job = {
        "job_id": job_id,
        "status": "queued",
        "payload": payload,
        "error": None,
        "product_id": None,
        "github_url": None,
        "github_raw_url": None,
        "aas_github_url": None,
        "created_at": now,
        "updated_at": now,
    }
    _jobs[job_id] = job
    return job


def update_status(
    job_id: str,
    status: str,
    *,
    product_id: Optional[str] = None,
    github_url: Optional[str] = None,
    github_raw_url: Optional[str] = None,
    aas_github_url: Optional[str] = None,
    error_message: Optional[str] = None,
):
    """Update job status and optional result fields."""
    job = _jobs.get(job_id)
    if job is None:
        return
    job["status"] = status
    job["updated_at"] = time.time()
    updates = {"product_id": product_id, "github_url": github_url,
               "github_raw_url": github_raw_url, "aas_github_url": aas_github_url,
               "error": error_message}
    job.update({k: v for k, v in updates.items() if v is not None})


def get_job(job_id: str) -> Optional[dict]:
    """Get a single job by ID."""
    return _jobs.get(job_id)
