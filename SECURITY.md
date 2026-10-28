# Security Policy

## Reporting a Vulnerability

Please do not report security vulnerabilities through public GitHub issues.

For the public repository, use GitHub's private vulnerability reporting if enabled. If that is not available, contact the project maintainers through the designated security contact configured for the public repository.

Maintainers must enable and verify a private reporting channel before publication.
Do not post vulnerability details in public issues to request a contact.

When reporting, include as much detail as possible:

- affected component or endpoint
- steps to reproduce
- expected and observed behavior
- impact assessment
- relevant logs or screenshots with secrets removed

## Response Expectations

Maintainers will acknowledge valid reports as soon as practical, triage severity, and coordinate a fix or mitigation before public disclosure when appropriate.

## Supported Versions

Security support applies to the current main branch of the public repository unless release branches are introduced later.

## Secret Handling

Never commit real credentials, private keys, customer data, internal hostnames, or deployment-only configuration. Use placeholders in the repository and provide real values through GitHub Secrets, private overlays, Azure Key Vault, or another secret manager.
