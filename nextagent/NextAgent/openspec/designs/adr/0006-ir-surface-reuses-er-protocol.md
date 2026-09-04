# ADR 0006: IR Surface 复用 ER 协议与 createTaskIdentityResolver

## 状态

Accepted

## 背景

NextAgent web-channel 原本只对外暴露 ER（人机交互）surface：浏览器前端通过 cookie 认证访问 `/api/v1/...` 端点，协议是 session 会话粒度的同步/流式交互。`registerWebChannel(instance, dependencies)` 中所有路由路径硬编码为 `/api/v1/...` 绝对路径，路由层是 identity-agnostic 的：每条路由通过注入的 `identityResolver: IdentityResolver` 取 `IdentityContext`，不关心身份来自 cookie 还是 header。

外部系统（编排系统、网管平台、上游业务系统）需要以程序化方式在 session 粒度直接驱动 NextAgent 会话，与 ER 协议对等，但认证方式不同（trusted header 而非 cookie）。`createTaskIdentityResolver` 已在 task-channel 中从 `x-tenant-id`/`x-subject-id`/`x-display-name` 请求头构造 `IdentityContext`，以 trusted-header 模式运行，但 task-channel 面向 task 粒度的批量异步回调模型，不是 session 会话粒度的同步/流式交互。

需要决定 IR（机机交互）surface 如何在 web-channel 中落地，而不引入契约漂移、平行实现或认证交叉。

## 决策

IR surface 复用 ER 的 `registerWebChannel` + `createTaskIdentityResolver`，而非新建独立 IR auth 包或复制 6 条路由独立维护。

具体形态：

- `registerWebChannel` 新增 `routePrefix?: string`（默认 `/api/v1`）和 `routeWhitelist?: ReadonlySet<string>` 两个参数。每条路由路径从硬编码绝对路径改为 `` `${routePrefix}/...` `` 模板化，memory 路由已有此模式先例。`routeWhitelist` 提供时只注册白名单内路由，未提供时注册全部（ER 行为）。
- composition 层双注册同一个 `registerWebChannel`：ER 走现有路径（cookie auth + `/api/v1` + 全量路由），IR 走新路径（`createTaskIdentityResolver` 作为 `identityResolver` + `/api/v1/ir` + 6 端点白名单）。IR 注册在 ER 之后、受保护路由 scope 内完成。
- IR 6 端点：`POST /api/v1/ir/sessions`、`POST /api/v1/ir/sessions/:sessionId/requests`、`GET /api/v1/ir/sessions/:sessionId/stream`、`POST /api/v1/ir/sessions/:sessionId/cancel`、`POST /api/v1/ir/sessions/:sessionId/retry`、`POST /api/v1/ir/sessions/:sessionId/pending-inputs/:pendingInputId/answer`。协议、DTO、schema 和 stream 行为与 ER 对应端点完全一致。
- 认证隔离：IR 路由只读 `x-tenant-id`/`x-subject-id`/`x-display-name` header，不挂 cookie auth plugin；ER 路由只认 cookie。Agent Scope 不从 header 取，仍来自 `requireSession` 返回的持久化 `session.agentId`。
- IR 不注册 WS 端点、不加载 multipart 插件。`registerWebChannel` 内部 `instance.register(fastifyMultipart)` 和 `registerWebSocketStream(...)` 等非路由副作用调用也受白名单门控：白名单不含对应路径时跳过。
- 不新增 port/DTO/Record/契约语义；所有状态由 runtime 经现有 `RuntimeCommandPort`/`RuntimeSessionPort` 拥有。

## 被拒绝的方案

- **(a) Fastify encapsulation scope 隔离 IR 路由**：放弃。现有路由用绝对路径注册，改为 scope 需要重构所有路由注册方式，改动面过大，且 ER 行为零回归是硬约束。
- **(b) 复制 6 条路由到独立 IR 注册函数**：放弃。违反同形同策原则，产生平行实现：ER 与 IR 的路由注册、schema、stream projection、safe error 映射会出现独立维护点，契约漂移风险高，后续 ER 协议演进时 IR 易被遗漏。
- **(c) 新建独立 IR auth 包（例如 `agent-channel-web-auth-ir`）**：放弃。`createTaskIdentityResolver` 已满足 trusted-header 身份解析需求，新建 auth 包只是把已有能力换个 owner，不增加安全或隔离价值，反而扩大 composition surface。

## 胜出原因

- **复用避免契约漂移**：ER 与 IR 共享同一 `registerWebChannel`、同一 TypeBox schema、同一 stream projector 和同一 runtime port 委托路径。ER 协议演进时 IR 自动继承，不存在“ER 改了 IR 没改”的平行维护缺口。
- **routePrefix 参数化保持 ER 行为零回归**：`routePrefix` 默认值 `/api/v1` 使 ER 注册路径与改造前逐字一致；`routeWhitelist` 缺省注册全部，ER 不传白名单即保持全量路由。参数化是 additive 扩展，不改变 ER 既有语义。
- **认证隔离由 composition 层 deps 注入实现**：`identityResolver` 是 `registerWebChannel` 已有的依赖注入点，IR 复用 `createTaskIdentityResolver`、ER 复用 cookie auth resolver，两者在 composition 层分别注入互不感知，不需要新机制。
- **Agent Scope 仍由 session-bound 事实决定**：IR 不从 header 取 `agentId`，`requireSession` 返回的持久化 `session.agentId` 是唯一 Agent Scope 来源，与双层身份隔离不变量一致。

## 后果

- IR surface 的可观察行为与 ER 对应端点逐字一致，区别仅在身份来源（header vs cookie）和 URL 前缀（`/api/v1/ir` vs `/api/v1`）。
- 后续若 IR 需要新增端点（如附件上传、WS、conversation 读取），必须先扩展 `routeWhitelist` 并确认该端点是否应进入 IR surface 的受控白名单，不得静默放开全量路由。
- 后续若出现第三种 surface（例如非 trusted-header 的机机认证），应复用同一 `registerWebChannel` + `routePrefix` + `routeWhitelist` 参数化模式，而非新建平行注册函数；认证隔离仍由 composition 层 `identityResolver` 注入实现。
- `createTaskIdentityResolver` 的 trusted-header 契约（上游网关注入、NextAgent 只读不校验凭证、缺 `x-tenant-id`/`x-subject-id` 抛 `LOCAL_AUTH_REQUIRED`）成为 IR 与 task-channel 共享的身份解析稳定点，后续修改必须同时评估两个消费者。

## 验证

- IR 6 端点的 schema、DTO、stream envelope 和 safe error shape 与 ER 对应端点逐字一致的 contract tests。
- 缺 `x-tenant-id`/`x-subject-id` → safe 401 零 side effect；body 含 owner/agent scope 字段 → 400 或忽略；跨 owner/agent scope session → safe 404 不泄露存在性。
- cookie-only 请求到 IR → 401；header-only 请求到 ER → 401。
- ER 行为零回归：ER 全量路由注册、cookie auth、WS 端点和 multipart 插件在 IR 引入后保持不变。
- IR 不注册 WS 端点、不加载 multipart 插件的 negative architecture case。
- `npm run lint:architecture`、`openspec validate --all --strict`。
