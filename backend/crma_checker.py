"""
EU Critical Raw Materials Act (CRMA) checker.

Cross-references a product's chemical composition CAS numbers against
the EU CRMA reference list to determine critical / strategic status.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Any

_DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "critical-raw-materials-act.json")


@lru_cache(maxsize=1)
def _load_crma_data() -> dict[str, dict[str, Any]]:
    """Load the CRMA reference JSON once and build a CAS lookup dict."""
    with open(_DATA_PATH, "r", encoding="utf-8") as f:
        raw = json.load(f)

    lookup: dict[str, dict[str, Any]] = {}
    # Use the latest available year key (e.g. "2023")
    year_key = max(raw.keys()) if raw else "2023"
    for entry in raw.get(year_key, []):
        cas = entry.get("CAS", "").strip()
        if cas:
            lookup[cas] = {
                "critical": entry.get("critical-raw-material", "no").lower() == "yes",
                "strategic": entry.get("strategic-raw-material", "no").lower() == "yes",
                "material": entry.get("material", ""),
            }

    return lookup


def check_crma_status(chemical_composition: list[dict[str, Any]] | None) -> dict[str, Any]:
    """Check a product's chemical composition against the EU CRMA list.

    Returns::

        {
            "crmaStatus": "critical" | "strategic" | "critical+strategic" | "none",
            "crmaDetails": [
                { "element": "Co", "cas": "7440-48-4", "critical": True,
                  "strategic": True, "materialName": "Cobalt" },
                ...
            ]
        }
    """
    if not chemical_composition:
        return {"crmaStatus": "none", "crmaDetails": []}

    lookup = _load_crma_data()
    details: list[dict[str, Any]] = []
    has_critical = False
    has_strategic = False

    for elem in chemical_composition:
        cas = (elem.get("cas") or "").strip()
        if not cas:
            continue
        match = lookup.get(cas)
        if match and (match["critical"] or match["strategic"]):
            details.append({
                "element": elem.get("element", ""),
                "cas": cas,
                "critical": match["critical"],
                "strategic": match["strategic"],
                "materialName": match["material"],
            })
            if match["critical"]:
                has_critical = True
            if match["strategic"]:
                has_strategic = True

    if has_critical and has_strategic:
        status = "critical+strategic"
    elif has_critical:
        status = "critical"
    elif has_strategic:
        status = "strategic"
    else:
        status = "none"

    return {"crmaStatus": status, "crmaDetails": details}
