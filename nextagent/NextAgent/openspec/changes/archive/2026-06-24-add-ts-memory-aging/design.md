## 背景和现状（Context）

本 change 定义后台 aging lifecycle：定期或受控触发地整理长期记忆质量，避免过期知识、低置信度知识和长期未访问知识无限保留。设计方向建立在 `add-ts-memory-core` 将长期记忆 canonical record、`LongTermMemoryState`、owner scope、agent scope、L1/L2 检索、time-range archived visibility、`ListLongTermMemoryQuery` lifecycle filters、retained ARCHIVED detail access、`getLongTermMemoryDetail` accessCount side effect 和 failure degradation 提升为稳定基线之后。

当前代码库尚未满足这些前置条件：稳定基线没有 `openspec/specs/core/spec.md` 或 `openspec/specs/memory-aging/spec.md`；`agent-common` 尚未暴露 `LongTermMemoryState`；`agent-contracts/gateway` 尚未暴露 `LongTermMemory*` Record/Request/port 与 lifecycle mutation contract；`agent-platform-gateway-local` 尚未实现 memory store/retriever；`agent-memory` 仍是 skeleton；app config schema 尚未注册 `nextAgent.memory.*`。因此本 design 当前是待前置依赖满足后的实施设计，不代表代码已实现或可归档。

需要继承的约束：

- 架构约束：`agent-runtime` 拥有 request lifecycle、scheduler lane、terminal commit 和 canonical timeline；local backend 下 memory lifecycle 归 `agent-memory` 所属边界；remote complete-service backend 下 memory lifecycle 归远端长期记忆服务；`agent-context-engine` 不拥有记忆老化；`agent-channel-web` 只做 transport/projection。
- 契约约束：owner scope 使用可信 `IdentityContext.tenantId` 和 `subjectId`；agent scope 来自可信 app composition 或已持久化 session/run；跨边界失败使用 `SafeError` 或安全诊断；日志、metric、audit 必须脱敏。
- Core 约束：长期记忆生命周期通过 `LongTermMemoryRecord.state` 管理，不引入物理归档表；aging scan 必须通过 `listLongTermMemory` 的 `stateFilter`、`isPinned`、`maxLastAccessedAt`、`maxArchivedAt` public filters 表达；staleness 判断直接使用 `lastAccessedAt`，该字段由 L2 `getLongTermMemoryDetail` 成功访问维护。`accessCount` 是 ranking 或后续 retention refinement 可用的兴趣信号，本 change 不把它作为 decay 判定条件。
- Roadmap 约束：本 change 是否纳入当前 release 需要重新确认。只有 `add-ts-memory-core`、`add-ts-memory-configuration` 和 L2 detail access boundary 已实施验证后，aging 才可直接消费其 lifecycle mutation 方法。

一致性审视结论：

- 与 `establish-ts-backend-architecture` 一致：aging 是 memory lifecycle 后台能力，不修改 runtime lifecycle、channel projection、context assembly 或 capability invocation。
- 与 `establish-ts-core-contracts` 一致：不新增 `OwnerScope` DTO，不自创跨模块基础类型，不通过 private path、数据库 schema 或 provider SDK 建立契约。
- 与 `add-ts-memory-core` 的目标策略一致：采用单表 `LongTermMemoryState` lifecycle，不定义物理 archive record。当前设计要求 core 先提供 `transitionLongTermMemoryState`、`adjustLongTermMemoryConfidence`、`markLongTermMemoryAccessed` 等 lifecycle mutation 方法；aging 只能在这些 public boundary 存在后直接调用。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 定义 memory aging 的后台触发、owner-scoped 扫描、同进程 running-window 防重和 cycle diagnostic。
- 定义 `ACTIVE -> ARCHIVED` 和 `ARCHIVED -> ACTIVE` revival 的唯一 retained 状态机，并定义 `ARCHIVED` retention physical delete。
- 定义 decay、archive、delete、revival 的判断顺序和副作用。
- 定义 timeout、batch limit、partial completion、core unavailable、storage failure 和 cancellation 的降级语义。
- 定义安全日志、metric、audit 和 redaction 边界。
- 定义 runtime、context、channel、capability 与 memory aging 的架构隔离。

**非目标：**

- 不定义具体代码实现、数据库表、索引、SQL、driver 或文件布局。
- 不定义模型可调用 memory tools。
- 不定义自动提取算法或跨会话事实合并策略。
- 不定义 REST/Web 管理 API 或知识共享。
- 配置 namespace 由 `add-ts-memory-configuration` 的命名空间扩展规则注册；本 change 消费 `nextAgent.memory.aging.*` 字段（`enabled`、`schedule`、`decayStaleDays`、`archiveRetentionDays`、`decayFactor`、`batchLimit`、`timeoutMs`、`reviveConfidenceBoost`），不得在 app config schema 中私自绕过配置 owner。
- 不修改 context assembly、system prompt、active context 或 request terminal commit。

## 第一性原则与 KISS 审视

第一性原则：长期记忆 aging 不是“另一个存储系统”或“模型工具的后台调用”，而是“对已持久化、可追溯、同 owner/agent scope 的长期记忆事实做最小必要质量治理”。它只回答三个问题：哪些 ACTIVE 记忆值得提升，哪些 ACTIVE 记忆应降低置信度或归档，哪些 ARCHIVED 记忆应物理删除或在明确 L2 访问时复活。

业务边界：

- 只处理已进入 memory core 的 canonical memory records。
- 只服务电信网络诊断、客户环境约束、网络能力治理和运维流程记忆的长期质量。
- 只在 trusted owner scope 和 agent scope 内扫描与更新。
- 不参与当前请求回答质量，不改变 terminal commit，不改变 context assembly。
- 不拥有 memory extraction、memory tools、maintenance API、sharing 或配置 namespace。

黑盒效果：

- 默认配置下 aging 不会修改任何记忆，只产生 skipped 诊断。
- 启用后，后台 cycle 会在低峰/受控触发时整理长期记忆，输出 decayed/archived/deleted 计数。
- 用户普通检索不会因为命中 ARCHIVED 记忆而批量复活旧知识；只有明确 L2 detail access 才复活。
- aging 失败、超时、取消或部分成功都表现为可诊断结果，不影响主请求和普通 memory read/write。

核心业务实现逻辑：

1. 从 trusted app composition 和 memory configuration 读取已验证配置；disabled 时直接输出 skipped。
2. 为每个 trusted owner/agent scope 建立 aging partition；scope 缺失或不一致时拒绝扫描。
3. 通过 `gateway port` 分页读取候选 records；对每条 record 做 owner/agent scope 二次校验。
4. 按 decay → delete 的顺序应用确定性规则。
5. 对每个状态/置信度更新调用 `gateway port` 的 `transitionLongTermMemoryState`、`adjustLongTermMemoryConfidence`。
6. L1 retrieval 命中只说明候选可能相关；L2 detail access 才表示用户明确查看具体知识。L2 detail access 对 ARCHIVED record 触发 revival，并应用 bounded confidence boost。
7. 汇总 cycle result、safe diagnostics、可用 metrics 和可选 audit；所有失败路径显式暴露为安全 reason code。

KISS 结论：当前设计满足 KISS，前提是保持单一 canonical memory record、单一 memory core public boundary、默认关闭、固定 cycle 顺序、`lastAccessedAt` 驱动 staleness、L2 access 驱动 revival，以及不引入物理归档表、第二套状态机、durable aging cycle 表或模型工具调用链。任何把 aging 扩展为存储迁移、模型推理、上下文自动注入、跨重启 cycle 幂等或 Web 管理面的设计，都应拆到其他 change。

## 设计决策（Decisions）

### 决策 1：local backend 的 aging coordinator 属于 `agent-memory` lifecycle boundary

选定路径：local backend 在 memory owning boundary 内定义 aging coordinator。它消费 trusted app composition、memory configuration 和 `gateway port`，输出 `MemoryAgingCycleResult` 诊断、audit 和 metrics。remote complete-service backend 下，该 coordinator 不启动，aging lifecycle 由远端长期记忆服务拥有。

放弃路径：
- 不让 runtime 执行 aging 判断，避免 runtime 拥有 memory lifecycle。
- 不让 context 自动使用 aging 结果，避免 prompt assembly 被后台生命周期影响。
- 不通过 model-facing memory tools 写入，避免后台维护伪装成模型工具调用。

### 决策 2：保留状态转换只使用 core `LongTermMemoryState`

选定路径：`ACTIVE`、`ARCHIVED` 是同一 canonical memory record 的 retained lifecycle state。aging 通过 memory core public boundary 更新 state、confidence、archivedAt、archiveReason、lastAccessedAt 和 updatedAt；retention delete 通过 `deleteLongTermMemory` 物理删除记录，不引入 `DELETED` soft-delete state。

放弃路径：
- 不定义物理 archive table 或独立 archive entry。
- 不定义跨表移动语义。
- 不在 aging 内部复制 memory record schema。
- 不定义 `DELETED` retained state。

### 决策 3：cycle 顺序固定为 decay → delete

选定路径：每次 schedule 触发产生一个 cycle，按固定顺序处理。decay 先执行——降低长期未访问 ACTIVE 记录的 confidence，当 confidence 降到 0 时直接归档；delete 再删除已过期 ARCHIVED 记录。

放弃路径：
- 不让实现自由选择顺序，避免同一条记录在不同实现中产生不同生命周期结果。
- 不把 revival 放进 schedule 批处理；revival 由 owner-authorized L2 detail access 触发。

### 决策 4：decay 和 auto-archive 合并为单次扫描

选定路径：`WHERE state='ACTIVE' AND isPinned=false AND lastAccessedAt <= now - decayStaleDays` 一次扫描覆盖两类操作。`confidence - decayFactor > 0` 时只降 confidence；`confidence - decayFactor <= 0` 时直接归档（`transitionLongTermMemoryState(targetState=ARCHIVED)`）。不复用旧 sequential 方式分别扫描。

实现约束：candidate scan MUST 通过 core `listLongTermMemory({ stateFilter: "ACTIVE", isPinned: false, maxLastAccessedAt })` 表达，不得直接访问 gateway-local SQLite/FTS5 私有实现。

放弃路径：
- 不先 decay 再单独 archive 扫描同一批记录。
- 不单独为 archive 设立 activeDays 阈值——archive 由 confidence 降到 0 驱动。

### 决策 5：time-range L1 hit 不自动 revival

选定路径：ARCHIVED record 不会因为 L1 retrieval 命中而复活；L1 命中范围较广，只能证明候选可能相关。只有同 owner scope 明确执行 L2 detail access 时，系统才认为用户正在查看具体知识并允许复活。复活时 confidence bounded boost，默认 `+0.1` 且 clamp 到 `1.0`。

实现约束：expired archived scan MUST 通过 core `listLongTermMemory({ stateFilter: "ARCHIVED", isPinned: false, maxArchivedAt })` 表达；revival helper MUST 先通过 core `getLongTermMemoryDetail` 读取同 scope retained ARCHIVED record，再由 aging lifecycle owner 调用 state/confidence mutation。core detail 读取本身不执行 revival。

**App composition 接线（前置依赖满足后实施）：** local backend 下，`agent-memory` MAY 提供 `getLongTermMemoryDetailWithAging` 或等价函数，作为 owner-authorized L2 detail access 的编排 helper：先调用 core `LongTermMemoryRetrieverGateway.getLongTermMemoryDetail`，再在允许条件下通过 store lifecycle boundary 执行 revival。该 helper 不替代、不扩展 `LongTermMemoryRetrieverGateway` contract，也不作为 gateway port 暴露。首条产品接线固定为 `add-ts-memory-tools` 的 `get_memory_detail` application path：只有当 memory tools detail boundary 已经存在并由 `agent-app` 注入 trusted tenantId、subjectId 和 agentId 时，`agent-app` composition 才能把该 helper 接入该 path。disabled 或 remote complete-service backend 时直接使用 selected backend 的 gateway/retriever path，不执行本地 revival helper。aging scheduler 和后续 maintenance explicit restore 不受此接线影响；若后续 maintenance detail API 存在，必须复用同一个 helper，不得成为当前 change 的并行入口。

放弃路径：
- 不在 time-range search L1 命中时批量复活，避免一次历史检索把大量旧知识重新拉回 ACTIVE。
- 不复活已物理删除的 record。

### 决策 6：默认关闭，配置由 memory configuration 提供

选定路径：aging 默认 disabled；启用、schedule 和数值阈值由 `nextAgent.memory.aging.*` 配置命名空间提供 runtime schema validation。aging 只消费已验证配置快照；配置 schema 的注册和冻结归 memory configuration boundary。

放弃路径：
- 不在本 change 自创配置 namespace。
- 不允许配置覆盖 trusted identity、agent scope 或 owner scope。

### 决策 7：失败显式诊断，部分成功可保留

选定路径：每个 cycle 有 status：`SKIPPED`、`COMPLETED`、`PARTIAL`、`FAILED`。单条 record 更新失败计入 failureCount；timeout/cancellation 停止未开始工作；已完成的安全更新保留并计数。同一进程内，同一 owner scope、trigger identity 和 schedule window 已有 cycle running 时，重复 trigger 返回 `MEMORY_AGING_ALREADY_RUNNING` 或等价 skipped diagnostic。本 change 不定义 durable cycle anchor fact，不承诺跨进程或跨重启幂等。

放弃路径：
- 不要求 aging cycle 全局事务包裹所有 records，避免大批量维护失败导致全部回滚。
- 不静默吞错或把不可用伪装成空成功。
- 不新增 aging cycle persistence table；如需跨重启 durable idempotency，必须由独立 change 定义锚点事实。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | owner scope 和 agent scope 只来自 trusted boundary；每条候选 record 二次校验；客户端/模型/capability metadata 不可覆盖 scope；audit/log/metric 不含 memory content、路径、token、raw error。 | Security tests、redaction assertions、owner/agent isolation negative tests |
| 性能/容量 | 默认关闭；启用后受 schedule、batchLimit=1000、timeoutMs=30000、分页扫描和 cancellation 约束；L1 命中不自动复活，避免批量膨胀。 | Contract/config tests、capacity boundary tests、timeout tests |
| 可靠性/恢复 | 后台异步执行，不影响 request terminal state；同进程 running-window 防重；partial result 显式记录；单条冲突不隐藏。 | Resilience tests、integration tests、idempotency tests |
| 可维护性 | aging 集中在 memory lifecycle boundary；状态机和判断顺序在 spec/design 固化；不复制 core record schema、不建第二套 storage contract。 | Architecture checks、module boundary tests、code review checkpoints |
| 可测试性 | coordinator、candidate query、transition evaluator、update boundary、diagnostic mapper 都有稳定输入输出；可用 memory core 测试替身验证。 | Unit tests、contract tests、integration tests |
| 审计/可追溯性 | structured diagnostic 必须可追踪 lifecycle 变化；通过现有 audit/observability event path 输出 metric 或 audit event。所有输出只包含 safe reason code 和 entry ref，不暴露原文。 | Observability tests、audit tests、trace assertions |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| core 提供 transitionState/adjustConfidence/markAccessed | T0、T1、T4 | OpenSpec gate、contract tests |
| core 支持 memory record/query 的 agent scope 校验 | T0、T3 | OpenSpec gate、security tests |
| aging 不进入 request terminal commit | T2、T8 | Integration/resilience tests |
| disabled 时显式 skipped | T1、T8 | Contract/resilience tests |
| owner/agent scope 扫描隔离 | T3、T10 | Security/architecture tests |
| 单表 `LongTermMemoryState` lifecycle | T4、T10 | Contract/integration tests |
| pinned 豁免自动 archive/delete/decay | T4、T6 | Integration/unit tests |
| decay 使用 L2 detail 维护的 `lastAccessedAt` 作为 stale 输入；`accessCount` 不作为本 change 判定条件 | T5 | Unit/integration tests |
| decay clamp 到 `[0, 1]` | T6 | Unit/contract tests |
| L1 time-range hit 不复活，L2 access 才复活 | T7 | Integration tests |
| cycle 顺序、batchLimit、timeout | T8 | Resilience/capacity tests |
| failure/partial/cancel 显式诊断 | T8、T9 | Resilience/observability tests |
| runtime/context/capability 不拥有 aging | T10 | Architecture boundary tests |
| OpenSpec strict validation | T11 | `openspec.cmd validate add-ts-memory-aging --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/memory-aging/spec.md` 主承载 trigger、scope、state transitions、decay、revival、failure、observability 和 architecture boundary 的可验证行为。
- 跨模块架构：`openspec/designs/architecture/memory.md` 主承载 aging flow、runtime/context/channel/capability 边界、owner scope、安全和可观测设计。
- 领域模型/状态机：`openspec/designs/domain/memory.md` 主承载 `LongTermMemoryState` lifecycle、transition reason、cycle diagnostic、pinned exemption、revival 语义。
- API/SPI/event/schema：`openspec/designs/contracts/memory.md` 主承载 aging 对 memory core public boundary 的消费语义和诊断结果契约；不定义 Web API。
- 模块职责：`openspec/designs/modules/agent-memory.md` 记录 local backend 的 aging coordinator、transition evaluator、diagnostic mapper 职责和非职责；remote complete-service backend 下由远端长期记忆服务承载 aging lifecycle，本地不启动 aging coordinator。
- ADR：`openspec/designs/adr/memory-aging-state-lifecycle.md` 主承载采用 core `LongTermMemoryState`、不建物理归档表、L2 detail 驱动 decay/revival、默认关闭的长期取舍。
- 导航：`openspec/designs/spec-to-design-map.md` 增加 `memory-aging` 导航。

## 风险与取舍（Risks / Trade-offs）

- [core public boundary 不足以表达安全 state update] -> 不绕过 core；先做 contract refinement。
- [后台 cycle 处理过多记录影响容量] -> 默认关闭、batchLimit、timeout、分页扫描、低峰 schedule。
- [复活过度导致旧知识回流] -> L1 time-range hit 不复活，只有 owner-authorized L2 access 复活。
- [decay 提升误判] -> 只认 L2 `getLongTermMemoryDetail` durable access，不认普通 search。
- [pinned 造成长期保留膨胀] -> pinned 豁免 automatic lifecycle，但 pin limit 和用户维护属于 maintenance/configuration 边界，不在本 change 重新定义。
- [partial failure 难以理解] -> cycle result 保留 status、reason code 和计数，维护面可消费诊断。
- [重复 trigger 语义被误解为 durable 幂等] -> 首版只做同进程 running-window 防重；不引入 aging cycle anchor table。
- [archive reason 与 diagnostic reason 混淆] -> `archiveReason` 只记录 canonical retained state transition reason，例如 `confidence_decayed`；`retention_expired` 是 delete diagnostic reason，不写入 retained archived record。

## 迁移计划（Migration Plan）

无数据迁移计划。本 change 不定义物理 schema 迁移，也不从其他存储模型迁移数据。发布策略为默认 disabled：完成实施后，未显式启用配置时只产生 skipped 诊断，不修改 memory records。若启用后需要回滚，可关闭 aging 配置；已完成的 state/confidence 更新属于 canonical memory lifecycle 事实，不由本 change 定义自动回滚。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/memory-aging/spec.md`：提炼可验证行为契约。
- `openspec/overview.md`：补充长期记忆质量治理、后台老化和主请求隔离的长期背景。
- `openspec/designs/architecture/memory.md`：提炼 aging flow、owner/agent scope、安全、可观测和模块边界。
- `openspec/designs/domain/memory.md`：提炼 lifecycle state、decay/revival 语义、cycle diagnostic 和 pinned exemption。
- `openspec/designs/contracts/memory.md`：提炼 aging 对 memory core boundary 和 diagnostics 的消费契约；如长期基线已有更合适 contract 文档，则只做导航摘要。
- `openspec/designs/modules/agent-memory.md`：提炼 local backend 的 memory aging coordinator 职责，并记录 remote complete-service backend 下本地 coordinator 禁用边界。
- `openspec/designs/modules/agent-runtime.md`：补充 runtime 不拥有 aging 的边界引用。
- `openspec/designs/adr/memory-aging-state-lifecycle.md`：记录核心取舍。
- `openspec/designs/spec-to-design-map.md`：补充导航和验证入口。

## 待确认问题（Open Questions）

- 当前 release 是否重新纳入长期记忆产品能力及其后置 aging lifecycle。
- memory core 是否作为独立 change 先实施并验证，还是需要先拆分 contract refinement。
- aging 不注入独立 audit writer；只要求通过现有 observability path 或可选 audit projection 产生 safe diagnostic、metric 或 structured observable event。

