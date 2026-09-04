# add-ts-system-reminder-v2

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：System Reminder

状态：active
类型：实施 change
主要 owner：各前置 change 的 owner 负责对应 Producer 的接入
协作 owner：`agent-context-engine`（阶段 1 管道已交付，阶段 2 不修改管道）
依赖：`add-ts-system-reminder-v1`（管道基础设施）、`add-ts-lifecycle-hook-execution`（Hook 投影 5 种）、`add-ts-task-tools`（任务追踪 3 种）、`add-ts-agent-tool` + `add-ts-invoked-agent-discovery`（工具/Agent 3 种）、`add-ts-memory-core`（记忆 2 种）

目标：
- 前置 change 完成后，对应的 SR 类型能自动产生并注入模型。
- Hook 执行结果投影为 5 种 SR 类型。
- 任务追踪系统的状态变更通过 3 种 SR 类型通知模型。
- 工具和 Agent 的动态变更通过 3 种 SR 类型同步给模型。
- 技能的发现和用户指定通过 2 种 SR 类型引导模型。
- 记忆系统的相关内容在会话初始化时通过 2 种 SR 类型注入。
- 大文件通过 `large_file_reference`（不限于 PDF）提醒模型分页读取。
- MCP Server 的连接/断开/资源通过 2 种 SR 类型通知模型。
- 多 Agent 协作通过 2 种 SR 类型建立团队上下文和消息通道。

规格输入：
- 扩展 `SystemReminderType` 枚举新增 20 种 v2 类型，在 type-registry 注册角色映射。
- Hook 系统 5 种：`hook_success`、`hook_additional_context`、`hook_blocking_error`、`hook_stopped_continuation`、`async_hook_response`。
- 任务待办 3 种：`todo_reminder`、`task_reminder`、`task_status`。
- 工具/Agent 管理 3 种：`deferred_tools_delta`、`agent_listing_delta`、`agent_mention`。
- 技能系统 2 种：`skill_discovery`、`skill_mention`。
- 记忆系统 2 种：`relevant_memories`、`nested_memory`。
- 附件 1 种：`large_file_reference`（不限 PDF，覆盖所有大文件类型）。
- MCP 2 种：`mcp_instructions_delta`、`mcp_resource`。
- 多 Agent 交互 2 种：`team_context`、`teammate_mailbox`。
- `teammate_mailbox` 是唯一 `rawInjection: true` 的类型——不包装 SR 标签，直接作为 user message。
- `HookReminderProjector` 投影规则稳定：TIMEOUT/FAILED 的 hook 不投影。
- `task_status` 的 running 状态必须包含防重复创建指令。
- 每种 Producer 独立接入，不修改管道代码。

契约输入：
- `agent-contracts/system-reminder`：`SystemReminderType` 枚举扩展（contract refinement）。
- 不修改 `context-engine` capability——管道已在阶段 1 就绪。

实现约束：
- 每种 Producer 接入时只需：枚举值 + type-registry 注册 + Producer 代码。
- Hook 投影器必须校验 `safeReason` 不含 forbidden field。
- `teammate_mailbox` 内容来自队友 Agent，必须经过 presentation-safe 过滤。

非目标：
- 不修改阶段 1 的管道。
- 不实现模式管理（plan_mode / auto_mode 等）。
- 不实现 `budget_usd`、`diagnostics`、`critical_system_reminder`。

验收要点：
- contract test 断言 `SystemReminderType` 枚举精确包含 30 种值（v1 10 + v2 20）。
- unit test 覆盖 Hook 投影 8 种场景（BEFORE/AFTER × error/reject/success/timeout）。
- unit test 验证 `teammate_mailbox` raw injection 不包装 SR 标签。
- unit test 覆盖 `large_file_reference` 多种大文件类型（PDF、CSV、日志）。

并行边界：
- 不修改 `RenderedModelInput` 字段集合。
- 不修改阶段 1 的 SR 管道。
- 各前置 change owner 独立接入 Producer，不互相依赖。
