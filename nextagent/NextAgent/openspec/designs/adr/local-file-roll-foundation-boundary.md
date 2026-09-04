# ADR: local-file-roll technical foundation boundary

## 状态

Accepted（`add-ts-runtime-operational-log-hardening`）

## 背景

Operational log、LOCAL metrics history 和 LOCAL audit 都需要安全的 async rolling、gzip、reconciliation 和 elapsed retention，但三者的 schema、owner、failure semantics 和 deployment selection 完全不同。复制三套文件机制会使 selector、active exclusion、失败保守性和 DST/retention 规则漂移；把它们合并为通用“file output”又会混淆领域语义。

## 决策

新增受限 Node-only package `agent-local-file-roll`，只共享机制，不共享输出语义或运行时状态。production consumer allowlist 固定为：

1. `agent-log` 的 operational writer；
2. `agent-observability` 的 `LocalMetricHistoryExporter`；
3. `agent-platform-gateway-local` 的 file audit gateway。

三个 owner 分别构造 policy 和 handle；不得共享 destination、active identity、buffer、timer、maintenance lane、state、close 或 policy object。foundation 不依赖 common/contracts/implementation package，不暴露 arbitrary matcher/delete callback/domain mode。

## 被放弃的方案

- `agent-utils`：边界过宽，无法建立安全依赖防火墙。
- 通用 `agent-file-output`：会把 log/audit/metrics DTO、mode 和 failure mapping带入共享层。
- 三套复制实现：会产生安全敏感 selector、gzip/reconciliation/aging 的第二套和第三套实现。
- 让 `agent-log` 承载全部三类文件：会错误地把 audit/metrics 变成 operational log sink。

## 结果

需要一个明确的 implementation-to-technical-foundation 例外和三个 consumer allowlist；其余 implementation-to-implementation firewall 保持不变。新增机制行为先在 foundation contract tests验证，owner tests只验证自己的 policy/schema/result mapping和跨 owner 隔离。
