## 背景和现状（Context）

当前长期记忆 Web 路由直接导入 Gateway Request、Query、Record 和 `LongTermMemoryGatewayBindings`，并在 Channel 内完成 scope 组装、Gateway 调用、SafeError 识别和 Record projection。稳定架构要求 `agent-channel-web` 只负责 transport/projection，不直接调用 gateway store 或实现包。

群内评审确认不新增 `agent-contracts/memory`。长期记忆管理属于 Channel 面向上层暴露的 application boundary，公开 port 放入已有 `agent-contracts/channel`；业务实现由 `agent-memory` 拥有；Gateway 继续拥有持久化/远端服务契约；`agent-app` 只组装依赖。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 在 `agent-contracts/channel` 定义唯一 `LongTermMemoryManagementPort`。
- 让 12 个长期记忆 Web operation 只通过该 port 进入 `agent-memory` application service。
- 分离 management DTO/view 与 Gateway Request/Query/Record。
- 固化 trusted Owner Scope、Agent Scope、取消、safe error 和 composition 边界。
- 用 architecture negative test 阻止 Channel 重新直连 Gateway。

**非目标：**

- 不新增 `agent-contracts/memory` subpath。
- 不修改长期记忆 Gateway 的 12 个 method、CAS、幂等或 sharing transaction 语义。
- 不修改 Web URL、REST envelope、前端页面或 service method。
- 不改变 extraction、dreaming、aging、revival、sharing 或 retrieval 算法。
- 不实现 REMOTE HTTP adapter，不修改 SQLite schema。
- 不让 `agent-app` 承担记忆业务校验或 DTO 映射。

## 设计决策（Decisions）

### 1. 唯一依赖方向

```text
HTTP request
  -> agent-channel-web
     - wire schema validation
     - trusted identity / Agent Scope injection
     - request cancellation connection
     - HTTP DTO and SafeError projection
  -> agent-contracts/channel.LongTermMemoryManagementPort
  -> agent-memory application service
     - management DTO validation and mapping
     - one-to-one Gateway delegation
  -> agent-contracts/gateway Store / Retriever / Sharing ports
  -> selected local or remote adapter
```

依赖规则：

- `agent-channel-web` 只从现有 `agent-contracts/channel` subpath 消费 management port，不导入长期记忆 Gateway 类型。
- `agent-memory` 依赖 `agent-contracts/channel` 实现 management port，并依赖 `agent-contracts/gateway` 调用下层能力。
- `agent-contracts/channel` 不依赖 `agent-contracts/gateway`，management DTO 不 extends、alias 或 re-export Gateway DTO。
- `agent-contracts/gateway` 不依赖 `agent-contracts/channel`。
- `agent-app` 只取得 selected Gateway bindings、调用 `agent-memory` public factory、把返回 port 注入 Channel。

该路径没有 package cycle，也没有第二套 facade。Channel 直连 Gateway、Channel 依赖 `agent-memory` implementation、在 `agent-app` 手写映射、重新新增 `agent-contracts/memory` 均不是允许方案。

### 2. 单一 Management Port

`agent-contracts/channel` 增加：

```ts
export interface LongTermMemoryManagementPort {
  saveLongTermMemory(command: SaveLongTermMemoryManagementCommand, signal?: AbortSignal): Promise<LongTermMemoryManagementView | SafeError>;
  listLongTermMemory(query: ListLongTermMemoryManagementQuery, signal?: AbortSignal): Promise<LongTermMemoryManagementPage | SafeError>;
  manualSaveLongTermMemory(command: ManualSaveLongTermMemoryManagementCommand, signal?: AbortSignal): Promise<LongTermMemoryManagementView | SafeError>;
  getLongTermMemory(query: GetLongTermMemoryManagementQuery, signal?: AbortSignal): Promise<LongTermMemoryManagementView | SafeError>;
  deleteLongTermMemory(command: DeleteLongTermMemoryManagementCommand, signal?: AbortSignal): Promise<DeleteLongTermMemoryManagementResult | SafeError>;
  mutateLongTermMemory(command: MutateLongTermMemoryManagementCommand, signal?: AbortSignal): Promise<LongTermMemoryMutationManagementResult | SafeError>;
  searchLongTermMemory(query: SearchLongTermMemoryManagementQuery, signal?: AbortSignal): Promise<LongTermMemorySearchManagementPage | SafeError>;
  getLongTermMemoryDetail(query: GetLongTermMemoryDetailManagementQuery, signal?: AbortSignal): Promise<LongTermMemoryManagementView | SafeError>;
  publishLongTermMemory(command: PublishLongTermMemoryManagementCommand, signal?: AbortSignal): Promise<PublishLongTermMemoryManagementResult | SafeError>;
  unpublishLongTermMemory(command: UnpublishLongTermMemoryManagementCommand, signal?: AbortSignal): Promise<UnpublishLongTermMemoryManagementResult | SafeError>;
  listPublishedLongTermMemory(query: ListPublishedLongTermMemoryManagementQuery, signal?: AbortSignal): Promise<PublishedLongTermMemoryManagementPage | SafeError>;
  copyPublishedMemory(command: CopyPublishedMemoryManagementCommand, signal?: AbortSignal): Promise<CopyPublishedMemoryManagementResult | SafeError>;
}
```

Port 不增加 count、batch、transition、adjust、access 或兼容别名。12 个 method 的精确集合由 contract test 固定。

### 3. Management DTO 与 Gateway DTO 分层

所有 command/query 复用 frozen core contract 的可信身份形状，并把 Agent Scope 独立传递：

```ts
export interface LongTermMemoryManagementScope {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
}
```

scope 只包含完整的可信 `identityContext` 和独立的 `agentId`，与 frozen core contract 中 request/session command 的身份传递方式一致，也不继承 Gateway subpath 所属的 `OwnerScoped`。`displayName` 只作为 `IdentityContext` 的组成部分到达 application boundary；`agent-memory` 映射 Gateway 时只提取 `tenantId` 和 `subjectId`，不得把 `displayName` 传入 Gateway、响应或诊断。各 command/query 组合 scope 和 operation input；写控制信息与业务数据分开。Management view/page/result 只表达 Channel 所需业务字段，不继承或别名复用 Gateway Record、Request、Query、Result 或 `VersionedWriteOptions`。

为保持现有 REST contract，Channel 从本次调用的 `identityContext` 和可信 Agent Scope 投影 `tenantId`、`userId` 和 `agentId`，其中 `userId` 是 `identityContext.subjectId` 的 Web alias；这些 identity 字段不从 Gateway Record 穿透，`displayName` 不进入记忆 REST DTO。

### 4. `agent-memory` 实现 Application Service

`agent-memory` 提供：

```ts
createLongTermMemoryManagementService({ store, retriever, sharing })
```

每个 method 固定执行：

1. 接收已由 Channel runtime schema 校验的 typed management command/query，不重复实现 wire DTO 校验；
2. 从 `LongTermMemoryManagementScope.identityContext` 提取 `tenantId`/`subjectId`，并与 `agentId` 共同构造 Gateway scope；
3. 在 Gateway 调用前检查 `AbortSignal`；
4. 调用且只调用一个对应 Gateway method；
5. 把 Gateway Record/result 映射为 management view/result，或返回 presentation-safe `SafeError`。

service 不实现 ranking、FTS、CAS、idempotency anchor、sharing transaction、dreaming、aging 或 lifecycle policy。当前 Gateway port 不接收 `AbortSignal`，因此本 change 只保证调用前取消；Gateway 调用开始后不承诺中途取消，LOCAL 原子事务继续以一致性为先。REMOTE 下游取消需要独立 Gateway contract refinement，不在本 change 实现。

意外异常统一映射为固定 safe unavailable error。日志、metric、trace、audit 不记录 content、source、raw error、scope id、路径、credential 或 token。

### 5. Channel 只负责 Transport 和 Projection

`registerMemoryRoutes` 接收 `LongTermMemoryManagementPort` 和现有 trusted identity/Agent resolver。所有 route：

- 从 trusted identity resolver 获取完整 `IdentityContext`；
- 从 trusted hosted-Agent selection/composition 获取 `agentId`；
- 拒绝 body/query 中的 `tenantId`、`subjectId`、`userId`、`agentId` 和未知字段；
- 将 request abort/reply close 连接到 management port 的 `AbortSignal`；
- 只把 management view/result 投影为现有 REST DTO/envelope；
- 将 `SafeError` 映射为现有 safe HTTP status/body，不输出 raw error。

management port 缺失时不注册 routes，不得回退到 Gateway、disabled adapter 或 process-local mock。

### 6. `agent-app` 仅 Composition/Wiring

`agent-app` 从 selected `AppGatewayStores` 取得 Store、Retriever、Sharing，调用 `createLongTermMemoryManagementService`，把结果作为 `longTermMemoryManagement?: LongTermMemoryManagementPort` 注入 Channel registration context。

`agent-app` 不构造 management DTO、不做 Record projection、不解释 memory operation，也不直接代替 application service 调用 Gateway。旧 `longTermMemoryStores` Channel dependency 与 Gateway passthrough 同一次提交删除，不保留双路径。

### 7. 冻结契约确认

群内已确认：

- 长期记忆 Gateway 公开接口调整无问题；
- 本次管理入口放在 `agent-contracts/channel`；
- 唯一路径是 `web-channel -> channel management port -> agent-memory application service -> gateway`；
- `agent-app` 仅负责 composition/wiring；
- 不新增 `agent-contracts/memory`。

确认详情记录在 `references/frozen-long-term-memory-management-contract-confirmation.md`。实现偏离该路径时必须重新确认。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | Owner Scope 来自 trusted identity resolver，Agent Scope 来自 trusted selection/composition；authority 字段必须拒绝；Record/raw error/content 不进入 Web 或诊断。 | route negative tests、scope handoff tests、safe error/log assertions |
| 性能/容量 | service 只做 O(1) 映射，每次 operation 只调用一个 Gateway method，不新增 fan-out、缓存、批处理或数据库往返。 | delegation tests、现有 Gateway contract tests |
| 可靠性/恢复 | 不改变 Gateway CAS、幂等、事务和物理删除；调用前响应取消，LOCAL 原子事务保持全成或全败；无双路径。 | pre-abort tests、transaction regression、route integration |
| 可维护性 | Channel contract、memory implementation、Gateway port 和 app wiring 职责分离；沿用已有 channel subpath，不新增 namespace。 | dependency-cruiser、architecture negative tests、code review |
| 可测试性 | Channel 使用 management fake；application service 使用 Gateway fakes；contract test 固定 12-method surface。 | contract、unit、Fastify inject、composition tests |
| 审计/可追溯性 | 群确认、Issue、OpenSpec、contract tests 和最终 review 形成证据链；运行诊断只保留安全 operation/result。 | confirmation reference、strict validation、review record |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| channel subpath 增加 12-method management port | 1.1、1.2 | package export/contract surface tests |
| management DTO 不泄漏 Gateway 类型 | 1.3 | type-level tests、forbidden-source assertions |
| `agent-memory` 一一委托 Gateway | 2.1-2.4 | service unit/contract tests |
| Channel 不直连 Gateway | 3.1、4.2 | route tests、dependency-cruiser、negative test |
| trusted scope 和 REST projection | 3.2 | Fastify inject negative/compatibility tests |
| 调用前取消和事务一致性 | 2.4、3.3 | pre-abort、disconnect、rollback tests |
| app 仅 composition/wiring | 4.1、4.3 | composition tests、semantic review |
| 群内确认 | 0.1-0.3 | confirmation reference |

## 增量实施路径（Implementation Delta）

1. 扩展 `agent-contracts/channel` 公开 contract 和测试。
2. 在 `agent-memory` 新增 application service 和 mapper。
3. 将 Channel route 切换为 management port，删除 Gateway imports 和 Record projection。
4. 在 `agent-app` 构造 service并注入 port，删除 `longTermMemoryStores` passthrough。
5. 更新 active `add-ts-long-memory-manage` 的规范和任务状态。
6. 运行 contract、route、composition、architecture 和全仓门禁。

没有数据库或配置迁移。回滚必须整体回滚 contract、service、Channel 和 composition，不得恢复 Channel Gateway 直连。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-8.2-检索和写入记忆` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/long-term-memory-management-contract/spec.md`、`openspec/specs/ts-backend-architecture/spec.md`、`openspec/specs/ts-core-contracts/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
