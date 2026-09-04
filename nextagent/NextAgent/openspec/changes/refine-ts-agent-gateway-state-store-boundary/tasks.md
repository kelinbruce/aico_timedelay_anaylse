## 1. `FN-8.1 持久化运行数据`

- [ ] 1.1 新增 contract 测试 `tests/contract/gateway-state-store-bindings-contracts.test.ts`，断言 `GatewayBindings` 目标 shape：顶层暴露 `stateStore`、`longTermMemory`、`blobStore`、`taskTrajectory`、`userInteractionStores`、`audit`，不再存在 `workingMemory` 与 `sqliteStores`；`StateStoreGatewayBindings` 包含 `requestRuns`、`memoryRecallAttempts`、`sessions`、`messages`、`sessionForks`、`attachments`、`activeContext`、`timeline`、`checkpoints`、`pendingInputs`、`conversationAnnotations`、`conversationShares`、`questionRecommendations?`，不含 `todoStateStore`；`blobStore` 完整提供 `BlobStoreGateway`；`taskTrajectory` 含 `taskTrajectoryStore` 与 `taskTrajectoryQuery`；`userInteractionStores` 含 `attachmentStore` 与 `userQuestionActivityStore`；`TodoStateStoreGateway`、`TodoStateItemRecord`、`TodoStateCurrentRecord`、`TodoStateRevisionRecord`、`ReplaceTodoStateRequest`、`ReplaceTodoStateResult`、`TodoStateLookupRequest`、`TodoStateRevisionListRequest` 不再从 `agent-contracts/gateway` 导出。变更前运行测试确认失败。
   - 来源：`FN-8.1 持久化运行数据` + `Gateway stores have one capability provider owner` 全部 Scenario + design `FN-8.1 持久化运行数据 / 修改方案 / 契约层`
   - 验证：`npm run test:contract`；实施前失败（引用不存在的 `stateStore`），实施后通过

- [ ] 1.2 重构 `agent-contracts/gateway`：`WorkingMemoryGatewayBindings` → `StateStoreGatewayBindings`，`GatewayBindings.workingMemory` → `GatewayBindings.stateStore`；移除 `SqliteGatewayStoreBindings` 并新增 `blobStore`、`taskTrajectory`（`store` + `query`）、`userInteractionStores`（`attachmentStore` + `userQuestionActivityStore`）顶层 binding；`audit` 保持顶层。移除 `TodoStateStoreGateway` 接口及其全部关联类型（`TodoStateItemRecord`、`TodoStateCurrentRecord`、`TodoStateRevisionRecord`、`ReplaceTodoStateRequest`、`ReplaceTodoStateResult`、`TodoStateLookupRequest`、`TodoStateRevisionListRequest`），从 `SqliteGatewayStoreBindings` 移除 `todoStateStore` 字段。
   - 来源：`FN-8.1 持久化运行数据` + `Gateway stores have one capability provider owner` + design `FN-8.1 持久化运行数据 / 修改方案 / 契约层`
   - 验证：`npm run build`；`npm run test:contract` 通过

- [ ] 1.3 更新 `agent-platform-gateway-local` provider factories，使 LOCAL provider 按新 shape 产出 `stateStore`、`longTermMemory`、`blobStore`、`taskTrajectory`、`userInteractionStores`，不含 `todoStateStore`。移除 `SqliteTodoStateStore`、`todo_state_revisions`/`todo_states_current` 表及相关 schema、row mapping、cascade delete 和方法。
   - 来源：`FN-8.1 持久化运行数据` + `Provider bindings are capability-complete and implementation-neutral` + design `FN-8.1 持久化运行数据 / 修改方案 / LOCAL provider`
   - 验证：`npm run build`；LOCAL provider contract 测试（`packages/agent-platform-gateway-local/tests/local-gateway-provider.test.ts`）更新后通过

- [ ] 1.4 为 `StateStore 支持同节点多进程共享 SQLite 数据文件` 编写两进程共享测试：两个 LOCAL provider 实例共享同一 StateStore SQLite 文件，进程 A 写入、进程 B 读取一致；两进程并发写入不同 Session 事实均持久化。变更前（无 WAL）运行确认可观察到失败或未覆盖。
   - 来源：`FN-8.1 持久化运行数据` + 系统质量属性（可靠性/恢复）+ `StateStore 支持同节点多进程共享 SQLite 数据文件` 全部 Scenario + design `FN-8.1 持久化运行数据 / 修改方案 / 两进程验证`
   - 验证：`npx vitest run packages/agent-platform-gateway-local/tests/state-store-multi-process.test.ts`；实施后通过

- [ ] 1.5 在 LOCAL `SqliteGatewayCore` 打开 StateStore 数据文件时启用 `PRAGMA journal_mode = WAL`（其余 provider 文件同样启用），保留 `busy_timeout`。
   - 来源：`FN-8.1 持久化运行数据` + `StateStore 支持同节点多进程共享 SQLite 数据文件` + design `FN-8.1 持久化运行数据 / 修改方案 / LOCAL provider`
   - 验证：`npm run build`；`npx vitest run packages/agent-platform-gateway-local/tests/state-store-multi-process.test.ts` 通过

- [ ] 1.6 新增实现无关的 StateStore conformance 套件：输入为 StateStore、Long-term Memory、blobStore、taskTrajectory 与 user-interaction-stores bindings，断言覆盖 session/message/timeline/checkpoint/pending input 写入-读取一致性、任务轨迹幂等与 version conflict、terminal commit 复合事务、附件摄入与用户问题活动行为；断言只依赖 `agent-contracts/gateway` 公共端口，不引用 SQLite 文件/连接/provider-private DTO。断言不覆盖 todo state（已移除 gateway 持久化）。
   - 来源：`FN-8.1 持久化运行数据` + 系统质量属性（可测试性）+ `Gateway store conformance 契约与实现无关且可复用` 全部 Scenario + design `FN-8.1 持久化运行数据 / 修改方案 / conformance 契约`
   - 验证：conformance 套件在 `agent-test-kit` 导出并编译；LOCAL provider 运行同一套件全部通过

- [ ] 1.7 Function 验证：LOCAL provider 通过 conformance 套件；两进程共享测试通过；`Gateway stores have one capability provider owner` 与 `StateStore preserves request and session transaction boundaries` 全部 Scenario 有对应测试并通过。
   - 来源：`FN-8.1 持久化运行数据` 全部 ADDED/MODIFIED/RENAMED Requirements 与 Scenario + design 验证策略
   - 验证：`npx vitest run packages/agent-platform-gateway-local packages/agent-contracts`；`npm run test:contract`

- [ ] 1.8 移除 `agent-runtime` 的 `createGatewayTodoState`、`RuntimeTodoStatePort`、`RuntimeTodoExecutionContext`、`RuntimeTodoItem` 和 `gateway-todo-state.ts` 文件；从 `agent-runtime` index 导出移除 `createGatewayTodoState`。删除 `packages/agent-runtime/tests/todo-state-port.test.ts`。
   - 来源：design `FN-5.7 管理待办 / 修改方案`
   - 验证：`npm run build`；`npx vitest run packages/agent-runtime` 通过

- [ ] 1.9 重构 TodoWrite tool（`agent-capability`）：移除 `requiredDependencies: ['todoState']`；`execute` 改为纯 input-validation + all-completed 清空，返回 `{ newTodos }`，不再调用 `options.deps.todoState.replaceTodos`，不再返回 `oldTodos`；output schema 移除 `oldTodos`，只 required `newTodos`。从 `ToolDependencyName`/`ToolDependencies` 移除 `todoState`。
   - 来源：design `FN-5.7 管理待办 / 修改方案` + `todo-write-tool` spec delta
   - 验证：`npm run build`；`npx vitest run packages/agent-capability/tests/todo-write-tool.test.ts packages/agent-capability/tests/todo-write-descriptor.test.ts` 通过

- [ ] 1.10 更新 `agent-app` composition：移除 `gateway-composition.ts` 的 `createGatewayTodoState` 调用与 `todoState` 注入面；`capability-composition.ts` 不再向 `toolDependencies` 传入 `todoState`；`create-app.ts` 移除 `todoState` 解构。更新 `builtin-tool-framework.test.ts`、`composition.test.ts` 中对 `createGatewayTodoState`/`todoState` 的断言。
   - 来源：design `FN-8.1 持久化运行数据 / 修改方案 / 配置与组合层` + `FN-5.7 管理待办 / 修改方案`
   - 验证：`npm run build`；`npx vitest run packages/agent-app` 通过；`npm run lint:architecture` 通过

- [ ] 1.11 更新 todo-write observability 测试（`agent-observability`）：移除对 `createGatewayTodoState` 和 `TodoStateStoreGateway` 的依赖；observability 断言改为验证 TodoWrite tool 执行路径的低基数诊断（capability id、item count、status summary），不依赖 gateway store。
   - 来源：design `FN-5.7 管理待办 / 修改方案`
   - 验证：`npx vitest run packages/agent-observability/tests/todo-write-observability.test.ts` 通过

- [ ] 1.12 删除 `tests/contract/todo-state-gateway-contract.test.ts`；更新 `tests/contract/gateway-configuration-contracts.test.ts` 移除 `todoStateStore` 断言；更新 `packages/agent-platform-gateway-local/tests/sqlite-provider-schema-ownership.test.ts` 移除 `todo_state_revisions`/`todo_states_current` 表断言；更新 `packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts` 移除全部 todo state 测试用例。
   - 来源：design `FN-8.1 持久化运行数据 / 修改方案`
   - 验证：`npm run test:contract` 通过；`npx vitest run packages/agent-platform-gateway-local` 通过

## 2. `FN-10.5 集成外部系统`

- [ ] 2.1 新增 config validation 与 gateway selection 测试，断言：`adapterKind: "state-store"`、`"user-interaction-stores"`、`"blob-store"` 与 `"task-trajectory"` 属于稳定选择集合；默认 selection 使用 `local-state-store`/`state-store`、`local-user-interaction-stores`/`user-interaction-stores`、`local-blob-store`/`blob-store`、`local-task-trajectory`/`task-trajectory`；`state-store` 选择时要求 `stateStore` binding、`long-term-memory` 要求 `longTermMemory`、`user-interaction-stores` 要求 `userInteractionStores` 完整、`blob-store` 要求 `blobStore`、`task-trajectory` 要求 `taskTrajectory`。变更前运行确认失败。
   - 来源：`FN-10.5 集成外部系统` + `Validation follows deterministic rule order` Scenario + `Gateway registry resolves selected providers per gateway entry` Scenario + design `FN-10.5 集成外部系统 / 修改方案 / 配置层`
   - 验证：`npx vitest run packages/agent-app/tests/config/gateway-selection.test.ts`；实施前失败，实施后通过

- [ ] 2.2 更新 `agent-app` 配置层：`GatewayAdapterKind` 用 `state-store` 替代 `working-memory`、`user-interaction-stores` 替代 `sqlite`，新增 `blob-store` 与 `task-trajectory`；`REGISTERED_GATEWAY_ADAPTERS`、默认 selection（`local-state-store`、`local-user-interaction-stores`、`local-blob-store`、`local-task-trajectory`）、测试 composition 同步更新。
   - 来源：`FN-10.5 集成外部系统` + `Gateway configuration is loaded and stabilized during startup` + design `FN-10.5 集成外部系统 / 修改方案 / 配置层`
   - 验证：`npm run build`；`npx vitest run packages/agent-app/tests/config/gateway-selection.test.ts` 通过

- [ ] 2.3 更新 `gateway-composition.ts`：`missingGatewayBinding` 与 `bindingAdapterKinds` 按能力组校验——`state-store` 检查 `stateStore`、`long-term-memory` 检查 `longTermMemory`、`user-interaction-stores` 检查 `userInteractionStores.attachmentStore` 与 `userInteractionStores.userQuestionActivityStore`、`blob-store` 检查 `blobStore`、`task-trajectory` 检查 `taskTrajectory`。
   - 来源：`FN-10.5 集成外部系统` + `Gateway registry resolves selected providers per gateway entry` + design `FN-10.5 集成外部系统 / 修改方案 / 配置层`
   - 验证：`npm run build`；gateway composition contract 测试通过

- [ ] 2.4 编写 REMOTE 空实现失败语义测试：未注入真实实现的 REMOTE provider 使 startup fail before ready 且不回退 LOCAL；空实现方法调用返回 code 为 `NOT_IMPLEMENTED` 的确定性安全错误，不泄漏 provider 端点/credential/连接池/provider-native 错误。变更前运行确认失败。
   - 来源：`FN-10.5 集成外部系统` + 系统质量属性（安全）+ `REMOTE 空实现未注入真实实现时安全失败` 全部 Scenario + design `FN-10.5 集成外部系统 / 修改方案 / Remote 包空实现化`
   - 验证：`npx vitest run packages/agent-platform-gateway-remote/tests/remote-gateway-empty-provider.test.ts`；实施后通过

- [ ] 2.5 将 `agent-platform-gateway-remote` 全部 REMOTE adapter 改为空实现：`reference-remote-*`、skillhub、workflow-remote、guardrail、watermark、api-call、audit-sink 等真实实现方法体返回 `NOT_IMPLEMENTED` 安全错误；保留 provider SPI、`RemoteGatewayReferenceBindings` shape（按新能力组字段更新）、`remoteGatewayReferenceAdapterKinds`（`state-store`、`user-interaction-stores`、`blob-store`、`task-trajectory` 替代 `working-memory`、`sqlite`）与 `blockedRemoteGatewayBindings`。
   - 来源：`FN-10.5 集成外部系统` + `REMOTE 空实现未注入真实实现时安全失败` + design `FN-10.5 集成外部系统 / 修改方案 / Remote 包空实现化`
   - 验证：`npm run build`；`npx vitest run packages/agent-platform-gateway-remote` 通过；空实现方法调用断言 `NOT_IMPLEMENTED`

- [ ] 2.6 验证外部团队可复用 conformance 契约：把 `FN-8.1` 的 conformance 套件接入可发布测试资产，确认其只依赖 `agent-contracts` 公共端口，LOCAL 与 REMOTE fixture 使用同一组断言。
   - 来源：`FN-10.5 集成外部系统` + 系统质量属性（可测试性）+ `外部团队复用实现无关 conformance 契约交付 REMOTE provider` 全部 Scenario + design `FN-10.5 集成外部系统 / 修改方案 / conformance 契约`
   - 验证：`npm run build`；conformance 套件导出可被测试项目引用并运行

- [ ] 2.7 Function 验证：`Gateway configuration is loaded and stabilized during startup`、`Validation follows deterministic rule order`、`Gateway registry resolves selected providers per gateway entry`、`REMOTE 空实现未注入真实实现时安全失败`、`外部团队复用实现无关 conformance 契约交付 REMOTE provider` 全部 Scenario 有对应测试并通过。
   - 来源：`FN-10.5 集成外部系统` 全部 ADDED/MODIFIED Requirements 与 Scenario + design 验证策略
   - 验证：`npx vitest run packages/agent-app packages/agent-platform-gateway-remote`；`npm run test:contract`

## 3. 跨 Function 集成与迁移

- [ ] 3.1 更新 `agent-app` 组合面：`composition-contracts.ts` 的 `AppGatewayStores`、`gateway-composition.ts` 的 `localGatewayStoresFromBindings` 与 `composeGatewayLayer`、`create-app.ts`/`create-test-composition.ts`/`local-runtime-bindings.ts` 注入面按 `stateStore` + `longTermMemory` + `blobStore` + `taskTrajectory` + `userInteractionStores` 映射。
   - 来源：`FN-8.1` + `FN-10.5` + design `跨 Function 协作与端到端流程`
   - 验证：`npm run build`；app composition 与 test composition 相关测试通过

- [ ] 3.2 更新领域消费面：`agent-session`、`agent-runtime`、`agent-attachment-runtime`、`agent-memory` 等通过 `AppGatewayStores` 或 public gateway ports 消费的注入面按新分组调整（`userQuestionActivity` → `userQuestionActivityStore`、`attachmentReservations` → `attachmentStore`、`blobs` → `blobStore`、`taskTrajectoryStore`/`taskTrajectoryQuery` → `taskTrajectory`），port 行为不变；无 private path import 违规。
   - 来源：`FN-8.1` + `FN-10.5` + design `FN-8.1 持久化运行数据 / 修改方案`
   - 验证：`npm run build`；`npm run lint:architecture`；受影响 package 测试通过

## 4. Change 整体验证

- [ ] 4.1 全量门禁：后端 workspace 常规验证与 OpenSpec 校验全部通过。
   - 来源：proposal 影响范围 + design 验证策略
   - 验证：在仓库根目录运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`，全部通过

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的"长期基线刷新计划"归并长期事实：`gateway-store-provider-ownership`、`gateway-configuration`、`FN-8.1`、`FN-10.5`、`F-8.1`、`F-10.5`、core-contracts、configuration-boundary、observability-boundaries、agent-contracts、agent-app、agent-platform-gateway-local、agent-platform-gateway-remote、overview、spec-to-design-map；并检查长期文档没有重复定义同一行为、schema、owner 或接口语义。物理文件与内部路径字段（`workingMemorySqliteFile`/`working-memory.sqlite`、`nextagent.sqlite`）保持现状的对齐决策记录在 design"风险与取舍"。
