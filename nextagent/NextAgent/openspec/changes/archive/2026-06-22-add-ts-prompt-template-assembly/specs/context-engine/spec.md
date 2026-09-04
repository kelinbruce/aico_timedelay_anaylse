## ADDED Requirements

### Requirement: Context Engine 为 model prompt 消费 prompt template assembly
Context Engine SHALL 为它拥有或编排的每个面向 model 的 prompt 消费 prompt template assembly 边界。主 model 调用的 system prompt SHALL 使用 `PromptPurpose=SYSTEM_PROMPT`。当通过 Context Engine 组合时，可追溯摘要生成 SHALL 使用 `PromptPurpose=SUMMARY_GENERATION`。Context Engine MUST NOT 在 prompt template assembly 之外定义单独的完整模板选择算法。

Prompt template assembly 结果 SHALL 是 Context Engine render 的输入，而不是 Context Engine render 的替代。Context Engine 仍负责组装最终 model 输入 message、role 放置、history 选择输出消费、attachment context 放置、tool-call 协议保持和当前用户输入放置。

#### Scenario: System prompt assembly 委托模板选择
- **WHEN** `ContextEnginePort.assemble()` 为一个请求构建 system prompt
- **THEN** 它 MUST 从 prompt template assembly 获取所选模板标识、渲染后的 prompt 内容和可选的 `modelOptions` 覆盖
- **AND** 它 MUST 继续通过既有 model input render 边界渲染最终的 `RenderedModelInput`
- **AND** prompt template assembly MUST NOT 直接发出完整的 `RenderedModelInput.messages`

#### Scenario: Summary prompt assembly 委托模板选择
- **WHEN** 可追溯摘要生成构造一个摘要 prompt
- **THEN** 它 MUST 通过 prompt template assembly 使用 `PromptPurpose=SUMMARY_GENERATION`
- **AND** 它 MUST 把摘要特定的输出解析、checklist 校验和禁用 tool 的 model 调用保留在 summary generation owner 中

#### Scenario: Render 边界将 prompt 与其他 model 输入组合
- **WHEN** Context Engine 拥有 prompt assembly 结果、所选 history 引用、attachment context 引用、可见 capability 和当前用户输入
- **THEN** Context Engine render MUST 把这些受治理的输入组合成最终 model 调用形状
- **AND** prompt template 渲染 MUST 保持限定在渲染后的 prompt 内容和 purpose 元数据
- **AND** history、tool 和 attachment 内容 MUST 保持在通用 prompt template 渲染之外，遵循各自的受治理放置规则

### Requirement: Context Engine 保持 role 与协议边界
Context Engine 消费的 prompt template assembly SHALL NOT 把先前会话、当前请求、tool-call 协议 message 或 capability result message 扁平化到 system prompt 文本中，除非某个消费 purpose 显式请求安全的文本投影。主会话 history 和当前请求内容 MUST 保持在 `RenderedModelInput.messages` 中并带有适当的 model role。

#### Scenario: History 不被扁平化进 system prompt
- **WHEN** 所选的先前 history 包含 user、assistant 和 tool-result message
- **THEN** Context Engine MUST 通过 `RenderedModelInput.messages` 渲染这些 message
- **AND** prompt template 变量默认 MUST NOT 暴露保留 role 的 history 的原始拼接

#### Scenario: 显式文本投影保持有界
- **WHEN** 一个 purpose 特定的 prompt template 引用一个产生文本投影的已注册变量
- **THEN** 该投影 MUST 由受治理的 resolver 产生
- **AND** 它 MUST 对大内容、credential、路径、attachment 内容和未授权对象保持安全约束
