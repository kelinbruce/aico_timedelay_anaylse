## ADDED Requirements

> 本 spec 由 `add-ts-large-content-references` 首次建立 `large-content-references` capability 的 baseline。归档前在 `openspec/specs/large-content-references/spec.md` 落地。
>
> 术语对齐：本文中的 `LargeContentRef` 是 `ContentRef`（`agent-contracts/session`）的语义角色名，**不新增 contract 类型**，`ContentRef` interface 本身不增加 `storageRef` 字段。`ContentRef` → `BlobRef` 的解析路径由 `BlobStoreGateway` 入口在 `refType` 分支下承担（`ATTACHMENT` 走 `attachmentId → RequestAttachment.storageRef`；`CAPABILITY_RESULT` / `ARTIFACT` 走 `refId → BlobStoreGateway.loadBlob` 形态），owner-scope 校验在该入口按 `IdentityContext.tenantId` / `IdentityContext.subjectId` 完成。详见 `design.md` 决策 术语与类型归属 与 决策 6.3。
>
> Boundary：本 capability 不修改 `request-attachments` / `query-policy`；attachment 路径的 `latest-request-critical` 失败语义归 `add-ts-attachment-request-context-flow`；budget explainability 入口归 `add-ts-context-budget-explainability`。

### Requirement: Large content is externalized by policy

系统 SHALL 根据统一大小策略和领域触发点决定内容 inline 或 externalize。超过 `adnclaw.large-content.inline-max-bytes`（首版默认 8192 chars，固化于本 spec 后文"首版默认值"小节，配置覆盖只能改默认值而不能绕过阈值语义）的用户数据文本体、capability result 大 payload、generated file 内容和长 `SessionMessage` body MUST externalize 为 `ContentRef`（在 large-content 角色下称为 `LargeContentRef`）。二进制附件内容 MUST 始终以 owner-scoped ref 表达，不得进入普通 inline 消息、事件或日志正文。

externalize 的允许触发点只包括：

- 消息写入或更新前的同步 externalizer；
- attachment blob 存储阶段；
- Query Policy / compaction 流程已经决定将该内容转交给所属领域持久化层（`BlobStoreGateway` 或等价 owner-scope 存储）时，由上下文装配流程同步执行对应 archive 动作；该触发点不引入新的 `ContentRef.refType` 值，仅复用既有 `refType` 集合（`ATTACHMENT` / `CAPABILITY_RESULT` / `MODEL_SUMMARY` / `ARTIFACT`）；
- 其他已经由所属领域决定外部化的持久化阶段。

本 capability 只定义一旦 externalize / offload 发生后必须遵守的 `ContentRef`（含 `LargeContentRef` 角色）、owner scope、resolver、replacement decision 和 model-visible form 契约；它不新增后台 offload/projection job，也不把何时压缩、何时生成 summary replacement 内容的决策从 Query Policy 手中拿走。

#### Scenario: Oversized session message is externalized at write time

- **WHEN** `SessionMessage` 正文超过 `inline-max-bytes`
- **THEN** 系统在消息持久化前同步 externalize 完整正文
- **AND** inline 内容只保留 bounded preview / marker 与 replacement metadata
- **AND** 完整原始内容由 owner-scoped `ContentRef` 承载，`BlobRef` 解析路径由 `BlobStoreGateway` 在 `refType` 分支下按 owner-scope 持有

### Requirement: Large-content handling is differentiated by message source

系统 SHALL NOT 对所有 `SessionMessage` 一视同仁地应用 offload / preview / truncate。large-content 处理规则 MUST 按 message 来源分类，并遵循以下区别：

- **USER current request**（当前请求显式绑定的用户输入正文与 latest-request-critical 内容）：MUST NOT 被语义摘要，MUST NOT 被静默截断或静默丢弃。当前请求必需内容若无法装入预算、不可读、不可授权或无法安全 inline，系统 MUST 返回显式 insufficient-context outcome（经 `add-ts-context-budget-explainability` 的 `PRE_SEND_CHECK_REQUIRED` 入口消费），不得以 `PERSISTED_PREVIEW` excerpt 或 truncate 冒充完整当前请求内容。当前请求正文本身超长时，写时可 externalize 为 owner-scoped `ContentRef` 以保留完整事实，但装配当前请求时 MUST 以完整内容或显式 insufficient-context 表达，不得用 bounded preview 替代当前请求所需正文。
- **tool / capability result**：是 `PERSISTED_PREVIEW` / `SPECIALIZED_REF` / `EMPTY_MARKER` 与 truncate 的**主要**对象，按本 capability 的 fresh-time offload 判断顺序处理。
- **attachment-derived content**：分类（`latest-request-critical` / `latest-request-optional` / `historical` / `excluded`）与失败投影遵循 `add-ts-attachment-request-context-flow` 拥有的 `request-attachments` capability；本 change 仅消费其判定产物，不重新分类。
- **assistant history message 与 summary message**：其模型可见形态不被本 change 改写。previously `INLINE` 的历史降阶走 `add-ts-context-compression` / `add-ts-traceable-summary-generation` 的 `ContentRef.refType=MODEL_SUMMARY` 路径；previously `REPLACED` 的历史保持本 change 已 frozen 的形态。

#### Scenario: User current request is never semantically summarized or silently truncated

- **WHEN** 当前请求显式绑定的用户输入正文或 latest-request-critical 内容超过预算或在装配时不可读 / 不可授权
- **THEN** 系统 MUST 返回显式 insufficient-context outcome，经 `PRE_SEND_CHECK_REQUIRED` 入口消费
- **AND** MUST NOT 对当前请求所需正文做语义摘要、静默截断或用 bounded preview / excerpt 冒充完整内容

#### Scenario: Tool result is the primary preview/truncate target

- **WHEN** 一个 fresh tool / capability result 超过 `inline-max-bytes`
- **THEN** 系统按本 capability 判断顺序走 `PERSISTED_PREVIEW` / `SPECIALIZED_REF` / `EMPTY_MARKER`
- **AND** 该 preview / truncate 规则不适用于 USER current request 所需正文

#### Scenario: Assistant history and summary messages are not reshaped by this change

- **WHEN** 历史 assistant message 或 summary message 进入装配
- **THEN** 本 change 不改写其模型可见形态
- **AND** previously `INLINE` 的降阶走 summary change 的 `MODEL_SUMMARY` 路径，previously `REPLACED` 的保持本 change frozen 形态

### Requirement: Model-visible large content has stable replacement forms

系统 SHALL 将模型可见 large content 表达为稳定 replacement form，而不是默认把完整大内容长期 inline 到模型上下文。首版 replacement form MUST 至少覆盖：

- `INLINE`：小文本原样可见；
- `PERSISTED_PREVIEW`：完整内容写入 owner-scoped `ContentRef`，模型看到 bounded preview + `contentRef` + safe metadata；
- `SPECIALIZED_REF`：图片、PDF、Excel、二进制或其他非文本内容通过专用 ref/descriptor 表达；
- `EMPTY_MARKER`：空输出显式占位。

`PERSISTED_PREVIEW` 的模型可见内容 MUST expose, at minimum, the replacement kind, replacement reason, owner-scoped `contentRef`, original size, bounded preview, and an access instruction indicating that full content is available through the `contentRef`. The preview SHALL be bounded and presentation-safe.

`SPECIALIZED_REF` 的模型可见内容 MUST expose, at minimum, the replacement kind, content type or media type, owner-scoped ref, safe descriptor, and an access instruction for the owning reader/projector path. It SHALL NOT stringify binary/media/document payloads through the generic text path.

`EMPTY_MARKER` 的模型可见内容 MUST be a stable explicit marker indicating that the tool or content source completed with no output.

Budget / compression SHALL consume the frozen replacement form and SHALL NOT choose arbitrary historical large messages for late replacement after budget calculation.

#### Scenario: Empty output is explicit
- **WHEN** a tool result is empty or whitespace-only
- **THEN** the model-visible result is an explicit empty marker
- **AND** the protocol does not contain an ambiguous empty tool result

#### Scenario: Binary content uses specialized ref
- **WHEN** content is image, document, binary, or another non-text block
- **THEN** the generic text offload path does not stringify it
- **AND** the result is represented by a specialized ref or descriptor owned by the appropriate boundary

### Requirement: Replacement decisions are durable session-message facts

模型上下文路径中的 large-content replacement decision SHALL be durable enough for later turns and resume to reuse. For fresh oversized content, the persisted `SessionMessage.content` SHALL contain the model-visible replacement form, and `SessionMessage.metadata` SHALL contain replacement evidence（schema 见 design.md 决策 6.2）such as kind, `contentRef`, original size, preview size, reason, lineage, and safe content type. ActiveContextView SHALL continue to store only the resulting `SessionMessage.messageId` as an ordered model-visible reference.

Large-content replacement SHALL NOT overwrite an already persisted `SessionMessage`. For fresh oversized content, the full original content authority SHALL be the owner-scoped `ContentRef`（其 `BlobRef` 由 `BlobStoreGateway` 在 `refType` 解析时按 owner-scope 持有）, not the model-visible `SessionMessage.content`.

#### Scenario: Replacement is reused by later turns
- **WHEN** a large historical tool result has already been replaced by persisted preview
- **THEN** the next request reads the same `SessionMessage.content` / `metadata` replacement when assembling prior history
- **AND** it does not re-render the original large payload unless an explicit authorized expansion path is invoked

#### Scenario: Previously inline history is not changed later
- **WHEN** a historical tool result entered model-visible history as inline content
- **THEN** later budget pressure does not retroactively replace that historical content through this capability
- **AND** broader pressure is handled by context compression（`add-ts-context-compression` / `add-ts-traceable-summary-generation`）

### Requirement: Large content failures are explicit and recoverable

Large content write、read、offload、replacement content 和 cleanup failures SHALL produce explicit domain failure or degradation evidence。系统 MUST NOT 静默截断、静默丢弃 attachment content、message body、capability result、replacement content 或 generated file content。

Offload failure SHALL NOT implicitly inline the original block within the decision order. It MUST follow the three-step 收口 described in `design.md` 决策 5: 1) explicit inline fallback only when 原始 block ≤ `inline-max-bytes` AND 不命中 provider hard cap AND 不命中安全黑名单; 2) otherwise explicit failure or safe degraded marker carrying `reason=degradation:offload-failed-into-overflow`; 3) 禁止 silent drop.

#### Scenario: Offload failure is bounded by inline-max-bytes and policy

- **WHEN** offload 到 `ContentRef` 失败
- **AND** 原始 block 体积 ≤ `inline-max-bytes` 且不命中 provider hard cap / 安全黑名单
- **THEN** 系统可显式 inline fallback 并记录 `reason=degradation:offload-failed-into-inline-fallback`
- **AND** 完整路径必须在 replacement evidence 中保留 reason code

#### Scenario: Offload failure cannot be silently inlined under hard caps

- **WHEN** offload 失败且原始 block 体积超出 `inline-max-bytes` 或命中 provider hard cap / 安全黑名单
- **THEN** 系统返回 explicit failure 或 safe degraded marker
- **AND** `reason=degradation:offload-failed-into-overflow`
- **AND** 该显式 failure 必须经 `add-ts-context-budget-explainability` 的 `PRE_SEND_CHECK_REQUIRED` / explicit insufficient-context 入口消费

#### Scenario: Latest-request-critical large content cannot be silently dropped

- **WHEN** 当前请求所必需的 attachment-derived context、specialized ref 或 persisted content 无法读取、不可授权或无法安全 inline/fallback
- **THEN** 系统返回显式 failure 或 insufficient-context / degraded outcome
- **AND** 不通过删除该内容伪装成成功的上下文装配
- **AND** 失败投影遵循 `add-ts-attachment-request-context-flow` 的 `latest-request-critical` 失败语义

### Requirement: Replacement content remains traceable

通过 archive hint、cleanup replacement 或其他 replacement 内容进入上下文的大内容 SHALL 保留可追溯性。系统 MUST 在 `SessionMessage.metadata.replacement`（typed extension，由 `refine-ts-context-assembly-contracts` 冻结并归属 `agent-contracts/session` owner；schema 见 `design.md` 决策 6.2）中为替换产物保留稳定 identity、`ContentRef`、来源 message/run/invocation 关联或等价 provenance。

#### Scenario: Replacement content preserves provenance

- **WHEN** compaction 以 replacement 内容替代较早历史或 capability result
- **THEN** diagnostics MUST 保留 replacement identity / source refs / replacement reason
- **AND** replacement 读取失败时使用显式 placeholder 或 degradation marker

### Requirement: Replacement evidence schema is stable and JSON-typed

`SessionMessage.metadata.replacement` typed extension SHALL 符合 `design.md` 决策 6.2 给出的稳定 JSON shape（`kind` 必填枚举、`reason` 必填 reason code、`contentRef` / `originalSize` / `previewSize` / `contentType` / `lineage` / `decisionState` / `degradation`）。该 schema MUST 由 schema/type guard 在写入和读取时校验。

#### Scenario: Replacement evidence is rejected on invalid shape

- **WHEN** `SessionMessage.metadata.replacement` 写入或读取时缺少 `kind` / `reason` 必填字段
- **OR** `kind` 不属于 `INLINE` / `PERSISTED_PREVIEW` / `SPECIALIZED_REF` / `EMPTY_MARKER` 四个枚举值
- **THEN** schema/type guard 拒绝写入或拒绝暴露给下游
- **AND** 系统记录 schema-validation failure 到 diagnostics，不静默吞掉

### Requirement: Large-content thresholds and configuration are fixed

本 capability MUST 在 spec baseline 中显式固化首版 large-content 阈值与配置入口，所有实现以本节为准，配置覆盖只能改默认值而不能绕过阈值语义。

首版默认值（policy default，可被 `adnclaw.large-content.*` 配置命名空间覆盖）：

- `inline-max-bytes`：**8192 chars**（文本 / capability result / message body 单位为 chars；二进制 content 按 `ContentRef` 解出后的 bytes 计）。配置 key：`adnclaw.large-content.inline-max-bytes`。适用条件：单一 fresh result（tool result / capability result / generated file content / `SessionMessage` body）超过该阈值 MUST 走 `PERSISTED_PREVIEW` offload。
- aggregate offload 阈值：**16384 chars**（2 × `inline-max-bytes`），单位与 `inline-max-bytes` 一致（chars）。配置 key：`adnclaw.large-content.aggregate-max-chars`。适用条件：同一 user message / tool batch 下 fresh results 聚合体积超该阈值时，按 size 从大到小 offload 直至回到阈值以内。
- preview 字符数上限：**1024 chars**。配置 key：`adnclaw.large-content.preview-max-chars`。适用条件：`PERSISTED_PREVIEW` 模型可见模板中 `{preview}` 子段的最大字符数；超过时按行截断到该上限，截断后 MUST 在 preview 末尾加 presentation-safe 截断标记。

与 `add-ts-context-budget-explainability` 的 60% history window budget 的关系（**互不替代、不互相覆盖**）：

- `inline-max-bytes` / `aggregate-max-chars` 仅作用于 fresh-time offload 触发点；
- 60% history window budget 仅作用于 prior-history 域内的 selection / 压缩 / 显式 insufficient-context；
- 同一 fresh result 走 offload 后仍计入 history 时，由 budget explainability 单独判断是否需要 `PRE_SEND_CHECK_REQUIRED` / 压缩 / 显式 insufficient-context 入口；
- offload 失败且 inline-fallback 不满足时，explicit failure 走 `add-ts-context-budget-explainability` 的 insufficient-context 入口。

`reason` code stable vocabulary（首版全集）：

- `policy:oversized-single-result`：`PERSISTED_PREVIEW` 命中单结果阈值。
- `policy:oversized-aggregate-largest-first`：`PERSISTED_PREVIEW` 命中聚合阈值、按 size 从大到小 offload。
- `policy:non-text-binary`：`SPECIALIZED_REF`，非文本 / 二进制 / 文档 / MCP blob。
- `policy:empty-output`：`EMPTY_MARKER`，空输出显式占位。
- `degradation:offload-failed-into-inline-fallback`：offload 失败但满足 decision 5 条件 1（≤ `inline-max-bytes` 且不命中 provider hard cap / 安全黑名单）。
- `degradation:offload-failed-into-overflow`：offload 失败且不满足 inline-fallback 条件；走 explicit failure / safe degraded marker。
- `degradation:read-failed`：`ContentRef` / specialized ref 读取失败，回退到 safe marker 或 degraded outcome。

扩展流程：新增 reason code 必须先在本 spec requirement 与 `add-ts-large-content-references/design.md` 决策 6.2 中追加并经 `openspec validate --strict` 通过，再走 `agent-contracts/session` owner 的 contract refinement change。

Replacement evidence schema 文件归属（固化）：`agent-contracts/session/replacement-evidence.schema.json`（typed extension schema，由 `refine-ts-context-assembly-contracts` 冻结并归属 `agent-contracts/session` owner；本 capability 只消费）。该 subpath 在 `core-contracts.md` 既有的 `agent-contracts/session` 稳定 subpath 之内，**不**新增 stable subpath export。若后续需迁出该 subpath，必须先走 `agent-contracts/session` owner 的 contract refinement change。

#### Scenario: inline-max-bytes is enforced and configurable

- **WHEN** 单一 fresh text result 体积 = 8193 chars
- **THEN** 系统 MUST 走 `PERSISTED_PREVIEW` offload，记录 `reason=policy:oversized-single-result`
- **AND** 若 `adnclaw.large-content.inline-max-bytes` 被配置覆盖为 N，则 N+1 chars 时同样走 offload

#### Scenario: aggregate threshold offloads largest first

- **WHEN** 同一 user message 聚合 fresh 文本体积 = 16385 chars
- **THEN** 系统 MUST 按 size 从大到小 offload 直到聚合 ≤ 16384 chars，被 offload 的最大块记录 `reason=policy:oversized-aggregate-largest-first`

#### Scenario: preview is bounded

- **WHEN** `PERSISTED_PREVIEW` 模板渲染时 `{preview}` 子段超过 1024 chars
- **THEN** preview MUST 按行截断到 1024 chars 并附 presentation-safe 截断标记；`metadata.replacement.previewSize` 记录实际 preview 字符数（不含模板 XML 与截断标记）

#### Scenario: reason code outside stable vocabulary is rejected

- **WHEN** `metadata.replacement.reason` 写入一个未在本 requirement 列出的值
- **THEN** schema/type guard MUST 拒绝写入并记录 schema-validation failure

#### Scenario: aggregate offload does not consume history budget cap

- **WHEN** fresh offload 后聚合 PERSISTED_PREVIEW 进入 history
- **THEN** aggregate offload 决策不计入 60% history window budget 判断；budget cap 由 `add-ts-context-budget-explainability` 独立判断是否触发 `PRE_SEND_CHECK_REQUIRED`

#### Scenario: metadata.replacement is required for non-INLINE kinds and optional for INLINE

- **WHEN** 一个 `SessionMessage` 的 `kind` 为 `PERSISTED_PREVIEW` / `SPECIALIZED_REF` / `EMPTY_MARKER`
- **THEN** `SessionMessage.metadata.replacement` MUST 存在且必须通过 schema/type guard 校验
- **AND** 同 message 的 `replacement.kind` MUST 与 `SessionMessage.content` 渲染的形态一致（INLINE content 不允许携带 `replacement.kind=PERSISTED_PREVIEW` 元数据）
- **WHEN** 一个 `SessionMessage` 的 `kind` 为 `INLINE`
- **THEN** `SessionMessage.metadata.replacement` MAY 省略；若填写，MUST 同样满足稳定 JSON shape，且 `replacement.originalSize` 与 `replacement.previewSize` 必须一致且与 `SessionMessage.content` 实际字符数一致
- **AND** 未填写 `metadata.replacement` 时，不允许后续 agent / capability 从其他 typed extension 中推断出该 message 是否经历 replacement decision

该 scope 限定仅限本 capability，不改变 `SessionMessage.metadata` 其他 typed extension（例如 `SummaryMessageMetadata`）的填写规则；各 capability owner 各自维护。
### Requirement: Replacement kind maps to a fixed ContentRef refType

首版 `replacement.kind` 与 `ContentRef.refType` 的对应关系 MUST 按下表固化；schema/type guard 在写入 `metadata.replacement` 时按 `kind` 路由并校验 `contentRef.refType` 落在该映射允许的 refType 集合内，非法组合 MUST 拒绝写入并记录 schema-validation failure。本 change 不引入新 `ContentRef.refType` 值。

| `replacement.kind` | 允许的 `ContentRef.refType` | 必填字段约束 |
|---|---|---|
| `INLINE` | `null`（不持有 `ContentRef`） | `contentRef=null`；`originalSize` 与 `previewSize` 等于 `SessionMessage.content` 实际字符数；`contentType` 必填。 |
| `PERSISTED_PREVIEW`（来自 tool / capability result） | `CAPABILITY_RESULT` | `contentRef.refType="CAPABILITY_RESULT"`；`originalSize` / `previewSize` / `contentType` 必填。 |
| `PERSISTED_PREVIEW`（来自 generated file / `SessionMessage` body） | `ARTIFACT` | `contentRef.refType="ARTIFACT"`；`originalSize` / `previewSize` / `contentType` 必填。 |
| `SPECIALIZED_REF`（attachment-derived） | `ATTACHMENT` | 由 `add-ts-attachment-request-context-flow` 拥有；本 change 仅消费，不重写。 |
| `SPECIALIZED_REF`（MCP blob / 其它非文本二进制） | `ARTIFACT` | `contentRef.refType="ARTIFACT"`；`contentType` 必填；`previewSize=0`。 |
| `EMPTY_MARKER` | `null` | `contentRef=null`；`originalSize=0`；`previewSize=0`；`contentType` 必填。 |

约束：

- 不允许的组合（例如 `INLINE` 配 `CAPABILITY_RESULT`、`EMPTY_MARKER` 持有 ref、`PERSISTED_PREVIEW` 配 `MODEL_SUMMARY` 当 owner 来自 fresh oversized content 而非 summary change）MUST 在 schema/type guard 阶段被拒绝。
- attachment-derived 路径（`SPECIALIZED_REF` + `ATTACHMENT`）由 `add-ts-attachment-request-context-flow` 拥有，本 change 仅在消费 attachment 上下文时复用其判定产物，不重新分类或改写 refType。
- summary path（`ContentRef.refType="MODEL_SUMMARY"`）由 `add-ts-context-compression` / `add-ts-traceable-summary-generation` 拥有，本 change 不在 fresh offload 路径上使用；previously `INLINE` 的历史 tool result 走 summary change 生成的 `MODEL_SUMMARY` ref，不走本表的 `PERSISTED_PREVIEW` 行。
- 映射调整（增加新组合或新增 `ContentRef.refType`）必须先在本 requirement 与 `add-ts-large-content-references/design.md` 决策 6.2.1 中同步追加，再走 `agent-contracts/session` owner 的 contract refinement change。

#### Scenario: INLINE kind with non-null contentRef is rejected

- **WHEN** 一个 `SessionMessage` 的 `replacement.kind="INLINE"` 但 `metadata.replacement.contentRef != null`
- **THEN** schema/type guard MUST 拒绝写入并记录 schema-validation failure

#### Scenario: EMPTY_MARKER must not carry a contentRef

- **WHEN** 一个 `SessionMessage` 的 `replacement.kind="EMPTY_MARKER"` 但 `metadata.replacement.contentRef != null`
- **THEN** schema/type guard MUST 拒绝写入并记录 schema-validation failure

#### Scenario: PERSISTED_PREVIEW from tool result uses CAPABILITY_RESULT

- **WHEN** fresh tool result 体积超 `inline-max-bytes`，写入 `replacement.kind="PERSISTED_PREVIEW"`
- **THEN** `metadata.replacement.contentRef.refType` MUST 等于 `CAPABILITY_RESULT`
- **AND** schema/type guard 接受写入

#### Scenario: PERSISTED_PREVIEW from large message body uses ARTIFACT

- **WHEN** fresh oversized `SessionMessage` body 走 offload 路径，写入 `replacement.kind="PERSISTED_PREVIEW"`
- **THEN** `metadata.replacement.contentRef.refType` MUST 等于 `ARTIFACT`
- **AND** schema/type guard 接受写入

#### Scenario: SPECIALIZED_REF from MCP blob uses ARTIFACT

- **WHEN** non-text binary / MCP blob 写入 `replacement.kind="SPECIALIZED_REF"` 且来源非 attachment
- **THEN** `metadata.replacement.contentRef.refType` MUST 等于 `ARTIFACT`
- **AND** `metadata.replacement.previewSize` MUST 等于 `0`
