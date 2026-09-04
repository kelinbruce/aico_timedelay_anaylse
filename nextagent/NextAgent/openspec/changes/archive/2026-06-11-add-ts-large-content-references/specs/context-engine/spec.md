## ADDED Requirements

> 本 spec 由 `add-ts-large-content-references` 向 `context-engine` capability 贡献的增量场景。归档前在 `openspec/specs/context-engine/spec.md` 落地，且**仅**贡献 large-content 复用相关增量；`add-ts-context-budget-explainability` 拥有 budget explainability 主体，本 spec 不重写其 requirement 名称或场景。
>
> Boundary：本 spec 不修改 `request-attachments` baseline；attachment 路径的分类与失败语义归 `add-ts-attachment-request-context-flow`。本 spec 的 budget 衔接通过 `add-ts-context-budget-explainability` 的 `PRE_SEND_CHECK_REQUIRED` / explicit insufficient-context 入口实现。
>
> 术语对齐：`LargeContentRef` 是 `ContentRef`（`agent-contracts/session`）在 large-content 用法下的语义角色名，**不新增 contract 类型**。详见 `design.md` 决策 术语与类型归属。

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

aggregate offload 决策 MUST 遵循以下顺序：保留 prior frozen decisions → 只考虑 fresh results → 按 size 从大到小 offload 直至聚合 ≤ aggregate 阈值或没有可选 fresh result 剩余。该决策不会因 60% history window budget 而改变顺序。

#### Scenario: Aggregate offload uses the shared threshold key

- **WHEN** 同一 user message 下 fresh text results 聚合体积 = 16385 chars
- **THEN** Context Engine MUST 使用 `adnclaw.large-content.aggregate-max-chars` 阈值判断，按 size 从大到小 offload 直至聚合 ≤ 16384 chars

#### Scenario: Threshold configuration override is honored

- **WHEN** `adnclaw.large-content.aggregate-max-chars` 被配置覆盖为 M
- **THEN** Context Engine MUST 以 M 为聚合阈值判断，不使用 16384 chars 硬编码
