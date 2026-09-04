## 背景和现状（Context）

本设计只回答大内容在请求生命周期中的统一处理策略：

- 什么时候存 ref；
- 什么时候把 fresh 结果 offload 成 ref；
- 模型上下文看到什么替代表达；
- replacement decision 如何跨轮冻结；
- 什么时候读 ref；
- 谁能读；
- 读多少；
- 读失败怎么办。

它不定义实现语言、模块拓扑或存储后端内部细节。

## 术语与类型归属

为避免与核心契约产生重复或冲突，本设计固定以下术语映射，**不新增 contract 类型**：

- `LargeContentRef`：`ContentRef`（`agent-contracts/session`）在“承载大内容主载体”这一用法上的语义角色名。规范围绕该角色规定 offload 行为、replacement 形态、读取顺序与失败投影，但**不引入新的 branded type**，不修改 `ContentRef` 的字段集合，不替换既有 `ContentRef.refType` 值集合。`ContentRef.refType` 首版可承载的取值由 `ContentRef` 既有所属集合（`"ATTACHMENT" | "CAPABILITY_RESULT" | "MODEL_SUMMARY" | "ARTIFACT"`，见 `core-contracts.md`）与本 change 的 `ContentRef.refType` 限定子集交集决定；本 change 不引入新 `refType` 值。具体约束见 决策 6.2 与 决策 6.3。
- `contentRef`（小写字段名）：指代 `ContentRef` 对象本身，与 `LargeContentRef` 同义。
- `BlobRef`（`agent-common`）：底层存储引用，由 `BlobStoreGateway` 持有并按 owner-scope 校验；`ContentRef` → `BlobRef` 的解析路径由 `BlobStoreGateway` 入口在 `refType` 分支下承担（`ATTACHMENT` 走 `attachmentId → RequestAttachment.storageRef`；`CAPABILITY_RESULT` / `ARTIFACT` 走 `refId → BlobStoreGateway.loadBlob` 形态），`ContentRef` interface 本身不增加 `storageRef` 字段。`BlobRef` 只暴露给 `BlobStoreGateway`，不得进入模型上下文、用户可见 stream、SafeError、audit 明细或结构化日志（与 `core-contracts.md` 既有约束一致）。
- 完整原始内容权威：来自 `BlobStoreGateway` 按 `ContentRef.refType` + `refId` 解析出的 `BlobRef`；session 持久化路径不直接持有大内容 bytes。`ContentRef` 仅承载 `refId` / `refType` / `mimeType` / `sizeBytes` / `safeSummary` / 可选 `attachmentId` / `artifactId`，不直接持有 `BlobRef`。

任何归档后的实现如需引入新 `ContentRef.refType` 值，必须先通过 contract refinement change 走 `agent-contracts/session` owner 流程；本 change 不在归档基线中沉淀新 refType。

## 目标和非目标（Goals / Non-Goals）

### 目标

- 定义统一的 externalize / offload / replacement 主流程。
- 定义 `INLINE`、`PERSISTED_PREVIEW`、`SPECIALIZED_REF`、`EMPTY_MARKER` 四种首版模型可见形态。
- 明确 fresh 结果预算选择策略：单结果阈值、同一消息聚合阈值、只处理 fresh、优先 offload 最大块。
- 明确 replacement decision 的可追溯性和 resume 稳定性。
- 明确 attachment、message body、archived capability result 三条路径的统一降级边界（attachment 路径的 `latest-request-critical` / `latest-request-optional` / `historical` / `excluded` 分类与失败投影遵循 `add-ts-attachment-request-context-flow`）。
- 明确大内容 replacement 是 `SessionMessage.content` / `SessionMessage.metadata` 中的模型可见状态，而不是后续轮次的临时 prompt 裁剪。

### 非目标

- 不新增后台 offload/projection job。
- 不改写 Query Policy 的预算 explainability 模型（属于 `add-ts-context-budget-explainability`）。
- 不把系统资产并入用户 owner-scoped 大内容域。
- 不覆盖原始 `SessionMessage`、archive 或 attachment 内容。
- 不在历史上下文变长后回头改写已经 frozen 的旧 tool result 表现形态。
- 不把 large content replacement 做成语义摘要；摘要属于 context compression / summary generation（`add-ts-context-compression` / `add-ts-traceable-summary-generation`）。
- 不重新定义 attachment `latest-request-critical` 失败语义（属于 `add-ts-attachment-request-context-flow`）。
- 不修改 `ContentRef` / `BlobRef` / `SessionMessage` 的字段集合或归属 subpath。

## 设计决策（Decisions）

### 1. Fresh-time offload，历史表现形态冻结

唯一策略是：

- fresh tool result / capability result / generated content / large message body 在进入会话历史或模型上下文前判断是否 inline 或 offload；
- 单个结果超过阈值时，完整内容优先写入 owner-scoped `ContentRef`（其解析出的 `BlobRef` 由 `BlobStoreGateway` 持有），模型可见内容替换为 preview + `contentRef` + safe metadata；
- 同一 user message / tool batch 聚合结果超过阈值时，只允许 fresh 结果参与替换，且按 size 从大到小 offload，直到回到聚合预算以内；
- 已经进入历史的表现形态冻结：previously replaced 的继续使用同一 replacement，previously inline 的不在后续轮次突然替换；
- replacement decision 必须写入即将持久化的 `SessionMessage.content` / `SessionMessage.metadata`，以支持 resume 和子 agent 恢复；
- 不依赖后台预展开。
- 不覆盖已持久化的 `SessionMessage.content`；fresh oversized message 的完整原始内容由 `ContentRef`（其解析出的 `BlobRef` 由 `BlobStoreGateway` 持有）承载，`SessionMessage.content` 保存模型可见 replacement。

#### 1.1 `inline-max-bytes` 与 budget cap 的关系

`inline-max-bytes`（`PERSISTED_PREVIEW` 单结果阈值）走独立配置命名空间 `adnclaw.large-content.*`，**不**与 `add-ts-context-budget-explainability` 的 60% history window budget 互相替代或覆盖：

- 单一 fresh result 超 `inline-max-bytes` → 走 `PERSISTED_PREVIEW` offload，由本 change 拥有；
- offload 后聚合超 60% history window budget → 由 `add-ts-context-budget-explainability` 走 `PRE_SEND_CHECK_REQUIRED` / 压缩 / 显式 insufficient-context 路径；
- offload 失败且 inline-fallback 不满足 → 显式 failure 走 `add-ts-context-budget-explainability` 的 insufficient-context 入口；
- 配置 key、默认值、单位（chars/bytes）、覆盖方式在 spec baseline 提升（task 0.1）阶段固化。

### 2. 允许触发点固定

externalize / offload / replacement 只允许由以下主流程触发：

- 消息写入阶段
- tool / capability result 持久化前阶段
- attachment blob 持久化阶段
- compaction / cleanup 已明确决定 archive 时
- 同步上下文装配阶段（只复用 frozen replacement；仅 fresh batch 聚合预算可产生新 replacement）
- 同步消息内容恢复阶段

### 3. 模型可见形态先冻结，预算与 compression 消费 frozen shape

- large-content policy 在 fresh 结果进入上下文前冻结模型可见形态；
- history selection 和 budget explainability 只消费 frozen inline/replacement shape；
- context compression 基于 frozen ActiveContextView 选择 prefix + recent tail，不重新 inline 原始大内容，也不把旧 inline 结果改成 preview；
- budget/compression 不得在预算算完后临时挑选任意历史 tool result 做替换；
- **render / 同步装配阶段永不改写历史大对象形态**：装配只消费已 frozen 的 `SessionMessage.content` / `metadata.replacement`，不在 render 时对历史大对象临时 offload、preview 或重写；唯一可产生新 replacement 的入口是 fresh batch（fresh 结果写入 / fresh tool batch 聚合预算），且只在内容写入 / 持久化前决定（见 Decision 1 与 Decision 2 触发点）。

### 4. Fresh result replacement 的固定判断顺序

遇到 fresh tool/capability/message content 时必须按以下顺序判断：

1. 空输出：写成显式 `EMPTY_MARKER`，例如 `(<toolName> completed with no output)`；
2. 非文本 / 图片 / 二进制 / 文档：路由到 specialized handler，模型可见形态为 `SPECIALIZED_REF`；
3. 单结果超过阈值：完整内容写入 owner-scoped `ContentRef`（其解析出的 `BlobRef` 由 `BlobStoreGateway` 持有），模型可见形态为 `PERSISTED_PREVIEW`；
4. 同一 user message / tool batch 聚合超过阈值：只对 fresh 文本结果按 size 从大到小 offload，生成 `PERSISTED_PREVIEW`；
5. 其余小文本：`INLINE`；
6. 记录 replacement decision、`contentRef`、preview size、original size、reason、lineage；
7. offload 失败按 Decision 5 收口，不得在判断顺序内隐式 inline 原始 block。

首版不做语义摘要，也不做复杂多档 projection。Preview 只用于识别输出类型、定位是否需要继续读取、提供 `contentRef` 访问路径；它不是完整事实来源。完整事实通过 `contentRef` / specialized ref 恢复读取。

### 4.1 模型可见形态

首版模型可见形态只有四类：

- `INLINE`：小文本，原样模型可见；
- `PERSISTED_PREVIEW`：大文本 / JSON / tool result，完整内容持久化为 `ContentRef`，模型看到 preview + `contentRef` + size + reason；
- `SPECIALIZED_REF`：图片、PDF、Excel、二进制、MCP blob 等，不 stringify，模型看到 descriptor + ref；
- `EMPTY_MARKER`：空输出显式占位。

`PERSISTED_PREVIEW` 的 preview 默认只取前段安全文本并尽量按行截断；具体字符数是策略默认值，可由配置覆盖。Preview MUST NOT include raw credentials, secrets, local paths, or other data classified as non-disclosure by the owning boundary.

#### 4.2 默认模型可见渲染模板

Spec 固定语义字段，具体文本格式属于设计选择。首版默认使用清晰的 tagged text block，方便模型识别和后续通过 `contentRef` 读取完整内容。

`PERSISTED_PREVIEW` 默认渲染：

```xml
<persisted-content>
Reason: {replacementReason}
Full content ref: {contentRef}
Original size: {originalSizeChars} chars
Preview:
{preview}
Access: Use the contentRef to request or read the full content when needed.
</persisted-content>
```

`SPECIALIZED_REF` 默认渲染：

```xml
<specialized-content>
Type: {contentType}
Content ref: {contentRef}
Descriptor: {safeDescriptor}
Access: Use the owning reader/projector for this content type.
</specialized-content>
```

`EMPTY_MARKER` 默认渲染：

```text
({sourceName} completed with no output)
```

实现可以替换 XML/文本外观，但必须保留 spec 要求的字段语义：kind/reason/ref/size/preview/access instruction 或等价安全 descriptor。

preview 子段（`PERSISTED_PREVIEW` 模板中的 `{preview}`）作为模板内部字段，不单存独立 typed extension；其模型可见来源唯一为 `SessionMessage.content` 渲染模板的最终输出。`metadata.replacement.previewSize` 仅记大小，不承载 preview 文本。详见 决策 6.2。

### 5. 失败分流（收口）

offload 失败不允许在判断顺序内隐式 inline 原始 block。统一收口为以下三步：

1. **先尝试 explicit inline fallback** —— 当且仅当原始 block 同时满足：体积 ≤ `inline-max-bytes`、不命中 provider hard cap、不命中安全策略黑名单。此时记录 `reason=degradation:offload-failed-into-inline-fallback` 到 replacement evidence（见 Decision 6.1）。
2. **否则触发显式 failure** —— 上述任一条件不满足时返回 `explicit failure` 或 `safe degraded marker`，携带 `reason=degradation:offload-failed-into-overflow`。该显式 failure 必须经 `add-ts-context-budget-explainability` 的 `PRE_SEND_CHECK_REQUIRED` / explicit insufficient-context 入口消费，避免与 budget explainability 路径出现二义性。
3. **禁止隐式 silent drop** —— 任何路径不得在不满足条件 1 的情况下静默吞掉原始 block，也不得在不满足条件 2 的情况下伪装成“已 inline”继续渲染 prompt。

其他失败场景：

- specialized ref 读取失败时返回 explicit marker / failure；
- 历史 replacement 读取失败时使用原 replacement marker 或 safe unavailable marker，不得静默删除；
- 跨 owner 或 ref 失效时返回 insufficient-context outcome，不静默删附件上下文（attachment 路径下遵循 `add-ts-attachment-request-context-flow` 的失败投影）。

### 6. replacement 内容保持可追溯和可恢复

replacement 内容进入上下文时必须保留：

- 稳定 identity（`ContentRef.refId`，由 `ContentRef` 自身持有）
- source refs / lineage（由 `SessionMessage.metadata.replacement.lineage` 承载，见 Decision 6.2；不在 `ContentRef` 上新增 `sourceRefs` 字段）
- replacement reason
- original size / preview size
- content type
- replacement decision state

replacement 读取失败时也必须显式降级，而不是静默删除整类上下文。

### 6.1 SessionMessage 是 replacement decision 的模型可见状态承载

大内容 replacement 改变的是后续模型可见形态，不改变原始事实：

- fresh oversized content 的完整原始内容由 owner-scoped `ContentRef`（其解析出的 `BlobRef` 由 `BlobStoreGateway` 持有）承载；
- 持久化的 `SessionMessage.content` 保存模型可见 replacement 文本，例如 persisted preview、specialized descriptor 或 empty marker；
- `SessionMessage.metadata` 保存 replacement evidence，**stable JSON shape**（见 Decision 6.2）；
- ActiveContextView 仍只保存该 `SessionMessage.messageId` 的有序引用，不保存 replacement payload，也不引入第二套模型可见状态；
- 后续轮次通过读取同一个 `SessionMessage` 复用已提交 replacement，不能从原始大内容重新恢复为模型可见全文；
- runtime checkpoint / timeline 由 runtime 或 runtime 协调路径记录，Context Engine 不直接拥有 lifecycle。

### 6.2 Replacement Evidence 稳定 JSON Schema

`SessionMessage.metadata.replacement`（typed extension，由 `refine-ts-context-assembly-contracts` 冻结并归属 `agent-contracts/session` owner；本 capability 只消费）必须符合以下 JSON shape。所有字段均为 JSON-compatible value；写入和读取时按 core-contracts 的 schema/type guard 校验。

```jsonc
{
  // 必填。replacement 形态枚举，与 SessionMessage.content 渲染保持一致。
  "kind": "INLINE" | "PERSISTED_PREVIEW" | "SPECIALIZED_REF" | "EMPTY_MARKER",
  // 必填。短字符串 reason code，例如
  //   "policy:oversized-single-result"
  //   "policy:oversized-aggregate-largest-first"
  //   "policy:non-text-binary"
  //   "policy:empty-output"
  //   "degradation:offload-failed-into-inline-fallback"
  //   "degradation:offload-failed-into-overflow"
  //   "degradation:read-failed"
  "reason": "string",
  // PERSISTED_PREVIEW / SPECIALIZED_REF 必填，其余可为空。
  "contentRef": "ContentRef | null",
  // INLINE / PERSISTED_PREVIEW / SPECIALIZED_REF 必填；EMPTY_MARKER 必填 0。
  "originalSize": "number (chars or bytes，按 content type 区分)",
  // PERSISTED_PREVIEW 必填；INLINE = originalSize；SPECIALIZED_REF = 0；EMPTY_MARKER = 0。
  "previewSize": "number (chars)",
  // PERSISTED_PREVIEW / SPECIALIZED_REF 必填。
  "contentType": "string (MIME 或业务 type)",
  // 必填。Source refs / lineage，引用上游 SessionMessage / run / capability invocation。
  "lineage": {
    "sourceMessageId": "MessageId | null",
    "sourceRunId": "RequestRunId | null",
    "sourceInvocationId": "CapabilityInvocationId | null",
    "stepId": "string | null"
  },
  // 可选。frozen decision 复用标记，跨轮和 resume 时判断是否可复用。
  "decisionState": "frozen",
  // 可选。明确失败或降级时填写。
  "degradation": {
    "code": "string",
    "message": "string (presentation-safe)",
    "readableContentRef": "ContentRef | null"
  } | null
}
```

约束：

- `kind` 必填且必须是上述四个枚举值之一；非法值在 schema/type guard 阶段拒绝写入。
- `contentRef.refType` 首版仅允许取 `ContentRef` 既有所属集合（`ATTACHMENT` / `CAPABILITY_RESULT` / `MODEL_SUMMARY` / `ARTIFACT`）的子集；本 change 不引入新 `refType` 值。`replacement.kind` → `ContentRef.refType` 的固化映射见本决策末尾的 6.2.1 映射表（首版四种 replacement kind 与既有 refType 的一一对应）。若归档时确认需要新增 refType，必须先走 `agent-contracts/session` owner 的 contract refinement change。
- `reason` 必填；reason code 集合是 stable vocabulary，新增 reason code 必须先在 spec 中追加。
- `degradation` 仅在显式降级或失败路径填写；正常路径填写 `null` 或省略。
- 该 typed extension 的命名空间、schema 文件归属由 `refine-ts-context-assembly-contracts` **固化**为 `agent-contracts/session/replacement-evidence.schema.json`（位于 `agent-contracts/session` 既有 stable subpath 之内，按 `core-contracts.md` 规则不新增 stable subpath export；typed extension 由 `agent-contracts/session` owner 管理，本 capability 只消费，与 `SummaryMessageMetadata` 等其他 typed extension 互不冲突）。若后续需迁出该 subpath，必须先走 `agent-contracts/session` owner 的 contract refinement change。
- `SessionMessage.metadata` typed extensions 由各自 capability owner 自管理；`replacement.kind` 枚举与 `SummaryMessageMetadata.kind`（`"CONTEXT_COMPRESSION_SUMMARY"`，见 `add-ts-context-compression`）不重叠；schema/type guard 在写入时按 `kind` 路由到各自 schema（replacement / summary / 其他 typed extension），避免跨 extension 串读或混用。
- preview 子段（`PERSISTED_PREVIEW` 模型可见内容中的 `{preview}` 段落）作为模板内部字段，**不**单存独立 typed extension；其模型可见来源唯一为 `SessionMessage.content` 渲染模板的最终输出（包含 XML 标签、reason、ref、size、preview 子段、access instruction）。`metadata.replacement.previewSize` 仅记录 preview 字符数大小，不承载 preview 文本。
- 首版 `decisionState` 仅允许 `"frozen"`；新增取值必须先在 spec `Large-content thresholds and configuration are fixed` requirement 与本决策中追加并经 `openspec validate --strict` 通过，再走 `agent-contracts/session` owner 的 contract refinement change。

### 6.3 `ContentRef` 解析与 owner-scope 校验 owner

#### 6.2.1 `replacement.kind` → `ContentRef.refType` 映射（固化）

为避免实施时多解，本 change 固化首版四种 `replacement.kind` 与 `ContentRef.refType` 的对应关系。`ContentRef.refType` 始终从既有集合 `ATTACHMENT` / `CAPABILITY_RESULT` / `MODEL_SUMMARY` / `ARTIFACT` 中选取，**不**新增 refType 值。

| `replacement.kind` | `ContentRef.refType` | 说明 |
|---|---|---|
| `INLINE` | `null`（不持有 ref） | 小文本原样模型可见，不产生 `ContentRef`；若 `metadata.replacement` 被显式填充，则 `contentRef=null` 仍是合法状态。 |
| `PERSISTED_PREVIEW` | `CAPABILITY_RESULT`（来自 tool / capability result）或 `ARTIFACT`（来自 generated file / `SessionMessage` body） | 按 fresh content 来源选择：tool result / capability result → `CAPABILITY_RESULT`；generated file content / `SessionMessage` body 走本 change 的 offload 路径 → `ARTIFACT`。 |
| `SPECIALIZED_REF` | `ATTACHMENT`（attachment-derived）或 `ARTIFACT`（MCP blob / 其它非文本二进制） | attachment 路径遵循 `add-ts-attachment-request-context-flow` 拥有，本 change 不重新分类；非 attachment 二进制 / MCP blob → `ARTIFACT`。 |
| `EMPTY_MARKER` | `null`（不持有 ref） | 空输出占位，无实际 ref；`contentRef=null`、`originalSize=0`、`previewSize=0`。 |

约束：

- `ContentRef.refType` 在 `metadata.replacement.contentRef` 上的取值 MUST 落在上表第二列；schema/type guard 在写入时按 `kind` 路由到对应 refType，非法组合拒绝写入。
- 上表不允许 `INLINE` 配 `CAPABILITY_RESULT` / `ARTIFACT` / `ATTACHMENT`，不允许 `EMPTY_MARKER` 持有 ref。
- attachment-derived `SPECIALIZED_REF` 路径走 `add-ts-attachment-request-context-flow` 拥有的 `request-attachments` capability，本 change 仅在消费 attachment 上下文时复用其判定产物。
- 映射调整（增加新组合或新增 `ContentRef.refType`）必须先在本决策 6.2.1 与 spec `Replacement kind maps to a fixed ContentRef refType` requirement 中同步追加，再走 `agent-contracts/session` owner 的 contract refinement change。


为避免与已冻结核心契约产生新 subpath export 或新 contract 类型，本 change 显式收口 `ContentRef` → `BlobRef` 解析与 owner-scope 校验的 owner：

- `ContentRef` 解析到 `BlobRef` 持有者由 `BlobStoreGateway` 承担；owner-scope 校验在 `BlobStoreGateway` 入口处基于 `IdentityContext.tenantId` / `IdentityContext.subjectId` 与 `ContentRef` 解析出的 owner 元数据完成。
- 本 change **不新增** `ContentRefResolver` 之类新 contract 类型，也**不**在 `agent-contracts/gateway` 引入新 stable subpath；`ContentRef` 读取路径复用 `BlobStoreGateway` 既有的 owner-scope 解析形态。
- 跨 owner / 未授权读取由 `BlobStoreGateway` 返回 `degradation.code=cross-owner` / `degradation.code=unauthorized`，与本 change 的 decision 5 三步收口衔接。
- 若后续 change 需要在 `BlobStoreGateway` 之外暴露 `ContentRef` 解析边界，必须先走 contract refinement change 走 `agent-contracts/gateway` owner 流程。

### 7. attachment 和二进制内容保持专用路径

- 请求接受前做校验；
- 上下文装配时再次确认可读性与授权；
- 图片、PDF、Excel、二进制附件不走通用文本 stringify；
- MCP / attachment 二进制按 MIME 类型或 owning gateway contract 保存为 `SPECIALIZED_REF`（对应 `ContentRef` 在二进制大内容上的用法）；
- 读取失败时显式 marker 或 safe failure；attachment 路径下遵循 `add-ts-attachment-request-context-flow` 的 `latest-request-critical` 失败投影。

### 8. 核心主流程

1. tool/message/attachment 产生内容时判断是否 inline / externalize / specialized ref；
2. 空输出生成 empty marker；
3. 单结果超过阈值则 persist full content 并生成 preview + `contentRef`（其解析出的 `BlobRef` 由 `BlobStoreGateway` 持有）；
4. 同一 user message / tool batch 聚合超阈值时，只对 fresh 结果按 size 从大到小 offload；
5. 写入模型可见 replacement 到 `SessionMessage.content`，写入 replacement evidence 到 `SessionMessage.metadata`，再通过既有 message append 主路径进入 ActiveContextView；
6. history selection 和 budget explainability 复用 frozen 模型可见形态；
7. context compression 在需要时压缩 frozen prior prefix（见 Decision 8.1 形态边界）；
8. 渲染最终模型输入，下游只消费 inline / preview / specialized ref / empty marker；
9. 伴随输出 machine-readable evidence。

### 8.1 Replacement 与 Compression / Summary 的形态边界

- **replacement 不做语义摘要**。`PERSISTED_PREVIEW` 是“完整内容被持久化、模型只看到 bounded preview + `contentRef`”，不是对原内容的总结或重写。
- **previously INLINE 的历史 tool result** 不被本 change 在历史变长后改写为 `PERSISTED_PREVIEW`。其降阶路径唯一由 `add-ts-context-compression` / `add-ts-traceable-summary-generation` 承担：压缩为 prefix 时生成 `ContentRef.refType=MODEL_SUMMARY` 指向的 summary `SessionMessage`，并在 summary message metadata 中标 `lineage=summary-from-inline`。
- **previously REPLACED 的历史** 仍由本 change 拥有：summary change 不重写已 frozen 的 `PERSISTED_PREVIEW`/`SPECIALIZED_REF`/`EMPTY_MARKER`，避免出现 inline → preview → summary 的二阶段形态漂移。
- budget/compression 不得在预算算完后临时挑选任意历史 tool result 改写为 replacement（重复 Decision 3 强调）。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 没有真实 identity 时只能返回 safe marker / specialized descriptor 或等价降级 | identity / cross-owner tests |
| 性能/容量 | 单结果和聚合分层限流，完整内容可恢复；replacement evidence 走 typed extension，不进 `RenderedModelInput` 诊断负载 | offload / aggregate tests |
| 可靠性 | replacement / `ContentRef` 读取失败走 Decision 5 收口，不得静默吞掉；与 `add-ts-context-budget-explainability` 的 `PRE_SEND_CHECK_REQUIRED` 入口衔接 | failure / degradation tests |
| 可维护性 | externalize、offload 与 replacement 职责分离；`LargeContentRef` 是 `ContentRef` 用法角色名，不新增 contract 类型 | contract tests |
| 可测试性 | 各触发点和失败分支可独立验证 | unit + integration tests |
| 可追溯性 | replacement / archive / offload 必须留下 safe evidence 并支持 resume；replacement evidence 走稳定 JSON schema | diagnostics / resume tests |

## 文档承载决策（Documentation Ownership）

- 行为契约：相关 `specs/*.md`（本 change 提升 `large-content-references` baseline；与 `add-ts-context-budget-explainability` 协同提升 `context-engine` 增量；不重写 `request-attachments` baseline）
- 架构与领域视图：相关 architecture / domain / contract 文档
- 如需长期保留取舍，可补充 ADR（候选 ADR：replacement 与 budget explainability 衔接、replacement 与 compression/summary 形态边界）

## 风险与取舍（Risks / Trade-offs）

- Fresh-time offload 会增加工具结果写入路径复杂度，但换来 prompt cache 稳定、后续轮次稳定复用和完整内容可恢复。
- Preview 会减少一次性模型可见正文，但这是容量取舍；完整内容仍可通过 `contentRef` / specialized reader 精确读取。
- Decision 5 的 explicit inline fallback 可能在极少数 “offload 失败但 block 较小” 的场景下回到原始 block；这是失败回退语义的必要代价，不应被读作“静默 inline”。
- 规格不绑定当前代码层级，后续整体迁移仍需保持相同行为。

## 待确认问题（Open Questions）

以下问题在 proposal / design 阶段已显式收口为**确定**行为，归档前不再变更：

- `LargeContentRef` 与 `ContentRef` / `BlobRef` 的关系：角色名 / 已有 contract / 已有 refType 子集（已确定，见 Decision 术语与类型归属）。
- replacement 与 compression / summary 的形态边界：previously INLINE 走 summary change，previously REPLACED 不被重写（已确定，见 Decision 8.1）。
- offload fallback 收口：inline-fallback 条件 + 显式 failure + 禁止 silent drop（已确定，见 Decision 5）。

以下边界已在 spec 的“首版默认值”小节显式量化固化，实现以 spec 为单一真相源（配置覆盖只能改默认值，不能绕过阈值语义）：

- `inline-max-bytes`（PERSISTED_PREVIEW 单结果阈值）：已固化为 **8192 chars**，配置 key `adnclaw.large-content.inline-max-bytes`。
- aggregate offload 阈值（同一 user message / tool batch 聚合阈值）：已固化为 **16384 chars**（2 × `inline-max-bytes`），按 chars 计，配置 key `adnclaw.large-content.aggregate-max-chars`。
- preview 字符数上限：已固化为 **1024 chars**，配置 key `adnclaw.large-content.preview-max-chars`。
- `reason` code 集合：在 spec 中以首版子集列出；扩展需走 `agent-contracts/session` owner 的 contract refinement change。
- replacement evidence typed extension schema 文件归属由 `refine-ts-context-assembly-contracts` 固化为 `agent-contracts/session/replacement-evidence.schema.json`，本 change 只消费该契约。

以上数值如需调整必须同步修订 spec 与本 design，不得只改其一。
