<!--
本文件是 active change 的行为规格 delta，路径为 specs/e2e-business-flow/spec.md。
-->

## ADDED Requirements

### Requirement: Submit Request End-to-End

系统 SHALL 支持从 submit 到 terminal commit 的完整请求生命周期，包含 REQUEST_ACCEPTED、RUN_STARTED、MODEL_STREAM_DELTA、MODEL_FINAL_CONTENT、TERMINAL_COMMIT 全部 timeline 事件。

#### Scenario: 正常提交并完成
- **WHEN** 用户通过 RuntimeCommandPort.submit 提交请求
- **THEN** 请求经历 accepted -> running -> completed 全流程，timeline 包含完整事件序列

### Requirement: Session Create End-to-End

系统 SHALL 支持从 session 创建到首次请求提交的完整路径，session 绑定正确的 agentId。

#### Scenario: 创建 session 并提交请求
- **WHEN** 创建新 session 后提交请求
- **THEN** session.agentId 与请求的 agentId 一致，请求正常执行

### Requirement: Agent Assembly Resolution

系统 SHALL 在请求提交时根据 agentId 解析 agent assembly，选择正确的 model profile、prompt profile 和 capability binding。

#### Scenario: 不同 agent 使用不同配置
- **WHEN** 两个不同 agentId 的 session 分别提交请求
- **THEN** 各自使用对应的 model profile 和 capability binding

### Requirement: Context Model Integration

系统 SHALL 在请求执行中正确组装 context（system prompt、history、skill disclosure、attachment），并将完整 context 发送给模型。

#### Scenario: 请求包含附件
- **WHEN** 提交带附件的请求
- **THEN** context 中包含附件引用，模型收到完整 context

### Requirement: Capability Invocation End-to-End

系统 SHALL 在模型返回 tool_call 时正确调用 capability，将工具结果返回模型继续推理。

#### Scenario: 模型调用 bash 工具
- **WHEN** 模型返回 bash tool_call
- **THEN** 系统调用 bash capability，将 stdout/stderr 结果返回模型

### Requirement: Timeline Stream Delivery

系统 SHALL 通过 SSE/WS 将 timeline 事件实时推送给客户端，事件顺序与持久化顺序一致。

#### Scenario: SSE 推送完整事件流
- **WHEN** 请求执行过程中产生 timeline 事件
- **THEN** 客户端通过 SSE 实时收到所有事件，且顺序与 timeline store 一致

### Requirement: Terminal Commit Consistency

系统 SHALL 保证 terminal commit 的 CAS 语义：同一 RequestRun 只能有一次成功的 terminal commit。

#### Scenario: 并发 terminal commit
- **WHEN** 两个并发操作尝试对同一 RequestRun 执行 terminal commit
- **THEN** 只有一个成功，另一个返回冲突错误

### Requirement: History Read After Completion

系统 SHALL 在请求完成后提供完整的消息历史读取，包含用户消息、模型回复和工具调用。

#### Scenario: 读取已完成请求的消息
- **WHEN** 请求 completed 后读取消息历史
- **THEN** 返回完整的消息序列，按时间排序

### Requirement: Session List Pagination

系统 SHALL 支持按 owner scope 分页查询 session 列表。

#### Scenario: 分页查询
- **WHEN** 使用 cursor 分页查询 session 列表
- **THEN** 返回当前页数据及 nextCursor，且只包含当前 owner scope 的 session

### Requirement: Checkpoint Save and Recovery

系统 SHALL 在请求执行过程中保存 checkpoint，进程重启后可从 checkpoint 恢复继续执行。

#### Scenario: 重启后恢复
- **WHEN** 进程重启后加载 checkpoint
- **THEN** 从 checkpoint 记录的 step index 继续执行，不丢失已完成的事实

### Requirement: Hook Invocation

系统 SHALL 在请求生命周期关键节点调用配置的 hook，hook 返回结果影响后续流程。

#### Scenario: pre-submit hook
- **WHEN** 配置了 pre-submit hook
- **THEN** hook 在 submit 前被调用，hook 结果影响请求是否接受

### Requirement: Pending Input Handling

系统 SHALL 在模型请求用户确认时暂停执行，等待用户输入后继续。

#### Scenario: 用户确认后继续
- **WHEN** 模型返回需要用户确认的 pending input
- **THEN** 请求状态变为 pending，用户输入后请求继续执行

### Requirement: Owner Scope Cross-Session

系统 SHALL 保证不同 owner scope 的 session 数据完全隔离。

#### Scenario: 跨租户隔离
- **WHEN** tenant-A 和 tenant-B 各有 session
- **THEN** 任一方无法访问对方的 session、消息或 timeline

### Requirement: Attachment Validation

系统 SHALL 对上传附件进行可信校验，校验通过后才可被请求引用。

#### Scenario: 上传并引用附件
- **WHEN** 上传附件并通过校验后，请求引用该附件
- **THEN** 附件可用且引用有效

### Requirement: Context Compression

系统 SHALL 在 context 超过容量阈值时执行压缩，压缩后保留关键信息。

#### Scenario: 长对话压缩
- **WHEN** 对话历史超过 context window
- **THEN** 系统执行压缩，压缩后的 context 包含摘要和关键事实
