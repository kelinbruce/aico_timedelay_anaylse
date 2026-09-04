## MODIFIED Requirements

### Requirement: 最小 Capability Tool 集合
最小内核 SHALL 使用统一 capability catalog/invocation 边界处理模型 tool calls。当前产品 assembly SHALL 默认启用内置 `read` 和 `bash` 工具。两者 SHALL 作为 capability descriptor 进入 context/model tool metadata，并通过 `CapabilityInvocationPort` 调用。`CapabilityInvocationRequest` SHALL contain only `invocationId`、`capabilityId`、`toolCallId?`、`arguments`、`sessionId`、`requestId`、`runId`、`requestContextId`、`stepId`、`identityContext`、`agentId`、`agentVersion`、`timeoutMs` and `idempotencyKey?`; it SHALL NOT contain `workspaceDir` or `recoveryReplay`. 未启用或不可解析的 capability/tool call SHALL NOT 绕过 capability boundary，MUST 以 unavailable safe outcome 处理。

Tool-loop runtime log entries SHALL include a `toolInput` field. The `toolArgumentLogFields` function SHALL accept a `rawToolInput` boolean parameter. When `rawToolInput` is `false` (default), the `toolInput` field MUST be sanitized via `sanitizeRuntimeToolInput` and MUST NOT expose raw tool arguments, paths, credentials, prompts, or high-cardinality fields. When `rawToolInput` is `true`, the `toolInput` field MAY carry raw tool arguments. The `toolInputPreview` and `toolSafeSummary` fields MUST remain sanitized regardless of the `rawToolInput` value. The `rawToolInputLogging` flag on `ToolLoopDependencies` and `DefaultAgentDependencies` MUST be optional; absent means `false` (sanitized). The composition root MUST wire `rawToolInputLogging: true` only when `observability.logging.redaction` is `debug`.

The `toolInputPreview` field SHALL use tool-specific keyed previews for common diagnostic tools (Read, Grep, Glob, Edit, Write, Agent, Skill). Each preview MUST include sanitized key=value pairs for the tool's most diagnostic arguments. Paths MUST be sanitized via the runtime path sanitizer; query and pattern strings MUST be sanitized via the runtime text excerpt sanitizer. Tools without a specific preview builder MUST fall back to the generic summary preview.

#### Scenario: 默认内置工具被披露并可调用
- **WHEN** 默认 Agent assembly 未显式绑定 capability
- **THEN** Context Engine MUST 把 `read` 和 `bash` 的 schema 披露给模型
- **AND** `read` tool model-visible input schema MUST use canonical argument names: required `file_path`, optional `offset`, optional `limit`
- **AND** `file_path` MUST mean workspace-relative single-file path
- **AND** Agent core MUST 把模型产生的 tool call 映射为 capability invocation
- **AND** assistant tool-use message MUST 先带 tool call metadata 持久化，之后 capability invocation 才能被视为当前 batch state
- **AND** capability lifecycle timeline/SSE projection MUST carry stable `toolCallId`
- **AND** capability invocation result MUST 以 visible `role=CAPABILITY_RESULT` 的 `SessionMessage` 进入同一 request/run
- **AND** 普通 history 默认不返回 capability result message，`includeCapabilityResults=true` 时可返回 visible capability result records
- **AND** 后续 model render MUST 通过 active context view 看到 assistant tool-use message 和 capability result

#### Scenario: default toolInput is sanitized

- **WHEN** tool-loop dependencies do not set `rawToolInputLogging` or set it to `false`
- **THEN** tool-loop runtime log `toolInput` MUST be sanitized via `sanitizeRuntimeToolInput`
- **AND** raw paths, credentials, prompts, and high-cardinality fields MUST NOT appear in `toolInput`

#### Scenario: debug toolInput is raw

- **WHEN** tool-loop dependencies set `rawToolInputLogging` to `true`
- **THEN** tool-loop runtime log `toolInput` MAY carry raw tool arguments
- **AND** `toolInputPreview` and `toolSafeSummary` MUST remain sanitized

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

#### Scenario: tool loop 按工具危险性分级约束每轮 fan-out 并可恢复
- **GIVEN** Agent core SHALL 把 capability 按是否只读分类：read-only capability 集合为 runtime-owned 静态白名单 `{Read, Grep, Glob}`，其余为 side-effecting capability
- **AND** 模型或 capability provider 的任何断言 MUST NOT 改变该只读分类
- **WHEN** 同一模型 round 产生多个 tool calls
- **THEN** Agent core MUST 按 side-effecting count 与 read-only count 分别计上限
- **AND** 每轮 side-effecting tool call 数 MUST NOT 超过 `maxToolCallsPerRound`（默认 5，上限 5）
- **AND** 每轮 read-only tool call 数 MUST NOT 超过 `maxReadOnlyToolCallsPerRound`（默认 20，上限 20）
- **AND** read-only tool call MUST NOT 计入 `maxToolCallsPerRound` 预算，side-effecting tool call MUST NOT 计入 `maxReadOnlyToolCallsPerRound` 预算
- **AND** `executionMode=model-only` 或 `maxToolCalls=0` 时两个上限 MUST 同时为 0，任何 tool call 都 MUST NOT 执行
- **AND** 当 `maxToolCalls=0`（零工具预算）时，发给模型的请求 MUST NOT 携带任何 tool descriptor（`tools` MUST 为空），使模型在请求层即无法生成 tool call；tool loop 的零预算 guard 仅作为防御性兜底
- **AND** 同一 round 内多个 ordinary tool call MAY 受控并行执行，tool result MUST 按模型返回顺序回填
- **AND** 每个 tool call MUST 有独立稳定 `toolCallId`、capability lifecycle events、result message 和 safe error handling
- **AND** 一个 request 最多执行 `maxToolRounds=50`
- **AND** 当 side-effecting count 或 read-only count 超过其上限时该 round 为 over-limit round，MUST NOT 执行该 round 的任何 tool call
- **AND** over-limit round MUST NOT 持久化无对应 tool result 的 assistant tool-use 消息
- **AND** 当 over-limit 且 `maxToolCalls=0`（零预算）时 Agent core MUST 发布 `DEGRADATION_NOTICE`（code `TOOL_CALL_LIMIT_EXCEEDED`）并以 safe `REQUEST_FAILED` 结束，MUST NOT 重试
- **AND** 当 over-limit 且 `maxToolCalls>0`（正预算）时 Agent core MUST 发布 `DEGRADATION_NOTICE`（code `TOOL_CALL_LIMIT_EXCEEDED`）并追加一条 model-visible 纠正消息后重新进入模型 round，MUST NOT 执行任何 tool call
- **AND** 连续 over-limit round 计数 MUST 累加；任意一轮正常执行 tool call 后 MUST 将该计数清零
- **AND** 连续 over-limit round 计数达到 `toolCallLimitRecoveryLimit=3` 时 Agent core MUST 以 safe `REQUEST_FAILED` 结束
- **AND** capability `contextPatch`、动态修改 allowed tools、model name 或 model options MUST NOT 在本 change 生效

#### Scenario: accepted assembly 未显式配置 round limit 时使用统一 fallback
- **WHEN** accepted assembly 未提供 `runtimeSettings.maxToolIterations` 且 `DefaultAgent` 未注入 `deps.maxToolRounds`
- **THEN** tool loop round limit MUST fall back to `50`
- **AND** 该 fallback MUST 与产品默认 builtin agent 的 `maxToolIterations` 保持一致
