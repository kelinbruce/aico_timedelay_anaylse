## MODIFIED Requirements

### Requirement: Tool input 有界且不能选择权限

`rag` Tool input SHALL 包含非空的自然语言 `query`，MAY 包含 provider 中立的 logical `indexes`，MAY 包含有界的结果选项 `topK`。`query` MUST 限制在 256 个字符以内。`indexes` 存在时 MUST 是 1-5 个非空字符串组成的列表，从当前 Agent 可用的知识源中选择 logical index。省略 `indexes` 时，executor SHALL 使用冻结配置中可信 app-composition 默认 RAG logical index；若无此配置，SHALL 回退到 `["local"]`。`topK` 省略时 MUST 默认为 5；存在时 MUST 是限制在 public 范围 1-10 内的整数。Tool input MUST NOT 携带 `tenantId`、`subjectId`、`agentId`、`agentVersion`、deployment mode、provider kind、workspace root、host path、SQLite 路径、raw FTS5 表达式、provider 私有 connection/config、provider 私有 credential、token、provider 私有 index 绑定或 provider 私有检索参数。可信 owner scope、agent scope、knowledge-source scope、默认 logical index 和 provider 选择 MUST 来自可信 app/runtime context。

#### Scenario: 有效 query
- **WHEN** 模型以 `query="UPF timeout handling"`、`indexes=["local"]` 和 `topK=5` 调用 `rag`
- **THEN** 系统 SHALL 使用可信 scope 和可信 provider 选择
- **AND** 最多返回 gateway contract 允许的有界数量的结果。

#### Scenario: 显式 indexes 覆盖已配置的默认值
- **GIVEN** 可信 app-composition 默认 RAG logical index 为 `["local", "remote-netops"]`
- **WHEN** 模型以 `query="UPF timeout handling"` 和 `indexes=["local"]` 调用 `rag`
- **THEN** Tool SHALL 以 `indexes=["local"]` 调用检索 gateway
- **AND** MUST NOT 用已配置的默认值追加或替换模型显式选择的 logical index。

#### Scenario: 省略 indexes 时应用已配置的默认值
- **GIVEN** 可信 app-composition 默认 RAG logical index 为 `["local", "remote-netops"]`
- **WHEN** 模型只以 `query="UPF timeout handling"` 调用 `rag`
- **THEN** Tool input SHALL 被视为 `indexes=["local", "remote-netops"]`
- **AND** `topK` SHALL 被视为 5。

#### Scenario: 检索 gateway 由可信 gateway 选择决定
- **GIVEN** app 启动校验为当前部署产生了一个启用的 `rag-knowledge` gateway selection 条目
- **WHEN** app composition 连接 builtin `rag` Tool 的依赖
- **THEN** Tool SHALL 接收由可信 app composition 选择的 `RagRetrievalGateway`
- **AND** 模型 Tool input MUST NOT 选择 local/remote deployment mode、provider kind、endpoint、credential 或 provider 私有 index 绑定。

#### Scenario: 无已配置默认值时应用本地 fallback 默认值
- **GIVEN** 未配置可信 app-composition 默认 RAG logical index
- **WHEN** 模型只以 `query="UPF timeout handling"` 调用 `rag`
- **THEN** Tool input SHALL 被视为 `indexes=["local"]`。

#### Scenario: 输入试图覆盖权限
- **WHEN** 模型调用 `rag` 时请求体包含 `providerKind`、`deploymentMode`、绝对路径、provider 私有 connection/config、provider 私有 credential、raw FTS5 表达式或 provider 私有 index 参数
- **THEN** 输入校验 MUST 按 Tool schema 策略失败或忽略不支持的字段
- **AND** 系统 MUST NOT 使用所提供的 provider、路径、provider 私有 connection/config、provider 私有 credential、index 参数或 query 表达式。

#### Scenario: Index 输入有界
- **WHEN** 模型以空 `indexes` 列表、非字符串 index 项、空白 index 或超长 index 名称调用 `rag`
- **THEN** 输入校验 MUST 失败
- **AND** 系统 MUST NOT 把无效值转换成 provider 私有 index 绑定。

### Requirement: 失败与降级是显式的

RAG Tool SHALL 针对 provider 不可用、index 未 ready、scope 不匹配、timeout、cancellation、执行失败或无效 provider 结果返回显式的 degraded、unavailable、failed 或 canceled 状态。该 Tool MUST NOT 在这些条件下报告一次空的成功检索。

#### Scenario: 默认 logical index 无法使用
- **GIVEN** 模型省略 `indexes`
- **AND** 检索使用可信默认 logical index
- **WHEN** 检索 provider 报告某个默认 logical index 不存在、未 ready 或无法查询
- **THEN** Tool 结果 SHALL 是显式的 `NO_INDEX`、`UNAVAILABLE`、`DEGRADED`、`FAILED`、`TIMEOUT` 或 `CANCELED`
- **AND** 诊断 SHALL 包含安全的低基数 reason，例如 `INDEX_NOT_FOUND`、`INDEX_NOT_READY`、`PROVIDER_UNAVAILABLE` 或 `TIMEOUT`
- **AND** 系统 MUST NOT 报告空的成功检索、凭空发明另一个 index 或暴露 provider 私有 index 绑定。

#### Scenario: Index 未 ready
- **GIVEN** 组合出的检索 provider 报告所选 logical index 未 ready
- **WHEN** 模型调用 `rag`
- **THEN** Tool 结果 SHALL 是 `NO_INDEX`、`UNAVAILABLE` 或 `DEGRADED`
- **AND** 诊断 SHALL 包含安全的低基数 reason。

#### Scenario: Timeout 或 cancellation
- **GIVEN** 检索超时或调用被取消
- **WHEN** `rag` 处理结果
- **THEN** Tool 结果 SHALL 是显式的 timeout/canceled/degraded safe 输出
- **AND** MUST NOT 返回部分 provider 私有诊断或空的成功结果。
