## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-8.1 持久化运行数据` | 运行状态持久化聚合从 `workingMemory` 重构为 `stateStore`（不含 `todoStateStore`，后者整体移除）；`blobStore`、`taskTrajectory`、`userInteractionStores` 各为独立顶层接口组；LOCAL 支持同节点多进程共享 StateStore SQLite 文件；新增实现无关 conformance 契约 | `gateway-store-provider-ownership` | `FN-8.1 持久化运行数据` |
| `FN-5.7 管理待办` | TodoWrite 不再通过 gateway store 持久化，改为纯 input-validation + all-completed 清空操作；current todo state 由 checkpoint-backed `flowVariables.todoWriteState` 承载；output 移除 `oldTodos`；幂等由 recovery replay guard 承担 | `todo-write-tool` | `FN-5.7 管理待办` |
| `FN-5.1 管理能力目录` | 移除 `todoState` 受控 Tool dependency，TodoWrite descriptor 移除 `requiredDependencies: ['todoState']` | `builtin-tool-framework` | `FN-5.1 管理能力目录` |
| `FN-10.5 集成外部系统` | adapter kind 按能力组语义重组（`state-store`、`long-term-memory`、`user-interaction-stores`、`blob-store`、`task-trajectory`），`sqlite`/`working-memory` 移除；REMOTE 包全部改为空实现并 fail closed；外部团队复用实现无关 conformance 契约交付 REMOTE | `gateway-configuration` | `FN-10.5 集成外部系统` |

## 存量 Requirement 迁移方案

本 change 未迁移跨 spec 的既有 Requirement；`working-memory`/`sqlite` 能力组重命名在各自 canonical spec 内以 `MODIFIED` 完成，`Working Memory preserves request and session transaction boundaries` 以 `RENAMED` 完成。无来源 stable spec 退役。

## `FN-8.1 持久化运行数据`

### 目标与规范依据

平台集成方需要把运行状态持久化聚合为单一 `stateStore` 契约，并按业务归属暴露持久化 store，同时支持同节点多进程共享同一 SQLite 数据文件，且能用实现无关的 conformance 契约同时验证 LOCAL 与外部 REMOTE 实现。本设计满足 proposal 中该 Function 的黑盒目标。

#### 本 Function 的目标 Requirements

canonical spec：`gateway-store-provider-ownership`

- `MODIFIED`：`Gateway stores have one capability provider owner`
- `MODIFIED`：`Provider bindings are capability-complete and implementation-neutral`
- `MODIFIED`：`Local capability providers use isolated SQLite ownership`
- `ADDED`：`StateStore 支持同节点多进程共享 SQLite 数据文件`
- `ADDED`：`Gateway store conformance 契约与实现无关且可复用`
- `RENAMED`：`Working Memory preserves request and session transaction boundaries` → `StateStore preserves request and session transaction boundaries`

### 当前实现

- `agent-contracts/gateway` 的 `GatewayBindings` 顶层暴露 `workingMemory`、`longTermMemory`、`audit`、`sqliteStores` 等分组；`WorkingMemoryGatewayBindings` 承载 `requestRuns`、`memoryRecallAttempts`、`sessions`、`messages`、`sessionForks`、`attachments`、`activeContext`、`timeline`、`checkpoints`、`pendingInputs`、`conversationAnnotations`、`conversationShares`、`questionRecommendations?`；`LongTermMemoryGatewayBindings` 承载 `store`、`retriever`、`sharing`；`SqliteGatewayStoreBindings` 承载 `attachmentReservations`、`blobs`、`taskTrajectoryStore`、`taskTrajectoryQuery`、`todoStateStore`、`userQuestionActivity`。
- LOCAL provider 用三个 SQLite 文件（working-memory、long-term-memory、sqlite）并通过 `schemaOwner` 隔离 schema；`SqliteGatewayCore` 打开时执行 `PRAGMA busy_timeout = 5000`，未启用 WAL。
- 底层实现中 `blobs` 与 `attachmentReservations` 由同一个 `SqliteAttachmentStore` 实现（`SqliteAttachmentStore implements AttachmentStoreGateway, AttachmentIntakeReservationGateway, BlobStoreGateway`，`sqlite-gateway-stores.ts:127-129`）；但 `blobStore` 大对象 bytes 实际由 `LocalFilesystemBlobStore` 直接读写本地文件（`local-filesystem-blob-store.ts`），SQLite 的 `blobs` 表只存元数据。
- `agent-app` 的 `gateway-composition.ts` 按 adapter kind 解析 provider、合并 binding、校验完整性；`localGatewayStoresFromBindings` 把 `workingMemory` 与 `sqliteStores` 拍平为 `AppGatewayStores`（`WorkingMemoryGatewayBindings & SqliteGatewayStoreBindings & {...}`）供领域模块消费。
- `agent-platform-gateway-remote` 的 `createRemoteGatewayProvider` 通过 `RemoteGatewayReferenceBindings` 注入 reference binding；未注入时返回 `blockedRemoteGatewayBindings`。
- 已有契约测试覆盖 LOCAL provider 的 schema ownership、binding merge 和 provider readiness；暂无实现无关的 conformance 契约，暂无两进程共享 SQLite 验证。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| `stateStore` 聚合承载运行状态 | `GatewayBindings.workingMemory` 以业务"工作内存"命名 | 运行状态 stores 聚合为 `stateStore` binding |
| TodoWrite 状态不需要 gateway 持久化 | `todoStateStore` 在 `sqliteStores` 分组，`replaceTodoState` 写入 revision/current 表，但 `loadCurrentTodoState`/`listTodoStateRevisions` 无产品路径调用者；current state 恢复走 checkpoint `flowVariables.todoWriteState` | 移除 `TodoStateStoreGateway` 及全部 Record/Request 类型，TodoWrite 改为纯 input-validation 操作 |
| 对象存储独立接口组 | `blobs` 在 `sqliteStores` 分组，底层已由本地文件系统承担 | 拆为独立 `blobStore` 顶层 binding，独立 `blob-store` 能力组 |
| 任务轨迹独立接口组 | `taskTrajectoryStore`/`taskTrajectoryQuery` 在 `sqliteStores` 分组 | 拆为独立 `taskTrajectory` 顶层 binding，独立 `task-trajectory` 能力组 |
| 用户会话交互辅助数据归能力组 | `attachmentReservations`、`userQuestionActivity` 在 `sqliteStores` 分组 | 拆为 `attachmentStore`/`userQuestionActivityStore`，归 `user-interaction-stores` 能力组 |
| 同节点多进程共享 StateStore SQLite 文件 | `SqliteGatewayCore` 未启用 WAL，仅 `busy_timeout` | 需要 WAL + 两进程一致性验证 |
| 实现无关 conformance 契约 | 只有 provider 私有测试，无实现无关断言集合 | 需要新增可被 LOCAL 与外部 REMOTE 复用的 conformance 契约 |

### 修改方案

**契约层（`agent-contracts/gateway`）**

- 把 `WorkingMemoryGatewayBindings` 重构为 `StateStoreGatewayBindings`：字段继承既有运行状态 stores；`questionRecommendations` 保持 optional。不并入 `todoStateStore`。
- `GatewayBindings.workingMemory` 更名为 `GatewayBindings.stateStore`。
- 移除 `SqliteGatewayStoreBindings`，改为独立顶层 binding：
  - `blobStore?: BlobStoreGateway`（对象存储接口组）
  - `taskTrajectory?: { readonly store: TaskTrajectoryStoreGateway; readonly query: TaskTrajectoryQueryGateway }`（任务轨迹接口组）
  - `userInteractionStores?: { readonly attachmentStore: AttachmentIntakeReservationGateway; readonly userQuestionActivityStore: UserQuestionActivityStoreGateway }`（用户交互存储接口组）
- `audit` 保持独立顶层 binding。
- 移除 `TodoStateStoreGateway` 接口及其全部关联类型：`TodoStateItemRecord`、`TodoStateCurrentRecord`、`TodoStateRevisionRecord`、`ReplaceTodoStateRequest`、`ReplaceTodoStateResult`、`TodoStateLookupRequest`、`TodoStateRevisionListRequest`。从 `SqliteGatewayStoreBindings` 移除 `todoStateStore` 字段。
- `AppGatewayStores` 内部聚合随之更新为 StateStore 字段 + long-term memory 字段 + blobStore/taskTrajectory/userInteractionStores 字段，不含 todoStateStore。

**配置与组合层（`agent-app`）**

- `GatewayAdapterKind` 的 `working-memory` 更名为 `state-store`、`sqlite` 更名为 `user-interaction-stores`，新增 `blob-store` 与 `task-trajectory`；`REGISTERED_GATEWAY_ADAPTERS` 与默认 selection 中 `gatewayId: 'local-working-memory'` → `local-state-store`、`local-sqlite` → `local-user-interaction-stores`，新增 `local-blob-store` 与 `local-task-trajectory`，`gatewayKind` 同步更新。
- `gateway-composition.ts` 的 binding 完整性校验：`state-store` 检查 `stateStore`、`long-term-memory` 检查 `longTermMemory`、`user-interaction-stores` 检查 `userInteractionStores.attachmentStore` 与 `userInteractionStores.userQuestionActivityStore`、`blob-store` 检查 `blobStore`、`task-trajectory` 检查 `taskTrajectory`；`mergeGatewayBindings` 与 `bindingAdapterKinds` 同步更新。
- `composition-contracts.ts` 的 `AppGatewayStores` 与 `localGatewayStoresFromBindings` 按新字段映射。
- 移除 `createGatewayTodoState` 调用与 `todoState` 注入面；`capability-composition.ts` 不再向 `toolDependencies` 传入 `todoState`。TodoWrite 重构细节见 `FN-5.7 管理待办` 设计章节。

**LOCAL provider（`agent-platform-gateway-local`）**

- provider factories 按新 binding 形态产出 `stateStore`、`longTermMemory`、`blobStore`、`taskTrajectory`、`userInteractionStores`，不含 `todoStateStore`。
- 三个 SQLite 文件物理隔离保持不变（StateStore、Long-term Memory、user-interaction-stores）；`blobStore` 大对象继续走本地文件系统，`task_trajectory` 表继续归属 residual SQLite 文件。
- 移除 `SqliteTodoStateStore`、`todo_state_revisions` 表、`todo_states_current` 表及相关 schema、row mapping、cascade delete 和方法。
- StateStore 文件打开时执行 `PRAGMA journal_mode = WAL`（其余 provider 文件同样启用，保证共享一致性），保留 `busy_timeout`。物理文件路径与文件名不变（见"风险与取舍"）。

**conformance 契约（可复用测试资产）**

- 新增实现无关的 StateStore conformance 套件：输入为 StateStore 与业务归属 store bindings 或 provider binding，断言覆盖 session/message/timeline/checkpoint/pending input 的写入-读取一致性、幂等与 version conflict、terminal commit 复合事务、业务归属 store 行为。断言只依赖 `agent-contracts/gateway` 公共端口，不引用 SQLite 文件、连接或 provider-private DTO。断言不覆盖 todo state（已移除 gateway 持久化）。
- 该套件放在 `agent-test-kit`（或等价可发布测试资产）中导出，LOCAL provider 测试与外部 REMOTE 项目复用同一组断言。外部团队通过 npm 依赖 `agent-contracts` 与测试资产运行 conformance。

**两进程验证**

- 在 LOCAL provider 测试中新增两个 `SqliteGatewayCore`/provider 实例共享同一数据文件的用例：进程 A 写入、进程 B 读取一致；两进程并发写入不同 Session 事实均持久化。该用例作为 `StateStore 支持同节点多进程共享 SQLite 数据文件` 的黑盒验证。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | `StateStore 支持同节点多进程共享 SQLite 数据文件` | WAL + busy timeout；两进程共享文件写入/读取一致性 | 两进程共享 StateStore 文件的 contract 用例覆盖已提交事实一致与并发写入不丢失 |
| 可测试性 | `Gateway store conformance 契约与实现无关且可复用` | 实现无关 conformance 套件只依赖公共端口 | LOCAL 与外部 REMOTE 复用同一组断言，断言不引用 provider 私有实现 |

#### 备选方案（Alternatives Considered）

- **仅对 `sqliteStores` 中性重命名而不重组**：改动最小但组内仍混含多个业务域，无法满足"按能力组语义暴露"目标，未选择。
- **把 `blobStore` 移入 `stateStore`**：blob 大对象被附件、artifact、大 capability result、model summary 共用（跨多个业务域），且底层由文件系统/S3 挂载承担、SQLite 只存元数据；它不属于"运行状态"生命周期，独立为 `blobStore` 顶层 binding 更准确，未移入。
- **把 `taskTrajectory` 合入 `longTermMemory`**：任务轨迹虽与记忆抽取相关，但消费方还包括 runtime terminal listener 与后台 worker，生命周期独立于长期记忆；独立为 `taskTrajectory` 顶层 binding 更符合职责单一，未合入。
- **`attachmentStore` 独立成组**：附件摄入与用户问题活动都是用户会话交互产生的辅助数据，共享生命周期与消费面，合并为 `user-interaction-stores` 一个能力组，避免为单一接口开独立能力组；未拆开。
- **把 `todoStateStore` 迁入 `stateStore` 而不移除**：todo 状态是 session/request 工作状态，随 run 生命周期推进，与运行状态同属一个生命周期 owner，迁入 `stateStore` 在归属上更一致。但代码审查发现 `loadCurrentTodoState`/`listTodoStateRevisions` 无产品路径调用者，current state 恢复实际由 checkpoint `flowVariables.todoWriteState` 承担，`replaceTodoState` 的持久化数据（revision 表 + current 表）没有产品路径读取者。迁入一个没有消费者的 store 只增加契约面和 conformance 维护负担，不产生业务价值。因此选择整体移除 `TodoStateStoreGateway`，TodoWrite 改为纯 input-validation 操作，current state 由 `agent-core` `applyRequestLocalResultEffects` 写入 checkpoint-backed `flowVariables.todoWriteState` 承载，未选择迁入方案。
- **保留 `oldTodos` 在 TodoWrite output**：`oldTodos` 当前来自 gateway `loadCurrentTodoStateSync`，移除 gateway store 后 tool 层无法访问 `flowVariables`。可在 `agent-core` `applyRequestLocalResultEffects` 注入 `oldTodos`，但 generated message 在 result 返回时已创建，注入不影响已序列化的 `CAPABILITY_RESULT` 消息。`oldTodos` 无产品路径消费者（模型在同一 session 中已知历史提交，observability 由 runtime/gateway owner 派生），移除不影响业务正确性，未选择保留。

## `FN-5.7 管理待办`

### 目标与规范依据

TodoWrite 当前通过 `TodoStateStoreGateway` 持久化 todo state（revision history + current projection），但 `loadCurrentTodoState`/`listTodoStateRevisions` 无产品路径调用者，current state 恢复实际由 checkpoint `flowVariables.todoWriteState` 承担。本设计移除 gateway store 依赖，TodoWrite 改为纯 input-validation 操作。

#### 本 Function 的目标 Requirements

canonical spec：`todo-write-tool`

- `MODIFIED`：`TodoWrite replaces the current list atomically`
- `MODIFIED`：`TodoWrite returns safe structured results`
- `MODIFIED`：`TodoWrite observability is low-cardinality and non-sensitive`

### 当前实现

- TodoWrite tool 通过 `requiredDependencies: ['todoState']` 声明依赖 `RuntimeTodoStatePort`。
- `createGatewayTodoState`（`agent-runtime`）创建 `RuntimeTodoStatePort`，调用 `TodoStateStoreGateway.replaceTodoState` 持久化 revision/current state。
- `replaceTodoState` 从持久化 current state 读取 `oldTodos`，写入 revision/current 表，返回 `{oldTodos, newTodos, revision, current}`。
- `agent-core` `applyRequestLocalResultEffects` 从 `result.structuredPayload.newTodos` 读取 todos，写入 `flowVariables.todoWriteState`。
- current state 恢复由 checkpoint `flowVariables.todoWriteState` 承担（`default-agent.ts` 的 terminal guard 和 context projection 读取 `flowVariables.todoWriteState`）。
- `loadCurrentTodoState`/`listTodoStateRevisions` 只在测试中被调用，无产品路径消费者。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| TodoWrite 不依赖 gateway store | `replaceTodoState` 写入 revision/current 表，但持久化数据无产品路径读取者 | 移除 gateway store，TodoWrite 改为纯 input-validation |
| oldTodos 不需要从 gateway 读取 | `oldTodos` 来自 `loadCurrentTodoStateSync`，但无产品路径消费者需要 oldTodos | 移除 oldTodos，output 只返回 newTodos |
| 幂等不依赖 gateway invocation-key | `replaceTodoState` 用 `loadTodoRevisionByInvocation` 做 invocation-key dedup | 幂等由 recovery replay guard（REUSE_RESULT / 纯函数 REPLAY_ALLOWED）承担 |

### 修改方案

- 移除 `agent-runtime` 的 `createGatewayTodoState`、`RuntimeTodoStatePort`、`gateway-todo-state.ts`。
- `agent-capability` 的 `ToolDependencyName`/`ToolDependencies` 移除 `todoState`；TodoWrite descriptor 移除 `requiredDependencies: ['todoState']`。
- TodoWrite tool `execute` 改为纯 input-validation + all-completed 清空：读取 `args.todos`，若所有 item `status` 均为 `completed` 则清空为空列表，返回 `{ newTodos }`。不再调用 `options.deps.todoState.replaceTodos`，不再返回 `oldTodos`。
- Output schema 移除 `oldTodos`，只 required `newTodos`。
- `agent-core` `applyRequestLocalResultEffects` 保持现有行为（从 `structuredPayload.newTodos` 读取，写入 `flowVariables.todoWriteState`）。
- 幂等由 recovery replay guard 承担：`REUSE_RESULT` 在 `CAPABILITY_RESULT` 消息已存在时不重执行；`REPLAY_ALLOWED` 在 `CAPABILITY_BEFORE_CALL` checkpoint 重执行纯函数调用，无 gateway 副作用需要 dedup。`replayPolicy: 'IDEMPOTENT'` 保留。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | `TodoWrite replaces the current list atomically` | current state 由 checkpoint `flowVariables.todoWriteState` 承载 | checkpoint 恢复后 current todo projection 可见；recovery replay 不产生额外副作用 |

#### 备选方案（Alternatives Considered）

- 见 `FN-8.1` 备选方案中 "把 `todoStateStore` 迁入 `stateStore` 而不移除" 和 "保留 `oldTodos`" 的讨论。

## `FN-5.1 管理能力目录`

### 目标与规范依据

移除 `todoState` 受控 Tool dependency，TodoWrite 不再声明 required dependency。

#### 本 Function 的目标 Requirements

canonical spec：`builtin-tool-framework`

- `MODIFIED`：`Tool dependencies are optional and controlled`

### 修改方案

- `ToolDependencyName`/`ToolDependencies` 移除 `todoState`。
- TodoWrite descriptor 移除 `requiredDependencies: ['todoState']`。
- `builtin-tool-framework` spec 的 supported dependency names 移除 `todoState`，移除 "TodoWrite uses scoped todo state dependency" scenario。

## `FN-10.5 集成外部系统`

### 目标与规范依据

平台集成方通过 gateway 配置选择运行状态持久化 provider；REMOTE 由外部团队基于 `agent-contracts` 在独立项目交付，本仓保留空实现并 fail closed，同时提供实现无关 conformance 契约。本设计满足 proposal 中该 Function 的黑盒目标。

#### 本 Function 的目标 Requirements

canonical spec：`gateway-configuration`

- `MODIFIED`：`Gateway configuration is loaded and stabilized during startup`
- `MODIFIED`：`Validation follows deterministic rule order`
- `MODIFIED`：`Gateway registry resolves selected providers per gateway entry`
- `ADDED`：`REMOTE 空实现未注入真实实现时安全失败`
- `ADDED`：`外部团队复用实现无关 conformance 契约交付 REMOTE provider`

### 当前实现

- `GatewayAdapterKind` 包含 `working-memory`、`long-term-memory`、`sqlite`、`sandbox`、`scheduled-maintenance`、`cron-tasks`、`rag-knowledge`、`skillhub`、`workflow-execution`、`guardrail`、`watermark`。adapterKind 语义为"能力组"：provider 声明自己实现一个或多个能力组，app composition 按能力组校验绑定完整性；当前 LOCAL 与 REMOTE provider 都实现全部能力组，不存在按能力挑选 provider 的真实场景。
- `agent-app/src/config/validation.ts` 维护 `REGISTERED_GATEWAY_ADAPTERS` 与默认 gateway selection（含 `local-working-memory`/`working-memory`、`local-sqlite`/`sqlite` 等）。
- `agent-platform-gateway-remote` 现有 `createRemoteGatewayProvider`、`RemoteGatewayReferenceBindings`、`reference-remote-*` 实现（sandbox、model、cron、rag、scheduled、skillhub、workflow、api-call、guardrail、watermark、question-recommendation、audit-sink）；未注入 reference binding 时返回 `blockedRemoteGatewayBindings`。
- `gateway-composition.ts` 按 `deploymentMode + adapterKind` 解析唯一 provider，合并 binding，ready 前校验完整性。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 配置选择键与能力组契约对齐 | adapter kind 含实现命名的 `sqlite` 与 `working-memory` | 更名 `state-store`、`user-interaction-stores`，新增 `blob-store`、`task-trajectory`，`sqlite` 移除；同步 schema、默认 selection、REGISTERED 集合与 provider supported kinds |
| binding 完整性按能力组校验 | `sqlite` 映射到 `sqliteStores` 聚合字段 | 改为按 `stateStore`、`longTermMemory`、`userInteractionStores`、`blobStore`、`taskTrajectory` 五个能力组校验 |
| REMOTE 空实现 fail closed | 现有 `reference-remote-*` 为可用产品实现，仅未注入时 blocked | 全部改为空实现（方法返回 `NOT_IMPLEMENTED` 安全错误），保留 SPI 与 conformance 入口 |
| 外部团队复用 conformance 契约 | 本仓无实现无关 conformance 断言集合 | 提供可复用 conformance 契约并保证 LOCAL/REMOTE 同一判定标准 |

### 修改方案

**配置层（`agent-app`）**

- `GatewayAdapterKind` 用 `state-store` 替代 `working-memory`、`user-interaction-stores` 替代 `sqlite`，新增 `blob-store` 与 `task-trajectory`；`REGISTERED_GATEWAY_ADAPTERS`、默认 selection（`local-state-store`、`local-user-interaction-stores`、`local-blob-store`、`local-task-trajectory`）、测试 composition 与 gateway selection 校验同步更新。
- `validation.ts` 的稳定选择集合与 `gateway-composition.ts` 的 `missingGatewayBinding`/`bindingAdapterKinds` 按五个能力组更新：`state-store` 检查 `stateStore`、`long-term-memory` 检查 `longTermMemory`、`user-interaction-stores` 检查 `userInteractionStores.attachmentStore` 与 `userInteractionStores.userQuestionActivityStore`、`blob-store` 检查 `blobStore`、`task-trajectory` 检查 `taskTrajectory`。

**Remote 包空实现化（`agent-platform-gateway-remote`）**

- 保留 `createRemoteGatewayProvider`、provider SPI、`RemoteGatewayReferenceBindings` shape（按新能力组字段更新：`stateStore`、`longTermMemory`、`userInteractionStores`、`blobStore`、`taskTrajectory`、`audit` 等）、`blockedRemoteGatewayBindings` 与缺失 binding 校验。
- `reference-remote-*`、skillhub、workflow-remote、guardrail、watermark、api-call、audit-sink 等全部真实实现改为空实现：方法体返回 code 为 `NOT_IMPLEMENTED` 的确定性安全错误，不抛出 provider 内部异常，不暴露端点/credential/连接池/provider-native 错误。
- `remoteGatewayReferenceAdapterKinds` 更新为 `state-store`、`long-term-memory`、`user-interaction-stores`、`blob-store`、`task-trajectory`（替代 `working-memory`、`sqlite`）。
- 空实现必须在 `agent-app` REMOTE 组合路径中保持 fail-closed 语义：未注入真实 binding 时 startup/ready 前失败，不回退 LOCAL。

**conformance 契约（共享）**

- `FN-8.1` 设计的实现无关 conformance 套件作为本 Function 的外部交付前提：外部团队通过 npm 依赖 `agent-contracts`（和可发布测试资产）在独立项目中运行同一组断言验证其 REMOTE 实现；本仓 LOCAL 验证不依赖外部 REMOTE 实现。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `REMOTE 空实现未注入真实实现时安全失败` | 空实现方法返回 `NOT_IMPLEMENTED` 安全错误；未注入时 startup fail closed | 未注入实现启动失败且不回退 LOCAL；方法调用错误不泄漏 provider 内部细节 |
| 可测试性 | `外部团队复用实现无关 conformance 契约交付 REMOTE provider` | 实现无关 conformance 套件可复用，LOCAL/REMOTE 同一判定标准 | 外部 REMOTE fixture 与 LOCAL 共用同一组断言 |

#### 备选方案（Alternatives Considered）

- **REMOTE 空实现仅在状态 store 范围内**：用户已确认整个 remote 包全部空实现，以保证对外部团队契约变更的可发现性；未选择收窄范围。
- **空实现返回 BLOCKED readiness 而非 `NOT_IMPLEMENTED` 方法错误**：BLOCKED readiness 只覆盖启动期，无法表达运行期方法调用语义；空实现同时保留未注入 blocked 启动失败与方法级 `NOT_IMPLEMENTED`，未选择单一 BLOCKED 方案。
- **`blobStore`/`taskTrajectory` 复用 `user-interaction-stores` 能力组**：三个能力组共享 `sqlite` 实现与生命周期；但 blob 是跨业务域的对象存储基础设施、任务轨迹生命周期独立，合并会掩盖各自能力组语义，最终拆为独立 `blob-store`/`task-trajectory` 能力组。adapterKind 体系本身（provider 声明多个能力组、按能力组选择）是否简化另行排期。

## 跨 Function 协作与端到端流程

`agent-app` 的 gateway composition 是两 Function 的共享集成点：它按 `FN-10.5` 冻结的 selection 解析 provider、合并 binding，并把 `FN-8.1` 定义的 `stateStore`、`longTermMemory`、`blobStore`、`taskTrajectory` 与 `userInteractionStores` 能力组注入领域模块。REMOTE 空实现化后的 provider 仍通过同一 composition 边界 fail closed，conformance 契约同时服务 LOCAL provider 验证（`FN-8.1`）与外部 REMOTE 交付验收（`FN-10.5`）。细节分别见 `FN-8.1 持久化运行数据` 与 `FN-10.5 集成外部系统` 的修改方案。

## 验证策略（Verification Strategy）

- `FN-8.1` 的 StateStore 聚合、blob/taskTrajectory/userInteractionStores 独立接口组与两进程共享行为由 gateway contract tests 与两进程共享 SQLite 用例覆盖；conformance 契约由实现无关 conformance 套件覆盖，LOCAL 与外部 REMOTE fixture 复用。
- `FN-10.5` 的配置选择键更名、五能力组 binding 完整性校验由 config validation 与 gateway composition tests 覆盖；REMOTE 空实现 fail-closed 与 `NOT_IMPLEMENTED` 方法语义由 remote provider contract tests 覆盖。
- 禁止项（未注入 REMOTE 回退 LOCAL、空实现泄漏 provider 内部细节、同一 store 多 provider 共享、SQLite 共享文件部分可见写入）必须被测试实际触发并断言失败。
- 架构测试确认 `agent-contracts/gateway` 不再暴露 `workingMemory`/`sqliteStores` 实现命名分组，`agent-app` 不直接依赖 provider 私有实现。
- 精确 Requirement/Scenario 来源、测试文件与命令由 tasks 承载。

## 长期基线刷新计划（Baseline Promotion Plan）

- openspec/specs/gateway-store-provider-ownership/spec.md：修改（StateStore 聚合、blob/taskTrajectory/userInteractionStores 独立接口组、两进程共享、conformance；移除 todoStateStore）。
- openspec/specs/todo-write-tool/spec.md：修改（移除 gateway 持久化、revision history、stateless 实例共享改为 checkpoint 恢复、output 移除 oldTodos、idempotency 改为 recovery replay 语义）。
- openspec/specs/builtin-tool-framework/spec.md：修改（移除 `todoState` dependency 条目）。
- openspec/specs/gateway-configuration/spec.md：修改（五能力组选择键、REMOTE 空实现 fail-closed、外部 conformance）。
- openspec/designs/functions/D8-数据与记忆/D8.1-持久化/FN-8.1-持久化运行数据.md：修改（描述、输入、处理过程、规格与接口刷新）。
- openspec/designs/functions/D10-二次开发与平台集成/D10.2-集成与定制/FN-10.5-集成外部系统.md：修改（能力组选择键、REMOTE 交付边界）。
- openspec/designs/features/D8-数据与记忆/D8.1-持久化/F-8.1-本地持久化.md：修改（能力组分组、两进程共享）。
- openspec/designs/features/D10-二次开发与平台集成/D10.2-集成与定制/F-10.5-集成外部系统.md：修改（REMOTE 外部交付）。
- openspec/designs/architecture/core-contracts.md：修改（GatewayBindings 顶层分类与 StateStore 聚合不变量）。
- openspec/designs/architecture/configuration-boundary.md：修改（能力组默认 selection 与 binding 完整性）。
- openspec/designs/architecture/observability-boundaries.md：修改（audit 顶层 binding 归属保持）。
- openspec/designs/modules/agent-contracts.md：修改（GatewayBindings 新 shape）。
- openspec/designs/modules/agent-app.md：修改（provider selection、binding merge、注入面）。
- openspec/designs/modules/agent-platform-gateway-local.md：修改（StateStore 文件 WAL、provider 产出）。
- openspec/designs/modules/agent-platform-gateway-remote.md：修改（REMOTE 空实现化、外部团队交付边界、conformance 复用）。
- openspec/overview.md：修改（多实例共享运行状态持久化与 REMOTE 外部交付背景）。
- openspec/designs/adr/：无（取舍由 architecture 文档承载；adapterKind 体系简化另行排期）。
- openspec/designs/spec-to-design-map.md：修改（StateStore/conformance 到 core-contracts、configuration-boundary、gateway-local/remote 的导航）。

## 风险与取舍（Risks / Trade-offs）

- **物理文件名与内部路径字段保持 `working-memory`/`sqlite`**：`GatewayProviderRuntimePaths.workingMemorySqliteFile` 与 `working-memory.sqlite`、`nextagent.sqlite` 文件名本次不改，避免改动导致既有 LOCAL workspace 数据孤立（本 change 非目标包含"不迁移已持久化数据"）。契约层与配置层已对齐为能力组语义；内部路径与物理文件名的对齐留待后续 adapterKind 体系简化 change，需显式迁移或接受重新初始化。
- **`blobStore` 与 `attachmentStore` 共享底层实现**：LOCAL 下 `blobStore` 与 `attachmentStore` 都由 `SqliteAttachmentStore`（并 `LocalFilesystemBlobStore`）实现，契约面拆为独立接口组后，底层仍是同一实例；对外部 REMOTE 团队则是独立实现边界，不影响契约一致性。
- **REMOTE 空实现化导致 REMOTE 部署在外部团队交付前不可用**：这是有意的 fail-closed 边界，外部团队通过 npm 依赖 `agent-contracts` 与 conformance 契约在独立项目交付；本仓 LOCAL 产品路径不受影响。
- **adapterKind 体系本身未简化**：用户已确认体系简化另行排期，本 change 只对齐命名与能力组语义（`working-memory` → `state-store`、`sqlite` → `user-interaction-stores`、新增 `blob-store`/`task-trajectory`），不重构 provider supported kinds / selection 机制。
- **conformance 资产的可发布性**：`agent-test-kit` 当前 `private: true`，外部团队要复用 conformance 契约需要可发布测试资产；设计以"`agent-test-kit` 或等价可发布测试资产"承载，实现时需把 conformance 套件放入可发布位置或把 `agent-test-kit` 转为可发布，并在 tasks 中明确该交付物。
- **WAL 依赖共享文件系统**：LOCAL 同节点共享文件系统可满足；跨节点（REMOTE）共享 SQLite 不在本 change 承诺范围，REMOTE 由外部团队交付。

## 待确认问题（Open Questions）

无。
