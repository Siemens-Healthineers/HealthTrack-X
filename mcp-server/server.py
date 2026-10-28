"""
HealthTrack-X MCP Server

Exposes product data management as MCP tools so that AI assistants
(or any MCP client) can perform the same operations as the UI forms.

Architecture:
  MCP Client  ──►  MCP Server (this file)
                        │
                        ▼
               HTX Backend API  (/api/data-mutations/preview + commit)
                        │
                           ▼
                       User approval in frontend  ──►  GitHub batch commit

Schema source of truth:
  The `.github/repository-metadata.yml` in each GitHub data repo defines
  the field schema.  The backend validates incoming data against it
    during backend mutation preview before any GitHub write happens.
"""

from __future__ import annotations

import os
from typing import Union

import httpx
from mcp.server.fastmcp import FastMCP

# Allowed value types in product data:
#  - scalar fields: str, int, float, bool
#  - nested fields (e.g. chemicalComposition): list of flat dicts
_Scalar = Union[str, int, float, bool]
_FieldValue = Union[_Scalar, list[dict[str, _Scalar]]]
ProductData = dict[str, _FieldValue]

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
HTX_BACKEND_URL = os.environ.get("HTX_BACKEND_URL", "http://localhost:8000")

# Optional: default config_id and data folder
HTX_CONFIG_ID = os.environ.get("HTX_CONFIG_ID", None)
HTX_DATA_FOLDER = os.environ.get("HTX_DATA_FOLDER", "products")
_APPROVAL_MESSAGE = "Review and approve this change in the HealthTrack-X frontend before it is committed."

# Reusable HTTP client (lazy singleton — created on first use, reused after)
_http_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=30.0)
    return _http_client


def _resolve_config(
    config_id: str | None = None,
    folder: str | None = None,
) -> tuple[httpx.AsyncClient, str | None, str]:
    """Return (client, effective_config_id, effective_folder).

    Centralises the config_id / folder fallback logic so every tool
    resolves defaults identically.
    """
    return (
        _get_client(),
        config_id or HTX_CONFIG_ID,
        folder or HTX_DATA_FOLDER,
    )


# ---------------------------------------------------------------------------
# MCP Server
# ---------------------------------------------------------------------------
mcp = FastMCP("HealthTrack-X")


async def _fetch_products(
    client: httpx.AsyncClient,
    cid: str | None,
    target_folder: str,
) -> list[dict]:
    """GET /api/list-products and return the products list.

    Backend wraps the array in ``{success, data, cached}``; older
    versions returned a bare list.  This helper handles both shapes
    so callers always get ``list[dict]``.
    """
    params: dict[str, str] = {"folder": target_folder}
    if cid:
        params["config_id"] = cid
    resp = await client.get(f"{HTX_BACKEND_URL}/api/list-products", params=params)
    resp.raise_for_status()
    body = resp.json()
    if isinstance(body, list):
        return body
    data = body.get("data") if isinstance(body, dict) else None
    return data if isinstance(data, list) else []


async def _submit_mutation_preview(client: httpx.AsyncClient, payload: dict) -> dict:
    """Create a backend mutation preview; no GitHub write happens here."""
    resp = await client.post(
        f"{HTX_BACKEND_URL}/api/data-mutations/preview",
        json=payload,
    )
    if resp.is_error:
        return _backend_error(resp)
    result = resp.json()
    return {
        "success": result.get("valid", False),
        "approval_id": result.get("approval_id", ""),
        "status": result.get("status", "pending"),
        "atomic": result.get("atomic", True),
        "summary": result.get("summary", {}),
        "actions": result.get("actions", []),
        "warnings": result.get("warnings", []),
        "errors": result.get("errors", []),
        "message": _APPROVAL_MESSAGE,
    }


def _backend_error(resp: httpx.Response) -> dict:
    return {"success": False, "error": f"Backend returned {resp.status_code}: {resp.text[:500]}"}


async def _post_backend_json(client: httpx.AsyncClient, path: str, payload: dict) -> dict:
    resp = await client.post(f"{HTX_BACKEND_URL}{path}", json=payload)
    if resp.is_error:
        return _backend_error(resp)
    return resp.json()


async def _get_backend_json(client: httpx.AsyncClient, path: str) -> dict:
    resp = await client.get(f"{HTX_BACKEND_URL}{path}")
    if resp.is_error:
        return _backend_error(resp)
    return resp.json()


def _normalize_mutation_action(action: dict, cid: str | None, target_folder: str) -> dict:
    return {
        **action,
        "config_id": action.get("config_id") or cid,
        "folder": action.get("folder") or target_folder,
    }


async def _preview_actions(
    actions: list[dict],
    *,
    requested_by: str,
    config_id: str | None = None,
    folder: str | None = None,
) -> dict:
    client, cid, target_folder = _resolve_config(config_id, folder)
    normalized_actions = [_normalize_mutation_action(action, cid, target_folder) for action in actions]
    return await _submit_mutation_preview(client, {
        "config_id": cid,
        "folder": target_folder,
        "requested_by": requested_by,
        "actions": normalized_actions,
    })


def _schema_fields(fields: list[dict]) -> list[dict]:
    return [field for field in fields if field.get("source") == "schema"]


def _find_schema_folder(repos: list[dict], target_cid: str | None, target_folder: str) -> tuple[dict | None, dict | None]:
    fallback: tuple[dict, dict] | None = None
    for repo in repos:
        if target_cid and repo.get("config_id") != target_cid:
            continue
        folders = repo.get("data_folders", [])
        if fallback is None and folders:
            fallback = (repo, folders[0])
        for data_folder in folders:
            if data_folder.get("folder") == target_folder:
                return repo, data_folder
    return fallback if fallback else (None, None)


# ---------------------------------------------------------------------------
# create_product
# ---------------------------------------------------------------------------
@mcp.tool()
async def create_product(
    data: ProductData,
    config_id: str | None = None,
    folder: str | None = None,
) -> dict:
    """Prepare a new product record and request frontend approval.

    This tool does not commit directly. It creates a diff-style preview
    in the backend so the HealthTrack-X frontend can show the user what
    would be written before the data repository is changed.

    The backend validates the data against the cached repository-
    metadata schema (single source of truth) during preview. A GitHub
    write happens only after frontend approval.

    Call `get_schema_fields` first to discover expected field names,
    types, and constraints.

    Args:
        data:      Product fields as a dict.  Flat string/number fields
                   (e.g. productName, manufacturer) AND nested structures
                   like chemicalComposition (list of dicts with element,
                   cas, min, max, avg, fractionType) are supported.
                   The productId is generated by the backend — omit it
                   or pass an empty string.
        config_id: Optional GitHub config UUID (uses default if omitted).
        folder:    Data folder name (default: env HTX_DATA_FOLDER or
                   "products").

    Returns:
        A dict with approval_id, summary, per-field changes and validation
        errors. The user must approve the preview in the frontend before
        it is committed.
    """
    return await _preview_actions(
        [{
            "action": "create",
            "data": {"productId": "", **dict(data)},
        }],
        requested_by="mcp:create_product",
        config_id=config_id,
        folder=folder,
    )


# ---------------------------------------------------------------------------
# update_product
# ---------------------------------------------------------------------------
@mcp.tool()
async def update_product(
    product_id: str,
    data: ProductData,
    config_id: str | None = None,
    folder: str | None = None,
) -> dict:
    """Prepare a partial product update and request frontend approval.

    The backend fetches the current record, merges the provided fields,
    validates the result and creates a diff preview. This keeps update
    semantics centralised instead of letting each MCP client merge data
    independently.

    Useful for batch-editing multiple products via repeated calls.

    Args:
        product_id: The productId of the record to update.
        data:       Fields to set or overwrite.  Same structure as
                    create_product (flat scalars + optional
                    chemicalComposition list).  Only the provided
                    keys are changed; everything else is preserved.
        config_id:  Optional GitHub config UUID.
        folder:     Data folder name (default: "products").

    Returns:
        A dict with approval_id, summary, per-field changes and validation
        errors. The user must approve the preview in the frontend before
        it is committed.
    """
    return await _preview_actions(
        [{
            "action": "update",
            "product_id": product_id,
            "data": data,
        }],
        requested_by="mcp:update_product",
        config_id=config_id,
        folder=folder,
    )


# ---------------------------------------------------------------------------
# delete_product
# ---------------------------------------------------------------------------
@mcp.tool()
async def delete_product(
    product_id: str,
    config_id: str | None = None,
    folder: str | None = None,
) -> dict:
    """Prepare a product deletion and request frontend approval.

    This tool does not delete directly. It creates a preview that can be
    batched with other create/update/delete actions and approved once in
    the HealthTrack-X frontend.

    Args:
        product_id: The productId of the record to delete.
        config_id:  Optional GitHub config UUID.
        folder:     Data folder name (default from HTX_DATA_FOLDER env
                    or "products").

    Returns:
        A dict with approval_id, summary and diff information.
    """
    return await _preview_actions(
        [{
            "action": "delete",
            "product_id": product_id,
        }],
        requested_by="mcp:delete_product",
        config_id=config_id,
        folder=folder,
    )


@mcp.tool()
async def preview_data_changes(
    actions: list[dict],
    config_id: str | None = None,
    folder: str | None = None,
) -> dict:
    """Preview a mixed batch of create/update/delete actions before commit.

    Prefer this tool over repeated create_product/update_product/delete_product
    calls when the user requests multiple changes. A mixed batch such as two
    deletes and two updates is previewed together and committed with one GitHub
    write per target data file after frontend approval.

    Each action must have:
      - action: "create", "update" or "delete"
      - product_id: required for update/delete, optional for create
      - data: field values for create/update
      - optional config_id/folder overrides
    """
    return await _preview_actions(
        actions,
        requested_by="mcp:preview_data_changes",
        config_id=config_id,
        folder=folder,
    )


@mcp.tool()
async def commit_approved_changes(approval_id: str) -> dict:
    """Commit a frontend-approved mutation preview.

    The approval must already have been confirmed by the user in the
    HealthTrack-X frontend.
    """
    client = _get_client()
    return await _post_backend_json(client, "/api/data-mutations/commit", {"approval_id": approval_id})


@mcp.tool()
async def get_pending_data_changes() -> dict:
    """List mutation previews that are waiting for frontend approval."""
    client = _get_client()
    return await _get_backend_json(client, "/api/data-mutations/pending")


# ---------------------------------------------------------------------------
# list_products
# ---------------------------------------------------------------------------
@mcp.tool()
async def list_products(
    config_id: str | None = None,
    folder: str | None = None,
) -> dict:
    """List all products currently stored in the data repository.

    Args:
        config_id: Optional GitHub config UUID (uses default if omitted).
        folder:    Data folder name (default from HTX_DATA_FOLDER env
                    or "products").

    Returns:
        A dict with count and products array.
    """
    client, cid, target_folder = _resolve_config(config_id, folder)
    try:
        products = await _fetch_products(client, cid, target_folder)
    except httpx.HTTPStatusError as e:
        return {"success": False, "error": f"Backend returned {e.response.status_code}"}
    return {"success": True, "count": len(products), "products": products}


# ---------------------------------------------------------------------------
# get_schema_fields
# ---------------------------------------------------------------------------
@mcp.tool()
async def get_schema_fields(
    config_id: str | None = None,
    folder: str | None = None,
) -> dict:
    """Retrieve the current data schema fields from the backend.

    Returns the field definitions from the GitHub data repo's
    .github/repository-metadata.yml — the single source of truth
    for data structure.  Use this to understand which fields
    create_product / update_product expect, including types,
    constraints, and allowed values.

    Args:
        config_id: Optional GitHub config UUID (uses default if omitted).
        folder:    Data folder name (default from HTX_DATA_FOLDER env
                    or "products").

    Returns:
        A dict with repo info and fields array.
    """
    client, target_cid, target_folder = _resolve_config(config_id, folder)
    resp = await client.get(f"{HTX_BACKEND_URL}/api/repo-metadata")

    if resp.status_code != 200:
        return {"success": False, "error": f"Backend returned {resp.status_code}"}

    data = resp.json()
    repos = data.get("repos", [])
    if not repos:
        return {"success": True, "fields": [], "message": "No repos configured"}

    repo, data_folder = _find_schema_folder(repos, target_cid, target_folder)
    if not repo or not data_folder:
        return {"success": True, "fields": [], "repo": repo.get("full_name") if repo else None}

    return {
        "success": True,
        "repo": repo.get("full_name"),
        "folder": data_folder.get("folder"),
        "fields": _schema_fields(data_folder.get("sample_fields", [])),
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    mcp.run(transport="stdio")
