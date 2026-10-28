"""
GitHub App Service - Automated Repository Creation
Uses existing GitHub App credentials from stored configurations to create
new repositories without requiring users to manually enter config data.

This is the automated repository provisioning path via GitHub App.
"""

import jwt
import time
import httpx
from typing import Optional
from github_config_manager import config_manager


class GitHubAppService:
    """Automated repository creation via GitHub App."""

    def __init__(self):
        self._http_client: httpx.AsyncClient | None = None
        # JWT cache: (app_id, key_hash) -> (jwt_str, expires_at)
        self._jwt_cache: dict[tuple, tuple[str, float]] = {}

    def _get_http_client(self) -> httpx.AsyncClient:
        """Get or create a reusable httpx.AsyncClient."""
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(timeout=30.0)
        return self._http_client

    def _get_app_credentials_from_config(self, source_config_id: Optional[str] = None) -> dict:
        """
        Extract GitHub App credentials from an existing stored configuration.
        
        Args:
            source_config_id: ID of a stored config to use as credential source.
                              If None, uses the first available config with App credentials.
        
        Returns:
            dict with app_id, private_key, installation_id, base_url
        
        Raises:
            ValueError: If no suitable config is found
        """
        configs = config_manager.get_all_configs()
        
        if source_config_id:
            # Use specified config
            cfg = next((c for c in configs if c.get("id") == source_config_id), None)
            if not cfg:
                raise ValueError(f"Configuration '{source_config_id}' not found")
        else:
            # Find first config with GitHub App credentials
            cfg = next(
                (c for c in configs 
                 if c.get("github_app_id") and c.get("github_app_private_key") and c.get("github_app_installation_id")),
                None
            )
        
        if not cfg:
            raise ValueError("No GitHub App configuration found. Please create a manual configuration first.")
        
        if not cfg.get("github_app_id") or not cfg.get("github_app_private_key"):
            raise ValueError(f"Configuration '{cfg.get('name', cfg.get('id'))}' does not have complete GitHub App credentials.")
        
        private_key = cfg.get("github_app_private_key", "").replace('\\n', '\n')
        
        # Determine base URL
        base_url = cfg.get("github_base_url", "")
        if base_url:
            # Ensure it's an API URL
            if not base_url.endswith("/api/v3"):
                api_url = base_url.rstrip("/") + "/api/v3"
            else:
                api_url = base_url.rstrip("/")
        else:
            api_url = "https://api.github.com"
        
        return {
            "app_id": cfg["github_app_id"],
            "private_key": private_key,
            "installation_id": cfg.get("github_app_installation_id"),
            "base_url": api_url,
            "base_url_raw": base_url,
            "source_config_id": cfg.get("id"),
            "source_config_name": cfg.get("name", cfg.get("github_repo", "unknown")),
            "org": cfg.get("github_repo", "").split("/")[0] if cfg.get("github_repo") else "",
        }

    def _generate_jwt(self, app_id: str, private_key: str) -> str:
        """Generate a short-lived JWT for GitHub App authentication (cached)."""
        now = int(time.time())
        cache_key = (app_id, hash(private_key))
        cached = self._jwt_cache.get(cache_key)
        if cached:
            jwt_str, expires_at = cached
            if now < expires_at - 60:  # reuse if >60s remaining
                return jwt_str
        payload = {
            "iat": now - 60,
            "exp": now + (10 * 60),
            "iss": app_id,
        }
        jwt_str = jwt.encode(payload, private_key, algorithm="RS256")
        self._jwt_cache[cache_key] = (jwt_str, now + (10 * 60))
        return jwt_str

    async def _get_installation_token(self, app_id: str, private_key: str, 
                                        installation_id: str, base_url: str) -> str:
        """Get an automatic short-lived installation token (1h validity)."""
        app_jwt = self._generate_jwt(app_id, private_key)
        client = self._get_http_client()
        resp = await client.post(
            f"{base_url}/app/installations/{installation_id}/access_tokens",
            headers={
                "Authorization": f"Bearer {app_jwt}",
                "Accept": "application/vnd.github+json",
            },
        )
        resp.raise_for_status()
        return resp.json()["token"]

    async def get_available_orgs(self, source_config_id: Optional[str] = None) -> list:
        """
        List all organizations where the GitHub App is installed.
        Auto-discovery - no manual configuration needed.
        
        Args:
            source_config_id: Optional config ID to use as credential source
            
        Returns:
            List of installations with org info
        """
        creds = self._get_app_credentials_from_config(source_config_id)
        app_jwt = self._generate_jwt(creds["app_id"], creds["private_key"])
        
        client = self._get_http_client()
        resp = await client.get(
            f"{creds['base_url']}/app/installations",
            headers={
                "Authorization": f"Bearer {app_jwt}",
                "Accept": "application/vnd.github+json",
            },
        )
        resp.raise_for_status()
        installations = resp.json()
        
        return [
            {
                "installation_id": inst["id"],
                "org": inst["account"]["login"],
                "org_avatar": inst["account"].get("avatar_url", ""),
                "org_type": inst["account"].get("type", "Organization"),
                "permissions": inst.get("permissions", {}),
            }
            for inst in installations
        ]

    async def list_org_repos(self, org: str, source_config_id: Optional[str] = None) -> list:
        """
        List existing repositories in an organization.
        
        Args:
            org: Organization name
            source_config_id: Optional config ID to use as credential source
            
        Returns:
            List of repositories
        """
        creds = self._get_app_credentials_from_config(source_config_id)
        token = await self._get_installation_token(
            creds["app_id"], creds["private_key"], 
            creds["installation_id"], creds["base_url"]
        )
        
        headers = {
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github+json",
        }
        
        repos = []
        page = 1
        client = self._get_http_client()
        while True:
            resp = await client.get(
                f"{creds['base_url']}/orgs/{org}/repos",
                headers=headers,
                params={"per_page": 100, "page": page, "sort": "updated"},
            )
            resp.raise_for_status()
            batch = resp.json()
            if not batch:
                break
            repos.extend([
                {
                    "name": r["name"],
                    "full_name": r["full_name"],
                    "description": r.get("description", ""),
                    "private": r["private"],
                    "html_url": r["html_url"],
                    "clone_url": r["clone_url"],
                    "default_branch": r.get("default_branch", "main"),
                    "updated_at": r.get("updated_at"),
                }
                for r in batch
            ])
            if len(batch) < 100:
                break
            page += 1
        
        return repos

    async def create_repo(
        self,
        org: str,
        repo_name: str,
        description: str = "",
        private: bool = True,
        auto_init: bool = True,
        source_config_id: Optional[str] = None,
    ) -> dict:
        """
        Create a new repository automatically - NO manual token needed.
        
        Uses stored GitHub App credentials to create the repo and
        automatically registers it as a new configuration.
        
        Args:
            org: Organization name
            repo_name: Name for the new repository
            description: Repository description
            private: Private repo (default: yes)
            auto_init: Create README.md (default: yes)
            source_config_id: Optional config ID to use as credential source
            
        Returns:
            dict with repo info and new config ID
        """
        creds = self._get_app_credentials_from_config(source_config_id)
        token = await self._get_installation_token(
            creds["app_id"], creds["private_key"],
            creds["installation_id"], creds["base_url"]
        )
        
        headers = {
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github+json",
        }
        
        client = self._get_http_client()
        resp = await client.post(
            f"{creds['base_url']}/orgs/{org}/repos",
            headers=headers,
            json={
                "name": repo_name,
                "description": description,
                "private": private,
                "auto_init": auto_init,
                "has_issues": True,
                "has_projects": False,
            },
        )
        
        if resp.status_code == 422:
            error_data = resp.json()
            errors = error_data.get("errors", [])
            if any("name already exists" in str(e) for e in errors):
                raise ValueError(f"Repository '{org}/{repo_name}' already exists")
            raise ValueError(f"Validation error: {error_data.get('message', str(errors))}")
        
        resp.raise_for_status()
        repo_data = resp.json()
        
        # Auto-register the new repo as a configuration.
        new_config = {
            "name": f"{repo_name} (auto-created)",
            "auth_method": "app",
            "github_app_id": creds["app_id"],
            "github_app_private_key": creds["private_key"],
            "github_app_installation_id": creds["installation_id"],
            "github_repo": f"{org}/{repo_name}",
            "github_branch": repo_data.get("default_branch", "main"),
            "github_base_url": creds["base_url_raw"],
        }
        
        saved_config = config_manager.add_config(new_config)
        
        return {
            "repo": {
                "name": repo_data["name"],
                "full_name": repo_data["full_name"],
                "html_url": repo_data["html_url"],
                "clone_url": repo_data["clone_url"],
                "private": repo_data["private"],
                "default_branch": repo_data.get("default_branch", "main"),
                "description": repo_data.get("description", ""),
            },
            "config": {
                "id": saved_config["id"],
                "name": saved_config.get("name"),
                "github_repo": saved_config.get("github_repo"),
            },
            "method": "github-app-automated",
        }

    async def create_repo_from_existing(
        self,
        org: str,
        repo_name: str,
        source_config_id: Optional[str] = None,
    ) -> dict:
        """
        Register an existing repository as a new configuration.
        
        Instead of creating a new repo, this connects to an existing one
        using the stored GitHub App credentials.
        
        Args:
            org: Organization name
            repo_name: Existing repository name
            source_config_id: Optional config ID to use as credential source
            
        Returns:
            dict with repo info and new config ID
        """
        creds = self._get_app_credentials_from_config(source_config_id)
        token = await self._get_installation_token(
            creds["app_id"], creds["private_key"],
            creds["installation_id"], creds["base_url"]
        )
        
        headers = {
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github+json",
        }
        
        # Verify the repo exists
        client = self._get_http_client()
        resp = await client.get(
            f"{creds['base_url']}/repos/{org}/{repo_name}",
            headers=headers,
        )
        if resp.status_code == 404:
            raise ValueError(f"Repository '{org}/{repo_name}' not found")
        resp.raise_for_status()
        repo_data = resp.json()
        
        # Auto-register as configuration
        new_config = {
            "name": f"{repo_name} (auto-connected)",
            "auth_method": "app",
            "github_app_id": creds["app_id"],
            "github_app_private_key": creds["private_key"],
            "github_app_installation_id": creds["installation_id"],
            "github_repo": f"{org}/{repo_name}",
            "github_branch": repo_data.get("default_branch", "main"),
            "github_base_url": creds["base_url_raw"],
        }
        
        saved_config = config_manager.add_config(new_config)
        
        return {
            "repo": {
                "name": repo_data["name"],
                "full_name": repo_data["full_name"],
                "html_url": repo_data["html_url"],
                "clone_url": repo_data["clone_url"],
                "private": repo_data["private"],
                "default_branch": repo_data.get("default_branch", "main"),
            },
            "config": {
                "id": saved_config["id"],
                "name": saved_config.get("name"),
                "github_repo": saved_config.get("github_repo"),
            },
            "method": "github-app-automated",
        }


# Global service instance
github_app_service = GitHubAppService()
