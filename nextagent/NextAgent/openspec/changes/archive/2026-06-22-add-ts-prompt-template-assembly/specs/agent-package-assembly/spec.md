## ADDED Requirements

### Requirement: Agent package prompt root 在编译前被提供
Agent package assembly SHALL 把 package 作用域的 `prompts/` 视为该 Agent 的可信 prompt root。在同步 Agent assembly 期间，系统 MUST 把该 prompt root 解析为 package-root 包含关系下的绝对路径，并且只把 `agentId`、`agentVersion` 和可信的绝对 `path` 传递给 context-engine 拥有的 `register` 入口。Prompt template 编译和 registry 发布 SHALL 在面向 runtime 的 `AgentAssembly` 可接受请求之前，通过该唯一的 context-engine 入口运行。Agent package assembly MUST NOT 拥有 prompt manifest schema、prompt 语义校验、`PromptTemplate` 物化、`templateRef` 推导、registry 发布或模板选择。面向 runtime 的 `AgentAssembly` MUST 保持最小，并且 MUST NOT 内嵌 prompt 文本、raw package 布局、raw 模板文件、provider 配置、secret、`promptTemplateIds` 或 `runtimeSettings.defaultPromptTemplateId`。

#### Scenario: Prompt 候选在提供服务前被编译
- **WHEN** 一个启用的 Agent package 包含 package 作用域的 `prompts/` 候选
- **THEN** 同步 Agent assembly MUST 解析可信的绝对 prompt root 路径，而不解释 prompt manifest 语义
- **AND** 同步 Agent assembly MUST 为该 Agent prompt root 调用一次 context-engine `register`
- **AND** context-engine `register` MUST 在 `AgentAssembly` 可接受请求之前，校验受支持的 prompt template manifest 并把有效模板注册为该 Agent 可用
- **AND** 该 Agent 的请求接受 MUST NOT 在所需 prompt template 事实被编译完成或产生 fail-closed safe error 之前开始

#### Scenario: Assembly 不包含 prompt 正文
- **WHEN** 同步 Agent assembly 创建面向 runtime 的 `AgentAssembly`
- **THEN** 本 change 中该 assembly MUST NOT 包含 prompt 版本摘要或 prompt binding 摘要
- **AND** 它 MUST NOT 包含 prompt root 路径、raw prompt 文本、raw 模板正文、完整 `PromptTemplate` 对象、raw package 路径、模板文件内容、`promptTemplateIds`、`runtimeSettings.defaultPromptTemplateId` 或推导出的 `templateRef` 列表

### Requirement: 请求路径不重新解析 Agent prompt 输入
请求接受之后，runtime、core、context engine、memory、model、capability 和 recovery 路径 SHALL 消费冻结的 assembly 事实和 prompt template assembly resolver 输出。它们 MUST NOT 重新读取 `agent.yaml` 或 package `prompts/` 来改变一个已接受请求的模板选择。

#### Scenario: 已接受的 run 使用冻结的模板权威
- **WHEN** 一个已接受的请求冻结了 `agentId`、`agentVersion` 和 `agentAssemblyRef`
- **THEN** prompt 选择 MUST 使用这些已接受的 assembly 事实
- **AND** 后续的 package 文件变更 MUST NOT 影响该已接受请求的 prompt 选择
