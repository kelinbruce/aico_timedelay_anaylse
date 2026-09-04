## 背景和现状（Context）

当前 large-content 处理落在 `packages/agent-context-engine/src/large-content/`（纯函数 `classifier` / `applier` / `aggregate-offloader` / `thresholds`）与 `packages/agent-app/src/composition/large-content-externalizer.ts`（拥有 workspace 文件写入与 `ContentRef` 装配）。现状与目标行为之间存在 gap：

1. **阈值是硬编码常量**。`thresholds.ts` 的 `LARGE_CONTENT_THRESHOLDS = { inlineMaxBytes: 8192, aggregateMaxBytes: 16384, previewMaxChars: 1024 }`。本变更改默认值为 `50000 / 200000 / 2048`，并让 classifier / aggregate-offloader 接收 effective 阈值参数以支持 per-tool / 覆盖维度。
2. **`Read` 放行是硬编码**。`large-content-externalizer.ts` 用 `readToolName(draft) === "Read"` 直接 return draft。本变更泛化为 `infinityToolNames` 集合。
3. **聚合 offloader 无同轮冻结语义**。`aggregate-offloader.ts` 直读 `aggregateMaxBytes` 常量。

引擎内容模型是 string-typed（`draft.content: string`），所有判定基于字符串长度与 `contentType`。本变更不改动内容模型。存量逻辑不需要保持兼容，因此直接改存量函数签名与常量，不为兼容性引入抽象层。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- fresh tool result 默认阈值调整为 `inline-max-bytes = 50000`、`aggregate-max-chars = 200000`、`preview-max-chars = 2048`，语义不变。阈值为固定默认值（不可配置）。
- per-tool Infinity：host 用 `infinityToolNames` 集合取代硬编码 `Read`。
- 同一轮并行批次内已 offload 结果在二次聚合扫描时冻结、原样重放，保住 prompt cache。

**非目标：**

- 不新增 `ReplacementEvidence` 字段、不新增 reason code、不新增 `ContentRef.refType`。
- 不引入独立 `policy.ts` 解析模块或 `FeatureFlagPort` 契约。
- 不引入阈值覆盖 / aggregate 开关 / GrowthBook / `adnclaw.*` config port——阈值为固定默认值。这些配置面若将来需要，作为独立 change。
- 不改动 string-typed 内容模型。
- 不重新分类 attachment-derived 内容（归 `add-ts-attachment-request-context-flow`）。
- 不改空输出文案与图片/二进制分流（`SPECIALIZED_REF`）语义——保持基线行为。

## 设计决策（Decisions）

### 决策 1：阈值参数化（固定默认值）

`thresholds.ts` 的 `LARGE_CONTENT_THRESHOLDS` 默认值改为 `50000 / 200000 / 2048`，并新增一个轻量数据类型 `LargeContentPolicy = { inlineMaxBytes; aggregateMaxChars; previewMaxChars; infinity }` 与 `DEFAULT_LARGE_CONTENT_POLICY`（`infinity = false`、三个阈值取自常量）。该类型只是参数打包，**不**新建 `policy.ts`、**不**新增 resolver 函数。阈值为固定默认值，无覆盖入口。

`classifier` / `aggregate-offloader` 增加可选 `policy: LargeContentPolicy` 参数（默认 `DEFAULT_LARGE_CONTENT_POLICY`），用 `policy.inlineMaxBytes` / `policy.aggregateMaxChars` 取代直读常量。`applier` 仍直读 `LARGE_CONTENT_THRESHOLDS.previewMaxChars`（常量已更新为 2048，自动生效）。

**取舍**：备选是独立 `policy.ts` + resolver + 覆盖入口，被放弃——阈值固定即可，覆盖/开关为不存在的配置面预留属过度设计。

### 决策 2：`infinityToolNames` 集合取代硬编码 Read

`large-content-externalizer.ts` 删除 `readToolName(draft) === "Read"` 硬编码比较，依赖新增 `infinityToolNames: ReadonlySet<string>`（默认 `new Set(["Read"])`）。externalizer 据工具名查集合得到 `policy.infinity`。`policy.infinity === true` 时 `classifyReplacement` 直接返回 INLINE（原样放行），不外置、不截断、不计入聚合外置，但不受 size 约束。

**取舍**：备选是 per-tool 注册表 + `resolvePolicy` 回调三件套，被放弃——一个 `Set<string>` 足以表达"哪些工具永不外置"，最小且可扩展。

### 决策 3：aggregate largest-first + 复用 `previouslyFrozen` 表达同轮冻结

`aggregate-offloader.ts` 的 `planAggregateOffload` 增加 `policy: LargeContentPolicy` 参数，用 `policy.aggregateMaxChars` 取代直读常量。聚合 largest-first 外置**始终启用**（无运行时开关）。

- 同轮冻结复用既有 `AggregateFreshEntry.previouslyFrozen`：调用方把同轮已 offload 的 entry 标 `previouslyFrozen: true`（其语义本就是"已有 replacement evidence / 已 offload"，同轮已 offload 一致）。`planAggregateOffload` 对 `previouslyFrozen` entry 固定 frozen 形态（`reason = frozen-from-prior-decision`），不重复外置、不提升预览、不回退 inline。**不新增 `turnFrozen` 字段**。

externalizer 在并行批次中：先对每条 fresh 结果做单结果判定并 offload，再把同轮已 offload 的 entry 标 `previouslyFrozen` 传入聚合扫描，保证二次扫描不重复决策。

**取舍**：备选是新增 `turnFrozen` 字段或 aggregate 开关，被放弃——`previouslyFrozen` 已表达相同语义；开关为不存在的配置面预留属过度设计。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | workspace 文件写入仍走既有 owner-scoped resolver，refId 仍 `sha256(idempotencyKey,kind)` 派生、无用户输入，无新增路径遍历面。 | 单元测试：refId 确定性；架构测试：externalizer 不绕过 workspace resolver |
| 性能/容量 | 阈值上调后单轮 inline 体积增大（最多 50KB/结果、200KB/批），减少不必要存盘与 `read` 往返；冻结重放保住 prompt cache。Infinity 工具大结果由 `add-ts-context-budget-explainability` 的 60% history budget 独立收口。 | 单元/集成测试：阈值边界 50000/50001、200000/200001 |
| 可靠性/恢复 | offload 失败仍走既有 design 5 三步收口。冻结决策保证 resume / 重放幂等。 | resilience 测试：同轮冻结二次扫描幂等、offload 失败 fallback |
| 可维护性 | 阈值参数化为 `LargeContentPolicy` 数据类型；`infinityToolNames` 取代硬编码 Read。无独立解析模块。 | 架构测试：externalizer 无硬编码工具名字符串比较 |
| 可测试性 | classifier/aggregate-offloader 保持纯函数，接收 `policy` 参数可注入任意阈值测边界。externalizer 通过 `infinityToolNames` 注入测 Infinity 路径。 | unit/contract 测试：policy 边界、Infinity、冻结 |
| 审计/可追溯性 | reason code 复用既有词表（`frozen-from-prior-decision` 等），不新增；不引入覆盖拒绝 diagnostics（单向收敛结果等价）。 | 既有 schema/type guard 测试全绿 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 默认阈值 50000/200000/2048 | T1 | `thresholds` 常量断言；classifier 边界 50000/50001 |
| Infinity 工具永不外置 | T2 | externalizer 注入 `infinityToolNames` 含 `Read`，超阈值结果原样返回 |
| 同轮冻结二次扫描原样重放 | T3 | `planAggregateOffload` `previouslyFrozen` 幂等、不重复外置 |
| reason code / schema 不变 | T4 | 既有 schema/type guard 测试全绿 |
| 架构约束（无硬编码工具名） | T5 | `large-content-cross-baseline.test.ts` 更新 |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/large-content-references/spec.md`（主承载）。
- 模块设计：`openspec/designs/modules/agent-context-engine.md`（`LargeContentPolicy` 参数化、`infinityToolNames`、externalizer policy 注入）。
- 长期决策：`openspec/designs/adr/large-content-threshold-tuning.md`（新增 ADR）。
- 导航：`openspec/designs/spec-to-design-map.md` 更新。
- 无新增跨模块状态机，不新增 architecture 主承载文档。

## 风险与取舍（Risks / Trade-offs）

- [阈值上调增大单轮 inline 体积与 token 成本] -> 由 `add-ts-context-budget-explainability` 的 60% history budget 独立收口。
- [阈值固定、无配置面] -> 阈值/聚合开关均为固定默认值；若将来需要配置覆盖（config port / GrowthBook），作为独立 change，不在本 change 预留入口。
- [string-typed 内容模型] -> 所有判定基于字符串长度与 `contentType`，本变更不改动内容模型。
- [复用 `previouslyFrozen` 表达同轮冻结依赖调用方正确标记] -> externalizer 在单结果 offload 后立即标 `previouslyFrozen`，决策冻结点明确。

## 迁移计划（Migration Plan）

- 阈值与文案变更是 BREAKING 行为变更，但无持久化数据迁移：既有已 frozen 的 `SessionMessage.metadata.replacement` 形态不变，新阈值只影响 fresh 结果。
- 回滚：还原常量与 classifier/aggregate-offloader 的 policy 参数默认值即等价旧版。
- 发布顺序：先合引擎纯函数 + 测试，再合 externalizer composition 接线。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/large-content-references/spec.md`：提炼新阈值默认值、Infinity 工具、冻结重放 Scenario。
- `openspec/designs/modules/agent-context-engine.md`：提炼 `LargeContentPolicy` 参数化、`infinityToolNames`、externalizer policy 注入。
- `openspec/designs/adr/large-content-threshold-tuning.md`（新增）：阈值上调、Infinity 工具取舍。
- `openspec/designs/spec-to-design-map.md`：更新导航。
- `openspec/overview.md`：补充阈值上调对缓存命中与单轮 token 成本的影响。

## 后续 change（已实现）

### `add-ts-large-content-aggregate-offload-wiring`

把已实现的聚合策略纯函数 `planAggregateOffload` 接入运行时，使"模型一轮返回多个工具调用、结果合计超 `aggregate-max-chars` 时从最大开始依次存盘"端到端生效。**该后续 change 已实现**，范围：

- `agent-contracts/runtime`：`LargeContentExternalizerPort` 新增 `externalizeBatch` 方法。
- `agent-app`：`large-content-externalizer.ts` 实现 `externalizeBatch`（单结果阈值 + `planAggregateOffload` 聚合 + 冻结重放）。
- `agent-core/tool-loop.ts`：`invokePreparedToolCall` 拆 execute/append 返回 `ToolCallOutcome`；`executeToolCalls` 攒齐一轮 outcomes → `externalizeBatch` → 按序 `appendMessage` → 落盘后抛 abortError（保持"先记录再中止"时序）。externalizer 注入 `ToolLoopDependencies`（不改 `AgentRunStatePort` 契约）。
- 配套测试：externalizeBatch 单测 + tool-loop 聚合集成测试。

本 change 不阻塞该后续 change：聚合策略纯函数与 policy 契约已就位，后续 change 只做接线。

## 待确认问题
- 是否需要阈值配置覆盖（`adnclaw.*` config port / GrowthBook）？本 change 不引入（阈值固定）；若将来需要，作为独立 change，届时再给 externalizer 加覆盖入口。
- **聚合 offload 接线**：运行时调用点（把 `executeToolCalls` 改为"先攒齐一轮并行结果、跑 `planAggregateOffload`、再按决策落盘"）已由后续 change `add-ts-large-content-aggregate-offload-wiring` 实现（`LargeContentExternalizerPort.externalizeBatch` + 注入 externalizer 到 `ToolLoopDependencies` + 重写 `invokePreparedToolCall` 落盘时机）。本 change 只交付聚合策略纯函数与 effective-policy 契约。
- **Infinity 工具在两条路径已统一**（写时 externalizer 与渲染时 assemble-context 均查 `infinityToolNames`，默认含 `Read`）。若将来新增非 Read 的 Infinity 工具，需在两处注册表同时登记（externalizer `infinityToolNames` 与 `DefaultContextEngineDependencies.infinityToolNames`）。
- **readback 预览上限**已与写时统一为 2048（`preview-reader.ts` 回退改为引用 `LARGE_CONTENT_THRESHOLDS.previewMaxChars`）。
