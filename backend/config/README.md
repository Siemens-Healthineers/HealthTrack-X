# Configuration Directory

This directory stores persistent configuration data for the HealthTrack-X backend.
Runtime caches are stored separately in `../cache/`.

## Directory Structure

```
config/
├── env/                          # Environment variables
│   └── .env                      # Application secrets (ignored by git)
│                                 # Template: see the repository-root .env.example
│
├── yaml/                         # Human-readable configuration
│   ├── github_config.yaml        # Auto-generated YAML (ignored by git)
│   └── github_config.yaml.template  # Template (committed)
│

├── github_config.json            # Encrypted configuration (ignored by git)
├── .github_config.key            # Encryption key (ignored by git)
├── .gitignore                    # Git ignore rules
└── README.md                     # This file

cache/                            # Runtime caches (sibling of config/)
├── repo_graph_cache.json         # Cached repository graph
└── repo_metadata_cache.json      # Cached repo metadata
```

## Stored Files

### Environment Variables (`env/`)
- `.env` - Application environment variables and secrets
  - GitHub authentication credentials (Token or App)
  - Repository settings (repo, branch, base URL)
  - NATS server URL
  - Application settings
- The committed template lives at the repository root: `.env.example`

### GitHub Configuration
- `github_config.json` - GitHub repository settings and authentication configuration
  - Repository details (owner/repo, branch)
  - Authentication method (token or GitHub App)
  - App credentials (App ID, Installation ID)
  - Encrypted sensitive data (tokens, private keys)
  - **Primary format** - Used by application

- `yaml/github_config.yaml` - Human-readable version of GitHub configuration
  - Auto-generated when saving via Settings UI
  - Contains same data as JSON but formatted for easy reading/editing
  - Sensitive data shown as `[ENCRYPTED]` placeholders
  - **For reference and manual review** - Changes here won't update encrypted values

- `.github_config.key` - Encryption key for sensitive data
  - Auto-generated on first use
  - Used to encrypt/decrypt GitHub tokens and private keys
  - **CRITICAL**: Do not delete or modify - existing configs cannot be decrypted without this key

## YAML Configuration Format

The YAML file provides a cleaner, more readable view of your GitHub configuration:

```yaml
github:
  repository: owner/repository-name
  branch: main
  base_url: github.com

authentication:
  method: app
  app_id: "123456"
  installation_id: "12345678"
  private_key: "[ENCRYPTED - Configure via UI]"
```

**Note:** Sensitive values (tokens, private keys) must still be configured through the Settings UI.
The YAML file is for viewing and editing non-sensitive settings like repository name and branch.

## Security Notes

⚠️ **Localhost Development Only**
- This storage method is designed for local development environments
- Sensitive data is encrypted using Fernet (symmetric encryption)
- Files are automatically set to read-only (Unix: chmod 600)

🔐 **Production Deployment**
- For production use, migrate to secure secret management:
  - Azure Key Vault
  - AWS Secrets Manager
  - HashiCorp Vault
  - Kubernetes Secrets

## File Persistence

All files in this directory are:
- ✅ **Persistent across application restarts**
- ✅ **Ignored by Git** (via .gitignore)
- ✅ **Encrypted for sensitive fields** (github_config.json)
- ⚠️ **Machine-specific** (encryption key is unique per installation)

## Automatic Migration

The application automatically migrates configuration files to the organized structure on first startup:

**Phase 1: Root → config/**
- `.env` → `config/env/.env`
- `github_config.json` → `config/github_config.json`  
- `.github_config.key` → `config/.github_config.key`

**Phase 2: config/ → subdirectories**
- `config/.env` → `config/env/.env`
- `config/github_config.yaml` → `config/yaml/github_config.yaml`

This ensures all sensitive configuration is centralized and organized.

## Initial Setup

For the Kubernetes-based local setup, start the app first and configure GitHub repositories through **Settings -> GitHub**. The backend stores the encrypted configuration in this directory and persists it through the backend PVC.

For the supplementary Docker Compose/manual backend path:

1. Copy the repository-root `.env.example` to `.env` (or to `backend/config/env/.env`)
2. Fill in your GitHub credentials and settings
3. Start the application - it will auto-migrate existing files if needed
4. (Optional) Configure GitHub settings via Settings UI
5. YAML configuration will be auto-generated in `yaml/` directory

## Backup Recommendations

If you need to migrate settings to another machine:
1. Export configuration via Settings UI
2. Save the unencrypted values securely
3. Re-import on the new machine
4. **Do not copy** `github_config.json` and `.github_config.key` together - they are machine-bound

## Troubleshooting

### Configuration Not Loading
- Check file permissions (should be 600 on Unix)
- Verify `.github_config.key` exists
- Check `github_config.json` format (valid JSON)

### Decryption Errors
- Key file may have been deleted or corrupted
- Delete both files and reconfigure via Settings UI

### Reset Configuration
Option 1: Via UI - Use "Delete Configuration" button in Settings  
Option 2: Manual - Delete `github_config.json` (key file can remain)

## Trademarks

"Asset Administration Shell" (AAS) and the AAS logo are trademarks of the
Industrial Digital Twin Association (IDTA). They are referenced in this project
for identification and interoperability purposes only.
