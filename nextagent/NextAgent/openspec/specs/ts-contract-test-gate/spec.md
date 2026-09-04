# ts-contract-test-gate Specification

## Purpose
TBD - created by archiving change add-ts-contract-test-gate. Update Purpose after archive.
## Requirements
### Requirement: Runtime Command Submit Idempotency

系统 SHALL 对同一 idempotencyKey 的 submit 请求返回首次接受结果，不产生重复 side effect。

#### Scenario: 重复 submit 返回相同结果
- **WHEN** 使用相同 idempotencyKey 对同一 session 提交两次 submit
- **THEN** 第二次返回与首次相同的 requestId/runId/attempt，且只产生一条 RequestRun 记录和一条 REQUEST_ACCEPTED timeline 事件

### Requirement: Runtime Command Cancel Terminal Constraint

系统 SHALL 对已达到终态（completed 或 failed）的 RequestRun 拒绝 cancel。

#### Scenario: 取消已完成请求
- **WHEN** 对 status 为 completed 的 RequestRun 发起 cancel
- **THEN** 返回错误指示请求已终态，不可取消

### Requirement: Runtime Command Retry Attempt Lineage

系统 SHALL 为 retry 创建新 attempt 并保留旧 attempt 的 timeline 历史。

#### Scenario: 重试创建新 attempt
- **WHEN** 对已有 RequestRun 发起 retry
- **THEN** 创建新 attempt（attempt 递增），旧 attempt 的 timeline 事件仍然可见

### Requirement: Session Store Owner Scope Isolation

系统 SHALL 在查询 session 列表时只返回当前 owner scope 内的 session。

#### Scenario: 跨租户查询隔离
- **WHEN** tenant-A 的用户查询 session 列表
- **THEN** 只返回 tenant-A 拥有的 session，不返回 tenant-B 的 session

### Requirement: Session Message Append Idempotency

系统 SHALL 对 appendSessionMessage 的幂等写入保证：相同内容重复追加不产生重复消息。

#### Scenario: 重复追加消息
- **WHEN** 使用相同幂等 key 追加两条内容相同的消息
- **THEN** 只产生一条消息记录

### Requirement: Session Message Hide Visibility

系统 SHALL 将 hideMessage 标记的消息从默认查询中排除，但消息记录不删除。

#### Scenario: 隐藏消息后查询
- **WHEN** 隐藏一条消息后查询消息列表
- **THEN** 该消息不在默认查询结果中，但按 ID 仍可读取

### Requirement: Active Context Version CAS

系统 SHALL 对 active context 的并发修改使用 version CAS，冲突时拒绝后写入。

#### Scenario: 并发修改冲突
- **WHEN** 两个并发请求基于同一 version 修改 active context
- **THEN** 只有一个成功，另一个返回版本冲突错误

### Requirement: Active Context Compaction Atomicity

系统 SHALL 保证 compaction 操作原子完成：删除旧条目和添加 compaction summary 在同一事务中。

#### Scenario: compaction 中间状态不可见
- **WHEN** compaction 正在执行
- **THEN** 不会出现旧条目已删除但 summary 未写入的中间状态

### Requirement: RequestRun Status State Machine

系统 SHALL 只允许合法的 status 转换：pending -> running -> completed/failed/canceled。

#### Scenario: 非法状态转换拒绝
- **WHEN** 尝试将 status 从 completed 转为 running
- **THEN** 返回错误指示非法状态转换

### Requirement: Timeline Event Sequence Monotonicity

系统 SHALL 保证同一 run 内 timeline event 的 sequence 单调递增且无间隙。

#### Scenario: 事件顺序完整性
- **WHEN** 追加多条 timeline event
- **THEN** sequence 连续递增，无重复无跳跃

### Requirement: Checkpoint Idempotent Key

系统 SHALL 对相同 idempotencyKey 的 checkpoint 写入返回首次结果，不重复 side effect。

#### Scenario: 重复写入 checkpoint
- **WHEN** 使用相同 idempotencyKey 写入两次 checkpoint
- **THEN** 第二次返回首次结果，且只产生一条 checkpoint 记录

### Requirement: Attachment Metadata Blob Separation

系统 SHALL 将 attachment 的 metadata 和 blob 数据分离存储，metadata 可独立查询。

#### Scenario: 查询 attachment 元信息
- **WHEN** 查询 attachment 列表
- **THEN** 返回 metadata（不含 blob 内容），blob 通过独立接口按 availability 校验后获取

### Requirement: Model Gateway Safe Error Mapping

系统 SHALL 将模型 provider 的原始错误映射为 SafeError，不暴露 provider 细节、credential 或内部路径。

#### Scenario: provider 返回认证错误
- **WHEN** 模型 provider 返回 401 Authentication Failed
- **THEN** 系统对外暴露的 error 不包含 provider 名称、API endpoint 或 credential 信息

### Requirement: Capability Gateway Timeout Cancellation

系统 SHALL 在 capability invocation 超时或被取消时返回明确的错误，不留下悬空执行。

#### Scenario: 能力调用超时
- **WHEN** capability invocation 超过配置的 timeout
- **THEN** 返回超时错误，且不在后台继续执行该调用
