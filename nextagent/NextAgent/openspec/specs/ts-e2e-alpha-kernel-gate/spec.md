## Purpose

Define the Alpha E2E gate that verifies the Alpha minimal Q&A kernel (session create, submit, SSE stream, terminal commit, history read, SafeError boundary, owner/agent scope isolation, and same-session concurrent conflict rejection) using real local product process, real HTTP/SSE connections, and real local persistence, independent of P0 capabilities (local auth, WebSocket, cancel, retry, tool, attachment, title, feedback, context compression).

## Requirements

### Requirement: Alpha E2E 使用真实产品边界

Alpha E2E gate SHALL 使用真实 local product process、真实监听端口和真实 HTTP/SSE client 执行。被验证链路中的 product composition、Web transport、runtime、local gateway persistence MUST NOT 被 mock 替代。

Alpha E2E gate SHALL 只消费 Alpha 级 product composition：无需 local auth、无需 WebSocket、无需 P0 工具注册、无需 P0 context assembly 增强。gate 使用的 product process fixture MUST 基于 `ship-ts-minimal-agent-kernel` 定义的最小 product composition。

#### Scenario: 真实产品 Alpha 主链路通过
- **WHEN** 执行 `npm run test:e2e:alpha`
- **THEN** gate 通过真实 local product entrypoint 完成所有必需 Alpha E2E 用例
- **AND** 每个用例得到用户可见结果或 canonical terminal result

#### Scenario: Mock 不能满足 Alpha E2E gate
- **WHEN** 用例使用 mock HTTP route、fake EventSource 或直接领域 service 调用替代目标链路
- **THEN** 该用例 MUST NOT 被计为本 gate 的通过证据

#### Scenario: P0 能力污染 Alpha 用例被拒绝
- **WHEN** Alpha E2E 用例依赖 local auth、WebSocket、cancel、retry、tool、attachment、title、feedback、context compression 或 packaging 等 P0 能力
- **THEN** 该用例 MUST NOT 被计为本 gate 的通过证据

### Requirement: Alpha E2E 覆盖最小问答内核行为

Alpha E2E gate MUST 覆盖 e2e-alpha-01、02、03、04、05、06。每个 case id MUST 只有一个主要维护 spec，且 MUST 验证 `ship-ts-minimal-agent-kernel` 已定义的 OpenSpec 行为的外部可观察结果。

#### Scenario: 所有必需 Alpha 用例通过
- **WHEN** 6 个必需 case 均执行并通过
- **THEN** gate 返回 passed

#### Scenario: 必需 Alpha 用例缺失或失败
- **WHEN** 任一必需 case 缺失、skipped、timeout 或 failed
- **THEN** gate 返回 failed
- **AND** 不得用其他 case 的成功覆盖该结果

### Requirement: 最小问答主流程 E2E

e2e-alpha-01 SHALL 验证 Alpha 最小问答主流程：客户端创建 session、提交问题、通过 SSE stream 接收模型输出和 terminal event、通过 history 读取一致结果。用例 MUST 覆盖 `POST /api/v1/sessions`、`POST /api/v1/requests`（携带/不携带 sessionId）、SSE stream 消费和 `GET /api/v1/sessions/:sessionId/messages`。

#### Scenario: session 创建后提交问题并完成问答
- **WHEN** 客户端创建 session 后提交合法问题
- **THEN** SSE stream MUST 返回模型输出 delta 和 terminal stream event
- **AND** history MUST 可读取到用户问题和最终 assistant message
- **AND** terminal stream event 与 history 中的 assistant message 一致

#### Scenario: 不携带 sessionId 提交问题自动创建 session
- **WHEN** 客户端调用 `POST /api/v1/requests` 且 payload 未携带 `sessionId`
- **THEN** 系统 MUST 自动创建 session 并使用创建后的 sessionId 推进问答
- **AND** 后续 history 读取 MUST 使用该 sessionId

### Requirement: SSE canonical sequence E2E

e2e-alpha-02 SHALL 验证 SSE stream 的事件类型、顺序和终端状态。用例 MUST 验证 `StreamEnvelope.eventType` 按正确顺序出现、terminal event 之后不再有新事件、且同一 request 的 stream 和 history 终态一致。

#### Scenario: SSE 事件类型和顺序正确
- **WHEN** 客户端通过 SSE 消费一次合法问答的 stream
- **THEN** stream event types MUST 按正确顺序出现（如 delta、terminal）
- **AND** terminal event type MUST 为 `REQUEST_COMPLETED` 或 `REQUEST_FAILED`

#### Scenario: Terminal 后无新事件
- **WHEN** SSE stream 已收到 terminal event
- **THEN** 后续 MUST NOT 出现新 stream event

### Requirement: 同 session 并发冲突拒绝 E2E

e2e-alpha-03 SHALL 验证同一 owner-scoped and agent-scoped session 内并发 submit 被正确拒绝。Alpha 内核使用简单冲突拒绝（非 lane scheduling）：第二个 submit 在第一个 run 仍 active 时 MUST 返回 safe conflict/rejection，且两个 submit MUST NOT 交叉写入彼此的事实。

#### Scenario: 同 session 并发 submit 第二个被拒绝
- **WHEN** 第一个 submit 已产生 active run 且第二个 submit 同时进入同一 session
- **THEN** 第二个 submit MUST 返回 safe conflict/rejection
- **AND** 两个 submit MUST NOT 交叉写入 requestId、runId、timeline sequence 或 visible history

#### Scenario: 不同 session 并发 submit 互不干扰
- **WHEN** 两个 submit 进入不同 session
- **THEN** 系统 MUST NOT 串写 session、request、run、timeline 或 history 标识

### Requirement: SafeError 安全边界 E2E

e2e-alpha-04 SHALL 验证跨边界失败被归一化为 SafeError，且不得向用户、stream 或 history 泄漏敏感原始内容。用例 MUST 验证非法输入、provider failure 等场景的 SafeError 输出不包含 raw prompt、model output、stream delta、raw provider error、tool arguments、tool result、raw credential、token、附件内容或未脱敏路径。

#### Scenario: 非法输入返回 SafeError 且不泄漏
- **WHEN** 客户端提交 schema validation 失败的输入
- **THEN** response MUST 包含 SafeError shape（`code`、`message`、`category`、`retryable`、`safeDetails?`）
- **AND** SafeError MUST NOT 包含 raw prompt、raw provider error、stack trace 或本地路径

#### Scenario: Provider 失败返回 SafeError 且不泄漏
- **WHEN** model provider 返回 raw error
- **THEN** 对外响应 MUST 归一化为 SafeError
- **AND** SafeError MUST NOT 包含 raw provider error details、raw model output 或 credential

### Requirement: Idempotent session create E2E

e2e-alpha-05 SHALL 验证重复 owner-scoped and agent-scoped session create 返回首次创建结果，且不产生第二个 session。用例 MUST 验证相同 owner+agent scope 下的幂等 session create。

#### Scenario: 重复 session create 返回首次结果
- **WHEN** 客户端以相同 owner+agent scope 重复调用 `POST /api/v1/sessions`
- **THEN** 第二次调用 MUST 返回首次创建的 session
- **AND** 第二次调用 MUST NOT 创建第二个 session
- **AND** 两次调用返回的 `sessionId` MUST 相同

### Requirement: Owner scope 隔离 E2E

e2e-alpha-06 SHALL 验证跨 owner session 访问返回 safe not-found，且不泄露 session 是否存在于其他 owner 下。用例 MUST 验证使用不同 trusted identity 访问不属于当前 owner 的 session 时返回 safe not-found。

#### Scenario: 跨 owner 访问 session 返回 safe not-found
- **WHEN** 客户端以 owner A 的身份尝试访问 owner B 创建的 session
- **THEN** 系统 MUST 返回 safe not-found outcome
- **AND** response MUST NOT reveal 该 session 是否存在于其他 owner 下

#### Scenario: 跨 owner 访问 conversation 返回 safe not-found
- **WHEN** 客户端以 owner A 的身份尝试读取 owner B 的 session conversation
- **THEN** 系统 MUST 返回 safe not-found outcome

### Requirement: Alpha E2E 证据安全且可追溯

gate MUST 产出 machine-readable report，至少关联 case id、结果、失败阶段和安全 evidence ref。报告 MUST NOT 包含 raw credential、prompt、完整模型输出、附件内容、secret 或未脱敏路径。

The gate SHALL maintain the single standard command `npm run test:e2e:alpha`. The command MUST write a machine-readable `ReleaseCheckResult`. It MUST NOT define an adapter API or implement release verdict aggregation.

#### Scenario: Gate 失败提供安全证据
- **WHEN** 任一 Alpha 用例失败
- **THEN** report 标识失败 case 和阶段
- **AND** evidence 足以定位测试边界但不泄露敏感内容
