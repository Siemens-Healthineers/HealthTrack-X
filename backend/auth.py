from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import jwt
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from jwt import InvalidTokenError, PyJWKClient, PyJWKClientError


TRUE_VALUES = {"1", "true", "yes", "on"}

DEFAULT_PUBLIC_PATHS = (
    "/",
    "/api/auth/status",
    "/api/system-status",
    "/docs*",
    "/openapi.json",
    "/redoc*",
)


@dataclass(frozen=True)
class AuthSettings:
    enabled: bool
    issuer: str
    audience: str
    client_id: str
    jwks_url: str
    public_paths: tuple[str, ...]


@dataclass(frozen=True)
class AuthUser:
    sub: str
    username: str | None
    email: str | None
    roles: tuple[str, ...]
    claims: dict[str, Any]


_jwks_client: PyJWKClient | None = None
_jwks_url: str | None = None


def _csv_env(name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    value = os.getenv(name)
    if not value:
        return default
    return tuple(item.strip() for item in value.split(",") if item.strip())


def get_auth_settings() -> AuthSettings:
    issuer = os.getenv("KEYCLOAK_ISSUER", "").rstrip("/")
    return AuthSettings(
        enabled=os.getenv("AUTH_ENABLED", "false").lower() in TRUE_VALUES,
        issuer=issuer,
        audience=os.getenv("KEYCLOAK_AUDIENCE", ""),
        client_id=os.getenv("KEYCLOAK_CLIENT_ID", ""),
        jwks_url=os.getenv("KEYCLOAK_JWKS_URL", ""),
        public_paths=_csv_env("AUTH_PUBLIC_PATHS", DEFAULT_PUBLIC_PATHS),
    )


def auth_status_payload() -> dict[str, Any]:
    settings = get_auth_settings()
    return {
        "enabled": settings.enabled,
        "provider": "keycloak",
        "issuer": settings.issuer or None,
        "issuer_configured": bool(settings.issuer),
        "audience_configured": bool(settings.audience),
        "client_id": settings.client_id or None,
        "public_paths": list(settings.public_paths),
    }


def _path_matches(path: str, pattern: str) -> bool:
    if pattern.endswith("*"):
        return path.startswith(pattern[:-1])
    return path == pattern


def _is_public_path(path: str, public_paths: tuple[str, ...]) -> bool:
    return any(_path_matches(path, pattern) for pattern in public_paths)


def _get_jwks_client(settings: AuthSettings) -> PyJWKClient:
    global _jwks_client, _jwks_url
    jwks_url = settings.jwks_url or (
        f"{settings.issuer}/protocol/openid-connect/certs" if settings.issuer else ""
    )
    if not jwks_url:
        raise RuntimeError("AUTH_ENABLED=true but KEYCLOAK_ISSUER or KEYCLOAK_JWKS_URL is missing")
    if _jwks_client is None or _jwks_url != jwks_url:
        _jwks_client = PyJWKClient(jwks_url)
        _jwks_url = jwks_url
    return _jwks_client


def _extract_roles(claims: dict[str, Any], client_id: str) -> tuple[str, ...]:
    roles = set(claims.get("realm_access", {}).get("roles", []))
    if client_id:
        roles.update(claims.get("resource_access", {}).get(client_id, {}).get("roles", []))
    return tuple(sorted(role for role in roles if isinstance(role, str)))


def validate_bearer_token(token: str, settings: AuthSettings | None = None) -> AuthUser:
    settings = settings or get_auth_settings()
    client = _get_jwks_client(settings)
    signing_key = client.get_signing_key_from_jwt(token)
    decode_kwargs: dict[str, Any] = {
        "algorithms": ["RS256"],
        "options": {"verify_aud": bool(settings.audience)},
    }
    if settings.issuer:
        decode_kwargs["issuer"] = settings.issuer
    if settings.audience:
        decode_kwargs["audience"] = settings.audience
    claims = jwt.decode(token, signing_key.key, **decode_kwargs)
    return AuthUser(
        sub=str(claims.get("sub", "")),
        username=claims.get("preferred_username"),
        email=claims.get("email"),
        roles=_extract_roles(claims, settings.client_id),
        claims=claims,
    )


def current_user(request: Request) -> AuthUser:
    user = getattr(request.state, "user", None)
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


def install_auth_middleware(app: FastAPI) -> None:
    @app.middleware("http")
    async def keycloak_auth_middleware(request: Request, call_next):
        settings = get_auth_settings()
        path = request.url.path

        if request.method == "OPTIONS" or not path.startswith("/api/") or _is_public_path(path, settings.public_paths):
            return await call_next(request)

        if not settings.enabled:
            return await call_next(request)

        auth_header = request.headers.get("Authorization", "")
        scheme, _, token = auth_header.partition(" ")
        if scheme.lower() != "bearer" or not token:
            return JSONResponse({"detail": "Missing bearer token"}, status_code=401)

        try:
            request.state.user = validate_bearer_token(token, settings)
        except RuntimeError as exc:
            return JSONResponse({"detail": str(exc)}, status_code=503)
        except (InvalidTokenError, PyJWKClientError):
            return JSONResponse({"detail": "Invalid bearer token"}, status_code=401)

        # Enforce that the user has been approved (has viewer or admin role)
        user: AuthUser = request.state.user
        approved_roles = {"viewer", "admin", "editor", "service"}
        if not approved_roles.intersection(user.roles):
            return JSONResponse(
                {"detail": "Account pending approval", "code": "approval_pending"},
                status_code=403,
            )

        return await call_next(request)