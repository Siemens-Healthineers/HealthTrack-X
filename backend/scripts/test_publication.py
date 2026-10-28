"""Exercise actual handlers without importing startup code or private configuration."""

import ast
import json
import os
import re
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock


class HandlerError(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        super().__init__(detail)


class PublicationTests(unittest.IsolatedAsyncioTestCase):
    def test_public_tree_excludes_private_data_and_known_identifiers(self):
        root = Path(__file__).resolve().parents[2]
        result = subprocess.run(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
            cwd=root, check=True, stdout=subprocess.PIPE,
        )
        identifiers = re.compile(
            r"htx" + r"-demo-data\d|"
            r"devx" + r"collabcr|"
            r"shift-" + r"playgrounds-ppoc|"
            r"siemens-" + r"healthineers\.com|"
            r"shs-qt-" + r"product-quality|"
            r"htx-backend-" + r"secret|"
            r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
            re.IGNORECASE,
        )
        runtime_files = re.compile(
            r"(^|/)(cache|logs|node_modules|\.venv)/|"
            r"(^|/)(github_config\.(json|yaml)|\.github_config\.key)$|"
            r"\.(pem|key|p12|pfx|prt|step|stp)$|"
            r"(^|/)(\.env[^/]*|[^/]+\.env)$|"
            r"^oss-readiness/|^OSS-READINESS-ROADMAP\.md$",
            re.IGNORECASE,
        )
        text_extensions = {".md", ".py", ".ts", ".tsx", ".json", ".yaml", ".yml", ".html", ".ps1", ".bat", ".example", ".template"}
        for relative in result.stdout.decode("utf-8").split("\0"):
            if not relative:
                continue
            path = root / relative
            if not path.is_file():
                continue
            with self.subTest(path=relative):
                if not relative.endswith(".example") and path.name != ".gitignore":
                    self.assertIsNone(runtime_files.search(relative), f"Private runtime artifact: {relative}")
                if path.suffix in text_extensions:
                    self.assertIsNone(identifiers.search(path.read_text(encoding="utf-8-sig")), f"Private identifier or key in {relative}")

    def setUp(self):
        source = Path(__file__).resolve().parents[1] / "main.py"
        tree = ast.parse(source.read_text(encoding="utf-8-sig"))
        names = {
            "_cache_has_full_depth", "_filter_configured_repo_metadata",
            "get_all_repo_metadata", "get_nx_assembly",
        }
        functions = [
            node for node in tree.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name in names
        ]
        self.assertEqual({node.name for node in functions}, names)
        for function in functions:
            function.decorator_list = []
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.repo = {"config_id": "active", "full_name": "owner/current"}
        self.removed = {"config_id": "removed", "full_name": "owner/removed"}
        self.namespace = {
            "config_manager": SimpleNamespace(get_all_configs=Mock(return_value=[])),
            "_repo_metadata_cache": {}, "_REPO_METADATA_TTL": 120,
            "_load_repo_graph_cache": Mock(return_value=None),
            "_fetch_all_repo_metadata_live": AsyncMock(return_value={"repos": [], "count": 0}),
            "_latest_nx_assembly_cache": None,
            "_LATEST_NX_ASSEMBLY_PATH": str(Path(self.directory.name) / "assembly.json"),
            "HTTPException": HandlerError,
            "os": os, "json": json, "time": time,
        }
        exec(compile(ast.Module(body=functions, type_ignores=[]), str(source), "exec"), self.namespace)

    def configure(self):
        self.namespace["config_manager"].get_all_configs.return_value = [
            {"id": "active", "github_repo": "owner/current"},
        ]

    async def test_no_configuration_never_reads_old_cache_or_github(self):
        self.namespace["_repo_metadata_cache"] = {
            "data": {"repos": [self.removed]}, "_ts": time.time(),
        }
        for refresh in (False, True):
            for depth in ("basic", "full"):
                result = await self.namespace["get_all_repo_metadata"](refresh=refresh, depth=depth)
                self.assertEqual(result, {"repos": [], "count": 0})
        self.namespace["_load_repo_graph_cache"].assert_not_called()
        self.namespace["_fetch_all_repo_metadata_live"].assert_not_awaited()

    async def test_memory_cache_excludes_removed_and_renamed_repositories(self):
        self.configure()
        self.namespace["_repo_metadata_cache"] = {
            "data": {"repos": [self.repo, self.removed, {**self.repo, "full_name": "owner/old-name"}], "count": 3},
            "_ts": time.time(),
        }
        result = await self.namespace["get_all_repo_metadata"]()
        self.assertEqual(result, {"repos": [self.repo], "count": 1})

    async def test_disk_cache_excludes_removed_repositories(self):
        self.configure()
        self.namespace["_load_repo_graph_cache"].return_value = {
            "repos": [self.repo, self.removed], "count": 2,
        }
        result = await self.namespace["get_all_repo_metadata"]()
        self.assertEqual(result, {"repos": [self.repo], "count": 1})

    async def test_cache_for_another_repository_triggers_live_fetch(self):
        self.configure()
        self.namespace["_load_repo_graph_cache"].return_value = {"repos": [self.removed]}
        await self.namespace["get_all_repo_metadata"]()
        self.namespace["_fetch_all_repo_metadata_live"].assert_awaited_once_with(depth="basic")

    async def test_refresh_fetches_only_when_configured(self):
        self.configure()
        await self.namespace["get_all_repo_metadata"](refresh=True, depth="full")
        self.namespace["_fetch_all_repo_metadata_live"].assert_awaited_once_with(depth="full")

    async def test_fresh_cad_state_has_no_example_bom(self):
        with self.assertRaises(HandlerError) as raised:
            await self.namespace["get_nx_assembly"]()
        self.assertEqual(raised.exception.status_code, 404)

    async def test_cad_returns_only_explicitly_stored_assembly(self):
        assembly = {"nodes": [{"nodeId": "user-assembly"}]}
        Path(self.namespace["_LATEST_NX_ASSEMBLY_PATH"]).write_text(json.dumps(assembly), encoding="utf-8")
        self.assertEqual(await self.namespace["get_nx_assembly"](), assembly)


if __name__ == "__main__":
    unittest.main()