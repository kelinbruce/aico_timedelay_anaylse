## 背景与问题（Why）

web-channel 当前只对外暴露一种 surface：ER（人机交互），面向浏览器前端。ER 的身份由 `agent-channel-web-auth-local` 通过 cookie 认证注入，传输为 SSE/WebSocket，协议是 session 会话粒度。

电信网络场景中，外部系统（编排系统、网管平台、上游业务系统）需要以程序化方式直接驱动 NextAgent 会话，在 session 粒度完成创建会话、提交请求、消费流、停止、重试和回答 pending-input。这些调用方没有浏览器、没有 cookie，但其上游网关已完成认证并注入可信身份头。

`agent-channel-task` 已提供任务粒度的机机对接（task-channel，header 取身份），但它面向 task 粒度的批量异步回调模型，不是 session 会话粒度的同步/流式交互。web-channel 缺少与 ER 协议对等的 session 粒度机机 surface。

## 变更范围（What Changes）

- **新增** web-channel IR surface：在 `/api/v1/ir` prefix 下注册 6 个端点，镜像 ER 对应端点的协议、DTO、schema 和 stream 行为：
  - `POST /api/v1/ir/sessions` — 创建会话
  - `POST /api/v1/ir/sessions/:sessionId/requests` — 创建请求
  - `GET /api/v1/ir/sessions/:sessionId/stream` — SSE 流式消费
  - `POST /api/v1/ir/sessions/:sessionId/cancel` — 停止
  - `POST /api/v1/ir/sessions/:sessionId/retry` — 重试
  - `POST /api/v1/ir/sessions/:sessionId/pending-inputs/:pendingInputId/answer` — 追加 input（回答 pending-input）
- **新增** IR 身份解析：复用 task-channel 已有的 `createTaskIdentityResolver`（trusted-header 模式），从 `x-tenant-id`、`x-subject-id`、`x-display-name` 请求头构造 `IdentityContext`。上游网关注入可信头，NextAgent 只读不校验凭证。
- **修改** `registerWebChannel`：接受 `routePrefix` 参数，路由路径从硬编码 `/api/v1/...` 改为 `${prefix}/...`。ER 注册传 `/api/v1`（行为不变），IR 注册传 `/api/v1/ir` 并通过路由白名单只注册上述 6 个端点。
- **修改** composition 层：在 `channel-composition` 中新增 IR 注册路径，使用 `createTaskIdentityResolver` 作为 `identityResolver`，以 `/api/v1/ir` prefix 注册 IR 路由。
- IR 与 ER 认证隔离：IR 路由只认 header，ER 路由只认 cookie，各自走自己的 auth gate；缺凭证统一 safe 401，不产生任何 side effect。
- agent scope 不从 header 取，仍来自 `requireSession` 返回的持久化 `session.agentId`，与 ER 一致。
- 不改 runtime/port/DTO/契约语义，不新增端点语义，不碰 task-channel。

## Capability 影响（Capabilities）

### 新增 Capability

- `web-channel-ir-surface`: web-channel 的机机交互（IR）surface，在 session 会话粒度提供与 ER 协议对等的 6 个端点，通过 trusted-header 身份解析和独立 URL prefix 实现认证隔离。

### 修改的 Capability

- `ts-local-configured-auth`: 新增 IR 路由的 route classification 规则——IR prefix 下的路由使用 header-based identity 而非 cookie auth，ER/IR 认证路径互不交叉。

## 影响范围（Impact）

- 代码：`packages/agent-channel-web/src`（`registerWebChannel` prefix 参数化 + 路由白名单）、`packages/agent-app/src/composition/channel-composition.ts`（IR 注册路径）。
- API：新增 `/api/v1/ir/...` 下 6 个端点；现有 `/api/v1/...` ER 端点行为不变。
- 认证：IR 复用 `createTaskIdentityResolver`（`x-tenant-id`/`x-subject-id`/`x-display-name`），与 task-channel 一致；ER 认证不受影响。
- 依赖：web-channel 仍不依赖 `agent-channel-web-auth-local` 或任何 auth 实现；header resolver 由 composition 层注入。
- 测试：contract 测试覆盖 IR 镜像 ER 行为等价、auth 隔离、缺头负向、body 注入 scope 负向、SSE replay。
- 运维：上游网关需为 IR 流量注入 `x-tenant-id`/`x-subject-id`/`x-display-name` 头。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/web-channel-ir-surface/spec.md`：新增
- `openspec/specs/ts-local-configured-auth/spec.md`：合并 IR route classification delta

长期背景：
- `openspec/overview.md`：补充 web-channel 双 surface（ER/IR）背景

设计视图：
- `openspec/designs/architecture/web-channel-api-surface.md`：补充 IR surface 端点表和认证隔离
- `openspec/designs/modules/agent-channel-web.md`：补充 IR surface 职责和 routePrefix 参数化落点
- `openspec/designs/adr/`：新增 ADR——IR 复用 ER 协议与 createTaskIdentityResolver 的取舍
- `openspec/designs/spec-to-design-map.md`：补充导航

验证入口：
- `openspec validate --all --strict`
- `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`
