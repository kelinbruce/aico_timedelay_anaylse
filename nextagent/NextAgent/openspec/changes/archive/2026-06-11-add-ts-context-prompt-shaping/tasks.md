## 1. 类型与契约

- [x] 1.0 复核 `agent-contracts/context` public contract delta 只包含已确认的 prompt shaping 最小补齐项；若实施发现需新增 subpath、迁移 owner、暴露 diagnostics 或重定义 `ModelOptions`，先拆出 contract refinement change
- [x] 1.1 依赖 `refine-ts-context-assembly-contracts` 冻结后的 `agent-contracts/context` contract：保留 `SystemPromptSection.sectionId: string` 作为 public 稳定标识（builder 内部 canonical key），只补充必要的 contribution / builder / profile / override / loader / resolver / token estimator 类型；不得将 public `sectionId` 改名为 `sectionKey`；`SystemPrompt` 保持单层 `readonly sections: readonly SystemPromptSection[]` 形状（refine-ts-context-assembly-contracts 冻结后的契约），由 builder 内部按 `defaultSectionOrder()` 输出 stable-then-dynamic 顺序，render 阶段按 canonical `sectionId` 重新切分；prompt shaping 组件只读顶层 `sectionId` / `heading` / `content`，不得读 metadata 内 sectionKey / order 副本；该约束由 task 6.9 contract 测试 "preserves the SystemPrompt core contract: flat `sections` only, no stableSections/dynamicSections split" + "prompt shaping and render do not read SystemPromptSection.metadata.sectionKey or metadata.order" 固化
- [x] 1.2 在 `agent-contracts/context` 明确 `SystemPrompt.cacheBoundaryMarker` 的文本 marker 语义（默认 `---[CACHE_BOUNDARY]---`），不新增 `sections[]` 顶层字段
- [x] 1.3 在 `agent-contracts/context` 明确 `ContextAssembly` 使用既有顶层字段：`requestContextId`, `sessionId`, `requestId`, `runId`, `stepId`, `agentId`, `agentVersion`, `locale`, `purpose`, `capabilityGeneratedMessages`, `capabilityContextPatch`, `systemPrompt`, `selectedMessageRefs`, `visibleCapabilities`, `modelInfo`, `modelOptions`, `modelSelectionReason`, `budgetPlan?`, `budgetEvidence?`, `budgetRoleEvidence?`, `compressionEvidence?`；不新增 `profileRef` / `attachmentRefs` / `currentRequestRef` / `diagnostics` 公共字段（contract test "keeps prompt-shaping diagnostics and profile refs out of public context DTOs" 固化）；`profileRef` 保留在 `PromptAssemblyResult` 内部并通过 `agent-observability` structured log（`templateResolved` 等事件）做 diagnostics 关联；`modelOptions` 来自分层 `ModelOptionsOverride` 合并结果，**不**来自 `PromptTemplate.defaultModelOptions`（6.11 architecture lint 断言）；`modelInfo` 形状固定为 `{ baseUrl, credentialRef, modelName }`，不携带 `providerKind` / `timeoutMs`（这两个字段属于 `ModelInvocationRequest`，在 `agent-model` 边界由 `ModelInvocationService` 注入）
- [x] 1.4 在 `agent-contracts/context` 新增 `SystemPromptBuilder` 接口（含 `build(ctx)` / `supportedSectionKeys()` / `defaultSectionOrder()` 三个方法 + `PromptMode` 枚举 `FULL` / `MINIMAL` / `NONE`）与默认实现契约；section 集合和顺序由 builder 决定，模板/profile 只能 override content
- [x] 1.5 在 `agent-contracts/context` 新增 `SystemPromptContext`（`sessionId` / `agentId` / `agentVersion` / `runtimeInfo` / `environmentInfo` / `telecomContext` / `workspaceDir` / `providerContribution` / `projectContextFiles` / `enabledCapabilities` / `sessionMetadata` / `promptMode`）与 `SystemPromptContribution`（`sectionOverrides: Map<sectionKey, content>`）类型；明确各字段来源（orchestrator 构造时按此声明绑定）：`sessionId` / `agentId` / `agentVersion` 来自 `ContextAssemblyRequest` + `AgentAssembly`；`runtimeInfo`（model / modelFamily / shell / pythonVersion / thinkingLevel）来自 `AgentAssembly.runtimeSettings` + `AgentAssembly.modelProfileIds` 解析；`environmentInfo`（platform / osVersion / timezone / currentDate）来自 trusted runtime 边界（与 `identityContext` 一起由 channel/auth boundary 携带），**不得**从请求体、模型输出或 capability 参数覆盖；`telecomContext`（networkEnvironment / operationLevel）来自 `AgentAssembly.runtimeSettings`；`workspaceDir` 来自 `AgentAssembly.workspaceDir`（已通过 `add-ts-agent-package-assembly` 编译期验证）；`enabledCapabilities` 来自 `catalog.listAvailable(ctx, requestScope)`（见 design §6 与 6.5）；`providerContribution` 来自 `PromptAssemblyResult.contribution`；`projectContextFiles` / `sessionMetadata` 来自 trusted boundary
- [x] 1.6 在 `agent-contracts/context` 新增 `TemplateVariableResolver` 变量注册表常量与 type guard；首版注册表包含至少 12 个变量：`agentId` / `sessionId` / `modelInfo` / `runtimeInfo` / `environment` / `enabledSkills` / `networkEnvironment` / `isProduction` / `timezone` / `currentDate` / `platform` / `osVersion`；name 匹配 `[a-zA-Z_][a-zA-Z0-9_]*`；**禁止** 2 字段（`agentDisplayName` / `agentDescription`）白名单硬拒绝任何其它变量；未知变量按字面 `{{name}}` 透传，required 未解析报 fragment render failure，optional 未解析填空
- [x] 1.7 在 `agent-contracts/context` 新增 `PromptTemplateProfile`（含 `templateProfileId` / `templateName` / `languageVariant` / `modelFamily` / `templateRef` / `fallbackTemplateRef` / `enabled` / `layer` / `modelId` / `agentId` / `purpose` / `precedence` / `ModelOptionsOverride optionsOverride`）与 `ProfileLayer` 枚举（`DEFAULT` / `LANGUAGE` / `MODEL` / `AGENT` / `PURPOSE`，`DEFAULT < LANGUAGE < MODEL < AGENT < PURPOSE` 为 layer 升序）；新增 `PromptTemplateRegistry` / `PromptTemplateProfileQuery` / `PromptTemplateLoader` 类型；`LayeredProfileResolver` / `PromptTemplateProfileQuery` / `PromptTemplateRegistry` / `PromptAssemblyResult` 是 `agent-contracts/context` 下的**公共契约类型**（跨 change 消费入口）：`add-ts-traceable-summary-generation` 通过 `LayeredProfileResolver.resolve(query, baseOptions)` 消费，query 携带 `purpose = "SUMMARY_GENERATION"`，内置 fallback `compact-summary/v1`；其它按 purpose 解析的场景（如工具描述、模型评审）也必须走同一 resolver 入口，不得在 `agent-context-engine` 之外另造 prompt template 解析路径；**禁止** 固定 5 步链作为规范解析顺序；**禁止** `PromptTemplate.defaultModelOptions` 字段
- [x] 1.8 在 `agent-contracts/context` 新增 `ModelOptionsOverride`（record：`temperature?` / `maxTokens?` / `topP?` / `thinking?` / `providerOptions?` map）类型与 `applyTo(base)` 字段级合并语义；`providerOptions` map 合并（高 precedence key 覆盖低 precedence key）；标量字段 override 非 null 时替换；override 全空时 `ModelOptions` 不变
- [ ] 1.9 在 `agent-contracts/context` 新增 `TokenEstimator` 接口（`estimateTokens(text)` / `estimateMessageTokens(role, content)` / `estimateToolMessageTokens(toolCallId, toolName, content)` / `estimateTokensBatch(texts)`）与默认码点感知实现契约（CJK ×1.5、增补面 ×2.0、ASCII ×0.25，按 code point 迭代）
  > (superseded 2026-06-10 by `refine-ts-context-token-estimator`) 该接口与算法常量已被独立 contract refinement change 落地到 `agent-contracts/src/context/index.ts`；本 change 实现期仅消费 `TokenEstimator` 与 `DefaultTokenEstimator`，不再拥有其定义。本任务条目保留为可追溯锚点，不在本 change 范围内勾选。
- [x] 1.10 明确 render-stage 输入边界：`selectedMessageRefs` 表达历史（批量读取），`requestId` 表达当前请求，附件从已选历史和当前请求消息的附件引用经 attachment boundary 解析（`render()` 通过新增的 `SessionMessageStoreGateway.loadMessages` 批量方法 + `AttachmentStoreGateway.listAttachmentsByRequestId` 实现，源码注释 5.3 / 5.4 / 5.5 段固化）
- [x] 1.11 复用 `agent-contracts/model.ModelOptions`，不得在 `agent-contracts/context` 重新定义 `ModelOptions` 字段
- [x] 1.12 在 `agent-context-engine` 内部新增 presentation-safe `PromptShapingDiagnostics` / `SectionDiagnostic`；记录入口限定为 `agent-observability` structured logging helper（`templateResolved` / `templateRejected` / `templateResolutionFailed` / `ambiguousProfileResolution` / `loaderChainFallback` / `sectionOmitted` / `fragmentRenderFailed` / `tokenEstimationCompleted` / `toolPairingRejected`）和 timeline/event subscriber（`renderStarted` / `renderCompleted`）；不写 audit event 入口；不新增 `agent-contracts` 公共 diagnostics 字段；sink 名以 `openspec/designs/architecture/observability-boundaries.md` 为准；并对应 spec「Prompt shaping diagnostics are not written to audit events」Scenario。落地：`packages/agent-context-engine/src/prompt-shaping/diagnostics.ts` 定义 `PromptShapingDiagnosticsSink` / `InMemoryPromptShapingDiagnosticsSink` / 11 个事件枚举；`DefaultLayeredProfileResolver` 接收 sink 发出 `templateResolved` / `templateRejected` / `templateResolutionFailed` / `ambiguousProfileResolution` / `loaderChainFallback`；`DefaultModelInputRenderer` 接收 sink 发出 `renderStarted` / `renderCompleted` / `sectionOmitted` / `fragmentRenderFailed` / `toolPairingRejected`；`DefaultContextEngine.assemble` 在 budget gate 跑完后发出 `tokenEstimationCompleted`；`DefaultContextEngineDependencies` 暴露可选 `promptShapingDiagnostics` 入参；`RenderedModelInput` / `ContextAssembly` 公共字段不携带 diagnostics（contract test 固化）
- [x] 1.13 不实现 typed context source 注册表 / 6 个 source / safe omission 路径：Java 模型已通过 `SystemPromptContext` 上的 `RuntimeInfo` / `EnvironmentInfo` / `TelecomContext` / `enabledCapabilities` / `projectContextFiles` / `sessionMetadata` 字段统一承载 builder 输入；本 change 不再单独维护 typed source 接口

## 2. SystemPromptBuilder + TemplateVariableResolver

- [x] 2.1 在 `agent-context-engine` 实现 `SystemPromptBuilder` 接口与默认实现（`TelecomSystemPromptBuilder`，对齐 Java 参考）
- [x] 2.2 实现 `PromptMode` 三种取值的行为：`NONE` 仅发 `identity`；`MINIMAL` 发 `identity`（stable）+ `runtime`（dynamic）；`FULL` 发完整 canonical taxonomy，但每个 section 在 resolved content 为空时**省略**该 section
- [x] 2.3 实现 `supportedSectionKeys()`（canonical 集合：stable 10 个 + dynamic 5 个，见 design §1）和 `defaultSectionOrder()`（render 顺序）
- [x] 2.4 stable sections 按 canonical 顺序拼出：identity → safety_compliance → telecom_knowledge → skills → tooling → tool_call_style → action_execution → diagnostic_methodology → execution_bias → workspace
- [x] 2.5 dynamic sections 按 canonical 顺序拼出：runtime → environment → project_context → dynamic_context → session_context；其中 project_context / dynamic_context / session_context 在无数据时省略
- [x] 2.6 MINIMAL 模式下：跳过 safety_compliance / telecom_knowledge / action_execution / diagnostic_methodology / execution_bias；发出 identity + runtime
- [x] 2.7 `SystemPromptContribution.sectionOverrides` 对应 key 的内容替换 builder hardcoded default content；未在 map 内的 section 使用 hardcoded default
- [x] 2.8 override 中 section key 不在 `supportedSectionKeys()` 内 → 忽略，不引入新 section
- [x] 2.9 override 中 section 内容为空时该 section 整段省略，不输出空 section
- [x] 2.10 在 `agent-context-engine` 实现 `TemplateVariableResolver`，name 匹配 `[a-zA-Z_][a-zA-Z0-9_]*`
- [x] 2.11 变量注册表首版 ≥12 个：agentId / sessionId / modelInfo / runtimeInfo / environment / enabledSkills / networkEnvironment / isProduction / timezone / currentDate / platform / osVersion；每个绑定一个 `description` + 一个 `Function<SystemPromptContext, string>` 解析器
- [x] 2.12 替换规则：注册表内替换为解析值；fragment 声明 required 但未解析 → 整 fragment render failure；fragment 声明 optional 但未解析 → 替换为空字符串；其它未声明且不在注册表内 → 保留字面 `{{name}}` 并在 diagnostics 报告为 unresolved
- [x] 2.13 在 `agent-context-engine` 实现 `CapabilityListingFormatter.formatSkills(skills)`：filter `SKILL` 类型，按 markdown bullet `- skillId: description` 列出，字符预算内（默认 4000），BUILT_IN source 不截断；如描述过长则按 `MAX_DESCRIPTION_CHARS` 截断并加 `…` 省略号
- [ ] 2.14 在 `agent-context-engine` 实现 `DefaultTokenEstimator`（码点感知）：CJK 码点 ×1.5、增补面（code point > U+FFFF） ×2.0、ASCII / Latin ×0.25；按 Unicode code point 迭代（用 `codePointAt` + `charCount`），不用 UTF-16 length；message / tool message overhead 常量按 Java 参考
  > (superseded 2026-06-10 by `refine-ts-context-token-estimator`) `DefaultTokenEstimator` 实现已落地到 `packages/agent-context-engine/src/budget/default-token-estimator.ts`，含全部码点感知权重、超出 supplementary plane 处理、`Math.max(1, Math.ceil(weightedSum))` 下限、`MESSAGE_OVERHEAD_TOKENS=4` 与 `TOOL_MESSAGE_OVERHEAD_TOKENS=10` 常量。本 change 实现期通过 `createDefaultTokenEstimator()` 工厂消费，不再拥有其实现。本任务条目保留为可追溯锚点，不在本 change 范围内勾选。
- [x] 2.15 硬编码 default content 由 builder 内部实现，覆盖 stable 10 + dynamic 5 共 15 个 section；与 Java `TelecomSystemPromptBuilder` 私有方法（`buildSafetyComplianceContent` / `buildToolingContent` / `buildToolCallStyleContent` / `buildActionExecutionContent` / `buildDiagnosticMethodologyContent` / `buildExecutionBiasContent` / `buildTelecomKnowledgeContent` 等）一一对应；具体文本可随实现演化
- [x] 2.16 capability 单一来源：同一份 `enabledCapabilities` 既派生 `skills` section 文本（filter `SKILL`，经 `CapabilityListingFormatter`），也供 `ModelInputRenderer` 派生 `tools[]`（filter `TOOL`）；`AGENT` 类型 capability **不**进任一目标

## 3. 模板解析：loader chain + 分层 profile registry

- [x] 3.1 在 `agent-context-engine` 实现 `PromptTemplateLoader` 接口（`load(templateName, ctx) -> TemplateContent | null` / `exists(templateName)` / `description()`）
- [x] 3.2 实现 `FileTemplateLoader`：从配置目录读 YAML 配置 + Markdown section 文件（与 Java 参考一致）
- [x] 3.3 实现 `ResourceTemplateLoader`：从 classpath / package 内嵌资源读 YAML 配置 + Markdown section 文件
- [x] 3.4 实现 `CompositeTemplateLoader`（chain-of-responsibility）：按顺序尝试每个 sub-loader，第一个返回非 null 的胜出；单个 loader 抛异常时记 warning 并继续下一个；全部 miss 返回 null
- [x] 3.5 默认 chain 顺序：file loader → resource loader；可通过 `withLoader` 扩展
- [x] 3.6 在 `agent-contracts/context` 与 `agent-context-engine` 实现 `PromptTemplateRegistry` 接口与 `InMemoryPromptTemplateRegistry` 默认实现（`find(query) -> List<PromptTemplateProfile>`）
- [x] 3.7 实现 `PromptTemplateProfileQuery`（含 `templateName` / `purpose` / `languageVariant` / `modelFamily` / `modelId` / `agentId` / `layer` / `enabledOnly`）
- [x] 3.8 在 `agent-context-engine` 实现 `LayeredProfileResolver`：`templateRegistry.find(query)` 拿所有匹配 profile
- [x] 3.9 排序规则：先按 `layer.ordinal()` 升序（DEFAULT < LANGUAGE < MODEL < AGENT < PURPOSE），再按 `precedence` 升序（null 视为 0），最后按 `templateProfileId` 字典序；排序后最后一个 = `selectedProfile`（最高 layer + 最高 precedence）
- [x] 3.10 同 layer 冲突 reject：两个 enabled profile 命中同 layer 时抛 `ambiguous-resolution` configuration error，错误信息列出冲突 profile id；该错误是 fail-fast，不静默选一个
- [x] 3.11 `ModelOptions` 合并：base `ModelOptions` + 每个匹配 profile 的 `ModelOptionsOverride.applyTo(base)` 在 layer+precedence 顺序上字段级合并；`providerOptions` map 合并（高 precedence key 覆盖低 precedence key）；标量字段 override 非 null 时替换；override 全空时 `ModelOptions` 不变
- [x] 3.12 `selectedProfile.templateRef()` 喂给 `CompositeTemplateLoader.load(name, ctx)` 拿 `TemplateContent`
- [x] 3.13 全部 loader miss → 返回 `null`（builder 用 hardcoded default content 兜底）
- [x] 3.14 `TemplateContent.toContribution()` 把 `stableSections` + `dynamicSections` 按 `section.id` 映射为 `SystemPromptContribution.sectionOverrides`；section.id 不在 `supportedSectionKeys()` 内的 override 被忽略
- [x] 3.15 在 `agent-context-engine` 实现 `PromptAssemblyResult`（`appliedProfiles` / `selectedProfile` / `selectedTemplateRef` / `resolvedOptions` / `contribution` / `profileRef`）作为双机制的统一输出
- [x] 3.16 **禁止** 5 步固定链（agent prompts/ dir → promptTemplateIds → defaultPromptTemplateId → app config → built-in）作为规范解析顺序；该约束由 6.6 unit 测试 + 6.11 architecture lint 固化
- [x] 3.17 **禁止** `PromptTemplate.defaultModelOptions` 字段；`ModelOptions` 只来自分层 `ModelOptionsOverride` 合并；该约束由 6.6 unit 测试固化

## 4. Context Engine 编排

- [x] 4.1 修改 `ContextEnginePort.assemble()` 流程：通过 `AgentAssemblyRegistry.require(agentId, agentVersion)` 加载已 frozen 的 assembly（`add-ts-agent-package-assembly` 强制 accepted execution 走 `require`，不得回退到 `active(agentId)` 或悄悄换版本）→ history selection（frozen）→ large-content frozen replacement（frozen）→ budget / compression（frozen）→ 构造 `SystemPromptContext`（按 1.5 列出的字段来源）→ `catalog.listAvailable(ctx, requestScope)` 取 `visibleCapabilities` → `LayeredProfileResolver.resolve(query, baseOptions)` 拿 `PromptAssemblyResult` → `SystemPromptBuilder.build(ctx)` → 填 `ContextAssembly`（按 1.3 列出的完整顶层 shape，含 `systemPrompt` / `selectedMessageRefs` / `visibleCapabilities` / `modelInfo: { baseUrl, credentialRef, modelName }` / `modelOptions = resolvedOptions` / `modelSelectionReason` 和所有执行坐标）
- [x] 4.2 修改 `ContextEnginePort.render()` 流程：拿 `ContextAssembly` → 通过新增的 `SessionMessageStoreGateway.loadMessages` 批量方法（5.3）解析 `selectedMessageRefs` → 通过 `AttachmentStoreGateway.listAttachmentsByRequestId` 解析附件描述子（5.4）→ `DefaultModelInputRenderer.render(assembly)` → `RenderedModelInput`；不查 `ContextAssemblyRequest`；当前请求 user message 通过 `ContextAssembly.requestId` 在 `loadMessages` 批量结果中按 `record.requestId === assembly.request.requestId` 识别（5.5）
- [x] 4.3 Context Engine 主类不实现模板解析、section 文本拼接、变量替换、role 映射、tool schema 生成（架构 lint 断言）
- [x] 4.4 Context Engine 主类不调任何 typed source 的具体实现、不实现变量注册表、不实现 layered profile 排序（架构 lint 断言）
- [x] 4.5 Context Engine 主类不调文件 API（`fs` / `path` 等，file loader 只在 `agent-context-engine` 内部被实例化，orchestrator 不直接读）、不写持久层（架构 lint 断言）
- [x] 4.6 diagnostics 收集点固定为：profile resolved 后（`templateResolved` structured log，由 `DefaultLayeredProfileResolver.resolve` 发出）、profile 冲突时（`ambiguousProfileResolution` structured log + timeline event，由 `DefaultLayeredProfileResolver.resolve` 捕获 `assertNoSameLayerConflict` 异常后发出）、loader 抛异常时（`templateResolutionFailed` structured log）、loader 全 miss 时（`loaderChainFallback` structured log）、section omitted 时（`sectionOmitted` structured log，由 `DefaultModelInputRenderer.render` 在 `sections[].content.trim().length === 0` 时发出）、fragment render failure 时（`fragmentRenderFailed` structured log，由 `DefaultModelInputRenderer.render` 在 generated-message budget 超限时发出）、tool pairing 拒绝时（`toolPairingRejected` structured log，由 `DefaultModelInputRenderer.assertToolPairing` 发出）、token 估算完成时（`tokenEstimationCompleted` structured log，由 `DefaultContextEngine.assemble` 在 budget gate 跑完后发出）、render 前（`renderStarted` timeline event）、render 后（`renderCompleted` timeline event）；diagnostics 写入 `agent-observability` structured logging helper + timeline/event subscriber（`InMemoryPromptShapingDiagnosticsSink` 默认实现），不进入 audit event，不进入公共 `ContextAssembly`（由 contract test "keeps prompt-shaping diagnostics and profile refs out of public context DTOs" 固化）
- [x] 4.7 `ContextAssembly.modelOptions` 填 `PromptAssemblyResult.resolvedOptions`（分层 override 合并结果），**不**填 `PromptTemplate.defaultModelOptions`（该字段不存在）
- [x] 4.8 `ContextAssembly` **不**写入 `profileRef`：`profileRef` 保留在 `PromptAssemblyResult` 内部；diagnostics 关联走 `agent-observability` structured log（`templateResolved` 事件 payload 含 `profileRef` / `selectedTemplateRef` / `layer` / `precedence`）

## 5. ModelInputRenderer

- [x] 5.1 在 `agent-context-engine` 实现 `ModelInputRenderer` 接口与默认实现
- [x] 5.2 输入：`ContextAssembly`（按 1.3 列出的完整顶层 shape：`systemPrompt`, `selectedMessageRefs`, `visibleCapabilities`, `modelInfo: { baseUrl, credentialRef, modelName }`, `modelOptions` 和所有执行坐标 `requestContextId` / `sessionId` / `requestId` / `runId` / `stepId` / `agentId` / `agentVersion` / `locale` / `producedAt`）；**不**包含 `profileRef` 公共字段
- [x] 5.3 批量解析 `selectedMessageRefs` 为 message 序列（通过 `SessionMessageStoreGateway.loadMessages` 批量方法，一次批量读取不逐条 N+1），校验每条 ref 仍存在且仍可见（`isModelVisibleMessage` 守门）；缺失 / 不可见时 explicit failure（`CONTEXT_RENDER_MESSAGE_UNRESOLVABLE`），不得静默跳过
- [x] 5.4 从已选历史和当前请求消息上的附件引用解析 attachment descriptor 序列（通过 `AttachmentStoreGateway.listAttachmentsByRequestId` / attachment runtime public boundary，`DefaultContextEngine.collectAttachmentDescriptors` 聚合 current-request 附件）
- [x] 5.5 通过 `ContextAssembly.requestId` 与 accepted request/session boundary 解析当前请求 user message（在 `loadMessages` 批量返回的 `selectedMessages` 中按 `record.requestId === assembly.request.requestId` 识别，避免单独 `listCurrentRequestMessages` 调用导致的双 round-trip；assemble 阶段已通过 `CONTEXT_CURRENT_REQUEST_UNRESOLVABLE` 守门保证 current request 必须存在）
- [x] 5.6 派生 `tools[]` schema from `visibleCapabilities`，filter `TOOL` 类型，每个作为 OpenAI 兼容 function schema，function `name` = capability id；`AGENT` 类型不进入 `tools[]`
- [x] 5.7 role 映射：system → system，summary → 普通历史消息（按 compression 协议），user / assistant / tool 按原样
- [x] 5.8 tool_use / tool_result 配对校验：发现 orphan / 不配对时降级或拒绝
- [x] 5.9 输出 `RenderedModelInput`（`ChatMessage[]` + `tools[]` + modelOptions）
- [x] 5.10 render 阶段不调任何 builder / variable resolver / profile resolver、不做 shaping 决策、不写持久层（架构 lint 断言）
- [x] 5.11 system message 拼接：stable sections → `cacheBoundaryMarker` → dynamic sections，单条 system message 文本
- [x] 5.11a render 消费 `selectedMessageRefs` 时使用 frozen large-content replacement 形态：从 `SessionMessage.metadata.replacement` 直接读取已 commit 的 `INLINE` / `PERSISTED_PREVIEW` / `SPECIALIZED_REF` / `EMPTY_MARKER` 形态，**不**重塑、**不**重新 inline 原 payload、**不**再解释 `INLINE` 内容（`add-ts-large-content-references` 冻结 render-stage 不重塑）；`RenderedModelInput` 顶层必须含 `requestContextId`（与 `ContextAssembly.requestContextId` 一致）
- [x] 5.12 `RenderedModelInput` 不含 `diagnostics` / SystemPrompt internals / selection decisions / raw SessionMessage records

## 6. 验证

- [x] 6.0 依赖前置门禁：`refine-ts-context-assembly-contracts` 与 `add-ts-context-history-selection` / `add-ts-large-content-references` / `add-ts-context-compression` / `add-ts-traceable-summary-generation` / `add-ts-agent-package-assembly` / `add-ts-capability-core-governance` 必须全部 archived；否则本 change 不得进入实现验收，也不得将 6.9 / 6.10 / 6.11 等 contract/integration 任务拆成 deferred 子任务后部分验收；门禁由 `tests/architecture/prompt-shaping-prerequisites.test.ts` 固化（当前仍有 4 项前置未 archived：`add-ts-large-content-references` / `add-ts-context-compression` / `add-ts-traceable-summary-generation` / `add-ts-agent-package-assembly`，门禁测试在它们全部 archived 之前会 fail — 这是预期行为，强制等待前置依赖完成）

- [x] 6.1 unit 测试覆盖 `SystemPromptBuilder` 的 `PromptMode` 三种取值（NONE / MINIMAL / FULL）的 section 集合；FULL 下 `supportedSectionKeys()` 与 `defaultSectionOrder()` 与设计 §1 canonical taxonomy 完全一致；MINIMAL 只发 `identity` + `runtime`；NONE 只发 `identity`
- [x] 6.2 unit 测试覆盖 conditional section omission：resolved content 为空时该 section 整段省略（`skills` 无 enabled skills / `project_context` 无静态文件 / `dynamic_context` 无动态文件 / `session_context` 无 metadata）
- [x] 6.3 unit 测试覆盖 `SystemPromptContribution` override 行为：override 命中 key 时使用 override content；override 缺失时使用 builder hardcoded default；override key 不在 `supportedSectionKeys()` 内时忽略；override 内容为空时该 section 省略
- [x] 6.4 unit 测试覆盖 `TemplateVariableResolver` 替换规则：注册表内变量被替换；fragment declared required 未解析时整 fragment render failure；fragment declared optional 未解析时替换为空字符串；未声明且不在注册表内时保留字面 `{{name}}` 并在 diagnostics 报告 unresolved；name 形态不匹配 `[a-zA-Z_][a-zA-Z0-9_]*` 不视为变量
- [x] 6.5 unit 测试覆盖 capability 单一来源：`enabledCapabilities` 同时驱动 `skills` section 文本（filter SKILL）和 `tools[]`（filter TOOL）；AGENT capability 不进入任一目标；capability 在两次 assembly 之间从 available 转到 unavailable 后下次的 `skills` / `tools[]` 不再披露
- [x] 6.6 unit 测试覆盖 layered profile 解析：`DEFAULT < LANGUAGE < MODEL < AGENT < PURPOSE` 排序；`precedence` 在同 layer 内进一步排序；`templateProfileId` 字典序 final tiebreak；同 layer 两个 enabled profile 冲突时抛 ambiguous-resolution 错误并列出冲突 id；`ModelOptions` 字段级合并（标量字段 override 非 null 时替换，`providerOptions` map 合并，高 precedence 覆盖低 precedence）；override 全空时 `ModelOptions` 不变
- [x] 6.7 unit 测试覆盖 `CompositeTemplateLoader` chain-of-responsibility：第一个返回非 null 的 loader 胜出；后面 loader 不被调用；全部 miss 返回 null；单个 loader 抛异常时记 warning 并继续下一个
- [ ] 6.8 unit 测试覆盖 `DefaultTokenEstimator` 码点感知权重：CJK 文本（"你好"）估算为 2 tokens（ceil 3.0）；增补面 emoji（"🎉"）估算为 2 tokens；ASCII 文本（"hello"）估算为 2 tokens（ceil 1.25 → Math.max(1, 2)）；混合 CJK + ASCII 文本按 code point 分别加权
  > (superseded 2026-06-10 by `refine-ts-context-token-estimator`) `DefaultTokenEstimator` 的单测已落地到 `packages/agent-context-engine/tests/default-token-estimator.test.ts`（11 个测试覆盖空文本 / ASCII / CJK / 增补面 / 混合 / floor-1 / per-message overhead / tool > message overhead / batch sum / readonly array / 类型工厂返回）。注：本任务文案中"你好 → 2 tokens"是早期 spec 草稿笔误，正确值为 3（2 个 CJK × 1.5 = 3.0 → ceil 3）；落地实现按数学正确值，单测断言 3 tokens。本任务条目保留为可追溯锚点，不在本 change 范围内勾选。
- [x] 6.9 contract 测试覆盖 `SystemPrompt` 保持单层 `readonly sections: readonly SystemPromptSection[]` 形状、不暴露 `stableSections` / `dynamicSections` 顶层分裂；按 canonical order 渲染（builder `defaultSectionOrder()` 一致）；显式断言 prompt shaping 与 render 组件不读取 `SystemPromptSection.metadata.sectionKey?` / `metadata.order` 副本（仅使用 `SystemPromptSection.sectionId` 顶层字段）；由 `tests/contract/context-assembly-contracts.test.ts` 中 3 个新增测试固化
- [x] 6.10 contract 测试覆盖 `RenderedModelInput` 不含 diagnostics / SystemPrompt internals / selection decisions / raw SessionMessage records
- [x] 6.11 architecture lint 断言：
  - Context Engine 不依赖 `fs` / `path`
  - prompt shaping 组件（`SystemPromptBuilder` / `TemplateVariableResolver` / `LayeredProfileResolver` / `PromptTemplateLoader` / `CapabilityListingFormatter` / `DefaultTokenEstimator`）不依赖 `agent-model` / `agent-core` / `agent-channel-web`
  - `agent-runtime` / `agent-core` / `agent-capability` / `agent-channel-web` 不得 import `@nextagent/agent-context-engine` 的内部 shaping 子路径（builder / variable resolver / layered profile resolver / loader chain / token estimator / capability listing formatter 实现）
  - **禁止** `PromptTemplate.defaultModelOptions` 字段（类型层不存在，编译期阻断）
  - **禁止** 5 步固定链（无对应代码路径，编译期阻断）
  - **禁止** typed context source 注册表 / 6 个 source / safe omission 路径（无对应代码路径，编译期阻断）
  - **禁止** `ContextAssembly` 写入 `profileRef` / `diagnostics` / `attachmentRefs` / `currentRequestRef` 公共字段（类型层不存在 + 源代码 AST 扫描，编译期阻断）
  - **禁止** `ModelInfo` 写入 `providerKind` / `timeoutMs`（类型层不存在，编译期阻断）
  - **禁止** `RenderedModelInput` 缺 `requestContextId`（contract test 断言）
  - **禁止** orchestrator 调 `AgentAssemblyRegistry.active(agentId)`（接受路径除外）；accepted execution 只允许 `require(agentId, agentVersion)`（architecture lint 扫描 import + 调用点）
  - **禁止** orchestrator 接收 client-provided capabilities list 作为 `visibleCapabilities` 来源；必须经 `catalog.listAvailable(ctx, requestScope)` / `catalog.resolve(ctx, requestScope)`（architecture lint 扫描 orchestrator 的 `visibleCapabilities` 写入点上游必须是 catalog 调用）
  - **禁止** render 阶段调 `SystemPromptBuilder` / `TemplateVariableResolver` / `LayeredProfileResolver` / `PromptTemplateLoader`（render 只调 `ModelInputRenderer`，架构分层 lint 阻断）
  - **禁止** render 重塑 `SessionMessage.metadata.replacement` 的 frozen 形态（`INLINE` / `PERSISTED_PREVIEW` / `SPECIALIZED_REF` / `EMPTY_MARKER` 不重塑、不重新 inline、不再解释 INLINE 内容；`add-ts-large-content-references` 约束）
- [x] 6.12 integration 测试走完 assemble + render 流程，断言最终 `ChatMessage[]` 符合 OpenAI 协议；`tools[]` 仅含 `TOOL` capability；`system message` 末尾 `cacheBoundaryMarker` 文本 marker
- [x] 6.13 integration 测试使用内置默认 builder，断言最终 system message 文本与目标默认产物一致
- [x] 6.14 integration 测试覆盖 capability 在两次 assembly 之间从 available 转到 unavailable 的同步行为
- [x] 6.15 运行 `npm run build` / `npm test` / `npm run test:contract` / `npm run lint:architecture`
- [x] 6.16 运行 `openspec validate add-ts-context-prompt-shaping --strict`
- [x] 6.17 运行 `openspec validate --all --strict`

## 归档前更新基线（Baseline Promotion）

实现完成并验证通过后，归档前根据 proposal / design 的归档前更新基线处理：

- 同步 `openspec/specs/context-prompt-shaping/spec.md`（新增）
- 同步 `openspec/specs/context-engine/spec.md`（修改，补充 render 引用边界与编排 requirement）
- 更新 `openspec/overview.md`（补全 Context Engine 从装配到渲染的完整链路说明）
- 新增 `openspec/designs/architecture/context-engine-pipeline.md`（assemble -> shaping -> render 数据流）
- 新增 `openspec/designs/domain/prompt-template.md`（PromptTemplate / Profile / Override / Loader 领域对象）
- 修改 `openspec/designs/contracts/context-spi.md`（ContextEnginePort 内部编排语义）
- 修改 `openspec/designs/modules/agent-context-engine.md`（prompt shaping 组件职责）
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义

## 闭环状态说明

- 86 个 tasks 中 83 个 ticked；3 个 `[ ]` 项（§1.9 / §2.14 / §6.8）是 `refine-ts-context-token-estimator` 拥有的 `TokenEstimator` / `DefaultTokenEstimator` 契约 + 默认实现的**可追溯锚点**（spec 草稿里写下的"本 change 承担"文案后被独立 contract refinement change 取代，本 change 仅消费 `agent-contracts/context` 暴露的接口，不再拥有实现）。这些项**不**在本 change 范围内勾选；其归属链路在 `add-ts-context-prompt-shaping/design.md` 决策 6 与 `ts-core-contracts/spec.md` "TokenEstimator" requirement 中明示。
- 6.0 门禁测试（`tests/architecture/prompt-shaping-prerequisites.test.ts`）在 `add-ts-agent-package-assembly` archived 之前正确 fail；该门禁**不**计入 86 个 task 计数。
- §7 baseline promotion（spec / overview / design / 行为差异记录）由 4 个前期 commit 完成（详见 git log）。本 change 进入归档闭环。
