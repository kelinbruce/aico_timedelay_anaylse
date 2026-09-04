## ADDED Requirements

### Requirement: Context Engine 把装配与渲染分离

Context Engine SHALL 把权威 context 决策装配进 `ContextAssembly`，并 SHALL 把该装配渲染为 `RenderedModelInput`。`ContextAssembly` SHALL 在顶层携带决策和既有执行坐标；`RenderedModelInput` SHALL 携带模型可消费的内容。

#### Scenario: Context 装配完成
- **WHEN** Context Engine 完成装配
- **THEN** 结果在顶层包含：
  - 带有受治理 `stableSections` 和 `dynamicSections` 的 `systemPrompt`
  - 不可变 message 引用的 `selectedMessageRefs`
  - 标识已受理请求的既有请求执行坐标
  - 模型可用的 capability descriptor 组成的 `visibleCapabilities`
  - 从已受理 Agent 配置派生的 `modelInfo` 和 `modelOptions`
- **AND** 不包含已渲染的对话消息、tool schema 或其他模型可消费内容

#### Scenario: 渲染模型输入
- **WHEN** Context Engine 渲染一个 `ContextAssembly`
- **THEN** 被选中的 message 引用和由装配执行坐标标识的当前请求被解析为 provider-neutral 模型输入
- **AND** attachment descriptor 只从已附加到被选中或当前消息的 attachment 引用解析
- **AND** `visibleCapabilities` 被投影为 tool schema 数组
- **AND** 输出是 OpenAI 兼容的 `ChatMessage[]` 加 `tools[]`

### Requirement: Context Engine 解析已受理的 Agent 配置

Prompt shaping SHALL 使用为已受理请求固定的 agent assembly。它 SHALL NOT 在装配或渲染期间静默重选更新的或默认的 Agent 配置。

#### Scenario: Agent 配置在受理之后变更
- **WHEN** prompt shaping 为一个已受理请求运行
- **THEN** 它使用请求绑定的 agent 身份和版本

### Requirement: ContextAssembly 显式暴露装配决策

`ContextAssembly` 的顶层字段 SHALL 包含 `render` 所需的每个装配决策和执行坐标。其 shape SHALL 足够稳定，使 `render(ContextAssembly)` 无需原始请求对象即可自包含。

#### Scenario: Render 不需要原始 ContextAssemblyRequest
- **WHEN** 调用 `render(assembly)`
- **THEN** 仅 assembly 就足以产出 `RenderedModelInput`
- **AND** render 不需要查找原始 `ContextAssemblyRequest`
- **AND** 任何 message 或 attachment 查找都只由 `ContextAssembly` 中已有的 ref 和执行坐标驱动

### Requirement: Context Engine 编排 prompt shaping

当 prompt shaping 在范围内时，Context Engine 的 `assemble()` SHALL 编排以下序列：
1. 解析已受理的 Agent 配置和 prompt 模式
2. 通过分层的 `PromptTemplateProfile` registry 和 `PromptTemplateLoader` 链解析适用的 prompt template profile 和 template 内容，产出 section 内容覆盖和合并后的 `ModelOptions`
3. 委托 `SystemPromptBuilder` 从其固定的 section 分类构建 `SystemPrompt`，应用内容覆盖并通过 `TemplateVariableResolver` 解析 `{{variable}}` 占位符
4. 在保留既有请求执行坐标的同时，从上游决策填充 `selectedMessageRefs` 和 `visibleCapabilities`
5. 从已受理模型配置填充 `modelInfo`，从合并后的 profile 覆盖填充 `modelOptions`

Context Engine 自身 SHALL NOT 实现 template 加载、section 文本组合、变量替换、role 映射或 tool schema 生成。这些职责属于 `PromptTemplateLoader` 链、分层 profile resolver、`SystemPromptBuilder` / `TemplateVariableResolver` 和 `ModelInputRenderer`。

#### Scenario: Context Engine 委托 shaping
- **WHEN** 调用 assemble
- **THEN** 编排器调用 profile resolver、loader 链、system prompt builder 和 renderer
- **AND** 编排器类不包含 template 加载、section 文本组合、变量替换或 role 映射逻辑

### Requirement: Render 解析被选中的 message refs 而不静默省略

渲染时，Context Engine SHALL 批量读取由 `ContextAssembly.selectedMessageRefs` 标识的消息（单次批量读取而不是逐 ref 的 N+1 查找）。如果某个被引用的消息在渲染时缺失或不再对模型可见，render SHALL 触发显式失败或显式降级并记录 diagnostic；它 SHALL NOT 静默跳过该消息并继续。本 change 只约束 render 阶段对 `selectedMessageRefs` 的消费；它们的生产仍由历史选择拥有。

本需求的早期草稿还要求 render 对 `selectedMessageRefs` 携带的 `activeContextVersion` 锚点校验每个 ref。该子需求已与历史选择 capability owner 协调后移除，因为对当前架构而言它属于过度设计（append-only `SessionMessage` + same-session lane 调度已排除了该锚点所防御的竞态）。Render 仍不得静默跳过缺失或不可见的 ref；该保护在不使用逐 ref version 锚点的情况下达成。

#### Scenario: 被选中的消息在渲染时缺失或不可见

- **WHEN** render 解析 `selectedMessageRefs` 且某个被引用的消息缺失或不再对模型可见
- **THEN** render 不静默丢弃该消息
- **AND** render 触发显式失败或显式降级并记录 presentation-safe diagnostic

#### Scenario: 被选中的 message refs 以单批读取

- **WHEN** render 解析 `selectedMessageRefs`
- **THEN** 这些消息以按 ref 键控的单次批量读取获得
- **AND** 每个缺失或不可见的读取都按上述 scenario 显式暴露，而不是被静默丢弃

### Requirement: Render 映射消息 role 并配对 tool call 与结果

`ModelInputRenderer` SHALL 把 session message role 映射为 `RenderedMessage` role：USER 映射为 user，ASSISTANT 映射为 assistant（metadata 中存在 tool calls 时携带它们），CAPABILITY_RESULT 映射为 tool（存在时携带起源 tool call id）。压缩 summary 消息 SHALL 渲染为普通历史消息，而不是 system authority。Renderer SHALL 按 tool call id 把每个 assistant tool call 与对应的 capability-result 消息配对，并 SHALL 避免发出重复或孤立的 tool-result 消息。System prompt SHALL 渲染为首条 system 消息，并在稳定与动态 section 文本之间发出 cache 边界标记。

#### Scenario: Tool call 与其结果配对

- **WHEN** 一条 assistant 消息携带 tool calls 且存在匹配的 capability-result 消息
- **THEN** 每个 tool-result 都以其 tool call id 为键紧跟该 assistant 消息之后渲染
- **AND** 已渲染过的 capability-result 不被再次发出

#### Scenario: Summary 消息渲染为历史

- **WHEN** 一条被选中的消息是压缩 summary
- **THEN** 它被渲染为普通历史消息，而不是 system-authority section

### Requirement: Prompt-shaping diagnostics 不进入模型输入

Context Engine SHALL 把 prompt-shaping diagnostics 保持在面向模型的输入契约之外，并 SHALL NOT 向公开的 `ContextAssembly` 添加 diagnostics。

#### Scenario: Prompt shaping 记录 fallback 或省略
- **WHEN** prompt shaping 发出 diagnostics
- **THEN** diagnostics 通过既有的 presentation-safe observability、audit、timeline 或等价 diagnostic sink 记录
- **AND** 不被注入 `RenderedModelInput`

#### Scenario: Prompt shaping diagnostics 不写入 audit 事件
- **WHEN** prompt shaping 发出 diagnostics
- **THEN** diagnostics 通过 `agent-observability` structured logging helper 或 timeline/event subscriber 记录
- **AND** 不写入 audit 事件，因为 audit 事件保留给 gateway / capability / hook / checkpoint / terminal commit 的 key-value 事实
