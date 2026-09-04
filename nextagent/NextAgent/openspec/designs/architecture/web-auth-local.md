# Web 本地认证

## 目的

本设计承载 localhost-only local configured authentication 的 Web 可观察行为：login、logout、unauthenticated challenge、protected REST/API/SSE/WS handling、trusted identity injection 和 safe failure behavior。

它不创建 `agent-contracts` auth subpath。稳定行为由 `openspec/specs/ts-local-configured-auth/spec.md` 定义，implementation 保持在 `agent-channel-web-auth-local`、`agent-app` local product composition 和 Web auth boundary 内。

## 决策

### D1. Auth-Local 以 Plugin 注册 Web 认证行为

`agent-channel-web-auth-local` 提供 Fastify plugin 或 plugin factory，用于 local login/logout、challenge 和 auth hooks。local product entrypoint 在 app config freeze 后、对外 serving 前，把该 plugin 注册到 protected Web/API/SSE/WS routes 所在 Fastify scope。

generic app composition 和 remote/IAM product entrypoint 不得注册这些 routes 或 hooks。

### D2. Route Classification 先于业务 Owner

auth boundary 在受保护业务流程前完成 route classification：

- login shell、login/logout endpoint、health 和必要 static asset 可以按 local product policy 公开。
- protected SPA route 可以返回 challenge/login routing response。
- `/api/**`、SSE 和 WebSocket routes 必须在 request acceptance、stream subscription、attachment intake、history read、runtime command dispatch 或 capability invocation 前完成认证。

frontend fallback 不得在 auth classification 前吞掉 protected API/SSE/WS/control routes。

### D3. Login 产出安全认证结果

login 校验 request shape，通过 app-composed secret/resolver path 验证 configured credential，应用必要 local backoff/rate-limit behavior，并在成功后签发 signed HttpOnly cookie。login failure 返回 safe auth failure，不得暴露 credential source、credential value、secret path、signing material 是否存在或验证细节。

### D4. Protected Request 注入 Trusted Identity

有效 cookie 从 frozen local auth runtime view 生成 trusted `IdentityContext`。Web boundary 忽略 body、query、header、client metadata、model output 和 capability args 中的 identity 或 owner 字段。

### D5. SSE 和 WebSocket Auth Fail Closed

SSE 和 WebSocket connection 必须先认证再订阅。missing、expired、invalid 或 tampered cookie 只能产生 safe close reason 或 challenge response，不得订阅 runtime stream、replay event、emit terminal event 或暴露 history。

query token 或 URL ticket 不得作为 stream cookie auth 的降级替代。

### D6. Auth Failure 无 Durable User Side Effect

unauthenticated 或 failed-auth request 不得创建或修改 session、RequestRun、message、attachment、artifact、memory、pending input、checkpoint、timeline、包含 unsafe data 的 audit fact 或 capability invocation fact。

safe log、metric 和 audit event 可以记录 coarse auth diagnostics，但不得包含 cookie value、credential、secret ref、path、stack trace、prompt/model output 或 unauthorized object content。

## 验证关注点

- login/logout behavior tests。
- challenge response tests。
- route classification and precedence tests。
- protected REST/API auth tests。
- SSE/WS auth tests。
- trusted identity injection tests。
- no-side-effect negative tests。
- safe diagnostic and redaction tests。
- `agent-channel-web` 不依赖 `agent-channel-web-auth-local` 的 architecture dependency tests。
- `openspec validate --all --strict`。

## 关联设计

- `openspec/designs/architecture/authentication-boundary.md`
- `openspec/designs/architecture/local-auth-session.md`
- `openspec/designs/modules/agent-channel-web-auth-local.md`
- `openspec/designs/modules/agent-channel-web.md`
- `openspec/designs/modules/agent-app.md`
