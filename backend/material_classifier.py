"""
Material Type Classifier using local Ollama AI.

Classifies products into material type codes (a common ERP material-type
scheme). The value range is fixed and must not change:
- ROH: Rohstoff (Raw Material)
- HALB: Halbfabrikat (Semi-Finished Product)
- FERT: Fertigerzeugnis (Finished Product)
- HAWA: Handelsware (Trading Goods)
- NVAL: Non-Valuated Material
"""

import hashlib
import httpx
import json
import os
import tempfile
import time
from pathlib import Path
from typing import Final, Optional

OLLAMA_URL: Final[str] = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL: Final[str] = os.environ.get("OLLAMA_CLASSIFY_MODEL", "mistral:7b")

# Reusable async HTTP clients (separate pools for different timeout needs)
_http_client: httpx.AsyncClient | None = None        # AI classification (long timeout)
_http_client_fast: httpx.AsyncClient | None = None    # Status checks (short timeout)

def _get_http_client() -> httpx.AsyncClient:
    """Get or create the httpx.AsyncClient for AI classification (30 s timeout)."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=30.0,
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=20),
        )
    return _http_client

def _get_http_client_fast() -> httpx.AsyncClient:
    """Get or create the short-timeout httpx.AsyncClient for status checks."""
    global _http_client_fast
    if _http_client_fast is None or _http_client_fast.is_closed:
        _http_client_fast = httpx.AsyncClient(
            timeout=3.0,
            limits=httpx.Limits(max_keepalive_connections=2, max_connections=10),
        )
    return _http_client_fast

# Valid material type codes (immutable, allocated once) – value range is fixed
_VALID_MATERIAL_TYPES: frozenset[str] = frozenset({"ROH", "HALB", "FERT", "HAWA", "NVAL"})

# Cached Ollama status to avoid blocking every system-status poll
_ollama_status_cache: dict | None = None
_ollama_status_timestamp: float = 0
_OLLAMA_STATUS_TTL: Final[int] = 30  # 30 seconds

# ---------------------------------------------------------------------------
# Persistent file-backed material classification cache (survives restarts)
# ---------------------------------------------------------------------------
_PERSISTENT_CACHE_PATH: Final = Path(__file__).parent / "cache" / "material_classifications.json"
_persistent_cache: dict[str, dict] = {}


def _load_persistent_cache() -> None:
    """Load persistent material classification cache from disk."""
    global _persistent_cache
    try:
        if _PERSISTENT_CACHE_PATH.exists():
            _persistent_cache = json.loads(_PERSISTENT_CACHE_PATH.read_text(encoding="utf-8"))
            print(f"[INFO] Loaded {len(_persistent_cache)} material classifications from cache")
    except Exception as e:
        print(f"[WARN] Could not load classification cache file: {e}")
        _persistent_cache = {}


def _save_persistent_cache() -> None:
    """Atomically write the persistent cache to disk (temp-file + os.replace)."""
    try:
        _PERSISTENT_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(
            dir=str(_PERSISTENT_CACHE_PATH.parent),
            suffix=".tmp",
            prefix="material_cache_",
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(_persistent_cache, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, str(_PERSISTENT_CACHE_PATH))
        except BaseException:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
    except Exception as e:
        print(f"[WARN] Could not save classification cache file: {e}")


def _input_hash(product_name: str, material_name: str,
                manufacturer: str, recycled_content: float) -> str:
    """Deterministic hash of classification inputs for staleness detection."""
    raw = f"{product_name}|{material_name}|{manufacturer}|{recycled_content}".lower().strip()
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _persist_classification(product_id: str | None, result: dict,
                            product_name: str, material_name: str,
                            manufacturer: str, recycled_content: float) -> None:
    """Save a classification result to the persistent file cache."""
    if not product_id:
        return
    ih = _input_hash(product_name, material_name, manufacturer, recycled_content)
    _persistent_cache[product_id] = {**result, "_input_hash": ih}
    _save_persistent_cache()


# Load persistent cache at module import
_load_persistent_cache()


SYSTEM_PROMPT = """You classify products into material type codes.
Reply with ONLY valid JSON. No other text.

Rules:
- ROH = raw, unprocessed material (ores, minerals, crude substances)
- HALB = processed but not finished (ingots, sheets, bars, wire, alloys, cathodes, pellets, refined metals)
- FERT = finished, ready-to-use products
- HAWA = goods bought for resale
- NVAL = unknown/unclassified

Example:
Input: Copper Cathode, Refined Copper
Output: {"type": "HALB", "confidence": 0.9, "reason": "Refined copper cathode is a semi-finished product from electrolytic refining"}

Input: Iron Ore, Fe2O3
Output: {"type": "ROH", "confidence": 0.95, "reason": "Iron ore is a raw material extracted from mining"}"""


async def classify_material(
    product_name: str,
    material_name: str,
    manufacturer: str,
    recycled_content: float = 0.0,
    product_id: str | None = None,
) -> dict:
    """Classify a product into a material type using local Ollama AI."""

    # Check persistent cache (in-memory mirror of material_classifications.json)
    if product_id:
        p_cached = _persistent_cache.get(product_id)
        if p_cached:
            expected = _input_hash(product_name, material_name, manufacturer, recycled_content)
            if p_cached.get("_input_hash") == expected:
                result = {k: v for k, v in p_cached.items() if not k.startswith("_")}
                result["source"] = result.get("source", "local-ai") + "-cached"
                return result

    prompt = f"""Classify this product into a material type:
- Product Name: {product_name}
- Material: {material_name}
- Manufacturer: {manufacturer}
- Recycled Content: {recycled_content}%"""

    try:
        client = _get_http_client()
        response = await client.post(f"{OLLAMA_URL}/api/generate", json={
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "system": SYSTEM_PROMPT,
            "format": "json",
            "stream": False,
            "options": {
                "temperature": 0.1,
                "num_predict": 100,
            }
        })

        if response.status_code == 200:
            result = response.json()
            raw_response = result.get("response", "")
            classification = json.loads(raw_response)

            material_type = classification.get("type", "NVAL")
            if material_type not in _VALID_MATERIAL_TYPES:
                material_type = "NVAL"

            result = {
                "material_type": material_type,
                "confidence": float(classification.get("confidence", 0.0)),
                "reason": classification.get("reason", ""),
                "source": "local-ai",
                "model": OLLAMA_MODEL,
            }
            # Persist classification to file-backed cache
            _persist_classification(product_id, result, product_name, material_name, manufacturer, recycled_content)
            return result
        else:
            print(f"[WARN] Ollama returned status {response.status_code}: {response.text[:200]}")

    except httpx.ConnectError:
        print("[WARN] Ollama not reachable at localhost:11434 - using fallback")
    except httpx.TimeoutException:
        print(f"[WARN] Ollama timeout after 30s (model may still be loading) - using fallback")
    except json.JSONDecodeError as e:
        print(f"[WARN] Could not parse Ollama response as JSON: {e}")
    except Exception as e:
        print(f"[WARN] AI classification failed: {type(e).__name__}: {e}")

    # Fallback: rule-based classification
    result = _rule_based_fallback(material_name, recycled_content)
    _persist_classification(product_id, result, product_name, material_name, manufacturer, recycled_content)
    return result


# Precomputed keyword sets for rule-based fallback (allocated once)
_RAW_KEYWORDS = (
    "ore", "erz", "sand", "crude", "raw", "mineral", "bauxite",
    "lithium", "cobalt", "nickel", "manganese", "graphite",
    "rare earth", "seltene erden", "wolframit", "coltan",
)
_SEMI_KEYWORDS = (
    "ingot", "billet", "sheet", "plate", "coil", "wire", "rod",
    "bar", "tube", "alloy", "legierung", "refined", "pellet",
    "powder", "pulver", "foil", "strip", "slab", "bloom",
)
_RECYCLED_KEYWORDS = ("recycled", "secondary", "scrap")


def _rule_based_fallback(material_name: str, recycled_content: float = 0.0) -> dict:
    """Fallback classification when Ollama is not available."""
    m = material_name.lower()

    # Raw materials
    if any(w in m for w in _RAW_KEYWORDS):
        return {
            "material_type": "ROH",
            "confidence": 0.7,
            "reason": "Rule-based: raw material",
            "source": "fallback",
            "model": "rule-based",
        }

    # Semi-finished products
    if any(w in m for w in _SEMI_KEYWORDS):
        return {
            "material_type": "HALB",
            "confidence": 0.7,
            "reason": "Rule-based: semi-finished product",
            "source": "fallback",
            "model": "rule-based",
        }

    # Recycled raw material
    if recycled_content > 50 and any(w in m for w in _RECYCLED_KEYWORDS):
        return {
            "material_type": "ROH",
            "confidence": 0.65,
            "reason": "Rule-based: recycled raw material",
            "source": "fallback",
            "model": "rule-based",
        }

    # Default
    return {
        "material_type": "ROH",
        "confidence": 0.5,
        "reason": "Default classification",
        "source": "fallback",
        "model": "rule-based",
    }


async def check_ollama_status() -> dict:
    """Check if Ollama is running and which models are available.
    Results are cached for 30 seconds to avoid blocking system-status polls."""
    global _ollama_status_cache, _ollama_status_timestamp

    # Return cached status if fresh enough
    if _ollama_status_cache and (time.time() - _ollama_status_timestamp) < _OLLAMA_STATUS_TTL:
        return _ollama_status_cache

    # Chat model name (imported lazily to avoid circular import)
    chat_model = os.environ.get("OLLAMA_CHAT_MODEL", "qwen3.5:4b")

    try:
        client = _get_http_client_fast()
        response = await client.get(f"{OLLAMA_URL}/api/tags")
        if response.status_code == 200:
            data = response.json()
            models = [m.get("name", "") for m in data.get("models", [])]
            has_classifier = any(OLLAMA_MODEL in m for m in models)
            has_chat = any(chat_model in m for m in models)
            result = {
                "status": "online",
                "models": models,
                "required_model": OLLAMA_MODEL,
                "model_available": has_classifier,
                "chat_model": chat_model,
                "chat_model_available": has_chat,
            }
            _ollama_status_cache = result
            _ollama_status_timestamp = time.time()
            return result
    except Exception:
        pass

    result = {
        "status": "offline",
        "models": [],
        "required_model": OLLAMA_MODEL,
        "model_available": False,
        "chat_model": chat_model,
        "chat_model_available": False,
    }
    _ollama_status_cache = result
    _ollama_status_timestamp = time.time()
    return result


def get_all_cached_classifications() -> dict[str, dict]:
    """Return all persistent classifications (without internal fields)."""
    return {
        pid: {k: v for k, v in entry.items() if not k.startswith("_")}
        for pid, entry in _persistent_cache.items()
    }


def invalidate_classification(product_id: str) -> bool:
    """Remove a product from the persistent classification cache."""
    if product_id in _persistent_cache:
        del _persistent_cache[product_id]
        _save_persistent_cache()
        return True
    return False
