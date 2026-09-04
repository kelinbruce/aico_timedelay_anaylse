# agent-local-file-roll

## 职责

提供 Node-only、无领域语义的本地逐行文件生命周期机制：异步有界 append、size 与进程本地 calendar-day 任一轮转、current-active identity、原子 gzip、startup reconciliation、elapsed-time retention、单 maintenance lane，以及有界 flush/close。

## 非职责

- 不理解 operational log、audit 或 metrics 的 schema、level、deployment mode、readiness 和失败语义。
- 不接受任意 matcher、delete callback、timezone/frequency、count retention、watermark 或业务 DTO。
- 不共享不同调用方的 destination、buffer、timer、maintenance lane、active identity 或 close 状态。
- 无 active destination 的 maintenance handle（如 developer diagnostic artifact 的 lazy handle）与完整 roll handle 复用同一 maintenance controller：在 destination 首次创建后接入既有单 maintenance lane，lazy 创建前不产生 timer、目录扫描或 retention 副作用。

## 依赖

只直接依赖 `pino-roll@4.0.0`、`sonic-boom@4.2.1` 和 Node.js `zlib`/filesystem primitives；不得依赖 `agent-common`、`agent-contracts` 或任何实现 package。

## 核心设计落点

- public API 只暴露 safe policy、append result、active identity、factory 和 bounded handle；handle 的单 owner maintenance listener只提供 `archive|retention`、`completed|failed` 和 affected count，不提供路径、异常或领域 mode。
- selector 只能从 validated directory、safe base name、`sequence | date-sequence` 和 extension 派生；只处理本 handle 可证明归属的 regular file，不跟随 symlink。
- closed source 归档顺序固定为 `.gz.tmp -> atomic .gz -> delete source`；archive 保留 source `closedAt`，任一失败保留 source并允许后续 reconciliation 重试。
- retention 使用 `closedAt + retentionDays * 24h`；daily 轮转使用进程本地时区，DST 不改变 elapsed retention。
- `agent-log`、`agent-observability` 的 `LocalMetricHistoryExporter`、`agent-platform-gateway-local` 的 file audit gateway 是仅有的三个 production consumer，各自创建独立 handle。

## 替换边界

否。它是受 dependency firewall 保护的 technical foundation，不是领域 adapter 或可由业务选择的输出模式。

## 验证关注点

- architecture negative fixtures 必须拒绝第四个 production consumer、reverse dependency 和 foundation 内的 domain vocabulary。
- contract tests 覆盖 size/daily/DST、atomic gzip、reconciliation、elapsed retention、active/unknown/symlink exclusion、buffer saturation、non-blocking append、single lane、failure/recovery outcome和 bounded double-close。
- 三个 consumer 的 policy integration 必须证明 base、buffer、schema、handle 和 lifecycle state 互不复用。

## Public Exports

`@nextagent/agent-local-file-roll`；`@nextagent/agent-local-file-roll/testing` 只供显式测试使用。
