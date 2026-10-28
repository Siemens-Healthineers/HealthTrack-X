"""Keycloak Admin API client for user management (pending approvals)."""

import os
import time
import asyncio
from typing import Any

import httpx

# Configuration – read lazily so that load_dotenv() in main.py runs first.
_config: dict | None = None


def _get_config() -> dict:
    global _config
    if _config is None:
        _config = {
            "base_url": os.environ.get("KEYCLOAK_ADMIN_URL", "http://htx-keycloak.healthtrack-x.svc.cluster.local:8080"),
            "realm": os.environ.get("KEYCLOAK_ADMIN_REALM", "healthtrack-x"),
            "client_id": os.environ.get("KEYCLOAK_ADMIN_CLIENT_ID", "healthtrackx-backend"),
            "client_secret": os.environ.get("KEYCLOAK_ADMIN_CLIENT_SECRET", ""),
        }
    return _config


# Token cache
_token: str | None = None
_token_expires: float = 0
_token_lock = asyncio.Lock()
_http_client: httpx.AsyncClient | None = None


def _get_http_client() -> httpx.AsyncClient:
    """Return a reusable HTTP client for Keycloak Admin API calls."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=10,
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=20),
        )
    return _http_client


async def _get_token() -> str:
    """Get a service-account access token, caching until expiry."""
    global _token, _token_expires
    if _token and time.time() < _token_expires - 10:
        return _token

    cfg = _get_config()
    if not cfg["client_secret"]:
        raise RuntimeError("KEYCLOAK_ADMIN_CLIENT_SECRET not configured")

    async with _token_lock:
        if _token and time.time() < _token_expires - 10:
            return _token

        client = _get_http_client()
        resp = await client.post(
            f"{cfg['base_url']}/realms/{cfg['realm']}/protocol/openid-connect/token",
            data={
                "grant_type": "client_credentials",
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
            },
        )
        resp.raise_for_status()
        data = resp.json()
        _token = data["access_token"]
        _token_expires = time.time() + data.get("expires_in", 300)
        return _token


async def _admin_get(path: str, params: dict | None = None) -> Any:
    token = await _get_token()
    client = _get_http_client()
    cfg = _get_config()
    resp = await client.get(
        f"{cfg['base_url']}/admin/realms/{cfg['realm']}{path}",
        headers={"Authorization": f"Bearer {token}"},
        params=params,
    )
    resp.raise_for_status()
    return resp.json()


async def _admin_put(path: str, json_data: Any = None) -> int:
    token = await _get_token()
    client = _get_http_client()
    cfg = _get_config()
    resp = await client.put(
        f"{cfg['base_url']}/admin/realms/{cfg['realm']}{path}",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=json_data,
    )
    resp.raise_for_status()
    return resp.status_code


async def _admin_post(path: str, json_data: Any = None) -> int:
    token = await _get_token()
    client = _get_http_client()
    cfg = _get_config()
    resp = await client.post(
        f"{cfg['base_url']}/admin/realms/{cfg['realm']}{path}",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=json_data,
    )
    resp.raise_for_status()
    return resp.status_code


async def _admin_delete(path: str) -> int:
    token = await _get_token()
    client = _get_http_client()
    cfg = _get_config()
    resp = await client.delete(
        f"{cfg['base_url']}/admin/realms/{cfg['realm']}{path}",
        headers={"Authorization": f"Bearer {token}"},
    )
    resp.raise_for_status()
    return resp.status_code


async def get_realm_roles() -> list[dict]:
    """Get all realm roles."""
    return await _admin_get("/roles")


async def get_user_realm_roles(user_id: str) -> list[dict]:
    """Get realm roles assigned to a user."""
    return await _admin_get(f"/users/{user_id}/role-mappings/realm")


async def list_users() -> list[dict]:
    """List all users in the realm."""
    return await _admin_get("/users", params={"max": 100})


async def get_pending_users(required_role: str = "") -> list[dict]:
    """Return users who have no realm roles (except default ones).
    A 'pending' user is one who self-registered but hasn't been approved yet.
    """
    role_name = required_role or os.environ.get("KEYCLOAK_ADMIN_VIEWER_ROLE", "viewer")
    all_users = await list_users()
    pending = []

    for user in all_users:
        # Skip service accounts
        username = user.get("username", "")
        if username.startswith("service-account-"):
            continue

        user_roles = await get_user_realm_roles(user["id"])
        role_names = {r["name"] for r in user_roles}

        # User is pending if they don't have the viewer role
        if role_name not in role_names:
            pending.append({
                "id": user["id"],
                "username": username,
                "email": user.get("email", ""),
                "firstName": user.get("firstName", ""),
                "lastName": user.get("lastName", ""),
                "enabled": user.get("enabled", False),
                "createdTimestamp": user.get("createdTimestamp", 0),
                "roles": sorted(role_names - {"default-roles-healthtrack-x", "offline_access", "uma_authorization"}),
            })

    return pending


async def approve_user(user_id: str, roles: list[str] | None = None) -> dict:
    """Approve a pending user by assigning the viewer role (and optionally more)."""
    role_names = roles or [os.environ.get("KEYCLOAK_ADMIN_VIEWER_ROLE", "viewer")]
    all_roles = await get_realm_roles()
    role_map = {r["name"]: r for r in all_roles}

    roles_to_assign = []
    for name in role_names:
        if name in role_map:
            roles_to_assign.append({"id": role_map[name]["id"], "name": name})

    if not roles_to_assign:
        raise ValueError(f"Roles not found: {role_names}")

    await _admin_post(f"/users/{user_id}/role-mappings/realm", json_data=roles_to_assign)

    # Ensure user is enabled
    await _admin_put(f"/users/{user_id}", json_data={"enabled": True})

    return {"approved": True, "user_id": user_id, "roles": [r["name"] for r in roles_to_assign]}


async def reject_user(user_id: str) -> dict:
    """Reject (delete) a pending user."""
    await _admin_delete(f"/users/{user_id}")
    return {"rejected": True, "user_id": user_id}


def is_configured() -> bool:
    """Check if Keycloak Admin API is configured."""
    return bool(_get_config()["client_secret"])
