## 背景和现状（Context）

电信运维需要度量"请求 accept → 工作流引擎启动"之间的延迟。当前只能通过查数据库（timeline event timestamp diff）计算，缺少纯日志方式的快速诊断手段。

已有 commit `0b26e5f7c` 尝试在实现层直接加日志，但检视发现：
1. 把 `runtime.run.dispatched` 从 debug 升级为 info，违反 event-catalog.md 冻结的 `scheduler/submit degradation` 行（`queue/dispatched/execution-finished debug`）。
2. 新增 `workflow.execution.started` 可观测信号没有对应 OpenSpec change，违反 AGENTS.md "规格优先"硬约束。
3. `createdAt` 字段名暗示是 dispatch 时间，实际是 run 创建时间（accept 时间代理），语义混淆。
4. 测试锁死了违规级别（断言 dispatched 为 info），且缺 negative-case（未断言 `workflow.execution.started` 不进入 timeline/audit/Web API）。

预存缺口：`runtime.run.turn_completed`（submit.ts:6464）已经是 info 级别，对所有 run 生效，携带 `durationMs`，但既不在 event-catalog.md 里也不在 runtime-logging spec 里。

## 目标和非目标（Goals / Non-Goals）

**目标**：
- 冻结 `workflow.execution.started` 诊断事件（事件名、info 级别依据、安全字段、MUST NOT 排除项）。
- 把 `runtime.run.dispatched` 从 debug 升级为 info，新增 `runCreatedAtMs` 字段。
- 规格化预存缺口 `runtime.run.turn_completed`。
- 支持纯日志计算 `latency = startedAtEpochMs - runCreatedAtMs`（accept → workflow start）。

**非目标**：
- 不实现"dispatch → workflow start"（不含排队）的 latency 计算。
- 不修改 `dispatched` 的触发位置或条件。
- 不修改 event-catalog.md 的 archived 文件。
- 不新增 Web API、runtime command 或 persistence fact。

## 设计决策（Decisions）

### D1 — latency 语义：accept → workflow start

用 `runCreatedAtMs`（= `Number(run.createdAt)`）作为 accept 时间代理。这与 submit.ts:6462 的 `turn_completed` 注释一致："from the user message being accepted (run.createdAt)"。

latency 公式：`workflow.execution.started.startedAtEpochMs - runtime.run.dispatched.runCreatedAtMs`

这个差值包含排队等待时间。run 创建后到被 dispatch 之间隔着排队/同 lane 等待，dispatch 后到 workflow 启动之间隔着 routing 决策。如果未来需要"dispatch → workflow start"（不含排队），可用 dispatched 日志的 writer `timestamp` 相减，不需要额外字段。

### D2 — 字段命名：runCreatedAtMs 而非 createdAt

PR 原来的 `createdAt` 字段名暗示是 dispatch 时间，实际是 run 创建时间。改为 `runCreatedAtMs` 消除歧义，与 `startedAtEpochMs` 命名风格对齐（两者都是 epoch ms 值）。

### D3 — dispatched 升级为 info 的独立价值论证

`dispatched` 的 info 级别价值不限于 workflow latency。它对所有 run 提供：
- dispatch 时间戳，结合 writer `timestamp` 可算排队等待：`queue_wait = dispatched.timestamp - runCreatedAtMs`
- 与 `turn_completed` 配对，构成 accept → dispatch → terminal 的三段分解

非工作流 run（MODEL_DRIVEN_LOOP，纯 LLM 直答或 LLM+tool 循环）有 dispatched info 但没有 `workflow.execution.started`，这不是真正的孤儿——dispatched 有独立于 workflow latency 的诊断价值。`workflow.execution.started` 只对 DETERMINISTIC_FLOW run 有意义，这是路由定义决定的。

### D4 — turn_completed 规格化

`runtime.run.turn_completed` 已经是 info 级别，对所有 run 生效，携带 `durationMs`（= `terminalEvent.createdAt - run.createdAt`）。本 change 一并补上其规格化：事件名、info 级别、字段集、MUST NOT 排除项。代码不需要修改（已有实现），只补规格和测试。

### D5 — event-catalog.md 冻结行修改

event-catalog.md 当前只存在于 archived change 目录 `openspec/changes/archive/2026-08-11-add-ts-runtime-operational-log-hardening/event-catalog.md`。稳定基线 runtime-logging/spec.md:536 写了"Implementation SHALL conform to `event-catalog.md`"，但稳定 spec 目录下并没有这个文件的副本。

本 change 不修改 archived 文件，而是通过 runtime-logging spec 的 MODIFIED requirement 直接写入升级后的约束。具体修改：
- `dispatched` 从 `scheduler/submit degradation` 的 debug 组中拆出，升级为 info。
- "默认 info 问题定位骨架"中"routine stream、queue/dispatch、task trajectory build 和 maintenance success 可继续保持 debug"更新为把 dispatch 从该列表移除。

### D6 — 与既有 milestone 的去重关系

- `workflow.execution.started`（info，流程级）vs `workflow.node.started`（debug，节点级）：不重复。前者是整个 workflow execution 的启动里程碑，后者是单个节点执行启动。
- `runtime.run.dispatched`（info）vs `runtime.run.turn_completed`（info）：不重复。前者是 run 被调度执行，后者是 run 终态完成。两者配对构成 run 生命周期的首尾。

## 状态产物契约（State and Artifact Contract）

三个诊断事件都是 runtime diagnostic log，不产生持久化事实：
- `workflow.execution.started`：由 `workflowExecutionLogger` 输出，surface=runtime_diagnostic。
- `runtime.run.dispatched`：由 runtime `logger` 输出，surface=runtime_diagnostic。
- `runtime.run.turn_completed`：由 runtime `logger` 输出，surface=runtime_diagnostic。

三者都 MUST NOT 进入 timeline event、audit、metric、trace 或 Web API response。字段仅包含低基数诊断字段，MUST NOT 包含 prompt、模型输出、credential、路径或高基数字段。

## 质量属性（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 三个事件字段均为低基数诊断字段，不含敏感内容；遵守 redaction 约束 | negative-case 测试断言不进入 timeline/audit/Web API |
| 可靠性恢复 | 纯日志诊断，不影响 request lifecycle | 现有测试无回归 |
| 可维护性 | latency 计算无需查数据库，纯日志 join | dispatched + started + turn_completed 三段分解测试 |
| 可测试性 | 事件名、级别、字段均有 deterministic 测试 | unit/contract tests |
| 审计/可追溯性 | runId 作为 join key，可追溯到具体 run | observability contract tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| workflow.execution.started 事件冻结 | 1.1, 1.2 | engine unit test + negative-case test |
| dispatched 升级为 info | 2.1 | submit-acceptance-order test |
| turn_completed 规格化 | 3.1 | submit test |
| 三个事件不进入 timeline/audit/Web API | 1.2, 2.2, 3.2 | negative-case tests |
| OpenSpec 全量有效 | 4.1 | openspec validate --all --strict |
| 既有测试无回归 | 4.2 | npm test |
