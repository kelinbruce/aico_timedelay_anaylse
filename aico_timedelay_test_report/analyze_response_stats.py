#!/usr/bin/env python3
"""统计代理 JSONL 日志，只依赖 Python 标准库。

默认统计 dsv_modify_0814/qwen_3.jsonl；可传入其他文件。
正文字符数 = 各 choice 的 message.content 或拼接后的 delta.content 的 len()。
中文、英文、空格和换行均按 Unicode 码点计数，不统计 SSE/JSON 包装。
工具调用仅统计 function.arguments 的原始文本，单独列出，不混入正文。
token 数使用 usage（流中取最后一次有效值），缺失时不估算、不补零。
"""

import argparse
import json
import math
import re
from pathlib import Path
from statistics import fmean


def response_events(body):
    """兼容完整 JSON 和 SSE data 事件；损坏数据直接报错，避免静默低估。"""
    if isinstance(body, dict):
        yield body
        return
    if not isinstance(body, str):
        raise ValueError("response_body 必须是 JSON 对象或 SSE 字符串")
    if body.lstrip().startswith("{"):
        yield json.loads(body)
        return
    found = False
    for block in re.split(r"\n\n+", body.replace("\r\n", "\n").replace("\r", "\n")):
        parts = []
        for line in block.splitlines():
            if line == "data" or line.startswith("data:"):
                value = line.partition(":")[2]
                parts.append(value[1:] if value.startswith(" ") else value)
        if not parts:
            continue
        found = True
        payload = "\n".join(parts)
        if payload.strip() == "[DONE]":
            break
        if payload.strip():
            yield json.loads(payload)
    if not found:
        raise ValueError("未识别到 JSON 或 SSE data 事件")


def valid_number(value):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and value >= 0)


def extract_response(body):
    contents, arguments, usage = {}, {}, {}
    for event in response_events(body):
        if not isinstance(event, dict) or "error" in event:
            raise ValueError("响应事件不是对象或包含 error")
        for key, value in (event.get("usage") or {}).items():
            if valid_number(value):
                usage[key] = value
        for position, choice in enumerate(event.get("choices") or []):
            index = choice.get("index", position)
            incremental = "delta" in choice
            message = choice.get("delta" if incremental else "message") or {}
            text = message.get("content")
            if text is not None:
                if not isinstance(text, str):
                    raise ValueError("content 不是文本，无法按文本口径统计")
                contents[index] = contents.get(index, "") + text if incremental else text
            calls = message.get("tool_calls") or []
            if message.get("function_call"):
                calls = calls + [{"index": "legacy", "function": message["function_call"]}]
            for call_position, call in enumerate(calls):
                key = (index, call.get("index", call_position))
                value = (call.get("function") or {}).get("arguments")
                if value is not None:
                    if not isinstance(value, str):
                        raise ValueError("function.arguments 不是字符串")
                    arguments[key] = arguments.get(key, "") + value if incremental else value
    return {
        "content_chars": sum(map(len, contents.values())),
        "tool_argument_chars": sum(map(len, arguments.values())),
        "prompt_tokens": usage.get("prompt_tokens"),
        "completion_tokens": usage.get("completion_tokens"),
    }


def metric(values):
    numbers = [v for v in values if valid_number(v)]
    return {"count": len(numbers), "total": sum(numbers),
            "mean": fmean(numbers) if numbers else None}


def analyze(path):
    details, failures, total = [], [], 0
    with path.open(encoding="utf-8-sig") as source:
        for line_number, line in enumerate(source, 1):
            if not line.strip():
                continue
            total += 1
            try:
                row = json.loads(line)
                if not isinstance(row, dict):
                    raise ValueError("日志行必须是 JSON 对象")
                status = row.get("status_code")
                if (status is not None and not 200 <= status < 300
                        or row.get("error")
                        or row.get("outcome") not in (None, "completed")):
                    raise ValueError("请求未成功完成")
                body = row.get("response_body", row.get("respond"))
                item = extract_response(body)
                item.update(line=line_number, request_id=row.get("proxy_request_id"),
                            total_duration_ms=row.get("total_duration_ms"),
                            ttft_ms=row.get("ttft_ms"))
                details.append(item)
            except (ValueError, TypeError, AttributeError) as exc:
                failures.append({"line": line_number, "reason": str(exc)})
    names = ("total_duration_ms", "ttft_ms", "prompt_tokens", "completion_tokens",
             "content_chars", "tool_argument_chars")
    summary = {name: metric(r[name] for r in details) for name in names}
    summary["nonempty_content_chars"] = metric(r["content_chars"] for r in details if r["content_chars"])
    return {"file": str(path.resolve()), "total_records": total,
            "valid_records": len(details), "excluded_records": failures,
            "summary": summary, "details": details}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("file", nargs="?", type=Path,
                        default=Path(__file__).resolve().parent / "dsv_modify_0814/qwen_3.jsonl")
    parser.add_argument("--output", type=Path, help="保存完整统计和每条请求的字符数到 JSON")
    args = parser.parse_args()
    if args.output and args.output.resolve() == args.file.resolve():
        parser.error("输出文件不能覆盖输入日志")
    result = analyze(args.file)
    print(f"文件：{result['file']}")
    print(f"总记录：{result['total_records']}；有效：{result['valid_records']}；排除：{len(result['excluded_records'])}")
    labels = {"total_duration_ms": "平均总时延 (ms)", "ttft_ms": "平均首 token 时延 (ms)",
              "prompt_tokens": "平均输入 token 数", "completion_tokens": "平均输出 token 数",
              "content_chars": "平均正文字符数（含空正文）", "tool_argument_chars": "平均工具参数字符数",
              "nonempty_content_chars": "平均正文字符数（仅非空正文）"}
    for key, label in labels.items():
        stat = result["summary"][key]
        mean = f"{stat['mean']:.3f}" if stat["mean"] is not None else "N/A"
        print(f"{label}：{mean}；样本数：{stat['count']}；合计：{stat['total']}")
    print("口径：成功且可解析的请求；正文不含工具参数、推理内容及协议包装；字符数包含空格和换行。")
    for failure in result["excluded_records"]:
        print(f"排除第 {failure['line']} 行：{failure['reason']}")
    if args.output:
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"统计明细已保存：{args.output.resolve()}")


if __name__ == "__main__":
    main()
