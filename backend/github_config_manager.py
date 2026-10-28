"""GitHub Configuration Manager with Fernet encryption."""

import json
import os
from pathlib import Path
from typing import Dict, Final, Optional, List
from cryptography.fernet import Fernet
import base64
import yaml
import uuid
from datetime import datetime

# Sensitive fields that need encryption/decryption (allocated once)
_SENSITIVE_FIELDS: Final[tuple[str, ...]] = ("github_token", "github_app_private_key")


class GitHubConfigManager:
    """Manages GitHub configuration with encryption for sensitive data"""
    
    CONFIG_FILE = "github_config.json"
    CONFIG_YAML_FILE = "github_config.yaml"
    KEY_FILE = ".github_config.key"
    
    def __init__(self, config_dir: str = "config"):
        """Initialize config manager with dedicated config directory"""
        # Ensure config directory is relative to backend folder
        if not os.path.isabs(config_dir):
            backend_dir = Path(__file__).parent
            self.config_dir = backend_dir / config_dir
        else:
            self.config_dir = Path(config_dir)
        
        # Create config directory structure if it doesn't exist
        self.config_dir.mkdir(exist_ok=True, parents=True)
        self.yaml_dir = self.config_dir / "yaml"
        self.yaml_dir.mkdir(exist_ok=True, parents=True)
        
        self.config_path = self.config_dir / self.CONFIG_FILE
        self.config_yaml_path = self.yaml_dir / self.CONFIG_YAML_FILE
        self.key_path = self.config_dir / self.KEY_FILE
        
        # ── Caches (avoid repeated disk I/O and re-decryption) ──
        self._cipher: Optional[Fernet] = None
        self._raw_cache: Optional[Dict] = None
        self._raw_cache_mtime: float = 0.0
        self._decrypted_cache: Optional[List[Dict]] = None
        self._decrypted_cache_mtime: float = 0.0
        
        # Migrate old config files from root if they exist
        self._migrate_old_config()
        
        self._ensure_key()
    
    def _migrate_old_config(self):
        """Migrate old configuration files from root directory to config directory"""
        backend_dir = Path(__file__).parent
        old_config_path = backend_dir / self.CONFIG_FILE
        old_key_path = backend_dir / self.KEY_FILE
        old_yaml_path = self.config_dir / self.CONFIG_YAML_FILE
        
        # Only migrate if old files exist and new ones don't
        if old_config_path.exists() and not self.config_path.exists():
            try:
                # Move config file
                old_config_path.rename(self.config_path)
                print(f"OK - Migrated {self.CONFIG_FILE} to config directory")
            except Exception as e:
                print(f"Warning: Could not migrate {self.CONFIG_FILE}: {e}")
        
        if old_key_path.exists() and not self.key_path.exists():
            try:
                # Move key file
                old_key_path.rename(self.key_path)
                print(f"OK - Migrated {self.KEY_FILE} to config directory")
            except Exception as e:
                print(f"Warning: Could not migrate {self.KEY_FILE}: {e}")
        
        # Migrate YAML from config/ to config/yaml/
        if old_yaml_path.exists() and not self.config_yaml_path.exists():
            try:
                old_yaml_path.rename(self.config_yaml_path)
                print(f"OK - Migrated {self.CONFIG_YAML_FILE} to config/yaml directory")
            except Exception as e:
                print(f"Warning: Could not migrate {self.CONFIG_YAML_FILE}: {e}")

    
    def _ensure_key(self):
        """Ensure encryption key exists, create if not"""
        if not self.key_path.exists():
            key = Fernet.generate_key()
            self.key_path.write_bytes(key)
            # Make key file read-only on Unix systems
            try:
                os.chmod(self.key_path, 0o600)
            except:
                pass  # Windows doesn't support chmod the same way
    
    def _get_cipher(self) -> Fernet:
        """Get Fernet cipher for encryption/decryption (cached)."""
        if self._cipher is None:
            key = self.key_path.read_bytes()
            self._cipher = Fernet(key)
        return self._cipher
    
    def _encrypt(self, data: str) -> str:
        """Encrypt sensitive data"""
        cipher = self._get_cipher()
        encrypted = cipher.encrypt(data.encode())
        return base64.b64encode(encrypted).decode()
    
    def _decrypt(self, encrypted_data: str) -> str:
        """Decrypt sensitive data"""
        cipher = self._get_cipher()
        decoded = base64.b64decode(encrypted_data.encode())
        return cipher.decrypt(decoded).decode()
    
    def save_config(self, config: Dict) -> None:
        """
        Save GitHub configuration with encryption for sensitive fields (Legacy - Single Config)
        This method is kept for backward compatibility. Use add_config() for multi-config support.
        
        Args:
            config: Dictionary with GitHub configuration
                {
                    "github_token": Optional[str],
                    "github_app_id": Optional[str],
                    "github_app_private_key": Optional[str],
                    "github_app_installation_id": Optional[str],
                    "github_repo": str,
                    "github_branch": str,
                    "github_base_url": Optional[str]
                }
        """
        # Check if we have a multi-config structure
        existing_data = self._load_raw_config()
        
        if existing_data and "configs" in existing_data:
            # We have multi-config, add this as a new config or update existing
            config_id = config.get("id")
            if config_id:
                self.update_config(config_id, config)
            else:
                self.add_config(config)
        else:
            # Legacy single config mode
            encrypted_config = config.copy()
            
            # Encrypt sensitive fields
            for field in _SENSITIVE_FIELDS:
                if field in encrypted_config and encrypted_config[field]:
                    encrypted_config[field] = self._encrypt(encrypted_config[field])
                    encrypted_config[f"{field}_encrypted"] = True
            
            self.config_path.write_text(json.dumps(encrypted_config, indent=2))
            
            # Make config file read-only
            try:
                os.chmod(self.config_path, 0o600)
            except:
                pass
    
    def _load_raw_config(self) -> Optional[Dict]:
        """Load raw configuration file without decryption (cached, invalidated on mtime change)."""
        if not self.config_path.exists():
            self._raw_cache = None
            return None
        mtime = self.config_path.stat().st_mtime
        if self._raw_cache is not None and mtime == self._raw_cache_mtime:
            return self._raw_cache
        data = json.loads(self.config_path.read_text())
        self._raw_cache = data
        self._raw_cache_mtime = mtime
        return data
    
    def _save_raw_config(self, data: Dict) -> None:
        """Save raw configuration data to file and invalidate caches."""
        self.config_path.write_text(json.dumps(data, indent=2))
        # Invalidate all caches
        self._raw_cache = None
        self._decrypted_cache = None
        try:
            os.chmod(self.config_path, 0o600)
        except:
            pass
    
    def _encrypt_config(self, config: Dict) -> Dict:
        """Encrypt sensitive fields in a config"""
        encrypted = config.copy()
        for field in _SENSITIVE_FIELDS:
            if field in encrypted and encrypted[field]:
                encrypted[field] = self._encrypt(encrypted[field])
                encrypted[f"{field}_encrypted"] = True
        return encrypted
    
    def _decrypt_config(self, config: Dict) -> Dict:
        """Decrypt sensitive fields in a config"""
        decrypted = config.copy()
        for field in _SENSITIVE_FIELDS:
            if decrypted.get(f"{field}_encrypted") and decrypted.get(field):
                try:
                    decrypted[field] = self._decrypt(decrypted[field])
                    del decrypted[f"{field}_encrypted"]
                except Exception as e:
                    print(f"ERROR: Failed to decrypt {field} for config {decrypted.get('name', decrypted.get('id', 'unknown'))}: {e}")
                    print(f"  This may indicate the encryption key has changed or the config was corrupted.")
                    print(f"  Config ID: {decrypted.get('id')}")
                    decrypted[field] = None
        return decrypted
    
    def get_all_configs(self) -> List[Dict]:
        """Get all GitHub configurations with decrypted sensitive fields (cached)."""
        data = self._load_raw_config()
        if not data:
            return []
        
        # Return cached decrypted configs if raw hasn't changed
        mtime = self._raw_cache_mtime
        if self._decrypted_cache is not None and mtime == self._decrypted_cache_mtime:
            return self._decrypted_cache
        
        if "configs" in data:
            configs = [self._decrypt_config(c) for c in data["configs"]]
        else:
            configs = [self._decrypt_config(data)]
        
        self._decrypted_cache = configs
        self._decrypted_cache_mtime = mtime
        return configs
    
    def get_config_by_id(self, config_id: str) -> Optional[Dict]:
        """Get a specific configuration by ID (decrypts only the match)."""
        data = self._load_raw_config()
        if not data:
            return None
        if "configs" in data:
            for config in data["configs"]:
                if config.get("id") == config_id:
                    return self._decrypt_config(config)
            return None
        # Legacy single config
        decrypted = self._decrypt_config(data)
        return decrypted if decrypted.get("id") == config_id else None
    
    def add_config(self, config: Dict) -> Dict:
        """
        Add a new GitHub configuration
        
        Args:
            config: Configuration dictionary (without ID)
            
        Returns:
            The saved configuration with generated ID and metadata
        """
        data = self._load_raw_config()
        
        # Initialize multi-config structure if needed
        if not data or "configs" not in data:
            # Migrate from legacy single config
            old_config = None
            if data:
                old_config = data
            data = {"configs": []}
            
            # Keep old config if it exists
            if old_config:
                old_config["id"] = str(uuid.uuid4())
                old_config["name"] = old_config.get("github_repo", "Legacy Config")
                old_config["created_at"] = datetime.now().isoformat()
                old_config["updated_at"] = datetime. now().isoformat()
                data["configs"].append(self._encrypt_config(old_config))
        
        # Generate new config with metadata
        new_config = config.copy()
        new_config["id"] = str(uuid.uuid4())
        if "name" not in new_config:
            new_config["name"] = new_config.get("github_repo", "Unnamed Config")
        new_config["created_at"] = datetime.now().isoformat()
        new_config["updated_at"] = datetime.now().isoformat()
        
        # Encrypt and save
        encrypted = self._encrypt_config(new_config)
        data["configs"].append(encrypted)
        self._save_raw_config(data)
        
        return new_config
    
    def update_config(self, config_id: str, updates: Dict) -> Optional[Dict]:
        """
        Update an existing configuration
        
        Args:
            config_id: Configuration ID to update
            updates: Dictionary with fields to update
            
        Returns:
            Updated configuration or None if not found
        """
        data = self._load_raw_config()
        if not data or "configs" not in data:
            return None
        
        for i, config in enumerate(data["configs"]):
            if config.get("id") == config_id:
                # Decrypt, update, re-encrypt
                decrypted = self._decrypt_config(config)
                
                # Don't update sensitive fields if they contain placeholder values
                # This prevents accidentally overwriting real credentials with masked values
                if "github_app_private_key" in updates:
                    if updates["github_app_private_key"] == "[PEM KEY CONFIGURED]":
                        # Keep existing key, don't overwrite with placeholder
                        del updates["github_app_private_key"]
                
                if "github_token" in updates:
                    if updates["github_token"] and updates["github_token"].startswith("***"):
                        # Keep existing token, don't overwrite with masked value
                        del updates["github_token"]
                
                decrypted.update(updates)
                decrypted["updated_at"] = datetime.now().isoformat()
                data["configs"][i] = self._encrypt_config(decrypted)
                self._save_raw_config(data)
                return decrypted
        
        return None
    
    def delete_config_by_id(self, config_id: str) -> bool:
        """
        Delete a specific configuration by ID
        
        Args:
            config_id: Configuration ID to delete
            
        Returns:
            True if deleted, False if not found
        """
        data = self._load_raw_config()
        if not data or "configs" not in data:
            return False
        
        original_count = len(data["configs"])
        data["configs"] = [c for c in data["configs"] if c.get("id") != config_id]
        
        if len(data["configs"]) < original_count:
            self._save_raw_config(data)
            return True
        
        return False
    
    def load_config(self) -> Optional[Dict]:
        """
        Load GitHub configuration and decrypt sensitive fields (Legacy - Returns first/only config)
        For multi-config support, use get_all_configs() or get_config_by_id()
        
        Returns:
            Dictionary with decrypted configuration or None if not found
        """
        configs = self.get_all_configs()
        if configs:
            return configs[0]  # Return first config for backward compatibility
        return None
    
    def config_exists(self) -> bool:
        """Check if configuration file exists"""
        return self.config_path.exists()
    
    def delete_config(self) -> None:
        """Delete entire configuration file (all configs - for reset/clear operations)"""
        if self.config_path.exists():
            self.config_path.unlink()
        if self.config_yaml_path.exists():
            self.config_yaml_path.unlink()
    
    def get_all_configs_for_display(self) -> List[Dict]:
        """
        Get all configurations with sensitive data masked for display purposes
        
        Returns:
            List of configurations with masked sensitive fields
        """
        configs = self.get_all_configs()
        display_configs = []
        
        for config in configs:
            display_config = config.copy()
            
            # Mask sensitive fields
            if display_config.get("github_token"):
                token = display_config["github_token"]
                display_config["github_token"] = "***" + token[-4:] if len(token) > 4 else "****"
            
            if display_config.get("github_app_private_key"):
                display_config["github_app_private_key"] = "[PEM KEY CONFIGURED]"
            
            display_configs.append(display_config)
        
        return display_configs
    
    def get_config_for_display(self) -> Optional[Dict]:
        """
        Get configuration with sensitive data masked for display purposes (Legacy - first config)
        
        Returns:
            Configuration with masked sensitive fields
        """
        configs = self.get_all_configs_for_display()
        if configs:
            return configs[0]
        return None
    
    def export_to_yaml(self) -> bool:
        """
        Export configuration to human-readable YAML format
        Sensitive data is marked as [ENCRYPTED] for security
        
        Returns:
            True if export was successful, False otherwise
        """
        config = self.load_config()
        if not config:
            return False
        
        # Create human-readable version
        yaml_config = {
            "# GitHub Configuration": "Edit this file and reload to update settings",
            "github": {
                "repository": config.get("github_repo", ""),
                "branch": config.get("github_branch", "main"),
                "base_url": config.get("github_base_url", "") or "github.com",
            },
            "authentication": {
                "method": config.get("auth_method", "app"),
            }
        }
        
        # Add auth-specific fields
        if config.get("auth_method") == "token":
            yaml_config["authentication"]["token"] = "[ENCRYPTED - Configure via UI]"
        else:  # app
            yaml_config["authentication"]["app_id"] = config.get("github_app_id", "")
            yaml_config["authentication"]["installation_id"] = config.get("github_app_installation_id", "")
            yaml_config["authentication"]["private_key"] = "[ENCRYPTED - Configure via UI]"
        
        # Write YAML with custom formatting
        yaml_content = "# ============================================\n"
        yaml_content += "# GitHub Configuration\n"
        yaml_content += "# ============================================\n"
        yaml_content += "# This file is auto-generated from the UI configuration.\n"
        yaml_content += "# You can edit values here, but sensitive data (tokens, keys)\n"
        yaml_content += "# must be configured through the Settings UI.\n"
        yaml_content += "# ============================================\n\n"
        
        yaml_content += yaml.dump(
            {k: v for k, v in yaml_config.items() if not k.startswith("#")},
            default_flow_style=False,
            sort_keys=False,
            allow_unicode=True
        )
        
        self.config_yaml_path.write_text(yaml_content, encoding='utf-8')
        return True
    
    def import_from_yaml(self) -> Optional[Dict]:
        """
        Import configuration from YAML file (if it exists)
        Only imports non-sensitive fields; sensitive data must be set via UI
        
        Returns:
            Configuration dictionary or None if file doesn't exist
        """
        if not self.config_yaml_path.exists():
            return None
        
        try:
            yaml_data = yaml.safe_load(self.config_yaml_path.read_text(encoding='utf-8'))
            
            if not yaml_data:
                return None
            
            # Map YAML structure back to config format
            config = {
                "github_repo": yaml_data.get("github", {}).get("repository", ""),
                "github_branch": yaml_data.get("github", {}).get("branch", "main"),
                "github_base_url": yaml_data.get("github", {}).get("base_url", ""),
                "auth_method": yaml_data.get("authentication", {}).get("method", "app"),
            }
            
            # Add app-specific fields if present
            if config["auth_method"] == "app":
                config["github_app_id"] = yaml_data.get("authentication", {}).get("app_id", "")
                config["github_app_installation_id"] = yaml_data.get("authentication", {}).get("installation_id", "")
            
            return config
            
        except Exception as e:
            print(f"Warning: Failed to import from YAML: {e}")
            return None
    
    def save_config_with_yaml(self, config: Dict) -> None:
        """
        Save configuration in both JSON (encrypted) and YAML (readable) formats
        
        Args:
            config: Configuration dictionary
        """
        # Save encrypted JSON
        self.save_config(config)
        
        # Export to YAML for human readability
        self.export_to_yaml()


# Global instance with dedicated config directory
config_manager = GitHubConfigManager(config_dir="config")
