## ADDED Requirements

### Requirement: Request Acceptance Timeout Recovers Canonical Presentation Without Resubmission

TS frontend SHALL 对 submit、带附件 submit、retry 和 edit 的 HTTP acceptance 使用 90 秒的 frontend-private 有界等待。timeout 仅结束浏览器对 HTTP response 的等待，MUST NOT 表示 backend request 失败、取消或 terminal，MUST NOT 自动重发 action，也 MUST NOT 让未经 HTTP 确认的 stream candidate 单独成为当前 action 的结算或 Stop/Cancel 证据。

timeout 后 frontend SHALL 对该 action 最多执行一次既有 session/conversation snapshot recovery。snapshot 提供 canonical activeRun 时，frontend MUST 恢复 owning session 的 accepted control；snapshot 证明无 active run 且 conversation 已 terminal 时，frontend MUST 结束该 session 的 request control；snapshot 失败或无法确认时，frontend MUST 进入非 terminal 的 `confirmation-timeout` presentation，显示安全 notice，并保留既有手工 reload。canonical 状态确认前，同一 session MUST NOT 提交另一个 request action，其他 session MUST NOT 被阻塞。

#### Scenario: HTTP never resolves while stream has delivered terminal

- **GIVEN** action HTTP 在 90 秒内没有返回
- **AND** session stream 已交付未经 HTTP 确认的 candidate detail 或 terminal
- **WHEN** acceptance timeout 到达
- **THEN** frontend MUST 只 abort browser HTTP wait
- **AND** MUST NOT resubmit action 或制造 runtime terminal
- **AND** MUST 对该 action最多执行一次既有 snapshot recovery

#### Scenario: Snapshot recovers an active run

- **GIVEN** acceptance 已 timeout
- **WHEN** snapshot 提供 owning session 的 canonical activeRun
- **THEN** frontend MUST 只恢复该 session 的 accepted control 和 Stop/Cancel target
- **AND** MUST NOT 修改其他 session tracker

#### Scenario: Snapshot cannot confirm request state

- **GIVEN** acceptance 已 timeout
- **WHEN** snapshot 失败或没有 active/terminal truth
- **THEN** frontend MUST 显示 request-confirmation-timeout notice
- **AND** MUST NOT把 candidate 标记为 completed、failed 或 canceled
- **AND** MUST 拒绝同一 session 的新 action，直到 canonical reload 解除 uncertainty

### Requirement: Foreground Request Control Is Session Scoped And Single Flight Per Session

TS frontend SHALL 按 `sessionId` 隔离 foreground request control state。每个 session 的 pending identity、HTTP continuation、active root、terminal settlement、request notice 和 Stop/Cancel target MUST 只读写 owning session tracker。切换 route session 或 hydrate 另一个 session 的 activeRun MUST NOT 覆盖原 session tracker。

同一 session 存在 submitting、accepted、retrying、editing、canceling 或 `confirmation-timeout` action 时，frontend MUST 拒绝新的 submit、retry 或 edit。该 gate MUST 覆盖 send button、Enter、slash command、建议问题和 controller/store direct action；输入 MAY 继续编辑并保存草稿。不同 session MAY 并行执行，其 identity、terminal 和 control target MUST 保持隔离。

#### Scenario: Same-session programmatic send is rejected

- **GIVEN** session A 已有 submitting 或 accepted action
- **WHEN**用户通过任一 UI 或 direct action 入口再次发送
- **THEN** frontend MUST NOT 创建第二个 optimistic Turn
- **AND** MUST NOT发送第二个 request action
- **AND** existing pending identity MUST 保持不变

#### Scenario: Different sessions execute concurrently

- **GIVEN** session A 已有 foreground request
- **WHEN**用户在 session B 提交 request
- **THEN** session B action MAY 被接受
- **AND** session B MUST NOT 覆盖 session A pending identity、terminal settlement 或 Stop target

#### Scenario: Switching sessions preserves owning control

- **GIVEN** session A 和 session B 各有 active request
- **WHEN**页面在 A、B 之间切换并返回
- **THEN**每个页面 MUST 显示自身 tracker 的 status 和 Stop/Cancel target
- **AND**任一 terminal MUST 只结算 owning tracker
