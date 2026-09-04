# add-ts-memory-maintenance

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：扩展候选 / Long-term memory

状态：candidate
类型：扩展候选 change
主要 owner：Owner 12 Memory / Learning
依赖：add-ts-memory-core、add-ts-memory-aging

目标：
- 提供用户可操作的长期记忆维护接口，通过 Web/API 暴露。包括列表、详情、部分更新、明确遗忘、pin/unpin 和归档恢复。

规格输入：

- 维护操作（用户通过 Web/API 显式触发，同步返回）：
  - List：分页 L1 条目列表，只返回当前 scope 下 `ACTIVE` 或显式请求的 `ARCHIVED` 条目
  - Detail：L2 完整结构化内容，非当前 scope 返回 not found（不泄露存在性）
  - Update：ACTIVE 条目部分更新（`tags`、`briefIndex`、`confidence`），通过 `MemoryService.saveLongTermMemory` 执行
  - Forget：不可恢复遗忘，目标进入 `DELETED`，通过 `MemoryService.transitionLongTermMemoryState(targetState=DELETED)` 执行
  - Pin/Unpin：通过 `MemoryService.saveLongTermMemory` partial update 设置 `isPinned`，上限 10 条
  - Restore：`ARCHIVED → ACTIVE`，保持同一 entryId/sourceTrace，通过 `MemoryService.transitionLongTermMemoryState(targetState=ACTIVE)` 执行，confidence +0.1（上限 1.0）
- 所有操作使用 trusted scope（`tenantId` + `subjectId` + `agentId`），请求体不得覆盖
- 写类操作记录维护 audit（operation + entry ref + scope ref + occurredAt），不含 memory content

契约输入：
- 维护 request/response DTO、SafeError projection
- `pinLimit`（默认 10）、`restoreConfidenceBoost`（默认 0.1）

实现约束：
- 维护业务逻辑位于 `agent-memory` 包，通过 `MemoryService` 调用 core
- Web/API 通道只做 transport、schema validation、identity 注入和 DTO projection
- 配置由 `adnclaw.memory.maintenance.*` 命名空间提供（`enabled`、`pinLimit`），其余用默认值

非目标：
- NOT 定义模型驱动的记忆工具
- NOT 定义自动提取或老化策略
- NOT 定义知识共享协作模型
- NOT 定义 Web UI（仅 API）

验收要点：
- Integration：list/detail/update/forget/pin/unpin/restore 正常路径和 scope 隔离
- Security：跨 scope 访问返回 not found 不泄露存在性
- Resilience：memory disabled/storage unavailable 显式 SafeError
- Audit：写类操作产生脱敏审计事件

并行边界：
- 不得修改 agent-core/agent-runtime 的 request lifecycle
- 不得修改模型工具或 capability 通道