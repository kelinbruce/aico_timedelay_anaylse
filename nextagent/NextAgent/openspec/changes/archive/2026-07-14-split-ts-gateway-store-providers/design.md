## 背景和现状（Context）

当前 `GatewayAdapterKind="sqlite"` 对应一个 `GatewayBindings.stores`，其中 `GatewayStoreBindings` 包含 19 个 optional stores。`agent-platform-gateway-local` 用单一 `SqliteGatewayCore`、单一数据库连接和单一 `nextagent.sqlite` 实现全部 stores；`agent-app` 再通过 `Required<GatewayStoreBindings>`、额外属性和类型断言恢复产品所需的完整 bundle。

现有 registry 按 `deploymentMode` 分组，并要求每组恰好解析一个 provider；`mergeGatewayBindings` 又禁止多个 provider 同时返回 `stores`。这两个约束都无法表达 Working Memory、Long-term Memory 和保留 SQLite capability 独立选择的目标。

本 change 处于首个版本，无存量数据迁移和旧配置兼容约束。相关方包括 runtime/session/context/attachment/memory consumers、`agent-app` composition、local/remote gateway provider 实现和本地运维路径。

Implementation-vs-spec gap：当前代码尚无 capability-specific store bindings，全部表仍由单一 SQLite core 初始化；当前默认配置也只选择 `local-sqlite`。实施必须一次完成 contract、selection、composition 和 schema ownership，不能先形成多个 provider 共享旧 core 的中间目标状态。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 用 `working-memory`、`long-term-memory` 和保留 `sqlite` 三个 adapter kinds 表达独立 persistence capability。
- 建立完整、非 optional、provider-neutral 的 Working Memory 和 Long-term Memory bindings。
- 让每个 selected adapter entry 恰好解析到一个 injected provider，并允许同一 deployment mode 下存在多个 provider。
- 为三个 LOCAL capability 建立独立 SQLite 文件、连接、schema owner 和关闭生命周期。
- 保持 Working Memory 的 runtime/session 复合事务和 Long-term Memory 的 record/index 一致性。
- 让 app consumers 通过明确 bindings 注入，不再依赖通用 optional bundle 的类型断言。

**非目标：**

- 不调整 `attachmentReservations`、`blobs`、trajectory、todo、user question activity 和 local audit 的业务语义或长期归属。
- 不重构 `todoStateStore`，不取消 `attachmentReservations` 持久化。
- 不新增数据迁移、双写、旧单库读取、兼容配置或运行时 fallback。
- 不改变 Web API、stream event、runtime command、memory ranking 或 attachment intake 语义。
- 不更新长期基线文档；长期文档只在归档前同步。

## 设计决策（Decisions）

### 1. Adapter kind 表达 capability，SQLite factory 表达实现

`GatewayAdapterKind` 增加 `working-memory` 和 `long-term-memory`。`sqlite` 暂时保留，但其语义收缩为尚未分类的 stores。LOCAL 实现分别命名为 `createSqliteWorkingMemoryGatewayProvider`、`createSqliteLongTermMemoryGatewayProvider` 和现有 local SQLite provider。

不新增独立的 `implementationKind`：当前 `deploymentMode` 加 injected provider 已足以选择 LOCAL SQLite 或 REMOTE 实现；再增加一层配置只会重复 provider identity。

放弃“仍以 sqlite 作为 adapter kind，并在 entry 中配置 store group”的方案，因为它继续把配置选择建立在实现技术上。放弃“一个 local provider 同时返回三组 bindings”的方案，因为它无法独立替换真实业务 provider，也不能形成独立 readiness 和生命周期。

### 2. 顶层 bindings 按 capability 分离

public contract 采用：

```ts
interface WorkingMemoryGatewayBindings {
  readonly requestRuns: RequestRunStoreGateway;
  readonly sessions: SessionStoreGateway;
  readonly messages: SessionMessageStoreGateway;
  readonly sessionForks: SessionForkStoreGateway;
  readonly attachments: AttachmentStoreGateway;
  readonly activeContext: ActiveContextStoreGateway;
  readonly timeline: RunTimelineEventStoreGateway;
  readonly checkpoints: CheckpointStoreGateway;
  readonly pendingInputs: PendingInputStoreGateway;
  readonly conversationAnnotations: ConversationAnnotationStoreGateway;
  readonly conversationShares: ConversationShareStoreGateway;
}

interface LongTermMemoryGatewayBindings {
  readonly store: LongTermMemoryStoreGateway;
  readonly retriever: LongTermMemoryRetrieverGateway;
}

interface SqliteGatewayStoreBindings {
  readonly attachmentReservations: AttachmentIntakeReservationGateway;
  readonly blobs: BlobStoreGateway;
  readonly taskTrajectoryStore: TaskTrajectoryStoreGateway;
  readonly taskTrajectoryQuery: TaskTrajectoryQueryGateway;
  readonly todoStateStore: TodoStateStoreGateway;
  readonly userQuestionActivity: UserQuestionActivityStoreGateway;
  readonly audit: AuditEventStoreGateway;
}

interface GatewayBindings {
  readonly workingMemory?: WorkingMemoryGatewayBindings;
  readonly longTermMemory?: LongTermMemoryGatewayBindings;
  readonly sqliteStores?: SqliteGatewayStoreBindings;
  // existing non-store bindings
}
```

`GatewayStoreBindings` 和顶层 `stores` 删除，不保留 deprecated alias。`agent-app` 可以定义一个内部、完整的 `AppGatewayStores` 供现有 composition functions 使用，但它必须由三个已校验 binding 显式构造，不能 public export，也不能使用 cast 补齐字段。

`audit` 继续由保留 SQLite owner 持有，并以 provider-neutral gateway port 进入保留 binding，使 `agent-app` observability wiring 不再依赖 local-private type。该 port 不改变 audit event 内容、安全脱敏或查询语义。

### 3. Registry 按 selected entry 解析 provider

registry 不再按 `deploymentMode` 要求唯一 provider，而是对每个 selected entry 执行：

1. 过滤 `provider.deploymentMode === entry.deploymentMode`；
2. 过滤 `provider.supportedAdapterKinds.includes(entry.adapterKind)`；
3. 匹配结果必须恰好一个；零个为 missing，多个为 ambiguous，均 fail closed；
4. 按 provider identity 聚合其 entries，每个 provider 只调用一次 `create`；
5. 校验 provider 只返回已选择 capability 的 bindings，且每个 binding 完整；
6. 按顶层 binding key 合并；重复 key 为 conflict。

该算法允许一个 provider 实现多个 kinds，但默认 LOCAL 三个 persistence providers 各只声明一个 persistence kind。现有 local provider 可继续声明 sandbox、cron 等它实际拥有的非 persistence kinds。

### 4. 三个 SQLite owner 物理隔离

可信路径固定派生为：

```text
<workspaceRoot>/data/system/working-memory.sqlite
<workspaceRoot>/data/system/long-term-memory.sqlite
<workspaceRoot>/data/system/nextagent.sqlite
```

实现拆为三个 owner-specific core 类型和 store bundle：

- `SqliteWorkingMemoryCore` / `SqliteWorkingMemoryStores`：只初始化和访问 Working Memory 表、索引、事务 helper。
- `SqliteLongTermMemoryCore` / `SqliteLongTermMemoryStores`：只初始化和访问 long-term-memory 权威表、FTS/index 和 memory-private metadata。
- `SqliteResidualGatewayCore` / `SqliteResidualGatewayStores`：只向 provider 暴露保留 stores 及 audit。

三个 core 实例分别打开各自文件并拥有独立 transaction object 和关闭生命周期。为控制首版机械迁移风险，owner-specific core MAY 复用 adapter-private SQL engine 实现，但 schema owner 必须在构造时固定，初始化与非 owner schema 清理必须位于同一数据库事务，且 provider 只能通过对应 store bundle 暴露 owner ports。不得共享运行时连接、transaction object、文件或跨 owner composite transaction。

### 5. 复合事务按最终 owner 保留

Working Memory core 完整迁移现有：

- terminal commit 的 RequestRun、message、timeline 原子写；
- session create 与 active context 初始化；
- session cascade delete，包括 annotation 和 share 删除；
- session fork、promotion 和相关幂等锚点；
- request recovery、checkpoint 和 pending input 所需 CAS/事务。

`attachments` 只迁移已接受附件的 metadata 表和 port。`attachmentReservations` 与 `blobs` 留在保留 SQLite core。attachment intake 已采用分阶段写和 blob rollback 补偿，不引入跨 provider 事务；本 change 通过现有 characterization tests 保持该行为。

Long-term Memory core 同时实现 store 和 retriever；FTS/index 更新与权威 row 写入继续由同一 core 管理。trajectory 不随 memory 迁移。

### 6. 配置无兼容层

默认配置直接声明三个 LOCAL entries。`SystemPaths` 新增两个 derived fields，并保留 `sqliteFile` 给保留 provider。用户 overlay 对三个 SQLite path 的任何显式输入均 fail closed。

测试 factory 必须为每个测试生成独立目录中的三个文件，lifecycle cleanup 必须登记三个路径。不读取或迁移旧 `nextagent.sqlite` 中已经移出 ownership 的表；空 schema 是唯一支持的初始状态。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 路径只从可信 `workspaceRoot` 派生；provider selection 不接受请求体、模型或 capability 参数；owner/agent scope contract 不变；ambiguous/missing binding fail closed，诊断不输出路径和 provider-native error。 | config negative tests、gateway contract tests、security review |
| 性能/容量 | 三个 SQLite 连接消除长期记忆 FTS 与 runtime transaction 的单连接争用；不新增跨库同步查询。文件数固定为 3，不引入动态 shard。 | local integration tests；现有 runtime/memory performance gates不得回退 |
| 可靠性/恢复 | terminal commit、session cascade、run recovery 保留单 Working Memory 事务；memory row/index 保留单 Long-term Memory owner；provider 初始化任一失败即阻断 ready，不 fallback。 | transaction fault tests、runtime recovery tests、memory retrieval tests |
| 可维护性 | capability-specific complete bindings 消除 optional bundle 和 cast；schema 与 owner 同模块；未分类 stores 被显式列举，禁止默认扩张。 | architecture tests、dependency-cruiser、semantic review |
| 可测试性 | 三个 factory 可独立注入；每个 SQLite 文件可通过 table inventory 断言 ownership；provider ambiguity/missing/extra binding 可确定性构造。 | unit、contract、composition、schema-isolation tests |
| 审计/可追溯性 | readiness evidence 保留每个 selected provider id 和 binding reference；local audit 继续由保留 SQLite owner 承载，不改变 event 内容或泄漏规则。 | gateway readiness tests、observability linking tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| capability-specific complete bindings 与唯一 ownership | 1.1-1.3、6.1 | contract tests、TypeScript build |
| entry-level provider resolution、缺失/歧义/冲突 fail closed | 2.1-2.4、6.2 | gateway composition tests |
| 三个可信 derived SQLite paths | 3.1-3.3、6.3 | config schema/path negative tests |
| Working Memory 事务不退化 | 4.1-4.4、6.4 | terminal/session/fork/recovery tests |
| Long-term Memory record/index 同 owner | 5.1-5.2、6.5 | memory core and retrieval tests |
| 三文件 schema ownership 隔离 | 4.5、5.3、6.6 | SQLite table inventory integration test |
| 不保留旧单库兼容和跨 provider transaction | 4.5、5.4、6.6 | architecture/source negative assertions and review |
| 全仓非回归和 OpenSpec 一致性 | 7.1-7.5 | build、unit、contract、architecture、OpenSpec strict validation、semantic review |

## 文档承载决策（Documentation Ownership）

- 行为契约：`gateway-store-provider-ownership` 主承载 store ownership、binding 完整性和事务可观察不变量；`gateway-configuration` 主承载 selection/readiness；`app-config-schema` 主承载 derived paths。
- 架构和跨模块设计：`core-contracts.md` 主承载 binding shape，`runtime-boundaries.md` 主承载 Working Memory 事务，`memory.md` 主承载 Long-term Memory owner，`configuration-boundary.md` 主承载路径信任边界。
- 模块设计：`agent-app.md` 主承载 registry/composition；local/remote gateway module docs 主承载 provider 实现职责。
- ADR：无。该决策直接替换首版未稳定的单体 store bundle，不需要并行保留备选方案。
- 导航：`spec-to-design-map.md` 连接三个 capabilities 与上述设计和验证入口。

## 风险与取舍（Risks / Trade-offs）

- [拆分 5000 行 SQLite core 时误留跨 owner SQL] -> 以每个文件 table inventory、跨文件 forbidden table negative tests 和 store contract tests约束。
- [registry 从 deployment-mode 唯一改为 entry-level 唯一后出现 provider ambiguity] -> 精确匹配必须恰好一个，默认 providers 声明互斥 persistence kinds，ambiguity 启动失败。
- [attachments 与 blob/reservation 分库产生部分失败] -> 保持现有 staged write、幂等和 rollback 行为，不新增跨库原子承诺，并运行 attachment intake/cleanup characterization tests。
- [三个连接增加本地资源占用] -> 连接数固定且随 app lifecycle 统一关闭；换取事务域和 FTS 负载隔离。
- [保留 SQLite provider 名称仍然是技术名称] -> 这是明确列举 stores 的当前边界，不推测其长期领域归属；新增 store 不得默认加入。

## 迁移计划（Migration Plan）

无数据迁移。当前为首个版本，实现直接切换默认配置、contract 和空 schema 初始化。旧 `nextagent.sqlite` 不被识别为 Working Memory 或 Long-term Memory 数据源，不双写、不复制、不提供 fallback。发布验证在新的空 workspace 完成；代码回滚只能回滚到旧版本并使用旧版本自己的 workspace 数据，不承诺新旧数据库互读。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/gateway-store-provider-ownership/spec.md`：新增 ownership、完整 binding、事务及物理隔离行为。
- `openspec/specs/gateway-configuration/spec.md`：同步 adapter set、entry-level provider resolution 和 default selection。
- `openspec/specs/app-config-schema/spec.md`：同步三个 derived SQLite paths。
- `openspec/overview.md`：提炼 capability 与实现解耦的长期背景。
- `openspec/designs/architecture/core-contracts.md`、`runtime-boundaries.md`、`memory.md`、`configuration-boundary.md`：分别提炼 contract、runtime transaction、memory ownership 和路径边界。
- `openspec/designs/modules/agent-app.md`、`agent-platform-gateway-local.md`、`agent-platform-gateway-remote.md`：提炼模块职责与注入关系。
- `openspec/designs/adr/`：无更新。
- `openspec/designs/spec-to-design-map.md`：补充导航和验证入口。

## 待确认问题（Open Questions）

无。`todoStateStore`、`attachmentReservations` 等保留 stores 的长期归属不属于本 change，不影响本 change 的完整实施边界。
