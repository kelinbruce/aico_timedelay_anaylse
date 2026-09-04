# agent-channel-web-auth-local

## 职责

承载 localhost-only local configured authentication 的 Web auth adapter boundary、Web auth plugin/factory、configured credential validation、signed HttpOnly cookie、logout、auth challenge projection、SSE/WebSocket cookie auth 和 safe diagnostics。

## 非职责

不定义 public gateway auth contract、IAM/remote auth、server-side auth session store，也不访问 request lifecycle、session/message、memory、attachment、RequestRun 或 capability durable facts。不得让客户端请求体、query parameter、模型输出或 capability 参数覆盖 owner identity、agent scope 或 credential source。

## 依赖

只依赖 adapter-local Web framework types。不得依赖 `agent-contracts` 或任何 `agent-contracts/*` subpath，不得依赖 `agent-channel-web`、runtime、session、core、context、capability、attachment runtime、memory 或 app composition。

## 核心设计落点

- 落实 `architecture/owner-scope-security.md` 的 local configured authentication boundary：identity 解析属于 channel/auth boundary，但本 package 不访问业务 facts。
- 落实 `architecture/configuration-boundary.md` 的 local product branch 装配规则：只消费 `agent-app` 基于 frozen config 和 secret validation 传入的窄运行视图，不读取 raw env/file、源配置或 Agent package 配置。
- Local auth 只服务 localhost-only local deployment；远程 IAM、OAuth、SSO、多租户 admin 和非 localhost 暴露不在本基线定义。
- 登录凭据来自冻结配置，可通过环境变量、配置文件或 SecretReference 装配；配置缺失、弱配置或 secret 不可解析时 fail closed。
- Cookie 由进程内 app secret 签发，必须 HttpOnly、SameSite=Strict、Path=/、短 TTL；服务重启或 secret 变更后旧 cookie 必须失效。
- REST、SSE 和 WebSocket 使用同一 cookie auth 结果；禁止通过 query parameter 或长寿命 token 认证 stream。
- 认证失败、配置错误和 token 错误只暴露 safe diagnostic code；不得记录或返回 password、secret、cookie、raw token、credential 文件路径、raw exception 或未授权对象内容。
- 认证失败不得进入 runtime/session/attachment/capability 主流程，不产生 session、RequestRun、message、attachment、memory、pending input、checkpoint 或 capability invocation。
- 通过 `agent-app` 的显式 local product entry 装配，不成为 `agent-channel-web` 的默认依赖。

## 替换边界

是。Local Web auth adapter 可整包替换。

## 验证关注点

- 只在 localhost-only local configured authentication 产品入口中显式 import。
- remote/IAM 产品入口不得 import、register、bundle 或暴露本 package。
- login/logout、signed HttpOnly cookie、fixed TTL、restart invalidation、challenge 和 trusted identity 注入只属于 auth-local adapter boundary，不形成新的 `agent-contracts` public subpath。
- login/logout/challenge/cookie behavior 必须有 contract 测试覆盖。
- REST/SSE/WebSocket 必须共享 cookie auth，且 query token 必须被拒绝。
- cookie value、raw credential、signing key、secret file content、raw exception 和未授权对象内容不得进入日志、audit、metric、trace、safe error 或 stream。
- Negative 测试覆盖非 localhost、缺失 secret、弱配置、service restart 后旧 cookie 和敏感信息泄漏日志。

## Public Exports

`@nextagent/agent-channel-web-auth-local`
