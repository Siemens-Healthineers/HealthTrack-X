"""Dynamic schema validation from cached repository-metadata."""

from __future__ import annotations
from typing import Any, Optional
from pydantic import BaseModel, Field, ValidationError, create_model

# YAML type string → Python type
_TYPE_MAP: dict[str, type] = {
    "str": str, "int": int, "float": float,
    "bool": bool, "list": list, "dict": dict,
}

# Constraint keys copied from schema fields into Pydantic Field()
_CONSTRAINT_KEYS = ("ge", "le", "min_length", "max_length", "pattern", "description")


def _build_dynamic_model(
    fields: list[dict[str, Any]],
    model_name: str = "DynamicProduct",
) -> type[BaseModel]:
    """Build a Pydantic v2 model from repository-metadata schema fields.

    Every field is Optional with default None so that missing or empty
    values pass through without triggering min_length / type errors.
    Constraints (ge, le, min_length, …) still apply when a real value
    is provided.
    """
    defs: dict[str, Any] = {}
    for f in fields:
        name = f.get("field") or f.get("name", "")
        if not name:
            continue
        py_type = _TYPE_MAP.get(f.get("type", "str"), str)
        constraints = {k: f[k] for k in _CONSTRAINT_KEYS if k in f}
        # All fields are optional — absent or None is always valid
        defs[name] = (Optional[py_type], Field(default=None, **constraints))
    return create_model(model_name, **defs)  # type: ignore[call-overload]


# ── Public API ────────────────────────────────────────────────
def get_schema_fields_for_folder(
    persistent_cache: dict,
    repo_name: str,
    folder_name: str,
) -> list[dict[str, Any]]:
    """Extract *schema-source* fields for a data folder from the persistent cache."""
    entry = persistent_cache.get(repo_name, {})
    for df in entry.get("data_folders", []):
        if df.get("folder") == folder_name:
            return [f for f in df.get("sample_fields", []) if f.get("source") == "schema"]
    return []


def validate_data(
    schema_fields: list[dict[str, Any]],
    data: dict[str, Any],
) -> tuple[bool, dict[str, Any] | list[dict[str, str]]]:
    """Validate *data* against dynamic schema.  Returns (True, cleaned) or (False, errors)."""
    if not schema_fields:
        return True, data

    # Pre-process: convert empty strings to None so Optional fields
    # pass through without triggering min_length / float_parsing errors
    names = {f.get("field") or f.get("name", "") for f in schema_fields}
    cleaned_input: dict[str, Any] = {}
    for k, v in data.items():
        if k in names and isinstance(v, str) and v.strip() == "":
            cleaned_input[k] = None
        else:
            cleaned_input[k] = v

    Model = _build_dynamic_model(schema_fields)
    try:
        instance = Model(**{k: v for k, v in cleaned_input.items() if k in names})
    except ValidationError as exc:
        return False, [
            {"field": ".".join(str(loc) for loc in e["loc"]),
             "message": e["msg"], "type": e["type"]}
            for e in exc.errors()
        ]

    coerced = instance.model_dump()
    # Restore None → "" for string fields (backend expects empty strings, not null)
    for f in schema_fields:
        fname = f.get("field") or f.get("name", "")
        if fname in coerced and coerced[fname] is None:
            ftype = f.get("type", "str")
            coerced[fname] = "" if ftype in ("str", "string") else coerced[fname]
    # Post-validation: possible_values enum check on coerced values
    errors: list[dict[str, str]] = []
    for f in schema_fields:
        pv = f.get("possible_values")
        if not pv:
            continue
        name = f.get("field") or f.get("name", "")
        val = coerced.get(name)
        if val is not None and val != '' and val not in pv and str(val) not in map(str, pv):
            errors.append({
                "field": name,
                "message": f"Value '{val}' not allowed. Must be one of: {', '.join(map(str, pv))}",
                "type": "value_not_allowed",
            })
    return (False, errors) if errors else (True, coerced)
