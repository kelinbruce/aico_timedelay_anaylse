## Function

- 所属 Function：legacy spec（`web-channel-api-contract` 无已确认 Function 映射）
- Function 变更类型：`MODIFIED`
- spec 角色：主规格

## MODIFIED Requirements

### Requirement: Web channel public API MUST have complete request specifications

Web channel public API SHALL maintain a complete request specification for every endpoint exposed to agent-web, including REST, SSE, WebSocket, local auth and health endpoints. The request specification MUST identify HTTP method or WebSocket path, path parameters, query parameters, headers, JSON body, multipart fields and no-body cases. Parameters that are not accepted by the route MUST be rejected by schema validation or documented transport validation before downstream runtime/session/capability ports are called.

所有携带 `agentId` 参数的 Web channel 端点 MUST 接受可选 header `x-agent-id` 作为 hosted-agent selection 信号。该 header 值 MUST NOT 进入请求体，MUST NOT 被视为 owner scope 或 trusted identity。

createSession 和 convenience submit 端点 MUST 从 header `x-agent-id` 提取原始值传给 `RuntimeCreateSessionCommand.agentId`，由 runtime 的 Agent Selection Policy 统一做格式校验和决策。Web channel MUST NOT 在 createSession 路径自行做格式校验或 brand，MUST NOT 自行决定 fallback。

非 session 内端点（cron-tasks、category-questions、frequent-questions、question-associations、annotations/favorite-turns、memory、listSessions）MUST 在 channel 层从 header `x-agent-id` 完成格式校验、brand 和 fallback，直接传解析后的 agentId 给 runtime port。这些端点不走 AgentSelectionPolicy。

session 内端点（如 `POST /api/v1/sessions/:sessionId/requests`、stream、message、cancel）MUST NOT 从 header 解析 agentId，MUST 使用 session 已绑定的 `session.agentId`。

未传 header 时所有端点 MUST fallback 到 `defaultRouteAgentId`，行为与当前版本完全一致。

#### Scenario: REST route request schema coverage

- **WHEN** a public REST route is registered under `/api/v1` or `/health`
- **THEN** the route MUST have an explicit request specification for every accepted path, query, header, body or multipart field
- **AND** unsupported request fields MUST fail closed before runtime/session/capability/gateway ports are called
- **AND** trusted owner scope and trusted agent scope MUST NOT be accepted from request body, query, path or client metadata

#### Scenario: createSession 提取 header 原始值传给 runtime

- **WHEN** 客户端发送 `POST /api/v1/sessions` 且包含 header `x-agent-id: network-specialist`
- **THEN** Web channel MUST 提取该 header 的原始字符串值传给 `RuntimeCreateSessionCommand.agentId`
- **AND** MUST NOT 在 channel 层做格式校验或 brand
- **AND** MUST NOT 将该值放入请求体
- **AND** runtime MUST 通过 AgentSelectionPolicy 统一做格式校验和决策

#### Scenario: 非 session 内端点在 channel 层解析 agentId

- **WHEN** 客户端发送 `GET /api/v1/cron-tasks` 或 `GET /api/v1/frequent-questions` 且包含 header `x-agent-id: network-specialist`
- **THEN** Web channel MUST 在 channel 层完成格式校验、brand 和 fallback
- **AND** MUST 将解析后的 agentId 传递给对应 runtime port
- **AND** 底层 port MUST 按该 agentId 隔离数据

#### Scenario: 未传 header 时 fallback 到默认 agent

- **WHEN** 客户端发送任何携带 agentId 参数的端点且未包含 header `x-agent-id`
- **THEN** Web channel MUST 使用 `defaultRouteAgentId` 作为 agentId
- **AND** 行为 MUST 与当前版本完全一致

#### Scenario: Session-internal endpoints use session-bound agentId

- **WHEN** 客户端对一个已存在的 session 发送请求（如 submit、stream、message）
- **THEN** Web channel MUST 使用 `session.agentId` 作为 agent scope
- **AND** MUST NOT 从 header 解析 agentId 覆盖 session 已绑定的 agentId

#### Scenario: listSessions 按 header 指定的 agentId 过滤

- **WHEN** 客户端发送 `GET /api/v1/sessions` 且包含 header `x-agent-id: network-specialist`
- **THEN** Web channel MUST 按该 agentId 过滤 session 列表

#### Scenario: listSessions 未传 header 时按默认 agent 过滤

- **WHEN** 客户端发送 `GET /api/v1/sessions` 且未包含 header `x-agent-id`
- **THEN** Web channel MUST 使用 `defaultRouteAgentId` 作为 agentId 过滤
- **AND** 行为 MUST 与当前版本完全一致

#### Scenario: Stream route request schema coverage

- **WHEN** Web channel exposes SSE or WebSocket stream for a session
- **THEN** the stream request specification MUST define `sessionId`, optional `lastSeenSequence`, optional `requestId` and optional `runId`
- **AND** unsupported stream query parameters MUST fail with a safe validation error
- **AND** SSE and WebSocket MUST use equivalent request parsing semantics unless a transport-specific requirement explicitly says otherwise

#### Scenario: Multipart request schema coverage

- **WHEN** a submit or edit endpoint accepts `multipart/form-data`
- **THEN** the request specification MUST list every accepted text field and file part
- **AND** unsupported multipart fields MUST fail with a safe validation error
- **AND** multipart intake MUST NOT allow client-provided owner scope, agent scope, accepted request ids, run ids, attachment ids or persistence facts

## Function 变更汇总

### 输入

- **变更类型**：修改
- **目标内容**：所有携带 `agentId` 参数的 Web channel 端点新增可选 header `x-agent-id`。createSession 路径提取原始值传给 runtime；非 session 内端点在 channel 层完成解析。session 内端点不变。
- **依据 Requirements**：`Web channel public API MUST have complete request specifications`

### 规格

- **规格项**：agentId 传递方式
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：createSession 提取原始值传 runtime AgentSelectionPolicy；非 session 端点 channel 层解析；session 内端点用 `session.agentId`；未传时 fallback `defaultRouteAgentId`
- **依据 Requirements**：`Web channel public API MUST have complete request specifications`
