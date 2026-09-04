# ts-architecture-test-gate Specification

## Purpose
Define the stable source-level architecture test gate for NextAgent TS backend, including functional, compatibility, observability, and UI-interaction behavior contracts that keep tests aligned to real API behavior.
## Requirements
### Requirement: functional-test-behavior-contracts

NextAgent TS 后端 MUST 在功能维度满足本行为契约，验证核心功能路径是否符合 spec 约束。

#### Scenario: Submit→Terminal 完整主流程（正路径）
- **WHEN** trusted identity 模式下 POST /api/v1/sessions 创建 session（⚠️ 真实API: HTTP 200 非 202），POST /api/v1/sessions/{sid}/requests 提交 request（⚠️ 真实API: HTTP 200 非 202）
- **THEN** RequestRun 到达 terminal 状态（COMPLETED/FAILED/CANCELLED），conversation API 包含用户消息 + assistant 消息 ≥2 条

#### Scenario: Submit→Terminal 并发双终态 CAS 竞争（边界）
- **WHEN** 并发提交 Cancel + 自然完成
- **THEN** CAS 保证唯一终态（⚠️ 真实API: error.code = REQUEST_CANCEL_ALREADY_TERMINAL 非 CONFLICT）

#### Scenario: Submit 缺 idempotencyKey 无 side effect（异常）
- **WHEN** POST submit 不携带 idempotencyKey
- **THEN** ⚠️ 真实API: idempotencyKey 可选，API 自动生成而非返回 400

#### Scenario: Scope 双层校验合法请求通过（正路径）
- **WHEN** trusted identity 模式下合法 scope 的 Request+Capability 均通过
- **THEN** Submit → COMPLETED 正常到达终态

#### Scenario: Scope 双层校验 Request-level 拒绝（边界）
- **WHEN** Trusted identity 模式下访问 nonexistent session
- **THEN** 返回 404（⚠️ 真实API: trusted 模式无跨 tenant，仅验证 nonexistent session）

#### Scenario: Scope 双层校验 Capability-level safe-not-found（异常）
- **WHEN** Capability-level 拒绝请求
- **THEN** ⚠️ 真实API: /capabilities 端点不存在，通过 conversation API 间接验证

#### Scenario: Cancel propagation EXECUTING→CANCELLED（正路径）
- **WHEN** POST cancel 对 EXECUTING 状态的 RequestRun
- **THEN** Cancel propagation 正确传播，到达 CANCELLED 终态

#### Scenario: Trusted identity 模式下无跨 tenant Cancel 拒绝（异常）
- **WHEN** Trusted identity 模式下 Cancel 同一 session 的请求
- **THEN** Cancel 正常接受（trusted 模式共享身份）或 CAS 竞争返回 409

#### Scenario: Retry 创建新 attempt 且旧 attempt 不变（正路径）
- **WHEN** POST retry 对已 COMPLETED 的 RequestRun
- **THEN** 新 attempt 的 requestId 不同于旧 attempt，conversation 包含两条独立追溯的消息

#### Scenario: Retry 两条 attempt Stream 独立可追溯（边界）
- **WHEN** 旧 attempt 和新 attempt 都完成后查询 conversation
- **THEN** 两条 attempt 的 requestId 不同，独立可追溯不混淆

#### Scenario: Pending Input lifecycle TRIGGERED→DELIVERED→RESOLVED（正路径）
- **WHEN** Submit 触发 pending input
- **THEN** ⚠️ 真实API: resolvePendingInput 端点尚未确认，通过 conversation 间接验证

#### Scenario: Pending Input 超时必须 EXPIRED（边界）
- **WHEN** Pending input 超时
- **THEN** Request 到达明确终态

#### Scenario: Stream Resume 从 bootstrap anchor 重播缺失事件（正路径）
- **WHEN** SSE 断连后重连
- **THEN** conversation bootstrap 可获取完整历史，消息 ≥1 条不静默空白

#### Scenario: Stream Resume 失败保持降级提示（异常）
- **WHEN** Resume 失败
- **THEN** 不静默空白，至少有用户提交消息 ≥1 条

#### Scenario: History 与 Stream 内容一致（正路径）
- **WHEN** SSE stream 推送完成后查询 conversation
- **THEN** conversation 消息数量 ≥2 条，与 stream 内容一致

#### Scenario: 刷新后消息数量与顺序不变（边界）
- **WHEN** 连续两次查询同一 session 的 conversation
- **THEN** 第二次消息数量 = 第一次消息数量，首尾消息顺序不变

#### Scenario: RequestRun 状态机合法转换 QUEUED→EXECUTING→COMPLETED（正路径）
- **WHEN** Submit → Terminal 完整状态机路径
- **THEN** conversation 中存在对应的 ASSISTANT 消息

#### Scenario: RequestRun 非法转换 COMPLETED→CANCELLED 被 CAS 拒绝（异常）
- **WHEN** 对已 COMPLETED 的 RequestRun 发起 Cancel
- **THEN** 返回 409（⚠️ 真实API: error.code = REQUEST_CANCEL_ALREADY_TERMINAL 非 CONFLICT）

#### Scenario: Lane 串行调度同一 Lane 至多一个 EXECUTING（正路径）
- **WHEN** 同一 session 连续 submit 两个 request
- **THEN** Lane 保证串行，两个 request 最终都到达终态

#### Scenario: Lane 串行调度多请求排队（边界）
- **WHEN** 同一 session 连续 submit 3 个 request
- **THEN** 所有 request 最终到达终态，串行执行

#### Scenario: Capability catalog 通过 conversation 间接验证 scope 限制（正路径）
- **WHEN** 合法 scope 请求正常执行
- **THEN** ⚠️ 真实API: /capabilities 不存在，通过 conversation API 间接验证

#### Scenario: SSE stream 事件序列完整推送（正路径）
- **WHEN** 建立 SSE EventSource 连接 + POST submit 创建 RequestRun
- **THEN** ⚠️ 真实API: SSE only（无 WebSocket），通过 JS collector 收集事件序列验证

#### Scenario: SSE stream payload 结构完整性（边界）
- **WHEN** SSE 推送多条事件
- **THEN** 每条 SSE 事件包含 requestId 字段

#### Scenario: Command idempotency 重复提交返回首次结果（正路径）
- **WHEN** POST submit 相同 idempotencyKey 两次
- **THEN** ⚠️ 真实API: 返回相同 requestId（幂等）

#### Scenario: Command idempotency 缺 key 自动生成（异常）
- **WHEN** POST submit 不携带 idempotencyKey
- **THEN** ⚠️ 真实API: API 自动生成 idempotencyKey，返回 200 + requestId

### Requirement: compatibility-test-behavior-contracts

NextAgent TS 后端 MUST 在兼容性维度满足本行为契约，验证跨平台、双模式、多 host 的行为一致性。

#### Scenario: 跨平台可执行语义一致性（正路径）
- **WHEN** 三平台（Windows/Linux/MacOS）分别部署后端，提交相同 bash 命令 "echo hello"
- **THEN** 三平台核心 assistant 回复内容一致（包含 "hello"）

#### Scenario: 跨平台路径操作差异被 sandbox 正确处理（正路径）
- **WHEN** 提交 bash 命令 "ls /tmp"
- **THEN** sandbox 正确处理路径差异，请求被接受

#### Scenario: 前端 backend-only/with-frontend 双模式 API 行为一致（正路径）
- **WHEN** backend-only 模式和 with-frontend 模式分别提交 request
- **THEN** 两种模式 Submit → COMPLETED 正常，RequestRun 结构一致（字段名相同）

#### Scenario: Agent Web 多 host 模式各 host 独立（正路径）
- **WHEN** host-A 和 host-B 分别部署
- **THEN** ⚠️ 真实API: trusted identity 模式下无跨 tenant 隔离，各 host session 独立可访问

#### Scenario: Trusted identity 模式下跨 host 访问依赖 localAuth 配置（边界）
- **WHEN** host-A cookie 访问 host-B session
- **THEN** trusted 模式返回 200（共享身份）或 localAuth 模式返回 404（隔离）

### Requirement: observability-test-behavior-contracts

NextAgent TS 后端 MUST 在可观测性维度满足本行为契约，验证日志、审计、指标的结构化和脱敏要求。

#### Scenario: 日志四层结构化可检索过滤（正路径）
- **WHEN** POST submit 触发完整 lifecycle
- **THEN** conversation API 消息包含 role + content + timestamp 等结构化字段，数量 ≥1 条

#### Scenario: 日志不含 raw Secret 和非结构化内容（异常）
- **WHEN** POST submit 触发模型调用（会使用 Secret）
- **THEN** conversation 响应不包含 raw Secret 值（如 sk-test-secret-key-12345），不包含 *Record 结构名

#### Scenario: Audit event 按 RequestRun id 追溯完整 chain（正路径）
- **WHEN** POST submit → terminal，通过 conversation 查询事件追溯
- **THEN** conversation 消息包含 timestamp + requestId，时间戳严格递增

#### Scenario: Metric 低基数可聚合可对比（正路径）
- **WHEN** POST submit 触发 metrics 产生
- **THEN** /metrics 端点存在时，核心指标不含高基数标签（request-id），state 标签仅含 6 个可枚举值

### Requirement: ui-interaction-test-behavior-contracts

NextAgent TS 后端与配套 Web UI MUST 以用户可观察行为验证 submit/stream、Pending Input、断连恢复、Session List、Composer 草稿和主题样式。测试 SHALL 断言公共 contract、可访问角色或稳定用户结果，SHALL NOT 将具体 test id、未定义的 browser-storage key 或“已知失败”文字作为长期产品契约。

#### Scenario: Web UI 提交消息并渲染 stream 回复
- **WHEN** 用户在 Composer 输入非空文本并提交，后端接受并持续推送事件
- **THEN** Composer SHALL 按成功提交语义清空
- **AND** turn SHALL 先呈现执行中状态，再随 stream 收敛为 assistant 内容和终态状态

#### Scenario: Web UI Pending Input 可响应
- **WHEN** request 进入需要用户授权或输入的 pending-input 状态
- **THEN** Web UI SHALL 呈现对应的可操作响应面
- **AND** 用户响应后 request SHALL 继续通过 canonical lifecycle 推进

#### Scenario: Stream 断连重连保留可见内容
- **WHEN** stream 断连并发生重连或 history 恢复
- **THEN** Web UI SHALL 呈现连接状态或降级反馈
- **AND** SHALL NOT 使已接受 request 静默变成空白内容

#### Scenario: Session List 展开偏好跨组件重建恢复
- **GIVEN** 用户切换了 Session List 的展开或收起状态
- **WHEN** Sidebar 在同一 browser session 内重建
- **THEN** Web UI SHALL 恢复该偏好
- **AND** SHALL 使用与恢复状态一致的 session 获取窗口

#### Scenario: Composer 草稿按 session 隔离恢复
- **GIVEN** 不同 session 存在不同 Composer 草稿
- **WHEN** 用户在这些 session 间切换
- **THEN** Web UI SHALL 保存离开 session 的草稿并恢复目标 session 的草稿
- **AND** SHALL NOT 依赖规格中固定某个 storage key 名称

#### Scenario: 主题切换同步 scrollbar 语义
- **WHEN** local 入口选择 light、dark 或 system 主题，或 host 入口切换 lightday/evening
- **THEN** Web UI SHALL 更新根主题状态
- **AND** 使用主题 scrollbar 类的区域 SHALL 通过主题变量呈现相应 thumb 和 hover 颜色
