## MODIFIED Requirements

### Requirement: Capability invocation and tool loop use the unified capability boundary

最小内核 SHALL 使用统一 capability catalog/invocation 边界处理模型 tool calls。当前产品 assembly SHALL 默认启用内置 `read` 和 `bash` 工具。两者 SHALL 作为 capability descriptor 进入 context/model tool metadata，并通过 `CapabilityInvocationPort` 调用。`CapabilityInvocationRequest` SHALL contain only `invocationId`、`capabilityId`、`toolCallId?`、`arguments`、`sessionId`、`requestId`、`runId`、`requestContextId`、`stepId`、`identityContext`、`agentId`、`agentVersion`、`timeoutMs` and `idempotencyKey?`; it SHALL NOT contain `workspaceDir` or `recoveryReplay`. 未启用或不可解析的 capability/tool call SHALL NOT 绕过 capability boundary，MUST 以 unavailable safe outcome 处理。

Tool-loop runtime log entries SHALL include a `toolInput` field. The `toolArgumentLogFields` function SHALL accept a `rawToolInput` boolean parameter. When `rawToolInput` is `false` (default), the `toolInput` field MUST be sanitized via `sanitizeRuntimeToolInput` and MUST NOT expose raw tool arguments, paths, credentials, prompts, or high-cardinality fields. When `rawToolInput` is `true`, the `toolInput` field MAY carry raw tool arguments. The `toolInputPreview` and `toolSafeSummary` fields MUST remain sanitized regardless of the `rawToolInput` value. The `rawToolInputLogging` flag on `ToolLoopDependencies` and `DefaultAgentDependencies` MUST be optional; absent means `false` (sanitized). The composition root MUST wire `rawToolInputLogging: true` only when `observability.logging.redaction` is `debug`.

The `toolInputPreview` field SHALL use tool-specific keyed previews for common diagnostic tools (Read, Grep, Glob, Edit, Write, Agent, Skill). Each preview MUST include sanitized key=value pairs for the tool's most diagnostic arguments (e.g. `file_path=package.json limit=1` for Read, `pattern="Severity=critical" path=diagnostics` for Grep). Paths MUST be sanitized via the runtime path sanitizer; query and pattern strings MUST be sanitized via the runtime text excerpt sanitizer. Tools without a specific preview builder MUST fall back to the generic summary preview.

#### Scenario: default toolInput is sanitized

- **WHEN** tool-loop dependencies do not set `rawToolInputLogging` or set it to `false`
- **THEN** tool-loop runtime log `toolInput` MUST be sanitized via `sanitizeRuntimeToolInput`
- **AND** raw paths, credentials, prompts, and high-cardinality fields MUST NOT appear in `toolInput`

#### Scenario: debug toolInput is raw

- **WHEN** tool-loop dependencies set `rawToolInputLogging` to `true`
- **THEN** tool-loop runtime log `toolInput` MAY carry raw tool arguments
- **AND** `toolInputPreview` and `toolSafeSummary` MUST remain sanitized

#### Scenario: unavailable capability produces safe outcome

- **WHEN** 模型返回 `write`、Skill tool、remote Agent 或其它未启用 capability/tool call
- **THEN** core MUST 把它映射为 unavailable capability invocation
- **AND** logs、stream、history 和 SafeError MUST NOT expose raw tool arguments or host paths
