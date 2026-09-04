## 背景与问题（Why）

当前 `GatewayAdapterKind="sqlite"` 通过单一 `GatewayStoreBindings` 和 `SqliteGatewayStores` 同时承载运行中工作记忆、长期记忆以及尚未完成领域归类的本地持久化能力。该结构把业务存储能力与 SQLite 实现方式绑定在一起，使真实部署无法独立选择 Working Memory 和 Long-term Memory provider，也使 app composition 依赖一个全部字段可选、运行时再断言完整性的聚合 contract。

当前为首个版本，不存在存量数据库兼容或迁移要求。现在应当先建立明确的 provider ownership、完整 binding、独立生命周期和事务边界，避免后续真实业务存储接入时继续依赖单体 SQLite ownership。

## 变更范围（What Changes）

- **BREAKING**：新增 `working-memory` 和 `long-term-memory` adapter kind；`sqlite` 不再代表全部 persistence stores，只承载本 change 明确保留的本地 stores。
- **BREAKING**：以完整、非 optional 的 `WorkingMemoryGatewayBindings` 和 `LongTermMemoryGatewayBindings` 替代对应能力继续混用通用 `GatewayStoreBindings`；app composition 按 capability binding 合并和校验 provider 输出。
- Working Memory provider 统一拥有 `requestRuns`、`sessions`、`messages`、`sessionForks`、`attachments`、`activeContext`、`timeline`、`checkpoints`、`pendingInputs`、`conversationAnnotations` 和 `conversationShares`。
- Long-term Memory provider 统一拥有 `longTermMemoryStore` 和 `longTermMemoryRetriever`。
- 原 SQLite provider 暂时保留 `attachmentReservations`、`blobs`、`taskTrajectoryStore`、`taskTrajectoryQuery`、`todoStateStore`、`userQuestionActivity` 和 `audit`。本 change 不改变这些 store 的业务语义，也不决定其长期归属。
- 本地实现拆分为独立 Working Memory SQLite、Long-term Memory SQLite 和保留 SQLite 数据库 owner；三者使用从可信 `workspaceRoot` 派生的独立文件，不共享数据库连接、schema owner 或跨 provider 事务。
- Working Memory provider 保持 terminal commit、session create、session cascade delete、fork 等现有复合写的单库事务语义；Long-term Memory provider 保持 memory row 与检索索引同步的一致性。
- `agent-app` 仍是唯一 composition root，负责选择、校验和注入 provider bindings；领域 package 只消费 public gateway ports，不感知 SQLite 或远端实现。
- 不设计数据迁移、旧单库兼容层、双写、回退或运行时动态切换。

## Capability 影响（Capabilities）

### 新增 Capability

- `gateway-store-provider-ownership`: 定义 Working Memory、Long-term Memory 和保留 SQLite stores 的唯一 ownership、完整 bindings、事务边界及本地物理隔离要求。

### 修改的 Capability

- `gateway-configuration`: 扩展稳定 adapter kind 和默认 selection，按 capability binding 校验并合并多个 provider，收缩 `sqlite` 的含义。
- `app-config-schema`: 从可信 `workspaceRoot` 派生 Working Memory、Long-term Memory 和保留 SQLite 的独立内部数据库路径，并继续禁止用户覆盖。

## 影响范围（Impact）

- Contract：`packages/agent-contracts/src/gateway` 的 adapter kind、provider input/output 和 store binding shape。
- Composition/config：`packages/agent-app` 的配置 schema、路径派生、默认 gateway selection、provider resolution、binding merge、readiness validation、测试 composition 和生命周期关闭。
- Local gateway：`packages/agent-platform-gateway-local` 的 provider factories、SQLite core/schema/store bundles、public exports 和测试入口。
- Remote reference gateway：`packages/agent-platform-gateway-remote` 的 supported adapter kinds、reference binding shape 和完整性校验。
- Runtime/session/context/attachment/memory composition：依赖注入路径调整，但领域 port 行为保持不变。
- 运维：本地 workspace 从一个 SQLite 文件变为三个独立文件；本 change 不提供旧文件迁移。
- 验证：需要 contract、architecture、composition、transaction、recovery、SQLite schema isolation 和 minimal kernel non-regression 测试。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/gateway-store-provider-ownership/spec.md`：新增 provider ownership、完整 binding、事务及物理隔离基线。
- `openspec/specs/gateway-configuration/spec.md`：更新 adapter selection、provider binding merge 和默认配置基线。
- `openspec/specs/app-config-schema/spec.md`：更新可信内部 SQLite 路径派生基线。

长期背景：
- `openspec/overview.md`：补充 persistence capability 与具体存储实现解耦的目标。

设计视图：
- `openspec/designs/architecture/core-contracts.md`：更新 gateway binding 分类和完整性不变量。
- `openspec/designs/architecture/runtime-boundaries.md`：更新 Working Memory ownership 和 runtime 事务边界。
- `openspec/designs/architecture/memory.md`：更新 Long-term Memory provider ownership 和索引一致性边界。
- `openspec/designs/architecture/configuration-boundary.md`：更新三个内部 SQLite 文件的可信派生规则。
- `openspec/designs/modules/agent-app.md`：更新 provider selection、binding merge 和注入职责。
- `openspec/designs/modules/agent-platform-gateway-local.md`：更新三个本地 SQLite owner、schema 和生命周期。
- `openspec/designs/modules/agent-platform-gateway-remote.md`：更新远端 reference bindings。
- `openspec/designs/adr/`：无；本 change 的取舍由上述 architecture 文档承载。
- `openspec/designs/spec-to-design-map.md`：新增 capability 到 gateway/configuration/runtime/memory 设计视图的导航。

验证入口：
- gateway contract tests、app composition/config tests、local SQLite transaction/schema-isolation tests、runtime recovery tests、architecture lint、minimal agent kernel regression、`openspec validate --all --strict`。
