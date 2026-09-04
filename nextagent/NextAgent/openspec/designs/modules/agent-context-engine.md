# agent-context-engine

## 职责

承载 context assembly/render boundary，并在 package 内负责 query policy、window selection、compaction、prompt shaping、retry visibility filtering、fork active context selection 和 disclosure budget。最小内核从 active context view、当前 request user message、必要历史、locale、owner metadata 和 accepted assembly facts 生成 `ContextAssembly` 和 `RenderedModelInput`。

本模块把当前 Agent/run 可用的 ToolSearch bootstrap Tool 与既有默认可见 Tool/Skill 一起装配到模型输入；只在 activation patch 已提交后的后续模型 step 添加命中 Tool schema 或允许 discovered Skill 加载。

## 非职责

不定义 Web API、runtime state machine、provider SDK、memory lifecycle、long-term memory retrieval policy 或 app composition。不导入 runtime lifecycle contract 来读取 assembly facts；accepted assembly 信息通过 `agent-contracts/agent-assembly` 表达。

## 依赖

允许依赖 `@nextagent/agent-common` 和 `@nextagent/agent-contracts/context`、`agent-contracts/gateway`、`agent-contracts/model`、`agent-contracts/capability`、`agent-contracts/agent-assembly` public subpaths。不导入 runtime lifecycle contract、channel、gateway adapter、memory implementation、model provider SDK、app composition 或其它 implementation package。

## 核心设计落点

- provider-neutral model option merge 按 profile → Prompt Template → governed Capability patch → trusted request model options → `BEFORE_MODEL_INVOKE` Hook 的固定顺序逐字段合并 `toolChoice`。该 patch 只在当前 request/run 生效，不能改变模型身份、Agent loop limits 或持久化配置。
- model-only 与 finalizing 的 Tool 执行否决由 Agent budget owner 在最终请求构建时强制为 `NONE`；Context Engine 保留 Tool descriptors，不通过 `tools=[]` 表达禁用。

- 落实 `architecture/core-contracts.md` 的 `ContextEnginePort`、`ContextAssemblyRequest`、`ContextAssembly` 和 `RenderedModelInput`。
- model input render 必须输出 provider-neutral tool message pairing；tool result content 使用 `toolCallId + toolName`，不使用 `capabilityId` 作为模型协议字段。
- `ContextAssemblyRequest` 携带 runtime/core 已接受的 trusted `identityContext`，用于 owner-scoped context query；不依赖 app composition 的 request-local owner side map。
- request attachment classification and consumption MUST query authoritative `RequestAttachment` facts from attachment intake / lifecycle facts; do not trust command metadata copies, message metadata copies, or model output as attachment authority.
- 可用附件（`availabilityStatus === AVAILABLE`）无论绑定当前请求还是历史轮次，都暴露逻辑工作区路径 `AttachmentContextEvidence.modelPath`（`temp/attachments/{attachmentId}/{fileName}`），供模型按需 Read；`storageRef`、`BlobRef`、绝对物理路径不得对模型可见。可用历史附件不发降级证据——它可读，不是降级；仅 `availabilityStatus !== AVAILABLE` 的历史附件才以 `ATTACHMENT_HISTORICAL_DEGRADED` 降级为 metadata-only。`historical` decision 表达请求绑定，不表达可读性；可读性由 `availabilityStatus` 与物化 `modelPath` 决定。
- `DefaultContextEngineDependencies` 新增 `deploymentMode` 字段。两种部署模式下 context engine 都跳过 `readAttachmentContentBlock()`（不调 `blobStore.loadBlob`），`attachmentContentBlocks` 始终为空。`renderAttachmentDisclosure` 展示文件元数据列表（`fileName`、`mediaType`、`sizeBytes`），让模型知道有哪些文件但不暴露 `storageRef` 或文件路径。`AttachmentContextEvidence` 新增 `fileName`、`mediaType`、`sizeBytes` safe metadata 字段，不含 `storageRef`。模型通过 Read tool 读取物化后的文件。
- 落实 accepted assembly facts 读取规则：使用 `agent-contracts/agent-assembly`，不导入 runtime lifecycle contract。
- `BEFORE_CONTEXT_COMPACT` / `AFTER_CONTEXT_COMPACT` 的真实 stage owner 在 context compaction boundary：`BEFORE_CONTEXT_COMPACT` 发生在 summary generation 消费 effective compaction input 前，`AFTER_CONTEXT_COMPACT` 发生在 summary draft 已生成并校验、但 `commitCompaction` 持久化前。context-engine 只消费 `agent-contracts/runtime` 中的 lifecycle hook stage invocation symbols 和 `LifecycleHookInvocationPort`，不导入 `agent-runtime` implementation 或 runtime state mutation contracts。Compaction orchestrator 插入点为：(1) 从当前 context assembly request、source active context version、covered/retained refs 和 compaction idempotency coordinate 构建 compaction operation coordinate；(2) 在 summary generation 消费 target budget 前调用 `BEFORE_CONTEXT_COMPACT`，消费 effective `targetBudgetUnits`，用 effective budget 调用 `TraceableSummaryGenerationPort.generate(...)`；(3) 校验生成的 `TraceableSummaryDraft`；(4) 在 draft 校验后、构建最终 persisted summary message / 调用 `commitCompaction` 前调用 `AFTER_CONTEXT_COMPACT`；(5) 应用 `ContextCompactMutation.after.content` 替换 effective draft content，从 mutated draft 构建 `SessionMessage` / `SessionMessageRecord`；(6) 用 mutated summary message 和原始 retained-tail / active-context CAS facts 调用 `commitCompaction`。skipped / no-op compaction path 不触发 `AFTER_CONTEXT_COMPACT`；`commitCompaction` 之后的 path 不允许再应用 after mutation。`DefaultContextEngineDependencies`（或等价 factory deps）MUST 接受显式注入的 `LifecycleHookInvocationPort`；`assemble-context` MUST 把该 port 通过 explicit options/deps 传给 `runSummaryCompression(...)` / summary compression orchestrator；orchestrator 不得从 `default-agent`、global singleton 或 `AgentRunStatePort` 获取 hook executor。
- 落实 active context view controls model-visible history；不扫描 Web UI state 或全量 session history 来决定模型上下文。
- 落实 history candidate selection 在一次同步 `assemble()` 流程内完成：读取单一 `ActiveContextView` snapshot → 解析 `requestId` 锚定的 required current-request records → 按 `requestId` 边界分组 prior conversation → 对每个 raw unit 先从具有 `metadata.visibility.reason="RETRY_REPLACED"` 且 `runId` 已定义的非 USER message 收集被替换 run，排除该 unit 内所有属于这些 run 的非 USER messages（含 Retry 前已 `visible=false` 且无 replacement reason 的 assistant tool-use），缺少 `runId` 的 marker 只排除自身，不扩展到其他 messages；不得按消息时间、run 顺序或 `runId` 值猜测 latest attempt → 再对剩余消息整体排除其他 hidden replacement / incomplete turn / pending or orphan tool fragment（complete prior turn 必须包含 root user message + 完整有序 tool-use / capability-result 协议序列 + 终态非 tool-use assistant response） → `isHiddenReplacement` 的第 4 条排除路径 `metadata.modelVisibility.excluded === true` 单独排除 `visible=true` 但需模型排除的消息（典型为输入护栏拦截轮的 `visible=true` + `modelVisibility.excluded=true` safe marker），与 `visible` 字段解耦，不影响现有 `!visible`/`PERSISTED_PREVIEW` 例外/`replacement.kind` 三条路径 → 形成全部合法候选集。selection 本身不做窗口预算、压缩、替换或预算降级；任何合法候选被省略只能归因于既有 downstream policy（`add-ts-context-budget-explainability` / `add-ts-context-compression` / `add-ts-traceable-summary-generation`）。
- 实现 `ForkActiveContextSelectionPort`：输入必须是已重写到 child scope 的 copied child messages 和 child anchor，selector 只做 fork-specific 校验与 anchor cutoff，然后复用本 package 内部 prior-history candidate helper；它不得用 fake current request 调 full assembly，不调用模型、不压缩、不生成新 summary、不读取 parent active context。
- 落实 selection 的显式失败边界：required current-request context 无法建立、或任一 `ActiveContextView` 引用的 message ref 在 owner / session / agent scope 下无法安全加载或校验时，必须返回显式 safe failure（不静默退化为 current-request-only 或把 unresolvable ref 当作 prior history 继续）。
- `ContextAssembly.selectedMessageRefs` 必须只来自本次 `assemble()` 读取的单一 `ActiveContextView` snapshot；refs 不得跨 snapshot 拼接。render 阶段不得静默跳过缺失或不再可见的 selected ref（render-side 校验由 `add-ts-context-prompt-shaping` 拥有 "Render resolves selected message refs without silent omission" requirement）。**早期 spec 草稿要求 refs 携带 `activeContextVersion` 作为 per-ref 解析锚点供 render 回校，已在 2026-06-10 spec-to-impl 审查后判定为对当前架构的过度设计并从 spec 删除**：`SessionMessage` append-only + same-session lane 串行已经保证 assemble 用的 snapshot 在 render 时仍可用；保留 anchor 机制需要扩 `agent-contracts/context` 公共契约，成本大于收益。
- context-engine 还是 `CONTEXT_ASSEMBLY_COMPLETED` 轨迹输入的 owner：context assembly diagnostics 只能输出 budget decision、compression mode、degradation counts、omitted counts、estimated input units 和稳定 refs 等安全摘要；不得把 prompt 文本、message body、tool result 正文、attachment body、free-text reasoning 或 provider raw payload 作为 trajectory 输入。
- retry replacement 后，model-visible context 必须排除被替换 attempt 的默认隐藏输出；需要诊断或 recovery 时只能通过 owner scoped current request/run query 显式读取 hidden facts。
- public history 的 `includeHidden` 不是模型上下文选择开关；模型上下文由 active context/view policy 和 accepted request/run facts 决定。
- Context assembly MUST NOT 自动检索、自动注入或自动提升长期记忆。模型需要长期记忆时，通过已治理的 memory tools 产生 tool result；后台 extraction/aging 产生的结果不得直接修改 system prompt、active context view、selected message refs 或 prompt budget。
- prompt shaping 拥有 ToolSearch deferred disclosure 的 system-prompt 责任：Skill `tool-search` 模式只渲染 `available-deferred-skills` 中的轻量 Skill id；CLIP `tool-search` 模式只渲染 `available-deferred-clipc` 中的轻量 capability id。deferred 候选本身不得默认进入 model-visible Tool schema 列表，只有 request-local activation 后才进入后续工具渲染。

## 替换边界

否。Context Engine owns context selection policy。

## 验证关注点

- query policy、window selection、compaction 和 prompt shaping 留在本 package 内部。
- fork selector 与 normal assembly 共享 prior-history turn/summary/tool-fragment 判断，不维护第二套完整 turn 解释；输出只能是 copied child prefix 内的 child message ids。
- 不得拥有 memory lifecycle、request lifecycle 或 terminal commit。
- 不得导入 `agent-memory`、memory extraction/aging implementation 或 memory tool names 来改变 context assembly；`MEMORY_EXTRACTION` prompt purpose 只作为 prompt template assembly consumer 支撑后台 extraction 的模型调用，不是主 context 自动注入入口。
- model-visible context 必须通过 contract boundary 表达，不依赖 Web UI state。
- rendered model input 必须保留 request locale/language hint 和电信术语原文保留约束。
- retry replacement、hidden message filtering 和 current request/run recovery context 必须有 context/session contract 测试覆盖。


## 大内容 offload / replacement 子模块

`agent-context-engine/src/large-content/` 内部模块负责 fresh 结果的 replacement 决策与持久化边界，与 `agent-contracts/session` 的 `ReplacementEvidence` typed extension 配套。externalize 触发点是 `RuntimeOwnedRunMessagePort.appendMessage`（runtime 咽喉点），由 app-composed `DefaultLargeContentExternalizer` 注入；该 externalizer 组合本模块的 `classifyReplacement` / `applyReplacement`（`persistContent` 注入为"写 execution workspace 文件"）与 trusted execution workspace resolver / workspace policy facts 完成写入。读回仍通过 `read` Tool 进入 capability-owned `WorkspaceFilePort` enforcement。本模块不在装配路径承担 externalize 职责：

- `thresholds.ts` — `inline-max-bytes` (8 192 chars) / `aggregate-max-bytes` (16 384 chars) / `preview-max-chars` (1 024 chars) 常量单源；`LargeContentReasonCode` 闭集，新增 reason code 必须走 `agent-contracts/session` owner 的 contract refinement change。
- `classifier.ts` — 固定首版决策顺序 `empty → specialized → single-result → aggregate → record evidence → walk design 5 three-step resolution`。
- `applier.ts` — 产出 model-visible content 与 durable `ReplacementEvidence`；offload 失败按 design 5 三步收口（inline-fallback 走 `degradation:offload-failed-into-inline-fallback`，显式失败走 `degradation:offload-failed-into-overflow`）。
- `aggregate-offloader.ts` — 同一 user message / tool batch 聚合 largest-first；previously-frozen 决定不重写。
- `preview-reader.ts` — 5 步读顺序（identify contentRef → identity → gateway → preview / full content → degradation marker），owner-scope 校验归 `BlobStoreGateway` 入口。`readPersistedPreview` / 任何按 BlobRef 解析 contentRef 的路径 MUST NOT 作用于 capability-result F 记录（其 `contentRef.refId` 是 execution workspace 相对路径，非 BlobRef）；capability-result 读回只走 `read` 工具。
- `specialized-binary.ts` — 图片 / PDF / Excel / 二进制 / MCP blob 走 `SPECIALIZED_REF` 形态（无 stringify，无 base64 / hex / path literals）。

`ContentRef → BlobRef` 解析与 owner-scope 校验归 `BlobStoreGateway` 入口（`agent-contracts/gateway` 公共契约，本模块不引入新 contract 类型也不新增 stable subpath）；attachment / artifact / model-summary 等 blob-backed 来源仍走该路径。oversized textual `CAPABILITY_RESULT` 的 `contentRef.refId` 是 execution workspace 相对文件路径（`tool-results/<refId>.txt`），由 `read` 工具分页读回，不经 `BlobStoreGateway`。装配/渲染侧 `truncateLargeToolResults` / `truncateRenderedToolResults` 降为 defense-in-depth：跳过 `toolName === Read`、对已带 `metadata.replacement` 的记录直通（conformant），遗留无 replacement 的 oversized 记录由兜底产 bounded preview + diagnostic。详细 spec 见 `openspec/specs/large-content-references/spec.md` 与 `openspec/specs/large-content-readback/spec.md`。

## Prompt template assembly / shaping 子模块

`agent-context-engine/src/prompt-shaping/` 内部模块负责 purpose-aware prompt template assembly：编译 `prompt-templates/builtin/` 的 process-scoped builtin bucket，通过 `register({ agentId, agentVersion, path })` 注册 Agent package `prompts/` 下的 Agent-scoped facts，并由 `PromptTemplateAssembler` 在 request path 选择一个完整 template、渲染受控变量、返回 rendered sections/content 和可选 `modelOptions` handoff。

`SYSTEM_PROMPT` 是通用 prompt template assembly 的受限 specialization：compiler / render policy 在 context-engine 内部按 builder-owned system section taxonomy 和 predefined order 过滤、排序 system sections。`SUMMARY_GENERATION`、`MEMORY_EXTRACTION` 和自定义 purpose 使用通用 ordered-section rendering，不继承 system-only taxonomy。framework well-known purpose 集合为 `SYSTEM_PROMPT`、`SUMMARY_GENERATION`、`MEMORY_EXTRACTION`、`AGENT_ROUTING_SELECTION`。

prompt template assembly 同时是唯一公共 resolver 边界：`agent-contracts/context` 的 `PromptTemplateResolverPort.resolve(request, signal)` 由本 package 用现有 assembler/registry 实现，request 只含 purpose、Agent scope、locale、string-only flow variables、closed selected model 和 optional `memoryEnabled`，result 为 closed `RESOLVED | NOT_FOUND`；`NOT_FOUND` 不携带模板事实。router 与其它受治理 model-facing consumer 只通过该 port 复用同一选择与渲染边界；Context Engine builtin root 不提供 `AGENT_ROUTING_SELECTION` 的默认内容，consumer-owned default content（如 router 默认提示词）留在 consumer 内。不公开 registry、loader、compiler、template source 或 internal assembler，不增加第二个选择算法或 request-time file loader。

`SYSTEM_PROMPT` 含一个条件渲染的 `memory` section：仅当 app 注入的记忆门控 capability id 出现在该 Agent 模型可见 capability 集合中（推导为 `memoryEnabled`）时渲染，否则由 system render policy 过滤省略。该 section 仅承载策略层指导（何时记/记什么/不记什么/核验/边界），不注入记忆数据；工具调用机制由 memory 工具描述承载。context engine 不引用记忆工具名字面量（架构边界），门控 capability id 由 app 组合层注入 `DefaultContextEngineDependencies.memoryToolCapabilityId`。

`SYSTEM_PROMPT` 含一个条件渲染的 `skill_disclosure` section（归入 dynamic 区，渲染在 CACHE_BOUNDARY 之后）：Skill 使用披露由 builtin `skill-disclosure.md` 承载 `### Available skills` 列表占位与 `### How to use skills` 指令正文。渲染门控由 `assemble-context.ts` 的 `skillDisclosureProjection` 从 `visibleCapabilities` 推导——`Skill` tool entry（`tool-search` 模式还需 `ToolSearch` entry）可见且过滤后 skill 列表非空才渲染，否则由 system render policy 过滤省略，Agent 覆盖内容同样受门控约束。列表过滤规则（`kind="SKILL"` + AVAILABLE + `modelInvocable=true`，list 模式排除 DEFERRED/HIDDEN，tool-search 模式仅排除 HIDDEN）留在 policy 层；模板只消费三个受治理变量：`skillDisclosureList`（governed skill bullet 列表投影）、`skillDisclosureMode`（trusted 披露模式值）和 `skillDisclosureBody`（mode 感知的 builtin 默认指令正文）。默认正文的两套文案存放于 builtin `SYSTEM_PROMPT` 模板目录的 `skill-disclosure-list.md` / `skill-disclosure-tool-search.md` markdown 文件，由 `skillDisclosureProjection` 在装配时按模式读取并以 `body` 字段进入投影（resolver 只做投影透传，variable-resolver 不含 system-only 概念以满足架构边界）；body 文件缺失时投影 body 为空，section 只渲染 governed 列表。改默认文案 = 直接编辑这两个 markdown 文件；零代码文案。Agent 通过既有 agent-over-builtin 机制覆盖该 section 即完全接管正文，可引用投影变量自行按模式分化；builtin 默认渲染产物与 renderer 时代逐字一致。披露模式来自 `nextAgent.system['capability-disclosure']['skill-disclosure-mode']`（`list` | `tool-search`，默认 `list`），经 `DefaultContextEngineDependencies.skillDisclosureMode` 进入装配投影，不参与模板/模型选择。旧 `enabledSkills` 变量与 `PromptAssemblyRequest.enabledCapabilities` 投影已删除：skill 列表在 system prompt 中只出现一次，引用 `enabledSkills` 的模板编译期 fail closed。

request path 不读取 raw prompt files、不调用旧 profile/loader chain、不从 `AgentAssembly` 读取 prompt id allowlist，也不让 summary/memory 拥有私有 prompt loader。template selection 使用 purpose、accepted Agent scope、locale、string-only flowVariables 和实际调用模型的 safe `modelId`；client payload、model output、capability arguments 或 metadata 不得覆盖选择权。

prompt template assembly 每次选择一个完整主 template。Agent package `prompts/` 的 `agent` layer 优先于 context-engine package-owned `builtin` layer；只有选中 Agent template 缺少 sections 时，才允许从唯一最佳匹配 builtin template 按 section 补齐，不允许多个用户 template 任意 partial text merge。`modelOptions` 只作为 handoff 返回，最终模型选择和参数合并仍由 context-engine/model invocation 组装路径拥有。

render 阶段仍由 `ModelInputRenderer` 组合已 frozen 的 SystemPrompt / selectedMessages / visibleCapabilities；prompt template assembly 不产出完整 `RenderedModelInput.messages`。

`SYSTEM_PROMPT/communication-style.md` 承载双语电信输出规则。规则文本属于静态 prompt 内容，而不是 TypeScript 注入逻辑：模型应优先跟随用户实际输入语言，而不是诊断用途的 locale hint；同时必须保持 NE、interface、counter、alarm、KPI、protocol、CLI、IP/port 等电信术语原始英文形式。

受治理的 `timezone` 与 `currentDate` 变量从同一次渲染的进程本地日历事实解析：`buildPromptTemplateRenderContext` 用同一个 `now` 的本地 `getFullYear()`、`getMonth()` 与 `getDate()` 组成 `YYYY-MM-DD` 字符串作为 `currentDate`，`timezone` 仍由 `Intl.DateTimeFormat().resolvedOptions().timeZone` 解析为进程本地 IANA 时区。不新增 clock port、calendar context、公共字段或依赖；未配置用户时区时从不从 locale、请求内容或浏览器环境推断时区。测试使用 `vi.useFakeTimers()`、固定 ISO instant 和受控 `process.env.TZ` 覆盖 `Asia/Shanghai`、`America/New_York` 与 `UTC`，并在 `finally` 中恢复 fake timers 与原 `TZ`。

## Budget decision gate 子模块

`agent-context-engine/src/budget/` 内部模块负责 context assembly 的 token 预算决策（baseline 由 `add-ts-context-budget-explainability` 建立）。

- `source-candidate-builder.ts` — 从 `HistorySelectionOutcome` + `visibleCapabilities` + `SystemPrompt` + `TokenEstimator` 构造 `ContextSourceCandidate[]` 和 `minimumSafeContextUnits`。纯函数，无网关调用。category 粒度：`current_request`（required）、`prior_active_history`（optional）、`large_capability_result`（optional，读取已 frozen 的 replacement decision 的 previewSize）、`capability_disclosure`（required）。
- `default-proportional-budget-policy.ts` — 默认 `ContextBudgetPolicyPort` 实现。60% history budget ratio，required 候选永不省略，optional 候选按 large_capability_result 优先降级顺序装箱。替换策略可重定义 ratio 但必须保持四不变量。
- `budget-invariant-guard.ts` — 决策门四不变量校验（baseline > available → explicit_failure、decision 闭集、required 候选不省略、explicit_failure evidence 全 INSUFFICIENT_CONTEXT）。在 `policy.evaluate()` 之后调用，违规抛 `CONTEXT_BUDGET_POLICY_INVARIANT_VIOLATION`。
- `budget-logging.ts` — `context.budget.evaluated` 结构化日志事件。非抛出（logging failure 不 fail 主管线）。payload 仅含聚合指标，不含原始 prompt / message / tool 内容。
- `default-token-estimator.ts` — 默认 `TokenEstimator` 实现，code-point-aware 启发式加权。空输入返回 0，非空返回正整数。

`assemble()` 中 budget gate 在 history selection 之后、compression 之前执行。`truncateCandidates` 根据 budget evidence 中每条 `prior_active_history` 候选的实际 `status` 做精确过滤（非 category 级别的全量丢弃），`maxMessages` 条数截断作为无 budget policy 时的兜底。

## Summary compression orchestrator 子模块

`agent-context-engine/src/assembly/summary-compression-orchestrator.ts` 负责将 prior prefix 压缩为摘要（baseline 由 `add-ts-context-compression` 建立；触发条件由 `tune-auto-compact-threshold` 改为主动阈值）。

触发条件（`assemble-context.ts` `processBudgetOutcome`）：summary compression 有且仅有一个触发源——主动上下文窗口阈值。当 `estimatedConversationInputUnits >= availableInputUnits − DEFAULT_AUTO_COMPACT_HEADROOM_UNITS`（`DEFAULT_AUTO_COMPACT_HEADROOM_UNITS = 13_000`，约 128K 窗口下 90–92%）时触发。`estimatedConversationInputUnits` 为预算门 `ContextBudgetEvidence` 全量候选 `estimatedInputUnits` 之和（`sumEvidenceUnits`，复用同一 estimator，不新建估算路径）；`availableInputUnits` 由 `runBudgetGate` 计算并经 `evaluateBudget` 下传（单一来源，不重算）。小窗口 guard `availableInputUnits > 13_000` 防止无条件触发。旧反应式触发（budget plan omit `prior_active_history` 才压缩）已移除，不保留兼容；omit 仍由预算门独立产出 budget-degraded 结果，但不再驱动压缩。阈值为固定硬编码常量，不进 `ContextAssemblyRequest` / client / model output / capability args。

编排流程：构造 `TraceableSummaryGenerationRequest` → 调用 `summaryGenerator.generate()` → 校验 draft 非空 → 构造 `SessionMessage`（role: SUMMARY, metadata.kind: `CONTEXT_COMPRESSION_SUMMARY`）→ 投影为 `SessionMessageRecord` → 调用 `commitCompaction`（CAS 写入）→ 成功则 re-select 并产出 `ContextCompressionEvidence`。

fallback reason vocabulary：
- `SUMMARY_GENERATOR_UNCONFIGURED` — 无 port compose
- `SUMMARY_GENERATION_FAILED` — port 抛出 / abort / auth / tool-call attempt / full-text failure
- `SUMMARY_DRAFT_INVALID` — 空或不安全 draft
- `ACTIVE_CONTEXT_VERSION_CONFLICT` — commit CAS 不匹配
- `ACTIVE_CONTEXT_PERSISTENCE_FAILED` — 其他 gateway 失败

所有 fallback 均为 safe failure：阈值触发但压缩失败时，`compressionEvidence` 保持 `undefined`，`selectedMessageRefs` 沿用 `truncateCandidates` 的 budget-degraded / omission 结果，不伪造成功、不阻塞主管线。

## Traceable summary generator 子模块

`agent-context-engine/src/summary/` 内部模块负责摘要生成的模型调用路径（baseline 由 `add-ts-traceable-summary-generation` 建立）。

- `default-traceable-summary-generator.ts` — 默认 `TraceableSummaryGenerationPort` 实现。调用 model invocation → 解析输出 → checklist 校验 → 产出 `TraceableSummaryDraft`。不做持久化副作用。
- `compact-summary-template.ts` — 内置 `compact-summary/v1` prompt 模板。
- `covered-range-classifier.ts` — 对 covered messages 做 continuation-critical 事实分类（decision、error、tool_result、state_change 等 category）。
- `output-parser.ts` — 解析模型输出中的 `<summary>` + `<checklist>` 结构，支持 full-text fallback。
- `summary-input-serializer.ts` — 将 covered messages 序列化为 summary prompt 输入，保留 role 和顺序，消费已有 large-content replacement 形态（不重新内联外置大内容）。

checklist validation：模型产出的 `<checklist>` 必须覆盖 covered range 中所有 present category；遗漏或虚构 category 视为 safe failure（`continuation_critical_fact_missing`）。

## Micro-compact 子模块

`agent-context-engine/src/micro-compact/` 内部模块负责 request pre-hook 级别的轻量工具结果清理（baseline 由 `add-ts-context-micro-compact` 建立）。在 `assemble()` 管线中位于 history selection 之后、large-content truncation 之前运行。

- `config.ts` — `COMPACTABLE_TOOL_NAMES`（8 个白名单工具：Bash / Read / Grep / Glob / WebFetch / WebSearch / FileEdit / FileWrite）和 `MICRO_COMPACT_CONFIG`（triggerThreshold=10, keepRecent=5）。`Rag` 不加入该白名单，而是使用独立的 RAG eligibility rule：当前问题之前全部 canonical 已完成轮次中的 `Rag` capability results 无条件替换，不受通用阈值和最近保留窗口影响，也不参与通用候选计数。
- `candidate-scanner.ts` — `scanCompactableCandidates()` 纯函数。从 `priorTurnCandidates` 中识别两类候选：通用白名单 CAPABILITY_RESULT 记录（toolName 在 `COMPACTABLE_TOOL_NAMES` 中）和 RAG 专用候选（toolName 为 `Rag` 的全部历史已完成轮次记录）。不扫描 currentRequestRecords。RAG 候选全部替换；通用候选仍按既有触发阈值和最近保留窗口处理。
- `state-manager.ts` — `readMicroCompactState()` / `writeMicroCompactState()` / `clearMicroCompactState()`。状态持久化在 `ActiveContextViewRecord.metadata.microCompactState`，跨请求保持幂等。缺失或格式错误时返回空状态（向后兼容）。metadata 版本冲突时合并最新已持久化 ids 与本次新增 ids 并有界重试一次；`NOT_FOUND`、第二次冲突或 gateway 异常沿用非阻塞降级。
- `content-replacer.ts` — `renderCompactedPlaceholder()` 确定性 XML 占位符生成；`replaceCapabilityResultPayload()` 保持 JSON 结构（toolCallId / toolName）不变，只替换 payload 字段。非 JSON 内容降级为整体替换。RAG 占位不包含 query、知识正文或 credential。
- `micro-compact.ts` — `microcompactHistory()` 主编排函数。单一路径：in-memory 替换，render 阶段重新应用。Provider 级缓存保护 deferred 到后续 change。`applyMicroCompactReplacementAtRender()` render 阶段对从 messageStore 重新加载的原始记录重新应用替换；render 合并持久化 state 与本次 selected history 可确定识别的全部历史 RAG ids，不以 metadata 写入成功作为本次投影前提。最终 `DefaultModelInputRenderer` 完成 `CAPABILITY_RESULT → TOOL/tool-result` 投影后，对已确定 compacted 的历史 RAG `tool-result.output` 再执行一次确定性占位投影，保证最终模型输入不变量。

**与现有机制的关系：**

| 机制 | 关系 | 触发维度 |
|---|---|---|
| `truncateLargeToolResults` | 互补 | 微压缩按累积数量清理旧结果，大内容截断按单个大小裁剪超大结果。微压缩先运行。 |
| Budget Gate | 前置 | 微压缩在预算评估前执行，使预算门看到压缩后的 token 估算，减少 `HISTORY_OMITTED_TO_BUDGET` 的量。 |
| Summary Compression | 协调 | 摘要压缩成功后微压缩状态自然清空（新 ActiveContextView 不携带旧 metadata）。 |
| Large-Content Classifier | 正交 | large-content 处理单个结果的持久化/预览，微压缩处理累积结果的清理。 |

## Capability 失败处置协作

本包按 profile、Prompt Template、受治理 Capability patch、trusted request 和 request-local feedback 组装模型输入，并把 closed `ModelInferenceOptions.toolChoice` 作为普通 provider-neutral 字段传递。省略表示不覆盖，patch 不得扩大当前 Agent 授权；最终 Tool 执行否决仍归 Agent Core。完整合并顺序和 finalizing 输入要求见 `openspec/designs/architecture/capability-invocation-and-failure-disposition.md`。

## Public Exports

`@nextagent/agent-context-engine`
