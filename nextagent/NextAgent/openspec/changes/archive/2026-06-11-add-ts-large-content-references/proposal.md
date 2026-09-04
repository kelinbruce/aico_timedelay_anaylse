## 背景与问题（Why）

当前系统已具备附件、大消息、能力结果归档和上下文读取中的大内容处理能力，但“大内容何时 externalize/offload、模型看到什么、替换决策如何跨轮稳定”还缺少一份统一 change。

本 change 需要统一回复：

- 哪些场景必须把内容转为可寻址的 `ContentRef`（owner-scoped，承载完整原始内容）；
- 哪些 fresh tool/message result 必须 offload 为可寻址资源；
- 模型上下文中大内容的稳定替代表达是什么；
- 缺乏真实 identity、gateway、预算或可读性时怎么处理；
- replacement decision 如何随 `SessionMessage.content` / `SessionMessage.metadata` 持久化并在 resume / 后续轮次复用；
- replacement 内容如何保持可追溯和可恢复。

> 术语说明：本文中的 `LargeContentRef` 是 `ContentRef`（`agent-contracts/session`）在“承载大模型可见大内容主载体”这一用法上的语义角色名；它**不新增 contract 类型**，不替代 `ContentRef.refType` 已有的 `MODEL_SUMMARY` 等值，也不替代 `BlobRef`（`agent-common`，底层存储引用）。`LargeContentRef` 与小写字段名 `contentRef` 在 spec 中同指 `ContentRef` 对象本身。

## 黑盒目标

- fresh 大内容在进入会话 / 模型上下文前被分类为 4 种稳定形态之一：`INLINE` / `PERSISTED_PREVIEW` / `SPECIALIZED_REF` / `EMPTY_MARKER`。
- 单结果超阈值：完整内容 persist 到 owner-scoped `ContentRef`（其解析出的 `BlobRef` 由 `BlobStoreGateway` 持有，`ContentRef` 自身不新增 `storageRef` 字段），模型只看到 bounded preview + `contentRef` + 安全元数据。
- 同消息聚合超阈值：保留 prior frozen 决策、只处理 fresh，按 size 从大到小 offload 直至回到聚合预算以内。
- 一旦决策落地即冻结：已替换的历史保持替换、已 inline 的历史不在后续轮次被突然替换。
- 二进制 / 图片 / PDF / Excel 走 `SPECIALIZED_REF`，不做通用文本 stringify。
- 完整原始内容权威来自 owner-scoped `ContentRef` / blob / archive / attachment source；`SessionMessage.content` 仅承载模型可见 replacement 文本，`SessionMessage.metadata` 承载 replacement evidence。
- latest-request-critical 附件 / 大内容不可读、过期、跨 owner 不可授权时返回显式 failure 或 insufficient-context outcome，不静默删除。
- 大内容处理按 message 来源分类：USER current request 绝不被语义摘要或静默截断（装不下走显式 insufficient-context）；tool/capability result 是 preview/truncate/ref 的主要对象；attachment 走 `add-ts-attachment-request-context-flow` 分类；assistant history 与 summary message 形态不被本 change 改写。

## 变更范围（What Changes）

- 明确 `ContentRef`（`LargeContentRef` 角色）在请求生命周期中的主流程接入点。
- 规定 fresh 结果的 offload 触发机制：单结果阈值、同一消息聚合阈值、内容类型专用路径和空输出占位。
- 明确模型可见替代表达：preview + `contentRef` + size/reason/lineage，或 specialized ref / empty marker。
- 明确 replacement decision 的冻结规则：同一 tool_use/message content identity 一旦决定 inline 或 replacement，后续轮次和 resume 必须复用同一表现形态。
- 明确输入前置条件：真实 owner identity、可用 gateway、contentRef/archive/attachment refs、replacement state。
- 明确输出与副作用：owner-scoped persisted content、model-visible `SessionMessage.content` replacement、`SessionMessage.metadata` replacement evidence、safe degradation marker、日志和审计安全证据。

## Capability 影响（Capabilities）

### 新增的 Capability

- `large-content-references`：定义 fresh-time offload、replacement 形态、replacement decision 冻结与跨轮复用、`SessionMessage` 上的 replacement 持久化、读取与失败显式降级。

### 修改的 Capability

- `context-engine`（与 `add-ts-context-budget-explainability` owner-share）：本 change 贡献 8 个增量 requirement（`Context Engine consumes frozen large-content replacements during assembly` / `Context Engine differentiates large content by message source` / `Fresh large content is offloaded before becoming history` / `Aggregate tool results are offloaded by largest fresh blocks first` / `Large-content replacement preserves original authority` / `Context Engine fails or degrades explicitly on large-content dependency issues` / `Context Engine does not rewrite replacement form during compression` / `Large-content thresholds referenced from context-engine are fixed`）；不重写 `add-ts-context-budget-explainability` 拥有的 budget requirement 名称或场景。attachment 大内容 revalidation 与 latest-request-critical 失败语义仍归 `add-ts-attachment-request-context-flow` 拥有的 `request-attachments` capability，本 change 不重复声明。`Context Engine consumes frozen large-content replacements during assembly` 的原 requirement 占位是 `ts-core-contracts/spec.md` "Context And Model Contract Baseline" 中"Context Engine MUST 拥有 context selection、budget、prompt shaping 和 large-content reference boundary"——本 change 补实 large-content reference boundary 这块空位。

> **不修改** `request-attachments` capability。`add-ts-attachment-request-context-flow` 仍是该 capability 的唯一 owner；本 change 仅在消费 attachment 上下文时复用其判定产物，不重新定义 `latest-request-critical` / `latest-request-optional` / `historical` / `excluded` 的分类规则与失败投影。

> **不修改** `query-policy` capability。`add-ts-context-budget-explainability` 仍是 `query-policy` 的 owner；本 change 的 replacement 与 budget explainability 的衔接由该 change 的 `PRE_SEND_CHECK_REQUIRED` / `DEGRADATION_NOTICE` 入口承担，本 change 不重新定义 budget 阈值或 reason 契约。

> **不修改** `add-ts-context-compression` 与 `add-ts-traceable-summary-generation` 的 summary 生成与形态边界。本 change 与这两个 change 互不重写 frozen 模型可见形态：previously `INLINE` 的历史 tool result 走 `add-ts-context-compression` / `add-ts-traceable-summary-generation` 生成的 `ContentRef.refType=MODEL_SUMMARY` 指向的 summary `SessionMessage`，本 change 不走 `PERSISTED_PREVIEW`；本 change 产生的 `PERSISTED_PREVIEW` / `SPECIALIZED_REF` / `EMPTY_MARKER` 也不被 summary change 重写。详见 `design.md` 决策 8.1。该双向约束需要 `add-ts-context-compression` / `add-ts-traceable-summary-generation` owner 在其 design 中同步明确。

> **不修改** `add-ts-attachment-intake` 拥有的 attachment lifecycle / staging 边界。本 change 仅在消费 attachment content 时复用 `add-ts-attachment-request-context-flow` 的判定产物（`latest-request-critical` / `latest-request-optional` / `historical` / `excluded` 分类与失败投影），不重新定义 attachment intake / staging 生命周期；两个 change 以 `RequestAttachment` owner-scoped fact 为分界。

## 影响范围（Impact）

- tool/capability/message 持久化前需要决定是否 offload，并在 `SessionMessage.content` / `metadata` 中记录模型可见 replacement decision。
- Context assembly 需要复用 `SessionMessage.content` / `metadata` 中的 replacement，避免历史大内容在后续轮次重新“复活”为模型可见全文。
- loader 需要稳定识别 ref、校验 identity / gateway、返回 preview/ref 或 specialized descriptor、生成 degradation marker 的顺序。
- attachment / archived result / externalized message body 需要遵循统一 failure/degradation 规则；attachment 路径的 `latest-request-critical` 失败语义遵循 `add-ts-attachment-request-context-flow`。
- 测试需要覆盖 single-result offload、aggregate offload、frozen decision、resume 重建、missing identity、gateway unavailable、cross-owner、specialized binary path、empty marker 和 replacement 读取失败。

## 归档前基线提升计划（Baseline Promotion Plan）

> 本 change 自身**新增** `large-content-references` 与 `context-engine` 增量两条 baseline spec。`context-engine` 的 baseline 由 `add-ts-context-budget-explainability` 与本 change 共同提升；提升时由本 change 维护的 spec 子集仅包含 large-content 复用相关增量，不重写 budget explainability 主体。

- 提升 `openspec/specs/large-content-references/spec.md`（本次新增 baseline）。
- 提升 `openspec/specs/context-engine/spec.md` 中本 change 贡献的增量场景（与 `add-ts-context-budget-explainability` 协同，**不**覆盖其 budget 主体）。
- 与 `add-ts-attachment-request-context-flow` 在 `request-attachments` baseline 上做归属确认：本 change 不修改该 baseline，仅在设计层面 cross-reference。
- 按需更新相关 overview / architecture / domain / contract 文档。
- 检查是否需要补充 ADR（offload fallback 与 budget cap 衔接、replacement 与 compression/summary 形态边界）。

## 主要 Owner

- **主 owner**：`agent-context-engine`（拥有 replacement 形态、聚合限流、freeze/reuse、Context Engine 消费 frozen replacement 入口）。
- **port 依赖**：`BlobStoreGateway`（提供 `BlobRef` 物理存储与 owner-scoped 解析）、`agent-contracts/session`（`ContentRef` 类型与 `SessionMessage` 持久化 owner）、`agent-contracts/gateway`（`SessionMessageStoreGateway` 等 persistence port）。
- **协调依赖**：`add-ts-attachment-request-context-flow`（attachment 路径分类与失败语义）、`add-ts-context-budget-explainability`（budget explainability 与 `PRE_SEND_CHECK_REQUIRED` 入口）。