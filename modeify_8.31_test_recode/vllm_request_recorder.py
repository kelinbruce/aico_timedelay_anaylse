#!/usr/bin/env python3
"""Record complete vLLM/OpenAI-compatible HTTP requests and responses.

The process is an asynchronous reverse proxy. Point clients at this process,
and set --upstream to the original vLLM-Ascend API address. One JSON object is
appended to the JSONL log after every response finishes (or is interrupted).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import time
import traceback
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncIterator

import httpx
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse


HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}


@dataclass
class Settings:
    upstream: str
    log_file: Path
    listen_host: str
    listen_port: int


settings: Settings
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
http_client: httpx.AsyncClient | None = None
log_lock: asyncio.Lock | None = None


def now_iso() -> str:
    return datetime.now().isoformat(timespec="milliseconds")


def elapsed_ms(start: float, end: float | None = None) -> float:
    return round(((end if end is not None else time.perf_counter()) - start) * 1000, 3)


def decode_body(body: bytes, content_type: str | None) -> Any:
    """Keep JSON structured; keep all other bodies as UTF-8 text."""
    if not body:
        return None
    text = body.decode("utf-8", errors="replace")
    if content_type and "json" in content_type.lower():
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass
    return text


def parse_sse_events(text: str) -> list[Any]:
    events: list[Any] = []
    for line in text.splitlines():
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if not data:
            continue
        if data == "[DONE]":
            events.append("[DONE]")
            continue
        try:
            events.append(json.loads(data))
        except json.JSONDecodeError:
            events.append(data)
    return events


def extract_answer(response_body: Any, is_sse: bool) -> dict[str, str] | None:
    """Create a searchable answer summary without replacing the full response."""
    objects: list[dict[str, Any]] = []
    if is_sse and isinstance(response_body, str):
        objects = [item for item in parse_sse_events(response_body) if isinstance(item, dict)]
    elif isinstance(response_body, dict):
        objects = [response_body]

    normal: dict[int, list[str]] = {}
    reasoning: dict[int, list[str]] = {}
    for obj in objects:
        for choice in obj.get("choices", []) or []:
            if not isinstance(choice, dict):
                continue
            index = int(choice.get("index", 0))
            source = choice.get("delta") or choice.get("message") or choice
            if not isinstance(source, dict):
                continue
            content = source.get("content")
            if content is None and "text" in choice:
                content = choice.get("text")
            if content is not None:
                normal.setdefault(index, []).append(str(content))
            reasoning_content = source.get("reasoning_content")
            if reasoning_content is not None:
                reasoning.setdefault(index, []).append(str(reasoning_content))

    result: dict[str, str] = {}
    for index, parts in sorted(normal.items()):
        result[f"choice_{index}"] = "".join(parts)
    for index, parts in sorted(reasoning.items()):
        result[f"choice_{index}_reasoning"] = "".join(parts)
    return result or None


def write_line_sync(line: str) -> None:
    settings.log_file.parent.mkdir(parents=True, exist_ok=True)
    # Prompts and answers may be sensitive. Newly created logs are owner-only.
    fd = os.open(settings.log_file, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(fd, "a", encoding="utf-8") as file:
        file.write(line)
        file.write("\n")
        file.flush()
        os.fsync(file.fileno())


async def append_log(record: dict[str, Any]) -> None:
    line = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
    assert log_lock is not None
    async with log_lock:
        await asyncio.to_thread(write_line_sync, line)


def filtered_request_headers(request: Request) -> dict[str, str]:
    headers: dict[str, str] = {}
    for name, value in request.headers.items():
        lowered = name.lower()
        if lowered in HOP_BY_HOP_HEADERS or lowered in {"host", "content-length", "accept-encoding"}:
            continue
        headers[name] = value
    client_ip = request.client.host if request.client else "unknown"
    previous = request.headers.get("x-forwarded-for")
    headers["x-forwarded-for"] = f"{previous}, {client_ip}" if previous else client_ip
    headers["x-forwarded-proto"] = request.url.scheme
    return headers


def filtered_response_headers(response: httpx.Response) -> dict[str, str]:
    headers: dict[str, str] = {}
    for name, value in response.headers.items():
        lowered = name.lower()
        if lowered in HOP_BY_HOP_HEADERS or lowered == "content-length":
            continue
        headers[name] = value
    return headers


def request_summary(body: Any) -> dict[str, Any] | None:
    if not isinstance(body, dict):
        return None
    return {
        key: body.get(key)
        for key in (
            "request_id",
            "model",
            "stream",
            "max_tokens",
            "max_completion_tokens",
            "temperature",
            "seed",
        )
        if key in body
    }


@app.on_event("startup")
async def startup() -> None:
    global http_client, log_lock
    limits = httpx.Limits(max_connections=1000, max_keepalive_connections=100)
    http_client = httpx.AsyncClient(timeout=None, limits=limits, trust_env=False)
    log_lock = asyncio.Lock()
    settings.log_file.parent.mkdir(parents=True, exist_ok=True)


@app.on_event("shutdown")
async def shutdown() -> None:
    if http_client is not None:
        await http_client.aclose()


@app.api_route(
    "/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
)
async def proxy(path: str, request: Request):
    assert http_client is not None
    started_perf = time.perf_counter()
    received_at = now_iso()
    proxy_request_id = str(uuid.uuid4())
    body_bytes = await request.body()
    request_content_type = request.headers.get("content-type")
    decoded_request = decode_body(body_bytes, request_content_type)
    query = request.url.query
    upstream_url = f"{settings.upstream.rstrip('/')}/{path}"
    if query:
        upstream_url = f"{upstream_url}?{query}"

    client = request.client
    record: dict[str, Any] = {
        "schema_version": 1,
        "proxy_request_id": proxy_request_id,
        "received_at": received_at,
        "method": request.method,
        "path": f"/{path}",
        "query": query or None,
        "client": {
            "host": client.host if client else None,
            "port": client.port if client else None,
        },
        "request_content_type": request_content_type,
        "request_bytes": len(body_bytes),
        "request_summary": request_summary(decoded_request),
        "request_body": decoded_request,
    }

    try:
        upstream_request = http_client.build_request(
            request.method,
            upstream_url,
            headers=filtered_request_headers(request),
            content=body_bytes,
        )
        upstream_response = await http_client.send(upstream_request, stream=True)
    except Exception as exc:
        record.update(
            {
                "completed_at": now_iso(),
                "total_duration_ms": elapsed_ms(started_perf),
                "status_code": 502,
                "outcome": "upstream_connect_error",
                "error": f"{type(exc).__name__}: {exc}",
                "traceback": traceback.format_exc(),
            }
        )
        await append_log(record)
        return JSONResponse(
            status_code=502,
            content={"error": "request recorder could not reach vLLM upstream", "detail": str(exc)},
        )

    headers_received_perf = time.perf_counter()
    headers_received_at = now_iso()
    response_content_type = upstream_response.headers.get("content-type", "")
    is_sse = "text/event-stream" in response_content_type.lower()

    async def stream_and_record() -> AsyncIterator[bytes]:
        chunks: list[bytes] = []
        first_byte_perf: float | None = None
        first_byte_at: str | None = None
        outcome = "completed"
        error: str | None = None
        try:
            async for chunk in upstream_response.aiter_raw():
                if chunk and first_byte_perf is None:
                    first_byte_perf = time.perf_counter()
                    first_byte_at = now_iso()
                chunks.append(chunk)
                yield chunk
        except asyncio.CancelledError:
            outcome = "client_disconnected"
            error = "downstream client disconnected before response completed"
            raise
        except Exception as exc:
            outcome = "stream_error"
            error = f"{type(exc).__name__}: {exc}"
            raise
        finally:
            await upstream_response.aclose()
            completed_perf = time.perf_counter()
            completed_at = now_iso()
            response_bytes = b"".join(chunks)
            response_body = decode_body(response_bytes, response_content_type)
            record.update(
                {
                    "upstream_headers_received_at": headers_received_at,
                    "first_response_byte_at": first_byte_at,
                    "completed_at": completed_at,
                    "upstream_header_latency_ms": elapsed_ms(started_perf, headers_received_perf),
                    "first_response_byte_latency_ms": (
                        elapsed_ms(started_perf, first_byte_perf) if first_byte_perf else None
                    ),
                    # For an SSE stream, the first response bytes normally contain
                    # the first generated event. For non-streaming JSON, this is not TTFT.
                    "ttft_ms": (
                        elapsed_ms(started_perf, first_byte_perf)
                        if is_sse and first_byte_perf
                        else None
                    ),
                    "total_duration_ms": elapsed_ms(started_perf, completed_perf),
                    "status_code": upstream_response.status_code,
                    "outcome": outcome,
                    "response_content_type": response_content_type or None,
                    "response_bytes": len(response_bytes),
                    "response_body": response_body,
                    "extracted_answer": extract_answer(response_body, is_sse),
                    "error": error,
                }
            )
            # Shield the final write so client cancellation does not lose the record.
            try:
                await asyncio.shield(append_log(record))
            except Exception:
                traceback.print_exc()

    return StreamingResponse(
        stream_and_record(),
        status_code=upstream_response.status_code,
        headers=filtered_response_headers(upstream_response),
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Reverse proxy that records complete vLLM requests, responses, and latency"
    )
    parser.add_argument("--upstream", default="http://127.0.0.1:9119")
    parser.add_argument("--listen-host", default="0.0.0.0")
    parser.add_argument("--listen-port", type=int, default=9120)
    parser.add_argument("--log-file", default="/tmp/vllm_request_records.jsonl")
    parser.add_argument("--log-level", default="warning")
    return parser.parse_args()


def main() -> None:
    global settings
    args = parse_args()
    settings = Settings(
        upstream=args.upstream,
        log_file=Path(args.log_file).expanduser().resolve(),
        listen_host=args.listen_host,
        listen_port=args.listen_port,
    )
    print(f"proxy     : http://{settings.listen_host}:{settings.listen_port}")
    print(f"upstream  : {settings.upstream}")
    print(f"JSONL log : {settings.log_file}")
    uvicorn.run(
        app,
        host=settings.listen_host,
        port=settings.listen_port,
        log_level=args.log_level,
        access_log=False,
    )


if __name__ == "__main__":
    main()
