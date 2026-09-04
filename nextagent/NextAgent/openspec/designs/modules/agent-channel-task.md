# agent-channel-task

## 职责

面向后台服务系统的 Task Channel HTTP/JSON 传输层。以 runtime `requestId` 为外部 `taskId`、以 runtime `sessionId` 为独立会话坐标，通过流式 SSE 和异步 callback 两条独立路由树交付任务生命周期事件，支持批量对账查询恢复。

## 边界

- 不拥有 request lifecycle、canonical timeline、PendingInput persistence 或 terminal commit；这些由 `agent-runtime` 拥有。
- 不拥有 trusted identity 或 Agent Scope；由 channel/auth boundary 的 `IdentityResolver` 和可信 app composition 提供。
- HTTP/IR async callback 使用专用 `TaskCallbackDeliveryPort`（固定 POST JSON schema + 可信 URL policy），不得演化为通用 HTTP executor。
- 不依赖 CLIP、`agent-capability` private path、gateway 实现或通用 HTTP client abstraction。

## 核心路由树

按交付模式拆分为两套路由树：

- **流式端点**（SSE response body，无二次订阅）：`POST /api/v1/stream-task`、`POST /api/v1/stream-task/:taskId/edit`、`POST /api/v1/stream-task/:taskId/retry`。
- **异步端点**（JSON 控制响应 + callback 推送）：`POST /api/v1/async-tasks`、`POST /api/v1/async-tasks/edit`、`POST /api/v1/async-tasks/retry`。
- **控制端点**（JSON，路径不变）：`POST /api/v1/tasks/cancel`、`POST /api/v1/tasks/query`、`POST /api/v1/tasks/pending-inputs/answer`。
- 删除 `GET /api/v1/task/:taskId/stream` 和 `WS /api/v1/task/:taskId/ws`，路由不注册返回 404。

## Session 清理

channel 创建 session 后 submit 失败时（stream-task create、async-tasks create、Web Channel convenience submit），best-effort 调用 `RuntimeSessionPort.deleteSession` 清理本次新建的 session，然后返回原始错误。共享 helper `cleanupOrphanSession` 由 `agent-channel-common` 提供，内部 catch 不 re-throw。仅清理本次新建的 session，不清理 caller 提供的已有 session。

## 验证关注点

- contract tests 覆盖 SSE 首/终事件、callback 交付、batch partial failure、owner/agent scope isolation。
- architecture tests 断言 channel 不 import gateway implementation 或 CLIP。
- `openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。