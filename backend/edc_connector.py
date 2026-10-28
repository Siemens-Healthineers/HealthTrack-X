"""
EDC Tractus-X Connector Client

Communicates with an Eclipse Dataspace Connector (EDC) instance
via its Management API (v3) to:
  - Browse catalogs from other dataspace participants
  - Negotiate contracts for data assets
  - Initiate and track data transfers
  - Register local products as EDC assets with usage policies
"""

import os
import json
import uuid
import asyncio
from datetime import datetime
from typing import Optional
from pathlib import Path
from dotenv import load_dotenv
import httpx

# Load env
_env_file = Path(__file__).parent / "config" / "env" / ".env"
load_dotenv(dotenv_path=_env_file)

# ---------------------------------------------------------------------------
# Local registration store (persisted as JSON on disk)
# ---------------------------------------------------------------------------
_REGISTRATIONS_FILE = Path(__file__).parent / "cache" / "edc_registrations.json"
_POLICIES_FILE = Path(__file__).parent / "cache" / "edc_policies.json"
_CONTRACT_DEFS_FILE = Path(__file__).parent / "cache" / "edc_contract_defs.json"
_NEGOTIATIONS_FILE = Path(__file__).parent / "cache" / "edc_negotiations.json"


def _load_registrations() -> list[dict]:
    """Load locally registered EDC assets from disk."""
    if _REGISTRATIONS_FILE.exists():
        try:
            return json.loads(_REGISTRATIONS_FILE.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []


def _save_registrations(registrations: list[dict]) -> None:
    """Persist local EDC registrations to disk."""
    _REGISTRATIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _REGISTRATIONS_FILE.write_text(
        json.dumps(registrations, indent=2, default=str),
        encoding="utf-8",
    )


def _load_policies() -> list[dict]:
    """Load locally stored policy definitions from disk."""
    if _POLICIES_FILE.exists():
        try:
            return json.loads(_POLICIES_FILE.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []


def _save_policies(policies: list[dict]) -> None:
    """Persist local policy definitions to disk."""
    _POLICIES_FILE.parent.mkdir(parents=True, exist_ok=True)
    _POLICIES_FILE.write_text(
        json.dumps(policies, indent=2, default=str),
        encoding="utf-8",
    )


def _load_contract_defs() -> list[dict]:
    """Load locally stored contract definitions from disk."""
    if _CONTRACT_DEFS_FILE.exists():
        try:
            return json.loads(_CONTRACT_DEFS_FILE.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []


def _save_contract_defs(defs: list[dict]) -> None:
    """Persist local contract definitions to disk."""
    _CONTRACT_DEFS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _CONTRACT_DEFS_FILE.write_text(
        json.dumps(defs, indent=2, default=str),
        encoding="utf-8",
    )


def _load_negotiations() -> list[dict]:
    """Load locally stored negotiations from disk."""
    if _NEGOTIATIONS_FILE.exists():
        try:
            return json.loads(_NEGOTIATIONS_FILE.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []


def _save_negotiations(negs: list[dict]) -> None:
    """Persist local negotiations to disk."""
    _NEGOTIATIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _NEGOTIATIONS_FILE.write_text(
        json.dumps(negs, indent=2, default=str),
        encoding="utf-8",
    )

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

EDC_MANAGEMENT_URL = os.getenv("EDC_MANAGEMENT_URL", "")          # e.g. http://localhost:19193/management
EDC_PROTOCOL_URL = os.getenv("EDC_PROTOCOL_URL", "")              # e.g. http://localhost:19194/protocol
EDC_API_KEY = os.getenv("EDC_API_KEY", "")                        # X-Api-Key header value
EDC_PARTICIPANT_ID = os.getenv("EDC_PARTICIPANT_ID", "")          # BPN / participant ID
EDC_PROVIDER_PROTOCOL_URL = os.getenv("EDC_PROVIDER_PROTOCOL_URL", "")  # Remote provider DSP endpoint

# Catena-X Discovery Services
EDC_BPN_DISCOVERY_URL = os.getenv("EDC_BPN_DISCOVERY_URL", "")    # BPN Discovery Service
EDC_EDC_DISCOVERY_URL = os.getenv("EDC_EDC_DISCOVERY_URL", "")    # EDC Discovery Service
EDC_DISCOVERY_AUTH_URL = os.getenv("EDC_DISCOVERY_AUTH_URL", "")   # OAuth2 token endpoint for discovery
EDC_DISCOVERY_CLIENT_ID = os.getenv("EDC_DISCOVERY_CLIENT_ID", "")
EDC_DISCOVERY_CLIENT_SECRET = os.getenv("EDC_DISCOVERY_CLIENT_SECRET", "")

# Standard JSON-LD context for EDC Management API v3
_EDC_CONTEXT = {
    "@vocab": "https://w3id.org/edc/v0.0.1/ns/",
    "odrl": "http://www.w3.org/ns/odrl/2/",
    "dcat": "http://www.w3.org/ns/dcat#",
    "dct": "http://purl.org/dc/terms/",
    "dspace": "https://w3id.org/dspace/v0.8/",
    "cx-policy": "https://w3id.org/catenax/policy/",
    "cx-common": "https://w3id.org/catenax/ontology/common#",
    "dcp": "https://w3id.org/dcp/v0.8/",
}

# Default timeout for EDC API calls (seconds)
_TIMEOUT = 30.0

# Reusable async HTTP client (connection pooling across all EDC calls)
_edc_client: httpx.AsyncClient | None = None

def _get_edc_client() -> httpx.AsyncClient:
    """Get or create a reusable httpx.AsyncClient for EDC API calls."""
    global _edc_client
    if _edc_client is None or _edc_client.is_closed:
        _edc_client = httpx.AsyncClient(timeout=_TIMEOUT, verify=False)
    return _edc_client

# Precomputed headers (EDC_API_KEY is read from env at import time and never changes)
_HEADERS: dict = {"Content-Type": "application/json"}
if EDC_API_KEY:
    _HEADERS["X-Api-Key"] = EDC_API_KEY


def _mgmt(path: str) -> str:
    """Build full Management API URL."""
    base = EDC_MANAGEMENT_URL.rstrip("/")
    return f"{base}{path}"


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------

async def get_edc_status() -> dict:
    """Check whether the EDC connector is reachable."""
    if not EDC_MANAGEMENT_URL:
        return {
            "status": "not_configured",
            "message": "EDC Management URL not configured",
            "managementUrl": "",
            "participantId": EDC_PARTICIPANT_ID,
        }
    try:
        client = _get_edc_client()
        # EDC health/readiness — try the identity endpoint
        resp = await client.get(
            _mgmt("/v3/assets/request"),
            headers=_HEADERS,
        )
        # Some EDC versions use POST for this; fall back to a simple check
        if resp.status_code in (200, 405):
            return {
                "status": "online",
                "message": f"Connected to EDC at {EDC_MANAGEMENT_URL}",
                "managementUrl": EDC_MANAGEMENT_URL,
                "participantId": EDC_PARTICIPANT_ID,
            }
        return {
            "status": "error",
            "message": f"EDC responded with HTTP {resp.status_code}",
            "managementUrl": EDC_MANAGEMENT_URL,
            "participantId": EDC_PARTICIPANT_ID,
        }
    except httpx.ConnectError:
        return {
            "status": "offline",
            "message": f"Cannot reach EDC at {EDC_MANAGEMENT_URL}",
            "managementUrl": EDC_MANAGEMENT_URL,
            "participantId": EDC_PARTICIPANT_ID,
        }
    except Exception as exc:
        return {
            "status": "error",
            "message": str(exc)[:120],
            "managementUrl": EDC_MANAGEMENT_URL,
            "participantId": EDC_PARTICIPANT_ID,
        }


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------

async def request_catalog(provider_url: str | None = None) -> dict:
    """
    Request the data catalog from a provider connector.
    Uses the configured EDC_PROVIDER_PROTOCOL_URL if *provider_url* is None.
    """
    target = (provider_url or EDC_PROVIDER_PROTOCOL_URL or "").rstrip("/")
    if not target:
        return {"error": "No provider protocol URL configured or supplied"}

    body = {
        "@context": _EDC_CONTEXT,
        "@type": "CatalogRequest",
        "counterPartyAddress": target,
        "protocol": "dataspace-protocol-http",
    }
    client = _get_edc_client()
    resp = await client.post(
        _mgmt("/v3/catalog/request"),
        headers=_HEADERS,
        json=body,
    )
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Assets
# ---------------------------------------------------------------------------

async def list_assets() -> list[dict]:
    """List all assets registered in the local EDC connector."""
    body = {"@context": _EDC_CONTEXT}
    client = _get_edc_client()
    resp = await client.post(
        _mgmt("/v3/assets/request"),
        headers=_HEADERS,
        json=body,
    )
    resp.raise_for_status()
    return resp.json()


async def create_asset_for_product(product: dict) -> dict:
    """
    Register a HealthTrack-X product as an EDC asset.

    The asset ID is derived from the productId so it can be looked up later.
    """
    product_id = product.get("productId", str(uuid.uuid4()))
    asset_id = f"htx-product-{product_id}"

    body = {
        "@context": _EDC_CONTEXT,
        "@type": "Asset",
        "@id": asset_id,
        "properties": {
            "name": product.get("productName", product_id),
            "description": f"Digital Product Passport for {product.get('productName', product_id)}",
            "contenttype": "application/json",
            "cx-common:version": "1.0",
        },
        "dataAddress": {
            "@type": "DataAddress",
            "type": "HttpData",
            "baseUrl": product.get("githubUrl", f"https://htx-demo.com/products/{product_id}"),
        },
    }
    client = _get_edc_client()
    resp = await client.post(
        _mgmt("/v3/assets"),
        headers=_HEADERS,
        json=body,
    )
    resp.raise_for_status()
    return resp.json()


async def delete_asset(asset_id: str) -> dict:
    """Delete an asset from the local EDC connector."""
    client = _get_edc_client()
    resp = await client.delete(
        _mgmt(f"/v3/assets/{asset_id}"),
        headers=_HEADERS,
    )
    resp.raise_for_status()
    return {"deleted": asset_id}


# ---------------------------------------------------------------------------
# Policies
# ---------------------------------------------------------------------------

async def create_use_policy(policy_id: str | None = None) -> dict:
    """
    Create a simple "USE" permission policy (Tractus-X Framework Agreement).
    """
    pid = policy_id or f"htx-policy-{uuid.uuid4().hex[:8]}"
    body = {
        "@context": _EDC_CONTEXT,
        "@type": "PolicyDefinition",
        "@id": pid,
        "policy": {
            "@type": "odrl:Set",
            "odrl:permission": [
                {
                    "odrl:action": "use",
                    "odrl:constraint": {
                        "odrl:leftOperand": "cx-policy:FrameworkAgreement",
                        "odrl:operator": {"@id": "odrl:eq"},
                        "odrl:rightOperand": "active",
                    },
                }
            ],
        },
    }
    client = _get_edc_client()
    resp = await client.post(
        _mgmt("/v3/policydefinitions"),
        headers=_HEADERS,
        json=body,
    )
    resp.raise_for_status()
    return resp.json()


def _build_dcp_constraints(
    credential_type: str = "MembershipCredential",
    purpose: str | None = None,
    valid_from: str | None = None,
    valid_to: str | None = None,
) -> dict:
    """Build ODRL constraint block for DCP policies (shared by create + update)."""
    constraints: list[dict] = [{
        "odrl:leftOperand": {"@id": "cx-policy:CredentialType"},
        "odrl:operator": {"@id": "odrl:eq"},
        "odrl:rightOperand": credential_type,
    }]
    if purpose:
        constraints.append({
            "odrl:leftOperand": {"@id": "cx-policy:UsagePurpose"},
            "odrl:operator": {"@id": "odrl:eq"},
            "odrl:rightOperand": purpose,
        })
    if valid_from:
        constraints.append({
            "odrl:leftOperand": {"@id": "odrl:dateTime"},
            "odrl:operator": {"@id": "odrl:gteq"},
            "odrl:rightOperand": {"@value": valid_from, "@type": "xsd:dateTime"},
        })
    if valid_to:
        constraints.append({
            "odrl:leftOperand": {"@id": "odrl:dateTime"},
            "odrl:operator": {"@id": "odrl:lteq"},
            "odrl:rightOperand": {"@value": valid_to, "@type": "xsd:dateTime"},
        })
    return constraints[0] if len(constraints) == 1 else {
        "@type": "odrl:LogicalConstraint",
        "odrl:and": constraints,
    }


async def create_dcp_policy(
    policy_id: str | None = None,
    policy_name: str | None = None,
    permission: str = "use",
    purpose: str | None = None,
    valid_from: str | None = None,
    valid_to: str | None = None,
    credential_type: str = "MembershipCredential",
) -> dict:
    """
    Create a DCP (Decentralized Claims Protocol) compliant ODRL policy.

    Builds an odrl:Set with:
      - odrl:action  – the granted permission (use, transfer, read, …)
      - Credential constraint  – requires a VerifiableCredential (DCP)
      - Purpose constraint (optional) – restricts data usage purpose
      - Temporal constraint (optional) – time window via dateTime operands

    Parameters
    ----------
    policy_id : optional custom policy ID
    permission : ODRL action ("use", "transfer", "read", "write")
    purpose : intended data usage purpose (e.g. "quality-analysis")
    valid_from : ISO-8601 start date (e.g. "2026-01-01T00:00:00Z")
    valid_to : ISO-8601 end date
    credential_type : VerifiableCredential type required by DCP
    """
    pid = policy_id or f"htx-dcp-policy-{uuid.uuid4().hex[:8]}"

    constraint_block = _build_dcp_constraints(credential_type, purpose, valid_from, valid_to)

    body = {
        "@context": {**_EDC_CONTEXT, "xsd": "http://www.w3.org/2001/XMLSchema#"},
        "@type": "PolicyDefinition",
        "@id": pid,
        "policy": {
            "@type": "odrl:Set",
            "odrl:permission": [
                {
                    "odrl:action": permission,
                    "odrl:constraint": constraint_block,
                }
            ],
        },
    }
    # Store human-readable name in properties (EDC private properties)
    if policy_name:
        body["properties"] = {"htx:policyName": policy_name}

    # Always persist locally
    local_policies = _load_policies()
    local_policies = [p for p in local_policies if p.get("@id") != pid]
    body["_local"] = {"createdAt": datetime.now().isoformat(), "syncedToEdc": False}
    local_policies.append(body)
    _save_policies(local_policies)

    # Try to push to EDC if configured
    if EDC_MANAGEMENT_URL:
        try:
            client = _get_edc_client()
            edc_body = {k: v for k, v in body.items() if k != "_local"}
            resp = await client.post(
                _mgmt("/v3/policydefinitions"),
                headers=_HEADERS,
                json=edc_body,
            )
            resp.raise_for_status()
            # Mark as synced
            body["_local"]["syncedToEdc"] = True
            _save_policies(local_policies)
            return resp.json()
        except Exception:
            pass  # EDC offline — policy saved locally

    return body


async def list_policies() -> list[dict]:
    """List all policy definitions (local + EDC if online)."""
    # Always include local policies
    local_policies = _load_policies()

    if not EDC_MANAGEMENT_URL:
        return local_policies

    try:
        body = {"@context": _EDC_CONTEXT}
        client = _get_edc_client()
        resp = await client.post(
            _mgmt("/v3/policydefinitions/request"),
            headers=_HEADERS,
            json=body,
        )
        resp.raise_for_status()
        edc_policies = resp.json()
        # Merge: EDC is authoritative, supplement with local-only policies
        edc_ids = {p.get("@id") or p.get("id") for p in edc_policies}
        for lp in local_policies:
            if lp.get("@id") not in edc_ids:
                edc_policies.append(lp)
        return edc_policies
    except Exception:
        return local_policies


async def update_dcp_policy(
    policy_id: str,
    policy_name: str | None = None,
    permission: str = "use",
    purpose: str | None = None,
    valid_from: str | None = None,
    valid_to: str | None = None,
    credential_type: str = "MembershipCredential",
) -> dict:
    """
    Update an existing DCP policy (local store + re-push to EDC if online).
    Rebuilds the full ODRL policy body with updated parameters.
    """
    local_policies = _load_policies()
    existing = next((p for p in local_policies if p.get("@id") == policy_id), None)
    if not existing:
        raise ValueError(f"Policy {policy_id} not found")

    constraint_block = _build_dcp_constraints(credential_type, purpose, valid_from, valid_to)

    updated = {
        "@context": {**_EDC_CONTEXT, "xsd": "http://www.w3.org/2001/XMLSchema#"},
        "@type": "PolicyDefinition",
        "@id": policy_id,
        "policy": {
            "@type": "odrl:Set",
            "odrl:permission": [{
                "odrl:action": permission,
                "odrl:constraint": constraint_block,
            }],
        },
        "_local": {
            "createdAt": existing.get("_local", {}).get("createdAt", datetime.now().isoformat()),
            "updatedAt": datetime.now().isoformat(),
            "syncedToEdc": False,
        },
    }
    if policy_name:
        updated["properties"] = {"htx:policyName": policy_name}

    local_policies = [p for p in local_policies if p.get("@id") != policy_id]
    local_policies.append(updated)
    _save_policies(local_policies)

    # Try to update in EDC (delete + re-create since EDC has no PUT)
    if EDC_MANAGEMENT_URL:
        try:
            client = _get_edc_client()
            await client.delete(
                _mgmt(f"/v3/policydefinitions/{policy_id}"),
                headers=_HEADERS,
            )
            edc_body = {k: v for k, v in updated.items() if k != "_local"}
            resp = await client.post(
                _mgmt("/v3/policydefinitions"),
                headers=_HEADERS,
                json=edc_body,
            )
            resp.raise_for_status()
            updated["_local"]["syncedToEdc"] = True
            _save_policies(local_policies)
        except Exception:
            pass

    return updated


async def delete_policy(policy_id: str) -> dict:
    """Delete a policy from local store and EDC if online."""
    local_policies = _load_policies()
    local_policies = [p for p in local_policies if p.get("@id") != policy_id]
    _save_policies(local_policies)

    if EDC_MANAGEMENT_URL:
        try:
            client = _get_edc_client()
            await client.delete(
                _mgmt(f"/v3/policydefinitions/{policy_id}"),
                headers=_HEADERS,
            )
        except Exception:
            pass

    return {"deleted": policy_id}


# ---------------------------------------------------------------------------
# Contract Definitions
# ---------------------------------------------------------------------------

async def create_contract_definition(
    contract_name: str,
    contract_def_id: str | None = None,
    description: str | None = None,
    provider: str | None = None,
    consumer: str | None = None,
    valid_from: str | None = None,
    valid_to: str | None = None,
    purpose: str | None = None,
    terms: str | None = None,
    provider_endpoint: str | None = None,
    policy_id: str | None = None,
    asset_id: str | None = None,
    access_policy_id: str | None = None,
) -> dict:
    """Create a contract definition with contractual metadata.
    
    Persists locally and optionally pushes to EDC if online.
    Policy and asset links are optional — they can be assigned later via the Assets tab.
    """
    cdid = contract_def_id or f"htx-cd-{uuid.uuid4().hex[:8]}"
    body: dict = {
        "@context": _EDC_CONTEXT,
        "@type": "ContractDefinition",
        "@id": cdid,
    }
    if policy_id:
        body["accessPolicyId"] = access_policy_id or policy_id
        body["contractPolicyId"] = policy_id
    if asset_id:
        body["assetsSelector"] = {
            "@type": "CriterionDto",
            "operandLeft": "https://w3id.org/edc/v0.0.1/ns/id",
            "operator": "=",
            "operandRight": asset_id,
        }
    # Store all contract metadata in properties
    props: dict = {}
    if contract_name:
        props["htx:contractName"] = contract_name
    if description:
        props["htx:description"] = description
    if provider:
        props["htx:provider"] = provider
    if consumer:
        props["htx:consumer"] = consumer
    if valid_from:
        props["htx:validFrom"] = valid_from
    if valid_to:
        props["htx:validTo"] = valid_to
    if purpose:
        props["htx:purpose"] = purpose
    if terms:
        props["htx:terms"] = terms
    if provider_endpoint:
        props["htx:providerEndpoint"] = provider_endpoint
    if props:
        body["properties"] = props

    # Always persist locally
    local_defs = _load_contract_defs()
    local_defs = [d for d in local_defs if d.get("@id") != cdid]
    body["_local"] = {"createdAt": datetime.now().isoformat(), "syncedToEdc": False}
    local_defs.append(body)
    _save_contract_defs(local_defs)

    # Try EDC push
    if EDC_MANAGEMENT_URL:
        try:
            client = _get_edc_client()
            edc_body = {k: v for k, v in body.items() if k != "_local"}
            resp = await client.post(
                _mgmt("/v3/contractdefinitions"),
                headers=_HEADERS,
                json=edc_body,
            )
            resp.raise_for_status()
            body["_local"]["syncedToEdc"] = True
            _save_contract_defs(local_defs)
            return resp.json()
        except Exception:
            pass

    return body


async def list_contract_definitions() -> list[dict]:
    """List all contract definitions (local + EDC if online)."""
    local_defs = _load_contract_defs()

    if not EDC_MANAGEMENT_URL:
        return local_defs

    try:
        body = {"@context": _EDC_CONTEXT}
        client = _get_edc_client()
        resp = await client.post(
            _mgmt("/v3/contractdefinitions/request"),
            headers=_HEADERS,
            json=body,
        )
        resp.raise_for_status()
        edc_defs = resp.json()
        edc_ids = {d.get("@id") or d.get("id") for d in edc_defs}
        for ld in local_defs:
            if ld.get("@id") not in edc_ids:
                edc_defs.append(ld)
        return edc_defs
    except Exception:
        return local_defs


async def update_contract_definition(
    contract_def_id: str,
    contract_name: str | None = None,
    description: str | None = None,
    provider: str | None = None,
    consumer: str | None = None,
    valid_from: str | None = None,
    valid_to: str | None = None,
    purpose: str | None = None,
    terms: str | None = None,
    provider_endpoint: str | None = None,
    policy_id: str | None = None,
    asset_id: str | None = None,
    access_policy_id: str | None = None,
) -> dict:
    """Update an existing contract definition."""
    local_defs = _load_contract_defs()
    existing = next((d for d in local_defs if d.get("@id") == contract_def_id), None)
    if not existing:
        raise ValueError(f"Contract definition {contract_def_id} not found")

    updated: dict = {
        "@context": _EDC_CONTEXT,
        "@type": "ContractDefinition",
        "@id": contract_def_id,
        "_local": {
            "createdAt": existing.get("_local", {}).get("createdAt", datetime.now().isoformat()),
            "updatedAt": datetime.now().isoformat(),
            "syncedToEdc": False,
        },
    }
    if policy_id:
        updated["accessPolicyId"] = access_policy_id or policy_id
        updated["contractPolicyId"] = policy_id
    elif existing.get("contractPolicyId"):
        updated["contractPolicyId"] = existing["contractPolicyId"]
        updated["accessPolicyId"] = existing.get("accessPolicyId", existing["contractPolicyId"])
    if asset_id:
        updated["assetsSelector"] = {
            "@type": "CriterionDto",
            "operandLeft": "https://w3id.org/edc/v0.0.1/ns/id",
            "operator": "=",
            "operandRight": asset_id,
        }
    elif existing.get("assetsSelector"):
        updated["assetsSelector"] = existing["assetsSelector"]
    # Merge contract metadata
    props: dict = {}
    if contract_name:
        props["htx:contractName"] = contract_name
    if description:
        props["htx:description"] = description
    if provider:
        props["htx:provider"] = provider
    if consumer:
        props["htx:consumer"] = consumer
    if valid_from:
        props["htx:validFrom"] = valid_from
    if valid_to:
        props["htx:validTo"] = valid_to
    if purpose:
        props["htx:purpose"] = purpose
    if terms:
        props["htx:terms"] = terms
    if provider_endpoint:
        props["htx:providerEndpoint"] = provider_endpoint
    if props:
        updated["properties"] = props

    local_defs = [d for d in local_defs if d.get("@id") != contract_def_id]
    local_defs.append(updated)
    _save_contract_defs(local_defs)

    if EDC_MANAGEMENT_URL:
        try:
            client = _get_edc_client()
            await client.delete(
                _mgmt(f"/v3/contractdefinitions/{contract_def_id}"),
                headers=_HEADERS,
            )
            edc_body = {k: v for k, v in updated.items() if k != "_local"}
            resp = await client.post(
                _mgmt("/v3/contractdefinitions"),
                headers=_HEADERS,
                json=edc_body,
            )
            resp.raise_for_status()
            updated["_local"]["syncedToEdc"] = True
            _save_contract_defs(local_defs)
        except Exception:
            pass

    return updated


async def delete_contract_definition(contract_def_id: str) -> dict:
    """Delete a contract definition from local store and EDC."""
    local_defs = _load_contract_defs()
    local_defs = [d for d in local_defs if d.get("@id") != contract_def_id]
    _save_contract_defs(local_defs)

    if EDC_MANAGEMENT_URL:
        try:
            client = _get_edc_client()
            await client.delete(
                _mgmt(f"/v3/contractdefinitions/{contract_def_id}"),
                headers=_HEADERS,
            )
        except Exception:
            pass

    return {"deleted": contract_def_id}


async def delete_negotiation(negotiation_id: str) -> dict:
    """Delete or withdraw a negotiation.

    Local-only entries are removed. EDC-synced entries are terminated
    via the Management API when the connector is available.
    """
    local_negs = _load_negotiations()
    target = next((n for n in local_negs if n.get("@id") == negotiation_id), None)
    synced = target.get("_local", {}).get("syncedToEdc", False) if target else False

    # Remove from local store
    local_negs = [n for n in local_negs if n.get("@id") != negotiation_id]
    _save_negotiations(local_negs)

    # If synced to EDC, try to terminate the negotiation
    if synced and EDC_MANAGEMENT_URL:
        try:
            client = _get_edc_client()
            await client.post(
                _mgmt(f"/v3/contractnegotiations/{negotiation_id}/terminate"),
                headers=_HEADERS,
                json={"@context": _EDC_CONTEXT, "reason": "Withdrawn by user"},
            )
        except Exception:
            pass

    return {"deleted": negotiation_id, "withdrawn": synced}


# ---------------------------------------------------------------------------
# Contract Negotiations
# ---------------------------------------------------------------------------

async def initiate_negotiation(
    provider_url: str,
    contract_definition_id: str,
    offer_id: str | None = None,
    asset_id: str | None = None,
    policy: dict | None = None,
) -> dict:
    """Start a contract negotiation based on a contract definition.
    
    Resolves the contract definition to get policy and asset info,
    then sends a ContractRequest to the EDC Management API.
    """
    # Resolve contract definition for metadata
    local_defs = _load_contract_defs()
    cd = next((d for d in local_defs if d.get("@id") == contract_definition_id), None)
    
    resolved_offer_id = offer_id or contract_definition_id
    resolved_asset_id = asset_id
    if not resolved_asset_id and cd:
        selector = cd.get("assetsSelector", {})
        resolved_asset_id = selector.get("operandRight", selector.get("edc:operandRight", contract_definition_id))
    if not resolved_asset_id:
        resolved_asset_id = contract_definition_id

    neg_id = f"htx-neg-{uuid.uuid4().hex[:8]}"

    cd_name = (cd.get("properties") or {}).get("htx:contractName", "") if cd else ""

    # Build local negotiation record
    local_neg = {
        "@id": neg_id,
        "state": "REQUESTED",
        "counterPartyAddress": provider_url,
        "contractDefinitionId": contract_definition_id,
        "contractName": cd_name,
        "protocol": "dataspace-protocol-http",
        "contractAgreementId": None,
        "_local": {
            "createdAt": datetime.now().isoformat(),
            "syncedToEdc": False,
        },
    }

    # Always persist locally first
    local_negs = _load_negotiations()
    local_negs.append(local_neg)
    _save_negotiations(local_negs)

    # Build EDC request body
    edc_body = {
        "@context": _EDC_CONTEXT,
        "@type": "ContractRequest",
        "counterPartyAddress": provider_url,
        "protocol": "dataspace-protocol-http",
        "policy": policy or {
            "@type": "odrl:Offer",
            "@id": resolved_offer_id,
            "assigner": EDC_PARTICIPANT_ID,
            "target": resolved_asset_id,
            "odrl:permission": [
                {
                    "odrl:action": "use",
                    "odrl:constraint": {
                        "odrl:leftOperand": "cx-policy:FrameworkAgreement",
                        "odrl:operator": {"@id": "odrl:eq"},
                        "odrl:rightOperand": "active",
                    },
                }
            ],
        },
    }

    # Try EDC push
    if EDC_MANAGEMENT_URL:
        try:
            client = _get_edc_client()
            resp = await client.post(
                _mgmt("/v3/contractnegotiations"),
                headers=_HEADERS,
                json=edc_body,
            )
            resp.raise_for_status()
            edc_result = resp.json()
            edc_neg_id = edc_result.get("@id", edc_result.get("id", neg_id))
            local_neg["@id"] = edc_neg_id
            local_neg["_local"]["syncedToEdc"] = True
            local_neg["_local"]["localId"] = neg_id
            _save_negotiations(local_negs)
            return edc_result
        except Exception:
            pass

    return local_neg


async def get_negotiation(negotiation_id: str) -> dict:
    client = _get_edc_client()
    resp = await client.get(
        _mgmt(f"/v3/contractnegotiations/{negotiation_id}"),
        headers=_HEADERS,
    )
    resp.raise_for_status()
    return resp.json()


async def list_negotiations() -> list[dict]:
    """List all negotiations (local + EDC if online)."""
    local_negs = _load_negotiations()

    if not EDC_MANAGEMENT_URL:
        return local_negs

    try:
        body = {"@context": _EDC_CONTEXT}
        client = _get_edc_client()
        resp = await client.post(
            _mgmt("/v3/contractnegotiations/request"),
            headers=_HEADERS,
            json=body,
        )
        resp.raise_for_status()
        edc_negs = resp.json()
        if not isinstance(edc_negs, list):
            edc_negs = []
        # Merge: EDC negotiations override local ones with same ID
        edc_ids = {n.get("@id") or n.get("id") for n in edc_negs}
        merged = list(edc_negs)
        for ln in local_negs:
            lid = ln.get("@id")
            local_id = ln.get("_local", {}).get("localId")
            if lid not in edc_ids and (not local_id or local_id not in edc_ids):
                merged.append(ln)
        return merged
    except Exception:
        return local_negs


# ---------------------------------------------------------------------------
# Transfer Processes
# ---------------------------------------------------------------------------

async def initiate_transfer(
    contract_agreement_id: str,
    asset_id: str,
    provider_url: str,
    destination_type: str = "HttpProxy",
) -> dict:
    """Initiate a data transfer after a successful contract negotiation."""
    body = {
        "@context": _EDC_CONTEXT,
        "@type": "TransferRequest",
        "connectorId": EDC_PARTICIPANT_ID,
        "counterPartyAddress": provider_url,
        "contractId": contract_agreement_id,
        "assetId": asset_id,
        "protocol": "dataspace-protocol-http",
        "dataDestination": {
            "@type": "DataAddress",
            "type": destination_type,
        },
    }
    client = _get_edc_client()
    resp = await client.post(
        _mgmt("/v3/transferprocesses"),
        headers=_HEADERS,
        json=body,
    )
    resp.raise_for_status()
    return resp.json()


async def get_transfer(transfer_id: str) -> dict:
    client = _get_edc_client()
    resp = await client.get(
        _mgmt(f"/v3/transferprocesses/{transfer_id}"),
        headers=_HEADERS,
    )
    resp.raise_for_status()
    return resp.json()


async def list_transfers() -> list[dict]:
    body = {"@context": _EDC_CONTEXT}
    client = _get_edc_client()
    resp = await client.post(
        _mgmt("/v3/transferprocesses/request"),
        headers=_HEADERS,
        json=body,
    )
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Convenience: Publish product to dataspace (asset + policy + contract def)
# ---------------------------------------------------------------------------

async def publish_product(product: dict, policy_id: str | None = None) -> dict:
    """
    One-click publish: creates asset, policy and contract definition
    so the product is available in the dataspace catalog.
    """
    # 1. Create asset
    asset_result = await create_asset_for_product(product)
    asset_id = asset_result.get("@id", asset_result.get("id", ""))

    # 2. Create policy (or reuse existing)
    if policy_id:
        pid = policy_id
    else:
        policy_result = await create_use_policy()
        pid = policy_result.get("@id", policy_result.get("id", ""))

    # 3. Create contract definition
    cd_result = await create_contract_definition(asset_id, pid)

    return {
        "asset": asset_result,
        "policy_id": pid,
        "contract_definition": cd_result,
        "published": True,
    }


# ---------------------------------------------------------------------------
# Smart Publish — works with or without live EDC connector
# ---------------------------------------------------------------------------

async def register_product(product: dict, policy_id: str | None = None) -> dict:
    """
    Register a product for EDC publishing. If the connector is online,
    publishes immediately and stores the real IDs. If offline, creates
    a local pending registration that can be synced later.
    """
    product_id = product.get("productId", str(uuid.uuid4()))
    asset_id = f"htx-product-{product_id}"
    now = datetime.now().isoformat()

    # Check for duplicate
    registrations = _load_registrations()
    existing = next((r for r in registrations if r["productId"] == product_id), None)
    if existing and existing.get("status") == "published":
        return existing

    # Try live publish if configured
    status = await get_edc_status()
    if status["status"] == "online":
        try:
            result = await publish_product(product, policy_id)
            real_asset = result.get("asset", {})
            real_asset_id = real_asset.get("@id", real_asset.get("id", asset_id))
            real_policy_id = result.get("policy_id", "")
            real_cd = result.get("contract_definition", {})

            reg = {
                "productId": product_id,
                "productName": product.get("productName", product_id),
                "assetId": real_asset_id,
                "policyId": real_policy_id,
                "contractDefinitionId": real_cd.get("@id", real_cd.get("id", "")),
                "status": "published",
                "connectorUrl": EDC_MANAGEMENT_URL,
                "participantId": EDC_PARTICIPANT_ID,
                "githubUrl": product.get("githubUrl", ""),
                "registeredAt": now,
                "publishedAt": now,
            }

            # Update or add
            if existing:
                registrations = [r for r in registrations if r["productId"] != product_id]
            registrations.append(reg)
            _save_registrations(registrations)
            return reg

        except Exception as e:
            print(f"[EDC] Live publish failed for {product_id}, storing as pending: {e}")
            # Fall through to pending registration

    # Offline / failed → create pending registration with generated IDs
    reg = {
        "productId": product_id,
        "productName": product.get("productName", product_id),
        "assetId": asset_id,
        "policyId": policy_id or f"htx-policy-{uuid.uuid4().hex[:8]}",
        "contractDefinitionId": f"htx-cd-{uuid.uuid4().hex[:8]}",
        "status": "pending",
        "connectorUrl": EDC_MANAGEMENT_URL or "(not configured)",
        "participantId": EDC_PARTICIPANT_ID or "(not configured)",
        "githubUrl": product.get("githubUrl", ""),
        "registeredAt": now,
        "publishedAt": None,
    }

    if existing:
        registrations = [r for r in registrations if r["productId"] != product_id]
    registrations.append(reg)
    _save_registrations(registrations)
    return reg


def get_registrations() -> list[dict]:
    """Return all local EDC registrations (published + pending)."""
    return _load_registrations()


def delete_registration(product_id: str) -> bool:
    """Remove a local registration entry."""
    registrations = _load_registrations()
    filtered = [r for r in registrations if r["productId"] != product_id]
    if len(filtered) == len(registrations):
        return False
    _save_registrations(filtered)
    return True


def mark_registration_deleted(product_id: str) -> bool:
    """Mark a registration as 'deleted' instead of removing it."""
    registrations = _load_registrations()
    for reg in registrations:
        if reg["productId"] == product_id and reg.get("status") != "deleted":
            reg["status"] = "deleted"
            reg["deletedAt"] = datetime.now().isoformat()
            _save_registrations(registrations)
            return True
    return False


def sync_registration_status(existing_product_ids: set[str]) -> dict:
    """
    Compare registrations against existing product IDs.
    Mark registrations whose products no longer exist as 'deleted'.
    Returns summary of changes.
    """
    registrations = _load_registrations()
    marked = 0
    for reg in registrations:
        if reg.get("status") in ("published", "pending"):
            if reg["productId"] not in existing_product_ids:
                reg["status"] = "deleted"
                reg["deletedAt"] = datetime.now().isoformat()
                marked += 1
    if marked > 0:
        _save_registrations(registrations)
    return {"checked": len(registrations), "marked_deleted": marked}


def update_registration_policy(product_id: str, policy_id: str) -> dict | None:
    """Update the policy ID assigned to a registration."""
    registrations = _load_registrations()
    for reg in registrations:
        if reg["productId"] == product_id:
            reg["policyId"] = policy_id
            _save_registrations(registrations)
            return reg
    return None


def update_registration_contract(product_id: str, contract_def_id: str) -> dict | None:
    """Update the contract definition ID assigned to a registration."""
    registrations = _load_registrations()
    for reg in registrations:
        if reg["productId"] == product_id:
            reg["contractDefinitionId"] = contract_def_id
            _save_registrations(registrations)
            return reg
    return None


async def sync_pending() -> dict:
    """
    Try to publish all pending registrations to the live EDC connector.
    Returns a summary of what was synced.
    """
    registrations = _load_registrations()
    pending = [r for r in registrations if r.get("status") == "pending"]

    if not pending:
        return {"synced": 0, "failed": 0, "message": "No pending registrations"}

    status = await get_edc_status()
    if status["status"] != "online":
        return {"synced": 0, "failed": len(pending), "message": "EDC connector is not online"}

    synced = 0
    failed = 0

    for reg in pending:
        try:
            product = {
                "productId": reg["productId"],
                "productName": reg["productName"],
                "githubUrl": reg.get("githubUrl", ""),
            }
            # Use the assigned policy ID from the registration
            assigned_policy = reg.get("policyId")
            result = await publish_product(product, policy_id=assigned_policy)
            real_asset = result.get("asset", {})

            reg["assetId"] = real_asset.get("@id", real_asset.get("id", reg["assetId"]))
            reg["policyId"] = result.get("policy_id", reg["policyId"])
            real_cd = result.get("contract_definition", {})
            reg["contractDefinitionId"] = real_cd.get("@id", real_cd.get("id", reg["contractDefinitionId"]))
            reg["status"] = "published"
            reg["connectorUrl"] = EDC_MANAGEMENT_URL
            reg["participantId"] = EDC_PARTICIPANT_ID
            reg["publishedAt"] = datetime.now().isoformat()
            synced += 1

        except Exception as e:
            print(f"[EDC] Sync failed for {reg['productId']}: {e}")
            reg["status"] = "failed"
            failed += 1

    _save_registrations(registrations)
    return {"synced": synced, "failed": failed, "total": len(pending)}


# ---------------------------------------------------------------------------
# Catena-X Discovery Services
# ---------------------------------------------------------------------------

# In-memory token cache for discovery service OAuth2
_discovery_token_cache: dict = {}


async def _get_discovery_token() -> str | None:
    """Get an OAuth2 access token for Catena-X Discovery Services."""
    if not EDC_DISCOVERY_AUTH_URL or not EDC_DISCOVERY_CLIENT_ID:
        return None

    # Check cache
    cached = _discovery_token_cache.get("token")
    if cached and cached.get("expires_at", 0) > datetime.now().timestamp():
        return cached["access_token"]

    client = _get_edc_client()
    resp = await client.post(
        EDC_DISCOVERY_AUTH_URL,
        data={
            "grant_type": "client_credentials",
            "client_id": EDC_DISCOVERY_CLIENT_ID,
            "client_secret": EDC_DISCOVERY_CLIENT_SECRET,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    resp.raise_for_status()
    token_data = resp.json()

    # Cache with buffer (expire 60s early)
    _discovery_token_cache["token"] = {
        "access_token": token_data["access_token"],
        "expires_at": datetime.now().timestamp() + token_data.get("expires_in", 300) - 60,
    }
    return token_data["access_token"]


def _discovery_headers(token: str | None) -> dict:
    """Build headers for discovery service calls."""
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


async def get_discovery_status() -> dict:
    """Check which discovery services are configured and reachable."""
    result = {
        "bpnDiscovery": {
            "configured": bool(EDC_BPN_DISCOVERY_URL),
            "url": EDC_BPN_DISCOVERY_URL,
            "status": "not_configured",
        },
        "edcDiscovery": {
            "configured": bool(EDC_EDC_DISCOVERY_URL),
            "url": EDC_EDC_DISCOVERY_URL,
            "status": "not_configured",
        },
        "auth": {
            "configured": bool(EDC_DISCOVERY_AUTH_URL and EDC_DISCOVERY_CLIENT_ID),
            "url": EDC_DISCOVERY_AUTH_URL,
        },
    }

    client = _get_edc_client()
    if EDC_BPN_DISCOVERY_URL:
        try:
            token = await _get_discovery_token()
            resp = await client.get(
                EDC_BPN_DISCOVERY_URL.rstrip("/"),
                headers=_discovery_headers(token),
            )
            result["bpnDiscovery"]["status"] = "online" if resp.status_code in (200, 401, 403, 405) else "error"
        except Exception:
            result["bpnDiscovery"]["status"] = "offline"

    if EDC_EDC_DISCOVERY_URL:
        try:
            token = await _get_discovery_token()
            resp = await client.get(
                EDC_EDC_DISCOVERY_URL.rstrip("/"),
                headers=_discovery_headers(token),
            )
            result["edcDiscovery"]["status"] = "online" if resp.status_code in (200, 401, 403, 405) else "error"
        except Exception:
            result["edcDiscovery"]["status"] = "offline"

    return result


async def bpn_discovery(search_keys: list[str], resource_type: str = "manufacturerPartId") -> list[dict]:
    """
    BPN Discovery: Resolve asset/part identifiers → BPN numbers.

    The BPN Discovery Service answers: "Which BPN owns this part ID?"

    Args:
        search_keys: List of identifiers to look up (e.g. part IDs, serial numbers)
        resource_type: Type of identifier (default: manufacturerPartId)

    Returns:
        List of {type, key, value (=BPN), resourceIdentifier} results
    """
    if not EDC_BPN_DISCOVERY_URL:
        return []

    token = await _get_discovery_token()
    body = {
        "searchFilter": [
            {
                "type": resource_type,
                "keys": search_keys,
            }
        ]
    }
    client = _get_edc_client()
    resp = await client.post(
        EDC_BPN_DISCOVERY_URL.rstrip("/") + "/api/v1.0/administration/connectors/bpnDiscovery/search",
        headers=_discovery_headers(token),
        json=body,
    )
    resp.raise_for_status()
    data = resp.json()
    return data.get("bpns", data) if isinstance(data, dict) else data


async def edc_discovery(bpn_list: list[str]) -> list[dict]:
    """
    EDC Discovery: Resolve BPN numbers → Connector endpoint URLs.

    The EDC Discovery Service answers: "What is the DSP endpoint for this BPN?"

    Args:
        bpn_list: List of Business Partner Numbers to look up

    Returns:
        List of {bpn, connectorEndpoint[]} results
    """
    if not EDC_EDC_DISCOVERY_URL:
        return []

    token = await _get_discovery_token()
    client = _get_edc_client()
    resp = await client.post(
        EDC_EDC_DISCOVERY_URL.rstrip("/") + "/api/v1.0/administration/connectors/discovery",
        headers=_discovery_headers(token),
        json=bpn_list,
    )
    resp.raise_for_status()
    return resp.json()


async def discover_endpoints(search_key: str, resource_type: str = "manufacturerPartId") -> list[dict]:
    """
    Full discovery chain: Identifier → BPN → Connector URL.

    Combines BPN Discovery + EDC Discovery into a single lookup.
    This is the main entry point for finding a partner's connector in the dataspace.

    Args:
        search_key: Asset/part identifier to look up
        resource_type: Type of identifier

    Returns:
        List of {bpn, connectorEndpoint, searchKey} results
    """
    results = []

    # Step 1: searchKey → BPN(s) via BPN Discovery
    bpn_results = await bpn_discovery([search_key], resource_type)

    # Extract unique BPNs
    bpns: list[str] = []
    for entry in bpn_results:
        bpn = entry.get("value") or entry.get("bpn") or ""
        if bpn and bpn not in bpns:
            bpns.append(bpn)

    if not bpns:
        return results

    # Step 2: BPN(s) → Connector URL(s) via EDC Discovery
    edc_results = await edc_discovery(bpns)

    for entry in edc_results:
        bpn = entry.get("bpn", "")
        endpoints = entry.get("connectorEndpoint", [])
        if isinstance(endpoints, str):
            endpoints = [endpoints]
        for ep in endpoints:
            results.append({
                "bpn": bpn,
                "connectorEndpoint": ep,
                "searchKey": search_key,
            })

    return results
