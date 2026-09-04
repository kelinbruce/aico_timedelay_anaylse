## ADDED Requirements

### Requirement: Structured observability log SHALL be the primary replay surface for agent execution trajectory

`nextagent-observability.log` 对应的 structured logging surface MUST 成为 agent 执行轨迹复盘主视图。它 MUST 覆盖 turn、context assembly、capability selection、sandbox execution 和 user-visible output 对齐的安全轨迹事件，并保持与 request lifecycle、model invocation、capability invocation 和 terminal outcome 的稳定关联。

structured trajectory logs MUST 只输出安全摘要、稳定 refs、低基数 reason code 和 bounded duration/usage fields。它 MUST NOT 输出 raw prompt、raw model output、raw tool args/result、stream delta、free-text reasoning、路径、credential、token 或 tracing SDK 字段。

#### Scenario: Agent trajectory can be replayed from structured observability logs
- **WHEN** 一次 request 经历多轮 model / tool 执行并完成 terminal commit
- **THEN** `nextagent-observability.log` MUST 足以按稳定 refs 重放 turn、context assembly、capability selection、sandbox execution、visible output 和 terminal 的主轨迹
- **AND** 复盘不需要依赖 runtime private debug fields 或 raw content
