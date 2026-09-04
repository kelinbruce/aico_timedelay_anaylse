# runtime-recovery-idempotency-guard Specification

## Purpose
定义 Runtime recovery 在恢复 pending tool/capability 调用时的幂等保护：恢复路径必须先基于 durable facts、capability descriptor replay policy 和 stable replay key 判断是否可以重放，优先复用已持久化结果；无法证明安全时必须 fail closed 并进入 recovery failed terminal path。

## Requirements
### Requirement: Runtime recovery 必须 gate pending tool replay
当 runtime recovery 将 executing run 恢复到 pending Tool 调用边界时，Runtime MUST 在调用 capability 前基于 durable facts 判断该 Tool 是否允许重放。判断事实 MUST 至少包含当前 run 的 checkpoint、assistant tool-use message、capability result messages、timeline/terminal facts、`RequestRun` agent/version，以及 capability catalog 通过 accepted run 的 agent assembly 为 `capabilityId` 解析出的 descriptor `CapabilityReplayPolicy`。`AgentCapabilityBinding` MUST 只承载绑定关系，不得承载 replay policy 等 capability 元数据。Runtime MUST 是 replay eligibility decision 的 owner，但不得直接感知或解释 `capabilityBindings`；core/capability 不得绕过该判断直接调用 recovered pending Tool。

#### Scenario: 没有 persisted result 的 pending tool 在 invocation 前被 guard
- **WHEN** recovery 重建出一个 pending tool call，且没有找到对应 persisted capability result
- **THEN** Runtime MUST 在调用 capability 前执行 replay eligibility decision
- **AND** Runtime MUST NOT 仅凭 process-local state、model output buffer 或 tool-call arguments 直接重放 tool

#### Scenario: Descriptor replay policy 通过 catalog 解析
- **WHEN** Runtime 需要判定 recovered pending tool 是否可 replay
- **THEN** Runtime MUST 使用 accepted run 的 agent assembly 和 `capabilityId` 通过 capability catalog 解析 descriptor
- **AND** decision MUST 使用 descriptor 上的 `CapabilityReplayPolicy`
- **AND** Runtime MUST NOT 从 client payload、model output、binding metadata 或 hidden tool arguments 推断 replay policy

#### Scenario: Guard 不应用于普通首次 tool invocation
- **WHEN** runtime 正常执行当前 run 的首次 tool invocation，且不是 recovery path
- **THEN** Runtime MAY 按正常 capability invocation flow 调用 capability
- **AND** 本 guard MUST NOT 把所有普通 tool 调用都强制当作 replay

### Requirement: Recovery 期间必须复用已持久化 capability result
当 recovery 发现 pending tool call 已经存在匹配的 persisted capability result message 或 durable result fact 时，Runtime MUST 复用该结果，并且 MUST NOT 再次调用 capability。匹配 MUST 基于 trusted agent+owner scope、session/request/run、toolCallId、capabilityId 和 result semantic。复用结果必须进入后续 runtime flow，就像 capability invocation 已经返回一样。

#### Scenario: Existing result 防止重复 tool execution
- **WHEN** recovery 发现 pending tool call 已经有匹配的 persisted capability result
- **THEN** Runtime MUST 复用该 result
- **AND** Runtime MUST NOT 再次调用 capability executor
- **AND** Runtime MUST 继续后续 lifecycle stage 或 terminal path

#### Scenario: After-return checkpoint 缺少 result 时恢复失败
- **WHEN** checkpoint 表示 capability invocation 已返回之后的执行点，但 durable message/result facts 中缺少匹配 result
- **THEN** Runtime MUST 将 facts 视为不一致
- **AND** Runtime MUST 进入 safe recovery failed path
- **AND** Runtime MUST NOT 重新调用 capability 来填补该缺口

### Requirement: 只有具备 stable key 的 IDEMPOTENT capability replay 可以继续
Runtime MAY 只在 capability descriptor 声明 `CapabilityReplayPolicy.IDEMPOTENT` 且 Runtime 能为该 recovered invocation 派生 stable replay key 时重放 pending capability。Stable replay key MUST 基于 trusted run coordinates、toolCallId、capabilityId 和 canonical capability arguments，且 MUST 与正常调用和恢复调用保持一致。非幂等、未知 policy、缺少 descriptor 或缺少 stable key 的 pending tool MUST fail closed。

#### Scenario: 具备 stable key 的 idempotent tool 可以 replay
- **WHEN** descriptor 声明 capability replay policy 为 `IDEMPOTENT`
- **AND** Runtime 能为 recovered tool call 派生 stable replay key
- **THEN** Runtime MAY 使用该 key 调用 capability
- **AND** capability invocation boundary MUST 接收该 replay key 或等价 idempotency context

#### Scenario: Normal 和 recovered tool invocation 使用相同 stable key derivation
- **WHEN** 同一个 tool call 在正常执行和 recovery replay 中被调用
- **THEN** Runtime MUST 使用相同 canonical inputs 派生 stable replay key
- **AND** key derivation MUST NOT 依赖 process-local random value、frontend state 或 wall-clock timestamp

#### Scenario: Non-idempotent 或 unknown tool 安全失败
- **WHEN** descriptor 声明 policy 为 non-idempotent，或 policy unknown
- **THEN** Runtime MUST NOT replay pending tool
- **AND** Runtime MUST handoff 到 unsafe recovery failed path

#### Scenario: 缺少 stable key 时安全失败
- **WHEN** Runtime 无法为 recovered tool call 派生 stable replay key
- **THEN** Runtime MUST NOT replay pending tool
- **AND** Runtime MUST handoff 到 recovery failed path with safe reason code

#### Scenario: Request command key 不能自动作为 capability replay key
- **WHEN** original request 或 retry/cancel command 包含 `idempotencyKey`
- **THEN** Runtime MUST NOT 直接把该 request/control command key 当作 capability replay key
- **AND** capability replay key MUST 独立表达 capability invocation semantic

### Requirement: Unsafe recovery 必须 handoff 到 recovery failed terminal path
当 pending tool replay 不安全时，Runtime MUST handoff 到 recovery failed terminal path，并通过 safe terminal/failure vocabulary 表达结果。Unsafe recovery MUST NOT 静默丢弃 tool call、把 run 标记为 completed、在缺少 idempotency guard 时 retry，或把 raw capability/provider error 暴露给 client。

#### Scenario: Unsafe replay handoff 到 failed terminal outcome
- **WHEN** replay eligibility decision 返回 unsafe
- **THEN** Runtime MUST terminalize 或记录 recovery failed outcome
- **AND** Runtime MUST NOT 调用 capability executor
- **AND** Runtime MUST NOT 把该 run 标记为 successful completion

#### Scenario: Non-idempotent replay 使用 unsafe replay code
- **WHEN** recovered pending tool 对应 non-idempotent capability
- **THEN** safe diagnostic MUST 使用稳定 reason code 表达 unsafe replay
- **AND** diagnostic MUST NOT 暴露 tool arguments 或 provider-private details

#### Scenario: Missing stable key 使用 key-unavailable code
- **WHEN** stable replay key 无法派生
- **THEN** recovery failed diagnostic MUST 使用 stable key-unavailable reason code
- **AND** diagnostic MUST NOT 暴露 canonical arguments 内容

#### Scenario: Missing descriptor 使用 descriptor-unavailable code
- **WHEN** Runtime 无法通过 accepted assembly 解析 capability descriptor
- **THEN** recovery failed diagnostic MUST 使用 descriptor-unavailable reason code
- **AND** Runtime MUST NOT 使用当前默认 catalog 或 fallback capability 猜测执行

#### Scenario: Inconsistent recovery facts 使用 result-inconsistent code
- **WHEN** checkpoint、tool-use message、capability result messages 或 timeline facts 互相矛盾
- **THEN** Runtime MUST 使用 result-inconsistent 或 equivalent stable reason code
- **AND** Runtime MUST NOT replay pending tool

#### Scenario: Recovery diagnostic 必须 redacted
- **WHEN** Runtime emits recovery diagnostic for unsafe replay
- **THEN** diagnostic MAY include safe ids、capabilityId、policy kind、stage 和 reason code
- **AND** diagnostic MUST NOT include raw arguments、capability output、attachment content、prompt、model output、provider error、credential 或 local path

### Requirement: Multi-tool recovery 必须逐个 tool 独立 reconcile
当同一个 recovered assistant tool-use message 包含多个 tool calls 时，Runtime MUST 对每个 tool call 独立 reconcile persisted result、replay eligibility 和 failure outcome。一个 tool 已有 persisted result 不得导致另一个 unsafe pending tool 被跳过校验；一个 unsafe pending tool MUST 使该 run 按 recovery failed path 处理，而不是部分成功提交。

#### Scenario: Completed 和 pending 混合的 tool batch
- **WHEN** recovered tool batch 中一部分 tool call 已有 persisted result，另一部分仍 pending
- **THEN** Runtime MUST 复用已有 results
- **AND** Runtime MUST 对 pending tool calls 分别执行 replay eligibility decision
- **AND** Runtime MUST NOT 重复调用已有 result 的 tool

#### Scenario: 一个 unsafe pending tool 使 run 失败
- **WHEN** batch 中任一 pending tool call 被判定为 unsafe replay
- **THEN** Runtime MUST handoff 整个 run 到 recovery failed path
- **AND** Runtime MUST NOT 把 batch 作为 partially successful model turn 继续提交
