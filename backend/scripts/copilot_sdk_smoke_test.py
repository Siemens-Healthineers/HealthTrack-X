"""List Copilot models or send a standalone test prompt, without starting the app."""

import argparse
import asyncio
import sys
from tempfile import TemporaryDirectory


DEFAULT_PROMPT = "Was ist 2 + 2? Antworte auf Deutsch in einem kurzen Satz."


async def list_models(timeout: int) -> None:
    from copilot import CopilotClient

    with TemporaryDirectory(prefix="copilot-smoke-test-") as working_directory:
        async with CopilotClient(working_directory=working_directory) as client:
            models = await asyncio.wait_for(client.list_models(), timeout=timeout)
            if not models:
                raise RuntimeError("Copilot returned no available models.")
            id_width = max(len("Model ID"), *(len(model.id) for model in models))
            print(f"{'Model ID':<{id_width}}  Name")
            print(f"{'-' * id_width}  ----")
            for model in sorted(models, key=lambda item: item.id):
                print(f"{model.id:<{id_width}}  {model.name}")
            print("\nUse --model MODEL_ID to send a prompt with a listed model.")


async def run_prompt(prompt: str, model: str | None, timeout: int) -> None:
    from copilot import CopilotClient
    from copilot.session_events import AssistantMessageData

    # Keep repository files and instructions out of this standalone LLM test.
    with TemporaryDirectory(prefix="copilot-smoke-test-") as working_directory:
        async with CopilotClient(working_directory=working_directory) as client:
            async with await client.create_session(
                model=model,
                working_directory=working_directory,
                available_tools=[],
                skip_custom_instructions=True,
                enable_config_discovery=False,
                enable_skills=False,
                enable_file_hooks=False,
                enable_on_demand_instruction_discovery=False,
            ) as session:
                print(f"Model: {model or 'Copilot default'}", flush=True)
                print(f"Prompt: {prompt}", flush=True)
                response = await session.send_and_wait(prompt, timeout=timeout)
                if (
                    response is None
                    or not isinstance(response.data, AssistantMessageData)
                    or not response.data.content.strip()
                ):
                    raise RuntimeError("Copilot returned no assistant text.")
                print(f"\nCopilot:\n{response.data.content}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--list-models",
        action="store_true",
        help="List models offered by your Copilot account without sending a prompt.",
    )
    parser.add_argument("--prompt", default=DEFAULT_PROMPT, help="Text sent to Copilot.")
    parser.add_argument("--model", help="Optional Copilot model ID; otherwise use its default.")
    parser.add_argument(
        "--timeout", type=int, default=60, help="Request timeout in seconds (default: 60)."
    )
    args = parser.parse_args()
    if not args.prompt.strip():
        parser.error("--prompt must not be empty.")
    if args.timeout <= 0:
        parser.error("--timeout must be greater than zero.")
    try:
        if args.list_models:
            asyncio.run(list_models(args.timeout))
        else:
            asyncio.run(run_prompt(args.prompt, args.model, args.timeout))
    except ModuleNotFoundError as exc:
        if exc.name != "copilot":
            raise
        print(
            "Missing GitHub Copilot SDK. Install with:\n"
            "  python -m pip install -r backend\\scripts\\requirements-copilot.txt",
            file=sys.stderr,
        )
        return 1
    except TimeoutError:
        print(f"Copilot did not respond within {args.timeout} seconds.", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Copilot test cancelled.", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
