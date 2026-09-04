## 背景与问题（Why）

当前 health 已有对外入口诉求，但入口分层、真实检查边界、输出 schema、失败判定和安全诊断规则尚未作为独立契约冻结。health 与 metrics 有交集，但它的产品面是 HTTP health response 和 in-band evaluator，不应与 runtime metrics registry / taxonomy 混成一个 change。

本 change 只收敛 health check 能力，不定义 runtime metrics 的通用采集、registry 或 metric inventory。

## 变更范围（What Changes）

- 补强 `system-health-check`，冻结 primary / deep health endpoint 的业务分层。
- 定义最小 `HealthEvaluator` 和 `HealthProbe` composition contract。
- 明确 health response schema、HTTP status mapping、安全诊断字段和失败降级规则。
- 明确 health probe metrics 的语义和 labels 由本 change 拥有，写入机制复用 `add-ts-runtime-metrics` 的 `MetricsRegistry` / label validation primitives，不定义第二套 registry。

## 非目标（Non-Goals）

- 不定义 runtime/model/capability/gateway 的通用 metrics inventory。
- 不定义 Prometheus、OTLP metrics、StatsD、文件落盘、远端推送或后台 flush worker。
- 不把 health 类型提升到 `agent-contracts`。

## Capability 影响（Capabilities）

### 修改的 Capability

- `system-health-check`

## 影响范围（Impact）

- `agent-observability` health evaluator、safe diagnostics、probe timeout / AbortSignal handling。
- `agent-app` composition 将 runtime、gateway、model provider、capability 等 owner 暴露的 safe public checks 适配为 `HealthProbe`。
- `agent-channel-web` 暴露 `GET /health` 和 `GET /health/deep` 并只做 HTTP projection。
- `add-ts-runtime-metrics` 必须先提供 `MetricsRegistry` / label validation primitives，health probe metrics 才作为本 change 的 health-owned metric samples 写出；若 registry 不可用，health response truth 不受影响。

## 归档前基线提升计划（Baseline Promotion Plan）

- `openspec/specs/system-health-check/spec.md`
