## ADDED Requirements

### Requirement: SystemPromptBuilder 拥有固定的、依赖模式的 section 分类

`SystemPromptBuilder` SHALL 拥有 SystemPrompt section 的规范集合、它们的顺序以及它们的 stable/dynamic 分类。Section 集合与顺序 SHALL 由 builder 为已受理的 prompt 模式决定，而不是由已解析的 template 决定。Builder SHALL 暴露 `supportedSectionKeys()`（它能发出的固定 section key 集合）和 `defaultSectionOrder()`（跨 stable 与 dynamic section 的固定渲染顺序）。

规范分类 SHALL 是：
- stable section，按序为：`identity`、`safety_compliance`、`telecom_knowledge`、`skills`、`tooling`、`tool_call_style`、`action_execution`、`diagnostic_methodology`、`execution_bias`、`workspace`
- dynamic section，按序为：`runtime`、`environment`、`project_context`、`dynamic_context`、`session_context`

一个 section 的 stable 或 dynamic 分类 SHALL 由 builder 把它追加到哪个列表决定，而不是由逐 section 的 `source` 字段决定，也不是从任何 source kind 派生。`SystemPrompt` SHALL 保留 core contract 的 `stableSections` / `dynamicSections` shape；`SystemPromptSection` SHALL 保留公开的 `sectionId`（MUST NOT 改名为 `sectionKey`）、`heading`、`content` 和既有的 `SystemPromptSectionMetadata`。

#### Scenario: Builder 决定 section 集合

- **WHEN** builder 以 FULL 模式构建一个 SystemPrompt
- **THEN** 该 SystemPrompt 恰好包含 builder 为该模式的规范 section 集合
- **AND** template 不能添加 builder 不发出的 section，也不能移除 builder 发出的 section

#### Scenario: Section 顺序由 builder 固定

- **WHEN** builder 构建一个 SystemPrompt
- **THEN** stable section 按 builder 的 stable 顺序发出，dynamic section 按 builder 的 dynamic 顺序发出
- **AND** 渲染后的 prompt 依次是 stable section、cache 边界标记、dynamic section

#### Scenario: 条件 section 在为空时被省略

- **WHEN** 某个 section 解析出的内容为空白（例如没有启用 skills 的 `skills`，或没有支撑数据的 `project_context` / `dynamic_context` / `session_context`）
- **THEN** builder 从 SystemPrompt 中省略该 section，而不是发出空 section

### Requirement: Prompt 模式选择构建哪些 section

Builder SHALL 接受取值恰为 `FULL`、`MINIMAL` 或 `NONE` 的 `PromptMode`，并 SHALL 按模式改变发出的 section 集合：
- `NONE` SHALL 只发出 `identity` section
- `MINIMAL` SHALL 发出 `identity`（stable）和 `runtime`（dynamic）
- `FULL` SHALL 发出完整的规范分类

Prompt 模式 SHALL 由 build context 携带，在未另行指定时 SHALL 默认为 `FULL`。

#### Scenario: NONE 模式只发出 identity

- **WHEN** builder 以 `PromptMode.NONE` 构建
- **THEN** SystemPrompt 只包含 `identity` section

#### Scenario: MINIMAL 模式发出 identity 和 runtime

- **WHEN** builder 以 `PromptMode.MINIMAL` 构建
- **THEN** SystemPrompt 包含 `identity` stable section 和 `runtime` dynamic section
- **AND** 不包含 safety、domain、tooling 或 policy section

#### Scenario: FULL 模式发出完整分类

- **WHEN** builder 以 `PromptMode.FULL` 构建
- **THEN** SystemPrompt 包含完整的规范 stable 与 dynamic section 集合，受内容为空时的逐 section 省略约束

### Requirement: Template 与 profile 覆盖 section 内容，而不是 section 集合

已解析的 template SHALL 贡献以 section key 为键的逐 section 内容覆盖，通过 `SystemPromptContribution` 应用。对 builder 发出的每个 section，当该 section key 存在覆盖时，它 SHALL 使用贡献的覆盖内容，否则使用 builder 的硬编码默认内容。Template SHALL NOT 引入 builder 不发出的 section，SHALL NOT 移除 section，也 SHALL NOT 重排 section。

#### Scenario: Template 覆盖某个 section 的内容

- **WHEN** 已解析的 contribution 对 builder 发出的某个 section key 携带覆盖
- **THEN** 该 section 的内容是覆盖内容
- **AND** 所有其他 section 使用 builder 的默认内容

#### Scenario: Template 缺少对某个已发出 section 的覆盖

- **WHEN** builder 发出一个没有对应覆盖的 section
- **THEN** 该 section 的内容是 builder 的硬编码默认内容

#### Scenario: 对未知 section key 的覆盖被忽略

- **WHEN** 一个 contribution 携带的覆盖的 section key 不在 `supportedSectionKeys()` 中
- **THEN** 该覆盖不会向 SystemPrompt 引入新 section

### Requirement: Section 内容通过固定的 template-variable registry 渲染

Template 与默认 section 内容 MAY 包含形如 `{{name}}` 的 `{{variable}}` 占位符，其中 `name` 匹配 `[a-zA-Z_][a-zA-Z0-9_]*`。`TemplateVariableResolver` SHALL 基于来自 build context 的固定变量绑定 registry 解析占位符。第一版 registry SHALL 至少包含：`agentId`、`sessionId`、`modelInfo`、`runtimeInfo`、`environment`、`enabledSkills`、`networkEnvironment`、`isProduction`、`timezone`、`currentDate`、`platform`、`osVersion`。

名称在 registry 中的占位符 SHALL 被替换为其解析值。名称不在 registry 中且未声明为该 fragment 的必需或可选变量的占位符 SHALL 保留字面 `{{name}}` 并被报告为未解析。声明为 fragment 必需但未解析的占位符 SHALL 使该 fragment 的渲染被视为渲染失败并记录到 diagnostics；声明为可选的未解析占位符 SHALL 被替换为空文本。

SHALL NOT 存在只有 `agentDisplayName` / `agentDescription` 两个字段的白名单，使其他任何变量导致 template 校验硬失败；受治理的集合就是上述 registry，未知变量降级为字面透传而不是拒绝整个 template。

#### Scenario: 已注册变量被替换

- **WHEN** 一个 fragment 包含 `{{runtimeInfo}}` 且 registry 能解析它
- **THEN** 该占位符被替换为解析出的 runtime 信息文本

#### Scenario: 未知变量保留字面

- **WHEN** 一个 fragment 包含名称不在 registry 中且未声明为必需或可选的占位符
- **THEN** 该占位符保留字面 `{{name}}`
- **AND** 它在 diagnostics 中被报告为未解析变量

#### Scenario: 缺失的必需变量是 fragment 渲染失败

- **WHEN** 一个 fragment 把某变量声明为必需而 registry 无法解析它
- **THEN** 该 fragment 渲染在 diagnostics 中被记录为失败，并带有 presentation-safe 原因

### Requirement: Prompt template 解析使用 loader 链和分层 profile registry

实现 SHALL 通过两个协作机制解析 template 内容：

1. 一个加载具名 template 内容的 `PromptTemplateLoader` 链。默认链 SHALL 是 file-system loader 加 classpath/resource loader，组合方式为首个返回非空内容的 loader 获胜（chain-of-responsibility）。当没有 loader 返回内容时，解析 SHALL 回退到 builder 的硬编码默认内容。
2. 一个分层的 `PromptTemplateProfile` registry，选择应用哪个 template 和哪些 model-option 覆盖。Profile SHALL 被分类为有序层 `DEFAULT < LANGUAGE < MODEL < AGENT < PURPOSE`。当多个 profile 匹配一个查询时，resolver SHALL 先按层、再按 precedence、再按 profile id 排序它们，并 SHALL 选择最高 precedence profile 的 `templateRef` 作为内容。两个启用的 profile 匹配同一查询的同一层 SHALL 被作为歧义配置错误拒绝。

SHALL NOT 存在固定的五步 `agent prompts/ dir -> promptTemplateIds -> defaultPromptTemplateId -> app config -> built-in` 链作为规范化解析顺序；规范化机制是此处描述的 loader 链加分层的 profile registry。

#### Scenario: 首个有内容的 loader 获胜

- **WHEN** file-system loader 为某个 template 名返回内容
- **THEN** 不会再为该名咨询 resource loader
- **AND** 使用已加载的内容

#### Scenario: 全部 loader 未命中时回退到硬编码默认

- **WHEN** 链中没有 loader 为某个 section 返回内容
- **THEN** builder 为该 section 使用其硬编码默认内容

#### Scenario: 最高 precedence 的 profile 选定 template 内容

- **WHEN** 跨不同层的多个启用 profile 匹配一个查询
- **THEN** resolver 选择最高层、最高 precedence profile 的 `templateRef` 作为内容

#### Scenario: 同层冲突被拒绝

- **WHEN** 两个启用的 profile 匹配一个查询的同一层
- **THEN** resolver 抛出标识冲突 profile id 的歧义解析配置错误

### Requirement: ModelOptions 由分层 profile 覆盖合并而来

`ModelOptions`（temperature、maxTokens、topP、thinking、providerOptions）SHALL 通过按层后按 precedence 的顺序，把每个匹配 profile 的 `ModelOptionsOverride` 应用到基础 `ModelOptions` 上产出，使更高 precedence 的 profile 逐字段覆盖较低者，并合并 `providerOptions` map。`ModelOptions` SHALL NOT 来源于 `PromptTemplate.defaultModelOptions` 字段。

#### Scenario: 覆盖合并到基础 options 之上

- **WHEN** 一个匹配的 profile 携带 `temperature` 非空的 `ModelOptionsOverride`
- **THEN** 解析出的 `ModelOptions.temperature` 是覆盖值，未设置的覆盖字段继承基础值

#### Scenario: 更高 precedence 的 profile 逐字段获胜

- **WHEN** 两个匹配的 profile 都设置了 `maxTokens`
- **THEN** 解析出的 `maxTokens` 是更高 precedence profile 的值
- **AND** 两个 profile 的 `providerOptions` 被合并，更高 precedence 的 key 获胜

### Requirement: Capability 披露把 skills 渲染为文本、把 tools 渲染为 schema

启用的 capability SHALL 从单一来源（build context 上的 `enabledCapabilities` / assembly 上的 `visibleCapabilities`）驱动两个目的地：
- `skills` SystemPrompt section 文本 SHALL 只列出 `SKILL` capability，格式为字符预算内的 markdown 列表项，built-in skills 永不被截断
- `RenderedModelInput.tools[]` 数组 SHALL 只从 `TOOL` capability 派生，每个都是 OpenAI 兼容的 function schema，其 function `name` 等于 capability id

`AGENT` capability SHALL NOT 被渲染进任何一个目的地。两个目的地 SHALL 从同一 capability 集合派生，SHALL NOT 静默分歧。

#### Scenario: Skills 以文本出现，tools 以 schema 出现

- **WHEN** 启用的 capability 集合同时包含 SKILL 和 TOOL capability
- **THEN** `skills` section 以 markdown 列表项列出 SKILL capability
- **AND** `tools[]` 为每个 TOOL capability 包含一个 `name` 等于其 capability id 的 function schema
- **AND** 没有任何 AGENT capability 出现在任一目的地

#### Scenario: 一个 capability 在两次装配之间被移除

- **WHEN** 一个 capability 在两次装配之间从可用变为不可用
- **THEN** 下一个 SystemPrompt 的 `skills` section（对 SKILL）或 `tools[]`（对 TOOL）不再披露它

### Requirement: Token 估算具备 code point 感知

System prompt token 估算 SHALL 使用具备 code point 感知的启发式，而不是扁平的每 token 字符数比例：CJK code point SHALL 比 ASCII 赋予更高权重（参考权重为 CJK ×1.5、增补 code point ×2.0、ASCII 每字符 ×0.25）。估算值 SHALL 记录到 diagnostics 中，SHALL NOT 进入 `RenderedModelInput`。

#### Scenario: 混合脚本内容按 code point 估算

- **WHEN** system prompt 包含 CJK 与 ASCII 混合文本
- **THEN** token 估算对 CJK code point 的权重高于 ASCII 字符
- **AND** 估算值只记录在 diagnostics 中

### Requirement: Cache 边界是 stable 与 dynamic section 之间的文本标记

`SystemPrompt.cacheBoundaryMarker` SHALL 是一个文本标记（默认 `---[CACHE_BOUNDARY]---`），发出在已渲染的 stable section 与已渲染的 dynamic section 之间。Renderer SHALL 逐字写入它；provider adapter 解释它以实现 prefix-cache 复用。SHALL NOT 添加任何结构化的 cache-hint 字段。

#### Scenario: 标记分隔 stable 与 dynamic

- **WHEN** SystemPrompt 被渲染为单个字符串
- **THEN** stable section 文本位于标记之前，dynamic section 文本位于标记之后

### Requirement: Rendered-input 引用位于 ContextAssembly，而不是 SystemPrompt

Message 引用、attachment 引用和当前请求内容 SHALL NOT 作为 SystemPrompt section 出现。Render SHALL 使用既有的 `ContextAssembly` 执行坐标、`selectedMessageRefs` 和 message/attachment 边界解析模型输入。`project_context`、`dynamic_context` 和 `session_context` 这些 dynamic section 携带提供给 builder 的 project/session 文本内容，而不是 message 或 attachment 引用。

#### Scenario: 既有装配坐标携带渲染阶段输入

- **WHEN** 产出 ContextAssembly
- **THEN** 它在顶层包含 `selectedMessageRefs` 和既有的请求执行坐标
- **AND** 当前请求内容用既有请求身份从已受理的 request/session 边界解析
- **AND** attachment descriptor 从已附加到被选中或当前消息的 attachment 引用解析
- **AND** SystemPrompt 不包含这些引用中的任何一个

### Requirement: Diagnostics 保持在面向模型的输入之外

Prompt shaping 与渲染产生的 Diagnostics SHALL 通过既有的 presentation-safe observability、audit、timeline 或等价 diagnostic sink 记录，SHALL NOT 出现在 `RenderedModelInput` 中。本 change SHALL NOT 添加公开的 `ContextAssembly.diagnostics` 字段。实现 MAY 把 diagnostics 建模为结构化对象（template id/version、逐 section 状态、token 估算、fallback 原因），通过 structured logging helper 和 timeline/event subscriber 记录。

#### Scenario: Prompt shaping 记录 fallback 或省略

- **WHEN** loader 链、profile resolver、builder、variable resolver 或 renderer 记录一条 diagnostic
- **THEN** 该 diagnostic 通过既有的 presentation-safe diagnostic sink 发出
- **AND** 不被序列化进 `RenderedModelInput`

#### Scenario: Prompt shaping diagnostics 不写入 audit 事件

- **WHEN** prompt shaping 或渲染记录一条 diagnostic
- **THEN** 该 diagnostic 通过 `agent-observability` structured logging helper 或 timeline/event subscriber 记录
- **AND** 不写入 audit 事件，因为 audit 事件保留给 gateway / capability / hook / checkpoint / terminal commit 的 key-value 事实

### Requirement: RenderedModelInput 是唯一模型可消费输出

Context Engine 的唯一可被 model provider 消费的输出 SHALL 是 `RenderedModelInput`。它 SHALL 是 OpenAI 兼容的 `ChatMessage[]` 加 `tools[]`（附模型名、base URL、credential 引用和已解析的 model options）。它 SHALL NOT 携带 SystemPrompt 内部结构、selection 决策、raw SessionMessage 记录或 assembly diagnostics，也 SHALL NOT 向模型边界暴露指向内部 `ContextAssembly` shaping 状态的反向引用。

#### Scenario: 渲染完成

- **WHEN** Context Engine 完成渲染
- **THEN** RenderedModelInput 是唯一跨越模型边界的对象
- **AND** model provider 不会收到任何 assembly diagnostics 或 SystemPrompt 内部结构
