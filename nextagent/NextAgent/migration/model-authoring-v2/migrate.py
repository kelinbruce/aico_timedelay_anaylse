#!/usr/bin/env python3
"""Upgrade NextAgent developer-owned model authoring assets to v2.

This file intentionally uses only the Python standard library. It is an
offline source migration utility, not a runtime configuration parser.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import shutil
import sys
import tempfile
from typing import Callable, Sequence
from urllib.parse import urlsplit


TOOL_VERSION = 1
MAX_SAFE_INTEGER = 9_007_199_254_740_991
BACKUP_ROOT = Path(".nextagent-migration") / "model-authoring-v2"
EXCLUDED_DIRECTORIES = {
    ".git",
    ".nextagent-migration",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".cache",
}
INFERENCE_FIELDS = (
    "temperature",
    "maxOutputTokens",
    "topP",
    "topK",
    "presencePenalty",
    "frequencyPenalty",
    "thinking",
)
RESERVED_OPTION_KEYS = {
    "model",
    "modelid",
    "modelname",
    "profileid",
    "provider",
    "providerid",
    "providerkind",
    "baseurl",
    "endpoint",
    "credential",
    "credentialref",
    "apikey",
    "apikeysource",
    "authorization",
    "headers",
    "header",
    "fetch",
    "transport",
    "timeout",
    "timeoutms",
    "maxretries",
    "retry",
    "retries",
    "temperature",
    "maxoutputtokens",
    "topp",
    "topk",
    "presencepenalty",
    "frequencypenalty",
    "thinking",
    "reasoning",
    "reasoningeffort",
}
LEGACY_PROFILE_KEYS = {
    "profileId",
    "providerKind",
    "modelName",
    "displayName",
    "baseUrl",
    "credentialRef",
    "timeoutMs",
    "maxRetries",
    "modelOptions",
    "providerOptions",
    "contextWindowTokens",
    "enabled",
    "fallbackEligible",
}
TARGET_PROVIDER_KEYS = {"providerId", "baseUrl", "credentialRef", "models"}
TARGET_MODEL_KEYS = {
    "modelId",
    "displayName",
    "contextWindowTokens",
    "fallbackEligible",
    *INFERENCE_FIELDS,
    "providerOptions",
    "timeoutMs",
    "maxRetries",
}
SKILL_MODEL_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")
UNSAFE_SKILL_MODEL_VALUE_PATTERN = re.compile(
    r"(?:https?://|sk-[A-Za-z0-9]|api[_-]?key|authorization|credential|password|secret|token)",
    re.IGNORECASE,
)


class MigrationError(Exception):
    """Expected fail-closed migration error with a stable reason code."""

    def __init__(self, code: str, label: str = "project") -> None:
        super().__init__(code)
        self.code = code
        self.label = label


@dataclass(frozen=True)
class Options:
    root: Path
    system_config: str | None
    agent_roots: tuple[str, ...]
    prompt_roots: tuple[str, ...]
    skill_roots: tuple[str, ...]
    write: bool
    recover: str | None


@dataclass(frozen=True)
class YamlToken:
    indent: int
    text: str
    block_value: str | None = None


@dataclass(frozen=True)
class StructuredDocument:
    path: Path
    label: str
    original: bytes
    kind: str
    data: object
    bom: bool
    newline: str
    final_newline: bool


@dataclass(frozen=True)
class SkillDocument:
    path: Path
    label: str
    original: bytes
    frontmatter: dict[str, object]
    body: str
    bom: bool
    newline: str
    closing_newline: str


@dataclass(frozen=True)
class PlannedFile:
    path: Path
    label: str
    original: bytes
    updated: bytes
    reasons: tuple[str, ...]


@dataclass(frozen=True)
class MigrationPlan:
    root: Path
    files: tuple[PlannedFile, ...]
    mappings: tuple[tuple[str, str], ...]


@dataclass
class ModelMapping:
    profile_to_model: dict[str, str]
    model_to_provider_kind: dict[str, str]
    disabled_refs: set[str]
    target_model_ids: set[str]
    target_model_order: tuple[str, ...]

    def resolve(self, value: object, label: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise MigrationError("INVALID_MODEL_REFERENCE", label)
        if value in self.disabled_refs:
            raise MigrationError("DISABLED_MODEL_REFERENCE", label)
        if value in self.profile_to_model:
            return self.profile_to_model[value]
        if value in self.target_model_ids:
            return value
        raise MigrationError("UNKNOWN_MODEL_REFERENCE", label)

    def resolve_static(self, value: object, label: str) -> str:
        model_id = self.resolve(value, label)
        if is_env_reference(model_id):
            raise MigrationError("DYNAMIC_MODEL_REFERENCE_REQUIRES_MANUAL_MIGRATION", label)
        return model_id

    def resolve_skill_model(self, value: object, label: str) -> str:
        model_id = self.resolve_static(value, label)
        if (
            SKILL_MODEL_ID_PATTERN.fullmatch(model_id) is None
            or UNSAFE_SKILL_MODEL_VALUE_PATTERN.search(model_id) is not None
        ):
            raise MigrationError("INVALID_SKILL_MODEL", label)
        return model_id


def parse_arguments(arguments: Sequence[str] | None = None) -> Options:
    parser = argparse.ArgumentParser(
        description="Upgrade developer-owned NextAgent model authoring assets to v2.",
    )
    parser.add_argument(
        "--root",
        default=".",
        help="Developer project root. Defaults to the current directory.",
    )
    parser.add_argument(
        "--system-config",
        help="System config path relative to --root. Defaults to application.yaml.",
    )
    parser.add_argument(
        "--agent-root",
        action="append",
        default=[],
        help="Agent root relative to --root. Repeatable; replaces the default agents root.",
    )
    parser.add_argument(
        "--prompt-root",
        action="append",
        default=[],
        help="Prompt root relative to --root. Repeatable; replaces Agent prompt discovery.",
    )
    parser.add_argument(
        "--skill-root",
        action="append",
        default=[],
        help="Skill root relative to --root. Repeatable; replaces default system/Agent Skill discovery.",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Apply the complete plan after creating a backup and journal. Default is dry-run.",
    )
    parser.add_argument(
        "--recover",
        metavar="RUN_ID",
        help="Restore files recorded as replaced by an unfinished migration run.",
    )
    namespace = parser.parse_args(arguments)
    root = Path(namespace.root).expanduser().resolve()
    if not root.is_dir():
        parser.error("--root must identify an existing directory")
    if namespace.recover is not None and namespace.write:
        parser.error("--recover and --write cannot be used together")
    return Options(
        root=root,
        system_config=namespace.system_config,
        agent_roots=tuple(namespace.agent_root),
        prompt_roots=tuple(namespace.prompt_root),
        skill_roots=tuple(namespace.skill_root),
        write=bool(namespace.write),
        recover=namespace.recover,
    )


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def safe_label(root: Path, path: Path) -> str:
    try:
        label = path.relative_to(root).as_posix()
    except ValueError as error:
        raise MigrationError("PATH_OUTSIDE_ROOT") from error
    if any(ord(character) < 32 or 127 <= ord(character) <= 159 for character in label):
        raise MigrationError("UNSAFE_PATH")
    return label


def is_filesystem_link(path: Path) -> bool:
    return path.is_symlink() or path.absolute() != path.resolve(strict=False)


def resolve_under_root(
    root: Path,
    value: str | Path,
    *,
    expected: str,
    required: bool,
) -> Path | None:
    resolved = resolve_root_contained_path(root, value)
    if not resolved.exists():
        if required:
            raise MigrationError(
                "SYSTEM_CONFIG_NOT_FOUND" if expected == "file" else "DISCOVERY_ROOT_NOT_FOUND",
                safe_label(root, resolved),
            )
        return None
    if expected == "file" and not resolved.is_file():
        raise MigrationError("EXPECTED_FILE", safe_label(root, resolved))
    if expected == "directory" and not resolved.is_dir():
        raise MigrationError("EXPECTED_DIRECTORY", safe_label(root, resolved))
    return resolved


def resolve_root_contained_path(root: Path, value: str | Path) -> Path:
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        candidate = root / candidate
    absolute = candidate.absolute()
    try:
        relative = absolute.relative_to(root)
    except ValueError as error:
        raise MigrationError("PATH_OUTSIDE_ROOT") from error
    current = root
    for part in relative.parts:
        current = current / part
        if current.exists() and is_filesystem_link(current):
            raise MigrationError("SYMLINK_NOT_ALLOWED", safe_label(root, current))
    resolved = absolute.resolve(strict=False)
    try:
        resolved.relative_to(root)
    except ValueError as error:
        raise MigrationError("PATH_OUTSIDE_ROOT") from error
    return resolved


def resolve_write_target_under_root(root: Path, value: str | Path) -> Path:
    resolved = resolve_root_contained_path(root, value)
    if resolved.exists() and not resolved.is_file():
        raise MigrationError("EXPECTED_FILE", safe_label(root, resolved))
    if not resolved.parent.is_dir():
        raise MigrationError("DISCOVERY_ROOT_NOT_FOUND", safe_label(root, resolved.parent))
    return resolved


def resolve_directory_target_under_root(root: Path, value: str | Path) -> Path:
    resolved = resolve_root_contained_path(root, value)
    if resolved.exists() and not resolved.is_dir():
        raise MigrationError("EXPECTED_DIRECTORY", safe_label(root, resolved))
    return resolved


def walk_files(root: Path, names: set[str] | None = None, suffixes: set[str] | None = None) -> list[Path]:
    discovered: list[Path] = []
    for directory, directory_names, file_names in os.walk(root, followlinks=False):
        directory_path = Path(directory)
        traversable_directories: list[str] = []
        for name in sorted(directory_names):
            if name in EXCLUDED_DIRECTORIES:
                continue
            candidate = directory_path / name
            if is_filesystem_link(candidate):
                raise MigrationError("SYMLINK_NOT_ALLOWED", safe_label(root, candidate))
            traversable_directories.append(name)
        directory_names[:] = traversable_directories
        for name in sorted(file_names):
            path = directory_path / name
            if is_filesystem_link(path):
                if (names is not None and name in names) or (
                    suffixes is not None and path.suffix.lower() in suffixes
                ):
                    raise MigrationError("SYMLINK_NOT_ALLOWED", safe_label(root, path))
                continue
            if names is not None and name in names:
                discovered.append(path.resolve())
            elif suffixes is not None and path.suffix.lower() in suffixes:
                discovered.append(path.resolve())
    return discovered


def discover_paths(options: Options) -> tuple[Path, list[Path], list[Path], list[Path]]:
    root = options.root
    if (
        (root / "packages" / "agent-app" / "package.json").is_file()
        and (root / "packages" / "agent-model" / "package.json").is_file()
        and (root / "openspec").is_dir()
    ):
        raise MigrationError("NEXTAGENT_SOURCE_ROOT_NOT_ALLOWED")
    system_value = options.system_config or "application.yaml"
    system_config = resolve_under_root(root, system_value, expected="file", required=True)
    if system_config is None:
        raise MigrationError("SYSTEM_CONFIG_NOT_FOUND")

    agent_roots: list[Path] = []
    for value in options.agent_roots or ("agents",):
        resolved = resolve_under_root(
            root,
            value,
            expected="directory",
            required=bool(options.agent_roots),
        )
        if resolved is not None:
            agent_roots.append(resolved)

    agent_files = sorted({path for agent_root in agent_roots for path in walk_files(agent_root, names={"agent.yaml"})})

    prompt_files: set[Path] = set()
    if options.prompt_roots:
        for value in options.prompt_roots:
            prompt_root = resolve_under_root(root, value, expected="directory", required=True)
            if prompt_root is None:
                raise MigrationError("DISCOVERY_ROOT_NOT_FOUND")
            prompt_files.update(walk_files(prompt_root, suffixes={".yaml", ".yml"}))
    else:
        for agent_root in agent_roots:
            for path in walk_files(agent_root, suffixes={".yaml", ".yml"}):
                relative_parts = path.relative_to(agent_root).parts
                if "prompts" in relative_parts and path.name != "agent.yaml":
                    prompt_files.add(path)

    skill_files: set[Path] = set()
    if options.skill_roots:
        for value in options.skill_roots:
            skill_root = resolve_under_root(root, value, expected="directory", required=True)
            if skill_root is None:
                raise MigrationError("DISCOVERY_ROOT_NOT_FOUND")
            skill_files.update(walk_files(skill_root, names={"SKILL.md"}))
    else:
        system_skill_root = resolve_under_root(root, "skills", expected="directory", required=False)
        if system_skill_root is not None:
            skill_files.update(walk_files(system_skill_root, names={"SKILL.md"}))
        for agent_root in agent_roots:
            for path in walk_files(agent_root, names={"SKILL.md"}):
                if "skills" in path.relative_to(agent_root).parts:
                    skill_files.add(path)

    return system_config, agent_files, sorted(prompt_files), sorted(skill_files)


def decode_source(path: Path, root: Path) -> tuple[bytes, str, bool, str, bool]:
    payload = path.read_bytes()
    bom = payload.startswith(b"\xef\xbb\xbf")
    encoded = payload[3:] if bom else payload
    try:
        text = encoded.decode("utf-8")
    except UnicodeDecodeError as error:
        raise MigrationError("INVALID_UTF8", safe_label(root, path)) from error
    newline = "\r\n" if "\r\n" in text else "\n"
    final_newline = text.endswith("\n")
    return payload, text, bom, newline, final_newline


def reject_duplicate_json_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise MigrationError("DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def reject_non_finite_json_number(_: str) -> None:
    raise MigrationError("INVALID_JSON_NUMBER")


def parse_json_text(text: str, label: str, invalid_code: str) -> object:
    try:
        return json.loads(
            text,
            object_pairs_hook=reject_duplicate_json_pairs,
            parse_constant=reject_non_finite_json_number,
        )
    except MigrationError as error:
        raise MigrationError(error.code, label) from error
    except json.JSONDecodeError as error:
        raise MigrationError(invalid_code, label) from error


def load_structured_document(path: Path, root: Path) -> StructuredDocument:
    original, text, bom, newline, final_newline = decode_source(path, root)
    label = safe_label(root, path)
    stripped = text.lstrip()
    if not stripped:
        raise MigrationError("EMPTY_DOCUMENT", label)
    if stripped[0] in "[{":
        data = parse_json_text(text, label, "INVALID_JSON")
        kind = "json"
    else:
        data = parse_yaml_subset(text, label)
        kind = "yaml"
    return StructuredDocument(path, label, original, kind, data, bom, newline, final_newline)


def split_unquoted_comment(text: str) -> tuple[str, bool]:
    quote: str | None = None
    escaped = False
    depth = 0
    for index, character in enumerate(text):
        if escaped:
            escaped = False
            continue
        if quote == '"' and character == "\\":
            escaped = True
            continue
        if quote is not None:
            if character == quote:
                quote = None
            continue
        if character in {'"', "'"}:
            quote = character
        elif character in "[{(":
            depth += 1
        elif character in "]})":
            depth -= 1
        elif character == "#" and depth == 0 and (index == 0 or text[index - 1].isspace()):
            return text[:index].rstrip(), True
    return text.rstrip(), False


def tokenize_yaml(text: str, label: str) -> list[YamlToken]:
    lines = text.splitlines()
    tokens: list[YamlToken] = []
    index = 0
    while index < len(lines):
        raw = lines[index]
        if "\t" in raw[: len(raw) - len(raw.lstrip(" \t"))]:
            raise MigrationError("UNSUPPORTED_YAML", label)
        stripped = raw.strip()
        if not stripped:
            index += 1
            continue
        if stripped in {"---", "..."}:
            raise MigrationError("UNSUPPORTED_YAML", label)
        indent = len(raw) - len(raw.lstrip(" "))
        code, had_comment = split_unquoted_comment(raw[indent:])
        if had_comment or not code:
            raise MigrationError("UNSUPPORTED_YAML", label)
        if re.search(r"(^|[\s:])<<\s*:", code) or re.search(r"(^|[\s:\[,])(?:[&*!])[^\s,}\]]+", code):
            raise MigrationError("UNSUPPORTED_YAML", label)
        block_match = re.match(r"^(.*:\s*)([|>])([-+]?)\s*$", code)
        if block_match is None:
            tokens.append(YamlToken(indent, code))
            index += 1
            continue
        style = block_match.group(2)
        chomping = block_match.group(3)
        if style == ">" or chomping == "+":
            raise MigrationError("UNSUPPORTED_YAML", label)
        block_lines: list[str] = []
        index += 1
        while index < len(lines):
            candidate = lines[index]
            candidate_indent = len(candidate) - len(candidate.lstrip(" "))
            if candidate.strip() and candidate_indent <= indent:
                break
            block_lines.append(candidate)
            index += 1
        non_empty_indents = [
            len(item) - len(item.lstrip(" "))
            for item in block_lines
            if item.strip()
        ]
        content_indent = min(non_empty_indents) if non_empty_indents else indent + 2
        content_lines = [item[content_indent:] if item.strip() else "" for item in block_lines]
        block_value = "\n".join(content_lines)
        if chomping != "-":
            block_value += "\n"
        tokens.append(
            YamlToken(
                indent,
                block_match.group(1) + "__NEXTAGENT_BLOCK__",
                block_value,
            )
        )
    return tokens


def split_mapping(text: str, label: str) -> tuple[str, str]:
    quote: str | None = None
    escaped = False
    depth = 0
    for index, character in enumerate(text):
        if escaped:
            escaped = False
            continue
        if quote == '"' and character == "\\":
            escaped = True
            continue
        if quote is not None:
            if character == quote:
                quote = None
            continue
        if character in {'"', "'"}:
            quote = character
        elif character in "[{":
            depth += 1
        elif character in "]}":
            depth -= 1
        elif character == ":" and depth == 0:
            key = text[:index].strip()
            if not key:
                raise MigrationError("INVALID_YAML", label)
            return key, text[index + 1 :].strip()
    raise MigrationError("INVALID_YAML", label)


def split_flow_items(text: str, label: str) -> list[str]:
    items: list[str] = []
    quote: str | None = None
    escaped = False
    depth = 0
    start = 0
    for index, character in enumerate(text):
        if escaped:
            escaped = False
            continue
        if quote == '"' and character == "\\":
            escaped = True
            continue
        if quote is not None:
            if character == quote:
                quote = None
            continue
        if character in {'"', "'"}:
            quote = character
        elif character in "[{":
            depth += 1
        elif character in "]}":
            depth -= 1
        elif character == "," and depth == 0:
            items.append(text[start:index].strip())
            start = index + 1
    if quote is not None or depth != 0:
        raise MigrationError("UNSUPPORTED_YAML", label)
    tail = text[start:].strip()
    if tail:
        items.append(tail)
    return items


def parse_yaml_key(value: str, label: str) -> str:
    parsed = parse_yaml_scalar(value, label)
    if not isinstance(parsed, str) or not parsed:
        raise MigrationError("INVALID_YAML", label)
    return parsed


def parse_yaml_scalar(value: str, label: str) -> object:
    if value == "__NEXTAGENT_BLOCK__":
        raise MigrationError("INVALID_YAML", label)
    lowered = value.lower()
    if lowered in {"null", "~"}:
        return None
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    if value.startswith('"'):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError as error:
            raise MigrationError("INVALID_YAML", label) from error
        if not isinstance(parsed, str):
            raise MigrationError("INVALID_YAML", label)
        return parsed
    if value.startswith("'"):
        if len(value) < 2 or not value.endswith("'"):
            raise MigrationError("INVALID_YAML", label)
        return value[1:-1].replace("''", "'")
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        return [] if not inner else [parse_yaml_scalar(item, label) for item in split_flow_items(inner, label)]
    if value.startswith("{") and value.endswith("}"):
        inner = value[1:-1].strip()
        result: dict[str, object] = {}
        if not inner:
            return result
        for item in split_flow_items(inner, label):
            key_text, item_value = split_mapping(item, label)
            key = parse_yaml_key(key_text, label)
            if key in result:
                raise MigrationError("DUPLICATE_YAML_KEY", label)
            result[key] = parse_yaml_scalar(item_value, label)
        return result
    if value.startswith(("&", "*", "!")):
        raise MigrationError("UNSUPPORTED_YAML", label)
    if re.fullmatch(r"[-+]?(?:0|[1-9][0-9]*)", value):
        return int(value)
    if re.fullmatch(r"[-+]?(?:[0-9]+\.[0-9]*|[0-9]*\.[0-9]+)(?:[eE][-+]?[0-9]+)?", value):
        return float(value)
    return value


class YamlSubsetParser:
    def __init__(self, tokens: list[YamlToken], label: str) -> None:
        self.tokens = tokens
        self.label = label

    def parse(self) -> object:
        if not self.tokens:
            raise MigrationError("EMPTY_DOCUMENT", self.label)
        if self.tokens[0].indent != 0:
            raise MigrationError("INVALID_YAML", self.label)
        value, index = self.parse_node(0, 0)
        if index != len(self.tokens):
            raise MigrationError("INVALID_YAML", self.label)
        return value

    def parse_node(self, index: int, indent: int) -> tuple[object, int]:
        if index >= len(self.tokens) or self.tokens[index].indent != indent:
            raise MigrationError("INVALID_YAML", self.label)
        if self.tokens[index].text == "-" or self.tokens[index].text.startswith("- "):
            return self.parse_sequence(index, indent)
        return self.parse_mapping(index, indent)

    def parse_mapping(self, index: int, indent: int) -> tuple[dict[str, object], int]:
        result: dict[str, object] = {}
        while index < len(self.tokens):
            token = self.tokens[index]
            if token.indent < indent:
                break
            if token.indent != indent or token.text == "-" or token.text.startswith("- "):
                break
            key_text, value_text = split_mapping(token.text, self.label)
            key = parse_yaml_key(key_text, self.label)
            if key in result:
                raise MigrationError("DUPLICATE_YAML_KEY", self.label)
            index += 1
            if token.block_value is not None:
                result[key] = token.block_value
            elif value_text:
                result[key] = parse_yaml_scalar(value_text, self.label)
            elif index < len(self.tokens) and self.tokens[index].indent > indent:
                nested_indent = self.tokens[index].indent
                result[key], index = self.parse_node(index, nested_indent)
            else:
                result[key] = None
        return result, index

    def parse_sequence(self, index: int, indent: int) -> tuple[list[object], int]:
        result: list[object] = []
        while index < len(self.tokens):
            token = self.tokens[index]
            if token.indent != indent or not (token.text == "-" or token.text.startswith("- ")):
                break
            remainder = token.text[1:].strip()
            index += 1
            if not remainder:
                if index >= len(self.tokens) or self.tokens[index].indent <= indent:
                    result.append(None)
                else:
                    item, index = self.parse_node(index, self.tokens[index].indent)
                    result.append(item)
                continue
            try:
                key_text, value_text = split_mapping(remainder, self.label)
            except MigrationError:
                result.append(parse_yaml_scalar(remainder, self.label))
                continue
            item_map: dict[str, object] = {}
            key = parse_yaml_key(key_text, self.label)
            if token.block_value is not None:
                item_map[key] = token.block_value
            elif value_text:
                item_map[key] = parse_yaml_scalar(value_text, self.label)
            elif index < len(self.tokens) and self.tokens[index].indent > indent:
                item_map[key], index = self.parse_node(index, self.tokens[index].indent)
            else:
                item_map[key] = None
            if index < len(self.tokens) and self.tokens[index].indent > indent:
                continuation_indent = self.tokens[index].indent
                continuation, index = self.parse_mapping(index, continuation_indent)
                for continuation_key, continuation_value in continuation.items():
                    if continuation_key in item_map:
                        raise MigrationError("DUPLICATE_YAML_KEY", self.label)
                    item_map[continuation_key] = continuation_value
            result.append(item_map)
        return result, index


def parse_yaml_subset(text: str, label: str) -> object:
    return YamlSubsetParser(tokenize_yaml(text, label), label).parse()


def yaml_key(value: str) -> str:
    if re.fullmatch(r"[A-Za-z0-9_.-]+", value):
        return value
    return json.dumps(value, ensure_ascii=False)


def yaml_scalar(value: object) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return json.dumps(value)
    if not isinstance(value, str):
        raise TypeError("YAML scalar must be a JSON scalar")
    if "\n" in value:
        raise TypeError("multiline strings are emitted by the structured dumper")
    if (
        value
        and re.fullmatch(r"[A-Za-z0-9_./:@+\-]+", value)
        and value.lower() not in {"null", "true", "false", "~"}
        and not re.fullmatch(r"[-+]?[0-9]+(?:\.[0-9]+)?", value)
    ):
        return value
    return json.dumps(value, ensure_ascii=False)


def dump_yaml_lines(value: object, indent: int = 0) -> list[str]:
    prefix = " " * indent
    if isinstance(value, dict):
        lines: list[str] = []
        for key, item in value.items():
            if not isinstance(key, str):
                raise TypeError("YAML mapping keys must be strings")
            rendered_key = yaml_key(key)
            if isinstance(item, str) and "\n" in item:
                style = "|" if item.endswith("\n") else "|-"
                lines.append(f"{prefix}{rendered_key}: {style}")
                body = item[:-1] if item.endswith("\n") else item
                for body_line in body.split("\n"):
                    lines.append(" " * (indent + 2) + body_line)
            elif isinstance(item, dict):
                if item:
                    lines.append(f"{prefix}{rendered_key}:")
                    lines.extend(dump_yaml_lines(item, indent + 2))
                else:
                    lines.append(f"{prefix}{rendered_key}: {{}}")
            elif isinstance(item, list):
                if item:
                    lines.append(f"{prefix}{rendered_key}:")
                    lines.extend(dump_yaml_lines(item, indent + 2))
                else:
                    lines.append(f"{prefix}{rendered_key}: []")
            else:
                lines.append(f"{prefix}{rendered_key}: {yaml_scalar(item)}")
        return lines
    if isinstance(value, list):
        lines = []
        for item in value:
            if isinstance(item, dict) and item:
                entries = list(item.items())
                first_key, first_value = entries[0]
                rendered_key = yaml_key(first_key)
                if isinstance(first_value, (dict, list)):
                    if first_value:
                        lines.append(f"{prefix}- {rendered_key}:")
                        lines.extend(dump_yaml_lines(first_value, indent + 4))
                    else:
                        empty = "{}" if isinstance(first_value, dict) else "[]"
                        lines.append(f"{prefix}- {rendered_key}: {empty}")
                elif isinstance(first_value, str) and "\n" in first_value:
                    style = "|" if first_value.endswith("\n") else "|-"
                    lines.append(f"{prefix}- {rendered_key}: {style}")
                    body = first_value[:-1] if first_value.endswith("\n") else first_value
                    lines.extend(" " * (indent + 4) + line for line in body.split("\n"))
                else:
                    lines.append(f"{prefix}- {rendered_key}: {yaml_scalar(first_value)}")
                if len(entries) > 1:
                    lines.extend(dump_yaml_lines(dict(entries[1:]), indent + 2))
            elif isinstance(item, (dict, list)):
                empty = "{}" if isinstance(item, dict) else "[]"
                lines.append(f"{prefix}- {empty}")
            else:
                lines.append(f"{prefix}- {yaml_scalar(item)}")
        return lines
    raise TypeError("YAML document root must be a mapping or sequence")


def encode_text(text: str, *, bom: bool, newline: str) -> bytes:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    payload = normalized.replace("\n", newline).encode("utf-8")
    return (b"\xef\xbb\xbf" if bom else b"") + payload


def render_structured(document: StructuredDocument, data: object) -> bytes:
    if document.kind == "json":
        text = json.dumps(data, ensure_ascii=False, indent=2)
    else:
        text = "\n".join(dump_yaml_lines(data))
    if document.final_newline:
        text += "\n"
    return encode_text(text, bom=document.bom, newline=document.newline)


def require_object(value: object, code: str, label: str) -> dict[str, object]:
    if not isinstance(value, dict) or any(not isinstance(key, str) for key in value):
        raise MigrationError(code, label)
    return value


def require_array(value: object, code: str, label: str) -> list[object]:
    if not isinstance(value, list):
        raise MigrationError(code, label)
    return value


def require_string(value: object, code: str, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise MigrationError(code, label)
    return value


def require_model_id(value: object, label: str) -> str:
    model_id = require_string(value, "INVALID_MODEL_ID", label)
    if (
        model_id != model_id.strip()
        or len(model_id) > 256
        or any(ord(character) < 32 or 127 <= ord(character) <= 159 for character in model_id)
    ):
        raise MigrationError("INVALID_MODEL_ID", label)
    return model_id


def require_profile_id(value: object, label: str) -> str:
    profile_id = require_string(value, "INVALID_PROFILE_ID", label)
    if (
        profile_id != profile_id.strip()
        or len(profile_id) > 256
        or any(ord(character) < 32 or 127 <= ord(character) <= 159 for character in profile_id)
    ):
        raise MigrationError("INVALID_PROFILE_ID", label)
    return profile_id


def require_display_name(value: object, label: str) -> str:
    display_name = require_string(value, "INVALID_DISPLAY_NAME", label)
    if (
        display_name != display_name.strip()
        or len(display_name) > 256
        or any(ord(character) < 32 or 127 <= ord(character) <= 159 for character in display_name)
    ):
        raise MigrationError("INVALID_DISPLAY_NAME", label)
    return display_name


def is_env_reference(value: str) -> bool:
    return value.startswith("env:") and len(value) > len("env:")


def require_base_url(value: object, label: str) -> str:
    base_url = require_string(value, "OPENAI_BASE_URL_REQUIRED", label)
    if is_env_reference(base_url):
        if base_url != base_url.strip() or any(
            ord(character) < 32 or 127 <= ord(character) <= 159
            for character in base_url
        ):
            raise MigrationError("OPENAI_BASE_URL_INVALID", label)
        return base_url
    parsed = urlsplit(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise MigrationError("OPENAI_BASE_URL_INVALID", label)
    return base_url


def require_credential_reference(value: object, label: str) -> str:
    credential_ref = require_string(value, "INVALID_CREDENTIAL_REFERENCE", label)
    if not re.fullmatch(r"(?:env|file):.+", credential_ref):
        raise MigrationError("INVALID_CREDENTIAL_REFERENCE", label)
    return credential_ref


def is_safe_integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and abs(value) <= MAX_SAFE_INTEGER


def merge_provider_options(
    base: dict[str, object],
    additions: dict[str, object],
    label: str,
) -> dict[str, object]:
    result = dict(base)
    for key, value in additions.items():
        normalized = re.sub(r"[^a-z0-9]", "", key.lower())
        if normalized in RESERVED_OPTION_KEYS:
            raise MigrationError("RESERVED_PROVIDER_OPTION", label)
        if key in result and result[key] != value:
            raise MigrationError("PROVIDER_OPTION_CONFLICT", label)
        result[key] = value
    return result


def normalize_model_options(value: object, label: str) -> dict[str, object]:
    options = require_object(value, "INVALID_MODEL_OPTIONS", label)
    result: dict[str, object] = {}
    extensions: dict[str, object] = {}
    for key, item in options.items():
        if key in INFERENCE_FIELDS:
            validate_inference_value(key, item, label)
            result[key] = item
        elif key == "providerOptions":
            nested = require_object(item, "INVALID_PROVIDER_OPTIONS", label)
            extensions = merge_provider_options(extensions, nested, label)
        else:
            extensions = merge_provider_options(extensions, {key: item}, label)
    if extensions:
        result["providerOptions"] = extensions
    return result


def is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate_inference_value(key: str, value: object, label: str) -> None:
    if key == "temperature" and (not is_number(value) or not 0 <= value <= 2):
        raise MigrationError("INVALID_MODEL_OPTIONS", label)
    if key == "maxOutputTokens" and (
        not is_safe_integer(value) or value <= 0
    ):
        raise MigrationError("INVALID_MODEL_OPTIONS", label)
    if key == "topP" and (not is_number(value) or not 0 <= value <= 1):
        raise MigrationError("INVALID_MODEL_OPTIONS", label)
    if key == "topK" and (
        not is_safe_integer(value) or value <= 0
    ):
        raise MigrationError("INVALID_MODEL_OPTIONS", label)
    if key in {"presencePenalty", "frequencyPenalty"} and (
        not is_number(value) or not -2 <= value <= 2
    ):
        raise MigrationError("INVALID_MODEL_OPTIONS", label)
    if key == "thinking":
        thinking = require_object(value, "INVALID_MODEL_OPTIONS", label)
        if set(thinking) != {"depth"} or thinking.get("depth") not in {
            "OFF",
            "LOW",
            "MEDIUM",
            "HIGH",
        }:
            raise MigrationError("INVALID_MODEL_OPTIONS", label)


def provider_id_for_kind(kind: str, label: str) -> str:
    if kind == "OPENAI":
        return "openai-compatible"
    if kind == "MODEL_GATEWAY":
        return "model-gateway"
    raise MigrationError("UNSUPPORTED_PROVIDER_KIND", label)


def validate_target_model(model: dict[str, object], provider_id: str, label: str) -> str:
    if set(model) - TARGET_MODEL_KEYS:
        raise MigrationError("UNKNOWN_TARGET_MODEL_FIELD", label)
    model_id = require_model_id(model.get("modelId"), label)
    if "displayName" in model:
        require_display_name(model["displayName"], label)
    if not isinstance(model.get("fallbackEligible"), bool):
        raise MigrationError("INVALID_FALLBACK_ELIGIBLE", label)
    if provider_id == "openai-compatible":
        context_window = model.get("contextWindowTokens")
        if not is_safe_integer(context_window) or context_window <= 0:
            raise MigrationError("INVALID_CONTEXT_WINDOW", label)
    elif "contextWindowTokens" in model:
        raise MigrationError("MODEL_GATEWAY_CONTEXT_WINDOW_FORBIDDEN", label)
    for field in INFERENCE_FIELDS:
        if field in model:
            validate_inference_value(field, model[field], label)
    if "providerOptions" in model:
        provider_options = require_object(
            model["providerOptions"],
            "INVALID_PROVIDER_OPTIONS",
            label,
        )
        merge_provider_options({}, provider_options, label)
    if "timeoutMs" in model:
        timeout = model["timeoutMs"]
        if not is_safe_integer(timeout) or timeout <= 0:
            raise MigrationError("INVALID_TIMEOUT", label)
    if "maxRetries" in model:
        max_retries = model["maxRetries"]
        if not is_safe_integer(max_retries) or max_retries < 0:
            raise MigrationError("INVALID_MAX_RETRIES", label)
    return model_id


def target_mapping(profiles: list[object], label: str) -> ModelMapping:
    target_ids: set[str] = set()
    target_order: list[str] = []
    model_to_kind: dict[str, str] = {}
    provider_ids: set[str] = set()
    for provider_value in profiles:
        provider = require_object(provider_value, "INVALID_TARGET_MODEL_PROFILE", label)
        if set(provider) - TARGET_PROVIDER_KEYS:
            raise MigrationError("UNKNOWN_TARGET_PROVIDER_FIELD", label)
        provider_id = require_string(provider.get("providerId"), "INVALID_TARGET_MODEL_PROFILE", label)
        kind = "OPENAI" if provider_id == "openai-compatible" else "MODEL_GATEWAY" if provider_id == "model-gateway" else ""
        if not kind:
            raise MigrationError("UNSUPPORTED_PROVIDER_KIND", label)
        if provider_id in provider_ids:
            raise MigrationError("DUPLICATE_TARGET_PROVIDER_ID", label)
        provider_ids.add(provider_id)
        if provider_id == "openai-compatible":
            require_base_url(provider.get("baseUrl"), label)
        elif "baseUrl" in provider:
            raise MigrationError("MODEL_GATEWAY_ACCESS_REQUIRES_MANUAL_MIGRATION", label)
        if "credentialRef" in provider:
            require_credential_reference(provider["credentialRef"], label)
        models = require_array(provider.get("models"), "INVALID_TARGET_MODEL_PROFILE", label)
        if not models:
            raise MigrationError("NO_MODEL_PROFILES", label)
        for model_value in models:
            model = require_object(model_value, "INVALID_TARGET_MODEL_PROFILE", label)
            model_id = validate_target_model(model, provider_id, label)
            if model_id in target_ids:
                raise MigrationError("DUPLICATE_MODEL_ID", label)
            target_ids.add(model_id)
            target_order.append(model_id)
            model_to_kind[model_id] = kind
    return ModelMapping({}, model_to_kind, set(), target_ids, tuple(target_order))


def migrate_system_config(
    document: StructuredDocument,
) -> tuple[dict[str, object], ModelMapping, tuple[tuple[str, str], ...], bool]:
    root = require_object(document.data, "INVALID_SYSTEM_CONFIG", document.label)
    profiles = require_array(root.get("modelProfiles"), "INVALID_MODEL_PROFILES", document.label)
    if not profiles:
        raise MigrationError("NO_MODEL_PROFILES", document.label)
    target_flags = [isinstance(item, dict) and "providerId" in item and "models" in item for item in profiles]
    source_flags = [isinstance(item, dict) and "profileId" in item for item in profiles]
    if all(target_flags):
        return root, target_mapping(profiles, document.label), (), False
    if any(target_flags) or not all(source_flags):
        raise MigrationError("SOURCE_TARGET_MIXED", document.label)

    provider_groups: dict[str, dict[str, object]] = {}
    provider_access: dict[str, tuple[object, object]] = {}
    seen_profile_ids: set[str] = set()
    profile_to_model: dict[str, str] = {}
    model_to_kind: dict[str, str] = {}
    disabled_refs: set[str] = set()
    target_ids: set[str] = set()
    target_order: list[str] = []
    mappings: list[tuple[str, str]] = []

    for value in profiles:
        source = require_object(value, "INVALID_MODEL_PROFILE", document.label)
        unknown_keys = set(source) - LEGACY_PROFILE_KEYS
        if unknown_keys:
            raise MigrationError("UNKNOWN_PROFILE_FIELD", document.label)
        profile_id = require_profile_id(source.get("profileId"), document.label)
        if profile_id in seen_profile_ids:
            raise MigrationError("DUPLICATE_PROFILE_ID", document.label)
        seen_profile_ids.add(profile_id)
        model_name = require_model_id(source.get("modelName"), document.label)
        provider_kind = require_string(source.get("providerKind"), "UNSUPPORTED_PROVIDER_KIND", document.label)
        provider_id = provider_id_for_kind(provider_kind, document.label)
        enabled = source.get("enabled")
        if not isinstance(enabled, bool):
            raise MigrationError("INVALID_ENABLED", document.label)
        if not enabled:
            disabled_refs.update({profile_id, model_name})
            continue
        if model_name in target_ids:
            raise MigrationError("DUPLICATE_MODEL_ID", document.label)
        target_ids.add(model_name)
        target_order.append(model_name)
        profile_to_model[profile_id] = model_name
        model_to_kind[model_name] = provider_kind
        mappings.append((profile_id, model_name))

        base_url = source.get("baseUrl")
        credential_ref = source.get("credentialRef")
        if provider_id == "openai-compatible":
            base_url = require_base_url(base_url, document.label)
        elif base_url is not None:
            raise MigrationError("MODEL_GATEWAY_ACCESS_REQUIRES_MANUAL_MIGRATION", document.label)
        if credential_ref is not None:
            credential_ref = require_credential_reference(credential_ref, document.label)
        access = (base_url, credential_ref)
        if provider_id in provider_access and provider_access[provider_id] != access:
            raise MigrationError("PROVIDER_ACCESS_CONFLICT", document.label)
        provider_access[provider_id] = access
        if provider_id not in provider_groups:
            provider_groups[provider_id] = {
                "providerId": provider_id,
                **({"baseUrl": base_url} if base_url is not None else {}),
                **({"credentialRef": credential_ref} if credential_ref is not None else {}),
                "models": [],
            }

        fallback = source.get("fallbackEligible")
        if not isinstance(fallback, bool):
            raise MigrationError("INVALID_FALLBACK_ELIGIBLE", document.label)
        model: dict[str, object] = {"modelId": model_name}
        if source.get("displayName") is not None:
            model["displayName"] = require_display_name(source["displayName"], document.label)
        if provider_id == "openai-compatible":
            context_window = source.get("contextWindowTokens")
            if not is_safe_integer(context_window) or context_window <= 0:
                raise MigrationError("INVALID_CONTEXT_WINDOW", document.label)
            model["contextWindowTokens"] = context_window
        model["fallbackEligible"] = fallback

        raw_options = source.get("modelOptions", {})
        normalized_options = normalize_model_options(raw_options, document.label)
        source_provider_options = merge_provider_options(
            {},
            require_object(
                source.get("providerOptions", {}),
                "INVALID_PROVIDER_OPTIONS",
                document.label,
            ),
            document.label,
        )
        extensions = require_object(normalized_options.pop("providerOptions", {}), "INVALID_PROVIDER_OPTIONS", document.label)
        merged_extensions = merge_provider_options(source_provider_options, extensions, document.label)
        for field in INFERENCE_FIELDS:
            if field in normalized_options:
                model[field] = normalized_options[field]
        if merged_extensions:
            model["providerOptions"] = merged_extensions
        timeout = source.get("timeoutMs")
        if timeout is not None:
            if not is_safe_integer(timeout) or timeout <= 0:
                raise MigrationError("INVALID_TIMEOUT", document.label)
            model["timeoutMs"] = timeout
        max_retries = source.get("maxRetries")
        if max_retries is not None:
            if not is_safe_integer(max_retries) or max_retries < 0:
                raise MigrationError("INVALID_MAX_RETRIES", document.label)
            model["maxRetries"] = max_retries
        models = provider_groups[provider_id]["models"]
        if not isinstance(models, list):
            raise MigrationError("INVALID_MODEL_PROFILES", document.label)
        models.append(model)

    if not target_ids:
        raise MigrationError("NO_ENABLED_MODELS", document.label)
    updated = dict(root)
    updated["modelProfiles"] = list(provider_groups.values())
    mapping = ModelMapping(
        profile_to_model,
        model_to_kind,
        disabled_refs,
        target_ids,
        tuple(target_order),
    )
    return updated, mapping, tuple(mappings), True


def migrate_agent(data: object, mapping: ModelMapping, label: str) -> tuple[dict[str, object], tuple[str, ...]]:
    agent = dict(require_object(data, "INVALID_AGENT_DEFINITION", label))
    runtime = agent.get("runtimeSettings")
    runtime_object = {} if runtime is None else dict(require_object(runtime, "INVALID_RUNTIME_SETTINGS", label))
    has_source_ids = "modelProfileIds" in agent
    has_target_ids = "modelIds" in agent
    has_source_default = "defaultModelProfileId" in runtime_object
    has_target_default = "defaultModelId" in agent
    if (has_source_ids and has_target_ids) or (has_source_default and has_target_default):
        raise MigrationError("SOURCE_TARGET_MIXED", label)
    reasons: list[str] = []
    inherited_dynamic_model = False
    if has_source_ids:
        values = require_array(agent.pop("modelProfileIds"), "INVALID_MODEL_REFERENCE", label)
        resolved = [mapping.resolve(value, label) for value in values]
        if not resolved or len(set(resolved)) != len(resolved):
            raise MigrationError("INVALID_MODEL_REFERENCE", label)
        if any(is_env_reference(model_id) for model_id in resolved):
            if len(mapping.target_model_order) != 1 or resolved != list(mapping.target_model_order):
                raise MigrationError("DYNAMIC_MODEL_REFERENCE_REQUIRES_MANUAL_MIGRATION", label)
            inherited_dynamic_model = True
            reasons.append("AGENT_MODEL_IDS_INHERITED")
        else:
            agent["modelIds"] = resolved
            reasons.append("AGENT_MODEL_IDS")
    elif has_target_ids:
        values = require_array(agent["modelIds"], "INVALID_MODEL_REFERENCE", label)
        resolved = [mapping.resolve_static(value, label) for value in values]
        if not resolved or len(set(resolved)) != len(resolved) or resolved != values:
            raise MigrationError("INVALID_MODEL_REFERENCE", label)
    if has_source_default:
        default_model = mapping.resolve(runtime_object.pop("defaultModelProfileId"), label)
        if is_env_reference(default_model):
            inherits_only_configured_model = (
                mapping.target_model_order == (default_model,)
                and (
                    inherited_dynamic_model
                    or (not has_source_ids and not has_target_ids)
                )
            )
            if not inherits_only_configured_model:
                raise MigrationError("DYNAMIC_MODEL_REFERENCE_REQUIRES_MANUAL_MIGRATION", label)
            reasons.append("AGENT_DEFAULT_MODEL_INHERITED")
        else:
            agent["defaultModelId"] = default_model
            reasons.append("AGENT_DEFAULT_MODEL")
    elif has_target_default:
        mapping.resolve_static(agent["defaultModelId"], label)
    if runtime is not None:
        agent["runtimeSettings"] = runtime_object
    model_ids = agent.get("modelIds")
    default_model = agent.get("defaultModelId")
    if default_model is not None and isinstance(model_ids, list) and default_model not in model_ids:
        raise MigrationError("DEFAULT_MODEL_NOT_ACTIVATED", label)
    return agent, tuple(reasons)


def migrate_prompt(data: object, mapping: ModelMapping, label: str) -> tuple[dict[str, object], tuple[str, ...]]:
    prompt = dict(require_object(data, "INVALID_PROMPT_TEMPLATE", label))
    reasons: list[str] = []
    match_value = prompt.get("match")
    if match_value is not None:
        match = dict(require_object(match_value, "INVALID_PROMPT_MATCH", label))
        model_match = match.get("model")
        if isinstance(model_match, dict):
            if set(model_match) != {"providerKind", "modelName"}:
                raise MigrationError("INVALID_PROMPT_MODEL_MATCH", label)
            source_kind = require_string(model_match.get("providerKind"), "INVALID_PROMPT_MODEL_MATCH", label)
            model_id = mapping.resolve_static(model_match.get("modelName"), label)
            expected_kind = mapping.model_to_provider_kind.get(model_id)
            if expected_kind != source_kind:
                raise MigrationError("PROMPT_MODEL_PROVIDER_MISMATCH", label)
            match["model"] = model_id
            prompt["match"] = match
            reasons.append("PROMPT_MODEL_MATCH")
        elif model_match is not None:
            resolved = mapping.resolve_static(model_match, label)
            if resolved != model_match:
                match["model"] = resolved
                prompt["match"] = match
                reasons.append("PROMPT_MODEL_MATCH")
    if "modelOptions" in prompt:
        normalized = normalize_model_options(prompt["modelOptions"], label)
        if normalized != prompt["modelOptions"]:
            prompt["modelOptions"] = normalized
            reasons.append("PROMPT_MODEL_OPTIONS")
    return prompt, tuple(reasons)


def load_skill_document(path: Path, root: Path) -> SkillDocument:
    original, text, bom, newline, _ = decode_source(path, root)
    label = safe_label(root, path)
    normalized = text.replace("\r\n", "\n")
    match = re.match(r"\A---\n(.*?)\n---(\n|\Z)", normalized, flags=re.DOTALL)
    if match is None:
        raise MigrationError("INVALID_SKILL_FRONTMATTER", label)
    frontmatter = parse_yaml_subset(match.group(1), label)
    data = require_object(frontmatter, "INVALID_SKILL_FRONTMATTER", label)
    body = normalized[match.end() :]
    closing_newline = match.group(2)
    return SkillDocument(path, label, original, data, body, bom, newline, closing_newline)


def normalize_skill_option_value(value: object, label: str) -> object:
    if isinstance(value, str):
        parsed = parse_json_text(value, label, "INVALID_SKILL_MODEL_OPTIONS")
        normalized = normalize_model_options(parsed, label)
        return json.dumps(normalized, ensure_ascii=False, separators=(",", ":"))
    return normalize_model_options(value, label)


def migrate_skill_declaration(value: object, mapping: ModelMapping, label: str) -> object:
    if not isinstance(value, str):
        raise MigrationError("INVALID_SKILL_MODEL", label)
    stripped = value.strip()
    if not stripped.startswith("{"):
        return mapping.resolve_skill_model(value, label)
    declaration = parse_json_text(value, label, "INVALID_SKILL_MODEL")
    declaration_object = require_object(declaration, "INVALID_SKILL_MODEL", label)
    if set(declaration_object) - {"model", "modelOptions"}:
        raise MigrationError("INVALID_SKILL_MODEL", label)
    updated = dict(declaration_object)
    if "model" in updated:
        updated["model"] = mapping.resolve_skill_model(updated["model"], label)
    if "modelOptions" in updated:
        updated["modelOptions"] = normalize_model_options(updated["modelOptions"], label)
    return json.dumps(updated, ensure_ascii=False, separators=(",", ":"))


def skill_declaration_parts(value: object, label: str) -> tuple[str | None, dict[str, object] | None]:
    if not isinstance(value, str):
        raise MigrationError("INVALID_SKILL_MODEL", label)
    if not value.strip().startswith("{"):
        return value, None
    parsed = parse_json_text(value, label, "INVALID_SKILL_MODEL")
    declaration = require_object(parsed, "INVALID_SKILL_MODEL", label)
    model = declaration.get("model")
    if model is not None and not isinstance(model, str):
        raise MigrationError("INVALID_SKILL_MODEL", label)
    options = declaration.get("modelOptions")
    return model, None if options is None else require_object(options, "INVALID_SKILL_MODEL_OPTIONS", label)


def skill_options_object(value: object, label: str) -> dict[str, object]:
    if isinstance(value, str):
        parsed = parse_json_text(value, label, "INVALID_SKILL_MODEL_OPTIONS")
        return require_object(parsed, "INVALID_SKILL_MODEL_OPTIONS", label)
    return require_object(value, "INVALID_SKILL_MODEL_OPTIONS", label)


def validate_skill_declaration_consistency(frontmatter: dict[str, object], label: str) -> None:
    models: list[str] = []
    option_values: list[dict[str, object]] = []
    if "model" in frontmatter:
        model, options = skill_declaration_parts(frontmatter["model"], label)
        if model is not None:
            models.append(model)
        if options is not None:
            option_values.append(options)
    if "modelOptions" in frontmatter:
        option_values.append(skill_options_object(frontmatter["modelOptions"], label))
    metadata_value = frontmatter.get("metadata")
    if metadata_value is not None:
        metadata = require_object(metadata_value, "INVALID_SKILL_METADATA", label)
        for key in ("nextagent.model", "model"):
            if key in metadata:
                model, options = skill_declaration_parts(metadata[key], label)
                if model is not None:
                    models.append(model)
                if options is not None:
                    option_values.append(options)
        if "nextagent.modelOptions" in metadata:
            option_values.append(skill_options_object(metadata["nextagent.modelOptions"], label))
    if len(set(models)) > 1:
        raise MigrationError("CONFLICTING_SKILL_MODEL", label)
    serialized_options = {
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        for value in option_values
    }
    if len(serialized_options) > 1:
        raise MigrationError("CONFLICTING_SKILL_MODEL_OPTIONS", label)


def migrate_skill(frontmatter: dict[str, object], mapping: ModelMapping, label: str) -> tuple[dict[str, object], tuple[str, ...]]:
    updated = dict(frontmatter)
    reasons: list[str] = []
    if "model" in updated:
        migrated = migrate_skill_declaration(updated["model"], mapping, label)
        if migrated != updated["model"]:
            updated["model"] = migrated
            reasons.append("SKILL_MODEL")
    if "modelOptions" in updated:
        migrated_options = normalize_skill_option_value(updated["modelOptions"], label)
        if migrated_options != updated["modelOptions"]:
            updated["modelOptions"] = migrated_options
            reasons.append("SKILL_MODEL_OPTIONS")
    metadata_value = updated.get("metadata")
    if metadata_value is not None:
        metadata = dict(require_object(metadata_value, "INVALID_SKILL_METADATA", label))
        metadata_changed = False
        for key in ("nextagent.model", "model"):
            if key in metadata:
                migrated = migrate_skill_declaration(metadata[key], mapping, label)
                if migrated != metadata[key]:
                    metadata[key] = migrated
                    metadata_changed = True
        if "nextagent.modelOptions" in metadata:
            migrated_options = normalize_skill_option_value(metadata["nextagent.modelOptions"], label)
            if migrated_options != metadata["nextagent.modelOptions"]:
                metadata["nextagent.modelOptions"] = migrated_options
                metadata_changed = True
        if metadata_changed:
            updated["metadata"] = metadata
            reasons.append("SKILL_MODEL_METADATA")
    validate_skill_declaration_consistency(updated, label)
    return updated, tuple(reasons)


def render_skill(document: SkillDocument, frontmatter: dict[str, object]) -> bytes:
    frontmatter_text = "\n".join(dump_yaml_lines(frontmatter))
    text = "---\n" + frontmatter_text + "\n---" + document.closing_newline + document.body
    return encode_text(text, bom=document.bom, newline=document.newline)


def build_plan(options: Options) -> MigrationPlan:
    system_path, agent_paths, prompt_paths, skill_paths = discover_paths(options)
    system_document = load_structured_document(system_path, options.root)
    system_data, mapping, mappings, system_changed = migrate_system_config(system_document)
    planned: list[PlannedFile] = []
    if system_changed:
        planned.append(
            PlannedFile(
                system_document.path,
                system_document.label,
                system_document.original,
                render_structured(system_document, system_data),
                ("SYSTEM_MODEL_PROFILES",),
            )
        )

    for path in agent_paths:
        document = load_structured_document(path, options.root)
        updated, reasons = migrate_agent(document.data, mapping, document.label)
        if reasons:
            planned.append(
                PlannedFile(path, document.label, document.original, render_structured(document, updated), reasons)
            )

    for path in prompt_paths:
        document = load_structured_document(path, options.root)
        updated, reasons = migrate_prompt(document.data, mapping, document.label)
        if reasons:
            planned.append(
                PlannedFile(path, document.label, document.original, render_structured(document, updated), reasons)
            )

    for path in skill_paths:
        document = load_skill_document(path, options.root)
        updated, reasons = migrate_skill(document.frontmatter, mapping, document.label)
        if reasons:
            planned.append(
                PlannedFile(path, document.label, document.original, render_skill(document, updated), reasons)
            )

    planned.sort(key=lambda item: item.label)
    return MigrationPlan(options.root, tuple(planned), mappings)


def atomic_replace(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        if path.exists():
            shutil.copymode(path, temporary_path)
        os.replace(temporary_path, path)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()


def write_journal(path: Path, journal: dict[str, object]) -> None:
    atomic_replace(path, (json.dumps(journal, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


def create_run_id() -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{timestamp}-{secrets.token_hex(4)}"


def read_current_planned_source(root: Path, item: PlannedFile) -> bytes:
    target = resolve_write_target_under_root(root, item.path)
    if not target.is_file():
        raise MigrationError("SOURCE_CHANGED", item.label)
    return target.read_bytes()


def apply_plan(
    plan: MigrationPlan,
    *,
    replace_file: Callable[[Path, bytes], None] = atomic_replace,
) -> str | None:
    if not plan.files:
        return None
    for item in plan.files:
        if sha256(read_current_planned_source(plan.root, item)) != sha256(item.original):
            raise MigrationError("SOURCE_CHANGED", item.label)

    run_id = create_run_id()
    backup_root = resolve_directory_target_under_root(plan.root, BACKUP_ROOT)
    run_root = backup_root / run_id
    files_root = run_root / "files"
    files_root.mkdir(parents=True, exist_ok=False)
    journal_files: list[dict[str, object]] = []
    for item in plan.files:
        backup_path = files_root / Path(item.label)
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        backup_path.write_bytes(item.original)
        shutil.copymode(item.path, backup_path)
        journal_files.append(
            {
                "path": item.label,
                "backup": (Path("files") / Path(item.label)).as_posix(),
                "sourceSha256": sha256(item.original),
                "targetSha256": sha256(item.updated),
                "replaced": False,
            }
        )
    journal: dict[str, object] = {
        "version": TOOL_VERSION,
        "runId": run_id,
        "status": "prepared",
        "files": journal_files,
    }
    journal_path = run_root / "journal.json"
    write_journal(journal_path, journal)

    try:
        journal["status"] = "applying"
        write_journal(journal_path, journal)
        for index, item in enumerate(plan.files):
            if sha256(read_current_planned_source(plan.root, item)) != sha256(item.original):
                raise MigrationError("SOURCE_CHANGED", item.label)
            journal_files[index]["replaced"] = True
            write_journal(journal_path, journal)
            replace_file(item.path, item.updated)
        journal["status"] = "completed"
        write_journal(journal_path, journal)
        return run_id
    except Exception as error:
        rollback_failed = False
        for entry in reversed(journal_files):
            if entry.get("replaced") is not True:
                continue
            try:
                target = resolve_write_target_under_root(plan.root, str(entry["path"]))
                backup = resolve_under_root(
                    run_root,
                    str(entry["backup"]),
                    expected="file",
                    required=True,
                )
                if backup is None:
                    raise MigrationError("INVALID_BACKUP")
                backup_payload = backup.read_bytes()
                if sha256(backup_payload) != entry.get("sourceSha256"):
                    raise MigrationError("INVALID_BACKUP")
                if target.exists() and sha256(target.read_bytes()) not in {
                    entry.get("sourceSha256"),
                    entry.get("targetSha256"),
                }:
                    raise MigrationError("ROLLBACK_TARGET_CHANGED")
                atomic_replace(target, backup_payload)
                shutil.copymode(backup, target)
            except Exception:
                rollback_failed = True
        journal["status"] = "rollback_failed" if rollback_failed else "rolled_back"
        try:
            write_journal(journal_path, journal)
        except Exception:
            rollback_failed = True
        code = "WRITE_FAILED_ROLLBACK_INCOMPLETE" if rollback_failed else "WRITE_FAILED_ROLLED_BACK"
        if isinstance(error, MigrationError) and error.code == "SOURCE_CHANGED" and not rollback_failed:
            code = "SOURCE_CHANGED"
        raise MigrationError(code) from error


def recover_run(options: Options, run_id: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9._-]+", run_id):
        raise MigrationError("INVALID_RUN_ID")
    backup_root = resolve_directory_target_under_root(options.root, BACKUP_ROOT)
    run_root = backup_root / run_id
    journal_path = resolve_under_root(options.root, run_root / "journal.json", expected="file", required=True)
    if journal_path is None:
        raise MigrationError("INVALID_JOURNAL")
    try:
        journal = parse_json_text(
            journal_path.read_text(encoding="utf-8"),
            "journal",
            "INVALID_JOURNAL",
        )
    except (MigrationError, UnicodeDecodeError) as error:
        raise MigrationError("INVALID_JOURNAL") from error
    journal_object = require_object(journal, "INVALID_JOURNAL", "journal")
    if (
        set(journal_object) != {"version", "runId", "status", "files"}
        or journal_object.get("version") != TOOL_VERSION
        or journal_object.get("runId") != run_id
    ):
        raise MigrationError("INVALID_JOURNAL")
    status = journal_object.get("status")
    if status not in {"prepared", "applying", "rollback_failed"}:
        raise MigrationError("JOURNAL_NOT_RECOVERABLE")
    files = require_array(journal_object.get("files"), "INVALID_JOURNAL", "journal")
    recovery_files: list[tuple[Path, Path, bytes]] = []
    recovery_targets: set[Path] = set()
    for value in reversed(files):
        entry = require_object(value, "INVALID_JOURNAL", "journal")
        if set(entry) != {"path", "backup", "sourceSha256", "targetSha256", "replaced"}:
            raise MigrationError("INVALID_JOURNAL")
        if entry.get("replaced") is not True:
            continue
        target = resolve_write_target_under_root(
            options.root,
            require_string(entry.get("path"), "INVALID_JOURNAL", "journal"),
        )
        backup_relative = require_string(entry.get("backup"), "INVALID_JOURNAL", "journal")
        backup = resolve_under_root(run_root, backup_relative, expected="file", required=True)
        source_hash = require_string(entry.get("sourceSha256"), "INVALID_JOURNAL", "journal")
        target_hash = require_string(entry.get("targetSha256"), "INVALID_JOURNAL", "journal")
        if target in recovery_targets:
            raise MigrationError("INVALID_JOURNAL")
        recovery_targets.add(target)
        if backup is None:
            raise MigrationError("INVALID_JOURNAL")
        backup_payload = backup.read_bytes()
        if sha256(backup_payload) != source_hash:
            raise MigrationError("INVALID_JOURNAL")
        if target.exists() and sha256(target.read_bytes()) not in {source_hash, target_hash}:
            raise MigrationError("RECOVERY_TARGET_CHANGED", safe_label(options.root, target))
        recovery_files.append((target, backup, backup_payload))
    for target, backup, backup_payload in recovery_files:
        atomic_replace(target, backup_payload)
        shutil.copymode(backup, target)
    journal_object["status"] = "recovered"
    write_journal(journal_path, journal_object)


def print_plan(plan: MigrationPlan, *, applied: bool, run_id: str | None = None) -> None:
    if not plan.files:
        print("NO_CHANGES")
        return
    print(f"{'APPLIED' if applied else 'DRY_RUN'} {len(plan.files)} file(s)")
    for item in plan.files:
        print(f"FILE {item.label} {' '.join(item.reasons)}")
    for source, target in plan.mappings:
        print(f"MAP {source} -> {target}")
    if run_id is not None:
        print(f"BACKUP {BACKUP_ROOT.as_posix()}/{run_id}")
    elif not applied:
        print("Run again with --write to apply this plan.")


def main(arguments: Sequence[str] | None = None) -> int:
    try:
        options = parse_arguments(arguments)
        if options.recover is not None:
            recover_run(options, options.recover)
            print(f"RECOVERED {options.recover}")
            return 0
        plan = build_plan(options)
        if options.write:
            run_id = apply_plan(plan)
            print_plan(plan, applied=True, run_id=run_id)
        else:
            print_plan(plan, applied=False)
        return 0
    except MigrationError as error:
        print(f"ERROR {error.code} {error.label}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("ERROR INTERRUPTED project", file=sys.stderr)
        return 130
    except Exception:
        print("ERROR UNEXPECTED project", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
