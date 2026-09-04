## ADDED Requirements

### Requirement: 公开 Web lifecycle 命令需要稳定的幂等 key
创建、推进、重试、编辑或取消 request lifecycle 的公开 Web 命令 MUST 在 public command DTO 中携带非空的 `idempotencyKey`。这包括 session 范围的 submit、convenience submit、retry latest、edit 和 cancel。产品前端 MUST 在用户动作开始时生成一个稳定的 key，并 MUST 在同一动作的网络重试中复用该 key。Auth 身份、session id、request id、run id、stream cursor、客户端 metadata、model 输出、capability 输入/结果、localStorage 或 timestamp MUST NOT 被用作命令幂等 key 的替代。

#### Scenario: 前端对同一用户动作复用同一 key
- **WHEN** 用户启动一个 submit、retry、edit 或 cancel 动作
- **THEN** 前端 MUST 为该动作生成一个稳定的 `idempotencyKey`
- **AND** 同一动作的重复网络尝试 MUST 复用同一 key
- **AND** 新的用户动作 MUST 使用新的 key

#### Scenario: 无 key 的公开命令在副作用之前失败
- **WHEN** 某个公开 Web submit、convenience submit、retry、edit 或 cancel 命令省略 `idempotencyKey`、提供空 key 或提供非字符串 key
- **THEN** Web channel 或 Runtime 校验 MUST 安全失败
- **AND** 该命令 MUST NOT 创建 RequestRun、入队工作、提交 terminal 状态、追加 timeline、修改历史或更新 active context

### Requirement: Channel 校验并转发 canonical 命令 key
`agent-channel-web` MUST 校验 public lifecycle command DTO，normalize 公开动作别名，brand/canonicalize `idempotencyKey`，并把它转发到 Runtime 命令边界。Channel MUST NOT 为公开 submit、convenience submit、retry、edit 或 cancel 命令生成随机 fallback key。

#### Scenario: Channel 把 key 转发给 Runtime
- **WHEN** Web channel 收到一个带 `idempotencyKey` 的有效 public lifecycle command DTO
- **THEN** Channel MUST 把该 key 传递给对应的 Runtime 命令字段
- **AND** Channel MUST 继续只从 auth/channel 边界推导可信身份
- **AND** Channel MUST NOT 使用客户端 owner 字段、metadata、model 输出、capability 结果、timestamp、session id、request id 或 run id 替换该 key

#### Scenario: Cancel 动作别名不改变幂等语义
- **WHEN** 公开 cancel 收到 `CANCEL_LATEST` 或 `CANCEL`
- **THEN** Channel MUST 把 Runtime 动作 normalize 为 canonical 的 `CANCEL`
- **AND** 相同的 `idempotencyKey` 和相同的预期最新请求 MUST 表示相同的 cancel 命令语义
- **AND** Runtime 命令边界 MUST NOT 收到作为 canonical Runtime 动作的 `CANCEL_LATEST`

### Requirement: Channel 内部 session 创建 key 是受控例外
Channel MUST 为 channel 拥有的内部空 session 创建生成服务端幂等 key。Convenience submit 的子 session 创建 MUST 从 submit DTO 的 `idempotencyKey` 派生其服务端 session-create key；RequestRun acceptance 仍 MUST 使用 submit DTO 的 `idempotencyKey`。

#### Scenario: 空 session 创建使用服务端 key
- **WHEN** Web channel 把 `POST /api/v1/sessions` 作为空 session 创建处理
- **THEN** Channel MUST 为该 session create 命令生成一个服务端幂等 key
- **AND** public DTO MUST NOT 接受 owner 字段、agent 字段、request 字段、stream 字段、title、metadata 或客户端提供的 session 幂等 key

#### Scenario: Convenience submit 派生子 session key
- **WHEN** Web channel 在没有既有 `sessionId` 的情况下处理 convenience submit
- **THEN** 子 session create key MUST 从 submit DTO 的 `idempotencyKey` 派生
- **AND** RequestRun submit 命令 MUST 使用原始 submit DTO 的 `idempotencyKey`
- **AND** 以相同命令语义和相同 key 重复的 convenience submit MUST NOT 创建额外的空 session

### Requirement: Runtime 不推断命令幂等 key
Runtime MUST 消费由命令边界提供的 canonical `idempotencyKey`，并 MUST NOT 从客户端 metadata、model 输出、capability 输入/结果、stream 事件、timeline payload、gateway row、session id、request id、run id 或 timestamp 推断、生成或恢复它。

#### Scenario: 缺失的 key 不进入 lifecycle 副作用
- **WHEN** 某 Runtime 命令在没有非空 canonical `idempotencyKey` 的情况下到达边界
- **THEN** Runtime MUST 返回安全的校验失败
- **AND** Runtime MUST NOT 创建或修改 RequestRun、queue、terminal commit、timeline、历史、checkpoint、memory 或 active context 事实

### Requirement: 命令响应从 RequestRun 事实派生
Retry 和 edit 命令的幂等 MUST 锚定到新的 RequestRun acceptance 事实。Cancel 命令的幂等 MUST 锚定到目标 run 的 cancel terminal 尝试或 terminal commit metadata。命令响应 MUST 从这些 RequestRun 事实派生，并 MUST NOT 需要独立的 `RuntimeControlCommandOutcomeRecord` 或独立的命令结果 store。

#### Scenario: 相同命令语义重放相同结果
- **WHEN** 同一个 owner+agent 范围的 session 收到带相同 `idempotencyKey` 的相同命令语义
- **THEN** Runtime/Gateway MUST 从 RequestRun 锚点事实返回首个或等价的 accepted/terminal 结果
- **AND** 不得创建重复的 RequestRun、terminal commit、timeline 副作用、历史消息或 active context 条目

#### Scenario: 相同 key 配合不同命令语义产生冲突
- **WHEN** 同一个范围化的 `idempotencyKey` 被重用于不同的命令语义
- **THEN** Runtime MUST 返回安全的幂等冲突
- **AND** 该冲突 MUST NOT 创建新的命令结果事实或隐藏的 lifecycle 副作用
