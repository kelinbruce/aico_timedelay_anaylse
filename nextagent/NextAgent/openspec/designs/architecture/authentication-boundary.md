# 认证边界

## 目的

本设计承载 local、remote 和 IAM 产品装配的稳定认证边界。它定义可信 identity 在 Web/request 路径中的进入位置，并确保 runtime、core、session、gateway、capability、context 和 observability 不从客户端请求体、模型输出或 capability 参数重新解释身份。

`ts-local-configured-auth` 是第一个具体 local auth 行为，它细化后端架构基线预留的 `agent-channel-web-auth-local` 可选包边界。

## 决策

### D1. 认证先于业务主流程

认证必须在受保护 Web/API/SSE/WS request 进入 runtime、session、attachment、memory、capability 或 gateway owner 之前完成。认证失败不得创建 session fact、RequestRun、message、attachment、artifact、memory record、pending input、checkpoint、timeline event 或 capability invocation。

### D2. Local Auth 只由显式产品装配启用

local configured auth 只能用于 localhost-only local product entrypoint。`agent-app` 在 app configuration freeze 和 secret validation 完成后装配 `agent-channel-web-auth-local`。generic app composition、backend-only、with-frontend、remote 和 IAM entrypoint 不得 import、register、bundle 或暴露 local login/logout 行为，除非 dedicated local configured auth product manifest 显式选择它。

### D3. Web Channel 只消费可信身份

`agent-channel-web` 负责 transport 和 projection。它不依赖 `agent-channel-web-auth-local`，不拥有 local credential validation、cookie signing 或 auth session lifecycle。它只消费 auth boundary 提供的 trusted identity，并把该 identity 传给 downstream owner。

request body、query、header、client metadata、model output 和 capability args 不得覆盖 trusted tenant、subject、owner、display name 或 auth state。

### D4. Remote/IAM 是独立后续分支

remote/IAM authentication 必须由后续 OpenSpec change 定义。local configured auth 不得为 remote/IAM product 提供 fallback，不得引入 public gateway auth contract、IAM DTO、remote auth session 或 generic auth provider registry。

### D5. Bootstrap 只投影可信认证和传输事实

runtime bootstrap 可以投影 auth challenge、当前认证状态摘要和可信 channel/app config 得到的 transport fact，例如 `transportKind`。bootstrap 不得泄漏 credential、cookie、token、raw auth error、secret reference 内容或 credential 文件路径。

## 所有权

- `agent-app`：选择 local product branch，消费 frozen config 和 safe secret validation result，在受保护 route 对外服务前装配 auth-local plugin。
- `agent-channel-web-auth-local`：实现 localhost-only login/logout/auth boundary 行为。
- `agent-channel-web`：保持 auth-local independent，只消费 trusted identity 并执行 transport/projection。
- `agent-runtime` 和 downstream owner：通过既有 request/context contract 接收 trusted identity，不认证 Web request。

## 验证关注点

- local product entrypoint integration tests。
- remote/IAM negative architecture tests。
- product manifest dependency tests。
- protected route no-side-effect tests。
- `agent-channel-web` dependency boundary tests。
- owner/agent 请求体覆盖、query token、非 localhost、敏感信息日志泄漏 negative tests。
- `openspec validate --all --strict`。

## 关联设计

- `openspec/designs/architecture/web-auth-local.md`
- `openspec/designs/architecture/local-auth-session.md`
- `openspec/designs/architecture/owner-scope-security.md`
- `openspec/designs/modules/agent-channel-web-auth-local.md`
- `openspec/designs/modules/agent-channel-web.md`
- `openspec/designs/modules/agent-app.md`
