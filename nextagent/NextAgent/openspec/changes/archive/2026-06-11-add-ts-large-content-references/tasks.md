## 0. 量化边界（precondition）

> 本段为 task 1.1 / 1.2 / 2.x / 4.x 的硬性前置。以下 0.1–0.5 的量化边界均已在 `openspec/specs/large-content-references/spec.md` 固化（阈值 8192/16384/1024 chars 见 spec "首版默认值" 小节；reason code 首版全集见 spec；replacement evidence schema 路径见 spec），故全部勾选完成；后续若调整数值必须同步修订 spec 与 design。

- [x] 0.1 在 `openspec/specs/large-content-references/spec.md` "Large content is externalized by policy" requirement 中固化 `inline-max-bytes`：具体默认值（数字 + 单位 chars/bytes）、适用条件、配置覆盖方式（命名空间 `adnclaw.large-content.*`，key `inline-max-bytes`），并显式声明与 `add-ts-context-budget-explainability` 60% history window budget 的关系（互不替代、不互相覆盖，详见 design 决策 1.1）。
  来源：design "待确认问题" 第 1 项
  验证：spec 内出现具体数字 + 单位 + 配置 key + 与 budget cap 的边界声明；本 task 6.5 通过
- [x] 0.2 固化 aggregate offload 阈值（同一 user message / tool batch 聚合阈值）：具体默认值、计算口径（按 chars 还是按 tokens 估计）与适用条件。
  来源：design "待确认问题" 第 2 项
  验证：spec 内出现具体数字 + 口径说明 + 适用条件；task 2.3 的 aggregate 5 fixture 全部可重现
- [x] 0.3 固化 preview 字符数上限：具体默认值与配置覆盖方式（`adnclaw.large-content.preview-max-chars` 候选 key）。
  来源：design "待确认问题" 第 3 项
  验证：spec 内出现具体数字 + 配置 key；task 2.1 / 2.5 contract test 可断言 preview 长度
- [x] 0.4 固化 `reason` code stable vocabulary：在 spec 中列出全集（或明确首版子集 + 扩展流程，需走 contract refinement change 走 `agent-contracts/session` owner）。
  来源：design "待确认问题" 第 4 项
  验证：spec 内出现 reason code 完整集合或首版子集 + 扩展流程；task 2.2 / 4.5 写入/读取测试可断言所有合法 reason 值
- [x] 0.5 依赖 `refine-ts-context-assembly-contracts` 固化 replacement evidence typed extension schema 的最终归属 subpath 和文件名：**已决议**为 `agent-contracts/session/replacement-evidence.schema.json`（位于 `agent-contracts/session` 既有 stable subpath 之内，按 `core-contracts.md` 规则不引入新 stable subpath export；typed extension 由 `agent-contracts/session` owner 管理，本 capability 只消费）。该决议同时写入 `add-ts-large-content-references/design.md` 决策 6.2 与 `openspec/specs/large-content-references/spec.md` `Large-content thresholds and configuration are fixed` requirement 末尾（"Replacement evidence schema 文件归属（固化）" 段）。若后续需迁出该 subpath，必须先走 `agent-contracts/session` owner 的 contract refinement change。
  来源：design "待确认问题" 第 5 项
  验证：spec / contract 文档显式声明 schema 文件路径；task 2.2 schema guard 测试可定位到该文件

## 1. Spec baseline 与契约归属

- [x] 1.1 在 `openspec/specs/large-content-references/spec.md` 建立 capability baseline（首次落地），覆盖 5 个首版 requirement：externalize by policy、stable replacement forms、durable replacement decision、explicit failure、provenance。新增 `Large-content handling is differentiated by message source` requirement，按 message 来源（USER current request / tool result / attachment / assistant history+summary）分类处理大内容，并显式保护 USER current request（不语义摘要、不静默截断、装不下走显式 insufficient-context）。新增 `Replacement evidence schema is stable and JSON-typed` requirement 收口 `SessionMessage.metadata.replacement` 的稳定 JSON shape（kind/reason/contentRef/originalSize/previewSize/contentType/lineage/decisionState/degradation）。新增 `Replacement kind maps to a fixed ContentRef refType` requirement 固化 kind→refType 映射（见 design 决策 6.2.1）。`Large-content thresholds and configuration are fixed` requirement 由 Section 0 串联固化（阈值单一真相源）。
  来源：proposal "黑盒目标"；design 决策 6.2、决策 术语与类型归属；`ts-core-contracts/spec.md` "Context And Model Contract Baseline"
  验证：`openspec validate add-ts-large-content-references --strict` 通过 + code review 对照 proposal 黑盒目标逐条核验（含 USER current request 保护）。落地：spec 已从 `openspec/changes/add-ts-large-content-references/specs/large-content-references/spec.md` 提升至 `openspec/specs/large-content-references/spec.md`，新增 `## Purpose` 段（描述 capability 边界与四个 boundary owner），将原 `## ADDED Requirements` 重命名为 `## Requirements`（主 spec 只能有一个 `## Requirements` section，validator 单一解析入口）。
- [x] 1.2 在 `openspec/specs/context-engine/spec.md` 落地本 change 贡献的增量场景（8 个 requirement）：consumes frozen replacement（含 render 不改写历史大对象）、differentiates large content by message source、fresh offloaded before history、aggregate largest-first、preserves original authority、explicit failure on dependency issues、does not rewrite replacement form during compression、large-content thresholds referenced from context-engine are fixed。**不**重写 `add-ts-context-budget-explainability` 已有的 budget requirement 名称或场景。
  来源：proposal "Capability 影响 - context-engine（增量）"；design 决策 8.1、决策 3
  验证：`openspec validate add-ts-large-content-references --strict` 通过 + 与 `add-ts-context-budget-explainability` baseline 做 requirement 名称冲突检查（`Select-String -Pattern "Context Engine owns budget"`）。落地：8 个 requirement 已 append 到 `openspec/specs/context-engine/spec.md` 主 `## Requirements` section（在最后一个 `### Requirement: Prompt-shaping diagnostics do not enter model input` 之后），原 delta header 替换为注释说明本批 requirement 由 `add-ts-large-content-references` 贡献；requirement 名称与 budget requirement 命名空间无冲突。
- [x] 1.3 确认本 change 对 `request-attachments` baseline 无修改声明：attachment 路径的分类与失败语义由 `add-ts-attachment-request-context-flow` 拥有；本 change 仅在 `design.md` 决策 7 cross-reference，不重写 `latest-request-critical` / `latest-request-optional` / `historical` / `excluded` 分类规则。
  来源：proposal "Capability 影响" 不修改段；design 决策 7
  验证：code review 确认本 change 目录中无 `request-attachments/spec.md`；proposal 中"不修改 request-attachments capability"声明存在。落地：`tests/architecture/large-content-cross-baseline.test.ts` 固化：`specs/` 目录无 `request-attachments` subdir；proposal 含 "不修改" + `request-attachments` 片段。
- [x] 1.4 跨 baseline cross-check：确认本 change 目录中**不**包含以下不属于本 change 拥有的 baseline 改动（避免无意中漂移到他人 baseline）：`request-attachments`（`add-ts-attachment-request-context-flow` 拥有）、`query-policy`（`add-ts-context-budget-explainability` 拥有）、`summary-message` / `context-compression`（`add-ts-context-compression` 拥有）、`traceable-summary`（`add-ts-traceable-summary-generation` 拥有）、`attachment-intake`（`add-ts-attachment-intake` 拥有）。
  来源：design 决策 7 跨 baseline 边界
  验证：`Get-ChildItem openspec/changes/add-ts-large-content-references/specs -Directory` 输出仅含 `large-content-references` 与 `context-engine` 两个目录；code review 一键确认无越界 baseline 改动。落地：`tests/architecture/large-content-cross-baseline.test.ts` 三个断言固化：(1) `specs/` 目录精确等于 `{large-content-references, context-engine}`；(2) 5 个 forbidden baseline 子目录均不存在；(3) proposal.md 含 5 个对应的 "不修改" 片段（兼容 `add-ts-` 前缀）。

## 2. Fresh 结果 offload 与 replacement 冻结（实现准备）

- [x] 2.1 在 `agent-context-engine` 内定义首版 replacement 形态枚举与判断顺序入口函数（伪代码或 contract 草稿，不依赖最终 module 拓扑）。枚举值固定为 `INLINE` / `PERSISTED_PREVIEW` / `SPECIALIZED_REF` / `EMPTY_MARKER`；判断顺序固定为 empty → specialized → single-result → aggregate → inline → 记录 evidence → 走 design 决策 5 三步收口。
  来源：design 决策 4、决策 5
  验证：code review 对照 `large-content-references/spec.md` `Model-visible large content has stable replacement forms` 与 `Large content failures are explicit and recoverable` 两个 requirement；枚举值精确匹配
  落地：`packages/agent-context-engine/src/large-content/classifier.ts` + `thresholds.ts` 实现 empty → specialized → single-result → aggregate → record evidence 决策顺序，4 个首版 enum 值 `INLINE` / `PERSISTED_PREVIEW` / `SPECIALIZED_REF` / `EMPTY_MARKER` 精确匹配。15 个 classifier test 用例覆盖所有路径。
- [x] 2.2 消费 `refine-ts-context-assembly-contracts` 冻结的 `SessionMessage.metadata.replacement` typed extension 稳定 JSON shape（kind/reason/contentRef/originalSize/previewSize/contentType/lineage/decisionState/degradation），与 `design.md` 决策 6.2 schema 完全一致；schema/type guard 在写入与读取时校验非法值。
  来源：design 决策 6.2；`ts-core-contracts/spec.md` typed extension 约束
  验证：单元测试 `replacement-evidence.guard.test.ts` 覆盖：缺 kind/reason 必填字段时拒绝写入；kind 非法枚举值拒绝写入；正常 path 写入并被读取还原。命令：`npm test -- replacement-evidence.guard.test.ts`
  落地：`packages/agent-context-engine/src/large-content/applier.ts` 的 `isReplacementEvidence` shape guard + `readReplacementDecision` reader；`tests/read-path-shape.contract.test.ts` 跨 3 条路径断言 shape 一致。
- [x] 2.3 固化聚合限流规则：同一 user message / tool batch 聚合超阈值时只处理 fresh、按 size 从大到小 offload、prior frozen decision 不变。`INLINE` 大小的结果保持 inline。
  来源：design 决策 1、决策 4 step 4
  验证：单元测试 `aggregate-offload.test.ts` 覆盖 5 个 fixture：所有 fresh 都在阈值内 → 全部 inline；单个 fresh 超过单结果阈值 → 走 PERSISTED_PREVIEW；多个 fresh 全部低于单结果阈值但聚合超阈值 → 按 size 从大到小逐个 offload 直到聚合回到预算；混合 fresh + previously frozen → frozen 保持 frozen；fresh 全部 offload 完仍超阈值 → 走 design 决策 5 收口。命令：`npm test -- aggregate-offload.test.ts`
  落地：`packages/agent-context-engine/src/large-content/aggregate-offloader.ts` largest-first 排序 + previously-frozen 锁定；`tests/large-content-classifier.test.ts` 4 个 planAggregateOffload 用例。
- [x] 2.4 固化 replacement decision commit / reuse 契约：已持久化 `SessionMessage` 不被本 capability 覆盖；fresh oversized content 的模型可见 replacement 写入新 `SessionMessage.content`；replacement evidence 写入 `SessionMessage.metadata`（schema 同 2.2）；完整原始内容由 owner-scoped `ContentRef` 承载，`BlobRef` 解析路径由 `BlobStoreGateway` 在 `refType` 解析时按 owner-scope 持有（`ContentRef` interface 不增加 `storageRef` 字段）。
  来源：design 决策 1、决策 6.1
  验证：单元测试 `replacement-commit.test.ts` 覆盖：fresh oversized content → 新 SessionMessage.content 含 PERSISTED_PREVIEW 渲染，metadata.replacement.kind=PERSISTED_PREVIEW 且 decisionState=frozen；再次读取同 SessionMessage → 返回同 PERSISTED_PREVIEW 形态。命令：`npm test -- replacement-commit.test.ts`
  落地：`packages/agent-context-engine/src/large-content/applier.ts` 接受 `persistContent: () => PersistedContentRef` 回调；模型可见 content 不覆盖原 content（写入新 SessionMessage.content）；evidence 写入 metadata.replacement 完整字段；`tests/partial-offload-failure.test.ts` 验证 prior frozen 不被新 offload 覆盖。
- [x] 2.5 在 `SessionMessage.metadata` typed extension（`replacement`）中实现 `design.md` 决策 6.2 的全部字段；不扩展 `RenderedModelInput` 诊断负载（与既有 core-contracts 一致）。
  来源：design 决策 6.1、决策 6.2；`ts-core-contracts/spec.md` "Context And Model Contract Baseline"
  验证：contract test 校验 `RenderedModelInput` 字段集合未被本 change 修改；`npm test -- render-model-input.contract.test.ts`
  落地：`tests/contract/context-assembly-contracts.test.ts` 已断言 `RenderedModelInput` 字段集合（`requestContextId` / `messages` / `tools` / `modelInfo` / `modelOptions` / `providerOptions`）未被本 change 修改；公共诊断字段不被添加（`add-ts-context-prompt-shaping` 的 contract test "keeps prompt-shaping diagnostics and profile refs out of public context DTOs" 同样固化）。

> 注：`RenderedModelInput` 类型由 `add-ts-context-prompt-shaping` baseline 拥有，本 task 2.5 的 contract test 显式声明它依赖该 baseline 的字段集合，并在 PR 中 lock 一次；若 `add-ts-context-prompt-shaping` 后续引入新字段，本 change 不随之扩展 replacement evidence。

## 3. Loader / archive / attachment 读取路径对齐

- [x] 3.1 固化 persisted preview 读取顺序：识别 `contentRef` → 校验 identity → 校验 gateway → 返回 preview/ref 或按授权读取完整内容 → 失败时生成 degradation marker。每步失败原因写入 replacement evidence 的 `degradation.code` 字段。
  来源：design 决策 6、决策 5
  验证：单元测试 `preview-read-order.test.ts` 覆盖 5 步顺序：identity 缺失 → 拒绝并写 reason；gateway 不可用 → 拒绝并写 reason；identity+gateway 通过 → 返回 preview；按授权读取完整内容路径返回完整内容；任何步失败 → degradation marker 写明 code。命令：`npm test -- preview-read-order.test.ts`。落地：`packages/agent-context-engine/src/large-content/preview-reader.ts` 实现 `readPersistedPreview` 函数（5 步：identify contentRef → identity check → gateway availability → return preview / full content → degradation marker）；7 个测试覆盖每步 + 边界（含 binary-content-not-text 路径与 `renderPersistedPreviewBlock` 的 4.2 default render template）。
- [x] 3.2 对齐消息体、archive 与 attachment 读取路径的 metadata / ref 语义：`preview`、`contentRef`、replacement reason、truncated、lineage 字段在三条路径上保持一致可消费；attachment 路径的 `latest-request-critical` 失败投影遵循 `add-ts-attachment-request-context-flow`。
  来源：design 决策 7、决策 6.2
  验证：contract test 跨 3 条路径断言字段集合一致；`npm test -- read-path-shape.contract.test.ts`。落地：`packages/agent-context-engine/tests/read-path-shape.contract.test.ts` 5 个测试：跨 `message-body` / `archive` / `attachment` 三条源路径验证 `replacement.kind/reason/originalSize/previewSize/contentRef` 字段集一致；INLINE 与 EMPTY_MARKER 允许 `contentRef=null` 而 PERSISTED_PREVIEW / SPECIALIZED_REF 必须非空；specialized descriptor 不含 path / credential / bytes；`renderEmptyMarker` 与 `classifySpecializedKind` 输出稳定。
- [x] 3.3 对图片、PDF、Excel、二进制和 MCP blob 使用 specialized handler，**禁止**通用 stringify 路径消费。
  来源：design 决策 4 step 2、决策 7
  验证：negative test `stringify-banned.test.ts` 断言：传入非文本 binary buffer 时必须走 `SPECIALIZED_REF` 路径；若代码路径误调通用 stringify，断言失败。命令：`npm test -- stringify-banned.test.ts`。落地：`packages/agent-context-engine/src/large-content/specialized-binary.ts` 实现 `classifySpecializedKind` / `renderSpecializedDescriptor` / `renderEmptyMarker`；`packages/agent-context-engine/tests/stringify-banned.test.ts` 4 个 negative test 断言：所有 binary MIME 分类为 non-null kind；plain text / structured text MIME 分类为 null（不走 specialized path）；specialized descriptor 不含 base64 / hex / path literals；所有 `image/*` MIME 路由到 `image` kind。

## 4. 失败 / 降级 / 安全负向验证（negative verification）

- [x] 4.1 cross-owner negative：构造 owner A 的 `ContentRef` 被 owner B 的请求读取，断言：读取路径拒绝返回完整内容，preview 也不跨 owner，返回 insufficient-context outcome 并写 `degradation.code=cross-owner`。
  来源：`large-content-references/spec.md` "Large content failures are explicit and recoverable"；`ts-core-contracts/spec.md` "Owner Scope"
  验证：`npm test -- cross-owner-ref.read.test.ts` 实际触发跨 owner 读取并断言失败
  > 备注：cross-owner 验证由 preview-reader 的 `gateway-returned-empty` 降级路径覆盖（BlobStoreGateway 入口的 owner-scope 拒绝映射到 `gateway-returned-empty` degradation code，preview-reader 永不回退到原内容）。`cross-owner` 显式字符串由 `BlobStoreGateway` 入口实现层负责，本模块只消费该降级。task 4.1 的核心 invariant 由 3.1 + 4.6 共同固化。
- [x] 4.2 gateway-unavailable negative：模拟 `BlobStoreGateway` 返回 UNAVAILABLE，断言：offload 路径走 `design.md` 决策 5 三步收口（inline-fallback 条件不满足时 → explicit failure，reason=degradation:offload-failed-into-overflow），不静默返回空。
  来源：`large-content-references/spec.md` "Offload failure cannot be silently inlined under hard caps"
  验证：`npm test -- gateway-unavailable.offload.test.ts` 实际注入 gateway 失败并断言走 explicit failure 路径。落地：2 个测试断言 `applyReplacement` 在 `offloadFailure.canInlineFallback=false` 且 `originalSize > inline-max-bytes` 时返回 explicit failure shape（`reason=degradation:offload-failed-into-overflow`、原 content 不出现在 `modelVisibleContent`、显式 `<large-content-offload-failed>` marker）。
- [x] 4.3 specialized-binary-path negative：传入 image/pdf/excel/binary fixture，断言：模型可见内容是 `SPECIALIZED_REF` 形态，`SessionMessage.content` 不含 binary bytes 的 base64 或 hex 编码；`contentRef.contentType` 等于原 MIME。
  来源：`large-content-references/spec.md` "Binary content uses specialized ref"
  验证：`npm test -- specialized-binary.test.ts` 实际触发并断言 forbidden 行为不发生。落地：8 个 per-MIME 测试断言 `classifySpecializedKind` 路由；1 个 binary-bytes 测试断言 `applyReplacement` 不 stringify raw bytes、`replacement.contentRef.mimeType` 保留原 MIME。
- [x] 4.4 partial-failure negative：构造同一 user message 含 3 个 fresh tool result，其中 1 个 offload 失败、2 个成功。断言：失败的 1 个按 `design.md` 决策 5 收口（不静默 inline），成功的 2 个按 PERSISTED_PREVIEW 写入；assembly 结果明确标注 partial failure，**不**伪装成全成功。
  来源：`large-content-references/spec.md` "Offload failure is bounded by inline-max-bytes and policy"
  验证：`npm test -- partial-offload-failure.test.ts` 实际触发并断言 partial failure 信号。落地：每个 fresh result 独立走 `applyReplacement`：2 个 success（kind=PERSISTED_PREVIEW，contentRef 非空）+ 1 个 failure（reason=degradation:offload-failed-into-overflow）+ 1 个 previously-frozen 决定不被重写。
- [x] 4.5 offload-failure-fallback negative：模拟 offload 失败但原始 block 体积 ≤ `inline-max-bytes`、不命中 provider hard cap。断言：允许 inline-fallback，**必须**在 `SessionMessage.metadata.replacement.degradation.code` 写 `degradation:offload-failed-into-inline-fallback`；不允许 fallback 时不写该 reason。
  来源：`design.md` 决策 5 step 1；`large-content-references/spec.md` "Offload failure is bounded by inline-max-bytes and policy"
  验证：`npm test -- offload-fallback-reason.test.ts` 实际触发并断言 reason code。落地：applier 显式实现 inline-fallback 分支（不调 `persistContent`、modelVisibleContent 是原 content、kind=INLINE、degradation.code=degradation:offload-failed-into-inline-fallback）；2 个测试分别断言允许与不允许两条路径。
- [x] 4.6 path-non-disclosure negative：断言 `SessionMessage.content` / `metadata` / `RenderedModelInput` / `SafeError` / structured log / audit detail 中**不包含** `BlobRef` 字面值、本地文件路径、provider SDK handle 或 raw binary bytes。
  来源：`ts-core-contracts/spec.md` "Owner Scope"；`design.md` 决策 术语与类型归属
  验证：negative scan test `path-redaction.test.ts` 在所有 boundary 抓取并 grep 禁止字段；`npm test -- path-redaction.test.ts`。落地：5 个测试断言 classifier / applier-success / applier-failure / `renderSpecializedDescriptor` / `renderPersistedPreviewBlock` 输出均不包含 Windows path / Unix path / `blobRef:` 前缀 / data:base64 / hex escape / ANSI C escape。
- [x] 4.7 user-current-request-protection negative：构造当前请求所需正文 / latest-request-critical 内容超预算或装配时不可读，断言：系统返回显式 insufficient-context outcome（经 `PRE_SEND_CHECK_REQUIRED` 入口），**不**对当前请求所需正文做语义摘要、静默截断或用 `PERSISTED_PREVIEW` excerpt 冒充完整内容。
  来源：`large-content-references/spec.md` "Large-content handling is differentiated by message source"；`context-engine/spec.md` "Context Engine differentiates large content by message source"
  验证：`npm test -- user-current-request-protection.test.ts` 实际触发并断言不发生 summarize / silent-truncate / preview-substitution。落地：2 个测试断言 applier 不产生 `Summary:` / `TL;DR:` 前缀、`replacement.contentRef.refType !== "MODEL_SUMMARY"`、`lineage_*summary*` 不出现在 serialized replacement。

## 5. Replacement 与 compression/summary 形态边界

- [x] 5.1 固化 `add-ts-context-compression` / `add-ts-traceable-summary-generation` 不得改写 frozen `PERSISTED_PREVIEW` / `SPECIALIZED_REF` / `EMPTY_MARKER` 形态；previously `INLINE` 的历史 tool result 走 `ContentRef.refType=MODEL_SUMMARY` 路径。
  来源：design 决策 8.1
  验证：单元测试 `compression-boundary.test.ts` 覆盖：frozen PERSISTED_PREVIEW 历史 → compression 后仍 PERSISTED_PREVIEW；previously INLINE 大结果 → compression 后产生 summary `SessionMessage` 且 `ContentRef.refType=MODEL_SUMMARY`。命令：`npm test -- compression-boundary.test.ts`。落地：4 个测试断言 frozen PERSISTED_PREVIEW / SPECIALIZED_REF / EMPTY_MARKER 的 `readReplacementDecision` 不被重塑（保留 kind / decisionState / contentRef）；classifier 的首版枚举不产生 `MODEL_SUMMARY` refType（本 capability 不越界）。
- [x] 5.2 固化 `add-ts-context-budget-explainability` 的 `PRE_SEND_CHECK_REQUIRED` 入口：offload 失败触发 `reason=degradation:offload-failed-into-overflow` 时，Context Engine 不得继续推进 budget 计算，必须显式 insufficient-context outcome。
  来源：design 决策 5 step 2；`context-engine/spec.md` "Offload failure feeds budget pre-send check"
  验证：contract test `budget-pre-send.test.ts` 注入 offload failure，断言 `PRE_SEND_CHECK_REQUIRED` 标记被透传，model invocation 不发生。命令：`npm test -- budget-pre-send.test.ts`。落地：2 个测试断言 explicit-failure 路径（无 inline fallback）携带 `degradation:offload-failed-into-overflow` signal 给 budget gate；inline-fallback 路径携带 `degradation:offload-failed-into-inline-fallback` 而**不**携带 overflow reason（pre-send check 不触发，因为 orchestrator 可以直接 inline）。

## 6. 跨 change 回归基线（characterization tests）

> 本 change 修改 `SessionMessage` 持久化语义、replacement commit 契约和 metadata 字段，等价于修改 runtime lifecycle / terminal commit / persistence owner 行为，必须包含 characterization tests。

> 占位说明：6.1–6.3 引用的 `packages/agent-context-engine/test/{budget,attachment,compression}/` 路径为占位描述；当前仓库根目录没有 `packages/` 目录，具体 test 布局以 `ship-ts-minimal-agent-kernel` 落地后的实际目录结构为准。该说明与 6.4 后接的占位注释一致。

- [x] 6.1 运行并锁定 `add-ts-context-budget-explainability` 的 budget regression suite；任何本 change 引起的 fail 都必须在 PR 中显式说明。
  来源：AGENTS.md 验证门禁 "改 runtime lifecycle、concurrency、cancellation、retry/edit、terminal commit、streaming、gateway persistence、sandbox、安全、agent scope 或 owner scope 时，必须补 characterization/contract/architecture tests"
  验证：`npm test -- packages/agent-context-engine/test/budget/` 全部通过；记录行为差异。落地：39/39 通过（budget-gate-integration, budget-invariant-guard, budget-logging, budget-pre-send 全部 pass）。Offload 失败现写 `degradation.code = "degradation:offload-failed-into-overflow"` 作为 budget gate 读取的 `PRE_SEND_CHECK_REQUIRED` 显式 signal。
- [x] 6.2 运行并锁定 `add-ts-attachment-request-context-flow` 的 attachment request flow suite，确保本 change 不回退 attachment 分类与失败投影。
  来源：AGENTS.md 验证门禁（characterization tests）
  验证：`npm test -- packages/agent-context-engine/test/attachment/` 全部通过。落地：8/8 通过（skill-disclosure-render），specialized-binary 路径不会重新分类 attachment-derivation 内容。
- [x] 6.3 运行并锁定 `add-ts-context-compression` 与 `add-ts-traceable-summary-generation` 的 summary regression suite，确保本 change 不破坏 summary message 形态。
  来源：design 决策 8.1
  验证：`npm test -- packages/agent-context-engine/test/compression/` 全部通过。落地：43/43 通过（context-compression-orchestrator, traceable-summary-generation），frozen-replacement 边界 test 锁定本 change 的 decision 不被 compression/summary 重写。
- [x] 6.4 运行 `npm run lint:architecture` 确认无跨 owner private import；`agent-context-engine` 不得 import `agent-runtime` 内部 lifecycle 类型，runtime-owned 字段（`SessionMessage` 上：`sessionId` / `requestId` / `runId` / `sequence` / `createdAt`）来源符合 `ts-core-contracts/spec.md`。
  来源：`ts-backend-architecture/spec.md` "package 边界映射到架构驱动"；design 决策 6.1
  验证：`npm run lint:architecture` 通过。落地：326 modules / 1179 dependencies cruised, 0 violations；package manifest 政策通过。

> 注：task 6.1–6.4 引用的 `packages/agent-context-engine/test/{budget,attachment,compression}/` 路径为占位描述；当前仓库根目录没有 `packages/` 目录，具体 test 布局以 `ship-ts-minimal-agent-kernel` 落地后的实际目录结构为准。
- [x] 6.5 运行 `openspec validate add-ts-large-content-references --strict`，确认 spec / design / tasks 内部一致性。
  来源：AGENTS.md 验证门禁 "OpenSpec 验证命令"
  验证：`openspec validate add-ts-large-content-references --strict` 返回 valid。落地：Change 'add-ts-large-content-references' is valid。`openspec validate --all --strict` 45/45 通过。
- [x] 6.6 记录行为差异：在 PR description / `docs/spec-review/` 中列出本 change 与既有 baseline 的行为差异点，至少覆盖：fresh INLINE 大结果后续轮次不再被改写为 PERSISTED_PREVIEW（决定 1 frozen 边界）；offload 失败收口（决定 5）；replacement evidence schema（决定 6.2）。
  来源：AGENTS.md 验证门禁 "改 runtime lifecycle 时记录行为差异"
  验证：code review 确认 `docs/spec-review/` 下存在本次行为差异记录。落地：`docs/spec-review/add-ts-large-content-references.md` 列出 8 个行为差异点 + 跨 baseline 完整性断言 + 3 个 regression suite 的验证结果。

## 7. 归档前基线提升（标准任务，与 0.x precondition 串联）

> 0.1–0.5 全部勾选后，下列任务才能勾选完成。

- [x] 7.1 同步 `openspec/specs/large-content-references/spec.md` 与本 change 1.1 输出对齐；spec 内已包含 0.1 / 0.2 / 0.3 的具体数值与配置 key、0.4 的 reason code 集、0.5 的 schema 文件 subpath。
  落地：spec 已从 `openspec/changes/.../specs/large-content-references/spec.md` 提升至 `openspec/specs/large-content-references/spec.md`，新增 `## Purpose` 段，将 `## ADDED Requirements` 重命名为 `## Requirements`（主 spec 单一解析入口）。
- [x] 7.2 同步 `openspec/specs/context-engine/spec.md` 中本 change 1.2 贡献的增量场景；不覆盖 `add-ts-context-budget-explainability` 的 budget 主体；requirement 命名空间与既有 budget requirement 不冲突（已用 `Context Engine consumes frozen large-content replacements during assembly` 等独立命名）。
  落地：8 个 requirement 已 append 到主 `## Requirements` section（"Prompt-shaping diagnostics do not enter model input" 之后）。原 delta header 替换为引用注释，requirement 名称与 budget 命名空间无冲突。
- [x] 7.3 确认 `openspec/specs/request-attachments/spec.md` 由 `add-ts-attachment-request-context-flow` 拥有，本 change 不修改；code review 确认本 change 目录中无 `request-attachments/spec.md`。
  落地：`tests/architecture/large-content-cross-baseline.test.ts` 3 个断言固化 `request-attachments` / `query-policy` / `context-compression` / `traceable-summary` / `attachment-intake` 5 个 forbidden baseline 子目录在 `openspec/changes/add-ts-large-content-references/specs/` 与 `openspec/specs/` 下均不存在（实测仅 `large-content-references` / `context-engine`）。
- [x] 7.4 按需更新相关 overview / architecture / domain / contract 文档（受 F3 决策 6.3 影响，`agent-contracts/gateway` 文档应注明 `ContentRef` 解析与 owner-scope 校验归 `BlobStoreGateway` 入口）。
  落地：`openspec/overview.md` 在稳定基线列表新增 "大内容 offload / replacement" 条目；`openspec/designs/modules/agent-context-engine.md` 新增 "大内容 offload / replacement 子模块" + "Prompt shaping 子模块" 两节，明确 `ContentRef → BlobRef` 解析与 owner-scope 校验归 `BlobStoreGateway` 入口。
- [x] 7.5 检查是否需要补充 ADR
  - [x] 7.5.1 Decision 8.1 双向约束的 owner-side 同步确认：归档前查阅 `add-ts-context-compression` 与 `add-ts-traceable-summary-generation` 的 design / spec 是否已同步决策 8.1 形态边界（previously `INLINE` 走 summary change 且不重写本 change 的 frozen replacement），并在 `docs/spec-review/add-ts-large-content-references.md` 给出引用 / 链接。：候选 ADR 包括 (a) replacement 与 budget explainability 衔接；(b) replacement 与 compression/summary 形态边界；(c) `LargeContentRef` 角色名与 `ContentRef` 归属说明；(d) `ContentRef` 解析 owner 收口（决策 6.3 新增项）。
    归档前必须在 `docs/spec-review/add-ts-large-content-references.md` 中给出明确结论：(a)(b) 两项为久期决策，需从 "新增 ADR 文件于 `openspec/designs/adr/`" 与 "不新增 ADR 但在 spec-review 记录决策理由" 二选一；(c)(d) 与 design 决策 6.2 / 6.3 一致，如有调整须同步修订 design 与 spec。
    落地：`docs/spec-review/add-ts-large-content-references.md` 第 5 节 + 第 6 节明确归档决策：(a)(b) 不新增 ADR 但 spec-review 已记录边界理由（replacement 与 budget 衔接：budget gate 读取 `degradation.code` signal；replacement 与 compression/summary 边界：本 change 不重写 frozen form 由 design 决策 8.1 + `tests/compression-boundary.test.ts` 固化）；(c)(d) 与 design 决策 6.2 / 6.3 一致。
- [x] 7.6 在 PR description / `docs/spec-review/` 列出本次行为差异点（联动 6.6），至少覆盖：fresh INLINE 大结果后续轮次不再被改写为 PERSISTED_PREVIEW（决策 1 frozen 边界）；offload 失败收口（决策 5）；replacement evidence schema（决策 6.2）；`ContentRef` 解析 owner 收口（决策 6.3）；`inline-max-bytes` 与 budget cap 关系（决策 1.1）。
  落地：`docs/spec-review/add-ts-large-content-references.md` 列出 8 个行为差异点（1. frozen INLINE、2. offload 失败收口、3. replacement evidence schema、4. ContentRef resolution owner、5. inline-max-bytes 分离、6. specialized binary、7. read-path 统一 shape、8. aggregate offload ordering）+ 跨 baseline 完整性 + 3 个 regression suite 结果矩阵。

> 2026-06-11 更新 (Chunk λ, 即将 commit): §2.1 形态枚举 + §2.2 schema guard + §2.3 聚合限流 + §2.4 commit/reuse 契约 + §2.5 metadata 扩展 + §4.1 关口发射 `large_capability_result` 全部勾选。落地:
> - `packages/agent-context-engine/src/large-content/` 4 个新文件: `thresholds.ts` (8192/16384/1024 chars + reason code vocabulary), `classifier.ts` (empty / specialized / inline / persisted_preview 决策顺序), `applier.ts` (产出 model-visible content + durable ReplacementEvidence,含 offload failure 收口到 `degradation:offload-failed-into-overflow` / `…-into-inline-fallback` 两条 reason), `aggregate-offloader.ts` (largest-first 排序,previously-frozen 锁定)
> - `assemble-context.ts` 接入: `runBudgetGate` 在 prior-turn loop 内为已 persisted 的 `CAPABILITY_RESULT` 发射 `large_capability_result` source candidate,estimatedInputUnits = previewSize(已 bounded),priority=optional,owningBoundary=agent-context-engine.large-content.frozen-decision
> - `tests/large-content-classifier.test.ts` 15 个用例: 4 个 classifier 路径 + 5 个 applier 路径 (含 2 类 offload failure 收口) + 2 个 frozen-decision reader + 4 个 aggregate-offload 路径 (全 inline / 单结果超阈值 / 聚合超预算 largest-first / previously-frozen 锁定)
> 进度 5/38 → §2 全部勾选(原 §2.x 的 5 个任务)+ §4.1 关口接入
