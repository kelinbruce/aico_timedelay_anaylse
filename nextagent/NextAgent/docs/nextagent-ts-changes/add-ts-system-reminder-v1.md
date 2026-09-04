# add-ts-system-reminder-v1

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：System Reminder

状态：active
类型：实施 change
主要 owner：`agent-context-engine`（SR 管道、包装器、合并器、render 集成、budget 集成、Producer 调用点编排）
协作 owner：`agent-core`（`max_turns_reached` 软终止改造 `default-agent.ts` 循环逻辑）、`agent-runtime`（通知队列、Producer）
依赖：`add-ts-context-budget-explainability`（`budgetPlan` 数据源）、`add-ts-context-compression`（`compressionEvidence` 数据源）、`add-ts-context-prompt-shaping`（skill disclosure 接入）

目标：
- 系统可通过 `<system-reminder>` 标签向模型注入运行时上下文，标签内容被正确包装、合并到模型输入中。
- 模型能正确解读标签语义，不将其归因于用户指令或工具输出（system prompt 声明已就位）。
- 没有需要注入的系统事件时，模型输入与无 SR 机制时完全一致。
- v1 交付 10 种有实际 Producer 的 SR 类型，覆盖核心通知、用量感知、压缩感知、技能展示和文件引用场景。

规格输入：
- SR 类型枚举为闭包联合类型，v1 覆盖 10 种：`queued_command`、`max_turns_reached`、`date_change`、`token_usage`、`output_token_usage`、`compaction_reminder`、`context_efficiency`、`skill_listing`、`invoked_skills`、`compact_file_reference`。
- 每种类型映射唯一 `SystemReminderRole`（INJECT / CONSTRAIN / NUDGE / TERMINATE）。
- `wrapInSystemReminder()` 包装为 `<system-reminder>` 标签；`ensureSystemReminderWrap()` 幂等兜底。
- SR 管道（wrap → smoosh → merge）在 `DefaultModelInputRenderer.render()` 中 `assertToolPairing` 之后运行。
- smoosh 只操作 text content block，不修改 tool-call/tool-result 结构。
- merge 不合并 `meta: true` 的 generated message。
- SR 为空时管道是 no-op，保证零影响回归。
- `ContextAssemblyRequest` / `ContextAssembly` 新增可选 `systemReminders?` 字段。
- `ContextSourceCategory` 新增 `"system_reminder"` 值，SR source candidate priority 为 `"optional"`。
- `max_turns_reached` 改造：`round === maxRounds - 1` 注入 SR（软终止），模型仍调用工具则回退硬终止。
- `token_usage` 消费已有 `budgetPlan`，超过 80% 阈值时触发。
- `compaction_reminder` / `context_efficiency` 消费已有 `compressionEvidence`。
- `skill_listing` / `invoked_skills` 消费已有 `CapabilityCatalog`。
- `skill_listing` SR 替换现有 `renderSkillDisclosure()` 调用，避免双重注入。
- `compact_file_reference` 消费压缩流程中的 covered refs。
- 通知队列为 in-memory 实现，进程重启后丢失。
- SR 内容由 Producer 保证 presentation-safe，不含 raw prompt / model output / credential / path。

契约输入：
- `agent-contracts/system-reminder`：新增独立 owning subpath（已在 proposal 中论证 distinct owning module 正当性），导出 `SystemReminderType`、`SystemReminderRole`、`SystemReminder` 接口、`SystemReminderCollectorPort`、`SystemReminderWrapperPort`。
- `agent-contracts/context`：`ContextAssemblyRequest` / `ContextAssembly` 新增可选 `systemReminders?` 字段（contract refinement）。
- `agent-common`：`ContextSourceCategory` 联合类型新增 `"system_reminder"` 值。

实现约束：
- `agent-context-engine/src/system-reminder/` 不 import `agent-runtime`。
- `RenderedModelInput` 字段集合不被修改——SR 内容合并进 `messages` 数组。
- `SessionMessageRole` 枚举不被修改——SR 是 render 后处理注入的标签内容，不是新的消息角色。
- SR 是 turn-scoped 瞬时数据，不参与持久化、不参与 checkpoint/recovery。

非目标：
- 不实现阶段 2 的 20 种类型（Hook 系统、任务追踪、工具/Agent 管理、技能发现、记忆、MCP、多 Agent）。
- 不修改 `redaction-policy`、`invocation-audit` capability。

验收要点：
- contract test 断言 `SystemReminderType` 精确包含 10 个值。
- unit test 覆盖 wrap 幂等、smoosh 不修改 tool block、merge 不合并 meta generated。
- integration test 带 SR 输出含标签、不带 SR 输出不变。
- 验证 `renderSkillDisclosure` 已删除，system message 中不再包含技能列表。
- integration test 验证 `max_turns_reached` 软终止 + 硬终止兜底。
- architecture test 断言 `agent-context-engine/src/system-reminder/` 不 import `agent-runtime`。
- contract test 断言 `RenderedModelInput` 字段集合未被修改。

并行边界：
- 管道 owner 为 `agent-context-engine`，不得修改 runtime lifecycle、session message 或 capability invocation 契约。
- 软终止改造 owner 为 `agent-core`，不得改写 runtime terminal ownership。
