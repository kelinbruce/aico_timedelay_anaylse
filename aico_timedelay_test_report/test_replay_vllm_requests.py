import io
import importlib.util
import json
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

import replay_vllm_requests as replay


class Response(io.BytesIO):
    status = 200

    def __init__(self, data, content_type="text/event-stream"):
        super().__init__(data)
        self.headers = {"Content-Type": content_type}


class ReplayTests(unittest.TestCase):
    def test_overall_averages_exclude_failures_and_missing_usage(self):
        samples = [
            {"success": True, "total_duration_ms": 100, "content_chunks": [{"latency_ms": 10}],
             "usage": {"prompt_tokens": 1000, "completion_tokens": 20}},
            {"success": True, "total_duration_ms": 300, "content_chunks": [{"latency_ms": 30}],
             "usage": {"prompt_tokens": 2000, "completion_tokens": 0}},
            {"success": True, "total_duration_ms": 200, "content_chunks": [], "usage": None},
            {"success": False, "total_duration_ms": 9999, "content_chunks": [{"latency_ms": 900}],
             "usage": {"prompt_tokens": 9999, "completion_tokens": 9999}},
        ]
        summary = replay.summarize_results(samples, 1)
        self.assertEqual(summary["successful_requests"], 3)
        self.assertEqual(summary["failed_requests"], 1)
        self.assertEqual(summary["ttft_ms"], 20)
        self.assertEqual(summary["avg_task_duration_ms"], 200)
        self.assertEqual(summary["avg_prefill_tokens"], 1500)
        self.assertEqual(summary["avg_output_tokens"], 10)
        self.assertEqual(summary["sample_counts"]["avg_output_tokens"], 2)
        self.assertIsNone(summary["tpot_ms"])
        empty = replay.summarize_results([samples[-1]], 1)
        self.assertIsNone(empty["avg_task_duration_ms"])
        self.assertIsNone(empty["avg_prefill_tokens"])

    def test_main_writes_summary_even_without_optional_benchmark(self):
        from contextlib import redirect_stdout
        result = {"source_line": 1, "success": True, "total_duration_ms": 195,
                  "ttft_ms": 100, "content_chunks": [{"latency_ms": 100}],
                  "usage": {"prompt_tokens": 1000, "completion_tokens": 8}, "error": None}
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "input.jsonl"
            source.write_text(json.dumps({"request_body": self.task()["body"]}) + "\n")
            output = Path(tmp) / "results.jsonl"
            terminal = io.StringIO()
            with patch.object(replay, "execute", return_value=result), redirect_stdout(terminal):
                code = replay.main(["--input", str(source), "--output", str(output)])
            self.assertEqual(code, 0)
            summary = json.loads(Path(str(output) + ".summary.json").read_text())
            self.assertEqual(summary["avg_output_tokens"], 8)
            self.assertEqual(summary["avg_task_duration_ms"], 195)
            self.assertIn("平均 prefill 长度: 1000.000 token", terminal.getvalue())
            self.assertIn("N/A", terminal.getvalue())

    def task(self, stream=True):
        return {"source_line": 1, "record": {"proxy_request_id": "test"},
                "body": {"model": "dsv4", "messages": [], "stream": stream,
                         "tools": [{"type": "function", "function": {"name": "query"}}],
                         "tool_choice": "auto", "stream_options": {"include_usage": True}}}

    def run_response(self, response, task=None):
        task = task or self.task()
        with patch.object(replay.urllib.request, "build_opener") as factory:
            factory.return_value.open.return_value = response
            result = replay.execute(task, "http://localhost:8000/v1/chat/completions", 30, "secret")
            request = factory.return_value.open.call_args.args[0]
            self.assertEqual(json.loads(request.data), task["body"])
            self.assertNotIn("secret", json.dumps(result))
        return result

    def test_sse_reasoning_tools_usage_and_unicode(self):
        events = [
            {"choices": [{"delta": {"role": "assistant", "content": ""}}]},
            {"choices": [{"delta": {"reasoning_content": "分析"}}]},
            {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": "{}"}}]}}]},
            {"choices": [{"index": 0, "delta": {"content": "完成"}, "finish_reason": "stop"}]},
            {"choices": [], "usage": {"prompt_tokens": 20, "completion_tokens": 4}},
        ]
        wire = ": keepalive\r\n\r\n" + "".join("data: " + json.dumps(e, ensure_ascii=False) + "\r\n\r\n" for e in events)
        result = self.run_response(Response((wire + "data: [DONE]\r\n\r\n").encode()))
        self.assertTrue(result["success"])
        self.assertEqual(result["output_chunk_count"], 3)
        self.assertEqual(result["usage"]["completion_tokens"], 4)
        self.assertEqual(result["extracted_answer"], {"choice_0": "完成"})
        self.assertEqual(result["response_events"], events)
        self.assertIsNotNone(result["ttft_ms"])
        self.assertEqual([c["content"] for c in result["content_chunks"]], ["完成"])
        self.assertEqual(result["content_chunks"][0]["arrival_ms"], result["content_chunks"][0]["latency_ms"])

    def test_benchmark_summary_uses_request_means_and_weighted_tpot(self):
        metrics = [
            {"content_ttft_ms": 10, "avg_spec_len": 2, "per_position_acceptance_rate": [1, .5],
             "decode_token_count": 4, "decode_latency_ms": 40},
            {"content_ttft_ms": 30, "avg_spec_len": 3, "per_position_acceptance_rate": [.5, 0],
             "decode_token_count": 6, "decode_latency_ms": 120},
        ]
        summary = replay.summarize_benchmark(metrics + [None])
        self.assertEqual(summary["ttft_ms"], 20)
        self.assertEqual(summary["tpot_ms"], 16)
        self.assertEqual(summary["avg_spec_len"], 2.5)
        self.assertEqual(summary["per_position_acceptance_rate"], [.75, .25])
        self.assertEqual(summary["spec_acc_pct"], 50)
        self.assertIsNone(replay.summarize_benchmark([])["tpot_ms"])

    def test_tools_reasoning_and_mixed_events_enter_overall_metrics(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        variants = [
            [{"tool_calls": [{"index": 0, "function": {"name": "查询", "arguments": ""}}]},
             {"tool_calls": [{"index": 0, "function": {"arguments": "{}"}}]}],
            [{"reasoning": "思考"}, {"reasoning_content": "继续"}],
            [{"content": "正文", "reasoning": "推理", "tool_calls": [{"index": 0}]},
             {"content": "结束"}],
        ]
        results = []
        for deltas in variants:
            with self.subTest(deltas=deltas):
                events = [{"choices": [{"delta": {"role": "assistant"}}]}]
                events += [{"choices": [{"delta": delta}]} for delta in deltas]
                events += [{"choices": [{"delta": {}, "finish_reason": "tool_calls"}]},
                           {"choices": [], "usage": {"prompt_tokens": 100, "completion_tokens": 10}}]
                wire = "".join("data: " + json.dumps(e, ensure_ascii=False) + "\n\n" for e in events)
                result = self.run_response(Response((wire + "data: [DONE]\n\n").encode()))
                self.assertTrue(result["success"])
                self.assertEqual(len(result["output_chunks"]), 2)
                self.assertEqual(result["output_chunk_count"], 2)
                self.assertEqual(result["ttft_ms"], result["output_chunks"][0]["latency_ms"])
                self.assertEqual(result["finish_reason"], "tool_calls")
                expected_tools = "".join(json.dumps(d["tool_calls"], ensure_ascii=False) for d in deltas if d.get("tool_calls"))
                self.assertEqual(result["accumulated_tool_call"], expected_tools)
                self.assertEqual(result["accumulated_reasoning"], "".join(d.get("reasoning", "") + d.get("reasoning_content", "") for d in deltas))
                analyzer = replay.BenchmarkMetrics.__new__(replay.BenchmarkMetrics)
                analyzer.args = SimpleNamespace(spec_step_num=3, concurrency=1)
                analyzer.tokenizer = object()
                meta = Mock(prefill_latency=.1, decode_raw_latency=[.02])
                meta.get_decode_token_num_list.return_value = [2]
                meta.get_acc_per_position.return_value = [1, 0, 0]
                analyzer.metadata_type = Mock(return_value=meta)
                result["benchmark_metrics"] = analyzer.analyze(result)
                self.assertIsNotNone(result["benchmark_metrics"])
                self.assertEqual(meta.put_prefill.call_args.args[0], result["output_chunks"][0]["content"])
                self.assertEqual(meta.put_new_decode.call_args.args[0], result["output_chunks"][1]["content"])
                results.append(result)
        summary = replay.summarize_results(results, 1, 3)
        for key in ("ttft_ms", "tpot_ms", "avg_spec_len", "per_position_acceptance_rate"):
            self.assertEqual(summary["sample_counts"][key], 3)

    def test_benchmark_adapter_reuses_original_metadata_methods(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        analyzer = replay.BenchmarkMetrics.__new__(replay.BenchmarkMetrics)
        analyzer.args = SimpleNamespace(spec_step_num=2, concurrency=1)
        analyzer.tokenizer = object()
        meta = Mock()
        meta.prefill_latency = .01
        meta.decode_raw_latency = [.02, .03]
        meta.get_decode_token_num_list.return_value = [3, 1]
        meta.get_acc_per_position.return_value = [.5, .5]
        analyzer.metadata_type = Mock(return_value=meta)
        result = {"success": True, "proxy_request_id": "test", "source_line": 1,
                  "request_body": self.task()["body"], "content_chunks": [
                      {"content": "a", "latency_ms": 10},
                      {"content": "bcd", "latency_ms": 20},
                      {"content": "e", "latency_ms": 30}]}
        metrics = analyzer.analyze(result)
        meta.put_prefill.assert_called_once_with("a", .01)
        self.assertEqual(meta.put_new_decode.call_count, 2)
        meta.get_acc_per_position.assert_called_once_with(analyzer.tokenizer)
        self.assertEqual(metrics["decode_token_num_list"], [3, 1])
        self.assertEqual(metrics["avg_spec_len"], 2)
        self.assertEqual(metrics["tpot_ms"], 12.5)

    def test_real_metadata_acceptance_formula(self):
        # Only stub the unavailable transformers import and tokenizer; execute
        # the actual req_metadata.py acceptance and decode algorithms.
        from types import ModuleType, SimpleNamespace
        transformers = ModuleType("transformers")

        class CharacterTokenizer:
            def encode(self, text, add_special_tokens=False):
                return list(text)

        transformers.AutoTokenizer = CharacterTokenizer
        spec = importlib.util.spec_from_file_location(
            "original_req_metadata_test", Path(replay.__file__).with_name("req_metadata.py"))
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"transformers": transformers}):
            spec.loader.exec_module(module)
        analyzer = replay.BenchmarkMetrics.__new__(replay.BenchmarkMetrics)
        analyzer.args = SimpleNamespace(spec_step_num=3, concurrency=1)
        analyzer.tokenizer = CharacterTokenizer()
        analyzer.metadata_type = module.ReqMetadata
        result = {"success": True, "proxy_request_id": "real", "source_line": 1,
                  "request_body": self.task()["body"], "content_chunks": [
                      {"content": "prefill", "latency_ms": 10},
                      {"content": "abcd", "latency_ms": 20},
                      {"content": "ef", "latency_ms": 30},
                      {"content": "g", "latency_ms": 40}]}
        metrics = analyzer.analyze(result)
        self.assertEqual(metrics["decode_token_num_list"], [4, 2, 1])
        self.assertEqual(metrics["per_position_acceptance_rate"], [2/3, 1/3, 1/3])
        self.assertAlmostEqual(metrics["avg_spec_len"], 7/3)
        self.assertAlmostEqual(metrics["tpot_ms"], 90/7)
        self.assertAlmostEqual(metrics["spec_acc_pct"], 400/9)
        analyzer.args.spec_step_num = 0
        metrics = analyzer.analyze(result)
        self.assertEqual(metrics["decode_token_num_list"], [1, 1, 1])
        self.assertEqual(metrics["per_position_acceptance_rate"], [])
        self.assertAlmostEqual(metrics["tpot_ms"], 30)
        analyzer.args.spec_step_num = 3
        result["content_chunks"] = result["content_chunks"][:1]
        metrics = analyzer.analyze(result)
        self.assertEqual(metrics["per_position_acceptance_rate"], [])
        self.assertIsNone(metrics["avg_spec_len"])

    def test_truncated_and_error_streams_fail(self):
        for wire in (b'data: {"choices": []}\n\n', b'data: {"error": {"message": "bad"}}\n\n', b'data: invalid\n\n'):
            with self.subTest(wire=wire):
                self.assertFalse(self.run_response(Response(wire))["success"])

    def test_http_error_is_saved(self):
        error = urllib.error.HTTPError("http://localhost", 400, "Bad Request", {}, io.BytesIO(b'{"error":"bad model"}'))
        with patch.object(replay.urllib.request, "build_opener") as factory:
            factory.return_value.open.side_effect = error
            result = replay.execute(self.task(), "http://localhost", 30, None)
        self.assertFalse(result["success"])
        self.assertEqual(result["status_code"], 400)
        self.assertIn("bad model", result["response_body"])

    def test_non_stream_has_no_ttft(self):
        payload = {"choices": [{"index": 0, "message": {"content": "ok"}}], "usage": {"completion_tokens": 1}}
        result = self.run_response(Response(json.dumps(payload).encode(), "application/json"), self.task(False))
        self.assertTrue(result["success"])
        self.assertIsNone(result["ttft_ms"])

    def test_input_selection_and_model_override_preserve_body(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "input.jsonl"
            record = {"request_body": self.task()["body"]}
            path.write_text("\n" + json.dumps(record) + "\n" + json.dumps(record) + "\n", encoding="utf-8")
            task = replay.load_tasks(path, offset=1, limit=1, model="local-model")[0]
            self.assertEqual(task["source_line"], 3)
            expected = dict(record["request_body"], model="local-model")
            self.assertEqual(task["body"], expected)
            self.assertEqual(task["record"]["request_body"]["model"], "dsv4")


if __name__ == "__main__":
    unittest.main()
