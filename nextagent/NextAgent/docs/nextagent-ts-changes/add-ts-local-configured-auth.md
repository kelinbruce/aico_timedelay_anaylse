# add-ts-local-configured-auth

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Authentication / Local Auth

状态：ready
类型：实施 change
主要 owner：`agent-channel-web-auth-local`
依赖：`establish-ts-backend-architecture`、`establish-ts-core-contracts`、`add-ts-app-config-schema`、`add-ts-secret-configuration-boundary`

目标：
- 支持首版本地部署模式下的 localhost-only local auth，使本地单实例运行包默认不裸奔，同时避免实现完整用户管理系统。
- 提供本地单用户配置、login/logout endpoint、signed HttpOnly cookie、未认证 challenge、前端登录跳转所需响应，以及 channel/auth boundary 到可信 `IdentityContext` 的注入。
- 保证 local auth 只由 local 产品入口显式 import/register；remote/IAM 产品入口不得 import/register、bundle 或暴露 `agent-channel-web-auth-local`。
- 明确 local auth 通过独立 package 接入，并通过不同产品入口与不同依赖图实现可选化；非 local 产物中不得包含 local auth 路由逻辑、cookie/challenge 处理逻辑或相关产物。

规格输入：
- 本地部署者通过配置文件或环境变量设置单一本地用户身份和 credential source，修改配置后重启生效。
- 用户未认证访问受保护页面或 API 时，系统返回安全认证提示，前端据此跳转登录页。
- 用户使用配置的本地凭证登录后，可在同一浏览器会话内访问系统。
- 登出、服务重启或票据过期后，用户需要重新登录。
- 本地认证范围收紧为 localhost-only local auth；首版不承诺跨机器访问。
- `agent-channel-web-auth-local` 必须作为独立 composition package 提供；`agent-channel-web` 不得依赖它。
- local auth 可选化必须通过 local 与 remote/IAM 不同产品入口和不同依赖图实现，不得通过单一入口中的运行时 `if`、配置探测或目录探测实现。
- non-local 产品构建阶段必须对 local auth route、cookie/challenge 处理逻辑和相关产物执行 tree-shaking 或等价裁剪，确保最终产物中不携带 local auth 能力。
- 后端默认只监听 loopback 地址；如果后续允许非 loopback 暴露，必须通过独立 change 定义反代、TLS、secure cookie 和部署安全要求。
- 正式产品配置中的 credential source 只允许 env/file secret reference；不得支持 raw/direct credential。
- 登录成功后签发 signed HttpOnly cookie；cookie 必须有固定 TTL，服务重启后失效。
- localhost HTTP 可以使用 insecure cookie；非 localhost 或 HTTPS 反代场景不得在本 change 中开放。
- cookie SameSite 使用 Strict，Path 使用 `/`。
- 不得通过 query parameter 传长期认证票据；REST、SSE 和 WebSocket 都必须使用 cookie 或后续独立 change 定义的一次性 handshake token。
- login 失败必须有最小限速或退避；错误信息不得泄露 credential 是否接近、配置来源、内部路径或签名细节。
- 未认证访问受保护 API 时不得创建 session、request run、message、attachment、memory、pending input 或其他用户数据对象。
- IAM/remote 运行形态不得 fallback 到本地配置用户，也不得注册本地 login/logout endpoint。

契约输入：
- `IdentityContext` 继续作为唯一可信身份 contract，由 channel/auth boundary 注入。
- `SafeError`、Web challenge response 和 transport-safe error normalization 继续继承已冻结核心错误契约。
- local auth 配置只消费 `app-config-schema` 与 secret reference change 已冻结的配置和 secret contract。
- `agent-channel-web` 继续作为 Web transport plugin boundary；`agent-channel-web-auth-local` 只在该边界前后提供本地认证 adapter 能力，不定义 request lifecycle 或 durable fact contract。

实现约束：
- 主要写入 owner 保持为 `agent-channel-web-auth-local`；`agent-channel-web` 只提供 transport plugin 接入点，`agent-app` 只负责 local 产品入口中的 composition/register。
- local auth package 必须作为独立 composition package 提供；不得把 local auth route、cookie/challenge 逻辑散落回 `agent-app` 或 `agent-channel-web` 主包。
- local 与 remote/IAM 必须对应不同产品入口和不同依赖图；non-local 产物不得依赖、引用或暴露 local auth package。
- 不得让 local auth 持有 request lifecycle、session/message durable fact、memory、attachment、capability 或 runtime canonical timeline ownership。

非目标：
- 不提供页面修改认证配置。
- 不提供多用户管理、注册、密码修改、credential rotate API、remember-me、refresh token 或服务端认证 session store。
- 不支持 LAN/公网直接暴露本地认证模式。
- 不定义 IAM 登录流程。

验收要点：
- 未认证访问受保护 Web API 返回认证 challenge，响应不泄露敏感信息，且不产生任何用户数据。
- 登录成功后返回当前用户安全身份摘要，并设置 HttpOnly signed cookie。
- 票据过期、签名无效、服务重启后旧票据失效时，受保护 API 返回未认证 challenge。
- 登出清除本地认证 cookie。
- `agent-channel-web` 不依赖 `agent-channel-web-auth-local`；local 产品入口显式组装 auth-local；remote/IAM 产品入口不打包该包。
- non-local 产物中不存在 local auth route、cookie/challenge 处理逻辑或相关产物引用。

并行边界：
- 本 change 只实现本地认证入口、认证票据和身份注入，不修改 runtime、session、core、context、capability 或 gateway durable fact 的业务语义。
- 配置 schema 与 secret reference 规则来自 Runtime Configuration 能力组；本 change 只消费认证相关配置。
- `agent-channel-web` 的 SSE/WS transport plugin 化继续由 `add-ts-web-sse-ws-transports` 承载；本 change 不重定义 Web transport 主插件 contract。

后续维护：
- 如果未来需要 LAN/公网访问、本地多用户、credential rotate 或 IAM 登录，需要单独提出 change，不能扩大本 change 的安全范围。
