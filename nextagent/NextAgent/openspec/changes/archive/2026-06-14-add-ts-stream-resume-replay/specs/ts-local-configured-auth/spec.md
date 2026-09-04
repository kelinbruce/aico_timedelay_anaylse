## MODIFIED Requirements

### Requirement: 未认证 Challenge 和受保护流程拦截
未认证访问受保护 local Web resource 时，系统 MUST 返回安全 authentication challenge，供 frontend 将用户路由到 login。challenge MUST 在 request acceptance、stream subscription、attachment intake、history read 或任何其他用户数据操作前返回。Challenge handling MUST NOT 创建或修改 durable user fact。

#### Scenario: Login shell、static asset 和 protected route precedence
- **WHEN** local auth 启用且未认证 client 访问 login shell、login/logout endpoint、必要 static asset、protected SPA route、`/api/**`、SSE 或 WebSocket entrypoint
- **THEN** login shell、login/logout endpoint 和必要 static asset MAY 按公开策略返回，用于完成登录流程
- **AND** protected SPA route MUST 返回可被 frontend 识别的 unauthenticated challenge 或 login routing response
- **AND** `/api/**`、SSE 和 WebSocket entrypoint MUST 在 SPA fallback 前被识别并执行 auth boundary
- **AND** unauthenticated SSE/WS MUST NOT 订阅 `RuntimeSessionPort.streamEvents(request)` 或泄漏 session/request/run 是否存在

#### Scenario: 未认证 REST 请求被拦截
- **WHEN** 未认证用户调用受保护 REST API
- **THEN** Web channel MUST 返回带 safe error shape 的 unauthenticated challenge
- **AND** response MUST 足以让 frontend 导航到 login
- **AND** runtime request acceptance、session mutation、message creation、attachment processing、memory access、pending input handling 和 capability invocation MUST NOT 被触发

#### Scenario: 未认证 SSE 或 WebSocket 请求被拦截
- **WHEN** 未认证 client 打开受保护 SSE stream 或 WebSocket stream subscription
- **THEN** Web channel MUST 使用安全 unauthenticated challenge 或 close reason 使 connection/subscription 失败
- **AND** Web channel MUST NOT 订阅 `RuntimeSessionPort.streamEvents(request)`
- **AND** Web channel MUST NOT 暴露被引用的 session、request 或 run 是否存在
