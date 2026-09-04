## ADDED Requirements

### Requirement: Retry attempt 次数上限
Runtime MUST 对每个 request 的 retry 次数强制执行固定上限：同一 `requestId` 下最多接受 5 次 retry attempt（原始 attempt 1 加上至多 5 次重试，最高 attempt 为 6）。当 latest request 的当前最高 attempt 已达 6 时，Runtime MUST 在 acceptance 阶段拒绝新的 retry command，且不创建新 attempt。计数 MUST 以 durable `RequestRun.attempt` 为唯一锚点；凡被 accepted 的 retry attempt，无论其终态是 `COMPLETED`、`FAILED`、`CANCELED` 或 `SUPERSEDED`，都计入次数。acceptance 阶段被拒绝的 retry command（幂等重放、stale latest、非 terminal、terminal-pending、超限）MUST NOT 创建 attempt，因此不占次数。上限值是固定常量 5，Runtime MUST NOT 从 client payload、client metadata、model output 或 capability arguments 读取上限或计数。Channel 和 Web 前端 MUST NOT 以本地计数替代 Runtime 的权威限制。

#### Scenario: 第 5 次 retry 被接受
- **WHEN** latest terminal request 的当前最高 attempt 是 `5`，且 retry command 通过既有合法性校验
- **THEN** Runtime MUST 接受该 retry 并创建 attempt `6`
- **AND** 新 attempt MUST 遵循既有 retry lineage、visibility replacement 和排队语义

#### Scenario: 超过 5 次 retry 被拒绝
- **WHEN** latest terminal request 的当前最高 attempt 已达 `6`，Runtime 收到新的 retry command
- **THEN** Runtime MUST 以 category `CONFLICT` 拒绝该 command
- **AND** Runtime MUST 使用稳定错误码 `REQUEST_RETRY_LIMIT_EXCEEDED`
- **AND** Runtime MUST 设置 `retryable=false`
- **AND** Runtime MUST NOT 创建新 attempt、修改 history visibility、隐藏消息、追加 retry timeline event 或触发 scheduler

#### Scenario: 失败的 retry attempt 占次数
- **WHEN** 一个 retry attempt 被 accepted 后以 `FAILED` 终态结束
- **THEN** 该 attempt MUST 计入该 request 的 retry 次数
- **AND** 当当前最高 attempt 因此达到 `6` 时，后续 retry command MUST 以 `REQUEST_RETRY_LIMIT_EXCEEDED` 被拒绝

#### Scenario: 幂等重放不受上限影响
- **WHEN** 一个 retry command 已在超限前被 accepted，client 以相同 `idempotencyKey` 和相同 command semantic 重放该 command
- **THEN** Runtime MUST 返回首次 accepted 的 retry 结果
- **AND** Runtime MUST NOT 因当前 attempt 已达上限而拒绝该幂等重放
- **AND** Runtime MUST NOT 创建新 attempt

#### Scenario: acceptance 拒绝不占次数
- **WHEN** retry command 在 acceptance 阶段被拒绝（包括超限拒绝、stale latest、非 terminal 或 terminal-pending）
- **THEN** Runtime MUST NOT 为该 command 创建 attempt
- **AND** 该 request 的当前最高 attempt MUST 保持不变

#### Scenario: 超限安全错误的 Web 投影
- **WHEN** `POST /api/v1/sessions/:sessionId/retry` 因 attempt 上限被拒绝
- **THEN** Web channel MUST 透传 safe error，包含稳定错误码 `REQUEST_RETRY_LIMIT_EXCEEDED`
- **AND** 该响应 MUST NOT 暴露 raw tenant、subject、storage、SQL、stack trace 或 hidden resource existence
- **AND** agent-web 收到该错误后 MUST 以 message.warning 气泡向用户展示当前系统仅支持最多5次重试的提示

#### Scenario: 超限后 retry 入口的禁用投影
- **WHEN** agent-web 已知当前 latest request 的 attempt 达到上限（实时路径获知 attempt，或收到 `REQUEST_RETRY_LIMIT_EXCEEDED` 错误）
- **THEN** agent-web MUST 禁用当前 latest turn 的 TurnBlock 重试按钮和 Composer 重试按钮
- **AND** 禁用的重试按钮 MUST 呈现禁用视觉态，包括禁用光标 `not-allowed` 和降低透明度
- **AND** 禁用的重试按钮 MUST 在悬浮时通过 Tooltip 展示当前系统仅支持最多5次重试的原因说明
- **AND** `/retry` slash 命令入口无法预先禁用时，MUST 在触发并收到超限错误后展示同一 message.warning 气泡提示
- **AND** 所有 retry 入口 MUST 共享同一权威限制和提示语义，不得形成平行的禁用逻辑
- **AND** agent-web MUST NOT 以禁用状态阻止用户提交新 request 或 edit-resubmit
