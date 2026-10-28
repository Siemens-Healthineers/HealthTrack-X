# Backend Utility Scripts

Utility scripts for debugging, testing, and maintenance.
Run from the `backend` directory: `python scripts/script_name.py`

> **Note:** The background worker is integrated into `main.py` as an asyncio task
> (no separate `worker.py`). The NATS utilities below use the current `JOBS` stream
> and `jobs.pending` subject.

## Script Categories

### 🔍 Debugging & Testing

- **test_github_connection.py** - Test GitHub API connection (PAT + App auth)
- **test_aas.py** - Test Asset Administration Shell creation
- **debug_nats.py** - Debug NATS stream, consumer status, and test message fetch
- **test_nats.py** - Test NATS JetStream publish/subscribe
- **copilot_sdk_smoke_test.py** - Standalone GitHub Copilot SDK prompt, without VS Code or the app

### Standalone Copilot SDK smoke test

Requires Python 3.11+ and a GitHub account with Copilot access enabled by its
subscription and organization policy. VS Code does not need to be running.
The SDK starts its own Copilot runtime; its first start may download that runtime.

Run these PowerShell commands from the **repository root** in a regular terminal.
The separate virtual environment keeps this optional SDK out of the app dependencies:

```powershell
python -m venv .venv-copilot
.\.venv-copilot\Scripts\python.exe -m pip install -r backend\scripts\requirements-copilot.txt
.\.venv-copilot\Scripts\python.exe backend\scripts\copilot_sdk_smoke_test.py
.\.venv-copilot\Scripts\python.exe backend\scripts\copilot_sdk_smoke_test.py --prompt "Was ist eine Stueckliste? Antworte in einem Satz."
```

Authenticate beforehand using the standalone GitHub Copilot CLI (`copilot`, then
follow its sign-in instructions), or provide a supported token via
`COPILOT_GITHUB_TOKEN` in the terminal environment. A VS Code Copilot login alone
does not establish standalone CLI authentication. A fine-grained PAT needs the
`Copilot Requests` permission; classic PATs are not supported. Do not put tokens
into the script or commit them. See the
[SDK authentication documentation](https://github.com/github/copilot-sdk/blob/main/docs/auth/authenticate.md).
The script does not load the backend's `.env` file.

Optional arguments: `--model MODEL_ID` selects a model available to your account;
`--timeout 120` changes the response timeout (default: 60 seconds).
Use `--list-models` to query the current account's model catalog and print model IDs
and names without creating a chat session or sending a prompt. The request uses the
same authentication as the prompt test; model access remains subject to account and
organization policies. The timeout also applies to this catalog request.

If your terminal and virtual environment are already in `backend\scripts`, run:

```powershell
.\.venv-copilot\Scripts\python.exe .\copilot_sdk_smoke_test.py --list-models
.\.venv-copilot\Scripts\python.exe .\copilot_sdk_smoke_test.py --model MODEL_ID
```

The default prompt asks for `2 + 2` in a short German sentence.
Only the supplied prompt is sent as user input: the test runs in an empty temporary
working directory, with tools, skills, hooks, and configuration/instruction
discovery disabled. Client and session are closed after the response.
Non-empty assistant text is printed to the terminal; missing text, SDK/auth/runtime
errors, and timeouts result in a nonzero exit code. Requests may consume your
Copilot usage allowance. No application services are started or imported.

### 🛠️ NATS Management

> These scripts change or delete queue state. Verify `NATS_URL`, the stream and
> the consumer before running them outside a disposable development environment.

- **recreate_stream_fresh.py** - Delete and recreate the stream from scratch
- **clear_queue.py** - Drain pending messages from the queue
- **fix_consumer.py** - Delete a stuck consumer so it can be recreated

### 🔧 Utilities

- **convert_key.py** - Convert PEM private key to .env format
- **reset_app.py** - Reset app state via API (cache and aggregation; changes application state)

## Common Use Cases

```bash
python scripts/test_github_connection.py   # Test GitHub auth
python scripts/debug_nats.py              # NATS stream/consumer diagnostics

# Destructive maintenance — verify the target environment first
python scripts/recreate_stream_fresh.py    # Reset NATS stream
python scripts/clear_queue.py              # Drain pending jobs
python scripts/reset_app.py                # Reset app state via HTX_BACKEND_URL
```

> These scripts are utilities only — they are not imported by the main application.
> The former private demo-repository push/check/clear scripts were removed because
> they depended on fixed configuration IDs and deleted fixtures.

## Trademarks

"Asset Administration Shell" (AAS) and the AAS logo are trademarks of the
Industrial Digital Twin Association (IDTA). They are referenced in this project
for identification and interoperability purposes only.
