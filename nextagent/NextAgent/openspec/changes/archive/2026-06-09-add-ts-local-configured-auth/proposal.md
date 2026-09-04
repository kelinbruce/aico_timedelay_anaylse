## 背景与问题（Why）

首版本地 TS 后端需要给本机浏览器提供可运行的 Web API、SSE 和 WebSocket 入口。没有认证边界时，本地运行包即使只服务电信网络智能体的调试、诊断和能力治理任务，也会把 request submit、history、attachment、runtime stream 等高价值入口暴露给任意本机进程或误配代理。

本 change 处理的是首版本地单实例的最小安全闭环：用配置声明一个本地用户和凭据来源，在 Web channel/auth boundary 完成登录、登出、认证 challenge、signed HttpOnly cookie 校验，并把可信 `IdentityContext` 注入受保护流程。它不把本地部署扩展成 LAN/公网认证方案，也不实现完整用户管理或 IAM 登录。

## 变更范围（What Changes）

- 新增 localhost-only local configured authentication 行为契约：本地产品入口显式组装 `agent-channel-web-auth-local` 后，受保护 Web 页面、REST API、SSE 和 WebSocket 必须先通过本地认证。
- 新增本地单用户配置消费规则：local auth 只消费已冻结的 app config 和 `agent-app` 提供的 secret validation result，credential source 只能来自 `env:` 或 `file:` secret reference。
- 新增 login/logout/challenge 行为：登录成功签发 signed HttpOnly cookie，登出清除 cookie，未认证访问返回前端可识别的认证 challenge。
- 新增 cookie 票据约束：固定 TTL、`HttpOnly`、`SameSite=Strict`、`Path=/`、服务重启后失效；localhost HTTP 允许 insecure cookie，非 localhost 或 HTTPS 反代不在本 change 开放。
- 新增可信身份注入边界：受保护请求只从已校验 cookie 和冻结配置得到 `IdentityContext`，请求体、query、capability 参数、模型输出或客户端 metadata 不得覆盖身份。
- 新增产品装配边界：`agent-channel-web` 不依赖 `agent-channel-web-auth-local`；local 产品入口通过 dedicated local product manifest 显式组装本地认证包；remote/IAM 产品入口不得组装、打包或暴露本地认证能力和 login/logout 行为。
- 新增 Fastify 插件装配边界：`agent-channel-web-auth-local` 必须以 Fastify 插件/插件工厂形式注册 login/logout、challenge 和认证 hook；local 产品入口必须把该插件装配在受保护 Web/API/SSE/WS 路由所在的同一 Fastify 作用域内。

BREAKING：无。当前 OpenSpec 基线尚未定义稳定 local auth 行为。

## 与当前基线和相邻 change 的边界

- 继承 `ts-core-contracts` 已冻结的 `IdentityContext`、`SecretReference`、`SafeError`、owner scope 和 safe diagnostic 基线，不新增 `agent-contracts/*` owning subpath。
- 继承 `ts-backend-architecture` 对 `agent-channel-web-auth-local` 的 adapter 边界和 localhost-only local auth 预留职责；本 change 只把预留边界细化为可实施行为。
- 继承 `ts-minimal-agent-kernel` 的 `agent-app` 配置/secret 读取 ownership；本 change 只消费 app composition 提供的冻结配置和 secret validation result，不让 auth-local 读取 raw env/file。
- 不定义 remote/IAM 登录、配置热更新、服务端认证 session store、LAN/公网部署、observability sink contract 或 runtime lifecycle 行为。

## Capability 影响（Capabilities）

### 新增 Capability

- `ts-local-configured-auth`: 定义 localhost-only local auth 的配置、登录/登出、cookie、认证 challenge、可信 `IdentityContext` 注入、受保护流程拦截、失败降级和产品装配隔离契约。

### 修改的 Capability

无。

## 影响范围（Impact）

- 模块边界：主要影响 `agent-channel-web-auth-local`、`agent-channel-web` auth boundary、`agent-app` local 产品入口装配，以及配置/secret validation result 的消费路径。
- API/事件：新增本地 login/logout 行为和未认证 challenge 响应形态；REST、SSE、WebSocket 受保护入口必须使用同一认证结果。
- 配置：新增本地单用户身份、credential reference、cookie TTL 等 local auth 配置；配置修改重启生效，不提供运行时热更新。
- 安全：禁止 raw credential、query parameter 长期票据、服务端认证 session store、remember-me、refresh token、LAN/公网直接暴露和 IAM fallback。
- 验证：需要覆盖登录成功、登出、过期、签名无效、服务重启失效、未认证不产生用户数据、SSE/WS cookie 认证、remote/IAM 不组装本地认证包和安全诊断脱敏。
- 运维：允许记录安全 auth 日志、audit 和 metric；不得记录 raw credential、cookie value、签名材料、secret source 内容、未脱敏路径或内部异常体。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-local-configured-auth/spec.md`：新增 localhost-only local auth 的稳定行为契约。

长期背景：
- `openspec/overview.md`：记录首版本地运行包默认需要本地认证保护的目标；不记录实现过程。

设计视图：
- `openspec/designs/architecture/authentication-boundary.md`：新增本地认证与 remote/IAM 认证的产品装配边界、身份来源和受保护流程接入。
- `openspec/designs/architecture/local-auth-session.md`：记录本地 cookie 票据语义、生命周期和失效规则；不新增跨模块 public DTO。
- `openspec/designs/architecture/web-auth-local.md`：记录 login/logout/challenge、SSE/WS cookie 认证和 safe failure 可观察行为；不新增 `agent-contracts` owning subpath。
- `openspec/designs/modules/agent-channel-web-auth-local.md`：从占位职责提升为本地认证 adapter 职责、非职责和依赖边界，不规定具体代码组织。
- `openspec/designs/modules/agent-channel-web.md`：记录 Web channel 只消费 auth boundary 的 trusted identity，不依赖 auth-local 包。
- `openspec/designs/modules/agent-app.md`：记录 local 产品入口显式组装 auth-local，remote/IAM 产品入口禁止组装。
- `openspec/designs/adr/<next-id>-localhost-only-local-auth.md`：如实现中出现 LAN/公网或服务端 session store 替代方案争议，再使用归档时下一个可用编号记录 localhost-only、signed stateless cookie 的长期取舍。
- `openspec/designs/spec-to-design-map.md`：新增 `ts-local-configured-auth` 到 auth architecture、web auth contract 和 module docs 的导航。

验证入口：
- local auth contract verification、Web channel integration verification、SSE/WS authentication verification、safe diagnostics verification、architecture boundary verification、OpenSpec strict validate。
