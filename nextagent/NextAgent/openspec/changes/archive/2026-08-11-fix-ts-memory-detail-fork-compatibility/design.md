## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-8.2 检索和写入记忆` | L2 详情保留完整业务内容；来源从 `structuredPayload` 移到模型隐藏的 Capability metadata，使模型结果可复制而本地 `toolOutput` 仍可一步追溯 | `memory-tools` | `FN-8.2 检索和写入记忆` |
| `FN-5.2 调用能力` | 通用模型可见 Capability result 投影剔除顶层 `metadata.sourceTrace`，不解析 Tool 业务 payload，也不按 Tool 名称分支 | `capability-catalog` | `FN-5.2 调用能力` |

## `FN-8.2 检索和写入记忆`

### 目标与规范依据

本设计收窄 `get_memory_detail` 的模型可见成功结果，同时保持记忆详情读取、逐条错误、公共 Capability result 容量、访问副作用和内部来源完整性。会话分支继续按既有通用规则判断消息是否包含不安全执行期引用；`agent-memory` 不再把 retained source 投影为模型可见业务结果，而是把它放入既有结果 metadata 供本地 canonical `toolOutput` 使用。

#### 本 Function 的目标 Requirements

canonical spec：`memory-tools`

- `MODIFIED`：`get_memory_detail L2 retrieval`

### 当前实现

`packages/agent-memory/src/memory-tools.ts` 由 `agent-memory` 声明并执行 canonical `memory-tools/get_memory_detail`。工具通过 `LongTermMemoryToolPort.getLongTermMemoryDetail` 获得 `LongTermMemoryRecord`，随后由 `projectDetailEntry` 把 Gateway record 投影为 structured result。

当前 `detailEntrySchema` 同时把 `sourceTrace` 列为 required property 和允许 property。`projectDetailEntry` 使用 `parseMemoryContent(record.content)` 形成 category-specific `content`，又使用 `parseMemorySource(record.source)` 形成顶层 `sourceTrace`。因此本地或远端 Gateway 只要返回相同 canonical record，都会经过同一模型可见投影。

成功 Capability result 随后分为两个既有消费面：`buildModelVisibleCapabilityPayload` 形成后续模型轮次和 durable `CAPABILITY_RESULT` 使用的 payload；`runtimeToolOutputLogFields` 形成仅进入本地 runtime direct diagnostic 的 canonical `toolOutput`。实时 `CAPABILITY_RESULT_DELTA` 和 `AFTER_CAPABILITY_RESULT` Hook 只消费 `structuredPayload`。当前 `modelVisibleCapabilityMetadata` 已剔除顶层 `metadata.toolDiagnostics`，证明通用模型隐藏 metadata 边界已存在；但尚未剔除 `metadata.sourceTrace`。当前一方 Hook、前端组件和回复记忆披露逻辑没有读取 `sourceTrace`；回复记忆披露只读取成功详情中的 `longTermMemoryId`、`category` 和 `content`。

`packages/agent-runtime/src/lifecycle/submit.ts` 的会话分支路径会收集待复制消息前缀中的全部 source run IDs，并对每条复制内容执行通用 source-run 引用检查。若 `sourceTrace.runId` 等于该前缀中的 run ID，分支在 composite write 前以 `SESSION_FORK_SOURCE_RUN_REF` 失败；失败路径会撤销 staged promotions，且不创建子会话。该检查没有 Tool 名称特例。

长期记忆内部来源由 `LongTermMemoryRecord.source` 和本地持久化的 `source_trace_json` 承载。记忆提取、来源校验和多来源融合继续使用 `parseMemorySource`；访问计数、`lastAccessedAt` 和 archived memory revival 在模型可见投影前完成。owner+agent scoped 的长期记忆 management record/detail 查询继续通过 `LongTermMemoryManagementPort` 返回 retained `source`，该授权管理面与模型可见 Capability 结果相互独立。统一 Capability 执行边界已对规范化 `CapabilityInvocationResult` 整体实施公共单结果容量校验，因此 `structuredPayload` 和 metadata 共同计入容量；memory tool 不再拥有专用超限失败码。现有 memory tool provider 测试断言 L2 `content`，但没有断言 `sourceTrace` 不可见；当前主分支的 session fork 测试没有把 canonical `get_memory_detail` 新结果接入成功分支场景。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 成功 `entry` 不包含 retained source 或内部来源坐标 | output schema 要求 `sourceTrace`，投影也实际返回该对象 | 声明契约和实际投影都需要原子收窄 |
| 完整 category-specific `content` 保持可用 | `projectDetailEntry` 已独立解析 `record.content` | 需要用回归测试证明删除来源投影不会误删或截断业务内容 |
| 内部来源、读取副作用和一步式本地诊断保持不变 | retained source、提取融合和访问副作用位于模型可见投影之外；canonical `toolOutput` 可记录完整 Capability result | 需要把来源移入模型隐藏 metadata，并用边界测试证明本地日志保留而 outward surfaces 排除 |
| 内部来源不能绕过公共结果容量 | 统一 Capability 执行边界校验包含 `structuredPayload` 和 metadata 的完整结果 envelope | 需要证明来源移入 metadata 后仍计入公共容量，且 memory tool 不恢复专用超限失败码 |
| 新 canonical 结果不再因工具主动携带 source run ID 阻塞分支 | fork 通用检查会正确拒绝当前 `sourceTrace.runId` | 缺少“真实新工具结果可复制”和“历史形态/人为源引用仍 fail-closed”的双向集成证据 |
| 通用 core 不理解 memory payload | `modelVisibleCapabilityMetadata` 已拥有顶层 metadata 过滤，但只过滤 `toolDiagnostics` | 增加 exact-key `sourceTrace` 过滤；不得递归扫描 `structuredPayload` 或增加 Tool 名称特例 |
| 不依赖其他 memory/logging change 独立交付 | 相关 active changes 可能同时触及 `memory-tools.ts`、同名 spec、canonical `toolOutput` 和测试 | 语义可独立，但合并时需要串行整合并重跑共同门禁 |

### 修改方案

唯一实现路径复用既有 Capability result envelope 和模型可见 metadata 投影，不新增 DTO、诊断容器或 Tool 特例：

1. `agent-memory` 从 `detailEntrySchema.required` 和 `detailEntrySchema.properties` 删除 `sourceTrace`。保留 `additionalProperties=false`，使旧字段和任意替代顶层 provenance 字段无法作为合法成功 `structuredPayload` 通过 output validation。
2. `projectDetailEntry` 只投影业务字段。`get_memory_detail` 在读取成功 record 时另行使用 `parseMemorySource(record.source)`，把可解析来源追加到 `CapabilityInvocationResult.metadata.sourceTrace[]`，每项包含 `longTermMemoryId` 和原来源对象。该 metadata 不属于 output schema。
3. 复用统一 Capability 结果 envelope 校验，使 `structuredPayload` 与 `metadata.sourceTrace` 共同计入公共单结果容量；超限由既有通用边界返回 `CAPABILITY_RESULT_LIMIT_EXCEEDED`。memory tool 不返回 `MEMORY_TOOL_RESULT_TOO_LARGE`，也不通过省略或截断来源把超限结果伪装成成功。
4. `agent-core` 只在现有 `modelVisibleCapabilityMetadata` 中增加 `delete visible['sourceTrace']`。该 exact top-level key 规则与 `toolDiagnostics` 同形：不按 Tool 名称分支、不递归扫描 `structuredPayload`、不导入 memory domain 类型，并保留其他安全 metadata。
5. 既有 `runtimeToolOutputLogFields(result)` 继续接收完整 Capability result，因此 canonical `toolOutput` 自然保留业务 payload 和 `metadata.sourceTrace`；现有 writer 继续拥有 credential/auth-token 脱敏与容量边界。模型 payload、durable message 和 live/public projection 使用过滤后的 metadata 或仅使用 `structuredPayload`，因此不获得来源。
6. 不修改 `LongTermMemoryToolPort`、`LongTermMemoryRecord`、Gateway contracts、SQLite schema、memory extraction/fusion、aging、app composition、backend selection、`projectForkSafeContent` 或 `SESSION_FORK_SOURCE_RUN_REF`。集成测试使用 canonical 新工具结果证明安全复制，同时使用历史形态或人为构造的 source run 引用证明通用检查仍在 composite write 前原子拒绝。

该路径把字段构造留给 memory owner，把通用“哪些 Capability metadata 可进入模型”留给 core owner，把原始本地 Tool 诊断留给既有 runtime logging owner。只删除 `runId` 会继续暴露 session、request、message 和 extraction-cycle 内部坐标；在 runtime 按 Tool 名称放行会削弱通用 fail-closed 安全规则；把来源塞入 `metadata.toolDiagnostics` 会违反其固定低基数字段契约；新增 `metadata.localRuntimeDiagnostics` 容器则为单一需求引入平行协议。因此这些方案均不采用。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `get_memory_detail L2 retrieval`；`Capability 内部来源诊断保持模型不可见` | memory owner 从业务 payload 排除来源，core 在既有通用 metadata 投影剔除 exact key，避免内部执行拓扑进入模型、持久化和 public surfaces | output schema、模型输入、durable result 和 public delta 均不含 `sourceTrace`，且业务内容不受影响 |
| 可靠性/恢复 | `get_memory_detail L2 retrieval` 为功能性 Requirement，无新增黑盒质量目标 | producer 生成不含源运行引用的新结果，fork 保留通用 fail-closed 和原子失败语义 | canonical 新结果 fork 成功；历史形态或人为源引用仍失败且不创建子会话 |
| 审计/可追溯性 | `get_memory_detail L2 retrieval`；`Capability 内部来源诊断保持模型不可见` | retained source、来源融合、Gateway storage 和授权 management 查询保持不变；canonical `toolOutput` 通过 metadata 保留 `longTermMemoryId` 与来源的一步式关联 | 同一 Tool 日志可定位 source run；retained record 仍可按授权查询；模型、持久化和 public surfaces 不含来源 |
| 可维护性 | `Capability 内部来源诊断保持模型不可见` | memory owner 构造来源，core 只过滤通用 exact metadata key，runtime logging 复用完整结果；无新容器、无递归 payload scan、无 Tool 特例 | 单元测试证明其他安全 metadata 保留，且 core 不依赖 memory package |
| 可测试性 | 两个目标 Requirements | 用 producer unit、core projection unit 与 runtime integration 分别锁定三条边界 | 同时覆盖正向结果、未知字段拒绝、模型隐藏、本地日志保留、fork 成功和 fail-closed negative case |

## `FN-5.2 调用能力`

### 目标与规范依据

canonical spec：`capability-catalog`

- `ADDED`：`Capability 内部来源诊断保持模型不可见`

### 当前实现

`packages/agent-core/src/tools/capability-result-projection.ts` 是 Capability result 进入后续模型上下文和 durable `CAPABILITY_RESULT` 前的通用投影 owner。`modelVisibleCapabilityMetadata` 已通过复制 metadata 后删除 `toolDiagnostics` 来隔离低基数本地诊断，但其他 key 默认保留。

### GAP 分析

若 memory owner 仅把来源从 `structuredPayload` 移到 `metadata.sourceTrace` 而不更新通用模型投影边界，来源仍会随 `capabilityResult.metadata` 进入模型和持久化消息，fork 问题不会真正解决。现有投影缺少对该内部来源诊断的 exact-key 隔离。

### 修改方案

在同一个 helper 中增加 exact top-level `sourceTrace` 删除，并以单元测试证明：包含该 key 的输入不会把它投影到模型 payload；其他安全 metadata 仍原样保留；`structuredPayload` 不被递归清洗。`runtimeToolOutputLogFields` 不调用模型投影 helper，继续记录原始有效 Capability result，因此无需修改 runtime 或日志 writer。该调整不改变 `CapabilityInvocationResult` contract shape，不增加 package dependency，也不授予 core 解析 memory domain 数据的职责。

## 验证策略（Verification Strategy）

- memory unit 层验证 `get_memory_detail` output schema 与实际 structured result 使用同一个收窄边界：完整业务 `content` 保留，`entry.sourceTrace` 和原始 `source` 不可见，未知顶层字段仍被拒绝；同时原始 Capability result 的 `metadata.sourceTrace` 保留按 `longTermMemoryId` 关联的来源。
- core unit 层验证 `buildModelVisibleCapabilityPayload` 删除顶层 `metadata.sourceTrace` 和既有 `toolDiagnostics`，保留其他安全 metadata，且不递归修改 `structuredPayload`。
- memory runtime integration 验证真实 Gateway record 仍保留内部 `source`，详情读取的访问统计、archived revival 和模型后续轮次消费不回退；本地 canonical `toolOutput` 含来源，而后续模型请求、持久化 Capability Result 和 public result projection 不含来源；management service characterization 验证授权 record/detail 查询仍按 `longTermMemoryId` 返回 retained `source`。
- session fork integration 验证由 canonical 新结果形成的 source prefix 可以创建子会话，并验证历史形态或人为携带 source run ID 的 Capability Result 仍以 `SESSION_FORK_SOURCE_RUN_REF` 原子失败。
- compatibility review 验证回复记忆披露仍只消费 `longTermMemoryId`、`category` 和 `content`，无需依赖本 change；并检查其他 active changes 在共同文件上的合并结果没有恢复 `sourceTrace`。
- architecture review 验证没有新增 `agent-contracts`、Gateway、database、runtime Tool 特例、递归业务 payload 清洗或平行诊断容器。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/memory-tools/spec.md`：归并收窄后的 `get_memory_detail L2 retrieval`，并在 stable spec 的 Requirements 前补入 `FN-8.2 检索和写入记忆` 主规格归属。
- `openspec/designs/functions/D8-数据与记忆/D8.2-记忆/FN-8.2-检索和写入记忆.md`：刷新输出摘要，明确 L2 返回完整业务内容但不返回 retained source 或内部执行来源。
- `openspec/specs/capability-catalog/spec.md`：归并 `Capability 内部来源诊断保持模型不可见`，冻结顶层 `metadata.sourceTrace` 的模型隐藏语义。
- `openspec/designs/functions/D5-Capability能力体系/D5.1-能力治理/FN-5.2-调用能力.md`：补充 Capability result metadata 的模型可见/本地诊断分流摘要。
- Feature：无；本 change 不改变 Feature 组成或长期记忆的用户价值边界。
- `openspec/overview.md`：补充模型可见记忆详情与内部来源隔离、从而保持通用会话复制安全的长期不变量。
- `openspec/designs/architecture/core-contracts.md`：归并 memory retained source、模型隐藏 Capability metadata 与模型可见 Capability Result 的边界，以及通用 fork guard 不按 Tool 放行的约束。
- `openspec/designs/architecture/ts-backend-architecture.md`：无；package owner 和依赖方向不变。
- `openspec/designs/modules/agent-memory.md`：归并 `get_memory_detail` outward projection 不暴露 retained source 的模块职责和验证入口。
- `openspec/designs/modules/agent-core.md`：若归档时现有章节已描述模型可见 Capability result 投影，则补充 exact-key internal metadata 过滤边界；否则由 core contracts 导航承载，不新建平行章节。
- 其他 module 文档：无；runtime、channel 和 frontend 实现边界不变。
- ADR：无；本 change 沿用现有 Tool owner、Capability result metadata、模型投影、本地 runtime diagnostic 和 fork 安全机制，没有新的长期基础设施取舍。
- `openspec/designs/spec-to-design-map.md`：若现有 `memory-tools` 导航未覆盖上述 architecture/module 验证入口，则补充导航；已有导航完整时无内容变化。

## 风险与取舍（Risks / Trade-offs）

- 自定义 Hook 或业务结果消费者若读取未被 stable spec 承诺的 `structuredPayload.results[].entry.sourceTrace`，升级后会失去该字段。通过 BREAKING 标记、closed output schema 和实现说明明确兼容边界；不保留业务 payload alias 或双写窗口。仅本地 canonical `toolOutput` consumer 可从 `metadata.sourceTrace` 读取内部诊断。
- 模型不再能从 `sourceTrace.sourceKind=MANUAL` 区分手工来源，也不能按来源运行隐式调整判断。当前 spec 和一方提示词没有该需求；若需要安全来源语义，后续 change 应定义独立业务字段，不恢复原始执行坐标。
- 顶层 `metadata.sourceTrace` 成为通用模型隐藏 key 后，未来其他 Capability 若使用同名 metadata，也不会进入模型。当前代码库没有第二个该 key 的 Capability result producer；这是有意的安全默认。未来若需要向模型暴露来源摘要，应定义独立、安全、低敏的业务字段，而不是复用内部执行来源 key。
- 本地 runtime `toolOutput` 仍可一步定位来源，但它不是 audit truth，也受本地日志保留、容量 fallback 和访问控制影响。授权 management record/detail 查询继续提供第二条 retained-source 定位路径；本 change 不新增审计存储或留存保证，也不允许把本地诊断字段扩散到 observation、audit、metric、trace 或 public surfaces。
- 既有持久化 Capability Result 不重写，因此旧会话仍可能触发分支拒绝。该兼容窗口是明确范围边界，不通过 runtime 特例绕过安全检查。
- `add-ts-response-memory-disclosure`、`unify-capability-failure-disposition`、`add-ts-runtime-operational-log-hardening` 和 `refine-local-runtime-diagnostic-visibility` 可能同时触及 `memory-tools`、Capability result 或 canonical `toolOutput`。这些 change 的 owner 语义不互相替代；整合时必须保留 closed schema、失败契约、披露采集断言、special-field 脱敏/容量约束，并重跑共同测试。

## 迁移与回滚（Migration / Rollback）

不执行数据库或历史消息迁移。新版本只改变升级后新产生的 `get_memory_detail` 结果；旧 durable messages、旧会话和升级前已经形成的 in-flight 结果保持原样。部署时无需先修改 Gateway 或数据库，但应避免把“旧消息仍可能无法 fork”误报为新结果回退。

若新结果出现业务内容缺失、output validation 回归或非预期模型行为，可整体回滚本 change 的 schema、metadata producer 与通用模型投影。只回滚 core filter 而保留 metadata producer 会重新把内部来源写入模型和 durable result，恢复已知 fork 不兼容风险；只回滚 producer 则会丢失一步式本地诊断，因此禁止部分回滚。已经写入的不含来源结果不需要转换。回滚验收必须同时检查详情业务内容、Capability Result schema、本地 `toolOutput` 和 fork fail-closed 行为。

## 待确认问题（Open Questions）

无。
