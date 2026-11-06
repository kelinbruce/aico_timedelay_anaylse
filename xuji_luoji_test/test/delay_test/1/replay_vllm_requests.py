#!/usr/bin/env python3
"""Replay recorded request_body objects against a running vLLM HTTP server."""

import argparse
import copy
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_INPUT = Path(__file__).parent / "dsv_modify_0814/dsv4_3_aico.jsonl"


def delta_text(delta):
    """Extract generated text, never JSON-serialize protocol wrappers."""
    parts = [delta[key] for key in ("content", "reasoning", "reasoning_content")
             if isinstance(delta.get(key), str) and delta[key]]
    functions = [call.get("function") or {} for call in delta.get("tool_calls") or []]
    if delta.get("function_call"):
        functions.append(delta["function_call"])
    for function in functions:
        for key in ("name", "arguments"):
            if isinstance(function.get(key), str) and function[key]:
                parts.append(function[key])
    return "".join(parts)


class BenchmarkMetrics:
    """Reuse the original benchmark's tokenization and acceptance definitions."""

    def __init__(self, args):
        from req_metadata import ReqMetadata
        from transformers import AutoTokenizer

        self.metadata_type = ReqMetadata
        self.tokenizer = AutoTokenizer.from_pretrained(args.tokenizer_path)
        self.args = args

    def analyze(self, result):
        chunks = result.get("output_chunks", result.get("content_chunks", []))
        if not result["success"] or not chunks:
            return None
        meta = self.metadata_type(
            spec_step_num=self.args.spec_step_num,
            req_id=result["proxy_request_id"] or str(result["source_line"]),
            category="default", concurrency=self.args.concurrency,
        )
        meta.put_req_js(result["request_body"])
        meta.put_prefill(chunks[0]["content"], chunks[0]["latency_ms"] / 1000)
        for chunk in chunks[1:]:
            meta.put_new_decode(chunk["content"], chunk["latency_ms"] / 1000)
        token_nums = list(meta.get_decode_token_num_list(self.tokenizer))
        token_sum = sum(token_nums)
        oversized = sum(n > self.args.spec_step_num + 1 for n in token_nums) if self.args.spec_step_num > 0 else 0
        spec_valid = self.args.spec_step_num > 0 and bool(token_nums) and not oversized
        positions = list(meta.get_acc_per_position(self.tokenizer)) if spec_valid else []
        decode_ms = sum(meta.decode_raw_latency) * 1000
        return {
            "source": "original_ReqMetadata",
            "estimation_method": "text_fragments_without_protocol_wrapper",
            "oversized_decode_chunks": oversized,
            "spec_metrics_warning": "增量长度超过 K+1，不能视为单轮投机；本请求投机指标不纳入汇总" if oversized else None,
            "output_scope": "content+reasoning+reasoning_content+tool_calls+function_call",
            "ttft_ms": meta.prefill_latency * 1000,
            "spec_step_num": self.args.spec_step_num,
            "content_ttft_ms": meta.prefill_latency * 1000,
            "decode_token_num_list": token_nums,
            "decode_token_count": token_sum,
            "decode_latency_ms": decode_ms,
            "tpot_ms": decode_ms / token_sum if token_sum else None,
            "avg_spec_len": token_sum / len(token_nums) if spec_valid else None,
            "avg_increment_tokens": token_sum / len(token_nums) if token_nums else None,
            "per_position_acceptance_rate": positions,
            "spec_acc_pct": 100 * sum(positions) / len(positions) if positions else None,
        }


def summarize_benchmark(metrics):
    valid = [m for m in metrics if m is not None]
    ttfts = [m["content_ttft_ms"] for m in valid if m["content_ttft_ms"] > 0]
    lens = [m["avg_spec_len"] for m in valid if m["avg_spec_len"] is not None]
    positions = [m["per_position_acceptance_rate"] for m in valid if m["per_position_acceptance_rate"]]
    if positions and len({len(p) for p in positions}) != 1:
        raise ValueError("ReqMetadata 返回的接受率位置数不一致")
    means = [sum(p[i] for p in positions) / len(positions) for i in range(len(positions[0]))] if positions else []
    count = sum(m["decode_token_count"] for m in valid)
    latency = sum(m["decode_latency_ms"] for m in valid if m["decode_token_count"] > 0)
    return {
        "analyzed_requests": len(valid),
        "spec_invalid_requests": sum(bool(m.get("oversized_decode_chunks")) for m in valid),
        "oversized_decode_chunks": sum(m.get("oversized_decode_chunks", 0) for m in valid),
        "ttft_ms": sum(ttfts) / len(ttfts) if ttfts else None,
        "tpot_ms": latency / count if count else None,
        "avg_spec_len": sum(lens) / len(lens) if lens else None,
        "avg_decode_len": count / len(ttfts) if ttfts else None,
        "decode_token_count": count,
        "per_position_acceptance_rate": means,
        "spec_acc_pct": 100 * sum(means) / len(means) if means else None,
    }


def summarize_results(results, wall_time_s, spec_step_num=0):
    """Average successful requests only; missing samples are not zero."""
    successful = [r for r in results if r["success"]]
    metrics = [r.get("benchmark_metrics") for r in successful]
    summary = summarize_benchmark(metrics)
    summary.update({
        "total_requests": len(results), "successful_requests": len(successful),
        "failed_requests": len(results) - len(successful),
        "wall_time_s": wall_time_s, "spec_step_num": spec_step_num,
        "metrics_errors": sum(bool(r.get("benchmark_metrics_error")) for r in results),
        "token_length_source": "server_usage", "sample_counts": {},
    })
    values = {
        "ttft_ms": [r.get("ttft_ms", chunks[0]["latency_ms"] if chunks else None)
                    for r in successful
                    for chunks in [r.get("output_chunks", r.get("content_chunks", []))]],
        "avg_task_duration_ms": [r["total_duration_ms"] for r in successful],
        "avg_prefill_tokens": [(r.get("usage") or {}).get("prompt_tokens") for r in successful],
        "avg_output_tokens": [(r.get("usage") or {}).get("completion_tokens") for r in successful],
    }
    for name, samples in values.items():
        samples = [v for v in samples if isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0]
        summary[name] = sum(samples) / len(samples) if samples else None
        summary["sample_counts"][name] = len(samples)
    summary["sample_counts"].update({
        "tpot_ms": sum(m is not None and m["decode_token_count"] > 0 for m in metrics),
        "avg_spec_len": sum(m is not None and m["avg_spec_len"] is not None for m in metrics),
        "per_position_acceptance_rate": sum(m is not None and bool(m["per_position_acceptance_rate"]) for m in metrics),
    })
    return summary


def print_summary(summary):
    print("\n========== 总体统计（成功请求） ==========")
    print(f"请求数: {summary['total_requests']} | 成功: {summary['successful_requests']} | 失败: {summary['failed_requests']}")
    print(f"整批执行耗时: {summary['wall_time_s']:.2f} s")
    rows = [
        ("平均首字耗时 TTFT", "ttft_ms", "ms"),
        ("增量耗时 TPOT（文本估算，token 加权）", "tpot_ms", "ms/token"),
        ("平均投机步长 AvgSpecLen（估算）", "avg_spec_len", "token/段"),
        ("单次任务平均总耗时", "avg_task_duration_ms", "ms"),
        ("平均 prefill 长度", "avg_prefill_tokens", "token"),
        ("平均输出 token 长度", "avg_output_tokens", "token"),
    ]
    for label, key, unit in rows:
        value = summary[key]
        rendered = f"{value:.3f} {unit}" if value is not None else "N/A"
        print(f"{label}: {rendered}（有效请求 {summary['sample_counts'][key]}）")
    positions = summary["per_position_acceptance_rate"]
    print(f"每一步平均接受率（估算，有效请求 {summary['sample_counts']['per_position_acceptance_rate']}）:")
    if positions:
        for index, rate in enumerate(positions, 1):
            print(f"  第 {index} 个投机位置: {rate * 100:.2f}%")
    else:
        print("  N/A")
    if summary["spec_acc_pct"] is not None:
        print(f"各位置平均接受率 SpecAcc: {summary['spec_acc_pct']:.2f}%")
    print("口径: 首字/投机/TPOT 包含正文、推理、工具调用；token 长度取服务 usage。")
    print("投机指标按实际文本增量分词估算，排除工具协议包装，不等于引擎真实接受率。")
    if summary["spec_invalid_requests"]:
        print(f"投机统计排除 {summary['spec_invalid_requests']} 条请求：共 {summary['oversized_decode_chunks']} 段超过 K+1；未截断或伪造接受率。")
    print("N/A 表示未启用对应统计或没有有效样本，缺失值不按 0 计算。")


def load_tasks(path, offset=0, limit=None, model=None):
    tasks = []
    record_index = 0
    with path.open(encoding="utf-8") as source:
        for line_number, line in enumerate(source, 1):
            if not line.strip():
                continue
            record_index += 1
            if record_index <= offset:
                continue
            if limit is not None and len(tasks) >= limit:
                break
            try:
                record = json.loads(line)
                body = copy.deepcopy(record["request_body"])
                if not isinstance(body, dict) or not isinstance(body.get("messages"), list):
                    raise ValueError("request_body 必须是包含 messages 数组的对象")
                if record.get("method", "POST") != "POST":
                    raise ValueError("仅支持 POST 记录")
                if record.get("path", "/v1/chat/completions") != "/v1/chat/completions":
                    raise ValueError("仅支持 /v1/chat/completions 记录")
                if model is not None:
                    body["model"] = model
                tasks.append({"source_line": line_number, "record": record, "body": body})
            except (ValueError, KeyError, TypeError) as exc:
                raise ValueError(f"{path}:{line_number}: {exc}") from exc
    if not tasks:
        raise ValueError("所选范围内没有请求")
    return tasks


def sse_events(response):
    """Read complete SSE events, including lines split across network packets."""
    data = []
    for raw_line in response:
        line = raw_line.decode("utf-8").rstrip("\r\n")
        if not line:
            if data:
                yield "\n".join(data)
                data = []
        elif line.startswith("data:"):
            value = line[5:]
            data.append(value[1:] if value.startswith(" ") else value)
    if data:
        yield "\n".join(data)


def execute(task, url, timeout, api_key):
    record, body = task["record"], task["body"]
    result = {
        "source_line": task["source_line"],
        "proxy_request_id": record.get("proxy_request_id"),
        "started_at": datetime.now(timezone.utc).isoformat(),
        "request_body": body,
        "original": {key: record.get(key) for key in (
            "received_at", "status_code", "ttft_ms", "total_duration_ms")},
        "status_code": None,
        "success": False,
        "header_latency_ms": None,
        "ttft_ms": None,
        "total_duration_ms": None,
        "output_chunk_count": 0,
        "mean_output_chunk_interval_ms": None,
        "usage": None,
        "response_events": [],
        "content_chunks": [],
        "output_chunks": [],
        "accumulated_content": "",
        "accumulated_reasoning": "",
        "accumulated_tool_call": "",
        "accumulated_function_call": "",
        "finish_reason": None,
        "response_body": None,
        "extracted_answer": {},
        "error": None,
    }
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    request = urllib.request.Request(
        url, data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers=headers, method="POST",
    )
    # Do not route container-local inference through environment HTTP proxies.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    started = time.perf_counter()
    output_times = []
    try:
        with opener.open(request, timeout=timeout) as response:
            result["status_code"] = response.status
            result["header_latency_ms"] = (time.perf_counter() - started) * 1000
            if body.get("stream", False):
                content_type = response.headers.get("Content-Type", "")
                if "text/event-stream" not in content_type.lower():
                    result["response_body"] = response.read().decode("utf-8", errors="replace")
                    raise ValueError(f"期望 SSE 响应，实际 Content-Type: {content_type}")
                done = False
                for payload in sse_events(response):
                    if payload.strip() == "[DONE]":
                        done = True
                        break
                    event = json.loads(payload)
                    arrived_ms = (time.perf_counter() - started) * 1000
                    result["response_events"].append(event)
                    if event.get("error"):
                        raise ValueError(json.dumps(event["error"], ensure_ascii=False))
                    if event.get("usage") is not None:
                        result["usage"] = event["usage"]
                    choices = event.get("choices") or []
                    first_choice = choices[0] if choices else {}
                    delta = first_choice.get("delta") or {}
                    if first_choice.get("finish_reason") is not None:
                        result["finish_reason"] = first_choice["finish_reason"]
                    for field, target in (
                        ("content", "accumulated_content"),
                        ("reasoning", "accumulated_reasoning"),
                        ("reasoning_content", "accumulated_reasoning"),
                        ("tool_calls", "accumulated_tool_call"),
                        ("function_call", "accumulated_function_call"),
                    ):
                        value = delta.get(field)
                        if value:
                            text = json.dumps(value, ensure_ascii=False) if field in ("tool_calls", "function_call") else value
                            result[target] += text
                    text = delta_text(delta)
                    # One SSE event counts as one increment, even when it has
                    # several output fields. Role/usage/finish-only events do not.
                    if any(delta.get(key) for key in ("content", "reasoning", "reasoning_content", "tool_calls", "function_call")):
                        output_times.append(arrived_ms)
                    if text:
                        chunks = result["output_chunks"]
                        previous_ms = chunks[-1]["arrival_ms"] if chunks else 0
                        chunks.append({"content": text, "arrival_ms": arrived_ms,
                                       "latency_ms": arrived_ms - previous_ms})
                    if delta.get("content"):
                        chunks = result["content_chunks"]
                        previous_ms = chunks[-1]["arrival_ms"] if chunks else 0
                        chunks.append({"content": delta["content"], "arrival_ms": arrived_ms,
                                       "latency_ms": arrived_ms - previous_ms})
                    for choice in event.get("choices", []):
                        content = (choice.get("delta") or {}).get("content")
                        if content:
                            key = f"choice_{choice.get('index', 0)}"
                            result["extracted_answer"][key] = result["extracted_answer"].get(key, "") + content
                if not done:
                    raise ValueError("SSE 流在 [DONE] 前结束，响应可能不完整")
            else:
                raw = response.read().decode("utf-8")
                result["response_body"] = raw
                event = json.loads(raw)
                if event.get("error"):
                    raise ValueError(json.dumps(event["error"], ensure_ascii=False))
                result["usage"] = event.get("usage")
                for choice in event.get("choices", []):
                    result["extracted_answer"][f"choice_{choice.get('index', 0)}"] = (choice.get("message") or {}).get("content")
            result["success"] = True
    except urllib.error.HTTPError as exc:
        result["status_code"] = exc.code
        result["error"] = f"HTTP {exc.code}: {exc.reason}"
        try:
            result["response_body"] = exc.read().decode("utf-8", errors="replace")
        except Exception as read_exc:
            result["error"] += f"; 读取错误响应失败: {read_exc}"
        finally:
            exc.close()
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
    result["total_duration_ms"] = (time.perf_counter() - started) * 1000
    result["output_chunk_count"] = len(output_times)
    if output_times:
        result["ttft_ms"] = output_times[0]
    if len(output_times) > 1:
        result["mean_output_chunk_interval_ms"] = (output_times[-1] - output_times[0]) / (len(output_times) - 1)
    return result


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="在 vLLM 容器中重放业务 JSONL 的完整 request_body")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000/v1", help="例如 http://127.0.0.1:8000/v1")
    parser.add_argument("--model", help="覆盖原始 model；默认保留日志中的 model")
    parser.add_argument("--concurrency", type=int, default=1)
    parser.add_argument("--offset", type=int, default=0, help="跳过前 N 条非空记录")
    parser.add_argument("--limit", type=int, help="最多重放 N 条请求")
    parser.add_argument("--timeout", type=float, default=600, help="连接及单次 socket 读取超时秒数，并非整个请求总时限")
    parser.add_argument("--api-key-env", default="VLLM_API_KEY", help="保存 API key 的环境变量名")
    parser.add_argument("--output", type=Path, help="结果 JSONL，必须为新文件")
    parser.add_argument("--dry-run", action="store_true", help="校验输入并展示统计，不发送请求")
    parser.add_argument("--benchmark-metrics", action="store_true", help="使用原 req_metadata.py 统计 TPOT 和投机指标")
    parser.add_argument("--tokenizer-path", help="与服务模型一致的本地 tokenizer 路径")
    parser.add_argument("--spec-step-num", type=int, default=0, help="与服务端一致的投机配置，传给原 ReqMetadata；不修改服务配置")
    args = parser.parse_args(argv)
    if args.concurrency < 1 or args.offset < 0 or (args.limit is not None and args.limit < 1) or args.timeout <= 0:
        parser.error("concurrency、limit、timeout 必须大于 0，offset 必须大于等于 0")
    if not args.base_url.startswith(("http://", "https://")):
        parser.error("base-url 必须以 http:// 或 https:// 开头")
    if args.spec_step_num < 0:
        parser.error("spec-step-num 不能为负数")
    if args.benchmark_metrics and not args.tokenizer_path:
        parser.error("--benchmark-metrics 需要 --tokenizer-path")
    if args.spec_step_num > 0 and not args.benchmark_metrics:
        parser.error("--spec-step-num 需要配合 --benchmark-metrics")
    return args


def main(argv=None):
    args = parse_args(argv)
    try:
        tasks = load_tasks(args.input, args.offset, args.limit, args.model)
    except (OSError, ValueError) as exc:
        print(f"输入错误: {exc}", file=sys.stderr)
        return 2
    url = args.base_url.rstrip("/") + "/chat/completions"
    print(json.dumps({"requests": len(tasks), "url": url, "concurrency": args.concurrency,
                      "models": sorted({str(t["body"].get("model")) for t in tasks}),
                      "stream_requests": sum(bool(t["body"].get("stream")) for t in tasks),
                      "requests_with_tools": sum(bool(t["body"].get("tools")) for t in tasks)}, ensure_ascii=False))
    if args.dry_run:
        return 0
    analyzer = None
    if args.benchmark_metrics:
        try:
            analyzer = BenchmarkMetrics(args)
        except Exception as exc:
            print(f"无法启用原基准统计: {exc}。请将原 req_metadata.py 放在脚本旁，并安装 transformers、提供匹配的 tokenizer。", file=sys.stderr)
            return 2
    output = args.output or Path(f"vllm_replay_{datetime.now():%Y%m%d_%H%M%S_%f}.jsonl")
    try:
        output.parent.mkdir(parents=True, exist_ok=True)
        writer = output.open("x", encoding="utf-8")
    except OSError as exc:
        print(f"无法创建结果文件: {exc}", file=sys.stderr)
        return 2
    print(f"结果文件: {output.resolve()}")
    succeeded = 0
    result_samples = []
    metric_errors = 0
    started = time.perf_counter()
    with writer, ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = [pool.submit(execute, task, url, args.timeout, os.environ.get(args.api_key_env)) for task in tasks]
        for completed, future in enumerate(as_completed(futures), 1):
            result = future.result()
            succeeded += int(result["success"])
            if analyzer is not None:
                try:
                    result["benchmark_metrics"] = analyzer.analyze(result)
                except Exception as exc:
                    metric_errors += 1
                    result["benchmark_metrics_error"] = f"{type(exc).__name__}: {exc}"
                    print(f"统计失败 line={result['source_line']}: {exc}", file=sys.stderr)
            result_samples.append({key: result.get(key) for key in (
                "success", "ttft_ms", "total_duration_ms", "usage", "benchmark_metrics", "benchmark_metrics_error")})
            # Retain timing only, not full response texts, for overall averages.
            chunks = result.get("output_chunks", result.get("content_chunks", []))
            result_samples[-1]["output_chunks"] = [
                {"latency_ms": chunks[0]["latency_ms"]}
            ] if chunks else []
            writer.write(json.dumps(result, ensure_ascii=False) + "\n")
            writer.flush()
            state = "OK" if result["success"] else result["error"]
            print(f"[{completed}/{len(tasks)}] line={result['source_line']} {state} "
                  f"total={result['total_duration_ms']:.1f}ms ttft={result['ttft_ms']}", flush=True)
    summary = summarize_results(result_samples, time.perf_counter() - started, args.spec_step_num)
    print_summary(summary)
    summary_path = Path(str(output) + ".summary.json")
    with summary_path.open("x", encoding="utf-8") as summary_file:
        json.dump(summary, summary_file, ensure_ascii=False, indent=2)
    print(f"统计结果: {summary_path.resolve()}")
    return 0 if succeeded == len(tasks) and metric_errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
