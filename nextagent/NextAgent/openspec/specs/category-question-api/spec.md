# category-question-api Specification

## Purpose
定义分类问题查询 Web API 的行为契约：端点、请求参数、响应 DTO、scope 校验和安全边界。

## Requirements

### Requirement: 分类问题查询 API 端点

系统 SHALL 通过 Web channel 暴露只读 `GET /api/v1/category-questions` 端点，用于查询当前 Agent Scope 下的分类问题目录。端点 MUST 接受可选的 `locale` 查询参数（字符串，BCP 47 格式，如 `zh-CN`）。端点 MUST 返回包含 `locale` 和 `categories` 数组的 JSON 响应。端点 MUST NOT 接受 request body。端点 MUST NOT 修改任何持久化状态或 runtime lifecycle。

#### Scenario: 使用默认 locale 查询
- **WHEN** 客户端发送 `GET /api/v1/category-questions` 不带 locale 参数
- **THEN** 系统 MUST 使用默认 locale `zh-CN` 进行查询

#### Scenario: 指定 locale 查询
- **WHEN** 客户端发送 `GET /api/v1/category-questions?locale=en-US`
- **THEN** 系统 MUST 使用 `en-US` 进行 locale 规范化后查询

#### Scenario: 无分类问题数据
- **WHEN** 当前 Agent Scope 下没有分类问题数据
- **THEN** 系统 MUST 返回 HTTP 200 和 `{ locale: "zh", categories: [] }` 的有效响应

### Requirement: 分类问题查询响应 DTO

响应 SHALL 使用固定 DTO shape，包含 `locale`（字符串，normalize 后的 language part）和 `categories`（数组）。每个一级分类对象 SHALL 包含 `name`（非空字符串）、`hasSubCategories`（布尔值）和 `questions`（数组，当 `hasSubCategories` 为 `false` 时有值）或 `subCategories`（数组，当 `hasSubCategories` 为 `true` 时有值）。每个二级分类对象 SHALL 包含 `name`（非空字符串）和 `questions`（数组）。每个问题条目 SHALL 包含 `text`（非空字符串）和 `fixed`（布尔值）。响应 MUST NOT 包含 `hash`、`id`、文件路径、provider 配置或内部 catalog metadata。

#### Scenario: 响应包含一级分类直接问题
- **WHEN** 查询返回一个 `hasSubCategories=false` 的一级分类
- **THEN** 该分类对象 MUST 包含 `name`、`hasSubCategories: false`、`questions` 数组
- **AND** `questions` 数组中每个条目 MUST 包含 `text` 和 `fixed`
- **AND** MUST NOT 包含 `subCategories` 字段

#### Scenario: 响应包含一级分类带二级分类
- **WHEN** 查询返回一个 `hasSubCategories=true` 的一级分类
- **THEN** 该分类对象 MUST 包含 `name`、`hasSubCategories: true`、`subCategories` 数组
- **AND** `subCategories` 数组中每个二级分类 MUST 包含 `name` 和 `questions`
- **AND** MUST NOT 包含 `questions` 字段

#### Scenario: 响应不暴露 hash
- **WHEN** API 返回分类问题列表
- **THEN** 响应 DTO MUST NOT 包含 hash 字段或任何内部标识符

### Requirement: 分类问题查询的 Scope 校验

查询 MUST 通过 trusted Web channel identity resolver 解析 owner scope（`tenantId`、`subjectId`），MUST NOT 从查询参数、request header 或 request body 接受 identity 或 agent override。查询 MUST 使用当前 trusted Agent Scope（由 hosted agent configuration 的 `activeAgentId` 决定）。API MUST 对 unauthenticated 请求返回 401 safe error。查询结果 MUST 仅包含当前 Agent Scope 下的分类问题数据。

#### Scenario: 通过 identity resolver 校验
- **WHEN** 客户端发送 `GET /api/v1/category-questions`
- **THEN** 系统 MUST 通过 identity resolver 解析 `tenantId` 和 `subjectId`
- **AND** MUST 使用 `activeAgentId` 作为 Agent Scope
- **AND** MUST NOT 从查询参数获取 `agentId`

#### Scenario: 未认证请求被拒绝
- **WHEN** 未认证的客户端发送 `GET /api/v1/category-questions`
- **THEN** 系统 MUST 返回 401 状态码和 safe error
- **AND** 错误响应 MUST NOT 暴露任何内部信息

### Requirement: Web channel 通过 CategoryQuestionPort 查询

Web channel MUST 通过 `agent-contracts/runtime` 定义的 `CategoryQuestionPort` 查询分类问题，MUST NOT 直接依赖 `agent-capability` 内部实现或 `CategoryQuestionResourceDiscovery`。`CategoryQuestionPort` MUST 由 `agent-app` composition 实现并注入。Port 实现 MUST 接收 `AbortSignal` 以支持取消。Web channel MUST 将 port 返回的 `CategoryQuestionResult` 投影为 HTTP 响应 DTO，MUST NOT 将 port 内部类型直接暴露给 HTTP 客户端。

#### Scenario: Web channel 使用注入的 port
- **WHEN** Web channel 收到 `GET /api/v1/category-questions` 请求
- **THEN** Web channel MUST 调用注入的 `CategoryQuestionPort.listCategoryQuestions()` 方法
- **AND** MUST NOT 直接访问 `CategoryQuestionResourceDiscovery` 或内存 Catalog

#### Scenario: Port 查询支持取消
- **WHEN** 客户端在查询过程中断开连接
- **THEN** `CategoryQuestionPort.listCategoryQuestions()` 接收的 `AbortSignal` MUST 被 abort
- **AND** 查询 MUST 安全终止

### Requirement: 分类问题查询安全与可观测

端点访问 MUST 通过 structured logging 记录，日志 MUST 仅包含 low-cardinality 字段（如 HTTP method、route、status family、agentId、locale）。日志 MUST NOT 包含问题文本、分类名称、JSONL 原始内容或高基数字段。当 port 查询失败时系统 MUST 返回 503 safe error，MUST NOT 暴露 raw error、stack trace 或文件路径。

#### Scenario: 正常访问被安全记录
- **WHEN** 已认证用户成功查询分类问题
- **THEN** 系统 MUST 记录 structured log entry
- **AND** 日志 MUST 仅包含 low-cardinality 字段
- **AND** 日志 MUST NOT 包含问题文本或分类名称

#### Scenario: 查询失败时 fail closed
- **WHEN** port 查询抛出异常
- **THEN** 系统 MUST 返回 503 状态码和 safe error
- **AND** 错误消息 MUST NOT 包含 raw error、stack trace 或文件路径
