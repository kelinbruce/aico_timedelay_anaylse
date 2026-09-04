## ADDED Requirements

### Requirement: Stream Cursor And Run Coverage Require Consumer Acceptance

TS frontend SHALL 把 session resume cursor 与 exact-run coverage 作为两个不同事实管理。session cursor 仅表示当前页面中该 envelope 的 owning frontend consumer 已接纳到的最高 timeline-backed sequence；当前 request/run 的 conversation envelope 必须由 conversation store 接纳，background-task envelope 必须由既有 background-task consumer 接纳。exact-run coverage SHALL 使用 `requestId + runId` 标识。其他 run 的有效 envelope可以推进 session cursor并建立其自身 coverage，但 transport open、frame arrival、仅通过 schema validation 或其他 run 的 coverage MUST NOT 证明目标 run 已被 conversation consumer 接纳。

Timeline-backed envelope MUST 在 identity binding、attempt isolation 和 conversation store acceptance 成功后才能推进 session cursor 和对应 exact-run coverage。被 invalid schema、wrong session、stale attempt 或 identity mismatch 拒绝的 envelope MUST NOT 推进 cursor，也 MUST NOT 阻止目标 `activeRun` 使用既有 run-scoped replay 规则恢复。

Connected live-tail 对当前页面新 accepted run 的覆盖判断继续遵守既有 accepted request recovery 规则；本 requirement 不新增第二条 replay 路径。SSE 与 WebSocket MUST 使用相同的 consumer acceptance、cursor 和 exact-run coverage 语义。

#### Scenario: Unrelated session event does not suppress activeRun replay

- **GIVEN** 当前页面已接纳其他 run 或 background activity 的 timeline-backed envelope，并形成 session cursor
- **AND** conversation bootstrap 随后返回一个尚未被当前页面接纳、也未观察到 terminal 的 `activeRun`
- **WHEN** frontend 决定是否执行 activeRun bootstrap
- **THEN** 现有 session cursor MUST NOT 被当作该 `requestId + runId` 已覆盖的证明
- **AND** frontend MUST 按既有规则使用该 activeRun 的 `requestId`、`runId` 和 `lastSeenSequence=0` 执行 run-scoped replay

#### Scenario: Accepted matching event establishes exact-run coverage

- **GIVEN** 当前页面已打开 session stream
- **WHEN** conversation consumer 成功接纳目标 `requestId + runId` 的 timeline-backed envelope
- **THEN** frontend SHALL 记录该 exact run 已被当前页面覆盖
- **AND** 同一 activeRun identity 后续出现时 MUST NOT 仅因 bootstrap state 更新而启动重复 run-scoped replay

#### Scenario: Pre-HTTP exact-run coverage remains valid only when projection survives binding

- **GIVEN** conversation consumer 已在 HTTP response 前接纳某个 exact request/run 的普通 event 或 terminal
- **AND** frontend 已记录该 exact run 的 coverage
- **WHEN** HTTP response 随后把 local optimistic Turn 绑定到相同 request/run
- **THEN** 已接纳的 active/settled bucket MUST 在 binding 后继续存在于同一 Turn
- **AND** 如果 binding 无法保留该 bucket，coverage MUST NOT 阻止该 exact run 使用现有 bounded recovery

#### Scenario: Rejected event cannot advance resume state

- **GIVEN** stream transport 收到 timeline-backed envelope
- **WHEN** 该 envelope 因 invalid schema、wrong session、stale attempt 或无法完成 current pending identity binding 而未被其 owning frontend consumer 接纳
- **THEN** frontend MUST 保持当前 session cursor 不变
- **AND** frontend MUST NOT 把该 envelope 的 `requestId + runId` 标记为已覆盖
- **AND** 后续 matching activeRun recovery MUST 仍可执行

#### Scenario: Batched live envelopes advance after store commit

- **GIVEN** 多条可批处理 live envelope 在同一 animation frame 内到达
- **WHEN** conversation store 接纳该 batch
- **THEN** session cursor SHALL 推进到该 batch 中已接纳的最高 timeline sequence
- **AND** cursor MUST NOT 在 batch 尚未提交到 conversation consumer 前提前推进
- **AND** frame batching MUST NOT 改变 envelope 的顺序、attempt isolation 或 terminal handling
