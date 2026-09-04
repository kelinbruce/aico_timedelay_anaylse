# Observability Metrics 指标清单

本文同步当前代码中的 metrics inventory，供部署、运维、二次开发和测试排查使用。唯一代码事实源是 `packages/agent-observability/src/metrics/metric-descriptors.ts` 的 `METRIC_DESCRIPTORS`；投影规则位于 `metrics-registry.ts`，OpenSpec 归属见 `openspec/specs/agent-runtime-metrics/spec.md` 与 `openspec/specs/system-health-check/spec.md`。

## 统一约束

- `agent-observability` 拥有 metric name、label、unit、histogram boundaries 与 OTel instrument；runtime、model、capability、gateway 等业务 package 只发布 metrics-agnostic 事实。
- 指标只有 `counter` 与 `histogram`。所有 label 都是 descriptor 声明的固定低基数枚举；身份、session/run/request/message id、路径、prompt、content、provider raw data、错误正文、credential 与 trace/span id 不得成为 label。
- 缺失、不完整或非法输入只省略依赖该输入的 sample，不估算、不补零，也不阻塞业务路径。
- LOCAL 模式由本地 metrics history exporter 写入 `nextagent-metrics` NDJSON；REMOTE 模式通过 OTel/OTLP 导出。两者消费同一 OTel 聚合语义，不把 metrics 镜像到 operational log。
- HTTP server 指标由 OpenTelemetry HTTP/server instrumentation 拥有。NextAgent 不创建一套平行的 HTTP 请求计数或耗时指标。

## 聚合与查询口径

所有 histogram 都启用 `recordMinMax`。查询窗口内：平均值为 `sum / count`，最大值为 `max`，sample 总数为 `count`；token histogram 的 `sum` 同时给出 token 总数。Counter 的窗口增量给出次数或累计 token 数。

固定 histogram boundaries：

- 秒：`0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300`
- token 数：`1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144`
- token/s：`1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000`
- 并发：`0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024`

## 指标总览

| 域 | 指标 | 类型/单位 | 标签 | 采集语义 |
|---|---|---|---|---|
| Request | `request_outcome_total` | counter / `1` | `status` | 每个 accepted request run 在 terminal commit 计一次；这里的“对话次数”不是 session 数。 |
| Request | `request_duration_seconds` | histogram / `s` | `status` | accepted 到 terminal commit 的总耗时。 |
| Request | `request_phase_duration_seconds` | histogram / `s` | `phase`, `status` | accepted、queued、executing、terminal commit 阶段耗时；未进入执行态的 run 不产生 queued sample。 |
| Request | `request_first_content_latency_seconds` | histogram / `s` | `outcome` | accepted 到首个用户可见 content/thinking 进入 canonical stream；不包含网络传输、浏览器处理或绘制。 |
| Request | `request_token_count` | histogram / `{token}` | `token_type`, `status` | 对一个 terminal request 内全部 terminal model invocation 聚合；某 token 类型必须每次调用都提供，才输出该类型 sample。 |
| Request | `request_active_concurrency` | histogram / `1` | 无 | 当前 app runtime 实例在每次执行态进入/离开后的 active run 数；平均/最大是转换采样统计，不是时间加权值或集群全局值。 |
| Request | `request_abnormal_termination_total` | counter / `1` | 无 | `FAILED` request terminal 每次计一次。 |
| Anomaly | `operation_timeout_total` | counter / `1` | `boundary` | request/model/capability/gateway 的权威 timeout 终态计数。 |
| Anomaly | `model_flow_control_total` | counter / `1` | 无 | terminal model safe reason 为 `MODEL_RATE_LIMITED` 时计一次，即使随后 fallback 成功也保留该事实。 |
| Policy | `policy_decision_total` | counter / `1` | `operation_kind`, `outcome` | 风险、授权与恢复策略决策。 |
| Model | `model_invocation_total` | counter / `1` | `outcome` | 只在每次实际模型调用的 terminal observation 计一次；started 不计数。 |
| Model | `model_invocation_duration_seconds` | histogram / `s` | `outcome` | terminal model invocation 总耗时。 |
| Model | `model_token_usage_total` | counter / `{token}` | `token_type`, `outcome` | terminal normalized usage 提供的 input/output/total token 累计数。 |
| Model | `model_token_count` | histogram / `{token}` | `token_type`, `outcome` | 每次 terminal model invocation 的 input/output token 分布。 |
| Model | `model_output_token_rate` | histogram / `{token}/s` | `outcome` | `outputTokens / ((durationMs - firstContentLatencyMs) / 1000)`；仅在输入完整且区间为正时输出。 |
| Model stream | `model_ttft_seconds` | histogram / `s` | `outcome` | 模型请求到首个可见 content/thinking 的延迟。 |
| Model stream | `model_chunk_latency_seconds` | histogram / `s` | 无 | 相邻可见 chunk 延迟。 |
| Model stream | `model_total_latency_seconds` | histogram / `s` | `outcome` | 模型 stream 全程耗时。 |
| Capability | `capability_invocation_total` | counter / `1` | `capability_kind`, `outcome` | Tool、Skill、Agent、Workflow 调用终态计数。 |
| Capability | `capability_invocation_duration_seconds` | histogram / `s` | `capability_kind`, `outcome` | Capability 调用终态耗时。 |
| Attachment | `attachment_intake_total` | counter / `1` | `outcome`, `reason_code`, `size_bucket` | 附件 intake 结果。 |
| Attachment | `attachment_intake_duration_seconds` | histogram / `s` | `outcome`, `reason_code`, `size_bucket` | 附件 intake 耗时。 |
| Gateway | `gateway_call_total` | counter / `1` | `gateway_category`, `outcome` | Gateway 调用结果。 |
| Gateway | `gateway_call_duration_seconds` | histogram / `s` | `gateway_category`, `outcome` | Gateway 调用耗时。 |
| Observability | `observability_degradation_total` | counter / `1` | `surface`, `reason_code` | 可观测面降级计数。 |
| Observability | `projector_projection_total` | counter / `1` | `surface`, `result` | Projector 投影结果。 |
| Configuration | `configuration_evaluation_total` | counter / `1` | `component`, `outcome` | 系统配置评估结果。 |
| Health | `health_probe_total` | counter / `1` | `endpoint`, `status`, `component` | 健康探针结果。 |
| Health | `health_probe_duration_seconds` | histogram / `s` | `endpoint`, `status`, `component` | 健康探针耗时。 |

## 目标统计映射

模型请求次数使用 `model_invocation_total`；平均/最大首字符时间使用 `model_ttft_seconds`；平均/最大增量 token 速率使用 `model_output_token_rate`；输入/输出 token 的平均、最大、总数分别查询 `model_token_count` 的 `sum/count`、`max`、`sum`；平均/最大耗时使用 `model_invocation_duration_seconds`。

框架对话次数使用 `request_outcome_total`；平均/最大界面首字时间使用 `request_first_content_latency_seconds`；平均/最大总耗时和排队时间分别使用 `request_duration_seconds` 与 `request_phase_duration_seconds{phase="queued"}`；平均/最大并发使用 `request_active_concurrency`；请求输入/输出 token 的平均、最大、总数使用 `request_token_count` 的 `sum/count`、`max`、`sum`。

异常终止、超时、流控次数分别使用 `request_abnormal_termination_total`、`operation_timeout_total` 与 `model_flow_control_total`。

## 导出验证

- 本地导出：检查 `nextagent-metrics` NDJSON 中 OTel resource metric snapshot 的 name、unit、labels、histogram boundaries、count/sum/min/max。
- 远端导出：在 OTLP backend 以同一 name/unit/labels 查询，aggregation temporality 由 deployment OTel 配置决定。
- 测试 fixture：`createInMemoryMetricsRegistry()` 仅用于测试原始 sample；生产 registry 不保留 raw samples。

## 接入客户监控体系

### LOCAL 模式（默认）：消费 NDJSON 文件

本地指标写入 `logs/nextagent-metrics.ndjson`（OTel JSON 序列化，每个 metric 一个 resource metric snapshot）。接入方式：

- **自建采集**：用 Filebeat / Vector / Fluent Bit tail 该文件，解析 JSON 后送入你的存储；histogram 字段（`count`/`sum`/`min`/`max`/bucket counts）按上文"聚合与查询口径"换算。
- **验证**：发起一轮请求后检查文件出现 `request_outcome_total`、`model_invocation_total` 等 snapshot。

### REMOTE 模式：OTLP 导出

REMOTE 模式通过 OTel/OTLP 把 metrics（与 trace 共用导出通道）推送到远端 collector。trace 侧配置见 [OTEL Trace 事件与上报指南](./25-otel-trace-reporting.md) 的 `observability.tracing`（`endpoint` / `authPkRef` / `authSkRef` / `serviceName`）；metrics 远端导出依赖同一 OTel provider composition，由部署模式（`gateway.gateways[].deploymentMode`）与 OTel 配置共同决定。

注意事项：

- `authPkRef` / `authSkRef` 是 NextAgent 自定义凭据对，不是 OTel 标准头认证；Collector 侧需要对应配置接收。
- batch 参数当前为固定值（见 25 篇），无采样率配置项；大流量场景先在 Collector 侧做聚合/降采样。
- 结构化**日志**不走 OTel Logs signal（见 25 篇说明）；需要统一日志采集的客户请直接采集 JSONL 日志文件（`nextagent-operational.log.*.jsonl`）。

### 常见问题

- 收不到指标：先确认部署模式（LOCAL 写文件、REMOTE 走 OTLP），再检查 `logs/` 目录权限。
- 指标名在 backend 找不到：OTel metric name 会按导出规范映射（点号转下划线等），以实际导出的 name 为准，再对照本清单。
