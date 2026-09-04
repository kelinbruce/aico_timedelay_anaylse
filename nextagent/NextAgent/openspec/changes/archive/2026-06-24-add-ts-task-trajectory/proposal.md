## 背景与问题（Why）

长期记忆提取如果直接从 message history 生成四类记忆，容易把对话表达、模型临时推理、工具调用片段和真实任务结果混在一起。电信网络运维场景更需要可审计的任务轨迹：任务目标是什么、用户给了哪些约束、系统执行了哪些动作、观察到哪些关键事实、最终结果是什么、哪些步骤可复用。

当前 memory extraction 已经收敛为后台 dreaming 能力，但它仍需要一个更稳定的输入层。`TaskTrajectory` 持久化的目的不是新增另一套长期记忆，也不是替代 session/timeline，而是把已提交请求中的运维任务事实投影成可复用、可审计、owner/agent scoped 的任务轨迹 read model，供 memory extraction、后续复盘、质量分析和流程优化消费。

## 变更范围（What Changes）

- 新增 `task-trajectory` capability，定义 `TaskTrajectoryRecord`、构建时机、输入边界、持久化语义、查询语义、失败降级和架构边界。
- 新增 gateway public contract：`TaskTrajectoryStoreGateway` / `TaskTrajectoryQueryGateway`，由 `agent-contracts/gateway` 暴露，local backend 由 `agent-platform-gateway-local` 实现。
- 规定轨迹只从已 terminal commit 的 request/session/timeline/message/tool facts 构建；不得从未提交运行态、模型临时输出、客户端自报 owner/agent 字段或 raw provider response 构建。
- 规定轨迹构建不进入 request terminal commit 必经路径：terminal commit 成功后只产生轻量 build intent / pending signal 作为快速触发，后台 worker 限流构建；local backend 还必须通过 bounded catch-up 从已提交 terminal facts 补建丢失 intent；失败只产生安全诊断，不改变 RequestRun、SessionMessage、canonical timeline 或 stream projection。
- 规定轨迹摘要只能来自已提交事实的安全投影；业务结果必须使用 evidence-based `taskOutcomeStatus` 和 `outcomeEvidenceLevel` 保守表达，默认 `UNKNOWN`，不得把 terminal commit 成功等同于业务成功。
- 规定轨迹按 `tenantId`、`subjectId`、`agentId`、`sessionId`、`requestRunId` scope 持久化，并支持按时间窗口、session、run、build status、task outcome、evidence level、task kind 查询。
- 规定后续相似轨迹不得回写旧轨迹 outcome；轨迹作为当次请求在当时证据下的历史投影保持稳定，后续证据只在 memory extraction 的 `LongTermMemoryRecord` 层做 sourceTrace 融合和 confidence corroboration。
- 规定 `add-ts-memory-extraction` 后续从 `TaskTrajectory` 读取输入，再提取 `FACTUAL`、`CONCEPTUAL`、`PROCEDURAL` 和 `USER_CHARACTERISTICS` candidate；不再直接从 message history 生成长期记忆。
- 不包含 BREAKING 变更；在没有该 change 的实现前，memory extraction 必须保持 blocked 或使用自身已定义的前置 refinement 规则，不得私查 DB。

## Capability 影响（Capabilities）

### 新增 Capability

- `task-trajectory`: 从已提交请求事实构建、持久化和查询 owner/agent scoped 任务轨迹 read model。

### 修改的 Capability

- `memory-extraction`: 后续自动学习输入为已持久化 `TaskTrajectory`；四类长期记忆生成流程基于轨迹字段和分类矩阵执行。

## 影响范围（Impact）

- `agent-common`：新增 `TaskTrajectoryId` branded type，以及必要的低基数枚举，如 `TaskTrajectoryBuildStatus`、`TaskOutcomeStatus`、`OutcomeEvidenceLevel`、`TaskTrajectoryKind`。
- `agent-contracts/gateway`：新增 `TaskTrajectoryRecord`、查询 DTO、写入 DTO、store/query gateway port，以及用于 catch-up 的最小 build candidate query。
- `agent-runtime`：只负责在 terminal commit 成功后发出可被 app composition 消费的构建触发事实；不得拥有轨迹构建语义。
- `agent-memory`：local backend 下拥有 task trajectory builder orchestration，消费 session/message/timeline/gateway public ports 生成 record；不得读取 gateway-local private path。
- `agent-platform-gateway-local`：新增专用 `task_trajectory` 表和必要索引；不得使用 generic records table。
- `agent-app`：装配 task trajectory builder、store/query gateway 和后台构建触发。
- `add-ts-memory-extraction`：改为消费 `TaskTrajectoryQueryGateway`，并保留自身 candidate validator、融合和写入职责。
- 远端 complete-service backend：轨迹构建和记忆提取可由远端服务拥有；本地不得重复执行同一轨迹构建。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/task-trajectory/spec.md`：新增 task trajectory 构建、持久化、查询、失败降级和边界契约。
- `openspec/specs/memory-extraction/spec.md`：归档时更新为从 `TaskTrajectory` 读取自动学习输入。

长期背景：
- `openspec/overview.md`：补充任务轨迹作为长期记忆学习输入层的定位。

设计视图：
- `openspec/designs/architecture/memory.md`：补充 `TaskTrajectory -> memory extraction -> LongTermMemoryRecord` 流程、owner/agent scope 和数据 ownership。
- `openspec/designs/architecture/runtime.md` 或现有 runtime 架构文档：补充 terminal commit 后只发布轨迹构建触发事实，不拥有构建语义。
- `openspec/designs/modules/agent-memory.md`：补充 task trajectory builder 和 memory extraction 的 local backend 编排职责。
- `openspec/designs/modules/agent-platform-gateway-local.md`：补充 task trajectory 专用持久化表和 gateway-local ownership。
- `openspec/designs/adr/task-trajectory-learning-input.md`：记录采用持久化 task trajectory 作为自动学习输入层的长期决策。
- `openspec/designs/spec-to-design-map.md`：增加 `task-trajectory` 和 `memory-extraction` 到相关设计文档的导航。

验证入口：
- Contract tests：TaskTrajectory DTO/schema、owner/agent scope、query filters、safe redaction。
- Integration tests：terminal commit 后异步构建、不影响 request terminal state、memory extraction 通过 trajectory 查询消费。
- Architecture tests：runtime 不导入 builder、builder 不导入 gateway-local private path、memory tools 不消费 task trajectory。
