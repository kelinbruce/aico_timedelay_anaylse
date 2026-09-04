## 背景与问题（Why）

`add-ts-memory-core` 负责定义 `LongTermMemoryRecord`、`LongTermMemoryState`、检索/写入端口、owner scope 隔离、L1/L2 渐进披露、`accessCount` 语义和存储降级行为。在这些 core 边界落地后，自动提取和模型工具可以让系统写入长期记忆；如果没有受控的老化和策展机制，长期记忆会逐步积累低价值、过期、长期未访问或置信度不足的知识，影响电信网络排障、网络能力治理、客户环境约束复用和运维诊断的可靠性。

当前需要把“记忆老化”收敛为 memory lifecycle boundary 内的后台能力：它只处理已经由 memory core 持久化的 owner-scoped memory record，通过可信配置和后台调度执行 decay、confidence decay、ACTIVE/ARCHIVED 状态转换、retention physical delete、归档复活和安全诊断。该能力不得进入 request terminal commit 必经路径，不得改写 runtime lifecycle，不得让 channel、context 或 capability 工具拥有 lifecycle state machine，也不得绕过 `add-ts-memory-core` 定义的 owner scope、SafeError、单表 `state` 和 public memory boundary。

## 变更范围（What Changes）

- 新增 `memory-aging` capability，定义长期记忆条目的后台生命周期老化、decay、confidence decay、归档复活、调度、诊断、审计和指标语义。
- 规定 aging 通过 public `gateway port` 消费 core 的 lifecycle mutation 方法（`transitionLongTermMemoryState`、`adjustLongTermMemoryConfidence`），不得绕过到 gateway-local private path、SQLite row 或 storage driver。
- 规定生命周期状态通过 core 的 `LongTermMemoryState` 字段管理：`ACTIVE -> ARCHIVED -> ACTIVE`；retention delete 通过 core `deleteLongTermMemory` 物理删除记录。本 change 不定义物理归档表。
- 规定 aging job 是后台异步 lifecycle 操作，不参与 request terminal commit，不阻塞用户请求。
- 规定调度来源包括配置驱动的后台 schedule（`nextAgent.memory.aging.schedule`）或受控管理触发；默认关闭。`enabled=false` 时所有 trigger 跳过；`enabled=true` 且 `schedule` 未设置时不启动后台 scheduler，但允许受控管理/测试 trigger；`enabled=true` 且 `schedule` 设置时才启动本地后台 scheduler。
- 规定 aging 的 cycle 顺序为 decay → delete。decay 处理长期未访问的 ACTIVE 记录——降 confidence，降为零时自动归档。delete 删除过期 ARCHIVED 记录。revival 由 `getLongTermMemoryDetail` 访问 ARCHIVED 记录时单条触发，不在 schedule 中批量执行。
- 规定 aging 不定义自动提取算法、模型可调用 memory tools、REST/Web 管理 API、知识共享、context 自动注入、配置 namespace 或存储实现细节。
- 不包含 BREAKING 变更；本 change 依赖 `add-ts-memory-core`，并与 `add-ts-memory-configuration`、`add-ts-memory-extraction`、`add-ts-memory-tools`、`add-ts-memory-maintenance` 保持职责分离。

## Capability 影响（Capabilities）

### 新增 Capability

- `memory-aging`: 定义长期记忆后台老化 lifecycle，包括 owner-scoped 调度触发、decay、confidence decay、ACTIVE/ARCHIVED 状态转换、retention physical delete、归档复活、失败降级、审计和指标。

### 修改的 Capability

无。

## 交付状态与前置门禁

当前 change 的业务方向仍然有效，但已同步到当前代码库后，实施状态必须重新校正：本 change 不能按已完成或可直接归档处理。当前稳定基线仍将“长期记忆产品能力”列为范围外，`openspec/specs/core/spec.md`、`openspec/specs/memory-aging/spec.md` 尚未归档，`agent-common` 尚未暴露 `LongTermMemoryState`，`agent-contracts/gateway` 尚未暴露 `LongTermMemory*` Record/Request/port 与 lifecycle mutation 契约，`agent-platform-gateway-local` 尚未提供 memory store，`agent-memory` 当前仍是 skeleton。因此 memory aging 目前是 blocked-by-prerequisite change；只有前置 memory core/config/tools 边界落地后，才能进入代码实施。

实施前必须满足以下门禁：

- `add-ts-memory-core` 必须先在当前代码基线完成实施和验证，且可消费 surface 必须包含 `LongTermMemoryRecord`、`LongTermMemoryState`、`LongTermMemoryStoreGateway`、`LongTermMemoryRetrieverGateway`、owner scope、agent scope、SafeError、L1/L2 检索、time-range archived visibility、`ListLongTermMemoryQuery` 的 `stateFilter` / `isPinned` / `maxLastAccessedAt` / `maxArchivedAt` lifecycle filters、`getLongTermMemoryDetail` 对 retained ARCHIVED record 的授权读取和 accessCount increment、storage degradation。归档顺序按 OpenSpec release 流程处理，不替代源码/测试核验。
- `add-ts-memory-core` 必须提供 lifecycle mutation boundary（`transitionLongTermMemoryState`、`adjustLongTermMemoryConfidence`、`markLongTermMemoryAccessed`），aging 只能通过这些 public gateway contract 消费，不得绕过到 gateway-local private path 或数据库 schema。
- `add-ts-memory-core` 必须满足主路径 Agent Scope 要求（三元 scope：`tenantId`、`subjectId`、`agentId`）。
- `add-ts-memory-configuration` 必须先提供 aging 所需配置的 runtime schema validation、默认值、冻结快照和启停边界；本 change 不自创配置 namespace。
- `add-ts-memory-tools` 必须先提供模型工具 `get_memory_detail` 这条 owner-authorized L2 detail access boundary；revival-on-access 的 app composition 接线只能挂到该路径之后实施。后续 maintenance detail API 若存在，只能复用本 change 定义的 revival helper，不作为当前 change 的并行前置路径。
- 当前 app composition 必须选择 local memory backend。若选择 remote complete-service memory backend，aging lifecycle 由远端服务拥有，本地 aging coordinator、scheduler 和 revival helper MUST remain disabled，除非后续 remote adapter owning change 明确只做薄适配。
- 当前 release scope 必须重新确认纳入 Long-term memory 后置扩展实施，或单独批准启动 memory aging 实施。
- 如果 `add-ts-memory-core` 的 public memory boundary 无法表达 state/confidence/archivedAt/archiveReason 更新需求，或无法用 `listLongTermMemory` public filters 找到 stale ACTIVE / expired ARCHIVED records，不得在本 change 中修改 core 或私查底层数据库，必须先提出独立 contract refinement change。

## 影响范围（Impact）

- Memory 边界：local backend 新增 lifecycle aging coordination、candidate selection、state transition、confidence adjustment、revival 和 cycle diagnostic 的目标能力；只通过 memory core public boundary 操作 canonical memory record。remote complete-service backend 下，本地不执行 aging lifecycle。
- Runtime：不执行 aging 语义；只需要保证 aging 不进入 request lifecycle、scheduler lane、terminal commit 或 canonical timeline ownership。
- Context：不修改 context assembly；aging 结果不得自动注入 system prompt、active context 或 selected refs。
- Capability：不通过 `add_memory`、`update_memory`、`forget_memory` 或其他模型工具执行后台 lifecycle；aging 不是 model tool invocation。
- Channel/Web：本 change 不定义用户可见 REST/Web 管理 API；若后续 maintenance change 暴露手动触发或查看结果，只消费本 change 的安全诊断和 public contract。
- Configuration：消费由 memory configuration boundary 注册并校验的 `nextAgent.memory.aging.*` 配置字段；本 change 不在 app config schema 中私自增加未归属配置。所有配置必须运行时 schema validation。
- Observability/Audit：新增 aging cycle started/completed/partial/failed、entry decayed/archived/deleted/revived、安全拒绝和降级事件；通过现有 audit/observability event path 输出 structured diagnostic、metric 或 audit event；日志、metric、audit 不得包含 memory content、prompt、模型输出、附件内容、raw provider error、路径、credential、token 或高基数字段。
- 测试：需要 contract、integration、security、resilience、observability、architecture boundary 和 negative case 验证。

## 一致性审视

- 与 `establish-ts-backend-architecture` 一致：aging 位于 memory lifecycle boundary；`agent-runtime` 仍拥有 request lifecycle、scheduler、terminal commit 和 canonical timeline；`agent-context-engine` 不拥有 memory lifecycle；`agent-channel-web` 只做 transport/projection；`agent-app` 作为 composition root 负责装配。
- 与 `establish-ts-core-contracts` 一致：owner scope 只来自 trusted identity；不新增统一 `OwnerScope` DTO；跨边界失败使用 SafeError 或安全诊断；公共类型归 `agent-contracts/gateway` 和 `agent-common` 所属边界；实现不得通过 private path、DB schema 或 provider SDK 建立跨模块契约。
- 与 `add-ts-memory-core` 一致：本 change 采用单一 logical memory table + `LongTermMemoryState` 字段管理 retained records；`ACTIVE/ARCHIVED` 是唯一保留状态，retention delete 通过 core `deleteLongTermMemory` 物理删除记录，不定义物理归档表、`DELETED` retained state 或跨表搬迁；staleness 以 `getLongTermMemoryDetail` 维护的 `lastAccessedAt` 为 decay 输入，`accessCount` 不作为本 change 的 decay 判定条件。
- 当前未发现与 `establish-ts-backend-architecture` 或 `establish-ts-core-contracts` 的目标冲突。与当前代码基线的依赖检查发现实施前必须关闭的 gap：第一，稳定基线尚未包含 memory core 规格；第二，`agent-contracts/gateway` 尚未暴露 memory record/query/lifecycle mutation contract；第三，gateway-local 尚未实现 memory store/retriever；第四，app configuration 尚未注册 `nextAgent.memory.*`；第五，memory tools/detail access 接线尚不存在。以上 gap 都不得在本 change 中绕过，必须由前置 change 或独立 contract refinement 先补齐。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/memory-aging/spec.md`：新增长期记忆后台 aging lifecycle 的稳定行为契约。

长期背景：
- `openspec/overview.md`：补充长期记忆质量治理、后台老化和请求终态隔离的用户价值与边界。

设计视图：
- `openspec/designs/architecture/memory.md`：补充 memory aging 的后台 flow、owner scope 扫描、runtime/context/capability 边界、失败降级、审计和指标。
- `openspec/designs/domain/memory.md`：补充 `LongTermMemoryState` lifecycle、decay/decay/revival 语义、cycle diagnostic 状态和安全限制；不重复定义 core record schema。
- `openspec/designs/contracts/memory.md`：补充 aging 对 memory core public boundary 的最小消费语义；若已有 memory contract 文档承载相同事实，则只增加导航摘要。
- `openspec/designs/modules/agent-memory.md`：补充 memory boundary 对 aging coordination、state transition 和 confidence adjustment 的职责与非职责。
- `openspec/designs/modules/agent-runtime.md`：补充 runtime 不拥有 memory aging、aging 不进入 terminal commit 的模块边界；如已有文档承载该边界，则只增加引用。
- `openspec/designs/adr/memory-aging-state-lifecycle.md`：记录采用 core `LongTermMemoryState` 单表 lifecycle、默认关闭、L2 detail 访问驱动 decay、L2 访问驱动 revival 的长期技术决策。
- `openspec/designs/spec-to-design-map.md`：新增 `memory-aging` 到相关 architecture/domain/contracts/modules/ADR 的导航。

验证入口：
- Contract tests：配置默认值和范围、cycle diagnostic schema、state transition request/result、confidence clamp、SafeError/diagnostic 形态。
- Integration tests：schedule trigger、manual safe trigger、ACTIVE->ARCHIVED、ARCHIVED physical delete、ARCHIVED->ACTIVE revival、decay、pinned exemption、core disabled/storage unavailable。
- Security tests：owner scope 扫描不可跨 tenant/subject，配置和请求体不可覆盖 identity，audit/log/metric 不含 raw memory content。
- Resilience tests：timeout、cancellation、partial failure、同进程重复 trigger 防重、aging failure 不改变 RequestRun terminal state。
- Observability tests：structured logs、metrics、audit 只含安全计数、reason code、duration、cycle id 和低基数字段。
- Architecture tests：runtime、context、channel、capability 不导入 aging implementation，不拥有 lifecycle decision；aging implementation 不通过 memory tools 或 private persistence path 写入。

