"""
Chat Agent — connects the ChatPanel to a local Ollama LLM.

Two-phase approach (reliable with smaller models like mistral:7b):

  Phase 1 — LLM generates a plan:
    • Read operations (list_products, get_schema_fields) are handled via tool
      calls.  These are idempotent and work reliably.
    • Write operations (create / update / delete) are expressed by the LLM as
      <action>...</action> JSON blocks embedded in its text response.  The
      model does NOT call tools for writes; it just outputs structured JSON.

  Phase 2 — deterministic execution (no LLM):
    • The backend parses <action> blocks from the final text response.
    • A mutation preview is created and its approval_id is sent back to the
      frontend via the ``mutation_preview`` SSE event.
        • The user approves or rejects in the central frontend review dialog.
        • On approval the dialog calls POST /api/data-mutations/approve/{id}
      and POST /api/data-mutations/commit — no further LLM involvement.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import httpx
from fastapi import HTTPException
from typing import Any, Final

OLLAMA_URL: Final[str] = os.environ.get("OLLAMA_URL", "http://localhost:11434")
CHAT_MODEL: Final[str] = os.environ.get("OLLAMA_CHAT_MODEL", "qwen3.5:4b")

# Maximum tool-call rounds to prevent infinite loops
_MAX_TOOL_ROUNDS: Final[int] = 3

# Ollama inference options — balanced for CPU and cloud GPU deployment
_OLLAMA_OPTIONS: Final[dict] = {
    "temperature": 0.3,
    "num_predict": 1024,
    "num_ctx": 4096,      # enough for system prompt + tool defs + conversation history
    "num_thread": 10,     # match physical cores (i5-1345U: 2P + 8E)
    "num_batch": 512,     # prompt eval batch size — larger = faster input
}

# Reusable HTTP client for Ollama chat (long timeout for CPU inference)
_http_client: httpx.AsyncClient | None = None


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=300.0)
    return _http_client


async def warmup() -> None:
    """Pre-load the chat model into Ollama's memory at backend startup.

    Sends a minimal /api/chat with num_predict=1 so Ollama loads the model
    weights once (takes ~10-20s) instead of on the first real user request.
    Failures are silently ignored — warmup is best-effort.
    """
    try:
        client = _get_http_client()
        print(f"[CHAT] Warming up {CHAT_MODEL}…")
        await client.post(f"{OLLAMA_URL}/api/chat", json={
            "model": CHAT_MODEL,
            "messages": [{"role": "user", "content": "hi"}],
            "stream": False,
            "keep_alive": "30m",
            "options": {"num_predict": 1, "num_ctx": 128},
        })
        print(f"[CHAT] {CHAT_MODEL} warm.")
    except Exception as e:
        print(f"[CHAT] Warmup skipped: {e}")


# ---------------------------------------------------------------------------
# System prompt (base — extended dynamically with schema fields)
# ---------------------------------------------------------------------------
_SYSTEM_PROMPT_BASE: Final[str] = """\
You are the HealthTrack-X AI Assistant for Digital Product Passport (DPP) management.

READING DATA — use the provided tools:
- list_products      : list all products (names, IDs, manufacturers)
- get_schema_fields  : show all expected data fields and their types

WRITING DATA (create / update / delete) — do NOT use tools.
Instead, briefly explain what you will do, then output one <action> block per change:

For CREATE (omit product_id):
<action>
{"action":"create","data":{"productName":"...","manufacturer":"...",...}}
</action>

For UPDATE (include product_id, only changed fields in data):
<action>
{"action":"update","product_id":"exact-existing-id","data":{"field":"new value"}}
</action>

For DELETE (include only product_id):
<action>
{"action":"delete","product_id":"exact-existing-id"}
</action>

For multiple changes output multiple <action> blocks.
The system will create a pending review from your <action> blocks automatically.
The user must approve the review in the interface before any changes are saved to GitHub.

RULES:
- Always reply in the same language the user writes in.
- Never invent product IDs or field values not provided by the user. Ask for missing required fields first.
- For updates/deletes: if you do not know the product_id, call list_products first.
- Keep answers concise.
"""


# ---------------------------------------------------------------------------
# Dynamic tool definitions — built from cached schema fields
# ---------------------------------------------------------------------------
# Cache: keyed by hash of the schema field list so we only rebuild when the
# schema actually changes (persistent metadata cache → fetched_at changes).
_tool_cache: dict[str, tuple[list[dict], str]] = {}  # hash → (tools, system_prompt)

# Static tools — read-only; write operations use <action> blocks instead.
_STATIC_TOOLS: Final[list[dict]] = [
    {
        "type": "function",
        "function": {
            "name": "list_products",
            "description": "List all products in the repository with names, IDs, and manufacturers.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_schema_fields",
            "description": "Get the expected data fields (names, types, allowed values) for product creation.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
]

# Regex to parse <action>…</action> blocks the LLM writes for data changes
_ACTION_BLOCK_RE: Final = re.compile(r"<action>(.*?)</action>", re.DOTALL | re.IGNORECASE)


def _parse_action_blocks(text: str) -> list[dict]:
    """Extract and parse all <action>…</action> JSON blocks from LLM text."""
    actions: list[dict] = []
    for m in _ACTION_BLOCK_RE.finditer(text):
        raw = m.group(1).strip()
        try:
            obj = json.loads(raw)
            if isinstance(obj, dict) and obj.get("action") in ("create", "update", "delete"):
                actions.append(obj)
        except json.JSONDecodeError:
            pass
    return actions


def _schema_hash(schema_fields: list[dict]) -> str:
    """Stable hash of the schema field list for cache keying."""
    raw = json.dumps(schema_fields, sort_keys=True, ensure_ascii=False)
    return hashlib.md5(raw.encode()).hexdigest()


def _build_system_prompt(schema_fields: list[dict]) -> str:
    """Build system prompt, appending schema field hints when available."""
    if not schema_fields:
        return _SYSTEM_PROMPT_BASE

    lines = ["Current schema fields for product creation:"]
    for f in schema_fields:
        name = f.get("field") or f.get("name", "?")
        ftype = f.get("type", "str")
        line = f"- {name} ({ftype})"
        if f.get("unit"):
            line += f", unit: {f['unit']}"
        if f.get("ge") is not None or f.get("le") is not None:
            bounds = []
            if f.get("ge") is not None:
                bounds.append(f"≥{f['ge']}")
            if f.get("le") is not None:
                bounds.append(f"≤{f['le']}")
            line += f", range: {' '.join(bounds)}"
        if f.get("possible_values"):
            line += f", allowed: {', '.join(str(v) for v in f['possible_values'])}"
        if f.get("example"):
            line += f", e.g. {f['example']}"
        lines.append(line)

    return _SYSTEM_PROMPT_BASE + "\n" + "\n".join(lines)


def _append_ui_context_prompt(system_prompt: str, backend_deps: dict) -> str:
    """Append small frontend UI context without adding it to mutation data."""
    context = backend_deps.get("ui_context") or {}
    if not isinstance(context, dict):
        return system_prompt
    active_use_case = context.get("active_use_case")
    app_profile = context.get("app_profile")
    if not active_use_case and not app_profile:
        return system_prompt
    lines = [
        "Frontend context (routing hint only; do not copy these values into product fields):",
    ]
    if active_use_case:
        lines.append(f"- Active use case: {active_use_case}")
    if app_profile:
        lines.append(f"- Profile key: {app_profile}")
    lines.append("- Backend config_id/folder already route read tools and mutation previews to this use case.")
    return system_prompt + "\n\n" + "\n".join(lines)


def _get_tools_and_prompt(schema_fields: list[dict]) -> tuple[list[dict], str]:
    """Return (tool_definitions, system_prompt), cached by schema hash."""
    h = _schema_hash(schema_fields)
    cached = _tool_cache.get(h)
    if cached is not None:
        return cached

    prompt = _build_system_prompt(schema_fields)
    _tool_cache[h] = (_STATIC_TOOLS, prompt)
    return _STATIC_TOOLS, prompt


def _normalize_mutation_actions(actions: list[dict], backend_deps: dict) -> list[dict]:
    """Normalize chat-planned mutation actions to the shared preview contract."""
    normalized: list[dict] = []
    for action in actions:
        if not isinstance(action, dict):
            continue
        normalized.append({
            "action": action.get("action"),
            "product_id": action.get("product_id") or action.get("productId"),
            "data": action.get("data") or {},
            "config_id": backend_deps.get("config_id"),
            "folder": backend_deps.get("data_folder", "products"),
        })
    return normalized


def _extract_schema_fields(backend_deps: dict) -> list[dict]:
    """Extract schema fields from the persistent metadata cache."""
    get_schema_fn = backend_deps.get("get_schema_fields_for_request")
    if get_schema_fn:
        return get_schema_fn()
    return []


def _build_prompted_messages(messages: list[dict], backend_deps: dict) -> tuple[list[dict], list[dict]]:
    schema_fields = _extract_schema_fields(backend_deps)
    tools, system_prompt = _get_tools_and_prompt(schema_fields)
    system_prompt = _append_ui_context_prompt(system_prompt, backend_deps)
    return tools, [{"role": "system", "content": system_prompt}, *messages]


def _ollama_payload(full_messages: list[dict], tools: list[dict], *, stream: bool) -> dict[str, Any]:
    return {
        "model": CHAT_MODEL,
        "messages": full_messages,
        "stream": stream,
        "tools": tools,
        "keep_alive": "30m",
        "options": _OLLAMA_OPTIONS,
    }


def _sse_event(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


# ---------------------------------------------------------------------------
# Tool implementations (call backend logic directly, no HTTP)
# ---------------------------------------------------------------------------

async def _tool_list_products(backend_deps: dict) -> str:
    """List products using the same function as GET /api/list-products."""
    list_products_fn = backend_deps["list_products"]
    config_id = backend_deps.get("config_id")
    folder = backend_deps.get("data_folder", "products")
    result = await list_products_fn(force=False, config_id=config_id, folder=folder)
    products = result.get("data", [])
    if not products:
        return "No products found in the repository."
    summary = []
    for p in products[:30]:
        name = p.get("productName", p.get("product_name", "?"))
        mfr = p.get("manufacturer", "?")
        mid = p.get("productId", p.get("product_id", ""))[:8]
        summary.append(f"- {name} (Manufacturer: {mfr}, ID: {mid}…)")
    text = f"Found {len(products)} product(s):\n" + "\n".join(summary)
    if len(products) > 30:
        text += f"\n… and {len(products) - 30} more."
    return text


async def _tool_get_schema_fields(backend_deps: dict) -> str:
    """Get schema fields for the active chat config/folder."""
    fields = _extract_schema_fields(backend_deps)

    if not fields:
        return "No schema fields found. The repository may not have metadata configured."

    lines = ["Schema fields for product creation:"]
    for f in fields:
        name = f.get("field", "?")
        ftype = f.get("type", "text")
        example = f.get("example", "")
        pv = f.get("possible_values")
        line = f"- {name} ({ftype})"
        if example:
            line += f" e.g. {example}"
        if pv:
            line += f" — allowed: {', '.join(str(v) for v in pv)}"
        lines.append(line)
    return "\n".join(lines)


_READ_TOOL_DISPATCH: dict[str, Any] = {
    "list_products": _tool_list_products,
    "get_schema_fields": _tool_get_schema_fields,
}


async def _run_read_tool_call(tool_call: dict, backend_deps: dict) -> tuple[str, str]:
    fn_name = tool_call.get("function", {}).get("name", "")
    handler = _READ_TOOL_DISPATCH.get(fn_name)
    if handler is None:
        return fn_name or "unknown", f"Unknown or unsupported tool: {fn_name or 'unknown'}"
    return fn_name, await handler(backend_deps)


async def _build_mutation_preview_event(
    action_blocks: list[dict], backend_deps: dict,
) -> dict | None:
    """Create a pending mutation preview from parsed <action> blocks.

    Returns the SSE event payload dict, or None on failure.
    """
    normalized = _normalize_mutation_actions(action_blocks, backend_deps)
    try:
        preview_fn = backend_deps["preview_data_changes"]
        result = await preview_fn({
            "actions": normalized,
            "config_id": backend_deps.get("config_id"),
            "folder": backend_deps.get("data_folder", "products"),
            "requested_by": "chat-agent:plan",
        })
        if not result.get("valid"):
            errors = result.get("errors", [])
            return {"type": "error", "content": f"⚠️ Validation failed: {errors}"}
        return {
            "type": "mutation_preview",
            "approval_id": result.get("approval_id"),
            "actions": normalized,
            "summary": result.get("summary", {}),
        }
    except HTTPException as e:
        return {"type": "error", "content": f"⚠️ {e.detail}"}
    except Exception as e:
        return {"type": "error", "content": f"⚠️ Could not prepare preview: {e}"}


# ---------------------------------------------------------------------------
# Agent loop
# ---------------------------------------------------------------------------

async def chat(messages: list[dict], backend_deps: dict) -> dict:
    """
    Run the chat agent loop.

    Returns ``{"content": str, "created_products": []}`` for API compatibility.
    """
    tools, full_messages = _build_prompted_messages(messages, backend_deps)

    client = _get_http_client()
    assistant_msg: dict = {}

    for _round in range(_MAX_TOOL_ROUNDS):
        print(f"[CHAT] Round {_round + 1}/{_MAX_TOOL_ROUNDS}")
        payload = _ollama_payload(full_messages, tools, stream=False)

        try:
            response = await client.post(f"{OLLAMA_URL}/api/chat", json=payload)
        except httpx.ConnectError:
            return _result("⚠️ The AI service (Ollama) is not reachable. Please make sure it is running on localhost:11434.")
        except httpx.TimeoutException:
            return _result("⚠️ The AI service timed out. The model may still be loading — please try again in a moment.")

        if response.status_code != 200:
            return _result(f"⚠️ Ollama returned an error (HTTP {response.status_code}).")

        result = response.json()
        assistant_msg = result.get("message", {})
        tool_calls = assistant_msg.get("tool_calls")

        if not tool_calls:
            content = _strip_thinking(assistant_msg.get("content", ""))
            print(f"[CHAT] Final answer ({len(content)} chars)")
            return _result(content or "(no response)")

        full_messages.append(assistant_msg)

        for tc in tool_calls:
            fn_name, tool_result = await _run_read_tool_call(tc, backend_deps)
            print(f"[CHAT] Tool call: {fn_name}")

            full_messages.append({"role": "tool", "content": tool_result})

    content = _strip_thinking(assistant_msg.get("content", "")) or "I completed the requested actions."
    return _result(content)


def _result(content: str) -> dict:
    return {"content": content, "created_products": []}


# Regex to strip <think>...</think> blocks (including multi-line)
_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)


def _strip_thinking(text: str) -> str:
    """Remove qwen3-style <think>...</think> reasoning blocks."""
    text = _THINK_RE.sub("", text)
    # Also strip unclosed <think> block (model ran out of tokens)
    idx = text.find("<think>")
    if idx != -1:
        text = text[:idx]
    return text.strip()


class _ThinkFilter:
    """Stateful filter suppressing <think>...</think> in token streams."""

    __slots__ = ("_inside", "_buf")
    _OPEN = "<think>"
    _CLOSE = "</think>"

    def __init__(self) -> None:
        self._inside = False
        self._buf = ""

    def feed(self, token: str) -> str:
        self._buf += token
        out = []
        while self._buf:
            tag = self._CLOSE if self._inside else self._OPEN
            idx = self._buf.find(tag)
            if idx == -1:
                # Keep a tail that could be a partial tag start
                tail = len(tag) - 1
                if not self._inside and len(self._buf) > tail:
                    out.append(self._buf[:-tail])
                    self._buf = self._buf[-tail:]
                break
            if not self._inside:
                out.append(self._buf[:idx])
            self._buf = self._buf[idx + len(tag):]
            self._inside = not self._inside
        return "".join(out)

    def flush(self) -> str:
        """Return remaining buffer content at end of stream."""
        remaining = "" if self._inside else self._buf
        self._buf = ""
        return remaining


# ---------------------------------------------------------------------------
# Streaming variant — yields SSE events for token-by-token display
# ---------------------------------------------------------------------------

async def chat_stream(messages: list[dict], backend_deps: dict):
    """
    Async generator that yields SSE events.

    Event types:
      - ``data: {"type":"token","content":"..."}``        — partial text token
      - ``data: {"type":"tool","name":"...","status":"running"|"done"}`` — read tool
      - ``data: {"type":"mutation_preview","approval_id":"...","actions":[...],"summary":{}}``
      - ``data: {"type":"done"}``                         — end of stream
      - ``data: {"type":"error","content":"..."}``        — error
    """
    tools, full_messages = _build_prompted_messages(messages, backend_deps)
    final_text = ""

    client = _get_http_client()

    for _round in range(_MAX_TOOL_ROUNDS):
        print(f"[CHAT-STREAM] Round {_round + 1}/{_MAX_TOOL_ROUNDS}")
        payload = _ollama_payload(full_messages, tools, stream=True)

        try:
            async with client.stream(
                "POST", f"{OLLAMA_URL}/api/chat", json=payload,
            ) as stream:
                collected_content = ""
                tool_calls: list | None = None
                think_filter = _ThinkFilter()
                async for raw_line in stream.aiter_lines():
                    if not raw_line.strip():
                        continue
                    try:
                        chunk = json.loads(raw_line)
                    except json.JSONDecodeError:
                        continue

                    msg = chunk.get("message", {})
                    if msg.get("tool_calls"):
                        tool_calls = msg["tool_calls"]

                    token = msg.get("content", "")
                    if token:
                        collected_content += token
                        visible = think_filter.feed(token)
                        if visible:
                            yield _sse_event({"type": "token", "content": visible})

                    if chunk.get("done"):
                        break

        except httpx.ConnectError:
            yield _sse_event({"type": "error", "content": "⚠️ Ollama is not reachable."})
            return
        except httpx.TimeoutException:
            yield _sse_event({"type": "error", "content": "⚠️ AI timed out."})
            return

        # Flush remaining filtered content
        remaining = think_filter.flush()
        if remaining:
            yield _sse_event({"type": "token", "content": remaining})

        if not tool_calls:
            # No tool calls — check for <action> blocks in the text (plan-based writes)
            final_text = collected_content
            print(f"[CHAT-STREAM] Final answer ({len(final_text)} chars)")
            action_blocks = _parse_action_blocks(final_text)
            if action_blocks:
                print(f"[CHAT-STREAM] Found {len(action_blocks)} action block(s), building preview")
                event = await _build_mutation_preview_event(action_blocks, backend_deps)
                if event:
                    yield _sse_event(event)
            yield _sse_event({"type": "done"})
            return

        # Read-only tool calls (list_products, get_schema_fields)
        full_messages.append({"role": "assistant", "content": collected_content, "tool_calls": tool_calls})

        for tc in tool_calls:
            fn_name = tc.get("function", {}).get("name", "")
            print(f"[CHAT-STREAM] Tool call: {fn_name}")
            yield _sse_event({"type": "tool", "name": fn_name, "status": "running"})

            _, tool_result = await _run_read_tool_call(tc, backend_deps)

            yield _sse_event({"type": "tool", "name": fn_name, "status": "done"})
            full_messages.append({"role": "tool", "content": tool_result})

    yield _sse_event({"type": "done"})
