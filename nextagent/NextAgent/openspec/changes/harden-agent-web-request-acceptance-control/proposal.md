## 背景与问题（Why）

Agent Web 的 submit、带附件 submit、retry 和 edit 通过 HTTP 获得 canonical acceptance，同时通过 session stream 接收运行事件。当前浏览器对 acceptance HTTP 没有等待上限；如果 HTTP 永不返回，即使 stream 已交付内容或 terminal，页面仍可能长期保留未经 HTTP 确认的 request control 状态。

当前 foreground request control 还使用单一全局槽位。切换到另一个存在 active run 的 session，或在同一 session 通过 Enter、slash command、建议问题等入口再次发送时，异步 continuation 可能覆盖原 session 的 pending identity、terminal settlement 或 Stop/Cancel target。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- submit、带附件 submit、retry 和 edit 的 acceptance HTTP 使用固定 90 秒的 Agent Web 私有等待上限。
- timeout 只结束浏览器等待，不重发 action、不伪造 runtime terminal；每个 action 最多执行一次既有 session/conversation snapshot recovery。
- foreground request control 按 `sessionId` 隔离；同一 session single-flight，不同 session 可以并行。
- send button、Enter、slash command、建议问题和 controller/store direct action 共用同一个 owner gate。
- timeout、stream acceptance、terminal、activeRun hydration 和 Stop/Cancel 均只更新 owning session。

**非目标：**

- 不修改 Web API、stream event、runtime lifecycle、backend persistence、`agent-contracts` 或部署配置。
- 不新增 endpoint、轮询、自动重发、client-generated USER/ASSISTANT/terminal 或文本/时间启发式匹配。
- 不改变现有 optimistic/canonical identity binding、consumer-accepted cursor、exact-run coverage 或 stale-attempt isolation。
- 不持久化浏览器 request control map。

## 变更范围（What Changes）

- 在 `requestStore` 中增加 action-local acceptance timeout，并把 request control 收敛为 `sessionId -> SessionRequestState`。
- timeout 后复用一次现有 snapshot 加载；snapshot 提供 active run、terminal history或无法确认时，分别恢复 accepted、idle 或 frontend-private `confirmation-timeout` presentation。
- 在 request owner 和所有 composer 入口增加同 session single-flight gate；输入仍可编辑并保存草稿。
- 增加 fake-timer、跨 session、所有发送入口和浏览器旅程回归。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `ts-stream-history-consistency`：补充 acceptance timeout 恢复和 session-scoped foreground request control 行为。

## 影响范围（Impact）

- 主要 owner：`frontend/agent-web`。
- 主要代码：`requestStore.ts`、`requestService.ts`、`MessageInput.tsx`、`useChatComposerController.ts`、`useChatSessionStream.ts` 和 `ChatPage.tsx`。
- 主要验证：request store、composer/controller、route-state 和 live-run identity browser tests，以及 frontend build/multi-host build。
- 后端 package、public DTO、数据库和配置不变。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-stream-history-consistency/spec.md`：归并 request acceptance timeout 与 session-scoped single-flight。
- `openspec/designs/modules/agent-web.md`：归并 session request tracker、timeout 和 interaction gate owner。
- `openspec/designs/architecture/stream-projection.md`：仅在 snapshot recovery 协作顺序需要长期导航时更新。
- `openspec/designs/spec-to-design-map.md`：更新验证入口。
