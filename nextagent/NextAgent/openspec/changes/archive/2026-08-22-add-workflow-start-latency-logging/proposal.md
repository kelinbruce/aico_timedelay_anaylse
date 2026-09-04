## Why

电信运维需要度量"请求 accept → 工作流引擎启动"之间的延迟，以定位排队等待和路由开销。当前只能通过查数据库（timeline event timestamp diff）计算，缺少纯日志方式的快速诊断手段。

已有 commit `0b26e5f7c` 尝试在实现层直接加日志解决此问题，但检视发现两处 P0 治理违规：把 `runtime.run.dispatched` 从 debug 升级为 info 违反已冻结 event-catalog 级别，且新增 `workflow.execution.started` 可观测信号没有对应 OpenSpec change。本 change 先补规格再改实现。

## What Changes

- **新增** workflow-execution-engine 诊断事件 `workflow.execution.started`：在 `InMemoryWorkflowExecutionService.execute()` 的 recipe version 校验通过后、`executePath` 之前输出 info 级别 runtime diagnostic log，携带 `executionId`、`recipeName`、`runId`、`startedAtEpochMs`。仅用于本地运行诊断，MUST NOT 进入 timeline/audit/metric/trace/Web API。
- **升级** `runtime.run.dispatched` 从 debug 为 info，新增 `runCreatedAtMs` 字段（= `Number(run.createdAt)`），与 `workflow.execution.started` 共享 `runId` 作为 join key，支持纯日志计算 `latency = startedAtEpochMs - runCreatedAtMs`。
- **规格化** 预存缺口 `runtime.run.turn_completed`：该事件已经是 info 级别并对所有 run 生效，但既不在 event-catalog.md 里也不在 runtime-logging spec 里。本 change 一并补上其事件名、字段、级别和排除项约束。

## Latency 语义

latency = `workflow.execution.started.startedAtEpochMs - runtime.run.dispatched.runCreatedAtMs`

度量的是"request acceptance → workflow engine start"（含排队等待时间）。`runCreatedAtMs` 作为 accept 时间代理，与 `turn_completed` 的 `durationMs`（`terminalEvent.createdAt - run.createdAt`）使用同一 accept 时间定义。

## 不在范围内（Explicit Non-Goals）

- 不修改 `runtime.run.dispatched` 的触发位置或条件，只改级别和新增字段。
- 不新增 Web API、runtime command 或 persistence fact。
- 不修改 `workflow.node.started`（debug，节点级）——`workflow.execution.started` 是流程级 milestone，两者不重复。
- 不实现"dispatch → workflow start"（不含排队）的 latency 计算——如未来需要可用 dispatched 日志的 writer `timestamp` 相减。
- 不修改 event-catalog.md 的 archived 文件——通过 runtime-logging spec MODIFIED requirement 落实升级约束。

## Roadmap 关系

所属分组：P3 — Workflow 执行范式 / Observability 生产强化。

依赖：`add-ts-runtime-operational-log-hardening`（已归档，冻结了 event-catalog.md 的 `scheduler/submit degradation` 行和"默认 info 问题定位骨架"约束）。本 change 修改该 change 冻结的 `dispatched` 级别。

先例：`refine-ts-workflow-cancel-policy`（active）在 workflow-execution-engine spec 里冻结了 `workflow.cancel_detected` 等 4 个诊断事件，本 change 参照其写法冻结 `workflow.execution.started`。

## Capability 影响

### 修改的 Capability

- `workflow-execution-engine`：新增 `workflow.execution.started` 诊断事件 requirement。
- `runtime-logging`：MODIFIED `Baseline operational catalog and signal budget` requirement，升级 `dispatched` 为 info 并规格化 `turn_completed`。

## 影响范围

- `agent-runtime/lifecycle/submit.ts`：`dispatched` 日志从 debug 改 info，字段 `createdAt` 改名 `runCreatedAtMs`。
- `agent-workflow/engine/index.ts`：`workflow.execution.started` 日志已有（commit `0b26e5f7c`），本 change 补规格。
- 测试：修复 `submit-acceptance-order.test.ts` 字段名断言，新增 negative-case 测试和 `turn_completed` 测试。
跨 package 边界不变。
