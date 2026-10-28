# ── MCP Server Dockerfile ────────────────────────────────────
# AI assistant tooling bridge (optional development service)
# ─────────────────────────────────────────────────────────────

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Dependencies
COPY mcp-server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application
COPY mcp-server/ .

ENV HTX_BACKEND_URL=http://htx-backend:8000

EXPOSE 8001

CMD ["python", "-m", "mcp.server", "--transport", "sse", "--host", "0.0.0.0", "--port", "8001", "server:mcp"]
