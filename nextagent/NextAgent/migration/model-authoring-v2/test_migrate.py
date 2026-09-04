#!/usr/bin/env python3
"""CLI behavior and controlled recovery tests for the model authoring v2 migrator."""

from __future__ import annotations

import importlib.util
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


TOOL = Path(__file__).with_name("migrate.py")


def load_tool_module():
    spec = importlib.util.spec_from_file_location("model_authoring_v2_migrate", TOOL)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load migration tool module.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def run_tool(root: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(TOOL), "--root", str(root), *arguments],
        text=True,
        capture_output=True,
        check=False,
    )


def write_json(path: Path, value: object, *, newline: str = "\n", bom: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    payload = content.replace("\n", newline).encode("utf-8")
    path.write_bytes((b"\xef\xbb\xbf" if bom else b"") + payload)


def legacy_profile(
    profile_id: str,
    model_name: str,
    *,
    enabled: bool = True,
    fallback_eligible: bool = False,
    base_url: str = "https://model.example.invalid/v1",
) -> dict[str, object]:
    return {
        "profileId": profile_id,
        "providerKind": "OPENAI",
        "modelName": model_name,
        "baseUrl": base_url,
        "credentialRef": "env:MODEL_API_KEY",
        "timeoutMs": 120000,
        "modelOptions": {
            "temperature": 0.2,
            "maxOutputTokens": 2048,
            "topP": 1,
            "response_format": {"type": "json_object"},
        },
        "providerOptions": {"seed": 7},
        "contextWindowTokens": 128000,
        "enabled": enabled,
        "fallbackEligible": fallback_eligible,
    }


def create_json_project(root: Path) -> dict[str, Path]:
    application = root / "application.yaml"
    agent = root / "agents" / "network-agent" / "agent.yaml"
    prompt = root / "agents" / "network-agent" / "prompts" / "SYSTEM_PROMPT" / "template.yaml"
    skill = root / "agents" / "network-agent" / "skills" / "diagnose" / "SKILL.md"

    write_json(
        application,
        {
            "deployment": {"mode": "LOCAL"},
            "modelProfiles": [
                legacy_profile("primary-profile", "primary-model"),
                legacy_profile(
                    "fallback-profile",
                    "fallback-model",
                    fallback_eligible=True,
                ),
            ],
        },
    )
    write_json(
        agent,
        {
            "agentId": "network-agent",
            "agentVersion": "v1",
            "modelProfileIds": ["primary-profile", "fallback-profile"],
            "runtimeSettings": {
                "defaultLanguage": "zh-CN",
                "defaultModelProfileId": "primary-profile",
            },
        },
    )
    prompt.parent.mkdir(parents=True, exist_ok=True)
    prompt.write_text(
        "schemaVersion: nextagent.prompt-template/v1\n"
        "match:\n"
        "  model:\n"
        "    providerKind: OPENAI\n"
        "    modelName: primary-model\n"
        "content:\n"
        "  - id: system\n"
        "    inline: |-\n"
        "      Diagnose the network safely.\n",
        encoding="utf-8",
    )
    skill.parent.mkdir(parents=True, exist_ok=True)
    skill.write_text(
        "---\n"
        "name: diagnose\n"
        "description: Diagnose a network fault.\n"
        "model: '{\"model\":\"fallback-model\",\"modelOptions\":{\"temperature\":0.4,\"vendor_mode\":\"fast\"}}'\n"
        "---\n\n"
        "# Diagnose\n\n"
        "Keep this body byte-for-byte.\n",
        encoding="utf-8",
    )
    return {
        "application": application,
        "agent": agent,
        "prompt": prompt,
        "skill": skill,
    }


class MigrationCliTests(unittest.TestCase):
    def test_dry_run_write_and_idempotency_for_json_project(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = create_json_project(root)
            originals = {name: path.read_bytes() for name, path in paths.items()}
            original_skill_body = paths["skill"].read_bytes().split(b"---", 2)[2]

            dry_run = run_tool(root)
            self.assertEqual(dry_run.returncode, 0, dry_run.stderr)
            self.assertIn("DRY_RUN", dry_run.stdout)
            self.assertIn("primary-profile -> primary-model", dry_run.stdout)
            self.assertNotIn("MODEL_API_KEY", dry_run.stdout + dry_run.stderr)
            self.assertNotIn("model.example.invalid", dry_run.stdout + dry_run.stderr)
            self.assertNotIn("json_object", dry_run.stdout + dry_run.stderr)
            for name, path in paths.items():
                self.assertEqual(path.read_bytes(), originals[name])

            write = run_tool(root, "--write")
            self.assertEqual(write.returncode, 0, write.stderr)
            self.assertIn("APPLIED", write.stdout)

            application = json.loads(paths["application"].read_text(encoding="utf-8"))
            self.assertEqual(len(application["modelProfiles"]), 1)
            provider = application["modelProfiles"][0]
            self.assertEqual(provider["providerId"], "openai-compatible")
            self.assertEqual([item["modelId"] for item in provider["models"]], ["primary-model", "fallback-model"])
            primary = provider["models"][0]
            self.assertEqual(primary["temperature"], 0.2)
            self.assertEqual(primary["maxOutputTokens"], 2048)
            self.assertEqual(primary["providerOptions"]["seed"], 7)
            self.assertEqual(primary["providerOptions"]["response_format"]["type"], "json_object")
            self.assertNotIn("modelOptions", primary)

            agent = json.loads(paths["agent"].read_text(encoding="utf-8"))
            self.assertEqual(agent["modelIds"], ["primary-model", "fallback-model"])
            self.assertEqual(agent["defaultModelId"], "primary-model")
            self.assertNotIn("modelProfileIds", agent)
            self.assertNotIn("defaultModelProfileId", agent["runtimeSettings"])

            prompt = paths["prompt"].read_text(encoding="utf-8")
            self.assertIn("model: primary-model", prompt)
            self.assertNotIn("providerKind", prompt)
            self.assertNotIn("modelName", prompt)

            skill_bytes = paths["skill"].read_bytes()
            self.assertEqual(skill_bytes.split(b"---", 2)[2], original_skill_body)
            skill_text = skill_bytes.decode("utf-8")
            self.assertIn("fallback-model", skill_text)
            self.assertIn("providerOptions", skill_text)
            self.assertIn("vendor_mode", skill_text)

            journals = list((root / ".nextagent-migration" / "model-authoring-v2").glob("*/journal.json"))
            self.assertEqual(len(journals), 1)
            journal = json.loads(journals[0].read_text(encoding="utf-8"))
            self.assertEqual(journal["status"], "completed")

            second = run_tool(root, "--write")
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertIn("NO_CHANGES", second.stdout)
            self.assertEqual(
                len(list((root / ".nextagent-migration" / "model-authoring-v2").glob("*/journal.json"))),
                1,
            )

    def test_yaml_project_and_crlf_bom_are_supported(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            application = root / "application.yaml"
            application.write_bytes(
                b"\xef\xbb\xbf"
                + (
                    "deployment:\r\n"
                    "  mode: LOCAL\r\n"
                    "modelProfiles:\r\n"
                    "  - profileId: primary-profile\r\n"
                    "    providerKind: OPENAI\r\n"
                    "    modelName: primary-model\r\n"
                    "    baseUrl: https://model.example.invalid/v1\r\n"
                    "    credentialRef: env:MODEL_API_KEY\r\n"
                    "    timeoutMs: 120000\r\n"
                    "    modelOptions:\r\n"
                    "      temperature: 0.2\r\n"
                    "      maxOutputTokens: 2048\r\n"
                    "      topP: 1\r\n"
                    "    providerOptions: {}\r\n"
                    "    contextWindowTokens: 128000\r\n"
                    "    enabled: true\r\n"
                    "    fallbackEligible: false\r\n"
                ).encode("utf-8")
            )
            agent = root / "agents" / "network-agent" / "agent.yaml"
            agent.parent.mkdir(parents=True)
            agent.write_text(
                "agentId: network-agent\n"
                "agentVersion: v1\n"
                "modelProfileIds: [primary-profile]\n"
                "runtimeSettings:\n"
                "  defaultModelProfileId: primary-profile\n",
                encoding="utf-8",
            )
            skill = root / "skills" / "network-summary" / "SKILL.md"
            skill.parent.mkdir(parents=True)
            skill.write_text(
                "---\n"
                "name: network-summary\n"
                "description: |\n"
                "  Summarize network evidence.\n"
                "  Preserve device identifiers.\n"
                "model: primary-profile\n"
                "---\n"
                "\n"
                "# Network Summary\n",
                encoding="utf-8",
            )
            original_skill_body = skill.read_bytes().split(b"---", 2)[2]

            result = run_tool(root, "--write")
            self.assertEqual(result.returncode, 0, result.stderr)
            payload = application.read_bytes()
            self.assertTrue(payload.startswith(b"\xef\xbb\xbf"))
            self.assertIn(b"\r\n", payload)
            self.assertNotIn(b"\n", payload.replace(b"\r\n", b""))
            text = payload.decode("utf-8-sig")
            self.assertIn("providerId: openai-compatible", text)
            self.assertIn("modelId: primary-model", text)
            self.assertIn("modelIds:", agent.read_text(encoding="utf-8"))
            self.assertIn("defaultModelId: primary-model", agent.read_text(encoding="utf-8"))
            migrated_skill = load_tool_module().load_skill_document(skill, root)
            self.assertEqual(
                migrated_skill.frontmatter["description"],
                "Summarize network evidence.\nPreserve device identifiers.\n",
            )
            self.assertEqual(skill.read_bytes().split(b"---", 2)[2], original_skill_body)

    def test_single_env_backed_model_uses_agent_inheritance_and_blocks_other_references(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            application = root / "application.yaml"
            write_json(
                application,
                {
                    "modelProfiles": [
                        legacy_profile("default-openai", "env:OPENAI_MODEL_NAME"),
                    ],
                },
            )
            agent = root / "agents" / "a" / "agent.yaml"
            write_json(
                agent,
                {
                    "agentId": "a",
                    "agentVersion": "v1",
                    "modelProfileIds": ["default-openai"],
                    "runtimeSettings": {
                        "defaultModelProfileId": "default-openai",
                    },
                },
            )

            migrated = run_tool(root, "--write")
            self.assertEqual(migrated.returncode, 0, migrated.stderr)
            migrated_agent = json.loads(agent.read_text(encoding="utf-8"))
            self.assertNotIn("modelIds", migrated_agent)
            self.assertNotIn("defaultModelId", migrated_agent)
            self.assertNotIn("defaultModelProfileId", migrated_agent["runtimeSettings"])
            migrated_application = json.loads(application.read_text(encoding="utf-8"))
            self.assertEqual(
                migrated_application["modelProfiles"][0]["models"][0]["modelId"],
                "env:OPENAI_MODEL_NAME",
            )

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            application = root / "application.yaml"
            write_json(
                application,
                {
                    "modelProfiles": [
                        legacy_profile("default-openai", "env:OPENAI_MODEL_NAME"),
                    ],
                },
            )
            prompt = root / "agents" / "a" / "prompts" / "SYSTEM_PROMPT" / "template.yaml"
            write_json(
                prompt,
                {
                    "templateId": "SYSTEM_PROMPT",
                    "purpose": "SYSTEM_PROMPT",
                    "match": {
                        "model": {
                            "providerKind": "OPENAI",
                            "modelName": "env:OPENAI_MODEL_NAME",
                        },
                    },
                },
            )
            original = application.read_bytes()

            blocked = run_tool(root, "--write")
            self.assertEqual(blocked.returncode, 2)
            self.assertIn("DYNAMIC_MODEL_REFERENCE_REQUIRES_MANUAL_MIGRATION", blocked.stderr)
            self.assertEqual(application.read_bytes(), original)
            self.assertFalse((root / ".nextagent-migration").exists())

    def test_ambiguous_disabled_and_unsupported_inputs_fail_before_write(self) -> None:
        cases: list[tuple[str, list[dict[str, object]], str]] = [
            (
                "duplicate-profile",
                [legacy_profile("same", "model-a"), legacy_profile("same", "model-b", enabled=False)],
                "DUPLICATE_PROFILE_ID",
            ),
            (
                "duplicate-model",
                [legacy_profile("a", "same-model"), legacy_profile("b", "same-model", fallback_eligible=True)],
                "DUPLICATE_MODEL_ID",
            ),
            (
                "access-conflict",
                [legacy_profile("a", "model-a"), legacy_profile("b", "model-b", base_url="https://other.invalid/v1")],
                "PROVIDER_ACCESS_CONFLICT",
            ),
        ]
        for name, profiles, reason in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                application = root / "application.yaml"
                write_json(application, {"modelProfiles": profiles})
                original = application.read_bytes()
                result = run_tool(root, "--write")
                self.assertEqual(result.returncode, 2)
                self.assertIn(reason, result.stderr)
                self.assertEqual(application.read_bytes(), original)
                self.assertFalse((root / ".nextagent-migration").exists())

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            application = root / "application.yaml"
            write_json(
                application,
                {
                    "modelProfiles": [
                        legacy_profile("primary", "primary-model"),
                        legacy_profile("disabled", "disabled-model", enabled=False),
                    ]
                },
            )
            agent = root / "agents" / "a" / "agent.yaml"
            write_json(agent, {"agentId": "a", "agentVersion": "v1", "modelProfileIds": ["disabled"]})
            result = run_tool(root, "--write")
            self.assertEqual(result.returncode, 2)
            self.assertIn("DISABLED_MODEL_REFERENCE", result.stderr)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            application = root / "application.yaml"
            application.write_text(
                "defaults: &defaults\n  enabled: true\nmodelProfiles: *defaults\n",
                encoding="utf-8",
            )
            result = run_tool(root, "--write")
            self.assertEqual(result.returncode, 2)
            self.assertIn("UNSUPPORTED_YAML", result.stderr)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            application = root / "application.yaml"
            application.write_text(
                "description: >\n  folded input requires manual simplification\nmodelProfiles: []\n",
                encoding="utf-8",
            )
            result = run_tool(root, "--write")
            self.assertEqual(result.returncode, 2)
            self.assertIn("UNSUPPORTED_YAML", result.stderr)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            application = root / "application.yaml"
            write_json(
                application,
                {
                    "modelProfiles": [
                        legacy_profile("source", "source-model"),
                        {
                            "providerId": "openai-compatible",
                            "baseUrl": "https://model.example.invalid/v1",
                            "models": [
                                {
                                    "modelId": "target-model",
                                    "contextWindowTokens": 128000,
                                    "fallbackEligible": False,
                                }
                            ],
                        },
                    ]
                },
            )
            result = run_tool(root, "--write")
            self.assertEqual(result.returncode, 2)
            self.assertIn("SOURCE_TARGET_MIXED", result.stderr)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_json(root / "application.yaml", {"modelProfiles": [legacy_profile("primary", "primary-model")]})
            agent = root / "agents" / "a" / "agent.yaml"
            write_json(agent, {"agentId": "a", "agentVersion": "v1", "modelProfileIds": ["missing"]})
            result = run_tool(root, "--write")
            self.assertEqual(result.returncode, 2)
            self.assertIn("UNKNOWN_MODEL_REFERENCE", result.stderr)
            self.assertIn("agents/a/agent.yaml", result.stderr.replace("\\", "/"))

        invalid_profiles: list[tuple[str, dict[str, object], str]] = [
            (
                "unsafe-profile-id",
                legacy_profile("profile\nsecret", "primary-model"),
                "INVALID_PROFILE_ID",
            ),
            (
                "whitespace-model-id",
                legacy_profile("primary", " primary-model"),
                "INVALID_MODEL_ID",
            ),
            (
                "invalid-credential-reference",
                {
                    **legacy_profile("primary", "primary-model"),
                    "credentialRef": "raw-secret",
                },
                "INVALID_CREDENTIAL_REFERENCE",
            ),
            (
                "unsafe-integer",
                {
                    **legacy_profile("primary", "primary-model"),
                    "timeoutMs": 9_007_199_254_740_992,
                },
                "INVALID_TIMEOUT",
            ),
        ]
        for name, profile, reason in invalid_profiles:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                application = root / "application.yaml"
                write_json(application, {"modelProfiles": [profile]})
                original = application.read_bytes()
                result = run_tool(root, "--write")
                self.assertEqual(result.returncode, 2)
                self.assertIn(reason, result.stderr)
                self.assertEqual(application.read_bytes(), original)
                self.assertFalse((root / ".nextagent-migration").exists())

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            application = root / "application.yaml"
            application.write_text(
                '{"modelProfiles":[{"profileId":"primary","providerKind":"OPENAI",'
                '"modelName":"primary-model","baseUrl":"https://model.example.invalid/v1",'
                '"credentialRef":"env:MODEL_API_KEY","timeoutMs":NaN,"modelOptions":{},'
                '"providerOptions":{},"contextWindowTokens":128000,"enabled":true,'
                '"fallbackEligible":false}]}',
                encoding="utf-8",
            )
            result = run_tool(root, "--write")
            self.assertEqual(result.returncode, 2)
            self.assertIn("INVALID_JSON_NUMBER", result.stderr)
            self.assertFalse((root / ".nextagent-migration").exists())

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            application = root / "application.yaml"
            write_json(
                application,
                {"modelProfiles": [legacy_profile("primary", "模型")]},
            )
            skill = root / "skills" / "unsafe-model" / "SKILL.md"
            skill.parent.mkdir(parents=True)
            skill.write_text(
                "---\n"
                "name: unsafe-model\n"
                "description: Validate a model identifier.\n"
                "model: primary\n"
                "---\n\n"
                "# Unsafe model\n",
                encoding="utf-8",
            )
            result = run_tool(root, "--write")
            self.assertEqual(result.returncode, 2)
            self.assertIn("INVALID_SKILL_MODEL", result.stderr)
            self.assertFalse((root / ".nextagent-migration").exists())

    def test_invalid_target_model_profiles_fail_instead_of_reporting_no_changes(self) -> None:
        invalid_profiles: list[tuple[str, list[dict[str, object]], str]] = [
            (
                "unknown-model-field",
                [
                    {
                        "providerId": "openai-compatible",
                        "baseUrl": "https://model.example.invalid/v1",
                        "models": [
                            {
                                "modelId": "primary-model",
                                "contextWindowTokens": 128000,
                                "fallbackEligible": False,
                                "legacyOption": True,
                            }
                        ],
                    }
                ],
                "UNKNOWN_TARGET_MODEL_FIELD",
            ),
            (
                "duplicate-provider",
                [
                    {
                        "providerId": "openai-compatible",
                        "baseUrl": "https://model.example.invalid/v1",
                        "models": [
                            {
                                "modelId": "primary-model",
                                "contextWindowTokens": 128000,
                                "fallbackEligible": False,
                            }
                        ],
                    },
                    {
                        "providerId": "openai-compatible",
                        "baseUrl": "https://model.example.invalid/v1",
                        "models": [
                            {
                                "modelId": "fallback-model",
                                "contextWindowTokens": 128000,
                                "fallbackEligible": True,
                            }
                        ],
                    },
                ],
                "DUPLICATE_TARGET_PROVIDER_ID",
            ),
            (
                "reserved-provider-option",
                [
                    {
                        "providerId": "openai-compatible",
                        "baseUrl": "https://model.example.invalid/v1",
                        "models": [
                            {
                                "modelId": "primary-model",
                                "contextWindowTokens": 128000,
                                "fallbackEligible": False,
                                "providerOptions": {"timeoutMs": 1000},
                            }
                        ],
                    }
                ],
                "RESERVED_PROVIDER_OPTION",
            ),
            (
                "explicit-null-optional-field",
                [
                    {
                        "providerId": "openai-compatible",
                        "baseUrl": "https://model.example.invalid/v1",
                        "credentialRef": None,
                        "models": [
                            {
                                "modelId": "primary-model",
                                "contextWindowTokens": 128000,
                                "fallbackEligible": False,
                            }
                        ],
                    }
                ],
                "INVALID_CREDENTIAL_REFERENCE",
            ),
        ]
        for name, profiles, reason in invalid_profiles:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                application = root / "application.yaml"
                write_json(application, {"modelProfiles": profiles})
                original = application.read_bytes()

                result = run_tool(root, "--write")

                self.assertEqual(result.returncode, 2)
                self.assertIn(reason, result.stderr)
                self.assertNotIn("NO_CHANGES", result.stdout)
                self.assertEqual(application.read_bytes(), original)
                self.assertFalse((root / ".nextagent-migration").exists())

    def test_explicit_roots_replace_defaults_and_reject_path_escape(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = root / "config" / "system.yaml"
            write_json(config, {"modelProfiles": [legacy_profile("primary", "primary-model")]})
            agent = root / "custom-agents" / "a" / "agent.yaml"
            write_json(agent, {"agentId": "a", "agentVersion": "v1", "modelProfileIds": ["primary"]})

            result = run_tool(
                root,
                "--system-config",
                "config/system.yaml",
                "--agent-root",
                "custom-agents",
                "--write",
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            migrated = json.loads(agent.read_text(encoding="utf-8"))
            self.assertEqual(migrated["modelIds"], ["primary-model"])

            outside = root.parent / "outside-system.yaml"
            write_json(outside, {"modelProfiles": [legacy_profile("outside", "outside-model")]})
            escaped = run_tool(root, "--system-config", str(outside))
            self.assertEqual(escaped.returncode, 2)
            self.assertIn("PATH_OUTSIDE_ROOT", escaped.stderr)
            outside.unlink()

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_json(root / "application.yaml", {"modelProfiles": [legacy_profile("primary", "primary-model")]})
            for package_name in ("agent-app", "agent-model"):
                write_json(root / "packages" / package_name / "package.json", {"name": package_name})
            (root / "openspec").mkdir()
            rejected = run_tool(root, "--write")
            self.assertEqual(rejected.returncode, 2)
            self.assertIn("NEXTAGENT_SOURCE_ROOT_NOT_ALLOWED", rejected.stderr)
            self.assertFalse((root / ".nextagent-migration").exists())

    def test_linked_discovery_directory_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_json(root / "application.yaml", {"modelProfiles": [legacy_profile("primary", "primary-model")]})
            target = root / "linked-agent-source"
            write_json(
                target / "a" / "agent.yaml",
                {"agentId": "a", "agentVersion": "v1", "modelProfileIds": ["primary"]},
            )
            agents = root / "agents"
            agents.mkdir()
            linked = agents / "linked"
            if os.name == "nt":
                created = subprocess.run(
                    ["cmd", "/c", "mklink", "/J", str(linked), str(target)],
                    text=True,
                    capture_output=True,
                    check=False,
                )
                self.assertEqual(created.returncode, 0, created.stderr)
            else:
                os.symlink(target, linked, target_is_directory=True)

            result = run_tool(root, "--write")
            self.assertEqual(result.returncode, 2)
            self.assertIn("SYMLINK_NOT_ALLOWED", result.stderr)
            self.assertFalse((root / ".nextagent-migration").exists())

    def test_explicit_recovery_restores_backup(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "application.yaml"
            target.write_text("changed\n", encoding="utf-8")
            run_id = "20260802T000000Z-deadbeef"
            run_root = root / ".nextagent-migration" / "model-authoring-v2" / run_id
            backup = run_root / "files" / "application.yaml"
            backup.parent.mkdir(parents=True)
            backup.write_bytes(b"original\n")
            (run_root / "journal.json").write_text(
                json.dumps(
                    {
                        "version": 1,
                        "runId": run_id,
                        "status": "applying",
                        "files": [
                            {
                                "path": "application.yaml",
                                "backup": "files/application.yaml",
                                "sourceSha256": hashlib.sha256(b"original\n").hexdigest(),
                                "targetSha256": hashlib.sha256(b"changed\n").hexdigest(),
                                "replaced": True,
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            target.unlink()

            recovered = run_tool(root, "--recover", run_id)
            self.assertEqual(recovered.returncode, 0, recovered.stderr)
            self.assertEqual(target.read_text(encoding="utf-8"), "original\n")
            journal = json.loads((run_root / "journal.json").read_text(encoding="utf-8"))
            self.assertEqual(journal["status"], "recovered")

    def test_recovery_refuses_changed_target_before_restoring_any_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            run_id = "20260802T000000Z-feedbeef"
            run_root = root / ".nextagent-migration" / "model-authoring-v2" / run_id
            entries: list[dict[str, object]] = []
            targets: list[Path] = []
            for name in ("first.yaml", "second.yaml"):
                source = f"{name}-original\n".encode()
                target_payload = f"{name}-migrated\n".encode()
                target = root / name
                target.write_bytes(target_payload)
                backup = run_root / "files" / name
                backup.parent.mkdir(parents=True, exist_ok=True)
                backup.write_bytes(source)
                entries.append(
                    {
                        "path": name,
                        "backup": f"files/{name}",
                        "sourceSha256": hashlib.sha256(source).hexdigest(),
                        "targetSha256": hashlib.sha256(target_payload).hexdigest(),
                        "replaced": True,
                    }
                )
                targets.append(target)
            targets[0].write_text("developer edit\n", encoding="utf-8")
            (run_root / "journal.json").write_text(
                json.dumps(
                    {
                        "version": 1,
                        "runId": run_id,
                        "status": "applying",
                        "files": entries,
                    }
                ),
                encoding="utf-8",
            )

            recovered = run_tool(root, "--recover", run_id)
            self.assertEqual(recovered.returncode, 2)
            self.assertIn("RECOVERY_TARGET_CHANGED", recovered.stderr)
            self.assertEqual(targets[0].read_text(encoding="utf-8"), "developer edit\n")
            self.assertEqual(targets[1].read_text(encoding="utf-8"), "second.yaml-migrated\n")

    def test_apply_rolls_back_when_a_replace_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            create_json_project(root)
            module = load_tool_module()
            options = module.parse_arguments(["--root", str(root), "--write"])
            plan = module.build_plan(options)
            original = {item.path: item.original for item in plan.files}
            calls = 0

            def failing_replace(path: Path, payload: bytes) -> None:
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise OSError("injected replace failure")
                module.atomic_replace(path, payload)

            with self.assertRaises(module.MigrationError) as raised:
                module.apply_plan(plan, replace_file=failing_replace)
            self.assertEqual(raised.exception.code, "WRITE_FAILED_ROLLED_BACK")
            for path, payload in original.items():
                self.assertEqual(path.read_bytes(), payload)

    def test_automatic_rollback_preserves_concurrent_target_edit(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            create_json_project(root)
            module = load_tool_module()
            options = module.parse_arguments(["--root", str(root), "--write"])
            plan = module.build_plan(options)
            edited = plan.files[0].path
            calls = 0

            def edit_then_fail(path: Path, payload: bytes) -> None:
                nonlocal calls
                calls += 1
                if calls == 1:
                    module.atomic_replace(path, payload)
                    path.write_text("developer edit\n", encoding="utf-8")
                    return
                raise OSError("injected replace failure")

            with self.assertRaises(module.MigrationError) as raised:
                module.apply_plan(plan, replace_file=edit_then_fail)
            self.assertEqual(raised.exception.code, "WRITE_FAILED_ROLLBACK_INCOMPLETE")
            self.assertEqual(edited.read_text(encoding="utf-8"), "developer edit\n")

    def test_interrupted_replace_remains_explicitly_recoverable(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            create_json_project(root)
            module = load_tool_module()
            options = module.parse_arguments(["--root", str(root), "--write"])
            plan = module.build_plan(options)
            original = {item.path: item.original for item in plan.files}

            def interrupted_replace(path: Path, payload: bytes) -> None:
                module.atomic_replace(path, payload)
                raise KeyboardInterrupt

            with self.assertRaises(KeyboardInterrupt):
                module.apply_plan(plan, replace_file=interrupted_replace)

            journals = list((root / ".nextagent-migration" / "model-authoring-v2").glob("*/journal.json"))
            self.assertEqual(len(journals), 1)
            journal = json.loads(journals[0].read_text(encoding="utf-8"))
            self.assertEqual(journal["status"], "applying")
            self.assertTrue(journal["files"][0]["replaced"])
            module.recover_run(options, journal["runId"])
            for path, payload in original.items():
                self.assertEqual(path.read_bytes(), payload)

    def test_concurrent_source_change_is_rejected_before_backup(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            create_json_project(root)
            module = load_tool_module()
            options = module.parse_arguments(["--root", str(root), "--write"])
            plan = module.build_plan(options)
            changed = plan.files[0].path
            changed.write_bytes(changed.read_bytes() + b" ")

            with self.assertRaises(module.MigrationError) as raised:
                module.apply_plan(plan)
            self.assertEqual(raised.exception.code, "SOURCE_CHANGED")
            self.assertFalse((root / ".nextagent-migration").exists())

    def test_apply_rejects_source_replaced_by_a_link_after_planning(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = create_json_project(root)
            module = load_tool_module()
            options = module.parse_arguments(["--root", str(root), "--write"])
            plan = module.build_plan(options)
            agent_directory = paths["agent"].parent
            linked_source = root / "linked-agent-source"
            agent_directory.rename(linked_source)
            if os.name == "nt":
                created = subprocess.run(
                    ["cmd", "/c", "mklink", "/J", str(agent_directory), str(linked_source)],
                    text=True,
                    capture_output=True,
                    check=False,
                )
                self.assertEqual(created.returncode, 0, created.stderr)
            else:
                os.symlink(linked_source, agent_directory, target_is_directory=True)

            with self.assertRaises(module.MigrationError) as raised:
                module.apply_plan(plan)
            self.assertEqual(raised.exception.code, "SYMLINK_NOT_ALLOWED")
            self.assertFalse((root / ".nextagent-migration").exists())


if __name__ == "__main__":
    unittest.main()
