## ADDED Requirements

### Requirement: Local auth 启动配置和产品装配
本地配置认证 MUST 只能用于 localhost local product entrypoint。local product entrypoint MUST 在 app configuration freeze 和 `agent-app` secret validation result 可用之后，显式组装 `agent-channel-web-auth-local`。local auth serving boundary MUST 默认限制为 localhost-only，并且本 capability MUST NOT 启用非 localhost 服务暴露。`agent-channel-web` MUST 在不 import `agent-channel-web-auth-local` 的情况下仍可使用。Remote 或 IAM product entrypoint MUST NOT import、register、bundle、expose 或静默 fallback 到本地配置认证。

`agent-channel-web-auth-local` MUST 通过 Fastify plugin 或 plugin factory 提供 local auth route registration。Local product entrypoint MUST 在与受保护 Web/API/SSE/WS routes 相同的 Fastify scope 内注册该 plugin。Generic app composition 和 remote/IAM product entrypoints MUST NOT 注册 local login/logout routes。

Local configured auth runtime package dependencies MUST 由专用 local product manifest 声明。Backend-only 和 with-frontend product manifests MUST NOT declare `agent-channel-web-auth-local`；local configured auth product manifest MUST 同时声明 `agent-app` 和 `agent-channel-web-auth-local`。

#### Scenario: Local product entrypoint 显式启用本地认证
- **WHEN** local deployment 使用有效 local auth 配置和有效 secret reference 启动
- **THEN** app startup MUST 在受保护 Web route 对外服务前组装 local auth adapter
- **AND** 受保护 Web page、REST、SSE 和 WebSocket entrypoint MUST 要求通过 local auth
- **AND** 下游请求处理 MUST 只通过 channel/auth boundary 接收可信身份

#### Scenario: Local auth 默认只服务本机访问
- **WHEN** 本地配置认证已启用
- **THEN** serving boundary MUST 默认为 localhost-only
- **AND** 除非后续 change 定义 reverse proxy、TLS、secure-cookie 和部署安全规则，否则非 localhost 暴露 MUST 保持不可用

#### Scenario: Remote 或 IAM product entrypoint 不暴露本地认证
- **WHEN** remote 或 IAM deployment 启动
- **THEN** product entrypoint MUST NOT 注册 local login/logout endpoint
- **AND** product entrypoint MUST NOT bundle 或 import `agent-channel-web-auth-local`
- **AND** backend-only / with-frontend product manifests MUST NOT declare `agent-channel-web-auth-local`
- **AND** product entrypoint MUST NOT 使用 configured local user 作为认证 fallback

#### Scenario: Auth 配置在 ready 前阻断错误启动
- **WHEN** local auth 已启用，但必需的 local user identity、credential reference 或 cookie TTL 配置缺失或无效
- **THEN** startup MUST 在受保护 Web route 对外服务前失败
- **AND** readiness MUST 只暴露安全诊断
- **AND** 无效 auth 配置 MUST NOT 导致创建 request lifecycle、session、message、attachment、memory、pending input 或 capability state

### Requirement: Local auth 配置输入边界
本地认证 MUST 只消费 startup 阶段创建的冻结 app configuration 和 `agent-app` 提供的 app-owned secret validation result。local user identity 和 credential source MUST 来自部署配置源，并且在 ready 前完成校验和冻结。configured credential source MUST 使用 `env:` 或 `file:` `SecretReference`。auth-local MUST NOT 重新读取 raw env/file，且 MUST NOT 将 secret validation result 暴露为跨模块 public contract。本 capability MUST NOT 支持 raw credential value、inline secret、`direct:` reference、query parameter credential、运行时页面修改 auth 配置、用户注册、密码修改 API、remember-me、refresh token 或 server-side auth session store。

#### Scenario: 本地身份和凭据来源来自部署配置
- **WHEN** 部署者通过受支持的部署配置源配置 local auth
- **THEN** startup MUST 从冻结 app configuration 派生 local user identity 和 credential source
- **AND** 运行时页面编辑或 request payload MUST NOT 修改 configured identity 或 credential source
- **AND** 配置变更 MUST 在 process restart 且 startup validation 成功后才生效

#### Scenario: Credential source 使用 secret reference
- **WHEN** local auth configuration 声明 credential source
- **THEN** credential source MUST 是 `env:` 或 `file:` `SecretReference`
- **AND** active required credential reference MUST 在 app 进入 ready 前完成校验
- **AND** raw credential value MUST NOT 出现在 frozen config snapshot、safe error、stream payload、log、metric、trace、audit 或 model context 中

#### Scenario: Raw credential 被拒绝
- **WHEN** local auth configuration 包含 raw credential、inline secret、`direct:` reference 或 unsupported credential source
- **THEN** startup MUST 将 local auth 分支归类为 blocked
- **AND** safe diagnostic MUST 只标识安全字段引用和 reason code
- **AND** diagnostic MUST NOT 泄露 credential value、secret file content、完整敏感路径或 resolver exception detail

#### Scenario: 配置修改需要重启生效
- **WHEN** configuration source 中的 local auth identity、credential reference 或 cookie policy 被修改
- **THEN** 正在运行的 process MUST 继续使用其 startup frozen snapshot
- **AND** 新配置 MUST NOT 影响认证行为，直到 process restart 且 startup validation 成功

### Requirement: Local login 和 logout
本地认证 MUST 只在 local product entrypoint 提供 login 和 logout endpoint。Login MUST 使用 constant-result safe failure semantics 和最小限速或退避，校验提交的 credential 是否匹配 configured local credential。登录成功 MUST 返回安全的 current-user identity summary，并设置 signed HttpOnly cookie。Logout MUST 清除 local auth cookie，并且 MUST NOT 依赖 server-side auth session store。

#### Scenario: 登录成功设置 cookie 并返回身份摘要
- **WHEN** 用户从 localhost 向 login endpoint 提交 configured local credential
- **THEN** server MUST 使用 configured secret source 校验 credential
- **AND** server MUST 设置带 fixed TTL、`SameSite=Strict` 和 `Path=/` 的 signed HttpOnly cookie
- **AND** server MUST 返回由 configured local identity 派生的安全 identity summary
- **AND** server MUST NOT 返回 credential、cookie signature material、secret reference content 或内部校验细节

#### Scenario: 登录失败不泄露凭据状态
- **WHEN** 用户提交无效 local credential
- **THEN** login MUST 返回安全 authentication failure response
- **AND** 重复失败登录尝试 MUST 受到最小限速或退避约束
- **AND** failure response MUST NOT 泄露 credential 是否接近正确值、使用了哪个 secret source、文件是否存在或签名/校验如何实现

#### Scenario: 登出清除本地认证 cookie
- **WHEN** 已认证用户调用 logout
- **THEN** response MUST 清除 local auth cookie
- **AND** 后续没有 newly valid cookie 的受保护请求 MUST 收到 unauthenticated challenge
- **AND** logout MUST NOT 删除 session history、RequestRun fact、attachment、artifact、memory record 或其他用户数据

### Requirement: Local auth cookie 生命周期
local auth cookie MUST 是带 fixed TTL、`SameSite=Strict` 和 `Path=/` 的 signed HttpOnly cookie。cookie MUST 在 TTL expiration、signature failure、logout 或 service restart 后失效。localhost HTTP 场景不要求 Secure cookie。本 capability MUST NOT 启用非 localhost 暴露、HTTPS reverse-proxy secure-cookie 要求、LAN access、public internet access 或 long-lived query parameter token。

#### Scenario: Cookie 在有效期内授权受保护请求
- **WHEN** 来自 localhost 的受保护 REST、SSE 或 WebSocket request 携带有效 local auth cookie
- **THEN** auth boundary MUST 校验 signature、TTL、process-bound signing context 和 configured identity binding
- **AND** auth boundary MUST 注入 trusted `IdentityContext` 供下游 owner-scope processing 使用
- **AND** auth boundary MUST NOT 信任 request body、query、header、client metadata、model output 或 capability parameter 中的 tenant、subject、display name、role 或 auth 字段

#### Scenario: Cookie 过期、签名无效或服务重启后失效
- **WHEN** 受保护 request 携带 expired cookie、tampered cookie、previous process 签发的 cookie 或其他 invalid cookie
- **THEN** auth boundary MUST 使用 unauthenticated challenge 或安全 close reason 拒绝请求
- **AND** auth boundary MUST NOT 创建 session、request run、message、attachment、memory、pending input 或 capability state
- **AND** auth boundary MUST 只记录 safe auth diagnostic

#### Scenario: Query parameter 长期票据被拒绝
- **WHEN** 受保护 REST、SSE 或 WebSocket request 在 query parameter 中携带 long-lived credential 或 token
- **THEN** local auth boundary MUST NOT 将该 query parameter 作为认证依据
- **AND** 除非后续 change 定义 one-time handshake token，否则 request MUST 仍然要求有效 local auth cookie

### Requirement: 未认证 Challenge 和受保护流程拦截
未认证访问受保护 local Web resource 时，系统 MUST 返回安全 authentication challenge，供 frontend 将用户路由到 login。challenge MUST 在 request acceptance、stream subscription、attachment intake、history read 或任何其他用户数据操作前返回。Challenge handling MUST NOT 创建或修改 durable user fact。

#### Scenario: Login shell、static asset 和 protected route precedence
- **WHEN** local auth 启用且未认证 client 访问 login shell、login/logout endpoint、必要 static asset、protected SPA route、`/api/**`、SSE 或 WebSocket entrypoint
- **THEN** login shell、login/logout endpoint 和必要 static asset MAY 按公开策略返回，用于完成登录流程
- **AND** protected SPA route MUST 返回可被 frontend 识别的 unauthenticated challenge 或 login routing response
- **AND** `/api/**`、SSE 和 WebSocket entrypoint MUST 在 SPA fallback 前被识别并执行 auth boundary
- **AND** unauthenticated SSE/WS MUST NOT 订阅 `RuntimeTimelinePort.stream(request)` 或泄漏 session/request/run 是否存在

#### Scenario: 未认证 REST 请求被拦截
- **WHEN** 未认证用户调用受保护 REST API
- **THEN** Web channel MUST 返回带 safe error shape 的 unauthenticated challenge
- **AND** response MUST 足以让 frontend 导航到 login
- **AND** runtime request acceptance、session mutation、message creation、attachment processing、memory access、pending input handling 和 capability invocation MUST NOT 被触发

#### Scenario: 未认证 SSE 或 WebSocket 请求被拦截
- **WHEN** 未认证 client 打开受保护 SSE stream 或 WebSocket stream subscription
- **THEN** Web channel MUST 使用安全 unauthenticated challenge 或 close reason 使 connection/subscription 失败
- **AND** Web channel MUST NOT 订阅 `RuntimeTimelinePort.stream(request)`
- **AND** Web channel MUST NOT 暴露被引用的 session、request 或 run 是否存在

### Requirement: Trusted `IdentityContext` 注入
本地认证成功后，Web channel MUST 基于 configured local identity 和 validated cookie 创建 request `IdentityContext`。该 identity MUST 是 Web channel 发起的受保护 request lifecycle、session/history read、stream projection、attachment intake、artifact access、memory access 和 capability invocation 的唯一 owner-scope input。

#### Scenario: 客户端身份字段不能覆盖可信身份
- **WHEN** 已认证 request payload 包含 tenantId、subjectId、displayName、owner、auth 或等价 identity 字段
- **THEN** Web channel MUST 忽略这些字段，不将其作为 owner-scope identity
- **AND** downstream module MUST 接收 trusted local `IdentityContext`
- **AND** safe diagnostic MUST NOT 将 untrusted identity field 作为 authoritative fact 回显

#### Scenario: 受保护读取使用本地可信身份
- **WHEN** 已认证 local user 读取 session history、打开 stream replay、上传 attachment 或提交 request
- **THEN** owner-scope validation MUST 使用 trusted `IdentityContext`
- **AND** acceptance 后创建的任何 persisted user runtime data MUST 按既有 data ownership contract 携带从 trusted identity 派生的 owner scope

### Requirement: Local auth 安全诊断
本地认证 MUST 为 startup validation、login success/failure、logout、challenge、invalid cookie、expired cookie 和 protected-entry rejection 产生安全认证诊断。当已配置的 observability sink 可用时，系统 MUST 通过既有 observability boundary 输出 safe structured log、audit record 或 metric；未配置对应 sink 时，系统 MUST 保持认证拒绝语义和 safe diagnostic reason code。该能力 MUST NOT 定义新的 observability contract，并且诊断 MUST NOT 包含 raw credential、cookie value、signing key、secret file content、完整敏感路径、raw exception、prompt/model output、stream delta、attachment content 或 unauthorized object content。

#### Scenario: 登录和拒绝事件可审计但不泄密
- **WHEN** login 成功、login 失败、logout 发生或受保护 request 被拒绝
- **THEN** system MUST 通过既有 observability boundary 输出包含 safe event type、outcome、configured auth mode 和可用 safe owner coordinate 的 auth diagnostic
- **AND** diagnostic MUST NOT 包含 raw credential、cookie value、signature material、secret content 或 unauthorized object detail

#### Scenario: Auth 故障不会伪造成业务失败
- **WHEN** local auth 在请求进入 runtime 前拒绝 request
- **THEN** failure MUST 在 Web boundary 表示为 authentication 或 authorization failure
- **AND** failure MUST NOT 创建 RequestRun failure、terminal timeline event、checkpoint、pending input、memory record、artifact 或 learning event

### Requirement: Local auth 验证
本地配置认证 MUST 通过 contract、integration、security 和 architecture test 验证，覆盖 normal path、boundary path 和 failure/degradation path。验证 MUST 覆盖受保护 REST、SSE 和 WebSocket 行为、cookie lifecycle、startup config blocking、safe diagnostic 和 package dependency isolation。

#### Scenario: 正常路径验收
- **WHEN** 存在有效 local auth configuration 且用户使用 configured credential 登录
- **THEN** tests MUST 证明 login 设置 cookie、受保护 REST 成功、SSE/WS 可使用 cookie 认证，并且下游请求处理接收 trusted `IdentityContext`

#### Scenario: 边界路径验收
- **WHEN** cookie TTL 到期、logout 清除 cookie、client payload 尝试覆盖 identity 或 query parameter 携带 long-lived token
- **THEN** tests MUST 证明受保护入口要求 newly valid cookie、trusted identity 不被覆盖，并且 query parameter 不被作为认证依据

#### Scenario: 失败和降级路径验收
- **WHEN** auth config 无效、credential reference 不受支持、cookie signature 无效、service restart、未认证 client 访问受保护 API 或检查 remote/IAM entrypoint
- **THEN** tests MUST 证明 fail-closed 行为、安全诊断、认证前不产生 durable user fact，并且 `agent-channel-web` 或 remote/IAM entrypoint 不依赖 `agent-channel-web-auth-local`
