#!/usr/bin/env python3
"""Render and count the exact DeepSeek-V4 prompt for one recorder JSONL entry.

Dependencies:
    python3 -m pip install tokenizers huggingface_hub

By default this script extracts proxy request
b9080f39-d86c-43e6-a4d6-23fd6d16f471 from dsv4_212_1_aico.jsonl,
applies DeepSeek-V4's official chat/tool template, writes the rendered prompt
next to this script, and compares its token count with usage.prompt_tokens.
"""

from __future__ import annotations

import argparse
import copy
import importlib.util
import json
from pathlib import Path
from types import ModuleType
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_SOURCE = (
    SCRIPT_DIR.parent
    / "aico_timedelay_test_report"
    / "deepseek0731"
    / "dsv4_212_1_aico.jsonl"
)
DEFAULT_OUTPUT = SCRIPT_DIR / "dsv4_212_1_b9080f39_request_rendered.txt"
DEFAULT_PROXY_REQUEST_ID = "b9080f39-d86c-43e6-a4d6-23fd6d16f471"

# Pin the exact official model revision used for this verification so future
# repository changes do not silently alter the result.
MODEL_REPO = "deepseek-ai/DeepSeek-V4-Flash"
MODEL_REVISION = "60d8d70770c6776ff598c94bb586a859a38244f1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render a recorder request and count it with DeepSeek-V4's tokenizer."
    )
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--proxy-request-id", default=DEFAULT_PROXY_REQUEST_ID)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--thinking-mode",
        choices=("chat", "thinking"),
        default="thinking",
        help="This recorded request matches usage in thinking mode (default: thinking).",
    )
    parser.add_argument(
        "--tokenizer-file",
        type=Path,
        help="Optional local tokenizer.json; otherwise download the pinned official file.",
    )
    parser.add_argument(
        "--encoding-file",
        type=Path,
        help="Optional local encoding_dsv4.py; otherwise download the pinned official file.",
    )
    return parser.parse_args()


def load_record(source: Path, proxy_request_id: str) -> dict[str, Any]:
    with source.open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, 1):
            record = json.loads(line)
            if record.get("proxy_request_id") == proxy_request_id:
                print(f"record: {source} line {line_number}")
                return record
    raise SystemExit(f"proxy_request_id not found: {proxy_request_id}")


def download_official_file(filename: str) -> Path:
    try:
        from huggingface_hub import hf_hub_download
    except ModuleNotFoundError as exc:
        raise SystemExit(
            "Missing dependency. Run: "
            "python3 -m pip install tokenizers huggingface_hub"
        ) from exc
    return Path(
        hf_hub_download(
            repo_id=MODEL_REPO,
            filename=filename,
            revision=MODEL_REVISION,
        )
    )


def load_encoding_module(path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location("official_encoding_dsv4", path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"Unable to import official encoder: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def attach_top_level_tools(request_body: dict[str, Any]) -> list[dict[str, Any]]:
    """Match DeepSeek-V4/vLLM behavior: attach tools to the first system message."""
    messages = copy.deepcopy(request_body.get("messages", []))
    tools = copy.deepcopy(request_body.get("tools", []))
    if not tools:
        return messages

    for message in messages:
        if message.get("role") == "system":
            message["tools"] = tools
            break
    else:
        messages.insert(0, {"role": "system", "content": "", "tools": tools})
    return messages


def extract_usage_prompt_tokens(record: dict[str, Any]) -> int | None:
    body = record.get("response_body")
    if isinstance(body, dict):
        usage = body.get("usage") or {}
        return usage.get("prompt_tokens")
    if not isinstance(body, str):
        return None

    result = None
    for line in body.splitlines():
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if not payload or payload == "[DONE]":
            continue
        event = json.loads(payload)
        usage = event.get("usage") or {}
        if usage.get("prompt_tokens") is not None:
            result = usage["prompt_tokens"]
    return result


def main() -> None:
    args = parse_args()
    record = load_record(args.source.resolve(), args.proxy_request_id)
    request_body = record.get("request_body")
    if not isinstance(request_body, dict):
        raise SystemExit("The selected record has no JSON request_body.")

    tokenizer_path = (
        args.tokenizer_file.resolve()
        if args.tokenizer_file
        else download_official_file("tokenizer.json")
    )
    encoding_path = (
        args.encoding_file.resolve()
        if args.encoding_file
        else download_official_file("encoding/encoding_dsv4.py")
    )

    try:
        from tokenizers import Tokenizer
    except ModuleNotFoundError as exc:
        raise SystemExit(
            "Missing dependency. Run: "
            "python3 -m pip install tokenizers huggingface_hub"
        ) from exc

    encoder = load_encoding_module(encoding_path)
    messages = attach_top_level_tools(request_body)
    rendered_prompt = encoder.encode_messages(
        messages=messages,
        thinking_mode=args.thinking_mode,
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered_prompt, encoding="utf-8")

    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    token_ids = tokenizer.encode(
        rendered_prompt,
        add_special_tokens=False,
    ).ids
    usage_prompt_tokens = extract_usage_prompt_tokens(record)

    print(f"output: {args.output.resolve()}")
    print(f"thinking_mode: {args.thinking_mode}")
    print(f"characters: {len(rendered_prompt)}")
    print(f"utf8_bytes: {len(rendered_prompt.encode('utf-8'))}")
    print(f"tokenizer_tokens: {len(token_ids)}")
    print(f"usage_prompt_tokens: {usage_prompt_tokens}")
    if usage_prompt_tokens is not None:
        print(f"difference: {len(token_ids) - usage_prompt_tokens}")


if __name__ == "__main__":
    main()
