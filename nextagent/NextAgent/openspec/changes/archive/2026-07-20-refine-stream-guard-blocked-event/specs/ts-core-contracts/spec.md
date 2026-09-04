## ADDED Requirements

### Requirement: Guard layer output-guard terminal event

`StreamEventType` SHALL 包含 `OUTPUT_GUARD_BLOCKED` 作为 terminal stream event。作为 "channel MUST 使用 `StreamEventType` 投影 canonical timeline 或 runtime status" 的受控例外，guard 层（经 `GuardrailGatewayPort` 对输出内容做 guard 检查时，无论由 guard proxy 代理 run 流还是由 NextAgent 在投影侧触发检查）MAY 在客户端流上注入 terminal `OUTPUT_GUARD_BLOCKED` 事件，其 payload 携带 guard reason 与 guard 服务返回的 `refusalMessage`。

约束（防止例外被滥用）：
- 除 `OUTPUT_GUARD_BLOCKED` 外，其他 stream event 仍 MUST 从 canonical timeline 或 runtime status 派生，MUST NOT 由 guard 层或其他外部服务注入。
- `OUTPUT_GUARD_BLOCKED` MUST 是 terminal 事件，其后 MUST NOT 再出现 `LLM_CONTENT_DELTA` 或 `TOOL_STRUCTURED_DELTA`。
- guard 层仍 MUST 经 `GuardrailGatewayPort`（受治理出口），MUST NOT 绕过 gateway 直连 guard 服务；前端/客户端仍只与 NextAgent 自有端点交互。
- `OUTPUT_GUARD_BLOCKED` 是 guard 层对客户端流的 terminal 信号，不替代 runtime 的 canonical terminal commit 事实；run 的 canonical terminal 状态仍由 runtime 拥有，二者各自独立。

#### Scenario: OUTPUT_GUARD_BLOCKED is a terminal stream event

- **WHEN** contract tests 枚举 `StreamEventType`
- **THEN** `StreamEventType` MUST 包含 `OUTPUT_GUARD_BLOCKED`
- **AND** `OUTPUT_GUARD_BLOCKED` MUST 表达 terminal 语义

#### Scenario: Guard-forward relay may inject OUTPUT_GUARD_BLOCKED

- **WHEN** guard-forward relay 路径上 guard 层检测到输出风控问题
- **THEN** guard 层 MAY 在 relay 的客户端流上注入 terminal `OUTPUT_GUARD_BLOCKED` 事件
- **AND** 其 payload MUST 携带 guard reason 与 guard 服务返回的 `refusalMessage`
- **AND** 该事件之后 MUST NOT 再出现 `LLM_CONTENT_DELTA` 或 `TOOL_STRUCTURED_DELTA`

#### Scenario: Only OUTPUT_GUARD_BLOCKED may be injected by the guard relay

- **WHEN** guard-forward relay 路径向客户端流投影事件
- **THEN** 除 `OUTPUT_GUARD_BLOCKED` 外的其他 stream event MUST 从 canonical timeline 或 runtime status 派生
- **AND** guard 层 MUST NOT 注入其他 stream event 名称

#### Scenario: OUTPUT_GUARD_BLOCKED does not replace runtime terminal facts

- **WHEN** guard-forward relay 注入 `OUTPUT_GUARD_BLOCKED`
- **THEN** run 的 canonical terminal commit 事实仍 MUST 由 runtime 拥有
- **AND** `OUTPUT_GUARD_BLOCKED` MUST NOT 被当作 runtime terminal commit 事实
