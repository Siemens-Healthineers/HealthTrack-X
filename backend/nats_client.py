"""NATS JetStream Client - async-native distributed job messaging."""

import os
import json
import asyncio
from typing import Final, Optional, Any

import nats
from nats.aio.client import Client as NATS

# Configuration
NATS_URL: Final[str] = os.environ.get("NATS_URL", "nats://localhost:4222")
STREAM_NAME: Final[str] = "JOBS"
SUBJECT: Final[str] = "jobs.pending"
CONSUMER_DURABLE: Final[str] = "htx-worker"

# Module-level state
_nc: Optional[NATS] = None
_js: Any = None
_sub: Any = None


async def connect(
    url: str | None = None,
    max_retries: int = 15,
    retry_delay: float = 2.0,
):
    """Connect to NATS and create the JetStream stream. Retries on failure."""
    global _nc, _js
    target = url or NATS_URL

    for attempt in range(1, max_retries + 1):
        try:
            _nc = await nats.connect(
                target,
                reconnect_time_wait=2,
                max_reconnect_attempts=-1,
                connect_timeout=5,
            )
            break
        except Exception as exc:
            if attempt < max_retries:
                print(f"[NATS] retry {attempt}/{max_retries} ({type(exc).__name__})")
                await asyncio.sleep(retry_delay)
            else:
                print(f"[NATS] FAIL after {max_retries} attempts")
                raise

    _js = _nc.jetstream()

    try:
        await _js.add_stream(name=STREAM_NAME, subjects=[SUBJECT])
    except nats.js.errors.BadRequestError:
        pass

    print(f"[NATS] Connected: {target} | stream={STREAM_NAME}")


async def publish_job(job_id: str, payload: dict):
    """Publish a job message to JetStream."""
    ack = await _js.publish(
        SUBJECT,
        json.dumps({"job_id": job_id, "payload": payload}).encode(),
    )
    print(f"[NATS] Published {job_id[:8]} seq={ack.seq}")


async def subscribe(max_retries: int = 10, retry_delay: float = 3.0):
    """Create a durable push subscription for the background worker.
    Retries on 'consumer already bound' errors during rolling restarts."""
    global _sub
    for attempt in range(1, max_retries + 1):
        try:
            _sub = await _js.subscribe(SUBJECT, durable=CONSUMER_DURABLE, stream=STREAM_NAME)
            print(f"[NATS] Subscribed {SUBJECT}")
            return _sub
        except Exception as exc:
            if "already bound" in str(exc) and attempt < max_retries:
                print(f"[NATS] Consumer bound to old pod, retry {attempt}/{max_retries}...")
                await asyncio.sleep(retry_delay)
            else:
                raise


def get_status() -> dict:
    """Return a status dict for /api/system-status."""
    if _nc is None:
        return {"status": "offline", "message": "Not connected"}
    if _nc.is_connected:
        return {"status": "online", "message": f"Connected ({NATS_URL})"}
    if _nc.is_reconnecting:
        return {"status": "warning", "message": "Reconnecting"}
    return {"status": "offline", "message": "Disconnected"}


async def close():
    """Gracefully close the NATS connection."""
    global _nc, _js, _sub
    if _sub:
        try:
            await _sub.unsubscribe()
        except Exception:
            pass
        _sub = None
    if _nc:
        try:
            await _nc.close()
        except Exception:
            pass
        _nc = None
        _js = None
    print("[NATS] Closed")
