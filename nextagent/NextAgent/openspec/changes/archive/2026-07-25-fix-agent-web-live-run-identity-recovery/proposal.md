## Why

Agent Web 在用户提交问题后会先插入一条本地 optimistic USER envelope，再通过 HTTP 接收 `requestId`、`runId`，并通过 session stream 接收带有 `requestContextId` 的 canonical `StreamEnvelope`。这三个标识描述不同坐标，正常情况下不相等。

当前前端把 HTTP 返回的 `runId` 和 stream envelope 的 `requestContextId` 复用到同一个 `acceptedAttemptId` 字段，其最终含义取决于 HTTP 与 stream 的到达顺序；optimistic reconcile 又只重键 root/request identity，没有同时把 live bucket 的 attempt identity 绑定到 canonical `requestContextId`。`conversationStore` 按 root/attempt 接纳 live envelope，当当前 bucket 与 incoming attempt 不一致且 incoming 不是 `REQUEST_ACCEPTED` 时，会把该 envelope 当作旧 attempt 静默忽略。

因此，大多数请求在 `REQUEST_ACCEPTED` 先到时可以正常完成；当页面在 `REQUEST_ACCEPTED` 之后才接入 live-tail、HTTP/stream 发生另一种竞态，或 retry/edit/reconnect 后第一条可见事件已经是 thinking、正文、能力详情或 terminal 时，同一 run 的后续消息虽然持续到达浏览器，却可能没有进入当前 Turn。用户会看到两类卡住：

- optimistic 消息一直停留在“NextAgent 正在思考 / 执行详情·执行中”；
- 已显示部分执行详情或正文，但后续内容和 terminal 不再更新。

页面刷新后，committed conversation history 和 `activeRun` bootstrap 会重新建立投影，所以表面上恢复正常，但当前页面生命周期中的 live presentation 已经丢失。该问题必须在 Agent Web 的 identity binding、live bucket acceptance 和 resume cursor 边界内修复，不能通过新增历史查询 API、轮询、超时假终态或刷新页面兜底。

## What Changes

- Agent Web 的 pending request state SHALL 分别保存 canonical `requestId`、`runId` 和 `requestContextId`，不得再让一个字段在不同竞态下承载不同标识语义。
- HTTP acceptance 与 stream acceptance SHALL 合并同一 pending request 的部分 canonical identity；无论哪一侧先到，已经确认的标识不得被另一种标识覆盖。
- 在当前 pending run 的第一条 canonical envelope 进入 live bucket 前，frontend SHALL 在同一可观察状态迁移中把 optimistic root 和 attempt 绑定到 canonical identity；该 envelope 即使不是 `REQUEST_ACCEPTED`，只要与已确认的当前 request/run 匹配，也不得因 provisional attempt 不同而被静默丢弃。
- Stream cursor SHALL 以对应 frontend consumer 实际接纳的 timeline-backed envelope 为依据；当前 request/run 的 conversation envelope 必须进入 conversation store 后才能推进 cursor。“当前页面已覆盖某个 run”必须按精确 `requestId + runId` 记录，其他 run 的有效事件可以推进 session cursor，但不得被当作目标 run 已恢复的证明。
- retry、edit、reconnect 和 terminal-first 场景 SHALL 复用同一 identity binding 规则；旧 attempt、其他 session、其他 run、invalid envelope 和历史加载 envelope 仍不得接管当前 pending request。
- 保持既有 active/settled bucket、history source precedence、anchored window、background task projection、frame batching、SSE/WebSocket 等价和三种 host mode 共享 ChatWorkspace 行为。
- 不增加或修改 Web API、stream event/schema、runtime lifecycle、backend persistence、`agent-contracts`、conversation history API 或执行历史加载能力。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `ts-stream-history-consistency`：补充 optimistic identity 的原子绑定、非 `REQUEST_ACCEPTED` 首事件接纳、terminal-first 结算和旧 attempt 隔离行为。
- `ts-stream-resume-replay`：补充 cursor 仅在 frontend consumer 接纳后推进，以及 active/accepted run coverage 必须按精确 `requestId + runId` 判断的行为。

## 影响范围（Impact）

- 主要代码范围：`frontend/agent-web/src/state/requestStore.ts`、`frontend/agent-web/src/state/conversationStore.ts`、`frontend/agent-web/src/features/chat/hooks/useStreamConnection.ts`、`frontend/agent-web/src/features/chat/hooks/useChatSessionStream.ts` 和 `frontend/agent-web/src/pages/ChatPage.tsx` 的内部 pending identity、live append、cursor/recovery 接入点。
- 主要测试范围：`requestStore.test.ts`、`conversationStore.test.ts`、`useStreamConnection.test.tsx`、`useChatSessionStream.test.tsx`、`chat-page.route-state.test.tsx`，以及覆盖真实 submit/retry/edit/reconnect 顺序的浏览器旅程。
- API、依赖、配置、backend package、public DTO、`agent-contracts` 和数据库：无变化。
- local、immersive、collaborative 三种 host mode 继续消费同一 Agent Web store、stream hook 和 ChatWorkspace，不形成宿主分支。
- 兼容性：不改变用户操作、URL、transport 参数 shape 或持久化数据；只收敛当前页面对既有 canonical identity 的使用。
- 依赖与并行边界：本 change 以当前已经存在的 active/settled live bucket、逐帧 batching 和 viewport 稳定实现为基线；`stabilize-agent-web-popup-and-scroll` 虽仍为 active change，但其 artifact 和实现任务已经完成且与本 change 共享 `conversationStore`、stream hook 和 `ChatPage`，因此两者不得并行改写这些文件。本 change 按当前代码基线串行实施；其他不修改 Agent Web conversation/stream consumer 的 backend 工作可以并行。
- Roadmap/release scope：当前 roadmap 没有同名实施项；本 change 是对 stable stream/history 行为的缺陷修复，不新增 capability，也不扩大当前 release scope。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-stream-history-consistency/spec.md`：归并 optimistic/canonical identity 原子绑定、首个匹配 live event 接纳、terminal-first 和旧 attempt 隔离规则。
- `openspec/specs/ts-stream-resume-replay/spec.md`：归并 exact-run coverage 与 cursor-after-consumer-acceptance 规则。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/stream-projection.md`：归并 browser consumer acceptance、session cursor 和 exact-run coverage 的协作顺序。
- `openspec/designs/modules/agent-web.md`：归并 pending identity 分离、optimistic bucket 原子绑定和 active/settled acceptance owner。
- `openspec/designs/adr/<id>.md`：无；本变更是既有 Agent Web owner 内的缺陷修复，不引入新的跨模块技术决策。
- `openspec/designs/spec-to-design-map.md`：仅在现有 capability 的验证入口发生变化时更新对应导航。

验证入口：
- `frontend/agent-web/tests/requestStore.test.ts`
- `frontend/agent-web/tests/conversationStore.test.ts`
- `frontend/agent-web/tests/useStreamConnection.test.tsx`
- `frontend/agent-web/tests/useChatSessionStream.test.tsx`
- `frontend/agent-web/tests/chat-page.route-state.test.tsx`
- submit/retry/edit/reconnect 的 Agent Web Playwright 回归
- `frontend/agent-web` test、build 和 multi-host Vite build
- `openspec validate --all --strict`
