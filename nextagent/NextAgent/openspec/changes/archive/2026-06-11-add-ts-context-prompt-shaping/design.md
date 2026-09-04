## 背景和现状（Context）

`ContextEnginePort` 在 `establish-ts-core-contracts` 定义了两个方法边界：`assemble()` 和 `render()`。上游 change 已经把"装配前"的决策冻结：

- `add-ts-context-history-selection`：history selection 在 `assemble()` 同步完成，输出 `ContextAssembly.selectedMessageRefs`
- `add-ts-large-content-references`：fresh-time offload 决定和 4 种 model-visible 形态（`INLINE` / `PERSISTED_PREVIEW` / `SPECIALIZED_REF` / `EMPTY_MARKER`）已冻结
- `add-ts-context-compression`：summary compression 在 `assemble()` 触发，`render()` 只消费已提交的 `SUMMARY` 消息
- `add-ts-traceable-summary-generation`：默认 summary generator 实现已落地

但 Context Engine 仍缺最后一段：把已稳定的"装配结果"组织成 SystemPrompt 文本，并渲染成 OpenAI 兼容的 `ChatMessage[]` + `tools[]`。

Java 参考实现（`java/modules/agent-context-{spi,engine}`）已经把目标态画清楚：`TelecomSystemPromptBuilder` 拥有**固定的 section taxonomy**（`identity` / `safety_compliance` / `telecom_knowledge` / `skills` / `tooling` / `tool_call_style` / `action_execution` / `diagnostic_methodology` / `execution_bias` / `workspace` / `runtime` / `environment` / `project_context` / `dynamic_context` / `session_context`），模板和 profile 只能 override content，**不能增加、删除、重排 section**。变量通过 `TemplateVariableResolver` 的注册表（≥16 个变量）解析，**不**存在 2 字段白名单。模板解析由 `PromptTemplateLoader` chain（file system + resource）+ 分层 `PromptTemplateProfile` registry（`DEFAULT < LANGUAGE < MODEL < AGENT < PURPOSE`）共同完成；`ModelOptions` 由 `ModelOptionsOverride` 在层+precedence 顺序上合并，**不**来自 `PromptTemplate.defaultModelOptions`。Token 估算按码点感知（CJK ×1.5、增补面 ×2.0、ASCII ×0.25）。

本 change 把 Java 模型迁移到 TS，并把"装配后的产物如何被组织成 SystemPrompt + 渲染成 model-consumable input"这一最小闭环在 TS 上落齐。spec 文件（`context-prompt-shaping/spec.md` / `context-engine/spec.md`）已经按 Java 模型写完，本 design 解释如何实现并保留 spec 已冻结的边界。

## 目标和边界（Goals / Non-Goals）

**目标：**

- 定义 `SystemPromptBuilder` 拥有的 fixed, mode-dependent section taxonomy：`FULL` / `MINIMAL` / `NONE` 三种 `PromptMode` 选择不同子集；模板/profile **只能 override content，不能增删改 section 集合或顺序**
- 定义 `TemplateVariableResolver` 的变量注册表（首版 ≥12 个，Java 实现 ≥16 个）和 `{{name}}` 替换规则：注册表内替换、required 未解析报 fragment render failure、optional 未解析填空、未知变量按字面 `{{name}}` 透传
- 定义模板解析的双机制：`PromptTemplateLoader` chain（chain-of-responsibility）+ 分层 `PromptTemplateProfile` registry（`DEFAULT < LANGUAGE < MODEL < AGENT < PURPOSE`）；**禁止**固定 5 步链
- 定义 `ModelOptions` 来源：base `ModelOptions` + 每个匹配 profile 的 `ModelOptionsOverride` 在 layer-then-precedence 顺序上字段级合并，`providerOptions` map 合并
- 定义 capability 单一来源规则：`enabledCapabilities` 既派生 `skills` SystemPrompt section 文本（仅 `SKILL` 类型），也派生 `RenderedModelInput.tools[]`（仅 `TOOL` 类型）；`AGENT` 不进任一目标
- 定义 ContextEnginePort 编排规则：`assemble()` 委托 layered profile resolver / loader chain / `SystemPromptBuilder` / `TemplateVariableResolver` / `ModelInputRenderer`；orchestrator 不实现模板解析、section 拼接、变量替换、role 映射、tool schema 生成
- 定义 render-stage 引用边界：`selectedMessageRefs` 表达历史，`requestId` + accepted request/session boundary 表达当前请求，附件从已选/当前消息的附件引用经 attachment boundary 解析；这些引用**不**作为 `SystemPrompt` section
- 定义 diagnostics 收集点：`agent-observability` structured logging helper + timeline/event subscriber；不写 audit event 入口；不进 `RenderedModelInput`；不新增 `ContextAssembly.diagnostics` 公共字段
- 定义 cache boundary 文本 marker 语义（`---[CACHE_BOUNDARY]---`）和码点感知 token 估算（CJK ×1.5、增补面 ×2.0、ASCII ×0.25）

**非目标：**

- 不定义具体 prompt template 全文（由 loader chain 加载或 builder hardcoded 默认）
- 不实现 history selection、budget/compaction、large-content replacement/offload（都已冻结）
- 不实现模型调用（归 `agent-model`）
- 不实现 summary 生成（归 `add-ts-traceable-summary-generation`）
- 不定义 prompt caching 的 provider 适配细节（归 `agent-model`）
- 不实现 typed context source 注册表 / 6 个 source / safe omission 路径：Java 模型已通过 `SystemPromptContext` 上的 `RuntimeInfo` / `EnvironmentInfo` / `TelecomContext` / `enabledCapabilities` / `projectContextFiles` / `sessionMetadata` 字段统一承载 builder 输入；本 change 不再单独维护 typed source 接口
- 不解决 budget 解释/超预算时的 render-stage 调整；未来 `add-ts-context-budget-explainability` 如需在 `ModelInputRenderer.render()` 之前接入轻量回调查点，作为 sibling change 引入
- 不允许 `agent-runtime` / `agent-core` / `agent-capability` / `agent-channel-web` 反向依赖 prompt shaping 组件；如未来需要，应用 architecture lint 阻断，并通过独立 contract refinement change 定义接口

## 选定的设计（Chosen Design）

### 0. agent-contracts 变更确认边界

本 change 需要补充 `agent-contracts/context` public contract：`SystemPrompt` / `SystemPromptSection` 既有形状、`SystemPromptBuilder` / `PromptMode` / `SystemPromptContext` / `SystemPromptContribution` 类型、`TemplateVariableResolver` 变量注册表常量与 type guard、`PromptTemplateProfile` / `ProfileLayer` / `ModelOptionsOverride` / `PromptTemplateRegistry` / `PromptTemplateLoader` 类型、`TokenEstimator` 接口与默认码点感知实现。该 delta 只补齐 prompt shaping 所需的 context contract，不迁移 owner、不新增 `agent-contracts` subpath、不改变 `SystemPrompt.stableSections` / `dynamicSections` 顶层形状，也不新增公共 `ContextAssembly.diagnostics` 字段。

确认结论：这些 contract delta 可在本 implementation change 内落地，因为它们只补齐 `agent-contracts/context` 已有 context owner 下的 prompt shaping 必要字段与类型，不重新定义前序核心契约的 owner、顶层结构或跨包边界。实施阶段必须保持该边界；若发现需要新增 `agent-contracts` subpath、迁移 owner、暴露 diagnostics 或改写 `ModelOptions` ownership，则必须停止并拆出独立 contract refinement change。

### 1. SystemPromptBuilder 拥有固定 taxonomy + PromptMode

`SystemPromptBuilder` 拥有 canonical section 集合、顺序和 stable/dynamic 分类。**section 集合和顺序由 builder 决定，不由解析到的模板决定**。`SystemPrompt` 保留核心契约已冻结的 `stableSections` / `dynamicSections` 形状；`SystemPromptSection` 保留 public `sectionId`（**不得**改名为 `sectionKey`）、`heading`、`content`、既有 `SystemPromptSectionMetadata`。section 的 stable/dynamic 分类由 builder 把它加入哪个 list 决定，**不是** section 自带 `source` 字段、**不是**从 source kind 派生。

Canonical taxonomy（与 Java `TelecomSystemPromptBuilder.SUPPORTED_SECTION_KEYS` / `DEFAULT_SECTION_ORDER` 对齐）：

- **Stable sections**（顺序固定）：`identity`、`safety_compliance`、`telecom_knowledge`、`skills`、`tooling`、`tool_call_style`、`action_execution`、`diagnostic_methodology`、`execution_bias`、`workspace`
- **Dynamic sections**（顺序固定，cache boundary 之后）：`runtime`、`environment`、`project_context`、`dynamic_context`、`session_context`

`PromptMode` 决定 builder 实际发出哪些 section：

- `NONE`：仅发出 `identity`
- `MINIMAL`：发出 `identity`（stable）+ `runtime`（dynamic）
- `FULL`：发出完整 canonical taxonomy，但每个 section 在 resolved content 为空时**省略**该 section（spec "Conditional sections are omitted when empty" Scenario）

`PromptMode` 由 build context 携带；未指定时默认 `FULL`。

```text
SystemPrompt {
  stableSections: SystemPromptSection[]
  dynamicSections: SystemPromptSection[]
  cacheBoundaryMarker: string  // 文本 marker，adapter 解释（既有字段，本 change 明确语义，默认 "---[CACHE_BOUNDARY]---"）
}

SystemPromptSection {
  sectionId: string                   // public 稳定唯一标识；builder 决定，不重命名为 sectionKey
  heading: string
  content: string                     // 渲染后内容
  metadata: SystemPromptSectionMetadata  // overridable / dependencies / 既有字段，本 change 不解读
}
```

builder 暴露 `supportedSectionKeys()`（canonical 集合）和 `defaultSectionOrder()`（render 顺序），prompt shaping 组件只读顶层 `sectionId` / `heading` / `content`，不解读 `metadata` 内的 `sectionKey?` / `order` 副本。

### 2. 模板和 profile override content，不 override section 集合

模板和 profile 解析到的内容通过 `SystemPromptContribution` 注入：`SystemPromptContribution.sectionOverrides: Map<sectionKey, content>`，key 是 canonical section key，value 是 override content。builder 对每个它会发出的 section：

- 若 `SystemPromptContribution` 对该 section key 有 override：用 override content
- 否则：用 builder 自己的 hardcoded default content（首版在 `agent-context-engine` 内部硬编码，对齐 Java `TelecomSystemPromptBuilder.buildSafetyComplianceContent()` / `buildToolingContent()` 等私有方法的产物）

约束（与 spec "Templates and profiles override section content, not the section set" 对齐）：

- 模板 **不能** 引入 builder 不发出的 section
- 模板 **不能** 删除 builder 会发出的 section
- 模板 **不能** 重排 section
- override 中对未在 `supportedSectionKeys()` 内的 section key **忽略**

模板加载的最终产物 `TemplateContent`（包含 `stableSections` / `dynamicSections` / `cacheBoundary`）通过 `toContribution()` 转换为 `SystemPromptContribution`，每个 section 的 `id` 映射到 `sectionOverrides` 的 key。这是模板内容进入 builder 的唯一通道。

### 3. `TemplateVariableResolver` 变量注册表

template 和 default section content 可包含 `{{variable}}` 占位符，name 匹配 `[a-zA-Z_][a-zA-Z0-9_]*`。`TemplateVariableResolver` 解析占位符，**用一组受治理的注册表**而不是两字段白名单。

首版注册表（与 Java `TemplateVariableResolver.defaultBindings()` 对齐，至少 12 个变量）：

| name | 描述 | 来源 |
|---|---|---|
| `agentId` | 智能体 ID | `SystemPromptContext.agentId` |
| `sessionId` | 会话 ID | `SystemPromptContext.sessionId` |
| `modelInfo` | 模型信息字符串 | `RuntimeInfo.render()` |
| `runtimeInfo` | runtime 信息块（agent + model + shell + python + thinking） | 内部渲染 |
| `environment` | 环境信息块（platform / OS / timezone / date） | 内部渲染 |
| `enabledSkills` | 已启用 skills 列表 | 从 `enabledCapabilities` 过滤 `SKILL`，按字符预算截断 |
| `networkEnvironment` | 网络环境（PROD / PREPROD / TEST / DEV） | `TelecomContext.networkEnvironment` |
| `isProduction` | 是否生产环境 | `TelecomContext.isProduction()` |
| `timezone` | 时区 | `EnvironmentInfo.timezone` |
| `currentDate` | 当前日期 | `EnvironmentInfo.currentDate` |
| `platform` | 平台信息 | `EnvironmentInfo.platform` |
| `osVersion` | 操作系统版本 | `EnvironmentInfo.osVersion` |

替换规则（与 spec "Section content is rendered through a fixed template-variable registry" 对齐）：

- name 在注册表内：替换为解析值
- name 不在注册表，**且**该 fragment 没声明 required/optional：保留字面 `{{name}}`，并在 diagnostics 报告为 unresolved
- name 是 fragment 声明的 required 但未解析：该 fragment 渲染记录为 render failure，presentation-safe reason 写入 diagnostics
- name 是 fragment 声明的 optional 但未解析：替换为空字符串

**禁止** 2 字段（`agentDisplayName` / `agentDescription`）白名单硬拒绝任何其它变量；governed 集合就是注册表，未知变量降级为字面透传而非整模板失败。如未来扩展注册表，通过独立 OpenSpec change 在本任务外更新。

### 4. 模板解析：loader chain + 分层 profile registry

模板解析由两个协作机制完成（与 spec "Prompt template resolution uses a loader chain and a layered profile registry" 对齐）：

#### 4.1 `PromptTemplateLoader` chain

`PromptTemplateLoader` 接口接收 template name + `SystemPromptContext`，返回 `TemplateContent` 或 `null`。首版默认 chain 是一个 file-system loader 后跟一个 classpath/resource loader，**chain-of-responsibility**：第一个返回非 null 的 loader 胜出。全部 miss 时降级到 builder hardcoded default content。

`CompositeTemplateLoader` 持有 `List<PromptTemplateLoader>`，按顺序尝试，单个 loader 抛异常时记 warning 并继续下一个。`FileTemplateLoader` 从配置目录读 YAML 配置 + Markdown section；`ResourceTemplateLoader` 从 classpath / package 内嵌资源读。两种 loader 都不命中时返回 `null`。

loader chain **不是** 固定 5 步（agent prompts/ → promptTemplateIds → defaultPromptTemplateId → app config → built-in）：**禁止** 把 5 步链作为规范解析顺序。

#### 4.2 分层 `PromptTemplateProfile` registry

`PromptTemplateProfile` registry 按以下 5 层组织（`ProfileLayer` 枚举）：

```text
DEFAULT < LANGUAGE < MODEL < AGENT < PURPOSE
```

`PromptTemplateProfile` 字段：`templateProfileId` / `templateName` / `languageVariant` / `modelFamily` / `templateRef` / `fallbackTemplateRef` / `enabled` / `layer` / `modelId` / `agentId` / `purpose` / `precedence` / `ModelOptionsOverride optionsOverride`。

`LayeredProfileResolver` 用 `PromptTemplateProfileQuery`（含 `templateName` / `purpose` / `languageVariant` / `modelFamily` / `modelId` / `agentId` / `layer` / `enabledOnly`）从 `PromptTemplateRegistry.find()` 拿到所有匹配 profile，按以下规则排序并合并：

- 排序键：`layer.ordinal()` 升序 → `precedence` 升序（null 视为 0）→ `templateProfileId` 字典序
- 排序后列表的最后一个 = `selectedProfile`（最高 layer + 最高 precedence）
- 同 layer 出现两个 enabled profile：抛 ambiguous-resolution configuration error，列出冲突 profile id
- `selectedProfile.templateRef()` 喂给 `PromptTemplateLoader` chain 拿 `TemplateContent`
- 所有匹配 profile 的 `optionsOverride` 在 layer+precedence 顺序上**叠加**到 base `ModelOptions`，得到 `resolvedOptions`

`TemplateContent` 调 `toContribution()` 转成 `SystemPromptContribution` 喂给 builder。`PromptAssemblyResult` 是这两个机制的统一输出：`appliedProfiles` / `selectedProfile` / `selectedTemplateRef` / `resolvedOptions` / `contribution` / `profileRef`。

**公共契约声明（跨 change 消费入口）：** `LayeredProfileResolver` / `PromptTemplateProfileQuery` / `PromptTemplateRegistry` / `PromptAssemblyResult` 均为 `agent-contracts/context` 下的公共契约类型，不仅在 `ContextEnginePort` 内部使用：

- `add-ts-traceable-summary-generation` 通过 `LayeredProfileResolver.resolve(query, baseOptions)` 消费，query 携带 `purpose = "SUMMARY_GENERATION"`，内置 fallback template ref `compact-summary/v1`；这是该 change 在 design / spec 中明确标注的 prompt template 解析入口
- 其它按 purpose 解析的场景（如未来的工具描述、模型评审）也走同一 resolver 入口；不得在 `agent-context-engine` 之外另造 prompt template 解析路径

实现要点：`LayeredProfileResolver` / `PromptTemplateProfileQuery` / `PromptAssemblyResult` 的字段形状在 `agent-contracts/context` 公共导出；具体排序 / 合并 / 加载逻辑实现在 `agent-context-engine` 内部，对外只暴露 resolver 行为。

### 5. `ModelOptions` 来自分层 override 合并

`ModelOptions`（`temperature` / `maxTokens` / `topP` / `thinking` / `providerOptions`）**不**来自 `PromptTemplate.defaultModelOptions`（该字段不存在）。`ModelOptions` 由 base + 每个匹配 profile 的 `ModelOptionsOverride.applyTo()` 在 layer-then-precedence 顺序上字段级合并得到：

- 标量字段（`temperature` / `maxTokens` / `topP` / `thinking`）：override 非 null 时替换
- `providerOptions` map：合并，高 precedence key 覆盖低 precedence key
- override 全空（`isEmpty()`）：`ModelOptions` 不变

### 6. Capability 披露：单一来源，两个 destination

`enabledCapabilities`（在 `SystemPromptContext` 上 / `visibleCapabilities` 在 `ContextAssembly` 上）驱动两个目标，从不两边偏离（与 spec "Capability disclosure renders skills as text and tools as schema" 对齐）：

- `skills` SystemPrompt section 文本：仅含 `SKILL` 类型 capability，按 markdown bullet（`- skillId: description`）列出，字符预算内，BUILT_IN source 不截断；通过 `CapabilityListingFormatter.formatSkills()` 实现
- `RenderedModelInput.tools[]`：仅含 `TOOL` 类型 capability，每个作为 OpenAI 兼容 function schema，function `name` = capability id
- `AGENT` 类型 capability **不**进入任一目标

两个 destination 都从同一份 `enabledCapabilities` 派生；capability 在两次 assembly 之间从 available 转到 unavailable 时，下一次的 `skills`（SKILL）或 `tools[]`（TOOL）也立即不再披露。

**`visibleCapabilities` 是 catalog request-scoped 视图：** `ContextAssembly.visibleCapabilities` 由 orchestrator 调用 `catalog.listAvailable(ctx, requestScope)` / `catalog.resolve(ctx, requestScope)` 获得，已经按 `AgentAssembly.capabilityBindings` + `AvailabilityStatus`（排除 `DISABLED` / `UNAVAILABLE`）+ catalog 冲突解决（`add-ts-capability-core-governance` 的 catalog extension point）过滤；orchestrator 不得接收 client-provided capabilities list 作为 `visibleCapabilities` 来源；model 边界只看到 `resolve` 通过的 capability descriptor。两个 destination（`skills` section 文本 / `tools[]`）只能从这一份视图派生，不得在 builder 或 renderer 内重新按 `providerKind` / `providerId` 二次过滤（catalog 已做完）。

### 7. ContextEnginePort 编排

`ContextEnginePort.assemble()` 流程（与 spec `Context Engine orchestrates prompt shaping` 对齐）：

```text
1. 通过 AgentAssemblyRegistry.require(agentId, agentVersion) 加载已 frozen 的 assembly
   （add-ts-agent-package-assembly 强制 accepted execution 走 require，不得回退到 active(agentId) 或悄悄换版本）
2. history selection (frozen, from add-ts-context-history-selection)
3. large-content frozen replacement (frozen, from add-ts-large-content-references)
4. budget / compression (frozen, from add-ts-context-compression)
5. 构造 SystemPromptContext 字段来源：
   - sessionId / agentId / agentVersion: 来自 ContextAssemblyRequest + AgentAssembly
   - runtimeInfo (model / modelFamily / shell / pythonVersion / thinkingLevel):
       来自 AgentAssembly.runtimeSettings + AgentAssembly.modelProfileIds 解析结果
   - environmentInfo (platform / osVersion / timezone / currentDate):
       来自 trusted runtime 边界（与 identityContext 一起由 channel/auth boundary 携带），
       不得从请求体、模型输出或 capability 参数覆盖
   - telecomContext (networkEnvironment / operationLevel / ...):
       来自 AgentAssembly.runtimeSettings
   - workspaceDir: 来自 AgentAssembly.workspaceDir
   - providerContribution: 来自 PromptAssemblyResult.contribution（step 6 之后）
   - projectContextFiles / sessionMetadata: 来自 trusted boundary
   - enabledCapabilities: 来自 catalog.listAvailable(ctx, requestScope)（见 §6）
   - promptMode: 来自 ContextAssemblyRequest.purpose 映射 + AgentAssembly.promptTemplateIds 解析
6. layered profile resolver.resolve(query, baseOptions) -> Optional<PromptAssemblyResult>
   - 用 query 命中 PromptTemplateProfile
   - 排序 + 同 layer 冲突校验
   - 合并 ModelOptionsOverride -> resolvedOptions
   - 选 selectedProfile，喂 templateRef 给 loader chain
   - TemplateContent.toContribution() -> SystemPromptContribution
7. systemPromptBuilder.build(systemPromptContext) -> SystemPrompt
   - 按 PromptMode 选 section 子集
   - 对每个发出 section 查 contribution 是否有 override；无则用 builder hardcoded default
   - 调 TemplateVariableResolver 替换每个 section content 里的 {{variable}}
   - 拼接 stable / dynamic 列表 + cacheBoundaryMarker
8. 填 ContextAssembly: { requestContextId, sessionId, requestId, runId, stepId,
                          agentId, agentVersion, locale, producedAt,
                          systemPrompt, selectedMessageRefs, visibleCapabilities,
                          modelInfo: { baseUrl, credentialRef, modelName },
                          modelOptions: resolvedOptions,
                          modelSelectionReason }
   - `profileRef` 不写入 `ContextAssembly`：冻结契约（`establish-ts-core-contracts`）的 `ContextAssembly` 没有该字段，且 `refine-ts-context-assembly-contracts` 严格限制新增公共字段；`profileRef` 保留在 `PromptAssemblyResult` 内部，并随 `templateResolved` 等结构化日志事件进入 `agent-observability` 做 diagnostics 关联
   - `modelInfo` 形状固定为 `{ baseUrl, credentialRef, modelName }`，不携带 `providerKind` / `timeoutMs`：这两个字段属于 `ModelInvocationRequest`，在 runtime 进入 `agent-model` 边界时由 `ModelInvocationService` 注入，不在 `ContextAssembly` 范围内
   - `visibleCapabilities` 是 catalog `listAvailable(ctx, requestScope)` 的 request-scoped 视图（见 §6）；orchestrator 调 catalog 后再写入 assembly，不得接收 client-provided capabilities list 作为来源
   - 既有执行坐标（`requestContextId` / `sessionId` / `requestId` / `runId` / `stepId` / `agentId` / `agentVersion` / `locale`）从 `ContextAssemblyRequest` 透传；`producedAt` 由 orchestrator 在装配完成时填
```

`ContextEnginePort.render()` 流程：

```text
1. 接收 ContextAssembly（使用 assembly 内既有执行坐标和 refs，无需查 ContextAssemblyRequest）
2. ModelInputRenderer.render(assembly) -> RenderedModelInput
   - 消费 selectedMessageRefs 时使用 frozen replacement 形态：
       渲染从 SessionMessage.metadata.replacement 直接读取已 commit 的
       INLINE / PERSISTED_PREVIEW / SPECIALIZED_REF / EMPTY_MARKER 形态，
       不重塑、不重新 inline 原 payload、不再解释 INLINE 内容；
       缺失 / 不可见的已选消息
       走 explicit failure 或 explicit degrade（标 diagnostics），不得静默跳过
3. 将 render-stage diagnostics 写入 agent-observability structured logging helper 和 timeline/event subscriber
4. 返回 RenderedModelInput（顶层必须含 requestContextId）
```

ContextEnginePort 主类**不**实现：

- 模板解析（归 `LayeredProfileResolver` + `PromptTemplateLoader` chain）
- section 文本拼接（归 `SystemPromptBuilder`）
- 变量替换（归 `TemplateVariableResolver`）
- role 映射 / tool schema 生成（归 `ModelInputRenderer`）

ContextEnginePort 主类**不**调：

- 文件系统 API（`fs` / `path` 等）—— file loader 只在 `agent-context-engine` 内部被实例化，orchestrator 不直接读
- 持久化层写入
- `SystemPromptBuilder` 之外的任何模板内容生成（orchestrator 只委托，不拼接 section text）

### 8. Diagnostics

prompt shaping diagnostics 为实现内安全诊断对象，按以下 sink 分支记录，不新增公共 `ContextAssembly.diagnostics` 字段：

| 事件名 | sink | 记录内容 |
|---|---|---|
| `templateResolved` | structured logging helper | profileRef / selectedTemplateRef / layer / precedence |
| `templateRejected` | structured logging helper + timeline event | 拒绝原因 / 跳出的 templateRef |
| `templateResolutionFailed` | structured logging helper + timeline event | 最终降级失败路径，算法停止 |
| `ambiguousProfileResolution` | structured logging helper + timeline event | 同 layer 冲突的 profile id 列表 |
| `loaderChainFallback` | structured logging helper | 哪个 loader 返回 null |
| `sectionOmitted` | structured logging helper | sectionKey / reason（空 content / override-empty / fragment render failure） |
| `fragmentRenderFailed` | structured logging helper | sectionKey / missingRequiredVariables |
| `tokenEstimationCompleted` | structured logging helper | systemPromptTokenEstimate / 码点分布 |
| `renderStarted` | timeline event | assembly 原始字节点 |
| `renderCompleted` | timeline event | messages / tools / 综合 token 估算 |
| `toolPairingRejected` | structured logging helper | 孤儿 / 不配对的 tool_call_id |

diagnostics 不进入 `RenderedModelInput`；audit event 已用于 gateway/capability/hook/checkpoint/terminal commit 等键值事实，prompt shaping diagnostics 不进入 audit event 以遵循外延限定；如未来需要将 prompt shaping 降级或最终失败写入 audit event，必须通过独立 contract refinement change 定义 audit event 类型。

```text
PromptShapingDiagnostics {
  profileRef?: string
  selectedTemplateRef?: string
  resolvedAt: timestamp
  sections: SectionDiagnostic[]       // 每个 section 一条
  systemPromptTokenEstimate: number   // 码点感知估算
  fallbackReasons: FallbackReason[]   // profile 降级、loader 降级
}

SectionDiagnostic {
  sectionKey: string
  status: "ok" | "fallback" | "omitted" | "render-failed"
  reason?: string                     // presentation-safe
  estimatedTokens: number
}
```

### 9. Cache boundary

`SystemPrompt.cacheBoundaryMarker` 是文本 marker（默认 `---[CACHE_BOUNDARY]---`），`ModelInputRenderer` 把它原样写入 system message 末尾的 stable / dynamic 段之间。provider adapter 解释这个 marker，决定 prefix cache 复用策略。不引入结构化 cache hint 字段，避免和 provider 协议耦合。

### 10. Token estimation

token 估算用码点感知启发式（与 spec "Token estimation is code-point aware" 对齐），**不**用扁平字符比例：

- CJK 码点：×1.5 tokens/char
- 增补面（code point > U+FFFF，含 emoji）：×2.0 tokens/char
- ASCII / Latin：×0.25 tokens/char（≈ 4 字符/token）

按 Unicode code point 迭代，**不**用 UTF-16 length（避免 surrogate pair 切错）。结果写入 diagnostics，不进 `RenderedModelInput`。`TokenEstimator` 接口与默认码点感知实现都进 `agent-context-engine`，可被 `agent-memory` / `agent-capability` 等上游消费方共用。

### 11. 字段命名约定

| 字段 | 命名 | 位置 |
|---|---|---|
| `sectionId` | 字符串，builder 内唯一 | `SystemPromptSection` 顶层；`metadata.sectionKey?` 仅为 legacy metadata，不在顶层 |
| `SystemPromptContribution.sectionOverrides` | `Map<sectionKey, content>` | contribution |
| `PromptMode` | 枚举 `FULL` / `MINIMAL` / `NONE` | `SystemPromptBuilder.PromptMode` |
| `ProfileLayer` | 枚举 `DEFAULT` / `LANGUAGE` / `MODEL` / `AGENT` / `PURPOSE` | `PromptTemplateProfile.layer` |
| `ModelOptionsOverride` | record（temperature / maxTokens / topP / thinking / providerOptions） | `PromptTemplateProfile.optionsOverride` |
| 变量 name | `[a-zA-Z_][a-zA-Z0-9_]*` | `TemplateVariableResolver` 注册表 |

## 数据流（Data Flow）

以 `FULL` 模式 + 单个 PURPOSE 层 profile 命中 + loader chain 命中 file loader 为目标产物，走通完整链路：

```text
ContextAssemblyRequest { sessionId, agentId, requestId, requestContextId, runId, stepId, language, purpose }
  -> 加载 accepted agent configuration (AgentAssembly)
  -> history selection -> selectedMessageRefs [frozen]
  -> large-content frozen replacement [frozen]
  -> budget / compression (若 prior history 超预算) [frozen]
  -> PromptTemplateProfileQuery = { purpose, language, modelFamily, modelId=modelName, agentId, enabledOnly=true }
  -> LayeredProfileResolver.resolve(query, baseOptions)
       -> PromptTemplateRegistry.find(query) -> [
            { id: "default-zh", layer: DEFAULT, precedence: 0, optionsOverride: { temperature: 0.7 }, enabled: true },
            { id: "telecom-zh", layer: LANGUAGE, precedence: 0, optionsOverride: { maxTokens: 4096 }, enabled: true },
            { id: "telecom-sonnet", layer: MODEL, precedence: 0, optionsOverride: { providerOptions: {...} }, enabled: true },
            { id: "agent-ops-direct", layer: AGENT, precedence: 0, optionsOverride: { temperature: 0.2 }, enabled: true },
            { id: "system-prompt-default", layer: PURPOSE, precedence: 0, optionsOverride: {}, enabled: true }
          ]
       -> 按 layer ordinal + precedence 排序
       -> 同 layer 冲突校验（无冲突）
       -> 选 last = system-prompt-default
       -> applyOverrides: base -> temperature 0.7 -> maxTokens 4096 -> providerOptions merged -> temperature 0.2
       -> resolvedOptions = { temperature: 0.2, maxTokens: 4096, topP: null, thinking: defaults(), providerOptions: merged }
       -> loader chain.load("system-prompt-default", context) -> FileTemplateLoader 命中
            -> TemplateContent { name: "system-prompt-default", stableSections: [...], dynamicSections: [...], cacheBoundary: "---[CACHE_BOUNDARY]---" }
       -> TemplateContent.toContribution() -> SystemPromptContribution { sectionOverrides: { safety_compliance: "...", tooling: "...", ... } }
  -> 构造 SystemPromptContext {
       sessionId, agentId,
       runtimeInfo: { model, modelFamily, shell, pythonVersion, thinkingLevel },
       environmentInfo: { platform, osVersion, timezone, currentDate },
       telecomContext: { networkEnvironment, operationLevel, ... },
       providerContribution: <from PromptAssemblyResult>,
       projectContextFiles: [],
       enabledCapabilities: [ ... SKILL x N, ... TOOL x M ],
       sessionMetadata: {},
       promptMode: FULL
     }
  -> SystemPromptBuilder.build(context)
       -> promptMode == FULL
       -> buildStableSections(context): 10 个 section, 用 contribution.sectionOverrides 替换对应 key 的 content，其余用 hardcoded default
       -> buildDynamicSections(context): 5 个 section, enabledSkills 从 enabledCapabilities 过滤 SKILL 后由 CapabilityListingFormatter 渲染
       -> 每个 section content 调 TemplateVariableResolver.resolve(content, context)
            -> {{timezone}} -> "Asia/Shanghai"
            -> {{currentDate}} -> "2026-06-10"
            -> {{enabledSkills}} -> "- skill-a: ...\n- skill-b: ..."
            -> 其它注册表变量同上替换
       -> 拼接 SystemPrompt { stableSections: [...10], dynamicSections: [...5], cacheBoundaryMarker: "---[CACHE_BOUNDARY]---" }
  -> 填 ContextAssembly {
       requestContextId, sessionId, requestId, runId, stepId,
       agentId, agentVersion, locale, producedAt,
       systemPrompt,
       selectedMessageRefs,
       visibleCapabilities,                 // 来自 catalog.listAvailable(ctx, requestScope)
       modelInfo: { baseUrl, credentialRef, modelName },
       modelOptions: resolvedOptions,       // 来自 layered override 合并，不来自 PromptTemplate
       modelSelectionReason
       // profileRef 不写入 ContextAssembly；保留在 PromptAssemblyResult 内部，
       // 走 agent-observability structured log 做 diagnostics 关联
     }
  -> ModelInputRenderer.render(assembly)
       -> system message: 合并 stableSections/dynamicSections 文本 + cache marker
       -> history messages: 解析 selectedMessageRefs 为 ChatMessage[]（批量读取）
       -> current request: 按 requestId 解析当前 user message
       -> attachment messages: 解析已选历史和当前请求消息上的附件引用
       -> tools: 从 visibleCapabilities 过滤 TOOL，派生 tools[] (AGENT 不入 tools[])
       -> 输出 RenderedModelInput {
            requestContextId, sessionId, requestId, runId, stepId,
            messages: [...], tools: [...], modelOptions: resolvedOptions
          }
```

## 质量属性（Quality Attributes）

| 属性 | 设计决策 | 验证入口 |
|---|---|---|
| 安全 | 变量注册表 + required/optional 声明；unknown 变量字面透传而非失败；safe omission 文本 presentation-safe；diagnostics 隐藏 raw 内容 | 变量替换测试、source 失败测试、diagnostics 内容测试 |
| 性能 | sections 拼接 O(n)；token 估算按 code point 一次扫描；cache marker 复用 prefix cache | token 估算测试、render 性能测试 |
| 可靠性 | layered profile 排序 + 同 layer 冲突 fail-fast；loader chain 链式降级；render 不依赖 build；assemble 不依赖 render | profile 冲突测试、loader miss 测试、orchestration 测试 |
| 可维护性 | 4 个职责清晰组件（resolver / loader / builder / renderer）；注册表是数据驱动 | 组件契约测试、architecture lint |
| 可测试性 | TemplateVariableResolver / CapabilityListingFormatter / TokenEstimator 可独立测；resolver / loader / builder / renderer 可独立测 | unit + integration 测试 |
| 可追溯 | diagnostics 完整记录 profileRef / sectionKey / fallback reason | diagnostics 测试 |

## 文档归属（Documentation Ownership）

- 行为粒度：相关 `specs/*.md`（`context-prompt-shaping` / `context-engine`）
- 架构与领域视图：相关 architecture / domain / contract 文档
- 如需长期保留取舍，可补充 ADR

## 风险与取舍（Risks / Trade-offs）

- [风险] Token 估算用码点加权启发式，与实际 tokenizer 仍有偏差 -> 缓解：采用与 Java 相同的 CJK ×1.5 / 增补面 ×2.0 / ASCII ×0.25 权重，并保留 `TokenEstimator` 接口以便后续接入精确 tokenizer
- [风险] `ModelOptions` 合并顺序依赖 profile layer+precedence 排序，配置错位会引入隐式覆盖 -> 缓解：同 layer 冲突抛 ambiguous-resolution 错误并列出冲突 id
- [取舍] `ModelOptions` 不来自 `PromptTemplate.defaultModelOptions`，而来自分层 `ModelOptionsOverride` 合并 -> 特色：保证 model 行为由 profile 控制，与 Java 模型一致；如未来 `ModelProfile` 自身需要 options，可通过新 change 扩展 profile
- [取舍] Cache boundary 用文本 marker 而非结构化字段 -> 简化了 render 输出；如 provider 需要结构化 cache hint，adapter 层可解析 marker 并转换
- [取舍] builder 拥有 section 集合，模板只能 override content -> 牺牲了"模板自由增减 section"的能力，换取 builder 可控的稳定 prefix cache 行为；如未来需要模板引入新 section，必须开独立 OpenSpec change 扩展 builder taxonomy
- [取舍] `add-ts-context-budget-explainability` 不作为本 change 的依赖 -> 该 change 当前为 active，但本 change 不消费其预算解释产出接口；如未来 prompt shaping 需要预算策略解释，作为后续 change 引入，不污染本 change 边界

## 开放问题（Open Questions）

无。`ModelOptions` 来源、cache boundary 表示、token 估算策略、template 解析双机制、capability 单一来源、`add-ts-context-budget-explainability` 处理方式已在本 design 中确定。

## 规范和设计边界（Specification and Design Boundary）

本 change 的 delta spec 定义 prompt shaping 的可观察结果与稳定边界：builder 拥有 section 集合和顺序、模板/profile override content、变量注册表、loader chain + 分层 profile registry、`ModelOptions` 合并、capability 单一来源、render 边界、diagnostics 不进 model input、码点感知 token 估算。

具体 section 内容、profile 配置、token 权重数值、cache marker 字符串、变量注册表扩展是 design 选择，记录在本文档，可随实现演化而不影响 spec。

## 实施门禁（implementation gate）

本 design 的实现与验收不得在以下 6 个 active sibling change 全部 archive 之前起跑：

- `add-ts-context-history-selection`
- `add-ts-large-content-references`
- `add-ts-context-compression`
- `add-ts-traceable-summary-generation`
- `add-ts-agent-package-assembly`
- `add-ts-capability-core-governance`

roadmap v2 当前把这 6 个 change 全部标记为 active。若在实现期发现任意一个未 archive，本 design 的 contract / integration 部分须 split 为 deferred 子任务或拒绝验收。

本 design 不再单独依赖 `add-ts-context-budget-explainability`；该 change 在 roadmap v2 当前亦为 active，但本 design 不消费其产出接口。
