## MODIFIED Requirements

### Requirement: 最小 Capability Tool 集合
最小内核 SHALL 使用统一 capability catalog/invocation 边界处理模型 tool calls。当前产品 assembly SHALL 默认启用内置 `read` 和 `bash` 工具。两者 SHALL 作为 capability descriptor 进入 context/model tool metadata，并通过 `CapabilityInvocationPort` 调用。`CapabilityInvocationRequest` SHALL contain only `invocationId`、`capabilityId`、`toolCallId?`、`arguments`、`sessionId`、`requestId`、`runId`、`requestContextId`、`stepId`、`identityContext`、`agentId`、`agentVersion`、`timeoutMs` and `idempotencyKey?`; it SHALL NOT contain `workspaceDir` or `recoveryReplay`. 未启用或不可解析的 capability/tool call SHALL NOT 绕过 capability boundary，MUST 以 unavailable safe outcome 处理。

#### Scenario: 默认内置工具被披露并可调用
- **WHEN** 默认 Agent assembly 未显式绑定 capability
- **THEN** Context Engine MUST 把 `read` 和 `bash` 的 schema 披露给模型
- **AND** Agent core MUST 把模型产生的 tool call 映射为 capability invocation
- **AND** assistant tool-use message MUST 先带 tool call metadata 持久化，之后 capability invocation 才能被视为当前 batch state
- **AND** capability lifecycle timeline/SSE projection MUST carry stable `toolCallId`
- **AND** capability invocation result MUST 以 visible `role=CAPABILITY_RESULT` 的 `SessionMessage` 进入同一 request/run
- **AND** 普通 history 默认不返回 capability result message，`includeCapabilityResults=true` 时可返回 visible capability result records
- **AND** 后续 model render MUST 通过 active context view 看到 assistant tool-use message 和 capability result

#### Scenario: 未启用 capability 不进入产品路径
- **GIVEN** 当前产品 assembly 默认启用内置 `read` 和 `bash`
- **WHEN** 模型返回 `write`、Skill tool、remote Agent 或其它未启用 capability/tool call
- **THEN** Agent core MUST NOT execute the tool outside `CapabilityInvocationPort`
- **AND** Runtime/Core MUST publish `DEGRADATION_NOTICE` and end the request with safe `REQUEST_FAILED`
- **AND** logs、stream、history 和 SafeError MUST NOT expose raw tool arguments or host paths

#### Scenario: read 工具遵守 workspace 边界
- **WHEN** read capability 请求读取文件
- **THEN** 工具 MUST 只接受 `file_path` as workspace-relative 单文件路径
- **AND** 绝对路径、路径逃逸、目录读取、glob pattern、权限拒绝、timeout 或 abort MUST 返回 safe capability failure，并导致 request 发布 `DEGRADATION_NOTICE` 后以 `REQUEST_FAILED` 结束
- **AND** 缺失文件或普通 IO failure MAY 作为 safe tool result 交给模型继续生成答复
- **AND** `offset` MUST mean 0-based start line and default to `0`
- **AND** `limit` MUST mean maximum line count and default to `2000`
- **AND** `offset` and `limit` MUST be integers, `offset` MUST be greater than or equal to `0`, and `limit` MUST be between `1` and `2000`; invalid values MUST fail capability input schema validation
- **AND** successful payload MUST 受 line-based `offset`、`limit` 和最大输出大小约束
- **AND** successful payload MUST contain `file_path`、`offset`、`limit`、`content`、`truncated` and optional `nextOffset`
- **AND** successful payload `file_path` MUST be a normalized workspace-relative path and MUST NOT expose host absolute path
- **AND** 超限时 MUST 返回 bounded slice，并显式包含 `truncated=true` 和 `nextOffset`
- **AND** safe failure MUST NOT 泄漏未脱敏宿主路径、credential 或未授权对象内容

#### Scenario: tool loop 受最小上限约束
- **WHEN** 同一模型响应产生多个 tool calls
- **THEN** Agent core MUST 按出现顺序串行执行，不并行执行
- **AND** 每个 tool call MUST 有独立稳定 `toolCallId`、capability lifecycle events、result message 和 safe error handling
- **AND** 一个 request 最多执行 `maxToolRounds=3`
- **AND** 每轮最多执行 `maxToolCallsPerRound=5`
- **AND** 超过上限时 MUST NOT 执行部分集合后继续
- **AND** 系统 MUST 发布 `DEGRADATION_NOTICE` 并以 safe `REQUEST_FAILED` 结束
- **AND** capability `contextPatch`、动态修改 allowed tools、model name 或 model options MUST NOT 在本 change 生效
