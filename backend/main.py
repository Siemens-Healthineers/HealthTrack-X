# Trademark notice: "Asset Administration Shell" (AAS) and the AAS logo are
# trademarks of the Industrial Digital Twin Association (IDTA), referenced here
# for identification and interoperability purposes only.
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
import os
from dotenv import load_dotenv
import json
import base64
import traceback
from github import Github, GithubException, Auth
from typing import Any, Final, Literal, Optional
import time
from datetime import datetime
import asyncio
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from threading import RLock

# Module-level thread pool (reused across requests, avoids per-call allocation)
_thread_pool = ThreadPoolExecutor(max_workers=10)
import uuid
from pathlib import Path
import re
import yaml
import httpx

# Job store (in-memory job status for frontend polling)
import job_store

# NATS JetStream client (K8s-ready distributed messaging)
import nats_client

_worker_task: asyncio.Task | None = None

# GitHub Configuration Manager
from github_config_manager import config_manager

# AI Material Classification
from material_classifier import (
    classify_material, check_ollama_status,
    get_all_cached_classifications, invalidate_classification,
)

# AI Chat Agent (local Ollama LLM with tool-calling)
import chat_agent

# GitHub App Service - Automated Repo Creation
from github_app_service import github_app_service

# EDC Tractus-X Connector
import edc_connector

# EU Critical Raw Materials Act checker
from crma_checker import check_crma_status

# Dynamic schema validation (from cached repository-metadata)
import schema_validator

# User-facing API authentication scaffold (disabled by default for local dev)
from auth import auth_status_payload, install_auth_middleware, current_user, get_auth_settings

# Keycloak Admin API (user approval workflow)
import keycloak_admin

# BaSyx AAS imports
try:
    from basyx.aas import model
    from basyx.aas.adapter.json import json_serialization
    BASYX_AVAILABLE = True
except ImportError:
    BASYX_AVAILABLE = False
    model = None  # Set to None if not available
    print("Warning: BaSyx Python SDK not installed. AAS export will be disabled.")

# Load environment variables for optional non-K8s runs.
# Kubernetes injects runtime env via ConfigMaps/Secrets; docker compose can still
# provide backend/config/env/.env for supplementary local use.
_backend_dir = Path(__file__).parent
_root_env = _backend_dir.parent / ".env"
_legacy_env = _backend_dir / "config" / "env" / ".env"

if _root_env.exists():
    load_dotenv(dotenv_path=_root_env)
elif _legacy_env.exists():
    load_dotenv(dotenv_path=_legacy_env)

app = FastAPI(title="Data Repository API")


def generate_unique_product_id() -> str:
    """Generate a collision-resistant product ID.

    Format: HTX-PROD-{YYYYMMDD}-{uuid4-short}
    The 8-char UUID suffix guarantees uniqueness even for simultaneous requests.
    """
    date_str = datetime.now().strftime("%Y%m%d")
    short_uuid = uuid.uuid4().hex[:8]
    return f"HTX-PROD-{date_str}-{short_uuid}"


# ── MaterialComposition (VDA 231-301) submodel builder ─────────────────────────
# Ported from material_composition_submodel.py (leaf-material case only — no
# BOM tree walk, no aggregated composition, no TotalMass).
#
# Semantic IDs are namespaced under the data repository base URL
# (derived from the product's github_url), so each deployment emits stable
# concept URIs that live alongside the data. When no github_url is known we
# fall back to the historical https://example.com/… namespace.

def _repo_base_from_github_url(github_url: Optional[str]) -> str:
    """Derive the repository root URL from a blob/raw file URL.

    Examples:
        https://host/org/repo/blob/main/products/x.json → https://host/org/repo
        https://raw.host/org/repo/main/products/x.json  → https://raw.host/org/repo
    """
    if not github_url:
        return "https://example.com"
    for marker in ("/blob/", "/raw/", "/tree/"):
        idx = github_url.find(marker)
        if idx > 0:
            return github_url[:idx]
    # raw.<host>/org/repo/<branch>/<path> – no explicit marker; take first 5 segments
    parts = github_url.split("/")
    if len(parts) >= 5:
        return "/".join(parts[:5])
    return github_url.rstrip("/")


def _mc_sem_ids(repo_base: str) -> dict:
    """Build the MaterialComposition semantic-ID map for a given repo base."""
    base = repo_base.rstrip("/")
    return {
        "submodel":        f"{base}/MaterialComposition/1/0/Submodel",
        "materials":       f"{base}/MaterialComposition/Material/1/0",
        "material_id":     f"{base}/MaterialComposition/MaterialId/1/0",
        "nomenclatures":   f"{base}/MaterialComposition/MaterialNomenclatures/1/0",
        "classifications": f"{base}/MaterialComposition/MaterialClassifications/1/0",
        "chem_comp":       f"{base}/MaterialComposition/ChemicalComposition/1/0",
        "chem_element":    f"{base}/MaterialComposition/ChemicalElement/1/0",
        # CAS is a global registry – keep fixed, not repo-scoped.
        "cas_number":      "https://www.cas.org/cas-data/cas-registry",
    }


def _mc_ext_ref(iri: str):
    return model.ExternalReference(
        (model.Key(type_=model.KeyTypes.GLOBAL_REFERENCE, value=iri),)
    )


def _mc_prop(id_short: str, value_type, value, sem: Optional[str] = None):
    kwargs: dict = dict(id_short=id_short, value_type=value_type, value=value)
    if sem:
        kwargs["semantic_id"] = _mc_ext_ref(sem)
    return model.Property(**kwargs)


def _mc_opt_double(id_short: str, value: Optional[float]):
    return model.Property(id_short=id_short, value_type=model.datatypes.Double, value=value)


def _mc_to_float(v) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def _mc_build_chemical_elements_list(elements: list[dict], sem: str):
    """Build SubmodelElementList of chemical elements (ChemicalSymbol, CAS, avg/min/max)."""
    entries = []
    for elem in elements:
        symbol = elem.get("element", "") or ""
        avg = _mc_to_float(elem.get("avg"))
        lo  = _mc_to_float(elem.get("min"))
        hi  = _mc_to_float(elem.get("max"))
        cas = elem.get("cas")

        props = [_mc_prop("ChemicalSymbol", model.datatypes.String, symbol)]
        if cas:
            props.append(_mc_prop("CASNumber", model.datatypes.String, str(cas),
                                  "https://www.cas.org/cas-data/cas-registry"))
        props.extend([
            _mc_opt_double("AvgPercentage", avg),
            _mc_opt_double("MinPercentage", lo),
            _mc_opt_double("MaxPercentage", hi),
        ])
        entries.append(model.SubmodelElementCollection(id_short=None, value=props))

    return model.SubmodelElementList(
        type_value_list_element=model.SubmodelElementCollection,
        id_short="ChemicalElements",
        value=entries,
        order_relevant=True,
        semantic_id=_mc_ext_ref(sem),
    )


def _mc_build_nomenclatures(mat: dict):
    standard    = mat.get("nomenclatureStandard")
    designation = mat.get("designation")
    mat_number  = mat.get("materialNumber")
    family      = mat.get("alloyGroup")
    if not any([standard, designation, mat_number, family]):
        return None

    props = []
    if standard:
        props.append(_mc_prop("Standard", model.datatypes.String, standard))
    if designation:
        props.append(_mc_prop("Designation", model.datatypes.String, designation))
    if mat_number:
        props.append(_mc_prop("MaterialNumber", model.datatypes.String, str(mat_number)))
    if family:
        props.append(_mc_prop("MaterialFamily", model.datatypes.String, family))

    return model.SubmodelElementCollection(id_short="MaterialNomenclatures", value=props)


def _mc_build_classifications(mat: dict):
    standard = mat.get("classificationStandard")
    category = mat.get("classificationCategory")
    cls      = mat.get("classificationClass")
    subclass = mat.get("classificationSubclass")
    if not any([standard, category, cls, subclass]):
        return None

    props = []
    for id_short, value in [("Standard", standard), ("Category", category),
                            ("Class", cls), ("Subclass", subclass)]:
        if value:
            props.append(_mc_prop(id_short, model.datatypes.String, value))

    return model.SubmodelElementCollection(id_short="MaterialClassifications", value=props)


def _mc_build_chem_composition(mat: dict, sem_chem_comp: str, sem_chem_element: str):
    elements = mat.get("chemicalComposition") or []
    if not elements:
        return None

    inner = []
    standard = mat.get("compositionStandard")
    if standard:
        inner.append(_mc_prop("Standard", model.datatypes.String, standard))
    unit = mat.get("compositionUnit")
    if unit:
        inner.append(_mc_prop("Unit", model.datatypes.String, unit))
    inner.append(_mc_build_chemical_elements_list(elements, sem=sem_chem_element))

    return model.SubmodelElementCollection(
        id_short="ChemicalComposition",
        value=inner,
        semantic_id=_mc_ext_ref(sem_chem_comp),
    )


def build_material_composition_submodel_from_flat(
    mat: dict,
    submodel_id: str,
    github_url: Optional[str] = None,
):
    """Build a VDA 231-301 MaterialComposition Submodel from a flat material dict.

    ``mat`` is a single-record VDA 231-301 material:
    materialId, designation, materialNumber, alloyGroup, nomenclatureStandard,
    classificationStandard/Category/Class/Subclass, compositionStandard,
    compositionUnit, chemicalComposition: [{element, cas, avg?, min?, max?}, ...].

    Leaf-material form only: single Materials entry, no TotalMass, no
    AggregatedChemicalComposition. Returns ``None`` when no material data is
    present.
    """
    if not mat.get("chemicalComposition") and not mat.get("materialId"):
        return None

    sem = _mc_sem_ids(_repo_base_from_github_url(github_url))

    inner = [
        _mc_prop("MaterialId",
                 model.datatypes.String,
                 mat.get("materialId", "") or "",
                 sem["material_id"]),
        _mc_prop("MaterialIdRevision",
                 model.datatypes.String,
                 str(mat.get("materialIdRevision") or "")),
    ]
    noms = _mc_build_nomenclatures(mat)
    if noms is not None:
        inner.append(noms)
    cls_list = _mc_build_classifications(mat)
    if cls_list is not None:
        inner.append(cls_list)
    chem = _mc_build_chem_composition(mat, sem["chem_comp"], sem["chem_element"])
    if chem is not None:
        inner.append(chem)

    materials_entry = model.SubmodelElementCollection(id_short=None, value=inner)

    materials_list = model.SubmodelElementList(
        type_value_list_element=model.SubmodelElementCollection,
        id_short="Materials",
        value=[materials_entry],
        order_relevant=True,
        semantic_id=_mc_ext_ref(sem["materials"]),
    )

    return model.Submodel(
        id_=submodel_id,
        id_short="MaterialComposition",
        submodel_element=[materials_list],
        semantic_id=_mc_ext_ref(sem["submodel"]),
    )


def create_product_aas(data_dict: dict, github_url: str = None, github_raw_url: str = None) -> Optional[any]:
    """
    Create an Asset Administration Shell (AAS) for a product
    Following IDTA standards and Digital Product Passport structure
    Compatible with BaSyx Python SDK 2.0
    Uses actual GitHub URLs as identifiers if provided

    For VDA 231-301 material records (Semi-finished Good use case), emits a
    MaterialComposition submodel instead of the generic MaterialInformation /
    SustainabilityInformation pair. Detection is based on the presence of a
    non-empty ``chemicalComposition`` list.
    """
    if not BASYX_AVAILABLE:
        return None
    
    try:
        product_id = data_dict.get('productId', 'UNKNOWN')
        
        # Create safe id_short (only letters, digits, underscore allowed)
        safe_product_id = product_id.replace('-', '_')
        
        # Create identifiers using GitHub URLs if available, otherwise fallback to demo URLs
        if github_url:
            # Use actual GitHub URLs as unique identifiers
            # The github_url is the AAS file itself (products-aas/xxx-aas.json)
            aas_id = github_url  # The AAS file URL is the AAS identifier
            asset_id = github_url  # The AAS file also represents the asset
            submodel_material_id = f"{github_url}#MaterialInformation"
            submodel_sustainability_id = f"{github_url}#SustainabilityInformation"
            submodel_material_composition_id = f"{github_url}#MaterialComposition"
        else:
            # Fallback to demo URLs (used during development/testing)
            aas_id = f"https://htx-demo.com/aas/{product_id}"
            asset_id = f"https://htx-demo.com/assets/{product_id}"
            submodel_material_id = f"https://htx-demo.com/sm/material/{product_id}"
            submodel_sustainability_id = f"https://htx-demo.com/sm/sustainability/{product_id}"
            submodel_material_composition_id = f"https://htx-demo.com/sm/materialcomposition/{product_id}"

        # Create Asset Information (replaces Asset in SDK 2.0)
        asset_info = model.AssetInformation(
            asset_kind=model.AssetKind.TYPE,
            global_asset_id=asset_id,
        )

        # VDA 231-301 Semi-finished Good shape: build a MaterialComposition
        # submodel and return early — the generic MaterialInformation /
        # SustainabilityInformation submodels would be redundant.
        chem = data_dict.get("chemicalComposition")
        if isinstance(chem, list) and len(chem) > 0:
            mc_submodel = build_material_composition_submodel_from_flat(
                data_dict,
                submodel_id=submodel_material_composition_id,
                github_url=github_url,
            )
            if mc_submodel is not None:
                aas_mc = model.AssetAdministrationShell(
                    id_=aas_id,
                    id_short=f"AAS_{safe_product_id}",
                    asset_information=asset_info,
                    submodel={model.ModelReference.from_referable(mc_submodel)},
                )
                return aas_mc, [mc_submodel]
        
        # Create Material Information Submodel
        submodel_material = model.Submodel(
            id_=submodel_material_id,
            id_short="MaterialInformation",
            semantic_id=model.ExternalReference(
                (model.Key(
                    type_=model.KeyTypes.GLOBAL_REFERENCE,
                    value="https://admin-shell.io/idta/material/1/0",
                ),)
            ),
        )
        
        # Add properties to material submodel
        submodel_material.submodel_element.add(
            model.Property(
                id_short="ProductName",
                value_type=model.datatypes.String,
                value=data_dict.get('productName', ''),
                semantic_id=model.ExternalReference(
                    (model.Key(
                        type_=model.KeyTypes.GLOBAL_REFERENCE,
                        value="https://admin-shell.io/idta/material/productName/1/0",
                    ),)
                ),
            )
        )
        
        submodel_material.submodel_element.add(
            model.Property(
                id_short="MaterialName",
                value_type=model.datatypes.String,
                value=data_dict.get('materialName', ''),
                semantic_id=model.ExternalReference(
                    (model.Key(
                        type_=model.KeyTypes.GLOBAL_REFERENCE,
                        value="https://admin-shell.io/idta/material/materialName/1/0",
                    ),)
                ),
            )
        )
        
        submodel_material.submodel_element.add(
            model.Property(
                id_short="Manufacturer",
                value_type=model.datatypes.String,
                value=data_dict.get('manufacturer', ''),
                semantic_id=model.ExternalReference(
                    (model.Key(
                        type_=model.KeyTypes.GLOBAL_REFERENCE,
                        value="https://admin-shell.io/idta/material/manufacturer/1/0",
                    ),)
                ),
            )
        )
        
        # Create Sustainability Submodel
        submodel_sustainability = model.Submodel(
            id_=submodel_sustainability_id,
            id_short="SustainabilityInformation",
            semantic_id=model.ExternalReference(
                (model.Key(
                    type_=model.KeyTypes.GLOBAL_REFERENCE,
                    value="https://admin-shell.io/idta/sustainability/1/0",
                ),)
            ),
        )
        
        # Add sustainability properties
        submodel_sustainability.submodel_element.add(
            model.Property(
                id_short="RecycledContent",
                value_type=model.datatypes.String,
                value=str(data_dict.get('recycledContent', '') or ''),
                semantic_id=model.ExternalReference(
                    (model.Key(
                        type_=model.KeyTypes.GLOBAL_REFERENCE,
                        value="https://admin-shell.io/idta/sustainability/recycledContent/1/0",
                    ),)
                ),
            )
        )
        
        submodel_sustainability.submodel_element.add(
            model.Property(
                id_short="CO2Equivalent",
                value_type=model.datatypes.String,
                value=str(data_dict.get('co2Equivalent', '') or ''),
                semantic_id=model.ExternalReference(
                    (model.Key(
                        type_=model.KeyTypes.GLOBAL_REFERENCE,
                        value="https://admin-shell.io/idta/sustainability/co2Equivalent/1/0",
                    ),)
                ),
            )
        )
        
        submodel_sustainability.submodel_element.add(
            model.Property(
                id_short="CO2Method",
                value_type=model.datatypes.String,
                value=data_dict.get('co2Method', ''),
                semantic_id=model.ExternalReference(
                    (model.Key(
                        type_=model.KeyTypes.GLOBAL_REFERENCE,
                        value="https://admin-shell.io/idta/sustainability/co2Method/1/0",
                    ),)
                ),
            )
        )
        
        # Create Asset Administration Shell (with proper references to submodels)
        aas = model.AssetAdministrationShell(
            id_=aas_id,
            id_short=f"AAS_{safe_product_id}",
            asset_information=asset_info,
            submodel={
                model.ModelReference.from_referable(submodel_material),
                model.ModelReference.from_referable(submodel_sustainability),
            }
        )
        
        return aas, [submodel_material, submodel_sustainability]
        
    except Exception as e:
        print(f"Error creating AAS: {str(e)}")
        traceback.print_exc()
        return None


def aas_to_json(aas, submodels) -> Optional[str]:
    """
    Convert AAS and submodels to JSON string
    """
    if not BASYX_AVAILABLE or not aas:
        return None
    
    try:
        # Create object store
        obj_store = model.DictObjectStore()
        obj_store.add(aas)
        for submodel in submodels:
            obj_store.add(submodel)
        
        # Serialize to JSON
        json_data = json_serialization.object_store_to_json(obj_store, indent=2)
        return json_data
        
    except Exception as e:
        print(f"Error serializing AAS to JSON: {str(e)}")
        return None


# Cache for product list (multi-key: one entry per config+folder combination)
# 3-tier: in-memory → persistent disk (cache/products_cache/) → GitHub API
_products_cache: dict[str, dict] = {}
_PRODUCTS_CACHE_DURATION: Final[int] = 60  # seconds – server memory cache
_PRODUCTS_DISK_CACHE_DIR: Final[Path] = Path(__file__).parent / "cache" / "products_cache"
_PRODUCTS_DISK_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _products_cache_key(config_id: Optional[str], folder: str) -> str:
    return f"{config_id or 'default'}:{folder}"


def _products_disk_path(config_id: Optional[str], folder: str) -> Path:
    return _PRODUCTS_DISK_CACHE_DIR / f"{config_id or 'default'}_{folder}.json"


def _persist_products_cache(config_id: Optional[str], folder: str, products: list) -> None:
    """Write products to disk cache (atomic)."""
    path = _products_disk_path(config_id, folder)
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_text(json.dumps(products, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)
    except Exception as e:
        print(f"[WARN] Failed to persist products cache {path.name}: {e}")
        tmp.unlink(missing_ok=True)


def _load_products_disk_cache(config_id: Optional[str], folder: str) -> list | None:
    """Load products from disk cache. Returns None on miss/error."""
    path = _products_disk_path(config_id, folder)
    try:
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return data
    except Exception as e:
        print(f"[WARN] Failed to read products disk cache {path.name}: {e}")
    return None


# Cached PyGithub Repository objects (avoids a GET /repos/:owner/:repo API call
# on every list / write / delete operation).  Keyed by "config_id:repo_name".
_repo_obj_cache: dict[str, object] = {}

def _get_repo(g, repo_name: str, config_id: Optional[str] = None):
    """Return a (possibly cached) PyGithub Repository object."""
    key = f"{config_id or 'default'}:{repo_name}"
    cached = _repo_obj_cache.get(key)
    if cached is not None:
        return cached
    repo = g.get_repo(repo_name)
    _repo_obj_cache[key] = repo
    return repo


def _invalidate_products_cache(config_id: Optional[str] = None, folder: str = "products") -> None:
    """Invalidate the in-memory and disk cache for a given config+folder."""
    key = _products_cache_key(config_id, folder)
    _products_cache.pop(key, None)
    _products_disk_path(config_id, folder).unlink(missing_ok=True)


def _upsert_product_in_list(products: list, product_id: str, product: dict) -> bool:
    """Update product in place, or append it. Returns True when it replaced an entry."""
    for index, existing in enumerate(products):
        if existing.get("productId") == product_id:
            products[index] = product
            return True
    products.append(product)
    return False


def _replace_products_cache(config_id: Optional[str], folder: str, products: list) -> None:
    """Replace memory + disk cache after an atomic batch write."""
    _products_cache[_products_cache_key(config_id, folder)] = {
        "data": products,
        "ts": time.time(),
    }
    _persist_products_cache(config_id, folder, products)


def _upsert_products_cache(config_id: Optional[str], folder: str, product: dict) -> None:
    """Insert or update a single product in the memory + disk cache."""
    key = _products_cache_key(config_id, folder)
    mem = _products_cache.get(key)
    if mem is None:
        # No memory cache yet — still update disk cache if it exists
        disk_data = _load_products_disk_cache(config_id, folder)
        if disk_data is None:
            return
        pid = product.get("productId")
        if not pid:
            return
        _upsert_product_in_list(disk_data, pid, product)
        _persist_products_cache(config_id, folder, disk_data)
        return
    pid = product.get("productId")
    if not pid:
        _products_cache.pop(key, None)
        _products_disk_path(config_id, folder).unlink(missing_ok=True)
        return
    data: list = mem["data"]
    _upsert_product_in_list(data, pid, product)
    mem["ts"] = time.time()
    _persist_products_cache(config_id, folder, data)


# Configure CORS - origins are configurable via env var for container deployment.
# Keep this explicit once credentials / bearer auth are used; wildcard + credentials
# is rejected by browsers and is too loose for the future Azure deployment.
_cors_env = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,http://localhost:5173,http://localhost:5174,"
    "http://127.0.0.1:3000,http://127.0.0.1:5173,http://127.0.0.1:5174",
)
_cors_origins: list[str] = (
    ["*"] if _cors_env.strip() == "*"
    else [o.strip() for o in _cors_env.split(",") if o.strip()]
)
install_auth_middleware(app)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials="*" not in _cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# GitHub configuration - Try to load from file first, fallback to environment variables
file_config = config_manager.load_config()

if file_config:
    # Use file-based configuration
    GITHUB_TOKEN = file_config.get("github_token")
    GITHUB_APP_ID = file_config.get("github_app_id")
    GITHUB_APP_PRIVATE_KEY_RAW = file_config.get("github_app_private_key")
    GITHUB_APP_INSTALLATION_ID = file_config.get("github_app_installation_id")
    GITHUB_REPO = file_config.get("github_repo")
    GITHUB_BRANCH = file_config.get("github_branch", "main")
    GITHUB_BASE_URL = file_config.get("github_base_url")
    
    # Check if decryption failed (None values for encrypted fields)
    if not GITHUB_APP_PRIVATE_KEY_RAW and file_config.get("auth_method") == "app":
        print("WARNING: GitHub App Private Key could not be decrypted!")
        file_config = None  # Force fallback to env vars
    else:
        print(f"OK - Config: {file_config.get('name', file_config.get('github_repo', 'unknown'))}")

if not file_config:
    # Fallback to environment variables
    GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")  # Personal Access Token (optional)
    GITHUB_APP_ID = os.getenv("GITHUB_APP_ID")  # GitHub App ID (optional)
    GITHUB_APP_PRIVATE_KEY_RAW = os.getenv("GITHUB_APP_PRIVATE_KEY")  # GitHub App Private Key (optional)
    GITHUB_APP_INSTALLATION_ID = os.getenv("GITHUB_APP_INSTALLATION_ID")  # Installation ID (optional)
    GITHUB_REPO = os.getenv("GITHUB_REPO")  # Format: "owner/repo"
    GITHUB_BRANCH = os.getenv("GITHUB_BRANCH", "main")
    GITHUB_BASE_URL = os.getenv("GITHUB_BASE_URL")
    print("OK - Config: environment variables")

# Process the private key - handle both escaped newlines and actual newlines
GITHUB_APP_PRIVATE_KEY = None
if GITHUB_APP_PRIVATE_KEY_RAW:
    # Handle different newline formats:
    # 1. Literal \n strings (from env vars)
    # 2. Already properly formatted with actual newlines (from encrypted storage)
    key_text = GITHUB_APP_PRIVATE_KEY_RAW.replace('\\n', '\n')
    
    # Validate key format
    if key_text and ('BEGIN' in key_text and 'PRIVATE KEY' in key_text):
        GITHUB_APP_PRIVATE_KEY = key_text
    else:
        print(f"WARNING: Private Key does not appear to be valid PEM format!")
        GITHUB_APP_PRIVATE_KEY = key_text  # Still try to use it

if not GITHUB_REPO:
    print("WARNING: GITHUB_REPO not set – GitHub features disabled until configured via Settings")
    GITHUB_REPO_OWNER = None
    GITHUB_REPO_NAME = None
elif '/' in GITHUB_REPO:
    GITHUB_REPO_OWNER, GITHUB_REPO_NAME = GITHUB_REPO.split('/', 1)
else:
    raise ValueError("GITHUB_REPO must be in format 'owner/repository-name'")

if not GITHUB_REPO:
    pass  # GitHub credentials not required when repo not configured
elif not GITHUB_TOKEN and not (GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY and GITHUB_APP_INSTALLATION_ID):
    print(
        "WARNING: No GitHub credentials configured – set GITHUB_TOKEN or GitHub App credentials"
    )

# Cache for GitHub client to avoid re-initialization overhead
_github_client_cache = None
_github_connection_status = {
    "status": "checking",
    "message": "Not yet checked",
    "checked_at": None
}

def get_github_client() -> Github:
    """Get GitHub client with appropriate authentication method (cached)"""
    global _github_client_cache
    
    # Return cached client if available
    if _github_client_cache is not None:
        return _github_client_cache
    
    # Create new client and cache it
    if GITHUB_TOKEN:
        # Use Personal Access Token
        auth = Auth.Token(GITHUB_TOKEN)
        client = Github(auth=auth, base_url=GITHUB_BASE_URL) if GITHUB_BASE_URL else Github(auth=auth)
    else:
        # Use GitHub App authentication
        # Create app authentication and get installation token
        app_auth = Auth.AppAuth(GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY)
        
        # Get installation auth (base_url is NOT supported here)
        installation_auth = app_auth.get_installation_auth(int(GITHUB_APP_INSTALLATION_ID))
        
        # Pass base_url when creating the Github client
        client = Github(auth=installation_auth, base_url=GITHUB_BASE_URL) if GITHUB_BASE_URL else Github(auth=installation_auth)
    
    # Cache the client
    _github_client_cache = client
    return client


def check_github_connection() -> dict:
    """Check GitHub connection and cache result"""
    global _github_connection_status
    
    github_status = "offline"
    github_message = "Not configured"
    
    try:
        if not GITHUB_REPO:
            github_status = "offline"
            github_message = "Repository not configured"
        else:
            # Try to get GitHub client
            g = get_github_client()
            # Test connection by getting repository info
            repo = g.get_repo(GITHUB_REPO)
            _ = repo.name  # Force API call
            github_status = "online"
            github_message = f"Connected to {GITHUB_REPO}"
    except GithubException as e:
        github_status = "error"
        status_code = getattr(e, 'status', 0)
        error_msg = str(e)
        
        if status_code == 401 or "Bad credentials" in error_msg or "Unauthorized" in error_msg:
            github_message = "Authentication failed (401)"
        elif status_code == 404 or "Not Found" in error_msg:
            github_message = "Repository not found (404)"
        elif "rate limit" in error_msg.lower():
            github_message = "Rate limit exceeded"
        else:
            github_message = f"GitHub API error: {error_msg[:50]}"
    except Exception as e:
        github_status = "error"
        error_msg = str(e)
        if "401" in error_msg:
            github_message = "Authentication failed"
        elif "404" in error_msg:
            github_message = "Repository not found"
        else:
            github_message = f"Connection error: {error_msg[:50]}"
    
    _github_connection_status = {
        "status": github_status,
        "message": github_message,
        "checked_at": datetime.now().isoformat()
    }
    
    return _github_connection_status


class DataEntry(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    
    productId: str = ''
    productName: str = ''
    materialName: str = ''
    recycledContent: Optional[float] = None
    co2Equivalent: Optional[float] = None
    co2Method: str = ''
    manufacturer: str = ''


class FileWriteRequest(BaseModel):
    file_path: str
    data: DataEntry
    config_id: Optional[str] = None


MutationActionType = Literal["create", "update", "delete"]


class DataMutationAction(BaseModel):
    action: MutationActionType
    product_id: Optional[str] = None
    data: dict[str, Any] = Field(default_factory=dict)
    config_id: Optional[str] = None
    folder: Optional[str] = None


class DataMutationPreviewRequest(BaseModel):
    actions: list[DataMutationAction] = Field(default_factory=list)
    config_id: Optional[str] = None
    folder: str = "products"
    requested_by: Optional[str] = None


class DataMutationCommitRequest(BaseModel):
    approval_id: Optional[str] = None
    actions: Optional[list[DataMutationAction]] = None
    config_id: Optional[str] = None
    folder: str = "products"
    requested_by: Optional[str] = None


@app.get("/")
async def root():
    auth_method = "Personal Access Token" if GITHUB_TOKEN else "GitHub App"
    return {
        "message": "Data Repository API is running",
        "auth_method": auth_method,
        "repository": GITHUB_REPO
    }


@app.get("/api/auth/status")
async def auth_status():
    """Expose non-secret auth configuration for frontend bootstrapping."""
    payload = auth_status_payload()
    payload["registration_enabled"] = True
    payload["user_management"] = keycloak_admin.is_configured()
    return payload


# ── User Management (Keycloak Admin API) ────────────────────────────────────

def _require_admin(request: Request):
    """Raise 403 if auth is enabled and user is not admin."""
    settings = get_auth_settings()
    if not settings.enabled:
        return  # Auth disabled (local dev) – allow all
    user = current_user(request)
    if "admin" not in user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")


@app.get("/api/users/pending")
async def get_pending_users(request: Request):
    """List users who registered but have not been approved yet."""
    _require_admin(request)
    if not keycloak_admin.is_configured():
        return {"pending": [], "configured": False, "message": "Keycloak Admin API not configured"}
    try:
        pending = await keycloak_admin.get_pending_users()
        return {"pending": pending, "configured": True, "count": len(pending)}
    except Exception as e:
        import traceback
        error_detail = f"{type(e).__name__}: {e}"
        print(f"[KEYCLOAK] get_pending_users failed: {error_detail}")
        traceback.print_exc()
        return {"pending": [], "configured": True, "error": error_detail}


@app.post("/api/users/{user_id}/approve")
async def approve_user(user_id: str, request: Request, data: dict = None):
    """Approve a pending user by assigning realm roles."""
    _require_admin(request)
    if not keycloak_admin.is_configured():
        raise HTTPException(status_code=503, detail="Keycloak Admin API not configured")
    try:
        roles = (data or {}).get("roles")
        result = await keycloak_admin.approve_user(user_id, roles)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/users/{user_id}/reject")
async def reject_user(user_id: str, request: Request):
    """Reject (delete) a pending user."""
    _require_admin(request)
    if not keycloak_admin.is_configured():
        raise HTTPException(status_code=503, detail="Keycloak Admin API not configured")
    try:
        result = await keycloak_admin.reject_user(user_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/system-status")
async def get_system_status():
    """Get system status including NATS JetStream and integrated worker"""
    # Backend is always online if this endpoint responds
    backend_status = "online"
    backend_message = "Backend API running"
    
    # NATS JetStream status
    nats_info = nats_client.get_status()
    nats_status = nats_info["status"]
    nats_message = nats_info["message"]

    # Worker task status
    if _worker_task and not _worker_task.done():
        worker_status = "online"
        worker_message = "Background worker running"
    elif _worker_task and _worker_task.done():
        worker_status = "error"
        exc = _worker_task.exception() if not _worker_task.cancelled() else None
        worker_message = f"Worker crashed: {exc}" if exc else "Worker stopped"
    else:
        worker_status = "offline"
        worker_message = "Worker not started"

    # Downgrade NATS status if worker is not running
    if nats_status == "online" and worker_status != "online":
        nats_status = "warning"
        nats_message = f"Connected but worker {worker_status}"
    
    # Check GitHub configurations - check ALL configs, not just first one
    github_status = "offline"
    github_message = "Not configured"
    
    try:
        all_configs = config_manager.get_all_configs()
        
        if not all_configs or len(all_configs) == 0:
            github_status = "offline"
            github_message = "No GitHub configurations found"
        else:
            # Check if all configs have required fields
            configured_count = 0
            total_count = len(all_configs)
            incomplete_configs = []
            
            for cfg in all_configs:
                is_configured = (
                    cfg.get('github_app_id') and 
                    cfg.get('github_app_private_key') and 
                    cfg.get('github_app_installation_id') and
                    cfg.get('github_repo')
                )
                if is_configured:
                    configured_count += 1
                else:
                    config_name = cfg.get('name', cfg.get('github_repo', 'Unnamed'))
                    incomplete_configs.append(config_name)
            
            if configured_count == total_count:
                github_status = "online"
                if total_count == 1:
                    github_message = f"1 configuration ready"
                else:
                    github_message = f"{total_count} configurations ready"
            elif configured_count > 0:
                github_status = "warning"
                github_message = f"{configured_count}/{total_count} configurations ready"
            else:
                github_status = "error"
                github_message = "All configurations incomplete"
    except Exception as e:
        github_status = "error"
        github_message = f"Error checking configs: {str(e)[:50]}"
    
    # Calculate running services count (core: backend, nats+worker, github)
    services_status_count = 0
    if backend_status == "online":
        services_status_count += 1
    if nats_status == "online" and worker_status == "online":
        services_status_count += 1
    if github_status == "online":
        services_status_count += 1
    
    # Check Ollama AI service
    ollama_status = "offline"
    ollama_message = "Ollama not available"
    try:
        ollama_info = await check_ollama_status()
        if ollama_info["status"] == "online":
            has_classifier = ollama_info.get("model_available", False)
            has_chat = ollama_info.get("chat_model_available", False)
            if has_classifier and has_chat:
                ollama_status = "online"
                ollama_message = f"Ollama running ({ollama_info['required_model']}, {ollama_info.get('chat_model', '?')})"
            elif has_classifier or has_chat:
                ollama_status = "warning"
                missing = []
                if not has_classifier:
                    missing.append(ollama_info["required_model"])
                if not has_chat:
                    missing.append(ollama_info.get("chat_model", "?"))
                ollama_message = f"Model(s) missing: {', '.join(missing)}"
            else:
                ollama_status = "warning"
                ollama_message = f"Models {ollama_info['required_model']}, {ollama_info.get('chat_model', '?')} not found"
        else:
            ollama_status = "offline"
            ollama_message = "Ollama not running"
    except Exception:
        ollama_status = "offline"
        ollama_message = "Cannot check Ollama"
    
    # Determine overall status
    # Core services: Backend + NATS/Worker + GitHub (3 required for green)
    # Future/optional: Ollama, EDC/Tractus-X
    core_online = (
        backend_status == "online"
        and nats_status == "online"
        and worker_status == "online"
        and github_status == "online"
    )
    if core_online:
        overall_status = "online"
        message = "All core systems running"
    elif backend_status == "offline":
        overall_status = "error"
        message = "Backend offline"
    elif services_status_count == 0:
        overall_status = "offline"
        message = "No systems running"
    else:
        overall_status = "warning"
        message = "Some core systems offline or not configured"
    
    return {
        "backend": {
            "status": backend_status,
            "message": backend_message
        },
        "nats": {
            "status": nats_status,
            "message": nats_message,
            "worker": worker_status,
            "worker_message": worker_message
        },
        "github": {
            "status": github_status,
            "message": github_message,
            "auth_method": "app"
        },
        "ollama": {
            "status": ollama_status,
            "message": ollama_message
        },
        "overall_status": overall_status,
        "running_count": services_status_count,
        "expected_count": 3,
        "message": message
    }


@app.post("/api/classify-material")
async def classify_material_endpoint(data: dict):
    """Classify a product into a material type using local AI (Ollama)."""
    result = await classify_material(
        product_name=data.get("productName", ""),
        material_name=data.get("materialName", ""),
        manufacturer=data.get("manufacturer", ""),
        recycled_content=float(data.get("recycledContent", 0) or 0),
        product_id=data.get("productId"),
    )
    return result


@app.get("/api/material-classifications")
async def get_material_classifications():
    """Return all persistently cached material classifications."""
    return get_all_cached_classifications()


@app.get("/api/ollama-status")
async def ollama_status_endpoint():
    """Check Ollama AI service status."""
    return await check_ollama_status()


# ============================================
# AI Chat Endpoint
# ============================================

async def _chat_preview_data_changes(payload: dict) -> dict:
    """Create a mutation preview for local Ollama tool calls.

    This keeps chat-agent write/delete/update actions on the same approval
    path as MCP tools; no GitHub write happens until the frontend approves.
    """
    request = DataMutationPreviewRequest(**payload)
    return await asyncio.to_thread(_create_data_mutation_preview, request)


def _sanitize_chat_ui_context(data: dict) -> dict[str, str]:
    raw = data.get("ui_context")
    if not isinstance(raw, dict):
        return {}
    context: dict[str, str] = {}
    for key in ("active_use_case", "app_profile"):
        value = raw.get(key)
        if value is not None:
            context[key] = str(value)[:120]
    return context


def _build_chat_deps(data: dict) -> dict:
    """Build the backend_deps dict for chat_agent from a chat request."""
    config_id = data.get("config_id")
    folder = data.get("data_folder", "products")
    data_path = _resolve_data_path(config_id, folder)
    return {
        "list_products": list_products,
        "preview_data_changes": _chat_preview_data_changes,
        "config_id": config_id,
        "data_folder": folder,
        "data_path": data_path,
        "ui_context": _sanitize_chat_ui_context(data),
        "get_schema_fields_for_request": lambda: _get_schema_fields_for_request(config_id, f"{data_path}/"),
    }


@app.post("/api/chat")
async def chat_endpoint(data: dict):
    """Chat with the local AI assistant (Ollama + tool-calling)."""
    messages = data.get("messages", [])
    if not messages:
        raise HTTPException(status_code=400, detail="messages array is required")

    result = await chat_agent.chat(messages, _build_chat_deps(data))
    return {
        "role": "assistant",
        "content": result["content"],
        "created_products": result.get("created_products", []),
    }


@app.post("/api/chat/stream")
async def chat_stream_endpoint(data: dict):
    """Stream chat responses as Server-Sent Events (token-by-token)."""
    messages = data.get("messages", [])
    if not messages:
        raise HTTPException(status_code=400, detail="messages array is required")

    return StreamingResponse(
        chat_agent.chat_stream(messages, _build_chat_deps(data)),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ============================================
# Repository Metadata Endpoint
# ============================================

def _get_client_for_config(config: dict) -> Github:
    """Create a GitHub client from a config dict."""
    auth_method = config.get("auth_method", "app")
    base_url = config.get("github_base_url")
    
    if auth_method == "token":
        auth = Auth.Token(config["github_token"])
        return Github(auth=auth, base_url=base_url) if base_url else Github(auth=auth)
    else:
        private_key = config.get("github_app_private_key", "").replace('\\n', '\n')
        app_auth = Auth.AppAuth(config["github_app_id"], private_key)
        installation_auth = app_auth.get_installation_auth(int(config["github_app_installation_id"]))
        return Github(auth=installation_auth, base_url=base_url) if base_url else Github(auth=installation_auth)


# Per-config GitHub client cache (avoids re-creating on every API call)
_config_client_cache: dict[str, Github] = {}


def _resolve_config(config_id: Optional[str] = None):
    """
    Resolve a config_id to (github_client, repo_name, branch).
    Caches clients per config_id. Falls back to global default when None.
    When no env vars are set, falls back to the first saved config.
    """
    if config_id:
        cfg = config_manager.get_config_by_id(config_id)
        if not cfg:
            # Config ID is stale (e.g. from cached metadata after pod restart).
            # Invalidate repo-metadata cache so frontend gets fresh IDs.
            global _repo_metadata_cache
            _repo_metadata_cache = None
            # Try falling back to the first available config
            all_configs = config_manager.get_all_configs()
            if all_configs:
                first = all_configs[0]
                print(f"WARNING: Config '{config_id}' not found, falling back to '{first.get('github_repo')}'")
                return _resolve_config(first.get("id"))
            raise HTTPException(status_code=404, detail=f"Config '{config_id}' not found. Re-save your GitHub config in Settings.")
        repo_name = cfg["github_repo"]
        branch = cfg.get("github_branch", "main")
        cached = _config_client_cache.get(config_id)
        if cached:
            return cached, repo_name, branch
        client = _get_client_for_config(cfg)
        _config_client_cache[config_id] = client
        return client, repo_name, branch
    if not GITHUB_REPO:
        # No env vars — fall back to first saved config (from Settings UI)
        fallback = config_manager.load_config()
        if fallback and fallback.get("github_repo"):
            return _resolve_config(fallback.get("id"))
        raise HTTPException(status_code=404, detail="No GitHub repository configured. Go to Settings → GitHub to add one.")
    return get_github_client(), GITHUB_REPO, GITHUB_BRANCH


# Cached first-config ID (avoids calling get_all_configs on every write/delete)
_first_config_id: str | None = None
_first_config_id_loaded: bool = False

def _is_default_config(config_id: Optional[str] = None) -> bool:
    """
    Check whether config_id refers to the default (first) config.
    Returns True when config_id is None or matches the first config's ID.
    """
    global _first_config_id, _first_config_id_loaded
    if config_id is None:
        return True
    if not _first_config_id_loaded:
        first_config = config_manager.load_config()
        _first_config_id = first_config.get("id") if first_config else None
        _first_config_id_loaded = True
    return _first_config_id is not None and _first_config_id == config_id


def _get_metadata_folders(config_id: Optional[str] = None) -> list[str]:
    """Return the list of folder names defined in repository metadata for a config.

    Falls back to ["products"] when no metadata is available.
    """
    try:
        cache = _load_persistent_metadata_cache()
        if config_id:
            cfg = config_manager.get_config_by_id(config_id)
            repo_name = cfg.get("github_repo") if cfg else None
        else:
            repo_name = GITHUB_REPO
        if repo_name:
            data_folders = cache.get(repo_name, {}).get("data_folders", [])
            names = [df.get("folder") for df in data_folders if df.get("folder")]
            if names:
                return names
    except Exception:
        pass
    return ["products"]


def _resolve_data_path(config_id: Optional[str] = None, folder: str = "products") -> str:
    """
    Resolve the actual repo path for a data folder.

    Uses the ``path`` field from .github/repository-metadata.yml (persisted in
    repo_metadata_cache.json) when available.  Falls back to ``data/{folder}``
    only when no metadata exists yet (backward compatibility).

    If metadata exists but the requested folder is not defined, raises
    HTTPException 400 to prevent accidental writes to wrong paths.

    Returns a directory path (no trailing slash), e.g. "data/products" or
    "quality-reports".
    """
    try:
        cache = _load_persistent_metadata_cache()

        # Determine repo name for this config
        if config_id:
            cfg = config_manager.get_config_by_id(config_id)
            repo_name = cfg.get("github_repo") if cfg else None
            if not repo_name:
                return f"data/{folder}"
        else:
            repo_name = GITHUB_REPO

        cached = cache.get(repo_name, {})
        data_folders = cached.get("data_folders", [])

        for df in data_folders:
            if df.get("folder") == folder:
                path = df.get("path", "")
                if path:
                    # If the path looks like a file (ends with .json), use its
                    # parent directory so we store individual files next to it.
                    if path.endswith(".json"):
                        parent = "/".join(path.split("/")[:-1])
                        if parent:
                            return parent.rstrip("/")
                    return path.rstrip("/")

        # Metadata exists but folder not defined → reject to prevent cross-contamination
        if data_folders:
            known = [df.get("folder") for df in data_folders]
            print(f"[WARN] Folder '{folder}' not in metadata for {repo_name} (known: {known})")
            raise HTTPException(
                status_code=400,
                detail=f"Folder '{folder}' is not defined in repository metadata for {repo_name}. Known folders: {known}"
            )
    except HTTPException:
        raise
    except Exception as e:
        print(f"[WARN] Could not resolve data path for folder '{folder}': {e}")

    # No metadata at all → backward-compatible fallback
    return f"data/{folder}"


def _resolve_aggregated_path(config_id: Optional[str] = None, folder: str = "products", data_path: str = None) -> str:
    """
    Resolve the path to the aggregated JSON file for a data folder.

    The aggregated file is always ``products.json`` in the repository root,
    regardless of the use case's data folder name.
    """
    return "products.json"


# Cache repo metadata (expensive call)
_repo_metadata_cache: dict = {}
_REPO_METADATA_TTL: Final[int] = 120  # 2 minutes

# ── Persistent data-folder metadata from in-repo .github/repository-metadata.yml ──
_HTX_METADATA_FILENAME: Final[str] = ".github/repository-metadata.yml"
_PERSISTENT_CACHE_PATH = Path(__file__).parent / "cache" / "repo_metadata_cache.json"

# In-memory mirror of the persistent metadata cache (avoids disk I/O per request)
_persistent_metadata_mem: dict | None = None

# ── Persistent full repo-graph cache (avoids GitHub API on every page load) ──
_REPO_GRAPH_CACHE_PATH = Path(__file__).parent / "cache" / "repo_graph_cache.json"


def _cache_has_full_depth(data: dict) -> bool:
    """Check whether cached repo-metadata contains full-depth details."""
    repos = data.get("repos", [])
    if not repos:
        return False
    # Full depth includes a non-empty tree or languages; basic has empty defaults
    return any(r.get("tree") or r.get("languages") for r in repos)


def _filter_configured_repo_metadata(data: dict, configs: list[dict]) -> dict:
    configured = {(cfg.get("id"), cfg.get("github_repo")) for cfg in configs}
    repos = [
        repo for repo in data.get("repos", [])
        if (repo.get("config_id"), repo.get("full_name")) in configured
    ]
    return {**data, "repos": repos, "count": len(repos)}


def _load_repo_graph_cache() -> dict | None:
    """Load the persistent full repo-graph cache."""
    try:
        if _REPO_GRAPH_CACHE_PATH.exists():
            with open(_REPO_GRAPH_CACHE_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        print(f"[WARN] Could not load repo graph cache: {e}")
    return None


def _save_repo_graph_cache(data: dict) -> None:
    """Save full repo-graph response to persistent cache (atomic write)."""
    try:
        data["_cached_at"] = datetime.now().isoformat()
        _REPO_GRAPH_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        import tempfile as _tmpfile
        fd, tmp_path = _tmpfile.mkstemp(
            dir=str(_REPO_GRAPH_CACHE_PATH.parent), suffix=".tmp", prefix="rg_cache_",
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            os.replace(tmp_path, str(_REPO_GRAPH_CACHE_PATH))
        except BaseException:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
    except Exception as e:
        print(f"[WARN] Could not save repo graph cache: {e}")


def _load_persistent_metadata_cache() -> dict:
    """Load the persistent local cache of repo metadata (in-memory mirror)."""
    global _persistent_metadata_mem
    if _persistent_metadata_mem is not None:
        return _persistent_metadata_mem
    try:
        if _PERSISTENT_CACHE_PATH.exists():
            with open(_PERSISTENT_CACHE_PATH, "r", encoding="utf-8") as f:
                _persistent_metadata_mem = json.load(f)
                return _persistent_metadata_mem
    except Exception as e:
        print(f"[WARN] Could not load persistent metadata cache: {e}")
    _persistent_metadata_mem = {}
    return _persistent_metadata_mem


def _save_persistent_metadata_cache(cache: dict) -> None:
    """Save repo metadata to persistent local cache (atomic write) and update in-memory mirror."""
    global _persistent_metadata_mem
    _persistent_metadata_mem = cache
    try:
        _PERSISTENT_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        import tempfile as _tmpfile
        fd, tmp_path = _tmpfile.mkstemp(
            dir=str(_PERSISTENT_CACHE_PATH.parent), suffix=".tmp", prefix="meta_cache_",
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(cache, f, indent=2, ensure_ascii=False)
            os.replace(tmp_path, str(_PERSISTENT_CACHE_PATH))
        except BaseException:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
    except Exception as e:
        print(f"[WARN] Could not save persistent metadata cache: {e}")


_FIELD_EXTRA_KEYS = frozenset({
    "unit", "description", "format", "pattern", "source",
    "possible_values", "ge", "le", "min_length", "max_length",
})
_FOLDER_EXTRA_KEYS = frozenset({
    "display_name", "section", "subsection", "array_length", "file_format",
})


def _parse_htx_metadata_yaml(raw_yaml: str) -> dict:
    """Parse .github/repository-metadata.yml into a dict."""
    parsed = yaml.safe_load(raw_yaml) or {}
    folders = []
    for df in parsed.get("data_folders", []):
        fields = []
        for field in df.get("fields", []):
            f_entry = {
                "field": field.get("name", ""),
                "type": field.get("type", "str"),
                "example": field.get("example", ""),
            }
            # Copy optional extended attributes in one pass
            for k in _FIELD_EXTRA_KEYS:
                if k in field:
                    f_entry[k] = field[k]
            fields.append(f_entry)

        total = df.get("total_files", 0)
        json_count = df.get("json_files", 0)
        folder_entry = {
            "folder": df.get("folder", ""),
            "path": df.get("path", ""),
            "total_files": total,
            "json_files": json_count,
            "other_files": total - json_count,
            "sample_fields": fields,
            "sample_file": df.get("sample_file"),
        }
        for k in _FOLDER_EXTRA_KEYS:
            if k in df:
                folder_entry[k] = df[k]
        folders.append(folder_entry)

    # Automation context (new top-level section)
    automation = parsed.get("automation", {})

    # Repository metadata section
    repo_section = parsed.get("repository", {})
    topics = repo_section.get("topics", parsed.get("topics", []))

    return {"data_folders": folders, "automation": automation, "topics": topics, "repository": repo_section}


def _fetch_htx_metadata_from_repo(github_client, repo_name: str, branch: str) -> dict | None:
    """Fetch .github/repository-metadata.yml from a GitHub repo. Returns parsed dict or None."""
    try:
        repo = github_client.get_repo(repo_name)
        file_content = repo.get_contents(_HTX_METADATA_FILENAME, ref=branch)
        if file_content and not isinstance(file_content, list):
            raw = base64.b64decode(file_content.content).decode("utf-8", errors="replace")
            return _parse_htx_metadata_yaml(raw)
    except Exception:
        pass
    return None


def _get_repo_metadata_from_yaml(github_client, repo_name: str, branch: str) -> dict:
    """
    Get data_folders + automation for a repo.
    1. Try fetching .github/repository-metadata.yml from the repo (and persist on success)
    2. Fall back to persistent local cache
    3. Fall back to local example files (backend/config/examples/)
    4. Return empty dict if neither available
    """
    cache = _load_persistent_metadata_cache()

    # Try fetching live from repo
    result = _fetch_htx_metadata_from_repo(github_client, repo_name, branch)
    if result is not None:
        # Update persistent cache
        cache[repo_name] = {
            **result,
            "fetched_at": datetime.now().isoformat(),
        }
        _save_persistent_metadata_cache(cache)
        print(f"[META] {repo_name}: from repo")
        return result

    # Fall back to persistent cache
    cached = cache.get(repo_name)
    if cached:
        result = {
            "data_folders": cached.get("data_folders", []),
            "automation": cached.get("automation", {}),
            "topics": cached.get("topics", []),
        }
        return result

    # Fall back to local example files
    repo_short = repo_name.split("/")[-1].lower() if "/" in repo_name else repo_name.lower()
    examples_dir = Path(__file__).parent / "config" / "examples"
    for example_file in examples_dir.glob("*.yaml"):
        if repo_short.replace("-", "") in example_file.stem.replace("-", "").lower():
            try:
                raw = example_file.read_text(encoding="utf-8")
                result = _parse_htx_metadata_yaml(raw)
                # Cache it so we don't re-read next time
                cache[repo_name] = {
                    **result,
                    "fetched_at": datetime.now().isoformat(),
                    "source": f"local-example:{example_file.name}",
                }
                _save_persistent_metadata_cache(cache)
                return result
            except Exception as e:
                print(f"[WARN] Could not load example {example_file.name}: {e}")

    return {"data_folders": [], "automation": {}}


def _fetch_single_repo_metadata(config: dict, depth: str = "basic") -> dict | None:
    """Fetch metadata for a single repo config (runs in thread pool).

    *depth*: ``"basic"`` — repo info + YAML metadata only (~2 API calls).
             ``"full"``  — also tree, languages, commits (~8+ calls).
    """
    try:
        g = _get_client_for_config(config)
        repo_name = config.get("github_repo", "")
        branch = config.get("github_branch", "main")
        
        if not repo_name:
            return None
        
        config_id = config.get("id")
        repo = _get_repo(g, repo_name, config_id)
        
        # Basic repo info
        repo_info = {
            "config_id": config.get("id", ""),
            "config_name": config.get("name", repo.name),
            "full_name": repo.full_name,
            "name": repo.name,
            "description": repo.description or "",
            "private": repo.private,
            "default_branch": repo.default_branch,
            "branch": branch,
            "html_url": repo.html_url,
            "created_at": repo.created_at.isoformat() if repo.created_at else None,
            "updated_at": repo.updated_at.isoformat() if repo.updated_at else None,
            "pushed_at": repo.pushed_at.isoformat() if repo.pushed_at else None,
            "size": repo.size,
            "language": repo.language,
            "topics": [],
            "visibility": "private" if repo.private else "public",
        }
        
        # Topics
        try:
            repo_info["topics"] = repo.get_topics()
        except Exception:
            pass
        
        # Permissions (from the authenticated user's perspective)
        try:
            perms = repo.permissions
            repo_info["permissions"] = {
                "admin": perms.admin if perms else False,
                "push": perms.push if perms else False,
                "pull": perms.pull if perms else False,
                "maintain": getattr(perms, 'maintain', False) if perms else False,
                "triage": getattr(perms, 'triage', False) if perms else False,
            }
            # Derive permission level label
            if perms and perms.admin:
                repo_info["permission_level"] = "admin"
            elif perms and perms.push:
                repo_info["permission_level"] = "write"
            elif perms and perms.pull:
                repo_info["permission_level"] = "read"
            else:
                repo_info["permission_level"] = "none"
        except Exception:
            repo_info["permissions"] = {"admin": False, "push": False, "pull": False}
            repo_info["permission_level"] = "unknown"
        
        # ── Expensive sections — only when depth="full" (RepoGraphPage) ──
        if depth == "full":
            # Directory tree (top-level + first level of subdirs)
            tree = []
            try:
                contents = repo.get_contents("", ref=branch)
                if isinstance(contents, list):
                    for item in contents:
                        entry = {
                            "name": item.name,
                            "path": item.path,
                            "type": item.type,  # "file" or "dir"
                            "size": item.size if item.type == "file" else None,
                        }
                        # Expand first-level directories
                        if item.type == "dir":
                            try:
                                sub_contents = repo.get_contents(item.path, ref=branch)
                                if isinstance(sub_contents, list):
                                    entry["children"] = [
                                        {
                                            "name": sub.name,
                                            "path": sub.path,
                                            "type": sub.type,
                                            "size": sub.size if sub.type == "file" else None,
                                        }
                                        for sub in sub_contents
                                    ]
                            except Exception:
                                entry["children"] = []
                        tree.append(entry)
            except Exception:
                pass
            repo_info["tree"] = tree

            # Languages breakdown
            try:
                repo_info["languages"] = repo.get_languages()
            except Exception:
                repo_info["languages"] = {}

            # Recent commits (last 5)
            try:
                commits = list(repo.get_commits(sha=branch)[:5])
                repo_info["recent_commits"] = [
                    {
                        "sha": c.sha[:7],
                        "message": (c.commit.message or "").split("\n")[0][:80],
                        "author": c.commit.author.name if c.commit.author else "unknown",
                        "date": c.commit.author.date.isoformat() if c.commit.author and c.commit.author.date else None,
                    }
                    for c in commits
                ]
            except Exception:
                repo_info["recent_commits"] = []
        else:
            # basic mode – provide empty defaults so JSON shape is stable
            repo_info["tree"] = []
            repo_info["languages"] = {}
            repo_info["recent_commits"] = []

        # ── Data description from .github/repository-metadata.yml in repo ──
        yaml_meta = _get_repo_metadata_from_yaml(g, repo_name, branch)

        repo_info["data_folders"] = yaml_meta.get("data_folders", [])
        repo_info["automation"] = yaml_meta.get("automation", {})
        # Merge topics: prefer API topics, fall back to YAML (which already
        # falls back to local example files inside _get_repo_metadata_from_yaml)
        if not repo_info.get("topics"):
            yaml_topics = yaml_meta.get("topics", [])
            if yaml_topics:
                repo_info["topics"] = yaml_topics
        repo_info["readme_snippet"] = ""
        
        return repo_info
        
    except Exception as e:
        return {
            "config_id": config.get("id", ""),
            "config_name": config.get("name", "Unknown"),
            "full_name": config.get("github_repo", "Unknown"),
            "name": config.get("github_repo", "Unknown").split("/")[-1],
            "error": str(e)[:100],
            "tree": [],
            "permissions": {},
            "permission_level": "error",
            "languages": {},
            "recent_commits": [],
            "data_folders": [],
            "automation": {},
            "readme_snippet": "",
        }


async def _fetch_all_repo_metadata_live(*, depth: str = "basic") -> dict:
    """Fetch metadata for all configs from GitHub API and persist to cache.

    *depth*: ``"basic"`` (default) skips tree / languages / commits.
             ``"full"`` fetches everything (RepoGraphPage needs this).
    """
    global _repo_metadata_cache

    configs = config_manager.get_all_configs()

    results = await asyncio.gather(*[
        asyncio.to_thread(_fetch_single_repo_metadata, cfg, depth)
        for cfg in configs
    ])

    repos_data = [r for r in results if r is not None]
    response = {"repos": repos_data, "count": len(repos_data)}

    # Persist to disk so next load is instant
    _save_repo_graph_cache(response)

    # ── Batch-update persistent metadata cache from graph results ──
    # Individual threads may race when writing, so consolidate here.
    try:
        meta_cache = _load_persistent_metadata_cache()
        for repo in repos_data:
            rn = repo.get("full_name", "")
            if not rn:
                continue
            dfs = repo.get("data_folders", [])
            automation = repo.get("automation", {})
            if dfs or automation:
                existing = meta_cache.get(rn, {})
                existing["data_folders"] = dfs
                existing["automation"] = automation
                existing["fetched_at"] = datetime.now().isoformat()
                meta_cache[rn] = existing
        _save_persistent_metadata_cache(meta_cache)
    except Exception as e:
        print(f"[WARN] Could not batch-update persistent metadata cache: {e}")

    # Also update in-memory cache
    now = time.time()
    _repo_metadata_cache = {"data": response, "_ts": now}

    return response


@app.get("/api/repo-metadata")
async def get_all_repo_metadata(refresh: bool = False, depth: str = "basic"):
    """
    Return metadata for all configured GitHub repositories.

    By default serves from the persistent disk cache (instant).
    Pass ``?refresh=true`` to force a live fetch from the GitHub API
    and update the cache.

    Pass ``?depth=full`` to include the directory tree, language
    breakdown and recent commits (needed by RepoGraphPage only).
    The default ``basic`` mode skips those — saving ~6 GitHub API
    calls per repo.
    """
    global _repo_metadata_cache

    configs = config_manager.get_all_configs()
    if not configs:
        _repo_metadata_cache = {}
        return {"repos": [], "count": 0}

    # ── Explicit refresh → always fetch live ──
    if refresh:
        return await _fetch_all_repo_metadata_live(depth=depth)

    # ── Try in-memory cache first (hot path) ──
    now = time.time()
    if _repo_metadata_cache and (now - _repo_metadata_cache.get("_ts", 0)) < _REPO_METADATA_TTL:
        cached_data = _filter_configured_repo_metadata(
            _repo_metadata_cache.get("data", {"repos": []}), configs,
        )
        # For depth=full, check that cached data actually has full details
        if depth != "full" or _cache_has_full_depth(cached_data):
            return cached_data

    # ── Try persistent disk cache ──
    cached = _load_repo_graph_cache()
    if cached:
        cached = _filter_configured_repo_metadata(cached, configs)
    if cached and cached.get("repos"):
        if depth != "full" or _cache_has_full_depth(cached):
            _repo_metadata_cache = {"data": cached, "_ts": now}
            return cached

    # ── No usable cache – fetch live ──
    return await _fetch_all_repo_metadata_live(depth=depth)


@app.get("/api/catalog-export")
async def catalog_export_excel():
    """
    Export the full schema catalog as an Excel (.xlsx) file.
    Reuses the same repo-metadata pipeline as the frontend catalog.
    """
    import io
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

    try:
        # Fetch metadata (uses cache when available)
        meta = await get_all_repo_metadata(refresh=False)
        repos = meta.get("repos", []) if isinstance(meta, dict) else []

        # Flatten to rows – same logic as the frontend CatalogPage
        rows: list[dict] = []
        for repo in repos:
            repo_name = repo.get("full_name") or (repo.get("repository") or {}).get("full_name", "–")
            for df in repo.get("data_folders", []):
                folder = df.get("folder", "")
                section = df.get("section", "")
                subsection = df.get("subsection", "")
                for sf in df.get("sample_fields", []):
                    pv = sf.get("possible_values") or []
                    rows.append({
                        "Field": sf.get("field", ""),
                        "Type": sf.get("type", ""),
                        "Source": sf.get("source", ""),
                        "Description": sf.get("description", ""),
                        "Example": sf.get("example", ""),
                        "Unit": sf.get("unit", ""),
                        "Format": sf.get("format", ""),
                        "Pattern": sf.get("pattern", ""),
                        "Allowed Values": ", ".join(str(v) for v in pv) if isinstance(pv, list) else str(pv),
                        "Min (≥)": sf.get("ge", ""),
                        "Max (≤)": sf.get("le", ""),
                        "Min Length": sf.get("min_length", ""),
                        "Max Length": sf.get("max_length", ""),
                        "Repository": repo_name,
                        "Folder": folder,
                        "Section": section,
                        "Subsection": subsection,
                    })

        # Build workbook
        wb = Workbook()
        ws = wb.active
        ws.title = "Schema Catalog"

        headers = ["Field", "Type", "Source", "Description", "Example", "Unit",
                   "Format", "Pattern", "Allowed Values", "Min (≥)", "Max (≤)",
                   "Min Length", "Max Length", "Repository", "Folder", "Section", "Subsection"]

        # Header style
        header_font = Font(bold=True, color="FFFFFF", size=11)
        header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
        thin_border = Border(
            bottom=Side(style="thin", color="B4C6E7"),
        )

        for col_idx, h in enumerate(headers, 1):
            cell = ws.cell(row=1, column=col_idx, value=h)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center", vertical="center")

        # Data rows
        for row_idx, data_row in enumerate(rows, 2):
            for col_idx, h in enumerate(headers, 1):
                cell = ws.cell(row=row_idx, column=col_idx, value=data_row.get(h, ""))
                cell.border = thin_border

        # Auto-fit column widths (approximate)
        for col_idx, h in enumerate(headers, 1):
            max_len = len(h)
            for r_idx in range(2, min(len(rows) + 2, 102)):  # sample first 100 rows
                val = str(ws.cell(row=r_idx, column=col_idx).value or "")
                max_len = max(max_len, len(val))
            ws.column_dimensions[ws.cell(row=1, column=col_idx).column_letter].width = min(max_len + 3, 50)

        # Auto-filter
        ws.auto_filter.ref = ws.dimensions

        # Freeze header row
        ws.freeze_panes = "A2"

        # Write to buffer
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)

        filename = f"catalog_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    except Exception as e:
        print(f"[catalog-export] ERROR: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


def update_aggregated_file(repo, products_data: list, folder: str = "products", branch: str = None, data_path: str = None, aggregated_path: str = None):
    """
    Update the aggregated JSON file for a data folder.
    Strips JSON-LD @-keys to create a compact version for faster loading.
    Works generically for any data folder (products, quality-reports, etc.)

    ``data_path`` is the resolved repo directory (e.g. "data/products").
    ``aggregated_path`` is the full path to the aggregated .json file.
    When omitted falls back to ``{data_path}.json`` for backward compat.
    """
    if branch is None:
        branch = GITHUB_BRANCH
    if data_path is None:
        data_path = f"data/{folder}"
    if aggregated_path is None:
        aggregated_path = f"{data_path}.json"
    try:
        # Create compact version: keep all data keys, strip JSON-LD overhead
        compact_products = []
        for product in products_data:
            compact = {k: v for k, v in product.items() if not k.startswith('@')}
            compact_products.append(compact)
        
        json_content = json.dumps(compact_products, indent=2, ensure_ascii=False)
        
        # Check if file exists
        sha = None
        try:
            file_content = repo.get_contents(aggregated_path, ref=branch)
            sha = file_content.sha
        except GithubException as e:
            if e.status != 404:
                raise
        
        # Create or update aggregated file
        commit_message = f"Update aggregated {folder} file ({len(products_data)} entries)"
        
        if sha:
            repo.update_file(aggregated_path, commit_message, json_content, sha, branch=branch)
        else:
            repo.create_file(aggregated_path, commit_message, json_content, branch=branch)

        # ── Cleanup: remove stale aggregated file that may live *inside* the
        #    data directory (e.g. data/products/products.json) from before the
        #    path-fix.  The canonical location is now the sibling file
        #    (e.g. data/products.json).
        old_inside_path = f"{data_path}/{folder}.json"
        if old_inside_path != aggregated_path:
            try:
                old_file = repo.get_contents(old_inside_path, ref=branch)
                repo.delete_file(
                    old_inside_path,
                    f"Cleanup: remove deprecated aggregated file from inside {data_path}/",
                    old_file.sha,
                    branch=branch,
                )
                print(f"[AGG] Removed stale aggregated file: {old_inside_path}")
            except GithubException:
                pass  # doesn't exist – nothing to clean up
            
    except Exception as e:
        print(f"Error updating aggregated file: {str(e)}")
        # Don't fail the main operation if aggregated file update fails


# ── Batch mutation preview / approval ─────────────────────────────────────
_PENDING_MUTATION_PREVIEWS: OrderedDict[str, dict[str, Any]] = OrderedDict()
_MUTATION_PREVIEWS_LOCK = RLock()
_MUTATION_PREVIEW_TTL_SECONDS: Final[int] = 30 * 60
_MUTATION_PREVIEW_MAX_COUNT: Final[int] = 100


def _cleanup_mutation_previews_locked(now: float | None = None) -> None:
    now = now or time.time()
    expired = [
        approval_id for approval_id, preview in _PENDING_MUTATION_PREVIEWS.items()
        if now - preview.get("created_ts", now) > _MUTATION_PREVIEW_TTL_SECONDS
    ]
    for approval_id in expired:
        _PENDING_MUTATION_PREVIEWS.pop(approval_id, None)
    while len(_PENDING_MUTATION_PREVIEWS) > _MUTATION_PREVIEW_MAX_COUNT:
        _PENDING_MUTATION_PREVIEWS.popitem(last=False)


def _cleanup_mutation_previews() -> None:
    with _MUTATION_PREVIEWS_LOCK:
        _cleanup_mutation_previews_locked()


def _store_mutation_preview(approval_id: str, preview: dict[str, Any]) -> None:
    with _MUTATION_PREVIEWS_LOCK:
        _cleanup_mutation_previews_locked()
        _PENDING_MUTATION_PREVIEWS[approval_id] = preview
        _PENDING_MUTATION_PREVIEWS.move_to_end(approval_id)
        _cleanup_mutation_previews_locked()


def _normalize_write_data(config_id: Optional[str], data_dict: dict[str, Any]) -> dict[str, Any]:
    """Normalize incoming write data the same way for single and batch writes."""
    normalized = dict(data_dict)
    if not _is_default_config(config_id):
        model_defaults = set(DataEntry.model_fields.keys()) - {"productId"}
        normalized = {
            k: v for k, v in normalized.items()
            if k not in model_defaults or v != ""
        }
    return normalized


def _folder_from_file_path(file_path: str | None, fallback: str = "products") -> tuple[str, bool]:
    if file_path and "/" in file_path:
        parts = file_path.strip("/").split("/")
        if len(parts) >= 2:
            return (parts[-1] if parts[-1] else parts[-2]), True
    return fallback, False


def _resolve_folder_for_write(config_id: Optional[str], file_path: str | None, fallback: str = "products") -> str:
    folder, explicit_folder = _folder_from_file_path(file_path, fallback)
    if explicit_folder:
        return folder
    try:
        cache = _load_persistent_metadata_cache()
        cfg = config_manager.get_config_by_id(config_id) if config_id else None
        repo_name = cfg.get("github_repo") if cfg else GITHUB_REPO
        data_folders = cache.get(repo_name, {}).get("data_folders", [])
        if data_folders:
            known_names = [df.get("folder") for df in data_folders]
            if folder not in known_names:
                return known_names[0]
    except Exception:
        pass
    return folder


def _build_compact_entry(
    data_dict: dict[str, Any],
    *,
    repo_html_url: str,
    repo_name: str,
    branch: str,
    agg_path: str,
) -> dict[str, Any]:
    github_url = f"{repo_html_url}/blob/{branch}/{agg_path}"
    host = repo_html_url.split("/")[2]
    github_raw_url = f"https://raw.{host}/{repo_name}/{branch}/{agg_path}"

    enriched = dict(data_dict)
    chem = enriched.get("chemicalComposition")
    if isinstance(chem, list) and len(chem) > 0:
        crma = check_crma_status(chem)
        enriched["crmaStatus"] = crma["crmaStatus"]
        enriched["crmaDetails"] = crma["crmaDetails"]

    return {
        **enriched,
        "githubUrl": github_url,
        "githubRawUrl": github_raw_url,
    }


def _read_aggregated_products(repo, agg_path: str, branch: str, *, missing_ok: bool = True) -> tuple[list[dict], str | None]:
    try:
        agg_file = repo.get_contents(agg_path, ref=branch)
        products = json.loads(base64.b64decode(agg_file.content).decode("utf-8"))
        return products if isinstance(products, list) else [], agg_file.sha
    except GithubException as e:
        if e.status == 404 and missing_ok:
            return [], None
        raise


def _find_product_index(products: list[dict], product_id: str) -> int:
    for index, product in enumerate(products):
        if product.get("productId") == product_id:
            return index
    return -1


def _diff_value(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    return value if value not in (None, "") else ""


def _record_diff(before: dict[str, Any] | None, after: dict[str, Any] | None) -> list[dict[str, Any]]:
    before = before or {}
    after = after or {}
    keys = sorted(set(before) | set(after))
    changes: list[dict[str, Any]] = []
    for key in keys:
        if key.startswith("_"):
            continue
        before_value = before.get(key)
        after_value = after.get(key)
        if before_value != after_value:
            changes.append({
                "field": key,
                "before": _diff_value(before_value),
                "after": _diff_value(after_value),
            })
    return changes


def _record_title(record: dict[str, Any] | None, product_id: str) -> str:
    if not record:
        return product_id
    return str(record.get("productName") or record.get("name") or record.get("materialName") or product_id)


def _validate_mutation_data(config_id: Optional[str], folder: str, data: dict[str, Any]) -> tuple[bool, dict[str, Any] | list[dict[str, str]]]:
    schema_fields = _get_schema_fields_for_request(config_id, f"data/{folder}/")
    if not schema_fields:
        return True, data
    normalized = dict(data)
    for sf in schema_fields:
        fname = sf.get("field") or sf.get("name", "")
        if fname and fname not in normalized:
            ftype = sf.get("type", "str")
            if ftype in ("str", "string"):
                normalized[fname] = ""
    return schema_validator.validate_data(schema_fields, normalized)


def _public_mutation_preview(preview: dict[str, Any]) -> dict[str, Any]:
    return {
        "approval_id": preview["approval_id"],
        "status": preview["status"],
        "valid": preview["valid"],
        "atomic": preview.get("atomic", len(preview.get("groups", [])) == 1),
        "created_at": preview["created_at"],
        "requested_by": preview.get("requested_by"),
        "summary": preview["summary"],
        "groups": [
            {k: group[k] for k in ("config_id", "folder", "repo", "branch", "path", "base_count", "final_count")}
            for group in preview["groups"]
        ],
        "actions": preview["actions"],
        "errors": preview["errors"],
        "warnings": preview["warnings"],
    }


def _create_data_mutation_preview(
    request: DataMutationPreviewRequest,
    *,
    validate_schema: bool = True,
    store: bool = True,
) -> dict[str, Any]:
    if not request.actions:
        raise HTTPException(status_code=400, detail="At least one mutation action is required")

    _cleanup_mutation_previews()

    groups_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    preview_actions: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    counts = {"create": 0, "update": 0, "delete": 0}

    for index, action in enumerate(request.actions):
        config_id = action.config_id or request.config_id
        folder = action.folder or request.folder or "products"
        key = (config_id or "", folder)

        if key not in groups_by_key:
            g, repo_name, branch = _resolve_config(config_id)
            repo = _get_repo(g, repo_name, config_id)
            data_path = _resolve_data_path(config_id, folder)
            agg_path = _resolve_aggregated_path(config_id, folder, data_path)
            products, agg_sha = _read_aggregated_products(repo, agg_path, branch, missing_ok=True)
            groups_by_key[key] = {
                "config_id": config_id,
                "folder": folder,
                "repo": repo_name,
                "repo_html_url": repo.html_url,
                "branch": branch,
                "path": agg_path,
                "base_sha": agg_sha,
                "base_count": len(products),
                "working_products": [dict(p) for p in products],
                "actions": [],
            }

        group = groups_by_key[key]
        working_products = group["working_products"]
        action_type = action.action
        counts[action_type] += 1

        try:
            if action_type == "delete":
                product_id = action.product_id or str(action.data.get("productId", ""))
                if not product_id:
                    raise HTTPException(status_code=400, detail="delete requires product_id")
                product_index = _find_product_index(working_products, product_id)
                if product_index < 0:
                    raise HTTPException(status_code=404, detail=f"Product {product_id} not found")
                before = working_products[product_index]
                node_key = before.get("nodeId") or before.get("productId")
                child_count = sum(1 for product in working_products if product.get("parentId") == node_key)
                if child_count:
                    warnings.append({
                        "action_index": index,
                        "product_id": product_id,
                        "message": f"Deleting this BOM node will leave {child_count} child node(s) orphaned.",
                    })
                del working_products[product_index]
                action_preview = {
                    "index": index,
                    "action": action_type,
                    "product_id": product_id,
                    "title": _record_title(before, product_id),
                    "changes": _record_diff(before, None),
                    "target": {"config_id": config_id, "folder": folder},
                }

            else:
                incoming = {k: v for k, v in action.data.items() if v is not None}
                product_id = action.product_id or str(incoming.get("productId", ""))
                if action_type == "create" and not product_id:
                    product_id = generate_unique_product_id()
                if not product_id:
                    raise HTTPException(status_code=400, detail=f"{action_type} requires product_id")

                product_index = _find_product_index(working_products, product_id)
                if action_type == "create" and product_index >= 0:
                    raise HTTPException(status_code=409, detail=f"Product {product_id} already exists")
                if action_type == "update" and product_index < 0:
                    raise HTTPException(status_code=404, detail=f"Product {product_id} not found")

                before = dict(working_products[product_index]) if product_index >= 0 else None
                merged = {**(before or {}), **incoming, "productId": product_id}
                merged = _normalize_write_data(config_id, merged)

                if validate_schema:
                    ok, val_result = _validate_mutation_data(config_id, folder, merged)
                    if not ok:
                        errors.append({
                            "action_index": index,
                            "product_id": product_id,
                            "message": "Schema validation failed",
                            "validation_errors": val_result,
                        })
                    elif isinstance(val_result, dict):
                        merged.update(val_result)

                after = _build_compact_entry(
                    merged,
                    repo_html_url=group["repo_html_url"],
                    repo_name=group["repo"],
                    branch=group["branch"],
                    agg_path=group["path"],
                )
                if product_index >= 0:
                    working_products[product_index] = after
                else:
                    working_products.append(after)

                action_preview = {
                    "index": index,
                    "action": action_type,
                    "product_id": product_id,
                    "title": _record_title(after, product_id),
                    "changes": _record_diff(before, after),
                    "target": {"config_id": config_id, "folder": folder},
                }

            preview_actions.append(action_preview)
            group["actions"].append(index)

        except HTTPException as e:
            errors.append({
                "action_index": index,
                "action": action_type,
                "message": e.detail,
                "status_code": e.status_code,
                "target": {"config_id": config_id, "folder": folder},
            })

    approval_id = str(uuid.uuid4())
    groups = []
    for group in groups_by_key.values():
        groups.append({
            **group,
            "final_count": len(group["working_products"]),
        })

    atomic = len(groups) == 1
    if not atomic and groups:
        warnings.append({
            "message": "This batch touches multiple target files and cannot be committed atomically. Split it by target file and approve each preview separately.",
        })

    valid = not errors
    preview = {
        "approval_id": approval_id,
        "status": "pending" if valid else "invalid",
        "valid": valid,
        "atomic": atomic,
        "created_ts": time.time(),
        "created_at": datetime.now().isoformat(),
        "requested_by": request.requested_by,
        "summary": {
            **counts,
            "total": len(request.actions),
            "target_files": len(groups),
            "github_commits": 1 if valid and atomic else 0,
        },
        "groups": groups,
        "actions": preview_actions,
        "errors": errors,
        "warnings": warnings,
    }

    if store:
        _store_mutation_preview(approval_id, preview)
    return _public_mutation_preview(preview)


def _apply_data_mutation_preview(preview: dict[str, Any]) -> dict[str, Any]:
    if not preview.get("valid"):
        raise HTTPException(status_code=422, detail={"errors": preview.get("errors", [])})
    if not preview.get("atomic", len(preview.get("groups", [])) == 1):
        raise HTTPException(
            status_code=409,
            detail="Mutation preview touches multiple target files and cannot be committed atomically. Split it by target file first.",
        )

    results: list[dict[str, Any]] = []
    deleted_ids = [a["product_id"] for a in preview.get("actions", []) if a.get("action") == "delete"]

    for group in preview["groups"]:
        g, repo_name, branch = _resolve_config(group.get("config_id"))
        repo = _get_repo(g, repo_name, group.get("config_id"))
        products = group["working_products"]
        content = json.dumps(products, indent=2, ensure_ascii=False)
        commit_msg = (
            f"Apply batch data changes: {preview['summary']['create']} create, "
            f"{preview['summary']['update']} update, {preview['summary']['delete']} delete"
        )

        try:
            if group.get("base_sha"):
                repo.update_file(group["path"], commit_msg, content, group["base_sha"], branch=branch)
            else:
                repo.create_file(group["path"], commit_msg, content, branch=branch)
        except GithubException as e:
            if e.status == 409:
                raise HTTPException(
                    status_code=409,
                    detail="Repository data changed after preview. Refresh and create a new preview before committing.",
                )
            raise HTTPException(status_code=400, detail=f"GitHub API error: {e}")

        _replace_products_cache(group.get("config_id"), group["folder"], products)
        results.append({
            "repo": repo_name,
            "branch": branch,
            "path": group["path"],
            "count": len(products),
            "actions": len(group.get("actions", [])),
        })

    for product_id in deleted_ids:
        invalidate_classification(product_id)

    preview["status"] = "committed"
    preview["committed_at"] = datetime.now().isoformat()
    return {
        "success": True,
        "approval_id": preview["approval_id"],
        "summary": preview["summary"],
        "results": results,
    }


def _sync_write_json(request: FileWriteRequest) -> dict:
    """
    Synchronous core used by the async write worker.
    
    Architecture: Only the aggregated JSON file is maintained in GitHub.
    Individual product JSON and AAS files can be generated on demand
    via GitHub Actions.  This avoids race conditions (409 SHA conflicts)
    that occurred when writing 3 files per operation.
    """
    try:
        # Resolve which repo to use
        g, repo_name, branch = _resolve_config(request.config_id)
        repo = _get_repo(g, repo_name, request.config_id)
        
        # Convert data to dictionary (includes extra fields thanks to extra='allow')
        data_dict = _normalize_write_data(
            request.config_id,
            request.data.model_dump(exclude_none=True),
        )
        
        # Determine data folder from file_path (e.g. "data/quality-reports/" → "quality-reports")
        folder = _resolve_folder_for_write(request.config_id, request.file_path)

        # Resolve the actual repo path from repository-metadata.yml
        data_path = _resolve_data_path(request.config_id, folder)
        
        # Generate unique product ID if not provided or empty
        if not data_dict.get('productId') or data_dict['productId'].strip() == '':
            product_id = generate_unique_product_id()
            data_dict['productId'] = product_id
        else:
            product_id = data_dict['productId']
        
        # Resolve aggregated file path (the actual file that exists on GitHub)
        agg_path = _resolve_aggregated_path(request.config_id, folder, data_path)
        
        # Build compact entry for aggregated JSON (no JSON-LD overhead)
        compact_entry = _build_compact_entry(
            data_dict,
            repo_html_url=repo.html_url,
            repo_name=repo_name,
            branch=branch,
            agg_path=agg_path,
        )
        data_dict = {k: v for k, v in compact_entry.items() if k not in {"githubUrl", "githubRawUrl"}}
        
        # ── Single commit: upsert into aggregated JSON ──────────────
        
        max_retries = 3
        for attempt in range(max_retries):
            try:
                # Read current aggregated file
                try:
                    agg_file = repo.get_contents(agg_path, ref=branch)
                    existing_products = json.loads(
                        base64.b64decode(agg_file.content).decode("utf-8")
                    )
                    agg_sha = agg_file.sha
                except GithubException as e:
                    if e.status == 404:
                        existing_products = []
                        agg_sha = None
                    else:
                        raise
                
                updated_products = list(existing_products)
                is_update = _upsert_product_in_list(updated_products, product_id, compact_entry)
                
                agg_json = json.dumps(updated_products, indent=2, ensure_ascii=False)
                commit_msg = f"{'Update' if is_update else 'Add'} product: {product_id} ({len(updated_products)} total)"
                
                if agg_sha:
                    repo.update_file(agg_path, commit_msg, agg_json, agg_sha, branch=branch)
                else:
                    repo.create_file(agg_path, commit_msg, agg_json, branch=branch)
                
                print(f"[WRITE] {agg_path}: {len(updated_products)} entries (1 commit)")
                break  # success
                
            except GithubException as e:
                if e.status == 409 and attempt < max_retries - 1:
                    time.sleep(0.5 * (attempt + 1))
                    print(f"[WRITE] Conflict (attempt {attempt + 1}/{max_retries}), retrying...")
                    continue
                raise
        
        # Smart cache update: inject product into cache instead of full invalidation
        _upsert_products_cache(request.config_id, folder, compact_entry)
        
        return {
            "success": True,
            "productId": product_id,
            "githubUrl": compact_entry["githubUrl"],
            "githubRawUrl": compact_entry["githubRawUrl"],
            "message": "Data written successfully to GitHub",
            "file_path": agg_path,
            "data": data_dict,
        }
        
    except GithubException as e:
        print(f"GitHub API Error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=400, detail=f"GitHub API error: {str(e)}")
    except Exception as e:
        print(f"Server Error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Server error: {str(e)}")


# ── Schema validation helpers ────────────────────────────────────────────
def _get_schema_fields_for_request(config_id: Optional[str], file_path: str) -> list[dict]:
    """
    Look up the *schema-source* fields for a request's config + file_path.

    file_path looks like "data/products/" or "quality-reports/" —
    we match the folder name against the cached repository-metadata.
    """
    cache = _load_persistent_metadata_cache()

    # Determine repo name
    if config_id:
        cfg = config_manager.get_config_by_id(config_id)
        repo_name = cfg.get("github_repo") if cfg else None
        if not repo_name:
            return []
    else:
        repo_name = GITHUB_REPO

    # Try every data_folder and match by path prefix or folder name
    entry = cache.get(repo_name, {})
    for df in entry.get("data_folders", []):
        folder_path = df.get("path", "")
        folder_name = df.get("folder", "")
        fp = file_path.rstrip("/")
        if fp == folder_path or fp.startswith(folder_path + "/") or fp.endswith("/" + folder_name) or fp == folder_name:
            return [
                f for f in df.get("sample_fields", [])
                if f.get("source") == "schema"
            ]
    return []


class ValidateRequest(BaseModel):
    data: dict
    config_id: Optional[str] = None
    file_path: str = "data/products/"


@app.post("/api/validate-product")
async def validate_product(request: ValidateRequest):
    """
    Validate data against the cached repository-metadata schema.

    Returns 200 with {valid: true, data: ...} on success,
    or 422 with {valid: false, errors: [...]} on failure.
    """
    schema_fields = _get_schema_fields_for_request(request.config_id, request.file_path)

    ok, result = schema_validator.validate_data(schema_fields, request.data)

    if ok:
        return {"valid": True, "data": result}
    return {"valid": False, "errors": result}


@app.post("/api/data-mutations/preview")
async def preview_data_mutations(request: DataMutationPreviewRequest):
    """Create a diff-style batch preview without writing to GitHub."""
    return await asyncio.to_thread(_create_data_mutation_preview, request)


@app.get("/api/data-mutations/pending")
async def get_pending_data_mutations():
    """Return pending MCP/user approval previews for the frontend dialog."""
    _cleanup_mutation_previews()
    with _MUTATION_PREVIEWS_LOCK:
        previews = [
            _public_mutation_preview(preview)
            for preview in _PENDING_MUTATION_PREVIEWS.values()
            if preview.get("status") in {"pending", "approved"} and preview.get("valid")
        ]
    previews.sort(key=lambda item: item.get("created_at", ""))
    return {"success": True, "count": len(previews), "previews": previews}


@app.post("/api/data-mutations/approve/{approval_id}")
async def approve_data_mutation(approval_id: str):
    """Mark a pending preview as user-approved; commit is a separate call."""
    with _MUTATION_PREVIEWS_LOCK:
        preview = _PENDING_MUTATION_PREVIEWS.get(approval_id)
        if not preview:
            raise HTTPException(status_code=404, detail="Mutation preview not found or expired")
        if preview.get("status") != "pending":
            raise HTTPException(status_code=409, detail=f"Mutation preview is {preview.get('status')}")
        preview["status"] = "approved"
        preview["approved_at"] = datetime.now().isoformat()
    return {"success": True, "approval_id": approval_id, "status": "approved"}


@app.post("/api/data-mutations/reject/{approval_id}")
async def reject_data_mutation(approval_id: str):
    """Reject and remove a pending mutation preview."""
    with _MUTATION_PREVIEWS_LOCK:
        preview = _PENDING_MUTATION_PREVIEWS.get(approval_id)
        if not preview:
            raise HTTPException(status_code=404, detail="Mutation preview not found or expired")
        preview["status"] = "rejected"
        preview["rejected_at"] = datetime.now().isoformat()
    return {"success": True, "approval_id": approval_id, "status": "rejected"}


@app.post("/api/data-mutations/commit")
async def commit_data_mutations(request: DataMutationCommitRequest):
    """Commit an approved preview or directly apply debug actions.

    SECURITY TODO: The direct ``actions`` branch intentionally bypasses the
    graphical approval layer and Keycloak role checks for debugging/automation
    experiments only. Automatic schema validation still runs here, matching
    the manual frontend and MCP paths. Do not expose this bypass as-is in
    production; replace it with per-user, per-use-case authorization before
    external API access is enabled.
    """
    if request.approval_id:
        with _MUTATION_PREVIEWS_LOCK:
            preview = _PENDING_MUTATION_PREVIEWS.get(request.approval_id)
            if not preview:
                raise HTTPException(status_code=404, detail="Mutation preview not found or expired")
            if preview.get("status") != "approved":
                raise HTTPException(status_code=409, detail="Mutation preview must be approved before commit")
            preview["status"] = "committing"
        try:
            return await asyncio.to_thread(_apply_data_mutation_preview, preview)
        except Exception:
            with _MUTATION_PREVIEWS_LOCK:
                current = _PENDING_MUTATION_PREVIEWS.get(request.approval_id)
                if current is preview and preview.get("status") == "committing":
                    preview["status"] = "approved"
            raise

    if request.actions:
        debug_preview_request = DataMutationPreviewRequest(
            actions=request.actions,
            config_id=request.config_id,
            folder=request.folder,
            requested_by=request.requested_by or "direct-api-debug",
        )
        # Build a private preview so the commit has the simulated final products.
        private_preview_public = await asyncio.to_thread(
            _create_data_mutation_preview,
            debug_preview_request,
            validate_schema=True,
            store=True,
        )
        with _MUTATION_PREVIEWS_LOCK:
            private_preview = _PENDING_MUTATION_PREVIEWS.pop(private_preview_public["approval_id"])
        private_preview["status"] = "approved"
        return await asyncio.to_thread(_apply_data_mutation_preview, private_preview)

    raise HTTPException(status_code=400, detail="Provide approval_id or actions")


@app.post("/api/write-json-async")
async def write_json_async(request: FileWriteRequest):
    """
    Queue data submission for asynchronous processing via NATS JetStream.
    Returns immediately with a job ID that can be used to check status.
    The background worker calls _sync_write_json() – zero code duplication.

    The product ID is generated eagerly so the frontend can display it
    instantly without waiting for the GitHub write to finish.
    """
    try:
        # Generate job ID
        job_id = str(uuid.uuid4())

        # Convert data to dictionary (includes extra fields)
        data_dict = request.data.model_dump(exclude_none=True)

        # ── Validate against cached repository-metadata schema ──
        schema_fields = _get_schema_fields_for_request(
            request.config_id, request.file_path,
        )
        if schema_fields:
            # Ensure all string-type schema fields exist (default to empty
            # string) so the strict "all required" validator doesn't reject
            # optional BOM fields like edcAssetId, valueType, etc.
            for sf in schema_fields:
                fname = sf.get("field") or sf.get("name", "")
                if fname and fname not in data_dict:
                    ftype = sf.get("type", "str")
                    if ftype in ("str", "string"):
                        data_dict[fname] = ""
            ok, val_result = schema_validator.validate_data(schema_fields, data_dict)
            if not ok:
                raise HTTPException(
                    status_code=422,
                    detail={"validation_errors": val_result},
                )
            # Use the coerced data (e.g. "75" → 75.0 for float fields)
            if isinstance(val_result, dict):
                data_dict.update(val_result)

        # ── Eager ID generation: return the real ID immediately ──
        if not data_dict.get('productId') or str(data_dict['productId']).strip() == '':
            data_dict['productId'] = generate_unique_product_id()

        payload = {
            "file_path": request.file_path,
            "data": data_dict,
            "config_id": request.config_id,
        }

        # Track job in-memory (for frontend status polling)
        job_store.create_job(job_id, payload)

        # Wait briefly for NATS (covers the startup window)
        if not _nats_ready.is_set():
            try:
                await asyncio.wait_for(_nats_ready.wait(), timeout=10.0)
            except asyncio.TimeoutError:
                raise HTTPException(
                    status_code=503,
                    detail="NATS JetStream is still connecting — please retry in a few seconds",
                )

        # Publish to NATS JetStream (crash-resilient delivery)
        await nats_client.publish_job(job_id, payload)

        return {
            "success": True,
            "job_id": job_id,
            "productId": data_dict['productId'],
            "status": "queued",
            "message": "Data queued for processing",
            "status_url": f"/api/job-status/{job_id}"
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error queuing job: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Failed to queue job: {str(e)}")


@app.get("/api/job-status/{job_id}")
async def get_job_status(job_id: str):
    """
    Get the status of an async job
    
    Returns:
        - queued: Job is waiting to be processed
        - processing: Job is currently being processed
        - completed: Job finished successfully
        - failed: Job failed with error
    """
    job = job_store.get_job(job_id)
    
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    response = {
        "job_id": job["job_id"],
        "status": job["status"],
        "created_at": datetime.fromtimestamp(job["created_at"]).isoformat(),
        "updated_at": datetime.fromtimestamp(job["updated_at"]).isoformat(),
    }
    
    if job["status"] == "completed":
        response.update({
            "product_id": job.get("product_id"),
            "github_url": job.get("github_url"),
            "github_raw_url": job.get("github_raw_url"),
            "aas_github_url": job.get("aas_github_url"),
        })
    elif job["status"] == "failed":
        response["error_message"] = job.get("error")
    
    return response


def _sync_delete_product(product_id: str, config_id: Optional[str], folder: str) -> dict:
    """
    Synchronous core of delete_product.
    
    Architecture: reuses the same mutation preview/apply core as MCP batch
    changes, but applies immediately because the manual UI already confirmed
    the delete before calling this endpoint.
    """
    try:
        preview_request = DataMutationPreviewRequest(
            config_id=config_id,
            folder=folder,
            requested_by="api:delete_product",
            actions=[DataMutationAction(
                action="delete",
                product_id=product_id,
                config_id=config_id,
                folder=folder,
            )],
        )
        preview_public = _create_data_mutation_preview(preview_request, validate_schema=False, store=True)
        with _MUTATION_PREVIEWS_LOCK:
            preview = _PENDING_MUTATION_PREVIEWS.pop(preview_public["approval_id"])
        preview["status"] = "approved"
        result = _apply_data_mutation_preview(preview)
        
        return {
            "success": True,
            "message": f"Product {product_id} deleted successfully",
            "aggregatedUpdated": True,
            "results": result.get("results", []),
        }
        
    except GithubException as e:
        print(f"GitHub API Error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=400, detail=f"GitHub API error: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        print(f"Server Error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Server error: {str(e)}")


@app.delete("/api/delete-product/{product_id}")
async def delete_product(product_id: str, config_id: Optional[str] = None, folder: str = "products"):
    """Delete a product. Runs blocking GitHub calls in a thread."""
    return await asyncio.to_thread(_sync_delete_product, product_id, config_id, folder)


# ---------------------------------------------------------------------------
# Siemens NX Open CAD Assembly Integration
# ---------------------------------------------------------------------------
_LATEST_NX_ASSEMBLY_PATH = os.path.join(os.path.dirname(__file__), "cache", "latest_nx_assembly.json")
_latest_nx_assembly_cache = None

@app.post("/api/nx/assembly")
async def store_nx_assembly(request: Request):
    """Store active CAD assembly structure posted from Siemens NX Open."""
    global _latest_nx_assembly_cache
    try:
        body = await request.json()
        _latest_nx_assembly_cache = body
        os.makedirs(os.path.dirname(_LATEST_NX_ASSEMBLY_PATH), exist_ok=True)
        with open(_LATEST_NX_ASSEMBLY_PATH, "w", encoding="utf-8") as f:
            json.dump(body, f, indent=2)
        count = len(body) if isinstance(body, list) else len(body.get("nodes", []))
        return {"success": True, "message": f"Saved {count} components from Siemens NX", "count": count}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to process NX assembly JSON: {e}")

@app.get("/api/nx/assembly")
async def get_nx_assembly():
    """Retrieve the latest active CAD assembly structure from Siemens NX."""
    global _latest_nx_assembly_cache
    if _latest_nx_assembly_cache is not None:
        return _latest_nx_assembly_cache
    if os.path.exists(_LATEST_NX_ASSEMBLY_PATH):
        try:
            with open(_LATEST_NX_ASSEMBLY_PATH, "r", encoding="utf-8") as f:
                _latest_nx_assembly_cache = json.load(f)
                return _latest_nx_assembly_cache
        except Exception:
            pass
    raise HTTPException(status_code=404, detail="No active Siemens NX assembly found. Please push an assembly from NX or start the NX bridge.")

@app.delete("/api/nx/assembly")
async def clear_nx_assembly():
    """Clear cached NX assembly."""
    global _latest_nx_assembly_cache
    _latest_nx_assembly_cache = None
    if os.path.exists(_LATEST_NX_ASSEMBLY_PATH):
        try:
            os.remove(_LATEST_NX_ASSEMBLY_PATH)
        except Exception:
            pass
    return {"success": True, "message": "NX assembly cache cleared"}


# ---------------------------------------------------------------------------
# On-demand export: JSON-LD and AAS from aggregated data (no GitHub write)
# ---------------------------------------------------------------------------

def _get_product_from_aggregated(product_id: str, config_id: Optional[str], folder: str) -> dict:
    """Fetch a single product from the aggregated JSON by productId."""
    g, repo_name, branch = _resolve_config(config_id)
    repo = _get_repo(g, repo_name, config_id)
    data_path = _resolve_data_path(config_id, folder)
    agg_path = _resolve_aggregated_path(config_id, folder, data_path)

    try:
        agg_file = repo.get_contents(agg_path, ref=branch)
        products = json.loads(base64.b64decode(agg_file.content).decode("utf-8"))
    except GithubException as e:
        if e.status == 404:
            raise HTTPException(status_code=404, detail="Aggregated file not found")
        raise HTTPException(status_code=400, detail=f"GitHub API error: {e}")

    for p in products:
        if p.get("productId") == product_id:
            return p
    raise HTTPException(status_code=404, detail=f"Product {product_id} not found")


@app.get("/api/export/jsonld/{product_id}")
async def export_jsonld(product_id: str, config_id: Optional[str] = None, folder: str = "products"):
    """
    On-demand JSON-LD export for a single product.
    Reads from the aggregated JSON and wraps in a JSON-LD context that matches
    the use-case shape:

    - VDA 231-301 Semi-finished Good (``chemicalComposition`` present): emits a
      materials/chemistry vocabulary aligned with the MaterialComposition AAS
      submodel, so the JSON-LD export carries the same information as the AAS.
    - Default (Raw Material / Finished Product): legacy DPP / schema.org
      context with productName / manufacturer / sustainability fields.
    """
    def _export():
        product = _get_product_from_aggregated(product_id, config_id, folder)
        github_url = product.get("githubUrl", "")

        chem = product.get("chemicalComposition")
        if isinstance(chem, list) and len(chem) > 0:
            # VDA 231-301 semi-finished good shape.
            # Vocab namespace matches the AAS semantic-id base (Repo-URL).
            repo_base = _repo_base_from_github_url(github_url)
            mat_vocab = f"{repo_base.rstrip('/')}/MaterialComposition/"
            return {
                "@context": {
                    "@vocab": mat_vocab,
                    "schema": "https://schema.org/",
                    "xsd": "http://www.w3.org/2001/XMLSchema#",
                    "productId":              "schema:identifier",
                    "productName":            "schema:name",
                    "materialId":             f"{mat_vocab}MaterialId",
                    "materialIdRevision":     f"{mat_vocab}MaterialIdRevision",
                    "designation":            f"{mat_vocab}Designation",
                    "materialNumber":         f"{mat_vocab}MaterialNumber",
                    "alloyGroup":             f"{mat_vocab}MaterialFamily",
                    "nomenclatureStandard":   f"{mat_vocab}MaterialNomenclatures/Standard",
                    "classificationStandard": f"{mat_vocab}MaterialClassifications/Standard",
                    "classificationCategory": f"{mat_vocab}MaterialClassifications/Category",
                    "classificationClass":    f"{mat_vocab}MaterialClassifications/Class",
                    "classificationSubclass": f"{mat_vocab}MaterialClassifications/Subclass",
                    "compositionStandard":    f"{mat_vocab}ChemicalComposition/Standard",
                    "compositionUnit":        f"{mat_vocab}ChemicalComposition/Unit",
                    "chemicalComposition": {
                        "@id":        f"{mat_vocab}ChemicalComposition/ChemicalElements",
                        "@container": "@list",
                    },
                    "element":      f"{mat_vocab}ChemicalElement/ChemicalSymbol",
                    "cas":          f"{mat_vocab}ChemicalElement/CASNumber",
                    "avg":          {"@id": f"{mat_vocab}ChemicalElement/AvgPercentage", "@type": "xsd:double"},
                    "min":          {"@id": f"{mat_vocab}ChemicalElement/MinPercentage", "@type": "xsd:double"},
                    "max":          {"@id": f"{mat_vocab}ChemicalElement/MaxPercentage", "@type": "xsd:double"},
                    "fractionType": f"{mat_vocab}ChemicalElement/FractionType",
                    "githubUrl":    "@id",
                    "githubRawUrl": f"{mat_vocab}rawDataUrl",
                },
                "@id": github_url,
                "@type": f"{mat_vocab}Material",
                **product,
            }

        # Legacy / default shape (Raw Material, Finished Product)
        return {
            "@context": {
                "@vocab": "https://schema.org/",
                "dpp": "https://dpp-vocab.org/",
                "irdi": "https://www.iso.org/standard/75254.html#",
                "productId": "dpp:productId",
                "productName": "name",
                "manufacturer": "manufacturer",
                "materialName": "dpp:materialName",
                "recycledContent": "dpp:recycledContent",
                "co2Equivalent": "dpp:carbonFootprint",
                "co2Method": "dpp:carbonFootprintMethod",
                "githubUrl": "@id",
                "githubRawUrl": "dpp:rawDataUrl",
            },
            "@id": github_url,
            "@type": "Product",
            **product,
        }
    return await asyncio.to_thread(_export)


@app.get("/api/export/aas/{product_id}")
async def export_aas(product_id: str, config_id: Optional[str] = None, folder: str = "products"):
    """
    On-demand AAS (Asset Administration Shell) export for a single product.
    Generates BaSyx-compatible AAS JSON from aggregated data — nothing is
    written to GitHub.
    """
    if not BASYX_AVAILABLE:
        raise HTTPException(status_code=501, detail="BaSyx SDK not available")

    def _export():
        product = _get_product_from_aggregated(product_id, config_id, folder)
        github_url = product.get("githubUrl", "")
        aas_data = create_product_aas(product, github_url=github_url)
        if not aas_data:
            raise HTTPException(status_code=500, detail="AAS generation failed")
        aas, submodels = aas_data
        aas_json = aas_to_json(aas, submodels)
        if not aas_json:
            raise HTTPException(status_code=500, detail="AAS serialization failed")
        return json.loads(aas_json)
    return await asyncio.to_thread(_export)


# ── BOM AAS export (IDTA 02011-1-0 Hierarchical Structures) ────────
def _build_bom_aas_json(nodes: list[dict], submodel_id: str = "urn:htx:bom:1") -> dict:
    """
    Convert flat BOM node list into IDTA 02011-1-0 Hierarchical Structures
    submodel JSON.  Each node becomes a SubmodelElementCollection containing
    Property elements for id, name, parentId, quantity, etc.
    The internal modelType "Assembly" is mapped back to the AAS-compliant
    "SubmodelElementCollection" for export.
    """
    # Map internal modelTypes to AAS-compliant modelTypes
    AAS_MODEL_TYPE_MAP = {
        "Assembly": "SubmodelElementCollection",
    }

    submodel_elements = []
    for node in nodes:
        node_id = node.get("nodeId") or node.get("productId", "unknown")
        id_short = f"Node_{node_id}"

        # Build Property list for this node
        props = []
        # Core BOM fields
        field_map = {
            "id": ("xs:string", node_id),
            "name": ("xs:string", node.get("name", "")),
            "parentId": ("xs:string", node.get("parentId") or None),
            "quantity": ("xs:int", str(node.get("quantity", "1"))),
        }
        for prop_name, (value_type, value) in field_map.items():
            props.append({
                "idShort": prop_name,
                "modelType": "Property",
                "valueType": value_type,
                "value": value,
            })

        raw_model_type = node.get("modelType", "Assembly")
        node_model_type = AAS_MODEL_TYPE_MAP.get(raw_model_type, raw_model_type)

        # Additional optional fields
        if node.get("description"):
            props.append({
                "idShort": "description",
                "modelType": "Property",
                "valueType": "xs:string",
                "value": node["description"],
            })
        if node.get("edcAssetId"):
            props.append({
                "idShort": "edcAssetId",
                "modelType": "Property",
                "valueType": "xs:string",
                "value": node["edcAssetId"],
            })
        if node.get("edcAssetName"):
            props.append({
                "idShort": "edcAssetName",
                "modelType": "Property",
                "valueType": "xs:string",
                "value": node["edcAssetName"],
            })
        if node.get("manufacturer"):
            props.append({
                "idShort": "manufacturer",
                "modelType": "Property",
                "valueType": "xs:string",
                "value": node["manufacturer"],
            })
        if node.get("materialName"):
            props.append({
                "idShort": "materialName",
                "modelType": "Property",
                "valueType": "xs:string",
                "value": node["materialName"],
            })
        if node.get("weight"):
            props.append({
                "idShort": "weight",
                "modelType": "Property",
                "valueType": "xs:float",
                "value": node["weight"],
            })
        if node.get("valueType"):
            props.append({
                "idShort": "valueType",
                "modelType": "Property",
                "valueType": "xs:string",
                "value": node["valueType"],
            })
        if node.get("propertyValue"):
            props.append({
                "idShort": "propertyValue",
                "modelType": "Property",
                "valueType": node.get("valueType", "xs:string"),
                "value": node["propertyValue"],
            })

        submodel_elements.append({
            "idShort": id_short,
            "modelType": node_model_type,
            "value": props,
        })

    return {
        "submodelId": submodel_id,
        "idShort": "BillOfMaterial",
        "semanticId": {
            "type": "ExternalReference",
            "keys": [{
                "type": "GlobalReference",
                "value": "https://admin-shell.io/idta/HierarchicalStructures/1/0/Submodel",
            }],
        },
        "submodelElements": submodel_elements,
    }


@app.get("/api/export/bom-aas")
async def export_bom_aas(config_id: Optional[str] = None, folder: str = "bom"):
    """
    Export the complete BOM as an IDTA 02011-1-0 Hierarchical Structures
    submodel JSON.  Reads all flat BOM nodes from the aggregated file and
    constructs the AAS-compliant output.
    """
    def _export():
        g, repo_name, branch = _resolve_config(config_id)
        repo = _get_repo(g, repo_name, config_id)
        data_path = _resolve_data_path(config_id, folder)
        agg_path = _resolve_aggregated_path(config_id, folder, data_path)

        try:
            agg_file = repo.get_contents(agg_path, ref=branch)
            nodes = json.loads(base64.b64decode(agg_file.content).decode("utf-8"))
        except GithubException as e:
            if e.status == 404:
                # No aggregated file yet → return empty BOM
                nodes = []
            else:
                raise HTTPException(status_code=400, detail=f"GitHub API error: {e}")

        if not isinstance(nodes, list):
            nodes = []

        submodel_id = f"urn:htx:bom:{config_id or 'default'}"
        return _build_bom_aas_json(nodes, submodel_id)

    return await asyncio.to_thread(_export)


@app.get("/api/edc/assets-for-bom")
async def edc_assets_for_bom():
    """
    Return EDC connector assets formatted for BOM insertion.
    Each asset includes id, name and description for the picker UI.
    """
    from edc_connector import EdcConnector
    try:
        connector = EdcConnector()
        assets = connector.list_assets()
        return [
            {
                "assetId": a.get("@id", a.get("id", "")),
                "name": a.get("properties", {}).get("name", a.get("@id", "")),
                "description": a.get("properties", {}).get("description", ""),
                "contentType": a.get("properties", {}).get("contenttype", ""),
            }
            for a in (assets or [])
        ]
    except Exception as e:
        # EDC connector may not be configured — return empty list
        print(f"[WARN] Could not fetch EDC assets for BOM: {e}")
        return []


def _sync_rebuild_aggregated(config_id: Optional[str] = None) -> dict:
    """Synchronous core of rebuild_aggregated_file. Runs in a thread."""
    try:
        g, repo_name, branch = _resolve_config(config_id)
        repo = _get_repo(g, repo_name, config_id)

        # Rebuild all metadata-defined folders (not just "products")
        folders = _get_metadata_folders(config_id)
        total_count = 0
        all_ids: list[str] = []

        for folder in folders:
            data_path = _resolve_data_path(config_id, folder)

            folder_products: list[dict] = []
            try:
                contents = repo.get_contents(data_path, ref=branch)
                json_files = [file for file in contents if file.type == "file" and file.name.endswith(".json")]

                for file in json_files:
                    try:
                        json_content = base64.b64decode(file.content).decode('utf-8')
                        product_data = json.loads(json_content)
                        if isinstance(product_data, list):
                            continue  # skip aggregated file
                        if 'githubUrl' not in product_data:
                            product_data['githubUrl'] = file.html_url
                        if 'githubRawUrl' not in product_data:
                            product_data['githubRawUrl'] = file.download_url
                        folder_products.append(product_data)
                    except Exception as e:
                        print(f"Error parsing {file.name}: {str(e)}")
                        continue

                agg_path = _resolve_aggregated_path(config_id, folder, data_path)
                update_aggregated_file(repo, folder_products, branch=branch, aggregated_path=agg_path)
                _invalidate_products_cache(config_id, folder)

            except GithubException as e:
                if e.status == 404:
                    agg_path = _resolve_aggregated_path(config_id, folder, data_path)
                    update_aggregated_file(repo, [], branch=branch, aggregated_path=agg_path)
                    _invalidate_products_cache(config_id, folder)
                else:
                    raise

            total_count += len(folder_products)
            all_ids.extend(p.get('productId', 'Unknown') for p in folder_products)

        return {
            "success": True,
            "message": f"Aggregated files rebuilt for {repo_name} (folders: {folders})",
            "productsCount": total_count,
            "productIds": all_ids
        }
                
    except GithubException as e:
        print(f"GitHub API Error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=400, detail=f"GitHub API error: {str(e)}")
    except Exception as e:
        print(f"Server Error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Server error: {str(e)}")


@app.get("/api/rebuild-aggregated")
async def rebuild_aggregated_file(config_id: Optional[str] = None):
    """Rebuild aggregated products.json. Runs blocking GitHub calls in a thread."""
    return await asyncio.to_thread(_sync_rebuild_aggregated, config_id)


def _sync_fetch_products(config_id: Optional[str], folder: str) -> list:
    """Tier 3: Blocking GitHub fetch for list_products. Runs in a thread."""
    g, repo_name, branch = _resolve_config(config_id)
    data_path = _resolve_data_path(config_id, folder)
    repo = _get_repo(g, repo_name, config_id)

    products = []

    try:
        agg_path = _resolve_aggregated_path(config_id, folder, data_path)
        aggregated_file = repo.get_contents(agg_path, ref=branch)
        json_content = base64.b64decode(aggregated_file.content).decode('utf-8')
        products = json.loads(json_content)

        # Fix any products with 'pending' githubUrl (e.g. from AAS import)
        github_url = f"{repo.html_url}/blob/{branch}/{agg_path}"
        host = repo.html_url.split('/')[2]
        github_raw_url = f"https://raw.{host}/{repo_name}/{branch}/{agg_path}"
        for p in products:
            if not p.get("githubUrl") or p.get("githubUrl") == "pending":
                p["githubUrl"] = github_url
            if not p.get("githubRawUrl") or p.get("githubRawUrl") == "pending":
                p["githubRawUrl"] = github_raw_url

        print(f"[FETCH] {repo_name}/{agg_path}: {len(products)} products")

    except GithubException as e:
        if e.status == 404:
            print(f"[FETCH] {data_path}: no aggregated file, reading individual files")
            try:
                contents = repo.get_contents(data_path, ref=branch)
                json_files = [file for file in contents if file.type == "file" and file.name.endswith(".json")]

                if not json_files:
                    return []

                def parse_json_file(file):
                    try:
                        json_content = base64.b64decode(file.content).decode('utf-8')
                        data = json.loads(json_content)
                        if isinstance(data, list):
                            return None
                        # Strip JSON-LD @-keys for consistency with aggregated file
                        compact = {k: v for k, v in data.items() if not k.startswith('@')}
                        compact.setdefault('githubUrl', file.html_url)
                        compact.setdefault('githubRawUrl', file.download_url)
                        return compact
                    except Exception:
                        return None

                products = list(_thread_pool.map(parse_json_file, json_files))
                products = [p for p in products if p is not None]
                print(f"[FETCH] Fallback: {len(products)} products from {len(json_files)} files")

                if products:
                    agg_path = _resolve_aggregated_path(config_id, folder, data_path)
                    update_aggregated_file(repo, products, folder=folder, branch=branch, data_path=data_path, aggregated_path=agg_path)

            except GithubException as e2:
                if e2.status == 404:
                    return []
                raise
        else:
            raise

    return products


@app.get("/api/list-products")
async def list_products(force: bool = False, config_id: Optional[str] = None, folder: str = "products"):
    """
    List all products from the aggregated JSON file (faster than reading individual files)
    Falls back to reading individual files if aggregated file doesn't exist.

    Cache strategy (3-tier, server-side):
      1. In-memory cache (per config+folder, 60 s) → instant
      2. Persistent disk cache (cache/products_cache/) → fast, survives restarts
      3. GitHub API fetch → slower, updates both caches (runs in thread)

    Use ?force=true to bypass all caches and re-fetch from GitHub.
    """
    start_time = time.time()

    cache_key = _products_cache_key(config_id, folder)

    # ── force → clear cache ──
    if force:
        _invalidate_products_cache(config_id, folder)

    try:
        now = time.time()

        # ── Tier 1: in-memory server cache ──
        mem = _products_cache.get(cache_key)
        if mem and not force:
            age = now - mem["ts"]
            if age < _PRODUCTS_CACHE_DURATION:
                return {"success": True, "data": mem["data"], "cached": True}

        # ── Tier 2: persistent disk cache ──
        if not force:
            disk_data = _load_products_disk_cache(config_id, folder)
            if disk_data is not None:
                _products_cache[cache_key] = {"data": disk_data, "ts": now}
                elapsed = (time.time() - start_time) * 1000
                print(f"[LIST] {cache_key}: {len(disk_data)} products from disk cache in {elapsed:.0f}ms")
                return {"success": True, "data": disk_data, "cached": True}

        # ── Tier 3: GitHub API fetch (in thread -> non-blocking) ──
        products = await asyncio.to_thread(_sync_fetch_products, config_id, folder)

        # ── Live CRMA fallback: compute for products missing crmaStatus ──
        for p in products:
            chem = p.get("chemicalComposition")
            if isinstance(chem, list) and len(chem) > 0 and "crmaStatus" not in p:
                crma = check_crma_status(chem)
                p["crmaStatus"] = crma["crmaStatus"]
                p["crmaDetails"] = crma["crmaDetails"]

        # ── Update server memory + disk cache ──
        _products_cache[cache_key] = {"data": products, "ts": now}
        _persist_products_cache(config_id, folder, products)

        elapsed = (time.time() - start_time) * 1000
        print(f"[LIST] {cache_key}: {len(products)} products in {elapsed:.0f}ms")

        return {"success": True, "data": products, "cached": False}

    except GithubException as e:
        raise HTTPException(status_code=400, detail=f"GitHub API error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Server error: {str(e)}")


@app.post("/api/invalidate-cache")
async def invalidate_cache(config_id: Optional[str] = None, folder: str = "products"):
    """
    Invalidate the products cache (called after adding/updating products)
    """
    _invalidate_products_cache(config_id, folder)
    return {"success": True, "message": "Cache invalidated"}


@app.post("/api/check-crma")
async def check_crma_endpoint(payload: dict):
    """Lightweight CRMA check for a single chemical composition.

    Expects ``{"chemicalComposition": [{"element": "Al", "cas": "7429-90-5"}, ...]}``
    and returns ``{"crmaStatus": "...", "crmaDetails": [...]}``.
    """
    chem = payload.get("chemicalComposition")
    if not isinstance(chem, list) or len(chem) == 0:
        return {"crmaStatus": "none", "crmaDetails": []}
    return check_crma_status(chem)


@app.post("/api/enrich-crma")
async def enrich_crma(config_id: Optional[str] = None, folder: str = "products"):
    """
    One-time enrichment: check all existing products against the EU CRMA list
    and persist crmaStatus + crmaDetails back to the aggregated JSON on GitHub.
    """
    try:
        g, repo_name, branch = _resolve_config(config_id)
        repo = _get_repo(g, repo_name, config_id)
        data_path = _resolve_data_path(config_id, folder)
        agg_path = _resolve_aggregated_path(config_id, folder, data_path)

        # Read current aggregated file
        try:
            agg_file = repo.get_contents(agg_path, ref=branch)
            products = json.loads(base64.b64decode(agg_file.content).decode("utf-8"))
            agg_sha = agg_file.sha
        except GithubException as e:
            if e.status == 404:
                return {"success": True, "updated": 0, "message": "No products found"}
            raise

        updated_count = 0
        for p in products:
            chem = p.get("chemicalComposition")
            if not isinstance(chem, list) or len(chem) == 0:
                continue
            crma = check_crma_status(chem)
            if p.get("crmaStatus") != crma["crmaStatus"]:
                p["crmaStatus"] = crma["crmaStatus"]
                p["crmaDetails"] = crma["crmaDetails"]
                updated_count += 1

        if updated_count > 0:
            agg_json = json.dumps(products, indent=2, ensure_ascii=False)
            repo.update_file(
                agg_path,
                f"CRMA enrichment: updated {updated_count} products",
                agg_json,
                agg_sha,
                branch=branch,
            )
            # Refresh in-memory cache
            _invalidate_products_cache(config_id, folder)
            print(f"[CRMA] Enriched {updated_count} products in {repo_name}/{agg_path}")

        return {"success": True, "updated": updated_count, "total": len(products)}

    except GithubException as e:
        raise HTTPException(status_code=400, detail=f"GitHub API error: {str(e)}")
    except Exception as e:
        print(f"[CRMA] Error: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Server error: {str(e)}")


@app.get("/api/search-products")
async def search_products(q: str, config_id: Optional[str] = None, folder: str = "products"):
    """
    Search products server-side using the in-memory cache.
    Much faster than having clients fetch all data and filter locally.
    """
    # Re-use list_products logic to get (possibly cached) data
    result = await list_products(force=False, config_id=config_id, folder=folder)
    data = result.get("data", [])
    query_lower = q.lower()
    matches = [
        row for row in data
        if any(query_lower in str(v).lower() for v in row.values())
    ]
    return {"success": True, "data": matches, "total": len(data), "cached": result.get("cached", False)}


async def warmup_cache():
    """Warm up the in-memory server cache for ALL configured profiles.

    This eliminates the cold-cache latency when the user switches from
    "Raw Material (ROH)" to "Semi-finished Good (HALB)" (or vice-versa) for the
    first time after a server restart.

    Uses the persistent metadata cache to discover which data folders each
    config actually defines (e.g. "bom" instead of the legacy default
    "products").

    All config+folder combinations are fetched in parallel.
    """
    configs = config_manager.get_all_configs()
    tasks = []
    for cfg in configs:
        config_id = cfg.get("id")
        folders = _get_metadata_folders(config_id)
        for folder in folders:
            tasks.append((config_id, folder))

    async def _warmup_one(cid, fld):
        try:
            await list_products(config_id=cid, folder=fld)
        except Exception as e:
            print(f"[WARN] Cache warmup for config {cid}/{fld}: {e}")

    if tasks:
        await asyncio.gather(*[_warmup_one(cid, fld) for cid, fld in tasks])


# GitHub Configuration API Endpoints

@app.get("/api/github-config/status")
async def get_github_config_status():
    """Check if GitHub configuration exists"""
    return {
        "configured": config_manager.config_exists(),
        "using_env": bool(os.getenv("GITHUB_TOKEN") or os.getenv("GITHUB_APP_ID"))
    }


@app.get("/api/github-config")
async def get_github_config():
    """Get GitHub configuration (with sensitive data masked)"""
    config = config_manager.get_config_for_display()
    if not config:
        # Return current env-based config if no file config exists
        return {
            "source": "environment",
            "github_repo": GITHUB_REPO,
            "github_branch": GITHUB_BRANCH,
            "github_base_url": GITHUB_BASE_URL,
            "auth_method": "token" if GITHUB_TOKEN else "app",
            "github_app_id": GITHUB_APP_ID,
            "github_app_installation_id": GITHUB_APP_INSTALLATION_ID,
            "github_app_private_key": GITHUB_APP_PRIVATE_KEY_RAW
        }
    
    return {
        "source": "file",
        **config
    }


@app.post("/api/github-config")
async def save_github_config(config: dict):
    """
    Save GitHub configuration
    
    Body:
    {
        "auth_method": "token" | "app",
        "github_token": "optional - for token auth",
        "github_app_id": "optional - for app auth",
        "github_app_private_key": "optional - PEM key content",
        "github_app_installation_id": "optional - for app auth",
        "github_repo": "owner/repo",
        "github_branch": "main",
        "github_base_url": "optional - for GitHub Enterprise"
    }
    """
    try:
        # Validate required fields
        if not config.get("github_repo"):
            raise HTTPException(status_code=400, detail="github_repo is required")
        
        if '/' not in config["github_repo"]:
            raise HTTPException(status_code=400, detail="github_repo must be in format 'owner/repository-name'")
        
        auth_method = config.get("auth_method", "app")
        
        if auth_method == "token":
            if not config.get("github_token"):
                raise HTTPException(status_code=400, detail="github_token is required for token authentication")
        else:  # app
            required_app_fields = ["github_app_id", "github_app_private_key", "github_app_installation_id"]
            missing = [f for f in required_app_fields if not config.get(f)]
            if missing:
                raise HTTPException(
                    status_code=400,
                    detail=f"Missing required fields for app authentication: {', '.join(missing)}"
                )
        
        # Save configuration (JSON + YAML)
        config_manager.save_config_with_yaml(config)
        
        return {
            "success": True,
            "message": "GitHub configuration saved successfully. Please restart the application for changes to take effect."
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save configuration: {str(e)}")


@app.delete("/api/github-config")
async def delete_github_config():
    """Delete GitHub configuration files (JSON + YAML)"""
    try:
        config_manager.delete_config()
        # Also delete YAML if exists
        yaml_path = config_manager.config_yaml_path
        if yaml_path.exists():
            yaml_path.unlink()
        return {
            "success": True,
            "message": "GitHub configuration deleted successfully"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete configuration: {str(e)}")


@app.get("/api/github-config/export")
async def export_github_config_yaml():
    """Export GitHub configuration as YAML for download or manual editing"""
    try:
        success = config_manager.export_to_yaml()
        if not success:
            raise HTTPException(status_code=404, detail="No configuration to export")
        
        yaml_content = config_manager.config_yaml_path.read_text(encoding='utf-8')
        return {
            "success": True,
            "yaml_content": yaml_content,
            "filename": "github_config.yaml"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to export configuration: {str(e)}")


def _sync_test_github_config(config: dict) -> dict:
    """Synchronous core for testing a GitHub configuration. Runs in a thread."""
    auth_method = config.get("auth_method", "app")
    github_repo = config.get("github_repo")
    github_base_url = config.get("github_base_url")

    if not github_repo:
        raise HTTPException(status_code=400, detail="github_repo is required")

    if auth_method == "token":
        github_token = config.get("github_token")
        if not github_token:
            raise HTTPException(status_code=400, detail="github_token is required")
        auth = Auth.Token(github_token)
        g = Github(auth=auth, base_url=github_base_url) if github_base_url else Github(auth=auth)
    else:
        github_app_id = config.get("github_app_id")
        github_app_private_key = config.get("github_app_private_key")
        github_app_installation_id = config.get("github_app_installation_id")

        if not all([github_app_id, github_app_private_key, github_app_installation_id]):
            raise HTTPException(status_code=400, detail="All GitHub App credentials required")

        private_key = github_app_private_key.replace('\\n', '\n')
        if not ('BEGIN' in private_key and 'PRIVATE KEY' in private_key):
            print(f"WARNING: Invalid PEM format: Key length={len(private_key)}")
            raise HTTPException(status_code=400, detail="Private key does not appear to be valid PEM format")

        app_auth = Auth.AppAuth(github_app_id, private_key)
        installation_auth = app_auth.get_installation_auth(int(github_app_installation_id))
        g = Github(auth=installation_auth, base_url=github_base_url) if github_base_url else Github(auth=installation_auth)

    repo = g.get_repo(github_repo)
    return {
        "success": True,
        "message": f"Successfully connected to {repo.full_name}",
        "repo_info": {
            "name": repo.name,
            "full_name": repo.full_name,
            "private": repo.private,
            "default_branch": repo.default_branch,
        }
    }


@app.post("/api/github-config/test")
async def test_github_config(config: dict):
    """Test GitHub configuration without saving. Runs in a thread."""
    try:
        return await asyncio.to_thread(_sync_test_github_config, config)
    except GithubException as e:
        return {"success": False, "message": f"GitHub API Error: {e.data.get('message', str(e))}"}
    except HTTPException:
        raise
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}


@app.post("/api/github-configs/{config_id}/test")
async def test_github_config_by_id(config_id: str):
    """Test GitHub configuration by ID. Loads real credentials and runs in a thread."""
    try:
        config = config_manager.get_config_by_id(config_id)
        if not config:
            raise HTTPException(status_code=404, detail="Configuration not found")
        return await asyncio.to_thread(_sync_test_github_config, config)
    except GithubException as e:
        return {"success": False, "message": f"GitHub API Error: {e.data.get('message', str(e))}"}
    except HTTPException:
        raise
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}


# ============================================
# Multi-Config GitHub Configuration Endpoints
# ============================================

@app.get("/api/github-configs")
async def get_all_github_configs():
    """Get all GitHub configurations (with sensitive data masked)"""
    configs = config_manager.get_all_configs_for_display()
    return {
        "configs": configs,
        "count": len(configs)
    }


@app.get("/api/github-configs/{config_id}")
async def get_github_config_by_id(config_id: str):
    """Get a specific GitHub configuration by ID (with sensitive data masked)"""
    config = config_manager.get_config_by_id(config_id)
    if not config:
        raise HTTPException(status_code=404, detail="Configuration not found")
    
    # Mask sensitive data
    display_config = config.copy()
    if display_config.get("github_token"):
        token = display_config["github_token"]
        display_config["github_token"] = "***" + token[-4:] if len(token) > 4 else "****"
    if display_config.get("github_app_private_key"):
        display_config["github_app_private_key"] = "[PEM KEY CONFIGURED]"
    
    return display_config


@app.post("/api/github-configs")
async def create_github_config(config: dict):
    """
    Create a new GitHub configuration
    
    Body:
    {
        "name": "My Config" (optional, defaults to repo name),
        "auth_method": "token" | "app",
        "github_token": "optional - for token auth",
        "github_app_id": "optional - for app auth",
        "github_app_private_key": "optional - PEM key content",
        "github_app_installation_id": "optional - for app auth",
        "github_repo": "owner/repo",
        "github_branch": "main",
        "github_base_url": "optional - for GitHub Enterprise"
    }
    """
    try:
        # Validate required fields
        if not config.get("github_repo"):
            raise HTTPException(status_code=400, detail="github_repo is required")
        
        if '/' not in config["github_repo"]:
            raise HTTPException(status_code=400, detail="github_repo must be in format 'owner/repository-name'")
        
        auth_method = config.get("auth_method", "app")
        
        if auth_method == "token":
            if not config.get("github_token"):
                raise HTTPException(status_code=400, detail="github_token is required for token authentication")
        else:  # app
            required_app_fields = ["github_app_id", "github_app_private_key", "github_app_installation_id"]
            missing = [f for f in required_app_fields if not config.get(f)]
            if missing:
                raise HTTPException(
                    status_code=400,
                    detail=f"Missing required fields for app authentication: {', '.join(missing)}"
                )
        
        # Add new configuration
        saved_config = config_manager.add_config(config)

        # Fetch & persist repo graph metadata for new config immediately
        try:
            print(f"[CACHE] Fetching repo metadata for new config '{saved_config.get('name', '')}' ...")
            await _fetch_all_repo_metadata_live()
        except Exception as e:
            print(f"[WARN] Could not pre-fetch metadata for new config: {e}")
        
        return {
            "success": True,
            "message": "GitHub configuration created successfully",
            "config": {
                "id": saved_config["id"],
                "name": saved_config.get("name"),
                "github_repo": saved_config.get("github_repo")
            }
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create configuration: {str(e)}")


@app.put("/api/github-configs/{config_id}")
async def update_github_config(config_id: str, updates: dict):
    """
    Update an existing GitHub configuration
    
    Args:
        config_id: Configuration ID
        updates: Fields to update (same structure as create)
    """
    try:
        # Validate if config exists
        existing = config_manager.get_config_by_id(config_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Configuration not found")
        
        # Validate fields if being updated
        if "github_repo" in updates and updates["github_repo"]:
            if '/' not in updates["github_repo"]:
                raise HTTPException(status_code=400, detail="github_repo must be in format 'owner/repository-name'")
        
        # Update configuration
        updated_config = config_manager.update_config(config_id, updates)
        
        if not updated_config:
            raise HTTPException(status_code=404, detail="Configuration not found")

        # Re-fetch & persist repo graph metadata after config update
        try:
            print(f"[CACHE] Re-fetching repo metadata after config update '{updated_config.get('name', '')}' ...")
            await _fetch_all_repo_metadata_live()
        except Exception as e:
            print(f"[WARN] Could not re-fetch metadata after config update: {e}")
        
        return {
            "success": True,
            "message": "GitHub configuration updated successfully",
            "config": {
                "id": updated_config["id"],
                "name": updated_config.get("name"),
                "github_repo": updated_config.get("github_repo")
            }
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update configuration: {str(e)}")


@app.delete("/api/github-configs/{config_id}")
async def delete_github_config_by_id(config_id: str):
    """Delete a specific GitHub configuration by ID"""
    try:
        success = config_manager.delete_config_by_id(config_id)
        if not success:
            raise HTTPException(status_code=404, detail="Configuration not found")

        # Rebuild repo graph cache without the deleted config
        try:
            await _fetch_all_repo_metadata_live()
        except Exception as e:
            print(f"[WARN] Could not rebuild cache after config delete: {e}")
        
        return {
            "success": True,
            "message": "GitHub configuration deleted successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete configuration: {str(e)}")


# ============================================
# GitHub App - Automated Repo Creation
# ============================================

@app.get("/api/github-app/status")
async def github_app_status():
    """Check if GitHub App automated features are available (requires at least one stored config)."""
    try:
        configs = config_manager.get_all_configs()
        has_app_config = any(
            c.get("github_app_id") and c.get("github_app_private_key") and c.get("github_app_installation_id")
            for c in configs
        )
        source_configs = [
            {
                "id": c.get("id"),
                "name": c.get("name", c.get("github_repo", "unknown")),
                "org": c.get("github_repo", "").split("/")[0] if c.get("github_repo") else "",
            }
            for c in configs
            if c.get("github_app_id") and c.get("github_app_private_key") and c.get("github_app_installation_id")
        ]
        return {
            "available": has_app_config,
            "source_configs": source_configs,
            "message": "GitHub App automated features available" if has_app_config else "No GitHub App configuration found. Create a manual configuration first."
        }
    except Exception as e:
        return {"available": False, "source_configs": [], "message": str(e)}


@app.get("/api/github-app/orgs")
async def github_app_list_orgs(source_config_id: Optional[str] = None):
    """List all organizations where the GitHub App is installed (auto-discovery)."""
    try:
        orgs = await github_app_service.get_available_orgs(source_config_id)
        return {"orgs": orgs, "count": len(orgs)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list organizations: {str(e)}")


@app.get("/api/github-app/repos/{org}")
async def github_app_list_repos(org: str, source_config_id: Optional[str] = None):
    """List existing repositories in an organization."""
    try:
        repos = await github_app_service.list_org_repos(org, source_config_id)
        return {"repos": repos, "count": len(repos)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list repositories: {str(e)}")


@app.post("/api/github-app/create-repo")
async def github_app_create_repo(body: dict):
    """
    Create a new repository automatically via GitHub App.
    No manual token/credentials needed - uses stored config.
    
    Body:
    {
        "org": "organization-name",
        "repo_name": "new-repo-name",
        "description": "optional description",
        "private": true,
        "source_config_id": "optional - specific config to use"
    }
    """
    try:
        org = body.get("org")
        repo_name = body.get("repo_name")
        
        if not org or not repo_name:
            raise HTTPException(status_code=400, detail="'org' and 'repo_name' are required")
        
        # Validate repo name
        if not re.match(r'^[a-zA-Z0-9._-]+$', repo_name):
            raise HTTPException(status_code=400, detail="Repository name contains invalid characters. Use only letters, numbers, hyphens, underscores, and dots.")
        
        result = await github_app_service.create_repo(
            org=org,
            repo_name=repo_name,
            description=body.get("description", ""),
            private=body.get("private", True),
            source_config_id=body.get("source_config_id"),
        )
        
        # Fetch metadata for the new config
        try:
            await _fetch_all_repo_metadata_live()
        except Exception as e:
            print(f"[WARN] Could not pre-fetch metadata for auto-created repo: {e}")
        
        return {
            "success": True,
            "message": f"Repository '{org}/{repo_name}' created and configured automatically",
            **result
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create repository: {str(e)}")


@app.post("/api/github-app/connect-repo")
async def github_app_connect_repo(body: dict):
    """
    Connect to an existing repository automatically via GitHub App.
    No manual credentials needed - uses stored config.
    
    Body:
    {
        "org": "organization-name",
        "repo_name": "existing-repo-name",
        "source_config_id": "optional - specific config to use"
    }
    """
    try:
        org = body.get("org")
        repo_name = body.get("repo_name")
        
        if not org or not repo_name:
            raise HTTPException(status_code=400, detail="'org' and 'repo_name' are required")
        
        result = await github_app_service.create_repo_from_existing(
            org=org,
            repo_name=repo_name,
            source_config_id=body.get("source_config_id"),
        )
        
        # Fetch metadata for the new config
        try:
            await _fetch_all_repo_metadata_live()
        except Exception as e:
            print(f"[WARN] Could not pre-fetch metadata for auto-connected repo: {e}")
        
        return {
            "success": True,
            "message": f"Repository '{org}/{repo_name}' connected and configured automatically",
            **result
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to connect repository: {str(e)}")


# ============================================
# EDC Tractus-X Connector Endpoints
# ============================================

@app.get("/api/edc/status")
async def edc_status():
    """Check EDC connector connection status."""
    return await edc_connector.get_edc_status()


@app.post("/api/edc/catalog")
async def edc_catalog(body: dict = None):
    """Request catalog from a provider connector."""
    try:
        provider_url = (body or {}).get("providerUrl") or None
        result = await edc_connector.request_catalog(provider_url)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"EDC catalog request failed: {str(e)[:200]}")


@app.get("/api/edc/assets")
async def edc_list_assets():
    """List assets registered in the local EDC connector."""
    try:
        return await edc_connector.list_assets()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"EDC assets request failed: {str(e)[:200]}")


@app.post("/api/edc/assets")
async def edc_create_asset(product: dict):
    """Register a product as an EDC asset."""
    try:
        return await edc_connector.create_asset_for_product(product)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"EDC asset creation failed: {str(e)[:200]}")


@app.delete("/api/edc/assets/{asset_id}")
async def edc_delete_asset(asset_id: str):
    """Delete an asset from the local EDC connector."""
    try:
        return await edc_connector.delete_asset(asset_id)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"EDC asset deletion failed: {str(e)[:200]}")


@app.get("/api/edc/policies")
async def edc_list_policies():
    """List policy definitions."""
    try:
        return await edc_connector.list_policies()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"EDC policies request failed: {str(e)[:200]}")


@app.post("/api/edc/policies")
async def edc_create_policy(body: dict = None):
    """Create a usage policy (simple or DCP-compliant)."""
    try:
        params = body or {}
        policy_type = params.get("type", "simple")

        if policy_type == "dcp":
            return await edc_connector.create_dcp_policy(
                policy_id=params.get("policyId"),
                policy_name=params.get("policyName"),
                permission=params.get("permission", "use"),
                purpose=params.get("purpose"),
                valid_from=params.get("validFrom"),
                valid_to=params.get("validTo"),
                credential_type=params.get("credentialType", "MembershipCredential"),
            )
        else:
            policy_id = params.get("policyId")
            return await edc_connector.create_use_policy(policy_id)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"EDC policy creation failed: {str(e)[:200]}")


@app.put("/api/edc/policies/{policy_id}")
async def edc_update_policy(policy_id: str, body: dict = None):
    """Update a DCP policy."""
    try:
        params = body or {}
        return await edc_connector.update_dcp_policy(
            policy_id=policy_id,
            policy_name=params.get("policyName"),
            permission=params.get("permission", "use"),
            purpose=params.get("purpose"),
            valid_from=params.get("validFrom"),
            valid_to=params.get("validTo"),
            credential_type=params.get("credentialType", "MembershipCredential"),
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"EDC policy update failed: {str(e)[:200]}")


@app.delete("/api/edc/policies/{policy_id}")
async def edc_delete_policy(policy_id: str):
    """Delete a policy."""
    try:
        return await edc_connector.delete_policy(policy_id)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"EDC policy deletion failed: {str(e)[:200]}")


@app.get("/api/edc/contract-definitions")
async def edc_list_contract_definitions():
    """List contract definitions."""
    try:
        return await edc_connector.list_contract_definitions()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"EDC contract definitions failed: {str(e)[:200]}")


@app.post("/api/edc/contract-definitions")
async def edc_create_contract_definition(body: dict):
    """Create a contract definition with contractual metadata."""
    try:
        contract_name = body.get("contractName")
        if not contract_name:
            raise HTTPException(status_code=400, detail="contractName is required")
        return await edc_connector.create_contract_definition(
            contract_name=contract_name,
            description=body.get("description"),
            provider=body.get("provider"),
            consumer=body.get("consumer"),
            valid_from=body.get("validFrom"),
            valid_to=body.get("validTo"),
            purpose=body.get("purpose"),
            terms=body.get("terms"),
            provider_endpoint=body.get("providerEndpoint"),
            policy_id=body.get("policyId"),
            asset_id=body.get("assetId"),
            access_policy_id=body.get("accessPolicyId"),
        )
    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"EDC contract definition failed: {str(e)[:200]}")


@app.put("/api/edc/contract-definitions/{cd_id}")
async def edc_update_contract_definition(cd_id: str, body: dict):
    """Update a contract definition."""
    try:
        return await edc_connector.update_contract_definition(
            contract_def_id=cd_id,
            contract_name=body.get("contractName"),
            description=body.get("description"),
            provider=body.get("provider"),
            consumer=body.get("consumer"),
            valid_from=body.get("validFrom"),
            valid_to=body.get("validTo"),
            purpose=body.get("purpose"),
            terms=body.get("terms"),
            provider_endpoint=body.get("providerEndpoint"),
            policy_id=body.get("policyId"),
            asset_id=body.get("assetId"),
            access_policy_id=body.get("accessPolicyId"),
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"EDC contract definition update failed: {str(e)[:200]}")


@app.delete("/api/edc/contract-definitions/{cd_id}")
async def edc_delete_contract_definition(cd_id: str):
    """Delete a contract definition."""
    try:
        return await edc_connector.delete_contract_definition(cd_id)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"EDC contract definition deletion failed: {str(e)[:200]}")


@app.post("/api/edc/negotiations")
async def edc_initiate_negotiation(body: dict):
    """Initiate a contract negotiation based on a contract definition."""
    try:
        provider_url = body.get("providerUrl")
        contract_def_id = body.get("contractDefinitionId")
        if not provider_url or not contract_def_id:
            raise HTTPException(status_code=400, detail="providerUrl and contractDefinitionId are required")
        return await edc_connector.initiate_negotiation(
            provider_url=provider_url,
            contract_definition_id=contract_def_id,
            offer_id=body.get("offerId"),
            asset_id=body.get("assetId"),
        )
    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"EDC negotiation failed: {str(e)[:200]}")


@app.get("/api/edc/negotiations")
async def edc_list_negotiations():
    """List all contract negotiations."""
    try:
        return await edc_connector.list_negotiations()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"EDC negotiations failed: {str(e)[:200]}")


@app.get("/api/edc/negotiations/{negotiation_id}")
async def edc_get_negotiation(negotiation_id: str):
    """Get status of a contract negotiation."""
    try:
        return await edc_connector.get_negotiation(negotiation_id)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"EDC negotiation status failed: {str(e)[:200]}")


@app.delete("/api/edc/negotiations/{negotiation_id}")
async def edc_delete_negotiation(negotiation_id: str):
    """Delete or withdraw a contract negotiation."""
    try:
        return await edc_connector.delete_negotiation(negotiation_id)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"EDC negotiation deletion failed: {str(e)[:200]}")


@app.post("/api/edc/transfers")
async def edc_initiate_transfer(body: dict):
    """Initiate a data transfer after contract negotiation."""
    try:
        contract_id = body.get("contractAgreementId")
        asset_id = body.get("assetId")
        provider_url = body.get("providerUrl")
        if not contract_id or not asset_id or not provider_url:
            raise HTTPException(status_code=400, detail="contractAgreementId, assetId, and providerUrl are required")
        return await edc_connector.initiate_transfer(contract_id, asset_id, provider_url)
    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"EDC transfer failed: {str(e)[:200]}")


@app.get("/api/edc/transfers")
async def edc_list_transfers():
    """List all transfer processes."""
    try:
        return await edc_connector.list_transfers()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"EDC transfers failed: {str(e)[:200]}")


@app.get("/api/edc/transfers/{transfer_id}")
async def edc_get_transfer(transfer_id: str):
    """Get status of a transfer process."""
    try:
        return await edc_connector.get_transfer(transfer_id)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"EDC transfer status failed: {str(e)[:200]}")


@app.post("/api/edc/publish-product")
async def edc_publish_product(body: dict):
    """
    Smart publish: registers product locally and publishes to EDC if available.
    If EDC is offline, creates a pending registration that can be synced later.
    """
    try:
        product = body.get("product")
        if not product:
            raise HTTPException(status_code=400, detail="product data is required")
        policy_id = body.get("policyId")
        return await edc_connector.register_product(product, policy_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"EDC registration failed: {str(e)[:200]}")


@app.get("/api/edc/registrations")
async def edc_list_registrations():
    """List all local EDC registrations (published + pending)."""
    return edc_connector.get_registrations()


@app.delete("/api/edc/registrations/{product_id}")
async def edc_delete_registration(product_id: str):
    """Remove a local EDC registration."""
    if edc_connector.delete_registration(product_id):
        return {"deleted": product_id}
    raise HTTPException(status_code=404, detail="Registration not found")


@app.patch("/api/edc/registrations/{product_id}/policy")
async def edc_update_registration_policy(product_id: str, body: dict):
    """Update the policy assignment of a registration."""
    policy_id = body.get("policyId")
    if not policy_id:
        raise HTTPException(status_code=400, detail="policyId is required")
    result = edc_connector.update_registration_policy(product_id, policy_id)
    if result:
        return result
    raise HTTPException(status_code=404, detail="Registration not found")


@app.patch("/api/edc/registrations/{product_id}/contract")
async def edc_update_registration_contract(product_id: str, body: dict):
    """Update the contract definition assignment of a registration."""
    contract_def_id = body.get("contractDefinitionId")
    if not contract_def_id:
        raise HTTPException(status_code=400, detail="contractDefinitionId is required")
    result = edc_connector.update_registration_contract(product_id, contract_def_id)
    if result:
        return result
    raise HTTPException(status_code=404, detail="Registration not found")


@app.post("/api/edc/sync")
async def edc_sync_pending():
    """Sync all pending registrations to the live EDC connector."""
    try:
        return await edc_connector.sync_pending()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"EDC sync failed: {str(e)[:200]}")


@app.post("/api/edc/registrations/sync-status")
async def edc_sync_registration_status():
    """Compare registrations against existing products and mark deleted ones."""
    try:
        existing_ids: set[str] = set()
        configs = config_manager.get_all_configs()
        for cfg in configs:
            cid = cfg.get("id")
            try:
                products = await asyncio.to_thread(_sync_fetch_products, cid, "products")
                for p in products:
                    pid = p.get("productId")
                    if pid:
                        existing_ids.add(pid)
            except Exception:
                pass  # skip unreachable configs
        return edc_connector.sync_registration_status(existing_ids)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sync status failed: {str(e)[:200]}")


# ============================================
# EDC Discovery Service Endpoints
# ============================================

@app.get("/api/edc/discovery/status")
async def edc_discovery_status():
    """Check which Catena-X Discovery Services are configured and reachable."""
    return await edc_connector.get_discovery_status()


@app.post("/api/edc/discovery/bpn")
async def edc_bpn_discovery(body: dict):
    """BPN Discovery: resolve identifiers (part IDs) to BPN numbers."""
    try:
        keys = body.get("searchKeys", [])
        resource_type = body.get("resourceType", "manufacturerPartId")
        if not keys:
            raise HTTPException(status_code=400, detail="searchKeys list is required")
        return await edc_connector.bpn_discovery(keys, resource_type)
    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"BPN Discovery failed: {str(e)[:200]}")


@app.post("/api/edc/discovery/edc")
async def edc_edc_discovery(body: dict):
    """EDC Discovery: resolve BPN numbers to connector endpoint URLs."""
    try:
        bpns = body.get("bpns", [])
        if not bpns:
            raise HTTPException(status_code=400, detail="bpns list is required")
        return await edc_connector.edc_discovery(bpns)
    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"EDC Discovery failed: {str(e)[:200]}")


@app.post("/api/edc/discovery/resolve")
async def edc_discover_endpoints(body: dict):
    """Full discovery chain: Identifier → BPN → Connector URL in one call."""
    try:
        search_key = body.get("searchKey", "")
        resource_type = body.get("resourceType", "manufacturerPartId")
        if not search_key:
            raise HTTPException(status_code=400, detail="searchKey is required")
        return await edc_connector.discover_endpoints(search_key, resource_type)
    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Discovery resolve failed: {str(e)[:200]}")


# asyncio.Event that is set once NATS is connected and the background
# worker is running.  Guards /api/write-json-async so callers get a
# clear error instead of a crash when NATS isn't ready yet.
_nats_ready = asyncio.Event()


async def _connect_nats_and_start_worker():
    """Connect to NATS and start the background worker.

    Runs as a background task so the HTTP server is available immediately
    (system-status, list-products, etc. don't need NATS).
    """
    global _worker_task
    try:
        await nats_client.connect()
        _worker_task = asyncio.create_task(_background_worker())
        _nats_ready.set()
    except Exception as e:
        print(f"[NATS] Background connection failed: {e}")
        # Server keeps running — reads work, writes will return 503


@app.on_event("startup")
async def startup_event():
    """Start all background tasks. Server accepts requests immediately."""
    # Check optional dependency availability
    try:
        import openpyxl as _  # noqa: F401
    except ImportError:
        print("[WARN] openpyxl not installed — /api/catalog-export will be unavailable")

    # NATS + worker in background (non-blocking — may take up to 30 s)
    asyncio.create_task(_connect_nats_and_start_worker())

    # Check GitHub connection in background (don't block startup)
    asyncio.create_task(check_github_in_background())

    # Warmup cache (non-blocking — server starts accepting requests immediately)
    asyncio.create_task(warmup_cache())

    # Pre-load chat model into Ollama memory (non-blocking)
    asyncio.create_task(chat_agent.warmup())


# ============================================
# Background Worker (NATS JetStream)
# ============================================

async def _background_worker():
    """
    Process queued jobs sequentially via NATS JetStream.
    Reuses _sync_write_json() via asyncio.to_thread() – zero code duplication.
    """
    sub = await nats_client.subscribe()
    print("[WORKER] Background worker started (NATS JetStream)")

    while True:
        try:
            # Wait for next message from JetStream (blocks until available)
            try:
                msg = await sub.next_msg(timeout=5.0)
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                if "timeout" in type(e).__name__.lower():
                    continue
                raise

            data = json.loads(msg.data)
            job_id = data["job_id"]
            payload = data["payload"]

            # Register in in-memory tracker if not already known
            # (could be a redelivery after crash)
            if not job_store.get_job(job_id):
                job_store.create_job(job_id, payload)

            print(f"[WORKER] Processing {job_id[:8]}")

            job_store.update_status(job_id, "processing")

            try:
                # Reconstruct the same request used by the central sync core.
                request = FileWriteRequest(
                    file_path=payload["file_path"],
                    data=DataEntry(**payload["data"]),
                    config_id=payload.get("config_id"),
                )

                # Call the same sync core as the async write endpoint, in a thread.
                result = await asyncio.to_thread(_sync_write_json, request)

                job_store.update_status(
                    job_id, "completed",
                    product_id=result.get("productId"),
                    github_url=result.get("githubUrl"),
                    github_raw_url=result.get("githubRawUrl"),
                    aas_github_url=(result.get("aas") or {}).get("githubUrl"),
                )
                print(f"[WORKER] OK {job_id[:8]} -> {result.get('productId')}")
                await msg.ack()

            except HTTPException as e:
                # Client errors (4xx) are permanent — ACK and mark failed
                print(f"[WORKER] FAIL {job_id[:8]}: {e.detail}")
                job_store.update_status(job_id, "failed", error_message=e.detail)
                await msg.ack()
            except Exception as e:
                print(f"[WORKER] FAIL {job_id[:8]}: {e}")
                traceback.print_exc()
                # Transient errors (GitHub 5xx, network) — NAK for redelivery
                _is_transient = any((
                    "rate" in str(e).lower(),
                    "timeout" in str(e).lower(),
                    "connection" in str(e).lower(),
                    getattr(e, "status", 0) >= 500,
                ))
                if _is_transient:
                    print(f"[WORKER] NAK {job_id[:8]} (transient, will retry)")
                    job_store.update_status(job_id, "queued", error_message=f"Retrying: {e}")
                    await msg.nak(delay=5)
                else:
                    job_store.update_status(job_id, "failed", error_message=str(e))
                    await msg.ack()

        except asyncio.CancelledError:
            print("[WORKER] Shutting down...")
            break
        except Exception as e:
            print(f"[WORKER] Unexpected error: {e}")
            await asyncio.sleep(1)


async def check_github_in_background():
    """Background task to check GitHub connection without blocking startup."""
    await asyncio.sleep(0.5)
    github_status = await asyncio.to_thread(check_github_connection)
    print(f"[GITHUB] {github_status['message']}")


@app.on_event("shutdown")
async def shutdown_event():
    """Cancel background worker, close NATS, and shut down thread pool."""
    global _worker_task
    if _worker_task:
        _worker_task.cancel()
        try:
            await _worker_task
        except asyncio.CancelledError:
            pass
    await nats_client.close()
    _thread_pool.shutdown(wait=False)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
