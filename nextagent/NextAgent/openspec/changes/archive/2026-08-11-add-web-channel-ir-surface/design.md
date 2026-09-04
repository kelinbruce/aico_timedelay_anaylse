## 设计目标与黑盒效果（Design Goals And Black-Box Effects）

### 触发机制

IR surface 由外部系统 HTTP 请求触发。请求到达 `/api/v1/ir/**` 路径时，Fastify route 匹配命中 IR 路由，在 channel boundary 同步解析身份、校验 schema，然后委托 runtime port。create/cancel/retry/answer 是同步请求-响应；SSE stream 是长连接异步流。与 ER 触发方式完全一致，区别仅在身份来源和 URL。

### 输入与前置条件

- 上游网关已完成认证并注入 `x-tenant-id`、`x-subject-id`、`x-display-name` 请求头。
- `x-tenant-id` 和 `x-subject-id` 必须存在；`x-display-name` 可选。
- 请求 body schema 与 ER 对应端点完全一致（同一 TypeBox schema）。
- session-scoped 端点（requests/cancel/retry/stream/answer）需要已存在的、属于当前 owner+agent scope 的 session。
- IR 不要求 cookie，不依赖 `agent-channel-web-auth-local`。

### 输出与副作用

IR surface 不产生任何新的持久化状态、artifact、ref、checkpoint、pending input、memory record 或 learning event。所有状态由 runtime 拥有，经现有 RuntimeCommandPort / RuntimeSessionPort 产生，与 ER 完全一致。

IR 的可观察输出：
- create session → `{ sessionId, ... }`（与 ER 同 DTO）
- submit request → accepted response（与 ER 同 DTO）
- SSE stream → canonical StreamEnvelope（与 ER 同 envelope）
- cancel/retry → unified control response（与 ER 同 DTO）
- pending-input answer → unified control response（与 ER 同 DTO）
- 失败 → SafeError（与 ER 同 safe error shape）

日志、metric、trace、audit 事实与 ER 走相同 runtime 路径产生相同审计事实；身份头值不出现在日志/metric/trace/audit 中。

### 核心判断逻辑（规则顺序）

1. 请求到达 `/api/v1/ir/**` → route classification 判定为 IR surface（不挂 cookie auth plugin）。
2. `identityResolver(request)` 读 `x-tenant-id` / `x-subject-id` / `x-display-name`。
3. 缺 `x-tenant-id` 或 `x-subject-id` → 抛 `LOCAL_AUTH_REQUIRED` → safe 401，零 side effect，终止。
4. 构造 `IdentityContext`（owner scope）。agent scope 不从 header 取。
5. body schema validation（与 ER 同一 schema）→ 拒绝 body 里的 owner/agent scope 字段。
6. session-scoped 端点 → `requireSession` → 校验 owner scope → 返回 `session.agentId`（session-bound agent scope）。
7. 跨 owner/agent scope → safe not-found，不泄露存在性，终止。
8. 委托 RuntimeCommandPort（submit/cancel/retry/edit/answer）或 RuntimeSessionPort（stream），与 ER 完全相同。
9. SSE → `RuntimeSessionPort.streamEvents` → canonical stream envelope → terminal。支持 `lastSeenSequence` replay。
10. 失败 → SafeError，不含 prompt/模型输出/凭证/token/raw file content/身份头值。

### 流程接入

上游：外部系统 → 上游网关（认证 + 注入身份头）→ NextAgent IR surface（`/api/v1/ir/**`）。
IR surface → `RuntimeCommandPort` / `RuntimeSessionPort`（与 ER 同一入口）。
下游：runtime lifecycle → canonical timeline → terminal commit（完全由 runtime 拥有）。
IR 不接入新流程，不改变现有流程的 ownership。

### 失败与降级

- 缺身份头 → safe 401，零 side effect。不静默放行。
- body schema 验证失败 → 400，零 side effect。不静默截断。
- 跨 owner/agent scope → safe not-found。不泄露存在性。
- SSE 连接断开 → 调用方用 `lastSeenSequence` 重连 replay。不静默丢弃事件。
- runtime 不可用 → 与 ER 相同的 safe error 传播。不静默吞错。
- 上游网关未注入头 → 等同缺头，safe 401。不静默降级为匿名。

### 验收样例

- 正常路径：带头调 `POST /api/v1/ir/sessions` → 200 + sessionId；调 `POST /api/v1/ir/sessions/:id/requests` → accepted；消费 SSE → 收到 stream envelope 到 terminal。
- 边界路径：缺 `x-tenant-id` → 401 零 side effect；body 含 `tenantId` → 400 或忽略；跨 scope session → safe 404；SSE `lastSeenSequence` replay → 正确续播。
- 失败/降级路径：cookie-only 请求到 IR → 401；runtime 不可用 → safe error 传播；上游网关未注入头 → 401。

## 背景和现状（Context）

web-channel 当前只对外暴露 ER（人机交互）surface：浏览器前端通过 cookie 认证访问 `/api/v1/...` 端点，协议是 session 会话粒度。所有路由注册在 `registerWebChannel(instance, dependencies)` 中，路径硬编码为 `/api/v1/...` 绝对路径。路由层是 identity-agnostic 的：每条路由通过注入的 `identityResolver: IdentityResolver` 取 `IdentityContext`，不关心身份来自 cookie 还是 header。

task-channel 已有机机对接能力：`createTaskIdentityResolver` 从 `x-tenant-id`/`x-subject-id`/`x-display-name` 请求头构造 `IdentityContext`，以 trusted-header 模式运行（上游网关注入，NextAgent 只读不校验）。但 task-channel 面向 task 粒度的批量异步回调模型，不是 session 会话粒度的同步/流式交互。

外部系统（编排系统、网管平台、上游业务系统）需要以程序化方式在 session 粒度直接驱动 NextAgent 会话，与 ER 协议对等，但认证方式不同（header 而非 cookie）。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 在 web-channel 中新增 IR surface，镜像 ER 的 6 个核心端点（创建会话、创建请求、SSE、停止、重试、追加 input），协议、DTO、schema、stream 行为逐字一致。
- 通过 trusted-header 模式（复用 `createTaskIdentityResolver`）实现 IR 身份解析。
- ER/IR 认证隔离：cookie 和 header 各走各的 auth gate，互不交叉。
- ER 行为零回归。

**非目标：**

- 不改 runtime/port/DTO/契约语义。
- 不新增端点语义（IR 每个端点与 ER 对应端点行为完全一致）。
- 不碰 task-channel。
- 不实现 IR 专属的 WS 端点（IR 只提供 SSE 流式消费；WS 是 ER 的等价 transport，机机调用方用 SSE 足够）。
- 不实现 IR callback/通知回推（session 粒度的同步/流式交互不需要回调）。
- 不新增独立 auth 包（复用 `createTaskIdentityResolver`，不创建 `agent-channel-web-auth-ir`）。
- 不提供附件上传端点（IR 当前 scope 只含 6 个端点；IR 调用方可用 `inputText` 无附件提交，附件支持为后续扩展）。

## 设计决策（Decisions）

### D1. routePrefix 参数化 + 路由白名单

`registerWebChannel` 接受 `routePrefix: string`（默认 `/api/v1`）和可选 `routeWhitelist?: ReadonlySet<string>` 参数。每条路由路径从硬编码 `"/api/v1/sessions/..."` 改为 `` `${routePrefix}/sessions/...` ``。memory 路由已是此模式（`const BASE = "/api/v1/memory/..."`），有先例。

当 `routeWhitelist` 提供时，只注册白名单内的路由；未提供时注册全部（ER 行为）。IR 注册时传入 6 个端点的白名单。

备选方案（a）用 Fastify encapsulation/prefix scope——放弃，因为现有路由用绝对路径注册，改为 scope 需要重构所有路由注册方式，改动面过大。（b）复制 6 条路由到独立 IR 注册函数——放弃，违反同形同策，产生平行实现。

### D2. 复用 createTaskIdentityResolver

IR 的 `identityResolver` 直接复用 `channel-composition.ts` 中已有的 `createTaskIdentityResolver(defaultIdentity)`。该函数从 `x-tenant-id`/`x-subject-id`/`x-display-name` 取头，缺 tenant/subject 时抛 `LOCAL_AUTH_REQUIRED`，`x-display-name` 缺省回退 `defaultIdentity.displayName`。

这与 task-channel 完全一致，满足"header 与 task-channel 保持一致"的要求和同形同策原则。不新建 `createIrIdentityResolver`。

### D3. composition 层双注册

在 `channel-composition` 中，ER 走现有注册路径（cookie auth + `/api/v1` prefix + 全量路由），IR 走新注册路径（`createTaskIdentityResolver` + `/api/v1/ir` prefix + 6 端点白名单）。两者调用同一个 `registerWebChannel`，只是 deps 不同。

IR 注册需要在 ER 注册之后、受保护路由 scope 内完成。route classification 时 `/api/v1/ir/**` 走 header gate，其余 `/api/v1/**` 走 cookie gate。

### D3a. 非路由注册的副作用调用也必须被白名单覆盖

`registerWebChannel` 内部有两个不通过 `instance.get/post` 注册的副作用调用：`instance.register(fastifyMultipart)`（multipart 插件）和 `registerWebSocketStream(instance, ...)`（WS stream 端点）。当 `routeWhitelist` 提供时，这两个调用 MUST NOT 执行。具体方式：在调用前检查白名单是否包含对应路径（WS stream 路径和 multipart 上传路径），若不包含则跳过。IR 白名单不含这两个路径，因此 IR surface 不注册 WS 端点也不加载 multipart 插件。

### D4. 认证隔离

IR 路由的 `identityResolver` 是 `createTaskIdentityResolver`，它只读 header。ER 路由的 `identityResolver` 来自 `auth-local`（cookie）。两条路径在 composition 层分别注入，互不感知。

Fastify 的 route registration 是按路径精确匹配的：`/api/v1/ir/sessions` 和 `/api/v1/sessions` 是不同路由。IR 路由注册时不挂 cookie auth plugin，ER 路由注册时不挂 header resolver。缺凭证时各自在 resolver 层抛错，统一映射为 safe 401。

### D5. SSE 的 header 传递

IR 只提供 SSE（`GET /api/v1/ir/sessions/:sessionId/stream`）。机机调用方用 fetch/undici 消费 SSE，可以带任意 header，不存在 EventSource 无法带自定义头的问题。

SSE 路由内部逻辑与 ER 完全一致：`requireSession` 取 `session.agentId`（session-bound agent scope），`lastSeenSequence` replay，`guardrail` forward relay（若 binding 存在）。唯一差异是 URL prefix 和 identity 来源。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | IR trusted-header 模式：上游网关注入身份头，NextAgent 只读不校验凭证；body 里的 owner/agent 字段被 schema 拒绝；ER/IR 认证隔离不交叉；agent scope 从持久化 session 取，不从 header 取；跨 scope safe not-found；safe error 不含 prompt/输出/凭证 | contract 测试：缺头 401、body 注入 scope 拒绝、ER/IR 交叉拒绝、跨 scope 隐藏 |
| 性能/容量 | IR 路由复用 ER 路由逻辑，零额外运行时开销；无新增持久化、无新增 port 调用 | 现有性能测试覆盖（IR 与 ER 等价） |
| 可靠性/恢复 | IR 不改 runtime lifecycle、canonical timeline、terminal commit、latest-request 语义；SSE replay/recovery 与 ER 一致；auth 失败无 side effect | SSE replay 测试、auth 失败无 side effect 测试 |
| 可维护性 | routePrefix 参数化是纯机械改动，有 memory 路由先例；复用 createTaskIdentityResolver 不新建 resolver；不新增包、不新增 port | architecture lint（web-channel 不依赖 auth 实现）、代码审查 |
| 可测试性 | IR 行为可通过对 ER 测试参数化（换 prefix + 换 auth 方式）覆盖；header resolver 是纯函数易于测试 | contract 测试参数化覆盖 6 个端点 |
| 审计/可追溯性 | IR 请求和 ER 请求走相同 runtime 路径，产生相同审计事实；header 不含凭证，日志/metric 不泄露身份头值 | 现有审计测试覆盖（IR 与 ER 等价） |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| IR 6 端点镜像 ER 协议 | T1, T4 | contract 测试：IR 端点响应与 ER 等价 |
| routePrefix 参数化不改变 ER 行为 | T1 | contract 测试：ER 端点路径和行为零回归 |
| IR 路由白名单只注册 6 端点 | T1 | contract 测试：非白名单 IR 路径返回 404 |
| 副作用调用（multipart/WS）被白名单覆盖 | T1 | contract 测试：IR 不注册 WS 端点、不加载 multipart |
| IR 复用 createTaskIdentityResolver | T2 | contract 测试：header 取身份与 task-channel 一致 |
| 缺 tenant/subject 头返回 safe 401 | T2, T4 | contract 测试：缺头负向 |
| ER/IR 认证隔离不交叉 | T3, T4 | contract 测试：cookie-only 在 IR 被拒、header-only 在 ER 被拒 |
| auth 失败无 side effect | T4 | contract 测试：缺头时不创建 session/request |
| body 注入 scope 被拒绝 | T4 | contract 测试：body 含 tenantId/agentId 被拒绝 |
| agent scope 从 session 取 | T4 | contract 测试：agent scope = session.agentId |
| IR SSE replay 一致 | T4 | contract 测试：lastSeenSequence replay |
| 跨 scope safe not-found | T4 | contract 测试：跨 owner/agent 隐藏 |
| web-channel 不依赖 auth 实现 | T1 | architecture lint |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/web-channel-ir-surface/spec.md`（IR surface 端点、header 身份、认证隔离、stream、safe error）、`openspec/specs/ts-local-configured-auth/spec.md`（IR route classification delta）
- 架构和跨模块设计：`openspec/designs/architecture/web-channel-api-surface.md`（IR surface 端点表、认证隔离流程）
- 模块设计：`openspec/designs/modules/agent-channel-web.md`（IR surface 职责、routePrefix 参数化落点）
- ADR：`openspec/designs/adr/`（IR 复用 ER 协议与 createTaskIdentityResolver 的取舍）
- 导航：`openspec/designs/spec-to-design-map.md`

## 风险与取舍（Risks / Trade-offs）

- [routePrefix 参数化波及所有路由] -> 改动是纯机械字符串拼接，memory 路由已有先例，且 ER 传 `/api/v1` 行为不变；用 contract 测试验证零回归。
- [trusted-header 模式依赖上游网关] -> NextAgent 不校验凭证，若网关未注入头则缺头 401；这是设计约束，不引入 NextAgent 侧凭证校验。
- [IR 不提供 WS] -> 机机调用方用 SSE 足够；如未来需要 WS，可在 IR 白名单中追加，逻辑已复用。
- [IR 不提供附件上传] -> 当前 scope 只含 6 端点；IR 调用方可用 `inputText` 无附件提交，附件支持为后续扩展。

## 迁移计划（Migration Plan）

无数据迁移。部署时上游网关需为 IR 流量注入 `x-tenant-id`/`x-subject-id`/`x-display-name` 头。移除 IR 注册即回退到纯 ER 行为。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/web-channel-ir-surface/spec.md`：新增 IR surface 行为契约
- `openspec/specs/ts-local-configured-auth/spec.md`：合并 IR route classification 和认证隔离 requirement
- `openspec/overview.md`：补充 web-channel 双 surface（ER/IR）背景
- `openspec/designs/architecture/web-channel-api-surface.md`：补充 IR surface 端点表和认证隔离
- `openspec/designs/modules/agent-channel-web.md`：补充 IR surface 职责和 routePrefix 参数化
- `openspec/designs/adr/`：新增 IR 复用 ER 协议与 createTaskIdentityResolver 取舍 ADR
- `openspec/designs/spec-to-design-map.md`：补充导航

## 待确认问题（Open Questions）

无。
