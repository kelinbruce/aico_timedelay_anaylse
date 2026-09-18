# 在 vLLM Docker 容器内重放业务请求

`replay_vllm_requests.py` 参考 `llm_benchmark.py` 的并发请求及耗时记录方式，直接发送日志中的完整 `request_body`。仅依赖 Python 3 标准库，不需要安装 requests、transformers 或 tokenizer。

默认输入为脚本旁边的 `dsv_modify_0814/dsv4_3_aico.jsonl`，共 174 条请求。默认保留 model=dsv4、messages、tools、tool_choice、stream_options 及采样参数。只有传入 `--model` 时才覆盖模型名。

## 复制到已经运行 vLLM HTTP 服务的容器

在宿主机项目目录执行；将 `your-vllm-container` 替换为实际容器名：

```bash
cd /Users/zhangfan/project/aico_timedelay_report/aico_timedelay_test_report
CONTAINER=your-vllm-container
docker exec "$CONTAINER" mkdir -p /tmp/aico-replay
docker cp replay_vllm_requests.py "$CONTAINER":/tmp/aico-replay/
docker cp dsv_modify_0814/dsv4_3_aico.jsonl "$CONTAINER":/tmp/aico-replay/
```

先校验输入，不调用模型：

```bash
docker exec "$CONTAINER" python3 /tmp/aico-replay/replay_vllm_requests.py \
  --input /tmp/aico-replay/dsv4_3_aico.jsonl --dry-run
```

先跑一条，确认模型与工具调用配置可用：

```bash
docker exec "$CONTAINER" python3 /tmp/aico-replay/replay_vllm_requests.py \
  --input /tmp/aico-replay/dsv4_3_aico.jsonl \
  --base-url http://127.0.0.1:8000/v1 \
  --limit 1 --output /tmp/aico-replay/smoke.jsonl
```

如果服务上的模型名不是 `dsv4`，在上述命令添加 `--model 实际服务模型名`。端口不是 8000 时修改 `--base-url`。脚本不负责启动模型服务。

全量顺序重放并取回结果：

```bash
docker exec "$CONTAINER" python3 /tmp/aico-replay/replay_vllm_requests.py \
  --input /tmp/aico-replay/dsv4_3_aico.jsonl \
  --base-url http://127.0.0.1:8000/v1 \
  --concurrency 1 --timeout 600 \
  --output /tmp/aico-replay/results.jsonl
docker cp "$CONTAINER":/tmp/aico-replay/results.jsonl ./vllm_replay_results.jsonl
```

`--concurrency 4` 可并发执行；`--offset 10 --limit 5` 只执行第 11～15 条记录。输出文件必须不存在，重复运行请换名称；省略 `--output` 会在当前目录创建带时间戳的新文件。服务启用认证时，在容器环境变量 `VLLM_API_KEY` 中设置密钥；可用 `docker exec -e VLLM_API_KEY ...` 传入宿主机已导出的同名变量。

## 重放语义与结果

- 每条历史请求独立重放，使用其已有的全部对话上下文；不会把本次生成的回复接到下一条请求中，也不会执行模型返回的工具调用。请求间不模拟原始时间间隔。
- 数据包含 `tools` 和 `tool_choice=auto`，服务需已配置与模型匹配的工具调用支持。脚本保留这些字段，服务不兼容时会记录 HTTP 错误响应。
- 每完成一条就写入并刷新 JSONL；并发时按完成顺序写入，可通过 `source_line`、`proxy_request_id` 对应原记录。没有自动重试；部分失败后会继续执行其他请求，最终返回退出码 1（全部成功为 0，输入或输出路径错误为 2）。
- 结果保存实际 `request_body`、原始耗时 `original`、HTTP 状态、完整 SSE 事件 `response_events`（包含工具及推理增量）、`extracted_answer`、服务返回的 `usage` 和错误。非流式或 HTTP 错误响应保存在 `response_body`。
- `ttft_ms` 从请求发送前开始计时，到首个非空正文、推理或工具调用增量；忽略只有 role 的事件。工具调用元数据也算首个有效输出，因此不等同于严格的第一个文本 token。非流式请求无法测得 TTFT，记为 null。
- `total_duration_ms` 为请求开始到响应处理结束的耗时。`mean_output_chunk_interval_ms` 为有效输出事件间隔均值，**不是每 token 耗时 TPOT**，一个事件可能包含多个 token。原始日志 TTFT 的统计口径可能不同，比较前需确认。
- 未收到 SSE `[DONE]` 会标记失败，已收到的事件仍然保留。`--timeout` 控制连接和单次 socket 读取超时，不限制完整请求总时长。
- 脚本不使用环境中的 HTTP 代理；结果格式独立，不直接兼容原 `llm_benchmark.py` 的 `MetricsAnalyzer`。

本地验证：

```bash
python3 -m unittest discover -s aico_timedelay_test_report -p 'test_replay_vllm_requests.py' -v
```

## 原 benchmark 的增量与投机统计

每条结果的 `output_chunks` 记录 `choices[0].delta` 中的 content、reasoning、reasoning_content、tool_calls 和旧式 function_call。工具字段按 `json.dumps(value, ensure_ascii=False)` 转为文本，同一 SSE 事件的所有非空输出合并为一段。每段记录抵达时间 `arrival_ms` 和与上一有效段的间隔 `latency_ms`，第一段 latency 为 TTFT。角色、usage 和 finish_reason 单独出现时不计作输出段。`content_chunks` 继续保留纯正文用于排查，统计使用 `output_chunks`。

`accumulated_content`、`accumulated_reasoning`、`accumulated_tool_call`、`accumulated_function_call` 分别保存第一 choice 的累计输出，`finish_reason` 保存其最后一个非 null 结束原因。累计工具文本为各段 JSON 串直接拼接，不是合并后的完整工具调用对象；原始事件保存在 `response_events`。

启用原算法需要将 **`req_metadata.py`** 放在脚本同目录，并提供 `transformers` 和与服务一致的 tokenizer。脚本直接调用本仓库的原实现，不需要 `benchmark_args.py`。复制到容器时额外执行：

```bash
docker cp req_metadata.py "$CONTAINER":/tmp/aico-replay/
```

```bash
python3 replay_vllm_requests.py \
  --input dsv4_3_aico.jsonl \
  --base-url http://127.0.0.1:8000/v1 \
  --benchmark-metrics \
  --tokenizer-path /models/your-model \
  --spec-step-num 3 \
  --output results_spec3.jsonl
```

`3` 仅为示例，必须填写原 benchmark 使用的、与服务投机配置一致的值；此参数不会启用或改变服务端投机解码。基本重放仍只依赖标准库。

每条结果新增 `benchmark_metrics`：

| 字段 | 计算方式 |
| --- | --- |
| `decode_token_num_list` | 原 `get_decode_token_num_list(tokenizer)` 返回的增量 token 数列表 |
| `content_ttft_ms` | 原 metadata 的 prefill latency |
| `tpot_ms` | decode latency 总和 / decode token 总数 |
| `avg_spec_len` | decode token 总数 / decode 增量段数，要求 spec_step_num > 0 |
| `per_position_acceptance_rate` | 原 `get_acc_per_position(tokenizer)` 返回的逐位置接受率 |
| `spec_acc_pct` | 各位置接受率均值 × 100 |

当前具体口径（`spec_step_num = K > 0`）：首段有效输出作为 prefill，不参与 decode 统计；随后对每段合并输出文本单独执行 `tokenizer.encode(text, add_special_tokens=False)`。忽略分词长度为 0 的段。设剩余各段 token 数为 `L`：

- `AvgSpecLen = sum(L) / 段数`，包含原算法假设的 1 个非投机 token。
- 第 `i` 个位置的接受率为 `count(L - 1 >= i) / 段数`，`i` 从 1 到 K。这是所有段上的累计位置接受率，不是以到达上一位置为条件的条件接受率。
- 例如 decode 增量长度为 `[4, 2, 1]`、K=3，则 AvgSpecLen=2.333，逐位置接受率为 `[66.67%, 33.33%, 33.33%]`，SpecAcc=44.44%。
- 当 K=0 时，原实现直接把每段 decode 增量计作 1 token，不执行分词计数；重放脚本保留此口径。

结束后终端输出总体指标，并写入 `results_spec3.jsonl.summary.json`。TTFT、AvgSpecLen、各位置接受率采用逐请求均值，TPOT 按 decode token 数加权，与原分析器总体聚合方式一致。失败或没有任何有效输出增量的请求不纳入统计；汇总中的 `analyzed_requests` 为实际纳入数。工具调用 JSON 的结构字符也进入增量分词，因此 TPOT、投机步长和接受率是序列化输出上的估算，并非引擎真实计数，不宜与此前纯正文版本直接比较。`benchmark_metrics.content_ttft_ms` 为兼容旧字段保留，现在与新增的 `benchmark_metrics.ttft_ms` 一样表示首个有效输出延迟。

当前测试已执行真实 `ReqMetadata` 算法，使用可控 tokenizer 验证逐位置接受率、平均步长、TPOT、K=0 和仅 prefill 的边界情况。本地未安装 transformers，测试仅替换其导入和 tokenizer，不替换原统计算法；尚未验证真实模型 tokenizer 和容器端数值。

## 运行结束时的总体统计

无论是否启用 `--benchmark-metrics`，运行结束后均打印中文总体统计，并写入 `<结果文件>.summary.json`。每条历史请求算一次任务；失败请求不进入下列平均值。每项均显示有效请求数量，缺失数据在终端显示 N/A、JSON 中为 null，不以 0 代替。

| 终端指标 | 汇总 JSON 字段 | 口径 |
| --- | --- | --- |
| 平均首字耗时 TTFT | `ttft_ms` | 成功请求的首段非空输出（正文/推理/工具）延迟的算术平均 |
| 增量耗时 TPOT | `tpot_ms` | decode 总耗时 / decode 总 token 数，token 加权；需要 benchmark-metrics |
| 平均投机步长 | `avg_spec_len` | 先求每条请求的平均步长，再对请求取算术平均；需要 benchmark-metrics 和 K>0 |
| 每一步平均接受率 | `per_position_acceptance_rate` | 每个投机位置分别对请求取算术平均，JSON 为 0～1，终端显示百分比 |
| 单次任务平均总耗时 | `avg_task_duration_ms` | 成功请求各自的 total_duration_ms 算术平均，不使用整批耗时 / 请求数 |
| 平均 prefill 长度 | `avg_prefill_tokens` | 服务 usage.prompt_tokens 的算术平均，包含服务计入的完整提示词 |
| 平均输出 token 长度 | `avg_output_tokens` | 服务 usage.completion_tokens 的算术平均，包含首段输出；不是排除 prefill 输出段的 avg_decode_len |

输入数据已经有 `stream_options.include_usage=true`。如果服务仍未返回 usage，token 长度显示 N/A，不使用可能遗漏 tools、chat template 或推理输出的本地估算替代。纯工具调用和纯推理请求也参与 TTFT、TPOT 和投机统计；只有首段而没有后续有效增量时，参与 TTFT，但 TPOT 和投机指标没有样本。开启全部指标请使用上方含 `--benchmark-metrics --tokenizer-path ... --spec-step-num ...` 的命令。

汇总还保存成功数、失败数、整批实际耗时 `wall_time_s`、统计错误数和各指标 `sample_counts`。整批耗时包含客户端写入、分析等开销；请求延迟在客户端 tokenizer 分析前已经结束计时。
