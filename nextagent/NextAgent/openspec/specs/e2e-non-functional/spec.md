# e2e-non-functional Specification

## Purpose
TBD - created by archiving change add-ts-architecture-test-gate. Update Purpose after archive.
## Requirements
### Requirement: Performance Threshold Gate

系统 SHALL 在端到端请求中满足性能阈值：submit 响应 < 100ms，单次问答编排开销 < 30s。

#### Scenario: 提交响应时间
- **WHEN** 提交请求
- **THEN** submit 返回时间 < 100ms

#### Scenario: 端到端编排时间
- **WHEN** 完整请求从提交到完成
- **THEN** 排除模型推理后编排开销 < 30s

### Requirement: Reliability Recovery Gate

系统 SHALL 在进程重启后从 durable facts 恢复完整状态，不丢失已提交的事实。

#### Scenario: 重启后恢复
- **WHEN** 进程异常终止后重启
- **THEN** 从 checkpoint 恢复，已 terminal commit 的请求状态完整

### Requirement: Security Boundary Gate

系统 SHALL 在所有安全边界上拒绝非法访问：credential 不泄露、sandbox deny-by-default、owner scope 隔离、日志不含敏感信息。

#### Scenario: credential 泄露检测
- **WHEN** 通过 canary 注入测试 credential 泄露
- **THEN** API 响应、SSE stream、日志中不包含 canary 值

### Requirement: Resilience Degradation Gate

系统 SHALL 在模型 provider 不可用时降级返回 SafeError，不影响其他 session 或后续请求。

#### Scenario: provider 不可用
- **WHEN** 模型 provider 不可用
- **THEN** 请求返回 safe error，不影响其他 session
