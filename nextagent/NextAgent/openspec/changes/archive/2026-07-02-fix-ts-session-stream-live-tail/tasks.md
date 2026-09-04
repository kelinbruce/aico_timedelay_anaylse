## 1. Contract 与 query 语义

- [x] 1.1 将 `RuntimeSessionStreamEventsQuery.lastSeenSequence` 和 Web stream delivery request 的 `lastSeenSequence` 改为 optional，并保持字段存在时仍为 `TimelineSequence` 数字；`RuntimeEventStreamQuery` 继续作为显式 replay anchor 入口，不承载 no-cursor live-tail 语义。
  验证：`npm run build`；`npm run test:contract`
  来源：`ts-stream-resume-replay` / `SSE And WebSocket Resume Equivalence`；design decision 1
- [x] 1.2 调整 Web channel 的 cursor parsing：query 省略时返回 omitted，显式合法数字返回 branded sequence，显式非法值 fail safely。
  验证：`npm test -- tests/agent-kernel/web-stream-transports.test.ts`
  来源：`ts-web-sse-ws-transports` / `Optional Cursor Semantics Are Transport Equivalent`
- [x] 1.3 补 negative case：显式非法 `lastSeenSequence` 在 SSE 和 WebSocket 都被拒绝，且错误不泄漏 owner scope、agent scope、本地路径、prompt、model output 或 timeline payload。
  验证：`npm test -- tests/agent-kernel/web-stream-transports.test.ts`
  来源：`ts-web-sse-ws-transports` / `Invalid explicit cursor fails safely`；design quality/security

## 2. Runtime stream 分支

- [x] 2.1 保持显式 `lastSeenSequence=0` 的全 session replay，以及显式 `lastSeenSequence=N` 的 `sequence > N` replay-then-live 语义。
  验证：`npm test -- tests/agent-kernel/runtime-foundation.test.ts`
  来源：`ts-web-sse-ws-transports` / `Explicit zero remains full session replay`
- [x] 2.2 实现 no-cursor session live-tail：`lastSeenSequence` 省略且无 `requestId/runId` 时不读取并投影历史 events，只从 runtime 建立的 tail boundary 后交付新事件。
  验证：`npm test -- tests/agent-kernel/runtime-foundation.test.ts`
  来源：`ts-web-sse-ws-transports` / `No-Cursor Session Stream Uses Live Tail`；design decision 2
- [x] 2.3 补 tail-boundary race characterization：live-tail 订阅建立期间产生的新事件不能丢失，订阅建立前的历史事件不能被 replay。
  验证：`npm test -- tests/agent-kernel/runtime-foundation.test.ts`
  来源：design decision 2；quality/reliability
- [x] 2.4 保持 `requestId/runId` 只是 filters：`lastSeenSequence=0 + requestId/runId` 只 replay 匹配 filter 的事件，sequence 仍是 session timeline 全局 sequence。
  验证：`npm test -- tests/agent-kernel/runtime-foundation.test.ts`
  来源：`ts-web-sse-ws-transports` / `Run-scoped replay from zero remains bounded by filter`；design decision 6
- [x] 2.5 补 negative case：省略 `lastSeenSequence` 但携带 `requestId` 或 `runId` 不得被当成 bounded recovery；必须安全失败或被明确拒绝。
  验证：`npm test -- tests/agent-kernel/web-stream-transports.test.ts`
  来源：design decision 2

## 3. SSE 与 WebSocket transport

- [x] 3.1 调整 SSE route：只有 client 显式提供 `lastSeenSequence` 时才传给 `deliverWebStream` / `RuntimeSessionPort.streamEvents`，不得在 route 或 delivery 层合成 `0`。
  验证：`npm test -- tests/agent-kernel/web-stream-transports.test.ts`
  来源：`ts-minimal-agent-kernel` / `SSE 从 runtime session-facing stream facade 投影`
- [x] 3.2 调整 WebSocket upgrade：与 SSE 使用同一 optional cursor parsing 和 delivery request shape，省略时不得合成 `0`。
  验证：`npm test -- tests/agent-kernel/web-stream-transports.test.ts`
  来源：`ts-web-sse-ws-transports` / `Optional Cursor Semantics Are Transport Equivalent`
- [x] 3.3 保持 request/run-scoped stream terminal 后关闭、session-scoped stream terminal 后继续订阅。
  验证：`npm test -- tests/agent-kernel/web-stream-transports.test.ts`
  来源：proposal scope；`ts-minimal-agent-kernel` / `SSE 从 runtime session-facing stream facade 投影`

## 4. Frontend stream 连接

- [x] 4.1 调整 `frontend/agent-web` stream transport URL builder：`lastSeenSequence` 为 `undefined` 时不拼 query；合法数字 `0` 和 `N` 仍原样拼接。
  验证：`npm test -- tests/stream-transport.test.ts`
  来源：`ts-stream-resume-replay` / `Stream Resume Uses In-Memory Cursor`
- [x] 4.2 调整 session stream hook 的冷启动状态：普通打开、刷新、新 tab 或换设备时先加载 conversation bootstrap；无 non-terminal `activeRun` 时再打开 session-level no-cursor live-tail，并省略 `lastSeenSequence`。
  验证：`npm test -- tests/sessionView.component.test.tsx tests/chat-page.route-state.test.tsx`
  来源：`ts-stream-resume-replay` / `Same page reconnect without an accepted cursor omits lastSeenSequence`
- [x] 4.3 保持同页面断线恢复：当前页面已接受 timeline-backed envelope 到 sequence `N` 后，重连必须发送 `lastSeenSequence=N`。
  验证：`npm test -- tests/sessionView.component.test.tsx tests/streamingHelpers.test.ts`
  来源：`ts-stream-resume-replay` / `Same page reconnect resumes after the last displayed sequence`
- [x] 4.4 实现 activeRun bootstrap：conversation 返回 non-terminal `activeRun` 且当前页面未 terminal-observed 同一 `requestId/runId` 时，打开 `lastSeenSequence=0 + requestId/runId` 的 bounded stream。
  验证：`npm test -- tests/sessionView.component.test.tsx tests/chat-page.route-state.test.tsx`
  来源：`ts-stream-resume-replay` / `Active Run Bootstrap Replays Current Run From Zero`
- [x] 4.5 实现 submit/retry/edit accepted-run recovery：用户动作返回 accepted coordinates 且 session stream 未连接、断开、重连中、timeout/gap recovery 中，或 live-tail boundary 尚未可靠建立时，立即用 `lastSeenSequence=0 + requestId/runId` 做 bounded recovery，不等待 timeout。
  验证：`npm test -- tests/app.composer-integration.test.tsx tests/composer-panel.component.test.tsx`
  来源：`ts-stream-resume-replay` / `Accepted Request Recovery Uses Run-Scoped Replay When Session Stream Is Unreliable`
- [x] 4.6 bounded run stream terminal 后清除 `requestId/runId` filter，并回到 session-level stream 规则；不得把 `0` 留作下一次普通 session stream 的 cursor。
  验证：`npm test -- tests/sessionView.component.test.tsx`
  来源：design decision 4
- [x] 4.7 补 negative case：stream resume cursor 不得写入或读取 sessionStorage；legacy persisted cursor 必须被忽略。
  验证：`npm test -- tests/sessionView.component.test.tsx tests/stream-transport.test.ts`
  来源：`ts-stream-resume-replay` / `Legacy persisted cursor is ignored after page load`
- [x] 4.8 补 connected live-tail negative case：session-level no-cursor live-tail 已 connected 且 boundary 已建立但尚未收到 timeline-backed cursor 时，submit/retry/edit 不得仅因 cursor 缺失启动额外 run-scoped replay。
  验证：`npm test -- tests/sessionView.component.test.tsx tests/app.composer-integration.test.tsx`
  来源：`ts-stream-resume-replay` / `Submit accepted while connected no-cursor live-tail has no cursor yet`

## 5. Conversation 与 UI 收敛

- [x] 5.1 调整 terminal 后普通 UI 收敛：terminal envelope 到达后从 live stream state 收敛并保留 process details，不用 ordinary terminal-triggered conversation refresh 覆盖当前展示。
  验证：`npm test -- tests/TurnBlock.test.tsx tests/chat-timeline.component.test.tsx`
  来源：`ts-stream-history-consistency` / `Ordinary terminal does not replace live process details with conversation snapshot`
- [x] 5.2 保留 conversation refresh 的合法入口：gap recovery、stream timeout recovery、手动刷新、打开或切换会话仍可刷新 conversation。
  验证：`npm test -- tests/sessionView.component.test.tsx tests/chat-page.route-state.test.tsx`
  来源：`ts-stream-history-consistency` / `History Uses Visible Messages`
- [x] 5.3 补长历史刷新回归用例：conversation 负责显示已提交历史，no-cursor stream 不 replay 历史 stream events，页面不因被动 replay 阻塞。
  验证：`npm test -- tests/sessionView.component.test.tsx`；必要时补 browser/e2e 验证长历史会话刷新
  来源：proposal problem；`ts-stream-history-consistency` / `No-cursor live-tail does not reconstruct history`
- [x] 5.4 补 opening reconcile 回归用例：conversation 初始快照与 no-cursor live-tail boundary 之间产生的 committed message 或 activeRun state 必须通过一次 opening conversation reconcile 被展示，且不得重复 visible turn 或覆盖已接收 live process details。
  验证：`npm test -- tests/sessionView.component.test.tsx tests/chat-page.route-state.test.tsx`
  来源：`ts-stream-history-consistency` / `Opening reconcile closes the conversation-to-live-tail window`

## 6. 验证和收尾

- [x] 6.1 运行 OpenSpec 严格校验，确认 active change delta 可合并。
  验证：`openspec validate fix-ts-session-stream-live-tail --strict`
  来源：OpenSpec change gate
- [x] 6.2 运行 broad validation，覆盖 runtime/channel/frontend 合同和架构边界。
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`
  来源：AGENTS.md 验证门禁；design verification map
- [x] 6.3 做 push 前 NextAgent 语义 review，重点检查没有新增 Web API 参数、conversation 字段、sessionStorage cursor、parallel DTO 或 channel-owned replay truth。
  验证：`$nextagent-code-review` 语义检视结论 PASS 或 PASS WITH FOLLOW-UP
  来源：AGENTS.md Push 门禁；design non-goals

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/ts-core-contracts/spec.md`、`openspec/specs/ts-stream-resume-replay/spec.md`、`openspec/specs/ts-web-sse-ws-transports/spec.md`、`openspec/specs/ts-stream-history-consistency/spec.md` 和 `openspec/specs/ts-minimal-agent-kernel/spec.md`。
- 更新 `openspec/designs/architecture/core-contracts.md`、`openspec/designs/architecture/runtime-boundaries.md`、`openspec/designs/architecture/web-stream-transports.md` 和 `openspec/designs/architecture/stream-projection.md`。
- 更新 `openspec/designs/modules/agent-runtime.md`、`openspec/designs/modules/agent-channel-web.md` 和 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一 stream cursor 语义、API schema、数据 owner 或接口语义。
