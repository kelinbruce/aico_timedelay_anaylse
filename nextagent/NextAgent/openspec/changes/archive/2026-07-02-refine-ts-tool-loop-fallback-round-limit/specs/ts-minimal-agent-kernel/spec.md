## MODIFIED Requirements

### Requirement: 最小 Capability Tool 集合
`agent-capability` SHALL 提供最小 Tool catalog 与 invocation 行为；`agent-core` SHALL 通过统一 capability boundary 驱动最小 tool loop。首版产品路径只暴露已启用的内置 `read` 和 `bash` capability，其他 capability 不得进入模型可见工具集或执行路径。`agent-core` 不得 hardcode 文件读取、bash 执行或其他 tool 语义，所有 tool 调用 MUST 通过已治理的 `CapabilityCatalog` / `CapabilityInvocationPort`、routing constraints、risk policy、sandbox boundary 和 safe error handling 执行。

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

#### Scenario: tool loop 受最小上限约束
- **WHEN** 同一模型响应产生多个 tool calls
- **THEN** Agent core MUST 按出现顺序串行执行，不并行执行
- **AND** 每个 tool call MUST 有独立稳定 `toolCallId`、capability lifecycle events、result message 和 safe error handling
- **AND** 一个 request 最多执行 `maxToolRounds=50`
- **AND** 每轮最多执行 `maxToolCallsPerRound=5`
- **AND** 超过上限时 MUST NOT 执行部分集合后继续
- **AND** 系统 MUST 发布 `DEGRADATION_NOTICE` 并以 safe `REQUEST_FAILED` 结束
- **AND** capability `contextPatch`、动态修改 allowed tools、model name 或 model options MUST NOT 在本 change 生效

#### Scenario: accepted assembly 未显式配置 round limit 时使用统一 fallback
- **WHEN** accepted assembly 未提供 `runtimeSettings.maxToolIterations` 且 `DefaultAgent` 未注入 `deps.maxToolRounds`
- **THEN** tool loop round limit MUST fall back to `50`
- **AND** 该 fallback MUST 与产品默认 builtin agent 的 `maxToolIterations` 保持一致
- **AND** 达到该上限时 MUST 发布 `DEGRADATION_NOTICE` with `TOOL_ROUND_LIMIT_EXCEEDED` 并以 safe `REQUEST_FAILED` 结束
