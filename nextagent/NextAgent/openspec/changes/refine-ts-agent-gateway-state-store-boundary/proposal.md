## Why

平台集成方把 NextAgent 接入电信生产环境时，需要把多实例共享的 agent 运行状态持久化到同一个权威事实源。当前 Agent Gateway 的公共契约无法支撑这一点：

- 运行状态持久化以 `workingMemory` 命名，无法表达它承载的是请求、会话、消息、时间线、检查点和待输入等运行状态事实；契约语义与实际职责错位。
- 剩余的本地持久化 store 以 `sqliteStores` 命名，把 SQLite 实现写进了公共契约。实现细节与业务归属混在一起后，平台集成方无法判断每个 store 的职责边界，本仓也无法独立演进存储实现。
- REMOTE 持久化实现当前与 LOCAL 混在同一个仓库，外部团队无法独立交付和生产演进；本仓也没有一组与实现无关的契约断言，可以同时验证 LOCAL 与外部 REMOTE 实现的同一组行为。

多实例 HA 合入版本后，运行状态持久化会成为所有实例共享事实的唯一载体。必须在公共契约层先收敛"运行状态存储"的聚合边界和业务归属，再把 REMOTE 实现从本仓移出，否则后续的多实例一致性、故障接管和会话亲和重连都缺少可依赖的持久化契约基础。

## 术语

- **adapterKind（能力组）**：gateway 配置中选择 provider 的稳定逻辑名，表示"一组能力背后的一组公共契约接口"。provider 声明自己实现一个或多个能力组，app composition 按能力组校验绑定完整性。它不是技术实现名，也不是单一 store 名。
- **StateStore（运行状态存储）**：Agent Gateway 承载 agent 运行状态持久化的完整 binding 聚合，覆盖请求、会话、消息、会话 fork、附件 metadata、active context、时间线、检查点、待输入、会话标注、会话分享和问题推荐。它是后续多实例一致性与故障恢复依赖的权威持久化事实源。TodoWrite 进度状态不再纳入 StateStore，改为由 checkpoint-backed `flowVariables.todoWriteState` 承载。
- **user-interaction-stores（用户交互存储接口组）**：承载用户会话交互产生的辅助持久化接口，包括 `attachmentStore`（附件摄入预留）与 `userQuestionActivityStore`（用户问题活动）。
- **实现无关的 StateStore conformance 契约**：本仓维护、不依赖具体存储实现的持久化行为断言集合，LOCAL 与外部 REMOTE provider 必须通过同一组断言，用于验证 provider 契约一致性。

## 规范上下文

- 多实例 HA 本周合入版本，本 change 是 `refine-ts-agent-gateway-state-store-boundary`，为后续 `add-ts-runtime-multi-instance-consistency`、`add-ts-session-affinity-reconnect-replay`、`add-ts-runtime-failure-takeover` 提供持久化契约基础。
- adapterKind 体系（provider 声明多个能力组、按能力组选择）当前保留；体系本身基于"provider 完整实现 contracts、不支持按能力拼装"的简化另行排期，本 change 只对齐命名与语义。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 平台集成方通过 Agent Gateway 的 `stateStore` 完整 binding 获得 agent 运行状态持久化，不感知本地 SQLite 或远端服务的实现差异。
- 公共契约按能力组语义暴露持久化接口：运行状态归 `state-store`，长期记忆归 `long-term-memory`，用户会话交互辅助数据归 `user-interaction-stores`，对象存储归 `blob-store`，任务轨迹归 `task-trajectory`，审计保持顶层。
- 外部团队通过 npm 依赖 `agent-contracts` 获得权威契约，并使用本仓提供的实现无关 conformance 契约在 LOCAL 与 REMOTE 实现上复用同一组断言，从而发现契约变更并交付 REMOTE 实现。
- 使用同一 LOCAL 配置启动的两个进程共享同一 SQLite 数据文件时，两者能查询到一致的 session、message、timeline、checkpoint 及其他已纳入 StateStore 的持久化事实。
- REMOTE provider 未注入真实实现时，启用对应 capability 的部署在 startup/ready 前确定性失败，并提供安全诊断，不静默回退到 LOCAL 或内存实现。

**非目标：**

- 不实现 runtime 多实例语义：执行权 claim/renew/release、fencing、控制意图、取消/抢占/重试跨实例协调、故障接管、会话亲和重连或负载均衡。
- 不改变 request lifecycle owner、same-session lane、scheduler、checkpoint、terminal commit、canonical timeline 或 runtime 恢复语义。
- 不实现 REMOTE Agent Gateway 的产品实现或远端持久化服务；本仓只保留 SPI、实现无关 conformance 契约和空实现。
- 不改变任一 store 的业务语义、port 操作、Record 字段或事务边界；本 change 只改变归属、命名和 provider 边界。
- 不迁移已持久化数据，不提供旧单库兼容层或双写；LOCAL 三库物理隔离维持不变。
- 不重构 adapterKind 体系本身（provider 声明多个能力组、按能力组选择机制保持现状）；该体系简化另行排期。
- 不把 REMOTE 实现清空导致的已有远端能力缺口伪装为可用行为；未注入实现时必须 fail closed。

## What Changes

- **BREAKING**：`GatewayBindings.workingMemory` 更名为 `GatewayBindings.stateStore`，承载运行状态 store 组（requestRuns、memoryRecallAttempts、sessions、messages、sessionForks、attachments、activeContext、timeline、checkpoints、pendingInputs、conversationAnnotations、conversationShares、questionRecommendations）；`longTermMemory` 保持独立顶层 binding。
- **BREAKING**：移除 `SqliteGatewayStoreBindings` 实现命名分组，重组为独立顶层 binding：`blobs` → `blobStore`（对象存储接口组）、`taskTrajectoryStore`/`taskTrajectoryQuery` → `taskTrajectory`（任务轨迹接口组）、`attachmentReservations` → `attachmentStore` 与 `userQuestionActivity` → `userQuestionActivityStore` 合入 `userInteractionStores`（用户交互存储接口组）；`audit` 保持独立顶层 binding。
- **BREAKING**：移除 `TodoStateStoreGateway` 及其全部 Record/Request 类型（`TodoStateItemRecord`、`TodoStateCurrentRecord`、`TodoStateRevisionRecord`、`ReplaceTodoStateRequest`、`ReplaceTodoStateResult`、`TodoStateLookupRequest`、`TodoStateRevisionListRequest`）；移除 `RuntimeTodoStatePort`、`createGatewayTodoState` 和 `todoState` Tool dependency。TodoWrite tool 不再通过 gateway store 持久化，改为纯 input-validation + all-completed 清空操作，current todo state 由 `agent-core` `applyRequestLocalResultEffects` 写入 checkpoint-backed `flowVariables.todoWriteState` 承载，进程重启/stateless 实例恢复由 checkpoint 恢复承担。TodoWrite output 移除 `oldTodos`，只返回 `newTodos`。
- **BREAKING**：gateway 配置的 adapter kind 按能力组重组：`working-memory` 更名为 `state-store`、`sqlite` 更名为 `user-interaction-stores`，新增 `blob-store` 与 `task-trajectory`；默认 gatewayId 分别为 `local-state-store`、`local-user-interaction-stores`、`local-blob-store`、`local-task-trajectory`；`sqlite` 作为 adapter kind 移除；配置 schema、默认 selection 与 provider supported kinds 同步更新。
- 修改：app composition 按能力组检查 binding 完整性（`state-store` 检查 `stateStore`、`long-term-memory` 检查 `longTermMemory`、`user-interaction-stores` 检查 `userInteractionStores`、`blob-store` 检查 `blobStore`、`task-trajectory` 检查 `taskTrajectory`），不再以 `sqliteStores` 聚合字段校验。
- 新增：实现无关的 StateStore conformance 契约测试，作为本仓 LOCAL provider 与外部 REMOTE provider 共同的持久化行为断言；外部团队可复用该组断言验证其 REMOTE 实现。
- 修改：`agent-platform-gateway-remote` 的全部 REMOTE adapter 改为空实现——保留 provider SPI、契约类型和 conformance 入口，store/capability 方法在未注入真实实现时返回确定性安全错误（`NOT_IMPLEMENTED`）；不再提供 REMOTE 产品实现。
- 修改：LOCAL SQLite 打开启用 WAL 模式并维持 busy timeout，使同一节点两个进程可安全共享同一 SQLite 数据文件；本 change 新增两进程一致性验证。
- 修改：app composition 的 store 注入与合并面按新能力组重组，领域模块继续通过既有 public gateway ports 消费，行为不变。

## Feature 影响（Features）

### 修改的 Feature

- `F-8.1 本地持久化`：持久化 store 按能力组分组，`stateStore` 成为运行状态持久化的权威聚合，`longTermMemory`、`blobStore`、`taskTrajectory`、`userInteractionStores` 各为独立接口组；同一 LOCAL 配置支持两个进程共享同一 SQLite 数据文件。
- `F-10.5 集成外部系统`：REMOTE Agent Gateway 由外部团队基于 `agent-contracts` 交付，本仓保留空实现与实现无关 conformance 契约；未注入实现时启用即 fail closed。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

- 无。

### 修改的 Function

- `FN-8.1 持久化运行数据` → `specs/gateway-store-provider-ownership/spec.md`
  - 功能边界：运行状态持久化聚合由 `workingMemory` 重构为 `stateStore`（不含 `todoStateStore`，后者整体移除）；`blobStore`、`taskTrajectory`、`userInteractionStores` 各为独立顶层接口组；LOCAL 支持同节点两进程共享同一 SQLite 文件；新增实现无关 conformance 契约。移除 `TodoStateStoreGateway` 及其全部 Record/Request 类型。
  - 系统质量属性：可靠性/恢复、可测试性。
  - 映射说明：canonical spec 为 `gateway-store-provider-ownership`；本 change 实际触及该 spec，不新增 spec 映射。

- `FN-5.7 管理待办` → `specs/todo-write-tool/spec.md`
  - 功能边界：TodoWrite 不再通过 gateway store 持久化，改为纯 input-validation + all-completed 清空操作；current todo state 由 checkpoint-backed `flowVariables.todoWriteState` 承载；output 移除 `oldTodos`；幂等由 recovery replay guard 承担。
  - 系统质量属性：可靠性/恢复。
  - 映射说明：canonical spec 为 `todo-write-tool`；本 change 实际触及该 spec，不新增 spec 映射。

- `FN-5.1 管理能力目录` → `specs/builtin-tool-framework/spec.md`
  - 功能边界：移除 `todoState` 受控 Tool dependency，TodoWrite descriptor 移除 `requiredDependencies: ['todoState']`。
  - 映射说明：canonical spec 为 `builtin-tool-framework`；本 change 实际触及该 spec，不新增 spec 映射。

- `FN-10.5 集成外部系统` → `specs/gateway-configuration/spec.md`
  - 功能边界：adapter kind 按能力组语义重组（`state-store`、`long-term-memory`、`user-interaction-stores`、`blob-store`、`task-trajectory`），binding 完整性按能力组校验；REMOTE 包全部改为空实现，未注入真实实现时 startup/ready fail closed；外部团队复用实现无关 conformance 契约交付 REMOTE。
  - 系统质量属性：安全、可靠性/恢复、可测试性。
  - 映射说明：canonical spec 为 `gateway-configuration`；本 change 实际触及该 spec，不新增 spec 映射。

## 影响范围（Impact）

- 公共契约：`packages/agent-contracts/gateway` 的 `GatewayBindings` 顶层 binding 形态、`StateStoreGatewayBindings` 定义、`blobStore`/`taskTrajectory`/`userInteractionStores` 能力组 shape、adapter kind 集合与 binding 完整性映射；移除 `TodoStateStoreGateway` 及其全部 Record/Request 类型。
- Capability 契约：`packages/agent-capability` 的 `ToolDependencyName`/`ToolDependencies` 移除 `todoState`；TodoWrite tool descriptor 移除 `requiredDependencies: ['todoState']`，output schema 移除 `oldTodos`；`builtin-tool-framework` spec 的 `todoState` dependency 条目移除。
- Composition：`packages/agent-app` 的 gateway composition、store 注入聚合、测试 composition、provider selection 校验与 binding merge/readiness 验证；移除 `createGatewayTodoState` 注入。
- Runtime：`packages/agent-runtime` 移除 `createGatewayTodoState`、`RuntimeTodoStatePort` 和 `gateway-todo-state.ts`。
- Core：`packages/agent-core` 的 `applyRequestLocalResultEffects` 保持从 `structuredPayload.newTodos` 读取并写入 `flowVariables.todoWriteState` 的现有行为，不依赖 gateway store。
- 本地 gateway：`packages/agent-platform-gateway-local` 的 provider factories、SQLite WAL 打开配置、schema owner 分组与公开 exports；移除 `SqliteTodoStateStore`、`todo_state_revisions`/`todo_states_current` 表及相关方法。
- Remote gateway：`packages/agent-platform-gateway-remote` 全部 adapter 空实现化，保留 provider SPI、契约类型、conformance 入口和 fail-closed 行为。
- 领域消费者：`agent-session`、`agent-runtime`、`agent-attachment-runtime`、`agent-memory` 等通过 `AppGatewayStores` 或 public gateway ports 消费的注入面按新分组调整；port 行为不变。
- 测试：contract tests、architecture tests、StateStore conformance tests、两进程共享 SQLite 验证、REMOTE 空实现 fail-closed 验证；删除 `todo-state-port.test.ts`、`todo-state-gateway-contract.test.ts`，重构 `todo-write-tool.test.ts`、`todo-write-descriptor.test.ts`、`todo-write-observability.test.ts`、`sqlite-gateway-stores.test.ts`、`builtin-tool-framework.test.ts`、`composition.test.ts`、`sqlite-provider-schema-ownership.test.ts`、`gateway-configuration-contracts.test.ts`。
- 运维：LOCAL 同节点多进程需共享 SQLite 文件并启用 WAL；REMOTE 部署依赖外部团队交付的实现，未交付前相关 capability 不可用。
