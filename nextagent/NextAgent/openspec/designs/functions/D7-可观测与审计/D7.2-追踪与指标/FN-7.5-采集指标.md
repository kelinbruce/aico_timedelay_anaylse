# FN-7.5 采集指标

> 能力域 D7 可观测与审计 · 子域 [D7.2 追踪与指标](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-7.4](../../../features/D7-可观测与审计/D7.2-追踪与指标/F-7.4-运行指标.md) |
| 主规格 | `agent-runtime-metrics` |
| 接口 | 系统内部，指标注册表 |

## 描述

系统采集运行时指标，经安全字段允许列表，控制维度基数。

## 前置条件

- 系统运行。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 指标数据 | 是 | 运行时指标 |

## 输出

安全指标。

## 处理过程

1. 系统采集运行时指标。
2. 经安全字段允许列表过滤。
3. 控制维度基数，高基数降级；model metrics 保留调用、duration、usage、stream timing 与有界 outcome/token_type。
4. model metrics 不输出 `provider_kind`、`modelId` 或 `providerId` label。

## 结果

- 正常：安全指标可用。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 首版指标清单 | `web_request_total`、`web_request_duration_seconds`、`request_outcome_total`、`request_duration_seconds`、`request_phase_duration_seconds`、`request_first_content_latency_seconds`、`model_invocation_total`、`model_invocation_duration_seconds`、`model_token_usage_total`、`model_ttft_seconds`、`model_chunk_latency_seconds`、`model_total_latency_seconds`、`capability_invocation_total`、`capability_invocation_duration_seconds`、`gateway_call_total`、`gateway_call_duration_seconds`、`observability_degradation_total`、`projector_projection_total`、`request_token_count`、`request_active_concurrency`、`request_abnormal_termination_total`、`operation_timeout_total`、`model_flow_control_total`、`model_token_count`、`model_output_token_rate`；模型调用次数只按 terminal invocation 计数 | `agent-runtime-metrics`：`Metric inventory 必须声明来源、标签和增强需求`、`模型性能指标必须按终态调用提供次数、分布和生成速率`、`对话指标必须覆盖终态次数、首字、总耗时、排队、并发和 token 分布`、`异常指标必须使用唯一权威终态分类` |
| 标签边界 | 只允许各指标声明的固定低基数标签；模型指标不得使用模型或 provider identity 标签 | `agent-runtime-metrics`：`Metric labels 必须低基数且固定` |
| 页面首字时延测量 | `request_first_content_latency_seconds` 测量 `REQUEST_ACCEPTED.createdAt` 到该 run 首个 `LLM_CONTENT_DELTA` 或 `LLM_THINKING_DELTA` 的 `createdAt`；per run 只产出一次 `REQUEST_FIRST_CONTENT_DELIVERED` observation；run 无内容交付时不产出 sample；`durationMs` 经 `Math.max(0, ...)` 钳制；observation 不含 prompt/content text/provider raw delta | `agent-runtime-metrics`：`Request 首个内容交付时延必须从 request accepted 测量到首个可见内容` |
