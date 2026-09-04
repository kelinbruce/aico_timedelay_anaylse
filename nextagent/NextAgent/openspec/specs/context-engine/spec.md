## Purpose

定义上下文装配的统一黑盒能力，包括历史选择、当前请求保护、预算与压缩、摘要消费、提示词整形，以及基于 Agent 已激活模型的初始选择和失败降级重装配。

## Function

- **所属 Function**：`FN-4.3 装配上下文`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: Context Engine owns model-visible history selection

Context Engine SHALL select model-visible conversation history during context assembly from authoritative owner-scoped and agent-scoped facts. Callers SHALL provide request location and intent, and SHALL NOT preselect history entries or bypass visibility policy.

Current-request context is the latest-request correctness baseline, not merely the most recent history messages. It comprises the root user request message identified by `requestId`, the protocol-required messages under the same `requestId`/`runId` (such as assistant tool-use and capability-result messages), and latest-request-required attachment and tool state. The current request and other request-critical context SHALL be established before optional prior history. If required current-request context cannot be established, assembly SHALL fail explicitly rather than silently dropping required context.

History selection produces the full set of valid history candidates only. It SHALL NOT perform final context-window truncation, compression, or replacement; the final selection of `ContextAssembly.selectedMessageRefs` remains owned by existing downstream policy (see Requirement: History candidate selection is separate from final context selection).

#### Scenario: Caller cannot inject selected history

- **WHEN** a caller requests context assembly
- **THEN** Context Engine derives model-visible history from authoritative context state
- **AND** caller-provided history or message selections are not accepted as authority

#### Scenario: Current request cannot be silently dropped

- **WHEN** required current-request context is unavailable
- **THEN** assembly returns an explicit safe failure
- **AND** it does not report successful assembly after removing required context

#### Scenario: Current request remains required before optional prior history

- **WHEN** required current-request context and valid prior conversation candidates are both available
- **THEN** Context Engine establishes current-request records as required current context before prior-turn candidates
- **AND** any final `ContextAssembly.selectedMessageRefs` that includes prior history also includes the required current-request records
- **AND** downstream context-window policy may omit optional prior history before omitting required current-request context

#### Scenario: First turn with no prior conversation

- **WHEN** the session has no prior visible conversation units and only the current request is available
- **THEN** Context Engine returns current-request records as the only history candidates
- **AND** prior-turn candidates are an empty set
- **AND** `ContextAssembly.selectedMessageRefs` MUST still include all required current-request records

### Requirement: ActiveContextView is the model-visible history authority

Context Engine SHALL derive model-visible history from the current `ActiveContextView` and immutable session message records. It SHALL NOT scan the full session transcript or reintroduce hidden, inactive, or omitted messages to enlarge the model-visible window.

#### Scenario: History remains bounded by active context

- **WHEN** Context Engine selects prior conversation history
- **THEN** selected raw history is derived from visible active-context items
- **AND** messages outside active context are not recovered through a full-session scan

### Requirement: Prior conversation preserves valid conversation boundaries

Context Engine MUST 只把协议完整且当前有效的 prior conversation unit 选入普通模型上下文。对于同一 prior request 的 Retry 历史，Context Engine MUST 从具有 `visibility.reason="RETRY_REPLACED"` 且 `runId` 已定义的非 USER message 识别被替换 run，并排除该 request unit 内所有属于这些 run 的非 USER messages；该排除 MUST 包含 Retry 前已经 `visible=false`、没有 replacement reason 的 assistant tool-use。具有 `RETRY_REPLACED` 但缺少 `runId` 的 message MUST 仍按 message 自身排除，但不得据此扩展到其他 messages。Context Engine MUST 保留 root user message，再使用剩余消息验证完整有序的 tool-use / capability-result 序列以及 terminal assistant response；只有验证通过的剩余消息才能成为 history candidate。被 Retry 替换的旧 messages MUST NOT 参与协议配对、终态判定或模型输入。

Context Engine MUST NOT 按消息时间、run 顺序或 `runId` 值猜测 latest attempt，也 MUST NOT 在没有明确 `RETRY_REPLACED` message 时推断被替换 run。具有 `metadata.visibility.reason` 且 reason 不等于 `RETRY_REPLACED` 的 replacement messages MUST NOT 通过上述 Retry 规则恢复为模型可见历史。没有 `metadata.visibility.reason` 且不属于明确被替换 run 的执行期 assistant tool-use 继续遵守既有 Tool protocol 可见性规则。剩余消息存在不完整终态、pending tool-use、孤立 capability result 或其他协议不完整时，Context Engine MUST 排除整个 prior conversation unit，不得只选择其中看似可用的片段。

**需求类别**：功能性需求

#### Scenario: 纯文本 Retry 保留最新有效轮次

- **GIVEN** 一个 prior request 包含可见 root user message、至少一个被标记为 `RETRY_REPLACED` 的旧 terminal assistant response，以及一个最新可见 terminal assistant response
- **WHEN** 后续请求装配模型上下文
- **THEN** history candidate MUST 包含该 root user message 和最新可见 terminal assistant response
- **AND** history candidate MUST NOT 包含任一被 `RETRY_REPLACED` 的旧 assistant response

#### Scenario: Tool Retry 只保留最新完整协议序列

- **GIVEN** 一个 prior request 的旧 run 包含 Retry 前已经 hidden 且没有 replacement reason 的 assistant tool-use，以及被标记为 `RETRY_REPLACED` 的 capability result 和 terminal assistant response
- **AND** 同一 prior request 包含最新可见且有序完整的 assistant tool-use、capability result 和 terminal assistant response
- **WHEN** 后续请求装配模型上下文
- **THEN** history candidate MUST 包含 root user message 和最新可见 attempt 的完整 Tool protocol sequence
- **AND** 该明确被替换 run 的全部非 USER messages MUST NOT 参与协议配对或 history candidate

#### Scenario: 连续 Retry 排除全部旧 attempts

- **GIVEN** 同一 prior request 已完成多次 Retry，且每个旧 run 至少有一个带 `RETRY_REPLACED` 和 `runId` 的非 USER message
- **WHEN** 后续请求装配模型上下文
- **THEN** Context Engine MUST 排除全部被替换 attempts 的 messages
- **AND** 只有 root user message 与最新可见且协议完整的 attempt 能成为该 prior turn 的 history candidate

#### Scenario: 缺少 runId 的 Retry marker 不扩展排除范围

- **GIVEN** 一个 prior request 包含带 `RETRY_REPLACED` 但缺少 `runId` 的 hidden message
- **WHEN** 后续请求装配模型上下文
- **THEN** Context Engine MUST 排除该 message
- **AND** Context Engine MUST NOT 因该 marker 排除其他没有明确关联的 messages
- **AND** 剩余 unit 协议不完整时 MUST 继续整体 fail closed

#### Scenario: 最新 attempt 协议不完整时继续 fail closed

- **GIVEN** 一个 prior request 的旧 attempt messages 已被标记为 `RETRY_REPLACED`
- **AND** 剩余最新可见 attempt 缺少匹配的 capability result 或 terminal assistant response
- **WHEN** 后续请求装配模型上下文
- **THEN** Context Engine MUST 排除整个 prior conversation unit
- **AND** Context Engine MUST NOT 把 root user message、孤立 Tool protocol fragment 或部分最新输出单独作为完整轮次选入

#### Scenario: 其他 replacement reason 不使用 Retry 过滤规则

- **GIVEN** 一个 prior conversation unit 包含 `metadata.visibility.reason` 为非 `RETRY_REPLACED` 值的 hidden message
- **WHEN** Context Engine 验证该 prior conversation unit
- **THEN** 该 hidden message MUST NOT 因本 Requirement 的 Retry 规则恢复为模型可见
- **AND** 该 unit 不满足完整可见轮次条件时 MUST 被整体排除

#### Scenario: Direct Workflow Retry 不引入过程事件

- **GIVEN** 一个 Direct Workflow prior request 在 Retry 后具有 root user message、最新可见 terminal assistant response 和 Workflow process events
- **WHEN** 后续请求装配模型上下文
- **THEN** history candidate MUST 按本 Requirement 使用 root user message 和最新可见 terminal assistant response 验证完整轮次
- **AND** Workflow process events MUST NOT 因 Retry 历史选择进入普通模型上下文

### Requirement: History candidate selection is separate from final context selection

History selection SHALL emit the full set of valid history candidates and SHALL NOT perform budget truncation, compression, replacement, or budget degradation. Any omission of a valid candidate MUST be attributable to an existing downstream policy, not to the history selection stage.

#### Scenario: Candidate selection does not truncate history

- **WHEN** Context Engine forms the raw history candidate set
- **THEN** the candidate set contains every valid prior conversation unit
- **AND** no candidate is omitted by history selection for budget, compression, or replacement reasons

### Requirement: Selected message refs come from a single snapshot and never silently skip

`ContextAssembly.selectedMessageRefs` SHALL be produced from the single `ActiveContextView` snapshot read during this assembly call. The selection side SHALL NOT mix refs drawn from different `ActiveContextView` snapshots, and SHALL NOT scan messages outside that snapshot. When the render stage resolves a referenced message and the underlying message is missing or no longer model-visible at render time, render SHALL surface an explicit failure or explicit degrade with a presentation-safe diagnostic and SHALL NOT silently skip the message.

The earlier scope of this requirement also required `ContextAssembly.selectedMessageRefs` to carry the originating `activeContextVersion` as a per-ref resolution anchor and required render to re-verify each ref against that anchor. That sub-requirement has been removed as over-engineering for the current architecture: `SessionMessage` is append-only, same-session lane scheduling serializes per-session execution, and there is no architectural path that concurrently mutates active-context state between assemble and render of the same request. The protection the anchor was meant to provide is achieved by the single-snapshot guarantee above and the render-side no-silent-skip rule.

#### Scenario: Selection draws every ref from one snapshot

- **WHEN** Context Engine emits `ContextAssembly.selectedMessageRefs`
- **THEN** every ref is derived from the single `ActiveContextView` snapshot read during this assembly call
- **AND** refs are not combined from different `ActiveContextView` snapshots and are not pulled from a full session scan

#### Scenario: Render does not silently skip a missing or invisible selected ref

- **WHEN** the render stage resolves an entry of `selectedMessageRefs` and the underlying message cannot be loaded, or it loads but is not model-visible
- **THEN** render surfaces an explicit failure or explicit degrade with a presentation-safe diagnostic
- **AND** render does not silently drop the message and continue producing model input as if it were absent

### Requirement: Unresolvable active context references fail explicitly

If any active-context message ref cannot be safely loaded or verified under the owning owner-scope, session-scope, and agent-scope, Context Engine SHALL return an explicit safe failure. It SHALL NOT silently fall back to a current-request-only assembly or treat the unresolvable ref as prior history.

#### Scenario: Active context message reference cannot be resolved

- **WHEN** a required active-context message ref cannot be loaded under the owning owner-scope, session-scope, and agent-scope
- **THEN** Context Engine returns an explicit safe failure
- **AND** the assembly is not reported as successful with a degraded or current-request-only result### Source: add-ts-context-budget-explainability (3 requirements, 6 scenarios)

> Promoted verbatim from `openspec/changes/add-ts-context-budget-explainability/specs/context-engine/spec.md`.
>
> Cross-reference appendix H1-a appended to `Context Engine protects minimum safe current-request context` to close the H1 interlock (history budget vs `inline-max-bytes` / `aggregate-max-chars`). The forward side (large-content R8) already references the same numeric baseline.

### Requirement: Context Engine owns budget explainability before render

Context Engine SHALL complete budget explainability before model input rendering. It SHALL base the result on the selected model window, reserved output budget, minimum safe current-request context, prior-history candidates, and the Query Policy compaction plan, and SHALL produce inspectable selection and compaction reasons.

The selected model window SHALL be derived during assembly from the accepted Agent configuration's model profile, and the reserved output budget from the effective model options. Neither SHALL be carried by `ContextAssemblyRequest`.

Budget explainability SHALL include source-level evidence for every context source category considered during assembly: selected active history, current request, attachment projections, capability disclosure, runtime context, project instruction context, summary or session-memory replacements, and later memory retrieval disclosures when enabled. Each evidence entry SHALL include safe source category, estimated input units, selected/omitted/degraded status, reason code, and owning boundary. It SHALL NOT include raw prompt text, raw message content, raw tool result, raw attachment content, local paths, credentials, or high-cardinality fields.

#### Scenario: Context assembly computes budget evidence before render

- **WHEN** Context Engine assembles context for a model-backed step
- **THEN** it completes available-input budget computation, history budget handoff, and compaction explainability before render
- **AND** these machine-readable explainability facts are available as Context Engine / Query Policy diagnostics for downstream render, audit, structured log, observability metric, and runtime degrade notice

#### Scenario: Source-level budget evidence is safe and complete

- **WHEN** Context Engine assembles context from history, runtime context, project instructions, capability disclosure, attachments, or memory-related sources
- **THEN** budget explainability records each source category with selected/omitted/degraded status and safe reason code
- **AND** it records unit estimates and owning boundary without exposing raw source content

### Requirement: Context Engine protects minimum safe current-request context

Context Engine SHALL treat root user message, current-request protocol-required messages, and latest-request-required attachment context as minimum safe current-request context. This baseline SHALL NOT be silently dropped to make room for prior history.

Historical attachment context MAY be degraded when context overflow is governed by the proactive auto-compact strategy, but such degradation MUST be explicit and explainable. A latest-request-required attachment that cannot be safely projected or budgeted MUST fail the current assembly rather than silently continuing as pure text.

**需求类别**：功能性需求

#### Scenario: Latest request minimum safe context is protected

- **WHEN** Context Engine identifies the root user message, current-request protocol-required messages, and latest-request-required attachment context
- **THEN** it treats them as minimum safe current-request context
- **AND** it protects them from silent omission to make room for prior history

#### Scenario: Minimum safe context cannot fit

- **WHEN** minimum safe current-request context still cannot fit within the safe input budget
- **THEN** Context Engine MUST return an explicit insufficient-context failure or an equivalent safe degraded outcome
- **AND** it MUST NOT fake a successful assembly by removing request-critical content

#### Scenario: Latest request attachment cannot be silently degraded away

- **WHEN** a latest-request-required attachment becomes unavailable or cannot fit as part of minimum safe current-request context
- **THEN** the system MUST fail explicitly with a safe error or insufficient-context outcome
- **AND** it MUST NOT silently continue as if the request were pure text

**Appendix H1-a (revised by baseline promotion, 2026-08-11).** The large-content thresholds defined in `openspec/specs/large-content-references/spec.md` and re-asserted in this baseline under `Large-content thresholds referenced from context-engine are fixed` (from `add-ts-large-content-references`) are independent of, and not a substitute for, the history budget governance: `inline-max-bytes` (default 8192 chars), `aggregate-max-chars` (default 16384), `preview-max-chars` (default 1024), configuration namespace `adnclaw.large-content.*`. Concretely: a fresh large content entry that exceeds `inline-max-bytes` MUST be offloaded to an owner-scoped `ContentRef` regardless of how the history budget would otherwise apply; aggregate offload uses the shared `aggregate-max-chars` key; neither threshold can be redefined inside context assembly. The two mechanisms are 互不替代、不互相覆盖. The forward side of this cross-reference is already in the large-content baseline entry quoted above; this appendix closes the reverse side from the budget-protection side so both share a single source of truth in the `large-content-references` spec.

### Requirement: Output-window safety is explicit

Every model-backed step MUST enforce output-window safety. When the model output-window limit prevents completing the current output, the system MUST inform the user through an explicit continuation step, a degraded/partial-result notice, or failure handling. Final output MUST NOT be silently truncated.

#### Scenario: Output window limitation stays explicit

- **WHEN** the output-window guard determines this turn needs continuation, partial-result degrade, or failure
- **THEN** the system MUST express the result as explicit continuation, degrade, or failure semantics
- **AND** it MUST NOT submit a length-limited result as if it were a complete final answer### Source: add-ts-large-content-references (8 requirements, 11 scenarios)

> Promoted verbatim from `openspec/changes/add-ts-large-content-references/specs/context-engine/spec.md`.
>
> The forward side of H1 and H2 is already in R7 and R8: R7 references the compression / summary changes by name; R8 references the same numeric threshold baseline in `openspec/specs/large-content-references/spec.md`. No appendices are required from this side.

### Requirement: Context Engine consumes frozen large-content replacements during assembly

Context Engine SHALL 在请求执行生命周期的模型调用之前、并且在同步 `assemble(...)` 流程内复用已经冻结的 large-content replacement decision。fresh tool/capability/message result 在进入模型可见历史前 SHALL have already been classified as inline, persisted preview, specialized ref, or empty marker. 调用方不得预先把未冻结的大内容直接拼进 prompt。

Render / 同步装配阶段 SHALL NOT 改写历史大对象的模型可见形态：assemble 只消费已 frozen 的 `SessionMessage.content` / `metadata.replacement`，不在 render 时对历史大对象临时 offload、preview 或重写。唯一可产生**新** replacement 的入口是 fresh batch（fresh 结果写入 / fresh tool batch 聚合预算），且只在内容写入 / 持久化前决定。

#### Scenario: Assemble reuses frozen replacement
- **WHEN** `ContextEngine.assemble(...)` 读取到先前已经 offload 的 historical tool result
- **THEN** it uses the persisted preview / `contentRef` replacement as the model-visible form
- **AND** it does not re-inline the original large result
- **AND** 后续 budget explainability 与 compression 基于该 frozen 模型可见形态运行

#### Scenario: Render does not reshape historical large objects
- **WHEN** assemble / render 阶段遇到一个已 frozen 的历史大对象（`SessionMessage.metadata.replacement.decisionState=frozen`）
- **THEN** Context Engine 直接消费已持久化的 `SessionMessage.content` / `metadata.replacement`
- **AND** 不在 render 时对该历史大对象临时 offload、生成新 preview 或重写形态
- **AND** 只有 fresh batch（写入 / 聚合预算）可产生新 replacement

### Requirement: Context Engine differentiates large content by message source

Context Engine 在装配时 SHALL NOT 对所有 message 一视同仁地 offload / preview / truncate。它 MUST 按 message 来源区分处理：USER current request（当前请求正文与 latest-request-critical 内容）MUST NOT 被语义摘要或静默截断，装不下时 MUST 返回显式 insufficient-context outcome；tool / capability result 是 preview / truncate / ref 的主要对象；attachment-derived content 的分类与失败投影遵循 `add-ts-attachment-request-context-flow`；assistant history 与 summary message 的形态不被本 change 改写。详见 `large-content-references` capability 的 "Large-content handling is differentiated by message source"。

#### Scenario: Current request content is not previewed or truncated to fit budget

- **WHEN** 当前请求所需正文或 latest-request-critical 内容超过预算或装配时不可读
- **THEN** Context Engine MUST 返回显式 insufficient-context outcome 并经 `PRE_SEND_CHECK_REQUIRED` 入口消费
- **AND** MUST NOT 用 `PERSISTED_PREVIEW` excerpt 或 truncate 替代当前请求所需正文继续渲染成功 prompt

### Requirement: Fresh large content is offloaded before becoming history

Fresh large text content SHALL be evaluated before it becomes stable model-visible history. Empty output SHALL become an explicit marker. Non-text/media/binary content SHALL use specialized refs. Large text output SHALL be persisted to an owner-scoped `ContentRef`（在 large-content 角色下称为 `LargeContentRef`，其 `BlobRef` 由 `BlobStoreGateway` 在 `refType` 解析时按 owner-scope 持有）and represented to the model as preview + `contentRef` + safe metadata.

#### Scenario: Large fresh tool result becomes persisted preview
- **WHEN** a fresh tool result exceeds the single-result inline threshold
- **THEN** the full result is persisted as an owner-scoped `ContentRef`
- **AND** the model-visible result contains replacement kind, bounded preview, `contentRef`, original size, replacement reason, access instruction, and safe lineage
- **AND** the model-visible replacement is recorded in `SessionMessage.content` and replacement evidence is recorded in `SessionMessage.metadata`（schema 见 `design.md` 决策 6.2）for later turns and resume

### Requirement: Aggregate tool results are offloaded by largest fresh blocks first

When tool results grouped under the same model-visible user message exceed the aggregate result budget, the system SHALL preserve prior frozen decisions and SHALL only consider fresh results. It SHALL offload fresh text results from largest to smaller until the aggregate is within budget or no eligible fresh result remains.

#### Scenario: Aggregate limit chooses largest fresh result
- **WHEN** multiple fresh tool results are individually below the single-result threshold but together exceed the aggregate threshold
- **THEN** the largest fresh eligible result is persisted and replaced first
- **AND** smaller useful results remain inline when the aggregate budget is satisfied

### Requirement: Large-content replacement preserves original authority

Large-content replacement SHALL NOT overwrite an already persisted `SessionMessage`, archive body, attachment blob, or capability result authority. For fresh oversized content, it SHALL persist the full original content through an owner-scoped `ContentRef`（其 `BlobRef` 由 `BlobStoreGateway` 在 `refType` 解析时按 owner-scope 持有）, and SHALL write only the model-visible replacement into the new `SessionMessage.content` with safe lineage in `SessionMessage.metadata`.

#### Scenario: Prior tool result remains replaced across turns
- **WHEN** a prior capability result was represented as persisted preview
- **THEN** later turns read the same persisted-preview `SessionMessage.content` / `metadata` rather than re-inlining the original large result
- **AND** the original content remains available only through its authorized source ref

### Requirement: Context Engine fails or degrades explicitly on large-content dependency issues

当上下文装配依赖的 replacement / specialized ref / `contentRef` 不可读、不可授权或依赖缺失时，Context Engine SHALL 返回显式 failure 或 degraded outcome，且该 outcome 必须经 `add-ts-context-budget-explainability` 的 `PRE_SEND_CHECK_REQUIRED` / explicit insufficient-context 入口消费。历史 replacement 内容可以降级为 safe marker，但必须把降级原因写入 diagnostics/evidence 边界（schema 见 `design.md` 决策 6.2）。

#### Scenario: Offload failure feeds budget pre-send check

- **WHEN** fresh offload 触发 `design.md` 决策 5 的 explicit failure 路径（`reason=degradation:offload-failed-into-overflow`）
- **THEN** Context Engine 不再继续推进 budget 计算
- **AND** 触发 `add-ts-context-budget-explainability` 的 `PRE_SEND_CHECK_REQUIRED`
- **AND** 模型调用前必须出现 explicit insufficient-context outcome

#### Scenario: Missing latest-request attachment content fails assembly

- **WHEN** 当前请求依赖的 attachment-derived content ref 在上下文装配时已不可读、已过期或跨 owner 不可授权
- **THEN** Context Engine 返回显式 failure 或 insufficient-context outcome
- **AND** 不把该附件上下文静默删除后继续渲染成功 prompt
- **AND** 失败投影遵循 `add-ts-attachment-request-context-flow` 的 `latest-request-critical` 失败语义

### Requirement: Context Engine does not rewrite replacement form during compression

Context Engine 在 `add-ts-context-compression` / `add-ts-traceable-summary-generation` 触发的压缩路径中 SHALL NOT 把已 frozen 的 `PERSISTED_PREVIEW` / `SPECIALIZED_REF` / `EMPTY_MARKER` 改写为其他形态；previously `INLINE` 的历史 tool result 走 `ContentRef.refType=MODEL_SUMMARY` 指向的 summary `SessionMessage`。详细边界见 `design.md` 决策 8.1。

#### Scenario: Frozen preview is not silently re-shaped during compression

- **WHEN** 历史 tool result 的 `SessionMessage.metadata.replacement.kind` 为 `PERSISTED_PREVIEW` 且 `decisionState=frozen`
- **THEN** compression change 不得将该历史改写为 `INLINE` 或 summary
- **AND** 该历史继续以同一 `PERSISTED_PREVIEW` 形态参与后续 budget 与 assembly

### Requirement: Large-content thresholds referenced from context-engine are fixed

Context Engine MUST reference the same large-content threshold and configuration baseline as `openspec/specs/large-content-references/spec.md` "Large-content thresholds and configuration are fixed": `inline-max-bytes` default 8192 chars、aggregate offload 阈值 default 16384 chars、preview 字符数上限 default 1024 chars，配置命名空间 `adnclaw.large-content.*`。

Context Engine 在 aggregate offload 与 fresh offload 判断中 MUST 复用以上同一阈值，不允许实现层重新定义。阈值修改仅限于对应的 `adnclaw.large-content.*` 配置覆盖与 contract refinement change 两种路径，不允许在上下文装配内联限流。

aggregate offload 决策 MUST 遵循以下顺序：保留 prior frozen decisions → 只考虑 fresh results → 按 size 从大到小 offload 直至聚合 ≤ aggregate 阈值或没有可选 fresh result 剩余。

**需求类别**：功能性需求

#### Scenario: Aggregate offload uses the shared threshold key

- **WHEN** 同一 user message 下 fresh text results 聚合体积 = 16385 chars
- **THEN** Context Engine MUST 使用 `adnclaw.large-content.aggregate-max-chars` 阈值判断，按 size 从大到小 offload 直至聚合 ≤ 16384 chars

#### Scenario: Threshold configuration override is honored

- **WHEN** `adnclaw.large-content.aggregate-max-chars` 被配置覆盖为 M
- **THEN** Context Engine MUST 以 M 为聚合阈值判断，不使用 16384 chars 硬编码

### Requirement: Context Engine SHALL own summary compression orchestration

Context Engine SHALL 在 `assemble()` 中以一个主动上下文窗口阈值作为 summary compression 的**唯一**触发条件：当 `estimatedConversationInputUnits >= availableInputUnits − autoCompactHeadroomUnits` 成立时，Context Engine SHALL 在预算门评估之后编排 summary compression（复用现有 `runSummaryCompression`），不引入第二条压缩实现路径。它消费预算门的预算/估算信号和 summary-generation port，但不得依赖其他模块的 private ports。

Context Engine SHALL NOT 再以"selected prior active-context history 无法安全放入预算（被预算门 omitted）"作为压缩触发条件；该反应式触发路径被移除。当主动阈值未触发时，若预算门仍 omit `prior_active_history`，Context Engine SHALL 按既有 budget-degraded 结果返回，SHALL NOT 触发压缩。

定义（单一来源，不得另建口径）：

- `availableInputUnits = contextWindowTokens − reservedOutput`，其中 `contextWindowTokens` 取自 `modelSelection.modelInfo.contextWindowTokens`，`reservedOutput` 取自有效 `modelOptions.maxOutputTokens`，与预算门 `runBudgetGate` 的计算完全一致。
- `estimatedConversationInputUnits` SHALL 等于预算门已构建的 `sourceCandidates`（required 与 optional 全部候选）的 `estimatedInputUnits` 之和，使用预算门已注入的同一 token estimator。Context Engine MUST NOT 为阈值判断新建第二条 token 估算路径或第二个 estimator。
- `autoCompactHeadroomUnits` 为固定常量，默认值 `13_000`，表达"有效上下文窗口预留的压缩触发余量"，约对应常见 128K 窗口下 90%–92% 的触发点。该值 MUST NOT 由 `ContextAssemblyRequest`、client request body、model output 或 capability arguments 携带。

小窗口安全降级：当 `availableInputUnits <= autoCompactHeadroomUnits` 时（阈值结果非正，会无条件触发），主动阈值触发器 SHALL NOT 触发，压缩不在本轮发生。

不变量保留：触发压缩时，Context Engine 仍 MUST 保护 current-request、visibility、owner-scope、agent-scope 与 protocol 不变量；当 summary-generation port 未配置或压缩失败时，Context Engine MUST 显式回退到既有 budget-degraded / prior-history omission 结果，MUST NOT 伪造成功装配。

设计入口：`openspec/designs/modules/agent-context-engine.md`（阈值触发器落点、与 `runBudgetGate` / `processBudgetOutcome` 的关系、反应式路径移除）；`openspec/designs/adr/`（固定偏移量 13,000 vs 纯比例阈值的取舍）。

#### Scenario: 对话 token 达到有效窗口减余量阈值时触发压缩

- **WHEN** `availableInputUnits = 100_000`、`autoCompactHeadroomUnits = 13_000`、`estimatedConversationInputUnits = 88_000`（>= 87_000）
- **THEN** Context Engine 在本轮 `assemble()` 中触发 summary compression
- **AND** 压缩通过现有 `runSummaryCompression` 编排执行，不调用第二条压缩实现
- **AND** 该触发发生在预算门评估之后

#### Scenario: 未达阈值时不触发压缩

- **WHEN** `availableInputUnits = 100_000`、`autoCompactHeadroomUnits = 13_000`、`estimatedConversationInputUnits = 80_000`（< 87_000）
- **THEN** Context Engine 不触发 summary compression
- **AND** 即使该轮预算门 omit 了 `prior_active_history`，也按既有 budget-degraded 结果返回，不触发压缩

#### Scenario: 小窗口下阈值不无条件触发

- **WHEN** `availableInputUnits = 12_000`、`autoCompactHeadroomUnits = 13_000`（`availableInputUnits <= autoCompactHeadroomUnits`）
- **AND** `estimatedConversationInputUnits` 为任意正值
- **THEN** 主动阈值触发器不触发
- **AND** 本轮不发生压缩

#### Scenario: summary generation 不可用时安全回退

- **WHEN** 阈值触发条件成立
- **AND** `TraceableSummaryGenerationPort` 未配置，或 summary 生成被取消/返回空/返回 unsafe draft，或 `commitCompaction` 失败
- **THEN** Context Engine MUST NOT 提交压缩后的 active context
- **AND** Context Engine 显式回退到既有 budget-degraded / prior-history omission 结果
- **AND** 不伪造成功装配

#### Scenario: 阈值余量不进入请求体

- **WHEN** Context Engine 组装 `ContextAssemblyRequest`
- **THEN** `autoCompactHeadroomUnits` 不出现在 `ContextAssemblyRequest`、client request body、model output 或 capability arguments 中
- **AND** 该值为固定常量，不通过请求面携带

### Requirement: Context Engine SHALL consume summary generation through a cancellable port

当需要语义 summary generation 时，Context Engine SHALL 调用受治理的 asynchronous summary-generation boundary，校验结果，并用返回的 `TraceableSummaryDraft.content` 构造 summary `SessionMessage`（领域对象），并且只提交 valid safe summary representation。`TraceableSummaryDraft` 是 Context Engine 消费的内部 port DTO（content + presentation-safe traceability metadata），不是可直接持久化的 message 对象。Context Engine 在领域层只构造 `SessionMessage`；向 `ActiveContextStoreGateway.commitCompaction(...)` 提交时，由 session 映射边界把它转换为 `ContextCompactionCommitRequest.summaryMessage`（`SessionMessageRecord`）。Context Engine MUST NOT 自行构造或持有 `SessionMessageRecord`。

#### Scenario: Summary generation is canceled or invalid

- **WHEN** summary generation is canceled、unavailable、empty、malformed 或 unsafe
- **THEN** Context Engine MUST NOT commit the proposed compressed state
- **AND** it MUST fallback explicitly to the uncompressed or budget-degraded path

### Requirement: Context Engine SHALL render committed summaries without compression decisions

`render()` SHALL 把已提交的 `SUMMARY` messages 渲染为 historical summary context。`render()` 不得调用 summary-generation port，也不得做新的 compression decision。

#### Scenario: Active context contains a committed summary

- **WHEN** Context Engine renders a `ContextAssembly` whose selected refs include a summary message
- **THEN** the summary MUST be rendered as model-visible historical context
- **AND** the summary MUST NOT be treated as system prompt authority

**Appendix H2-a (added by baseline promotion, 2026-06-10).** The "no compression decision in render" rule above interacts with the large-content baseline at decision 8.1 boundary: `add-ts-large-content-references` R7 (`Context Engine does not rewrite replacement form during compression`) states that frozen `PERSISTED_PREVIEW` / `SPECIALIZED_REF` / `EMPTY_MARKER` MUST NOT be reshaped into `INLINE` or summary by compression, and that previously `INLINE` history follows the `ContentRef.refType=MODEL_SUMMARY` path. This requirement (compression R3) is the *render-side* half of that boundary: `render()` MUST render committed summary messages as ordinary history and MUST NOT touch frozen large-content replacement forms. The two halves together close decision 8.1 so that compression / summary / large-content boundaries are single-sourced from the large-content baseline and confirmed from this side.

### Requirement: Context Engine MUST produce post-commit evidence for runtime reconciliation

After a successful `ActiveContextStoreGateway.commitCompaction(...)`, Context Engine MUST produce a `ContextCompressionEvidence` and expose it to runtime so the runtime-owned path can write the `CONTEXT_COMPACTED` checkpoint and timeline fact.

#### Scenario: Evidence is produced after a successful commit

- **WHEN** `commitCompaction` returns a successful result and the active context view is updated
- **THEN** Context Engine MUST produce a `ContextCompressionEvidence` containing `sessionId`, `requestId`, `runId`, `stepId`, `sourceActiveContextVersion`, `targetActiveContextVersion`, `summaryMessageId`, `strategy` (locked to `PREFIX_COMPACT_RECENT_TAIL`), `coveredMessageRefCount`, `retainedTailRefCount`, and a presentation-safe `safeReason` code
- **AND** the evidence MUST NOT contain raw covered messages, raw summary prompt, raw tool args or result body, attachment content, credential, local path, or high-cardinality identifiers

#### Scenario: Evidence is exposed through a single contract surface

- **WHEN** the runtime-owned reconciliation path needs the evidence to write the `CONTEXT_COMPACTED` checkpoint and timeline fact
- **THEN** Context Engine MUST expose the evidence through `ContextEnginePort.assemble(...)` return value's `ContextAssembly.compressionEvidence` field in `agent-contracts/context`; the caller (agent-core) MUST forward it so runtime writes the reconciliation fact through the existing `CheckpointStoreGateway.saveCheckpoint(record, { idempotencyKey })` (with `record.triggerReason = "CONTEXT_COMPACTED"`) and the existing `RunTimelineEventPort.emit(event)` entry points; no runtime-specific compression port is introduced; runtime MUST NOT read the evidence via any other surface (such as a `ContextEnginePort.lastCompressionEvidence(...)` lookup) and MUST NOT retain the evidence as process-local state across reloads
- **AND** the evidence MUST be available only after a successful commit and MUST NOT be retained as process-local state across reloads
- **AND** if runtime reconciliation fails after a successful commit, the committed active context MUST remain canonical and recovery MUST use `session_messages`, `active_context_items`, and `activeContextVersion` rather than process-local state

#### Scenario: Render stage MUST NOT consume or produce the evidence

- **WHEN** `render()` is invoked
- **THEN** `render()` MUST NOT call `TraceableSummaryGenerationPort.generate(...)`
- **AND** `render()` MUST NOT mutate the `ContextCompressionEvidence`
- **AND** `render()` MUST NOT make a new compression decision

#### Scenario: Summary message inherits the current request id and preserves retained tail request ids

- **WHEN** Context Engine constructs a `SUMMARY` `SessionMessage` after a successful `commitCompaction`
- **THEN** the summary's `requestId` MUST equal the current `ContextAssemblyRequest.requestId`
- **AND** every message referenced by `retainedTailMessageRefs` MUST keep its original `requestId`
- **AND** `retainedTailMessageRefs` MUST NOT be re-tagged with the summary's `requestId`### Source: add-ts-traceable-summary-generation (2 requirements, 2 scenarios)

> Promoted verbatim from `openspec/changes/add-ts-traceable-summary-generation/specs/context-engine/spec.md`.
>
> Cross-reference appendix H2-b appended to `Context Engine SHALL keep semantic generation separate from compression commit` to close the H2 interlock from the summary-generation side. The forward side (large-content R7) is already present; the compression-side appendix is in part 4.

### Requirement: Context Engine SHALL compose traceable summary generation implementation

Context Engine SHALL provide or compose a default implementation of `TraceableSummaryGenerationPort` so context compression can request summary drafts without depending on prompt, model, or parsing internals.

#### Scenario: Traceable summary generator is available to compression

- **WHEN** the application composes Context Engine with summary compression enabled
- **THEN** a `TraceableSummaryGenerationPort` implementation SHALL be available
- **AND** context compression SHALL be able to call it through the port when summary compression is required

### Requirement: Context Engine SHALL keep semantic generation separate from compression commit

The traceable summary generator SHALL not own active context commits. The returned `TraceableSummaryDraft` SHALL be an internal port DTO (content plus presentation-safe traceability metadata), not a persistable message object. Context compression SHALL remain responsible for taking `draft.content` to construct a domain summary `SessionMessage` and committing it through `ActiveContextStoreGateway.commitCompaction`.

#### Scenario: Summary draft is committed by compression

- **WHEN** `TraceableSummaryGenerationPort.generate()` returns a draft
- **THEN** context compression SHALL build the domain summary `SessionMessage` from `draft.content` and metadata
- **AND** context compression SHALL perform the active context commit

**Appendix H2-b (added by baseline promotion, 2026-06-10).** This requirement's "generator does not own commits" rule, combined with `add-ts-large-content-references` R7 (`Context Engine does not rewrite replacement form during compression`), means the traceable summary generator MUST consume frozen large-content replacement form (`PERSISTED_PREVIEW` body, `SPECIALIZED_REF` / `EMPTY_MARKER` metadata, `contentRef` lineage) as the input to its semantic generation, and MUST NOT attempt to expand, re-render, or reshape frozen large-content replacement into inline content. The generator's only output is `TraceableSummaryDraft.content` (presentation-safe summary text plus traceability metadata); reshaping of frozen large-content forms is forbidden in the generator and is the compression-side R7 rule. The three-way closure (compression R3 appendix H2-a in part 4, summary R2 appendix H2-b here, large-content R7 already verbatim above) keeps decision 8.1 single-sourced from `add-ts-large-content-references` while this baseline re-asserts the boundary on the consumption side.### Source: add-ts-context-prompt-shaping (7 requirements, 11 scenarios)

> Promoted verbatim from `openspec/changes/add-ts-context-prompt-shaping/specs/context-engine/spec.md`.
>
> Downstream consumer of the other five sources. R1 (assembly is self-contained for render) and R5 (render validates selectedMessageRefs against the activeContextVersion anchor produced by history selection) already implicitly state the consumption relationship. No appendices are required from this side.

### Requirement: Context Engine separates assembly from rendering

Context Engine SHALL 把可信 scope、accepted Agent assembly、模型选择、history、prompt、capability visibility 和 budget 决策组装为 `ContextAssembly`，再把该 assembly 渲染为 provider-neutral `RenderedModelInput`。`ContextAssembly` SHALL 携带 render 所需决策和 accepted execution coordinates；`RenderedModelInput` SHALL 携带 model-consumable messages、tools、selected safe model information 和 effective optional model parameters。Context Engine MUST 对前八个 provider-neutral inference fields 按 selected safe profile configuration、已编译且选中的 Prompt Template、受治理 Capability patch、可信 render request 的顺序产生 pre-hook effective value，后层逐字段覆盖前层。`ModelInputRenderRequest.providerOptions` MUST 只携带 `Provider options remain an open selected-provider extension` 所定义的 trusted request 来源；Context Engine MUST 对 call-level `providerOptions` 按已编译且选中的 Prompt Template、受治理 Skill patch、可信 render request 的顺序顶层浅合并，同名嵌套对象整体替换，并将结果交给 `RenderedModelInput.providerOptions`。这三个 call-level 授权来源均缺失时 MUST 保持该字段缺失，MUST NOT 合成空对象。受治理 Skill Tool context patch `modelOptions.providerOptions` MUST 来自 accepted Skill metadata。Context Engine MUST NOT 读取或暴露 private profile `providerOptions`；模型调用边界 MUST 按模型调用契约把 private profile defaults 置于 call-level composite 之前，并把 governed hook 置于其后。Context Engine MUST NOT 从 history、Capability 参数、非 Skill Tool Capability result、模型输出或 metadata 派生 provider options。`ContextAssembly` 和 `RenderedModelInput` MUST NOT 包含 `providerId`、endpoint、credential reference、custom fetch、SDK type 或模型目录的私有 binding。

`toolChoice` MUST 作为第八个 provider-neutral inference field 参与同一逐字段 precedence，并 MUST 复用 canonical `ToolChoice` 的 `AUTO | NONE | REQUIRED` 值域。Context Engine MUST 保留 visible capabilities 投影出的 `tools`，MUST NOT 因 effective `toolChoice=NONE` 清空 descriptor。进入 finalizing turn 时，Agent Core 的 runtime-owned feedback MUST 通过同一 request-local model patch handoff 提供 `toolChoice=NONE`；它不是 Capability result，MUST NOT 改写最后一个 Capability 结果或持久化配置。

`ContextAssemblyRequest` MUST 继续携带 request/run 已接受的 required trusted `identityContext`，并 MUST 使用它执行 owner-scoped context queries；调用方、Capability result、模型输出或 metadata MUST NOT 覆盖该字段，系统 MUST NOT 为其维护平行的 request-local owner side map。受治理的 `contextPatch.modelId` 和 closed `modelOptions` MUST 只影响同一 request/run 的后续 assembly；其中 `modelOptions.providerOptions` MUST 只接受 Capability contract 定义的 governed Skill source。Capability patch MUST 通过 `capability-catalog` 定义的 closed schema 和 source governance；provider access、timeout 和 retry controls 保持由 owning boundaries 管理。

**需求类别**：功能性需求

#### Scenario: Context assembly 完成
- **WHEN** Context Engine 完成 assembly
- **THEN** 结果包含 governed system prompt、selected immutable message refs、accepted execution coordinates、visible capabilities、selected safe model information、effective optional model parameters 和 selection reason
- **AND** 结果不包含 provider access configuration 或最终 rendered messages

#### Scenario: Model input 被渲染
- **WHEN** Context Engine render 一个有效 `ContextAssembly`
- **THEN** selected refs 和 current request 被解析为 provider-neutral messages
- **AND** visible capabilities 被投影为 provider-neutral tools
- **AND** 输出包含 selected safe model information 和 effective optional model parameters
- **AND** 输出不包含完整 `ContextAssembly`、模型目录私有 binding 或 provider-native object

#### Scenario: 渲染输入合并已授权 provider options
- **WHEN** 已编译且选中的 Prompt Template、受治理 Skill patch 或 `ModelInputRenderRequest.providerOptions` 中一个或多个 call-level 授权来源携带 provider options
- **THEN** `RenderedModelInput.providerOptions` MUST 按 template、Skill、trusted request 的顺序顶层浅合并
- **AND** 后层同名顶层字段 MUST 覆盖前层，嵌套对象 MUST 整体替换
- **AND** Context Engine MUST NOT 增加 provider namespace、private profile defaults 或接入字段

#### Scenario: 渲染输入未携带已授权 provider options
- **WHEN** 全部 call-level 授权来源均缺失 provider options，或 provider options 只出现在 history、Capability 参数、非 Skill Tool Capability result、模型输出或不可信 metadata
- **THEN** `RenderedModelInput` MUST 省略 provider options

#### Scenario: Context assembly 使用 request-carried identity
- **WHEN** Context Engine 为 accepted request/run 执行 assembly
- **THEN** owner-scoped query MUST 使用 `ContextAssemblyRequest.identityContext`
- **AND** Capability result 或其他不可信输入 MUST NOT 覆盖 owner scope

#### Scenario: Capability 显式模型选择进入后续 assembly
- **WHEN** 同一 request/run 的 schema-valid `contextPatch.modelId` 已通过模型选择治理
- **THEN** 后续 assembly MUST 将它作为 `ModelSelectionRequest.modelId`
- **AND** model selection MUST 使用该 exact canonical `modelId`

#### Scenario: Finalizing patch 保留 Tool descriptors

- **WHEN** Agent Core 为达到 `maxTurns` 后的 finalizing model turn 提供 runtime-owned `modelOptions.toolChoice=NONE`
- **THEN** Context Engine MUST 通过 request-local option merge 产生 effective `toolChoice=NONE`
- **AND** `RenderedModelInput.tools` MUST 保持当前 Agent 的正常可见 Tool descriptors
- **AND** runtime feedback MUST NOT 持久化为用户 session message 或 durable model configuration

#### Scenario: Tool choice 按 canonical 层次逐字段覆盖

- **WHEN** profile、selected Prompt Template、governed Capability patch 或 trusted render request 中一个或多个来源提供合法 `toolChoice`
- **THEN** Context Engine MUST 按该顺序逐字段覆盖产生 pre-hook value
- **AND** 任一来源省略 `toolChoice` MUST 表示不覆盖

### Requirement: Context Engine resolves accepted agent configuration

Prompt shaping SHALL use the agent assembly fixed for the accepted request. It SHALL NOT silently reselect a newer or default agent configuration during assembly or rendering.

#### Scenario: Agent configuration changes after acceptance

- **WHEN** prompt shaping runs for an accepted request
- **THEN** it uses the request-bound agent identity and version

### Requirement: ContextAssembly exposes assembly decisions explicitly

The top-level fields of `ContextAssembly` SHALL include every assembly decision and execution coordinate that `render` requires. The shape SHALL be stable enough for `render(ContextAssembly)` to be self-contained without the original request object.

#### Scenario: Render does not require the original ContextAssemblyRequest

- **WHEN** `render(assembly)` is invoked
- **THEN** the assembly alone is sufficient to produce `RenderedModelInput`
- **AND** render does not need to look up the original `ContextAssemblyRequest`
- **AND** any message or attachment lookup is driven only by refs and execution coordinates already present in `ContextAssembly`

### Requirement: Context Engine consumes prompt template assembly for model prompts

Context Engine SHALL consume the prompt template assembly boundary for every model-facing prompt it owns or orchestrates. The main model invocation system prompt SHALL use `PromptPurpose=SYSTEM_PROMPT`. Traceable summary generation, when composed through Context Engine, SHALL use `PromptPurpose=SUMMARY_GENERATION`. Context Engine MUST NOT define a separate complete-template selection algorithm outside prompt template assembly.

Prompt template assembly result SHALL be an input to Context Engine render, not a replacement for Context Engine render. Context Engine remains responsible for assembling final model input messages, role placement, history selection output consumption, attachment context placement, tool-call protocol preservation and current user input placement.

#### Scenario: System prompt assembly delegates template selection

- **WHEN** `ContextEnginePort.assemble()` builds the system prompt for a request
- **THEN** it MUST obtain selected template identity, rendered prompt content and optional `modelOptions` override from prompt template assembly
- **AND** it MUST continue to render final `RenderedModelInput` through the existing model input render boundary
- **AND** prompt template assembly MUST NOT directly emit the complete `RenderedModelInput.messages`

#### Scenario: Summary prompt assembly delegates template selection

- **WHEN** traceable summary generation constructs a summary prompt
- **THEN** it MUST use `PromptPurpose=SUMMARY_GENERATION` through prompt template assembly
- **AND** it MUST keep summary-specific output parsing, checklist validation and tool-disabled model invocation in the summary generation owner

#### Scenario: Render boundary combines prompt with other model inputs

- **WHEN** Context Engine has prompt assembly result, selected history refs, attachment context refs, visible capabilities and current user input
- **THEN** Context Engine render MUST combine those governed inputs into the final model invocation shape
- **AND** prompt template rendering MUST remain limited to rendered prompt content and purpose metadata
- **AND** history, tool and attachment content MUST retain their governed placement rules outside generic prompt template rendering

### Requirement: Context Engine preserves role and protocol boundaries

Prompt template assembly consumed by Context Engine SHALL NOT flatten prior conversation, current request, tool-call protocol messages, or capability result messages into system prompt text unless a consuming purpose explicitly requests a safe text projection. Main conversation history and current request content MUST remain in `RenderedModelInput.messages` with the appropriate model roles.

#### Scenario: History is not flattened into system prompt

- **WHEN** selected prior history contains user, assistant and tool-result messages
- **THEN** Context Engine MUST render those messages through `RenderedModelInput.messages`
- **AND** prompt template variables MUST NOT expose a raw concatenation of role-preserving history by default

#### Scenario: Explicit text projection remains bounded

- **WHEN** a purpose-specific prompt template references a registered variable that produces a text projection
- **THEN** the projection MUST be produced by a governed resolver
- **AND** it MUST preserve safety constraints for large content, credentials, paths, attachment content and unauthorized objects

### Requirement: Context Engine performs micro-compaction before large-content truncation and budget evaluation

When assembling model-visible history, Context Engine SHALL run a micro-compaction stage after history candidate selection and before large-content truncation and budget evaluation. The stage SHALL use local deterministic rules only and SHALL NOT invoke a model or external summarization service.

#### Scenario: Micro-compaction runs before downstream budget decisions

- **WHEN** Context Engine assembles context for a request with visible prior history
- **THEN** it evaluates micro-compaction after history selection
- **AND** any large-content truncation and budget evaluation observe the micro-compacted model-visible history form
- **AND** the stage does not call a model, prompt template, or external summarization boundary

### Requirement: History candidate selection remains separate from final context selection

Context Engine SHALL preserve the existing ownership split where history selection emits the full valid candidate set and downstream policy decides the final model-visible selection. Before budget evaluation, Context Engine SHALL deterministically replace every `Rag` capability result that belongs to any canonical completed turn before the current request with a bounded placeholder. Context Engine MAY apply the existing threshold-based micro-compact step to other eligible prior-turn capability results that are already inside the selected history candidate set. Both forms MUST operate only on model-visible representation, MUST NOT mutate user messages, assistant messages, current-request required context, canonical persisted messages, or conversation boundaries, and MUST NOT call a model.

**需求类别**：功能性需求

#### Scenario: 新问题压缩全部历史已完成轮次的 RAG 结果

- **WHEN** Context Engine 为一个新问题组装上下文，且当前问题之前一个或多个 canonical 已完成轮次包含 `Rag` capability results
- **THEN** Context Engine MUST 在预算评估前将这些历史轮次的全部 `Rag` capability result payloads 替换为有界确定性占位
- **AND** 替换数量 MUST NOT 受通用工具结果触发阈值或最近保留窗口影响
- **AND** 上一轮的 user 消息、assistant 消息及工具调用与结果顺序保持不变

#### Scenario: 当前问题的 RAG 结果始终保持完整

- **WHEN** 当前问题在一次或多次模型与工具迭代中产生任意数量的 `Rag` capability results
- **THEN** Context Engine MUST NOT 通过上一轮 RAG 微压缩规则替换这些当前问题结果
- **AND** 同一问题内后续上下文组装仍将这些结果作为当前请求必需上下文处理

#### Scenario: 没有上一已完成轮次时不产生 RAG 替换

- **WHEN** 当前问题之前不存在 canonical 已完成轮次，或紧邻的上一 canonical 已完成轮次不包含 `Rag` capability result
- **THEN** Context Engine MUST NOT 通过上一轮 RAG 微压缩规则替换任何消息
- **AND** 其他历史工具结果仍按既有下游策略处理

### Requirement: Micro-compaction only replaces safe whitelisted older tool results

Micro-compaction SHALL use two non-overlapping eligibility rules. For `Rag`, it SHALL consider every capability result in all canonical completed turns before the current request eligible and SHALL replace all such results without applying the generic trigger threshold or retained window. For other tools, it SHALL consider only prior-turn capability-result history for the existing explicit trusted whitelist of replayable or low-risk tools; when the count of those generic candidates exceeds the trigger threshold, it SHALL preserve the most recent retained window and replace only the older eligible results. Both rules SHALL NOT compact current-request results, user messages, assistant text replies, Agent orchestration tools, task tools, custom MCP tools, or tools outside their respective eligibility rules.

**需求类别**：功能性需求

#### Scenario: RAG 专用规则与通用数量规则互不影响

- **WHEN** 上一 canonical 已完成轮次同时包含 `Rag` results 和通用白名单工具 results
- **THEN** Context Engine MUST 替换上一轮的全部 `Rag` results
- **AND** 通用白名单工具 results MUST 继续按既有触发阈值和最近保留窗口进行判定
- **AND** `Rag` results MUST NOT 参与通用候选数量或最近保留窗口的计算

#### Scenario: 单条上一轮 RAG 结果也被替换

- **WHEN** 紧邻的上一 canonical 已完成轮次仅包含一条 `Rag` capability result，且通用触发阈值未达到
- **THEN** Context Engine MUST 替换该 `Rag` result
- **AND** 不得因通用触发阈值未达到而保留其原始 model-visible payload

#### Scenario: 非候选工具和当前请求内容保持不变

- **WHEN** 消息属于当前请求、不是 capability result，或来自两种 eligibility rules 均未允许的工具
- **THEN** Context Engine MUST NOT micro-compact 该消息
- **AND** 后续省略或降级仍由既有预算或压缩策略负责

### Requirement: Micro-compaction state is owner-scoped, idempotent, and cleared after summary compression

Context Engine SHALL persist micro-compaction state as owner-scoped active-context metadata so the same historical message is not repeatedly committed as newly compacted across repeated assembly of one request or later requests. If the state is missing or malformed, Context Engine SHALL safely degrade to an empty state and deterministically re-evaluate eligible model-visible history. When render reloads canonical message records, it SHALL re-apply every replacement identified by valid micro-compaction state. After summary compression commits a replacement active context, the micro-compaction state for the replaced history SHALL be cleared.

**需求类别**：功能性需求

#### Scenario: 同一问题反复组装保持幂等

- **WHEN** 一个问题因多次模型与工具迭代反复组装上下文，且上一轮 RAG message ids 已记录为 compacted
- **THEN** Context Engine MUST 继续输出相同的 model-visible placeholders
- **AND** MUST NOT 将这些 message ids 重复计为新压缩结果
- **AND** MUST NOT 压缩当前问题新产生的 `Rag` results

#### Scenario: 缺失或非法状态安全降级

- **WHEN** active-context metadata 不包含有效 micro-compaction state
- **THEN** Context Engine MUST 将状态视为空并重新评估当前可见历史
- **AND** MUST NOT 仅因状态缺失或非法而使请求失败

#### Scenario: 状态写入竞争不恢复本次上一轮 RAG

- **WHEN** Context Engine 在 assembly 中识别出上一已完成轮次 RAG，但 active-context metadata 写入发生版本冲突、记录不存在或 gateway 异常
- **THEN** 本次 assembly 后续 render MUST 仍将 selected history 中可确定识别的该上一轮 RAG 投影为相同占位符
- **AND** 当前问题的 RAG results MUST 保持完整
- **AND** metadata 写入失败 MUST NOT 使请求失败或触发无界重试

#### Scenario: 最终 TOOL message 不携带上一轮 RAG 原文

- **WHEN** 上一已完成轮次的 `Rag` capability result 被投影为最终 LLM `TOOL` message
- **THEN** 对应 `tool-result.output` MUST 是有界确定性占位且 MUST NOT 包含原始 `results`
- **AND** `toolCallId`、`toolName`、消息顺序和当前问题的 `tool-result.output` MUST 保持不变

#### Scenario: 第三轮重新计算全部历史 RAG 替换

- **WHEN** 第三轮问题组装时 micro-compaction state 缺失，且第一轮与第二轮均包含 `Rag` capability results
- **THEN** Context Engine MUST 从全部当前可见 canonical 已完成历史轮次重新计算 RAG 替换
- **AND** 第一轮与第二轮的 RAG 原始 `results` MUST 均不进入最终 LLM messages

#### Scenario: 摘要压缩清理失效状态

- **WHEN** summary compression 提交替换 prior history 的新 active-context view
- **THEN** 新 active-context metadata MUST NOT 携带已被替换历史的失效 micro-compaction state
- **AND** 下一次 assembly 从替换后的 active context 重新跟踪 micro-compaction

### Requirement: Render resolves selected message refs without silent omission

When rendering, Context Engine SHALL read the messages identified by `ContextAssembly.selectedMessageRefs` as a batch (a single batched read rather than per-ref N+1 lookups). If a referenced message is missing or no longer model-visible at render time, render SHALL trigger an explicit failure or explicit degrade and record a diagnostic; it SHALL NOT silently skip the message and continue. When assembly previously marked selected prior capability-result messages as micro-compacted in active-context metadata, render SHALL re-apply the same placeholder replacements so output stays consistent with the candidate-set representation used for budget evaluation. If micro-compaction state is missing, malformed, or cannot be applied safely, render MUST degrade safely by leaving the original message content unchanged and recording only presentation-safe diagnostics. This change only governs the render-stage consumption of `selectedMessageRefs`; their production remains owned by history selection.

The earlier draft of this requirement also required render to validate each ref against an `activeContextVersion` anchor carried by `selectedMessageRefs`. That sub-requirement was removed in coordination with the history-selection capability owner because it was over-engineering for the current architecture (append-only `SessionMessage` + same-session lane scheduling rule out the race the anchor was guarding against). Render still must not silently skip a missing or invisible ref; the protection is achieved without a per-ref version anchor.

#### Scenario: Selected message is missing or not visible at render

- **WHEN** render resolves `selectedMessageRefs` and a referenced message is missing or no longer model-visible
- **THEN** render does not silently drop the message
- **AND** render triggers an explicit failure or explicit degrade and records a presentation-safe diagnostic

#### Scenario: Selected message refs are read in one batch

- **WHEN** render resolves `selectedMessageRefs`
- **THEN** the messages are read in a single batched read keyed by the refs
- **AND** each missing or invisible read is surfaced explicitly per the scenario above, not silently dropped

#### Scenario: Render re-applies persisted micro-compact replacements

- **WHEN** assembly previously marked selected prior capability-result messages as micro-compacted in active-context metadata
- **THEN** render re-applies the same placeholder replacement to the re-loaded model-visible messages
- **AND** it does not re-inline the original large tool content solely because render re-read storage

#### Scenario: Invalid micro-compact state degrades safely

- **WHEN** active-context metadata omits micro-compact state or contains an invalid micro-compact payload
- **THEN** Context Engine leaves the re-loaded message content unchanged
- **AND** it does not fail the main path solely because micro-compact state could not be interpreted
- **AND** any diagnostic emitted is presentation-safe and does not expose raw tool content

### Requirement: Render maps message roles and pairs tool calls with results

The `ModelInputRenderer` SHALL map session message roles to `RenderedMessage` roles: USER to user, ASSISTANT to assistant, and CAPABILITY_RESULT to tool carrying the originating tool call id and tool name. When a persisted assistant tool-use message contains non-empty public assistant content and ordered tool calls, the renderer SHALL emit one assistant message whose content parts contain the public text first and the tool calls in their persisted order. When the public content is empty or absent, the renderer SHALL emit no empty text part. Compression summary messages SHALL be rendered as ordinary history messages, not as system authority.

The renderer SHALL pair each assistant tool call with its corresponding capability-result message by tool call id and tool name, SHALL avoid duplicate or orphaned tool-result messages, and SHALL remain compatible with persisted assistant tool-use messages that contain only `toolCalls`. It SHALL NOT derive assistant text from reasoning, timeline events, stream deltas or raw provider responses. The system prompt SHALL be rendered as the leading system message with the cache boundary marker emitted between stable and dynamic section text.

#### Scenario: Assistant public content and tool call pair with result

- **WHEN** a selected assistant tool-use message contains non-empty public content and tool calls with matching capability-result messages
- **THEN** the renderer MUST emit the public content as the first text part of that assistant message
- **AND** it MUST emit the tool calls after the text part in persisted order
- **AND** each tool result MUST be rendered after the assistant message and paired by tool call id and tool name
- **AND** a capability result already rendered MUST NOT be emitted a second time

#### Scenario: Legacy tool-call-only assistant message remains renderable

- **WHEN** a selected assistant tool-use message contains tool calls but no public content field
- **THEN** the renderer MUST emit the ordered tool-call parts without an empty text part
- **AND** matching tool results MUST remain correctly paired

#### Scenario: Summary message renders as history

- **WHEN** a selected message is a compression summary
- **THEN** it is rendered as an ordinary history message and not as a system-authority section

### Requirement: Prompt-shaping diagnostics do not enter model input

Context Engine SHALL keep prompt-shaping diagnostics outside model-facing input contracts and SHALL NOT add diagnostics to public `ContextAssembly`.

#### Scenario: Prompt shaping records a fallback or omission

- **WHEN** prompt shaping emits diagnostics
- **THEN** diagnostics are recorded through existing presentation-safe observability, audit, timeline, or equivalent diagnostic sinks
- **AND** are not injected into `RenderedModelInput`

#### Scenario: Prompt shaping diagnostics are not written to audit events

- **WHEN** prompt shaping emits diagnostics
- **THEN** diagnostics are recorded through `agent-observability` structured logging helper or timeline/event subscriber
- **AND** are not written to an audit event, because audit event is reserved for gateway / capability / hook / checkpoint / terminal commit key-value facts

### Requirement: Model selection uses Agent-activated model configurations

当主 Agent 执行、summary 生成、memory 提取、建议问题生成或 workflow model node 需要模型时，`ModelSelectionService` MUST 是唯一模型选择契约，并 MUST 恰好提供 `select(request: ModelSelectionRequest, signal: AbortSignal): Promise<ModelSelectionResult>`。

`ModelSelectionRequest` MUST 是封闭对象，required fields MUST 恰好为既有 canonical `identityContext`、`agentId`、`agentVersion`、`agentAssemblyRef`、`purpose`、`flowVariables` 和 `mode`，optional fields MUST 恰好为 `locale`、`modelId` 和 `attemptedModelIds`。`identityContext` MUST 复用 `agent-common` 既有 closed `IdentityContext` contract；selection 只使用其中的 trusted `tenantId/subjectId` 执行 Owner Scope 校验，`displayName` 不参与选择。`agentId`、`agentVersion` 和 `agentAssemblyRef` MUST 来自同一 accepted Agent assembly，去除首尾空白后 MUST 非空、长度为 `1..256` 个 Unicode code point 且不含控制字符。`purpose` MUST 匹配 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`；`flowVariables` MUST 为 own-key string-to-string record，数组、`null` 或任一非 string value MUST 被拒绝；optional `locale` MUST 是去除首尾空白后长度为 `1..64` 个 Unicode code point 且不含控制字符的字符串；optional `modelId` 和每个 attempted id MUST 使用模型调用契约的 `modelId` scalar constraint。`mode` MUST 恰好为 `INITIAL | FALLBACK`，并且只表达本次选择是首次选择还是一次显式的跨模型 fallback 选择；它 MUST NOT 表达 provider 类型、调用流式模式、模型能力或 routing policy。`attemptedModelIds` 存在时 MUST 保持输入顺序且 MUST NOT 包含重复 id。显式 `null` 和未知字段 MUST 在选择前被拒绝。

`ModelSelectionResult` MUST 是封闭判别联合。`status="SELECTED"` MUST 额外要求 immutable `configuration: ResolvedModelConfiguration` 和 `reason`，MUST NOT 包含 `failureReason`；该 `configuration` MUST 原样复用命中 `ModelCatalogEntry.availability="AVAILABLE"` 的 frozen `configuration`，MUST NOT 再包装、复制或重命名模型身份。成功 `reason` MUST 恰好为 `EXPLICIT_MODEL_ID | AGENT_DEFAULT | FIRST_ELIGIBLE | FALLBACK_NEXT_ELIGIBLE`。`status="FAILED"` MUST 额外要求 `failureReason`，MUST NOT 包含 `configuration` 或 `reason`；`failureReason` MUST 恰好为 `AGENT_ASSEMBLY_MISMATCH | MODEL_ID_NOT_ELIGIBLE | NO_AVAILABLE_MODEL | FALLBACK_ATTEMPTED_MODEL_NOT_ACTIVATED | FALLBACK_EXHAUSTED`。两个分支 MUST 拒绝 `null`、未知字段和混合字段。required cancellation signal 被取消时，`select` MUST 按统一 cancellation 语义结束，MUST NOT 返回 partial selection 或把取消映射为某个 domain failure reason。

服务 MUST 按 accepted Agent assembly 的 `modelIds` 顺序查询安全全局模型目录，只保留 `AVAILABLE` 且满足可信 prompt、capability、constraint 和 fallback 条件的 activated models，并返回恰好一个 selected configuration 或上述显式安全失败。Agent assembly publication MUST 已按冻结的 `systemConfig.modelProfiles` 拒绝目录外 activated `modelId`；selection MUST 信任 accepted Assembly 的该不变量，MUST NOT 通过额外 membership port 重复校验。目录中已知但 `UNAVAILABLE` 的 activated model MUST 被排除，而 MUST NOT 阻塞其他可用模型。调用方 MUST NOT 把 `providerId`、endpoint、credential、context window、provider options、preselected route 或 candidate list 作为选择权威提交。

当 context assembly 触发 summary generation 时，`TraceableSummaryGenerationRequest.flowVariables` MUST 是 required own-key string-to-string map，并 MUST 携带当前 `ContextAssemblyRequest.flowVariables` 的全部 string entries；当前请求省略 `flowVariables` 时，该 required 字段 MUST 为空 map。Summary model selection 和 prompt assembly MUST 使用这些 entries，MUST NOT 把非空输入视为空 map。

**需求类别**：功能性需求

#### Scenario: Agent 默认模型可用且符合条件
- **WHEN** accepted Agent 的 `defaultModelId` 为 `AVAILABLE` 且通过全部可信过滤
- **THEN** initial selection 选择该模型
- **AND** reason code 为 `AGENT_DEFAULT`，除非受治理 `modelId` 是显式选择权威

#### Scenario: Agent 默认模型不可用
- **WHEN** default model 为 `UNAVAILABLE` 或被可信过滤排除
- **THEN** initial selection 按 Agent 声明顺序选择第一个剩余 `AVAILABLE` model
- **AND** reason code 为 `FIRST_ELIGIBLE`

#### Scenario: Activated model 已知但不可用
- **WHEN** activated model list 包含一个 `UNAVAILABLE` model 和至少一个符合条件的 `AVAILABLE` model
- **THEN** selection 排除不可用模型并继续选择可用模型

#### Scenario: 没有可用候选
- **WHEN** 全部 activated models 均为 `UNAVAILABLE` 或被可信过滤排除
- **THEN** selection 返回显式安全失败
- **AND** failure reason 为 `NO_AVAILABLE_MODEL`
- **AND** 模型调用不启动

#### Scenario: Agent assembly reference 不匹配
- **WHEN** selection request 的 `agentAssemblyRef` 与 resolved accepted assembly 不同
- **THEN** selection 安全失败
- **AND** failure reason 为 `AGENT_ASSEMBLY_MISMATCH`
- **AND** 不使用 active、latest 或 default assembly

#### Scenario: 显式 Model id 不可选
- **WHEN** 受治理 `modelId` 不属于 accepted Agent 的 eligible activated set
- **THEN** selection MUST 返回 `FAILED`
- **AND** failure reason MUST 为 `MODEL_ID_NOT_ELIGIBLE`

#### Scenario: Initial selection 省略可选字段
- **WHEN** `INITIAL` selection request 省略 `modelId`、`locale` 和 `attemptedModelIds`
- **THEN** selection MUST NOT 施加显式 model-id 或 locale filter
- **AND** accepted Agent 声明合法 `defaultModelId` 时 MUST 优先选择该模型
- **AND** `defaultModelId` 也缺失时 MUST 选择 `modelIds` 顺序中的第一个 eligible model

#### Scenario: 辅助模型消费者需要模型
- **WHEN** summary、memory、建议问题或 workflow model node 需要模型
- **THEN** 该消费者通过 `ModelSelectionService` 请求选择
- **AND** 该消费者不自行查询全局目录或选择 default/first model
- **AND** summary generation MUST 将当前 `ContextAssemblyRequest` 的 trusted string-only `flowVariables` 用于本次 model selection 和随后 prompt assembly；非空输入 MUST NOT 被视为空映射
- **AND** locale 只用于 selection 和 prompt assembly，不进入 `ModelInvocationRequest`
- **AND** 该消费者对一次 logical invocation 只调用模型边界一次，不包裹同模型 retry

#### Scenario: 不可信调用方尝试控制选择
- **WHEN** Web 请求、RuntimeCommand、Capability 参数、模型输出或 metadata 携带模型选择控制
- **THEN** 这些字段不被接受为可信选择输入

#### Scenario: 不可信调用方提供模型调用参数
- **WHEN** Web/client、RuntimeCommand、Capability 参数、非 Skill Tool Capability result、模型输出或不可信 metadata 携带内部调用参数或 provider options
- **THEN** Context Engine 不把这些字段加入 `RenderedModelInput`
- **AND** 既有 public `RequestModelOptions.thinking.depth="OFF"` 继续按其独立受治理契约处理

#### Scenario: Selection request 不满足封闭 schema
- **WHEN** request 包含未知字段、`null`、非 string flow variable、重复 attempted id 或非法 mode
- **THEN** selection MUST 在目录查询前拒绝该 request
- **AND** 不返回伪造的 `ModelSelectionResult`

#### Scenario: Selection 被取消
- **WHEN** required cancellation signal 在 selection 完成前被取消
- **THEN** selection MUST 按统一 cancellation 语义结束
- **AND** 不返回 partial candidate 或 `FAILED` domain result

### Requirement: 上下文预算使用所选模型的已解析窗口

Context assembly MUST 使用本次 selection attempt 返回的 `AVAILABLE` model configuration 中的正整数 `contextWindowTokens` 计算 input budget。`contextWindowTokens` MUST 表示完整模型上下文窗口，effective `maxOutputTokens` MUST 表示单次输出上限。profile、prompt template、Capability patch 和其他受治理调用覆盖均未提供 `maxOutputTokens` 时，Context assembly MUST 使用模型调用契约的固定默认值 `32,000` 预留输出预算；MUST NOT 按 `0`、provider 隐式值或当前 input size 猜测。effective `maxOutputTokens` 未给完整输入留出正数预算时，Context assembly MUST 在 provider access 前安全失败。上下文窗口值 MUST 来自模型目录。当 fallback 选择不同 `modelId` 时，下一次 assembly MUST 使用新模型的 resolved window 和重新解析的 effective `maxOutputTokens` 计算 budget。

**需求类别**：功能性需求

#### Scenario: Initial selection 计算预算
- **WHEN** context assembly 完成 initial model selection
- **THEN** input budget 使用该 selected configuration 的 resolved context window
- **AND** 没有受治理 `maxOutputTokens` 覆盖时 MUST 预留固定默认值 `32,000`

#### Scenario: Fallback 选择不同窗口的模型
- **WHEN** fallback selection 返回 context window 不同的模型
- **THEN** 新 assembly 使用 fallback 模型的窗口重新计算 capacity
- **AND** 不复用前一模型的 budget

#### Scenario: 上游尝试覆盖窗口
- **WHEN** 非目录输入携带 context-window value
- **THEN** Context Engine 不把该值作为预算权威

### Requirement: Fallback selection recomputes model-specific context

`ModelSelectionRequest.mode` MUST 为 required。`INITIAL` mode MUST 要求 `attemptedModelIds` 缺失；`FALLBACK` mode MUST 要求至少一个 attempted `modelId`，校验每个 attempted id 都属于 accepted Agent 的 activated set，排除全部 attempted ids，并只保留 `AVAILABLE` 且 `fallbackEligible=true` 的模型。Context Engine MUST 按 Agent 声明顺序选择第一个剩余 eligible model，并针对新模型重新执行 prompt compatibility、effective optional model parameters、context-window budget、compaction 和 render。

`ContextAssemblyOptions` MUST 是 optional closed object；options 缺失 MUST 表示 `INITIAL`。options 存在时 required field MUST 恰好为 `mode`，optional field MUST 恰好为 `attemptedModelIds`，并 MUST 复用 `ModelSelectionRequest` 的 mode、id、顺序、唯一性和 `INITIAL | FALLBACK` 组合约束。`ContextEnginePort.assemble` 的目标 signature MUST 恰好为 `assemble(request: ContextAssemblyRequest, options: ContextAssemblyOptions | undefined, signal: AbortSignal): Promise<ContextAssembly>`。显式 `null`、unknown field、`INITIAL` 携带 attempted ids 或 `FALLBACK` 缺少非空 attempted ids MUST 在 history、prompt、目录或 provider access 前失败；required signal 被取消时，assembly MUST 按统一 cancellation 语义结束，不返回 partial `ContextAssembly`。

**需求类别**：功能性需求

#### Scenario: Fallback 选择下一个可用模型
- **WHEN** fallback mode 包含有效 attempted ids，且存在未尝试的 available fallback-eligible activated model
- **THEN** selection 按 Agent 声明顺序选择第一个此类模型
- **AND** assembly 为该模型重新预算并渲染输入
- **AND** reason code 为 `FALLBACK_NEXT_ELIGIBLE`

#### Scenario: Attempted id 未激活
- **WHEN** fallback mode 包含不属于 accepted Agent activated set 的 id
- **THEN** selection 安全失败
- **AND** failure reason 为 `FALLBACK_ATTEMPTED_MODEL_NOT_ACTIVATED`

#### Scenario: Fallback 候选耗尽
- **WHEN** 没有未尝试的 available fallback-eligible model
- **THEN** selection 返回显式安全耗尽结果
- **AND** failure reason 为 `FALLBACK_EXHAUSTED`
- **AND** 不选择全局模型或未激活模型

#### Scenario: 客户端尝试发起 fallback 选择
- **WHEN** 客户端、runtime command、Capability result 或模型输出携带 fallback selection control
- **THEN** 这些 control 不被接受为选择权威

#### Scenario: Context assembly options 缺失
- **WHEN** trusted caller 以 `options=undefined` 请求 context assembly
- **THEN** Context Engine MUST 使用 `INITIAL` mode
- **AND** selection request MUST NOT 包含 attempted ids

#### Scenario: Context assembly options 组合非法
- **WHEN** `INITIAL` options 携带 attempted ids，或 `FALLBACK` options 缺少非空 attempted ids
- **THEN** assembly MUST 在读取 history、prompt 或模型目录前失败

### Requirement: 首轮用户 Query 主动记忆召回进入最终模型输入

当当前 Agent 已激活 `user-query-memory-recall` 的 `BEFORE_MODEL_INVOKE` 阶段时，系统 MUST 只在 `ModelInvokeBoundary.stepId` 为 `turn-1` 的首轮模型调用前执行主动召回。Hook MUST 在同一进程内以有界的 `requestRunId` 尝试集合原子判断该 RequestRun 是否已经尝试；已尝试的 fallback、续写或后续 tool round MUST 跳过读取。召回 MUST 以请求接受时已经确认的根用户消息正文作为唯一 `queryText`，执行一次不带记忆类型过滤、`limit=10`、`minConfidence=0.3` 的 L1 查询，并对全部 L1 候选读取 L2 详情。

只有 L1 与全部 L2 均成功时，系统才可将召回内容作为一条来源明确、USER 权限的请求私有背景消息加入本次最终模型输入。主动召回 MUST NOT 改写或持久化根用户消息、历史消息、`SessionMessage`、`ActiveContextView`、`ContextAssembly` 或模型工具调用记录，也 MUST NOT 替代模型后续自主调用 memory tools 的能力。

`flowVariables`、Hook config、Agent YAML、客户端 metadata、历史消息、模型输出和 capability 参数 MUST NOT 提供或覆盖 `queryText`。恢复、重放或跨实例执行重新开始首轮模型调用时，可以重新执行主动召回。

**需求类别**：功能性需求

#### Scenario: 首轮问题命中相关长期记忆
- **GIVEN** 当前 Agent 激活了 `user-query-memory-recall`，且 RequestRun 具有非空根用户消息
- **WHEN** 首个 `BEFORE_MODEL_INVOKE` 处理已完成装配和 render 的最终模型输入
- **THEN** 系统 MUST 使用根用户消息正文执行一次不带类型过滤、`limit=10`、`minConfidence=0.3` 的 L1 查询
- **AND** 系统 MUST 对全部 L1 候选各读取一次 L2 详情
- **AND** 全部读取成功且 L2 整体准入时，最终模型输入 MUST 只加入完整 L2 背景消息

#### Scenario: 检索词只来自可信根用户消息
- **GIVEN** 当前请求的 `flowVariables`、Hook config 或客户端 metadata 包含与根用户消息不同的文本
- **WHEN** 系统构造 L1 查询
- **THEN** 系统 MUST 仍使用已接受根用户消息正文作为唯一 `queryText`
- **AND** 其他字段 MUST NOT 改变该查询

#### Scenario: 非首次模型调用不重复主动召回
- **GIVEN** 当前 `ModelInvokeBoundary.stepId` 不为 `turn-1`，或该 RequestRun 已存在于当前进程的主动召回尝试集合
- **WHEN** 请求进入 fallback、续写或后续 tool round
- **THEN** 系统 MUST NOT 再执行 L1 或 L2
- **AND** 该次模型调用 MUST 使用不含本次临时召回消息的原有模型输入

#### Scenario: 未启用或根消息无效
- **GIVEN** 当前 Agent 未激活该 Hook，或可信根用户消息不存在、作用域不一致、角色不是 USER 或正文为空
- **WHEN** 系统准备最终模型输入
- **THEN** 系统 MUST 不调用 L1/L2
- **AND** 最终模型输入 MUST 保持原有内容

### Requirement: 主动记忆召回使用最终输入预算整体降级

系统 MUST 在既有上下文装配、历史压缩、large-content 处理和 render 完成后，使用本次最终模型消息、工具、模型上下文窗口和预留输出预算评估召回内容。系统 MUST 先整体评估完整 L2 背景消息；L2 超出可用输入预算时 MUST 整体评估同批完整 L1 摘要消息；L1 仍超限时 MUST 使用 `NO_CONTEXT`。L1/L2 MUST NOT 被截断、拆分、部分注入或触发第二次上下文装配、render 或历史压缩。

L1 未命中，或者 L1/任一 L2 发生失败、超时、取消、不可用、权限拒绝或不可披露时，系统 MUST 使用 `NO_CONTEXT`，不得使用部分结果。任一降级结果 MUST NOT 阻断模型调用、用户可见回复或 RequestRun 终态提交。

主动召回产生的诊断 MUST NOT 包含 Query、Owner Scope、记忆正文、记忆 ID 或模型消息；系统不得为区分召回结果新增包含受保护内容或高基数字段的观测事实。

**需求类别**：系统质量属性
**质量属性**：性能/容量、可靠性/恢复、审计/可追溯性
**适用范围**：该 Function

#### Scenario: L2 超限时整体降级为 L1
- **GIVEN** L1 与全部 L2 均成功，且既有上下文已经完成压缩和 render
- **WHEN** 完整 L2 消息超出模型窗口减预留输出预算后的剩余输入预算
- **THEN** 系统 MUST 整体评估同批完整 L1 摘要消息
- **AND** L1 可纳入时 MUST 只加入完整 L1 消息

#### Scenario: L1 仍超限
- **GIVEN** 完整 L2 消息不能纳入
- **WHEN** 同批完整 L1 摘要消息仍不能纳入
- **THEN** 最终模型输入 MUST 不含任何本次主动召回内容

#### Scenario: 任一读取失败时零注入且不重试
- **GIVEN** 当前 RequestRun 的主动召回已经开始
- **WHEN** L1 或任一 L2 失败、超时、取消、不可用、权限拒绝或不可披露
- **THEN** 系统 MUST 保留原最终模型输入
- **AND** 同一 RequestRun MUST NOT 重试 L1 或 L2
- **AND** 模型调用和终态提交 MUST 仍可完成

