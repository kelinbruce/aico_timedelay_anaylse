## ADDED Requirements

### Requirement: RAG Tool 是能力检索入口

系统 SHALL 暴露一个 builtin `rag` Tool，让 model 在已被接受的 request 期间请求从当前 Agent 可用的知识源中进行语义检索。该 Tool MUST 通过统一 capability framework 执行，MUST NOT 拥有 request lifecycle、session lane、context assembly、model 调用、Web transport、知识治理、索引或文档扫描语义。

#### Scenario: Model 在 request 期间调用 RAG
- **GIVEN** 一个 request 已被接受
- **AND** 当前 Agent capability binding 允许 builtin `rag`
- **AND** 可信的 owner scope、agent scope 和 workspace scope 可从可信 runtime/app 上下文获得
- **WHEN** model 调用 `rag`
- **THEN** capability executor SHALL 校验 Tool 输入
- **AND** 调用 RAG 检索 gateway
- **AND** 返回安全的 Tool 结果。

### Requirement: Tool 输入有边界且不能选择权威

`rag` Tool 输入 SHALL 包含非空的自然语言 `query`，MAY 包含 provider 中立的逻辑 `indexes`，并 MAY 包含有边界的结果选项 `topK`。`query` MUST 被限制在 256 个字符以内。`indexes` 存在时 MUST 是一个由 1-5 个非空字符串组成的列表，从当前 Agent 可用的知识源中选择逻辑索引；省略时 MUST 默认为 `["local"]`。`topK` 省略时 MUST 默认为 5；存在时 MUST 是一个被限制在公共范围 1-10 内的整数。Tool 输入 MUST NOT 携带 `tenantId`、`subjectId`、`agentId`、`agentVersion`、部署模式、provider 类型、workspace 根路径、宿主路径、SQLite 路径、原始 FTS5 表达式、provider 私有连接/配置、provider 私有凭证、token、provider 私有索引绑定或 provider 私有检索参数。可信的 owner scope、agent scope、知识源 scope 和 provider 选择 MUST 来自可信的 app/runtime 上下文。

#### Scenario: 有效 query
- **WHEN** model 以 `query="UPF timeout handling"`、`indexes=["local"]` 和 `topK=5` 调用 `rag`
- **THEN** 系统 SHALL 使用可信 scope 和可信 provider 选择
- **AND** 返回至多 gateway contract 允许的有界数量的结果。

#### Scenario: 应用默认值
- **WHEN** model 只以 `query="UPF timeout handling"` 调用 `rag`
- **THEN** Tool 输入 SHALL 被视为 `indexes=["local"]`
- **AND** `topK` SHALL 被视为 5。

#### Scenario: 输入试图覆盖权威
- **WHEN** model 调用 `rag` 时，请求体包含 `providerKind`、`deploymentMode`、绝对路径、provider 私有连接/配置、provider 私有凭证、原始 FTS5 表达式或 provider 私有索引参数
- **THEN** 输入校验 MUST 按 Tool schema policy 失败或忽略不支持的字段
- **AND** 系统 MUST NOT 使用所提供的 provider、路径、provider 私有连接/配置、provider 私有凭证、索引参数或 query 表达式。

#### Scenario: Index 输入有边界
- **WHEN** model 以空的 `indexes` 列表、非字符串的 index 项、空白 index 或过长的 index 名称调用 `rag`
- **THEN** 输入校验 MUST 失败
- **AND** 系统 MUST NOT 将非法值翻译为 provider 私有索引绑定。

### Requirement: RAG Tool 调用组装好的检索 gateway

`rag` executor SHALL 只依赖公共 `RagRetrievalGateway` contract 和 capability 调用上下文。它 MUST NOT 导入本地治理实现、SQLite/FTS5 实现、provider 私有 client、provider 私有 wire DTO 或 workspace 宿主路径。产品组装 SHALL 注入当前 package/composition 形态可用的 gateway provider；Tool 输入 MUST NOT 选择或切换该 provider。

#### Scenario: 使用组装好的 gateway
- **GIVEN** `agent-app` 已组装一个 `RagRetrievalGateway`
- **WHEN** `rag` 执行
- **THEN** executor SHALL 以可信 scope 和有界选项调用组装好的 gateway
- **AND** MUST NOT 探查 gateway 背后是哪个 provider 实现。

#### Scenario: 部署形态不改变 Tool 语义
- **GIVEN** local 模式组装一个本地 SQLite FTS/FTS5 fallback provider
- **AND** remote 模式组装一个由真实 RAG 服务支撑的 provider
- **WHEN** model 调用 `rag`
- **THEN** 两种模式 SHALL 暴露相同的 Tool 输入和输出 contract
- **AND** provider 特有的请求 shape、endpoint、凭证、索引绑定、召回参数或排序协议 SHALL 保持 provider 私有。

#### Scenario: Gateway 不可用
- **GIVEN** 当前组装没有可用的 RAG 检索 gateway
- **WHEN** model 调用 `rag`
- **THEN** Tool 结果 SHALL 是不可用或降级，并带有安全的低基数 reason
- **AND** MUST NOT 报告一个空的成功检索。

### Requirement: 结果 shape 安全且有界

RAG Tool 结果 SHALL 返回有界的 `results` 数组。每个结果项 SHALL 是一个包含 `content`、`source`、可选 `provenance`、可选 `score` 和可选 `rankHint` 的字典：`content` 是返回的知识块文本，`source` 是安全的来源标识符，`provenance` 是安全的 provider 中立来源证据，`score` 是可选的 provider 中立相关性分数，`rankHint` 是可选的 provider 中立排序提示。结果内容 MUST 保持被 `topK` 和 gateway 结果限制约束。Tool 输出 MAY 包含 `diagnostics` 对象，但 diagnostics MUST 只包含如 `reason` 之类的安全低基数字段。结果 MUST NOT 暴露宿主路径、workspace 根路径、SQLite 表名、FTS5 表达式、provider 私有连接/配置、provider 私有凭证、原始 provider 响应、原始 query 诊断或高基数的文件列表。

#### Scenario: 安全结果
- **WHEN** 检索返回知识块
- **THEN** Tool 结果消费者 SHALL 收到带 `content`、`source`、可选 `provenance`、可选 `score` 和可选 `rankHint` 的有界 `results` 项
- **AND** 存储、传输和 provider 私有细节 SHALL 保持隐藏。

#### Scenario: 非法 provider 结果
- **GIVEN** 检索 gateway 返回畸形或超限的结果
- **WHEN** `rag` 将 gateway 结果映射为 Tool 输出
- **THEN** Tool SHALL 返回失败或降级的安全输出
- **AND** MUST NOT 透传不安全的字段。

#### Scenario: Diagnostics 是安全的
- **WHEN** 检索成功、降级或失败
- **THEN** Tool 输出 MAY 包含带低基数 reason code 的 `diagnostics` 对象
- **AND** diagnostics MUST NOT 包含原始 query、返回内容、宿主路径、provider 私有请求/响应、endpoint、凭证或原始 provider 错误。

### Requirement: 失败与降级是显式的

RAG Tool SHALL 针对 provider 不可用、索引未就绪、scope 不匹配、超时、取消、执行失败或非法 provider 结果，返回显式的降级、不可用、失败或取消状态。该 Tool MUST NOT 在这些条件下报告空的成功检索。

#### Scenario: Index 未就绪
- **GIVEN** 组装好的检索 provider 报告所选的逻辑索引未就绪
- **WHEN** model 调用 `rag`
- **THEN** Tool 结果 SHALL 为 `NO_INDEX`、`UNAVAILABLE` 或 `DEGRADED`
- **AND** diagnostics SHALL 包含安全的低基数 reason。

#### Scenario: 超时或取消
- **GIVEN** 检索超时或调用被取消
- **WHEN** `rag` 处理结果
- **THEN** Tool 结果 SHALL 是显式的超时/取消/降级安全输出
- **AND** MUST NOT 返回部分的 provider 私有 diagnostics 或空的成功结果。

### Requirement: 可观测性安全且低基数

RAG 调用的可观测性 SHALL 只包含安全的低基数事实，例如 capability id、invocation id、status、结果数量、duration bucket 和 reason code。日志、metric、trace 和 audit MUST NOT 包含原始 query 文本、结果内容、绝对路径、SQLite 路径、FTS5 表达式、provider 私有连接/配置、provider 私有凭证、prompt 文本、model 输出或原始 provider 错误。

#### Scenario: RAG 调用被安全记录
- **WHEN** 一次 RAG 调用完成
- **THEN** 可观测性 MAY 记录安全的 status、duration bucket、结果数量和 reason code
- **AND** MUST NOT 记录原始 query、返回内容或 provider 私有细节。
