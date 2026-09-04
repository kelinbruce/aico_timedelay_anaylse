# 本地认证会话

## 目的

本设计承载 local configured authentication cookie 和 challenge 的稳定生命周期语义。它不是 server-side user session model，也不新增跨模块 public DTO。

local auth session 是 localhost-only local product 中面向浏览器的 process-bound authentication projection。runtime session、request run、message history、memory、attachment 和 capability fact 仍由既有模块拥有。

## 决策

### D1. Cookie 是进程绑定的认证投影

local login 成功后签发 signed HttpOnly cookie。cookie 只表示浏览器在当前 process lifetime 和 TTL 内以 configured local identity 通过认证；它不是 durable server-side auth session，也不是 runtime session。

cookie 必须在 TTL expiration、logout、signature failure、tampering、configured identity mismatch、signing context change 或 service restart 后失效。

### D2. Cookie Scope 只限 Localhost

local configured auth 只服务 localhost local product entrypoint。当前基线不定义 LAN/public exposure、HTTPS reverse proxy requirement、secure-cookie deployment policy、remember-me、refresh token、credential rotation API、multi-user account management 或 server-side auth session storage。

localhost HTTP 场景不要求 Secure cookie。stream endpoint 不接受 query token、URL ticket、long-lived bearer token 或 query parameter credential 作为认证依据。

### D3. Logout 只清除认证投影

logout 清除 local auth cookie 并记录 safe auth diagnostics。logout 不得删除 runtime session、history、message、attachment、memory、workspace、package data 或 local gateway fact。

### D4. Challenge 安全且非业务事实

未认证 protected request 返回 safe challenge 或 safe stream close reason。challenge 必须足以支持 frontend routing/login 行为，但不得暴露 credential state、cookie value、signing key、raw secret reference、secret file path、stack、user data、prompt/model output 或 unauthorized object content。

### D5. Auth Cookie 不是幂等或 owner 锚点

cookie 只证明浏览器 request 的 local authentication。它不得替代 request idempotency key、session id、request id、run id、owner-scope check 或 gateway idempotency anchor。

## 验证关注点

- login success cookie tests。
- TTL/restart/logout invalidation tests。
- tampered cookie safe failure tests。
- unauthenticated challenge tests。
- no-side-effect negative tests。
- query token/URL ticket 拒绝测试。
- cookie value、signing key、raw credential 和 path 泄漏测试。
- `openspec validate --all --strict`。

## 关联设计

- `openspec/designs/architecture/authentication-boundary.md`
- `openspec/designs/architecture/web-auth-local.md`
- `openspec/designs/architecture/owner-scope-security.md`
