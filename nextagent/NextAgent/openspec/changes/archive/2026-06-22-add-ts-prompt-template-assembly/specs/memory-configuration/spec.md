## ADDED Requirements

### Requirement: Memory 抽取 prompt 消费 prompt template assembly
Memory 抽取 prompt 定制 SHALL 消费 `PromptPurpose=MEMORY_EXTRACTION` 的 prompt template assembly。Agent 级别的 memory 抽取 prompt SHALL 从 Agent package 的 `prompts/` 目录中发现，并为该 purpose 注册为 Agent 作用域的 prompt template 候选。Memory configuration MUST NOT 为抽取 prompt 定义单独的 prompt 文件格式、加载器链、手写 prompt id 允许清单或请求路径解析器。

#### Scenario: Memory 抽取使用 purpose 作用域模板
- **WHEN** memory 抽取需要一个 Agent 的中文抽取 prompt
- **THEN** 它 MUST 以 `PromptPurpose=MEMORY_EXTRACTION` 和可信 Agent scope 解析一个 prompt template assembly 请求
- **AND** 所选 prompt MUST 来自已注册的 prompt template 事实或内置回退

#### Scenario: 缺失自定义抽取 prompt 时回退
- **WHEN** 该 Agent 没有匹配的自定义 memory 抽取 prompt template
- **THEN** memory 抽取 MUST 使用通过 prompt template assembly 选择的内置回退
- **AND** 它 MUST NOT 在请求或抽取执行路径中扫描 Agent package 文件

#### Scenario: 抽取 prompt 错误与观测被脱敏
- **WHEN** 一个 memory 抽取 prompt binding 缺失、被拒绝或回退
- **THEN** safe error 或内部观测在可用时 MAY 包含安全的 purpose、语言和模板标识符
- **AND** 它们 MUST NOT 包含抽取 prompt 文本、raw 模板正文、本地路径、memory 内容、model 输出、credential 或 token
