## 1. 锁定真实三坐标和竞态失败

- [x] 1.1 在 `requestStore.test.ts` 使用互不相等的 `requestId`、`runId`、`requestContextId` 建立 characterization matrix，覆盖 HTTP-first、stream-accepted-first、HTTP 后首条为普通 detail，以及 HTTP 后首条为 terminal；断言当前 optimistic Turn 在修复前可复现 identity 混用或 envelope 未进入同一 Turn。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/requestStore.test.ts`；确认新增用例在实现前能表达失败、实现后全部通过。
  来源：Requirement “Optimistic Turn Binds To The Matching Canonical Run Before Projection”；Design 决策 1、2。

- [x] 1.2 在 `conversationStore.test.ts` 锁定 provisional root/attempt 与 canonical root/run/context 不相等时的 bucket 行为，覆盖首条普通 detail、terminal-first、active 后 terminal、settled late detail 和 duplicate terminal。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/conversationStore.test.ts`；断言 matching envelope 全部保留在一个 root/attempt，active 到 settled 不出现空档或 terminal-only 覆盖。
  来源：Requirement “Optimistic Turn Binds To The Matching Canonical Run Before Projection”；Design 决策 2、3。

- [x] 1.3 在 `useStreamConnection.test.tsx` 锁定 cursor 与 exact-run coverage 竞态，覆盖 unrelated run 先推进 session sequence、目标 activeRun 后到、store 拒绝 envelope、frame-batched append 尚未提交和 accepted run 在 live-tail 不可靠时恢复。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/useStreamConnection.test.tsx`；断言未接纳 envelope 不推进 cursor/coverage，unrelated cursor 不跳过目标 activeRun replay，可信 live-tail 不产生重复 replay。
  来源：Requirement “Stream Cursor And Run Coverage Require Consumer Acceptance”；Design 决策 3、4、5。

## 2. 实现唯一的 frontend identity/acceptance 路径

- [x] 2.1 将 `PendingRequest.acceptedAttemptId` 收敛为单义的 `acceptedRootMessageId`、`acceptedRunId`、`acceptedRequestContextId`，统一更新普通 submit、带附件 submit、retry、edit、cancel/terminal matching 和 `ChatPage.acceptedRun` 消费；HTTP 与 stream 只补充各自明确拥有的 identity，冲突 identity fail closed。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/requestStore.test.ts tests/chat-composer-controller.attachments.test.tsx tests/chat-page.route-state.test.tsx`；TypeScript 检查确认产品代码和测试不再读写 `acceptedAttemptId`。
  来源：Requirement “Optimistic Turn Binds To The Matching Canonical Run Before Projection”；Design 决策 1。

- [x] 2.2 扩展 `conversationStore` 现有 optimistic reconcile 和 `applyLiveBucketBatch`，在一次 store transition 中绑定 canonical root/run/context并返回 frontend-private append acceptance result；保持 firstSeenOrdinal、active/settled、latest-attempt、history visibility、anchored state 和 compaction 规则不变。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/conversationStore.test.ts tests/streamCompaction.test.ts tests/buildSessionProjection.test.ts tests/buildTurnBlocks.test.ts`；断言无 session-wide scan 或第二套 temporary bucket。
  来源：两个 delta requirements；Design 决策 2、3；Proposal 的 history/anchored 非目标。

- [x] 2.3 调整 `useStreamConnection` 的固定消费顺序：validation → pending identity binding/background routing → store append/flush → accepted cursor/exact-run coverage → lifecycle callbacks；activeRun 和 accepted-run recovery 使用 exact run、terminal、live-tail boundary 与连接状态判断，不再用非空 session cursor 单独证明目标 run 已覆盖。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/useStreamConnection.test.tsx tests/stream-transport.test.ts`；覆盖 immediate、rAF batch、SSE、WebSocket、disconnect、bounded replay terminal 和 session switch。
  来源：Requirement “Stream Cursor And Run Coverage Require Consumer Acceptance”；Design 决策 4、5。

- [x] 2.4 在 `useChatSessionStream` 接入 identity binding 和 append acceptance，确保 request accepted、pending input、terminal settlement 与 background task routing 继续复用现有 owner；matching terminal 在 optimistic、active、settled 三种阶段均结束执行中状态且不触发 ordinary conversation refresh。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/useChatSessionStream.test.tsx tests/terminal-timeout-live-failure.integration.test.tsx tests/backgroundTaskStore.test.ts tests/chat-page.route-state.test.tsx`。
  来源：Requirement “Optimistic Turn Binds To The Matching Canonical Run Before Projection”；Design 决策 2、4；Proposal 的 request lifecycle/background/history 非目标。

## 3. 负向边界、用户旅程和收尾

- [x] 3.1 增加 negative regression，实际发送 wrong session、unrelated run、旧 retry/edit attempt、history-load、local-optimistic、invalid schema 和 identity conflict envelope；断言它们不能重键 current pending Turn、把目标 run 标记为已覆盖、结算较新 run 或覆盖 settled detail。wrong session、invalid 和被 attempt isolation 拒绝的 envelope不得推进 cursor；合法 unrelated/background envelope可以推进 session cursor及其自身 coverage，但不能抑制目标 activeRun recovery。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/requestStore.test.ts tests/conversationStore.test.ts tests/useStreamConnection.test.tsx tests/useChatSessionStream.test.tsx`，每个 forbidden case 必须实际触发对应拒绝或隔离路径并断言目标 request/run 外部状态不变。
  来源：两个 delta requirements 的 negative scenarios；Design 安全、可靠性和风险缓解。

- [x] 3.2 新增 `tests/e2e/session-live-run-identity-recovery.spec.cjs`，覆盖发送后首条为 thinking/detail、部分正文后 terminal、retry/edit 新 attempt 和 reconnect/refresh bootstrap；每个旅程断言一个 Turn、持续内容、terminal 后无“执行中”，并检查没有新增 process-history、轮询或 terminal-triggered conversation 请求。
  验证：在 `frontend/agent-web` 运行 `npm run test:e2e -- tests/e2e/session-live-run-identity-recovery.spec.cjs`。
  来源：Proposal 的两类用户可见卡住场景；两个 delta requirements；Design 非目标。

- [x] 3.3 运行完整前端回归和构建，确认三 host mode、现有 history/process detail、background task、pending input、viewport 和 request control 行为不回归。
  验证：在 `frontend/agent-web` 运行 `npm test`、`npm run build`、`npm run build:vite:modes`；在仓库根目录运行 `openspec validate --all --strict` 和 `git diff --check`。
  来源：Proposal 影响范围；Design 质量属性和验证映射。

- [x] 3.4 对实现范围执行 `$nextagent-code-review`，明确检查 frontend/browser ownership、无 `agent-contracts`/Web API/backend/persistence 变化、无 history request fan-out、无 client timeout terminal、无 stale-attempt 放宽，以及 local/immersive/collaborative 共用同一实现。
  验证：语义检视结论必须为 PASS 或 PASS WITH FOLLOW-UP，且不存在 P0/P1；如准备 push，按仓库门禁在 push 前重新检视。
  来源：AGENTS.md push/review 门禁；Proposal/Design 边界。

## 4. Review follow-up：历史 retry 隔离与 identity 幂等

- [x] 4.1 收敛 retry acceptance 的 presentation owner：HTTP-first 和 stream-first 均由 `requestStore` 在 acceptance 时调用既有 conversation cleanup，保留 history USER、移除旧 ASSISTANT、保留已属于新 run 的 envelope；禁止用 canonical root 伪造 optimistic identity，也禁止 `reconcileOptimisticRequest` 重键 history-load envelope。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/requestStore.test.ts tests/conversationStore.test.ts`；覆盖刷新后历史 Turn 的 HTTP-first、stream-first 和 history rekey negative case。
  来源：Requirement “Optimistic Turn Binds To The Matching Canonical Run Before Projection” 的 history-load 隔离规则及 “Retrying a history-loaded Turn preserves canonical history identity” scenario；Design 决策 2。

- [x] 4.2 identity 已完整绑定后，同 identity 普通 envelope 和 duplicate `REQUEST_ACCEPTED` 必须幂等返回，不重复执行 conversation reconcile 或发布新的 `pendingRequest` state；完成定向、浏览器、全量构建和 strict OpenSpec 回归。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/requestStore.test.ts tests/useChatSessionStream.test.tsx tests/useStreamConnection.test.tsx`、`npm run test:e2e -- tests/e2e/session-live-run-identity-recovery.spec.cjs`、`npm test`、`npm run build`、`npm run build:vite:modes`；根目录运行 `openspec validate --all --strict` 和 `git diff --check`。
  来源：Design 决策 2 和性能/容量质量属性；Proposal 的 frame batching、三 host mode 与无请求放大边界。

## 5. Review follow-up：真实 live-tail-before-HTTP 收尾

- [x] 5.1 在 `conversationStore.test.ts` 和 `requestStore.test.ts` 增加真实 stream-before-HTTP 回归：普通 detail、正文和 terminal 先进入 exact root/run/context bucket，HTTP 后才返回 canonical identity；断言 local optimistic USER 与既有 active/settled bucket 原子合并，terminal 可结算且 coverage 不会掩盖丢失。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/conversationStore.test.ts tests/requestStore.test.ts`。
  来源：Requirement “Optimistic Turn Binds To The Matching Canonical Run Before Projection” 的 “Ordinary live events and terminal precede the HTTP response” scenario；Design 决策 2。

- [x] 5.2 将 HTTP 前 stream acceptance 标记为尚未由当前 POST 确认的 candidate；matching HTTP 确认 candidate，conflicting HTTP identity 重绑 stable local optimistic anchor 并隔离 candidate run，HTTP 前 terminal 不得清除 pending action。
- [x] 5.2a 在 HTTP identity 确认前隐藏并拒绝 stream candidate 的 Stop/Cancel target，覆盖 UI 与 store 直接调用。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/requestStore.test.ts tests/chat-page.route-state.test.tsx`；覆盖 matching candidate、conflicting candidate、candidate terminal 和 edit superseded marker。
  来源：Requirement “A different live acceptance cannot permanently claim the pending action”；Design 决策 1、2。

- [x] 5.3 增加真实 deferred HTTP + live-tail Playwright 旅程，并重新运行前端全量 test、build、multi-host build、strict OpenSpec validation 和 `$nextagent-code-review`；确认无 Web API、backend、agent-contracts、轮询、client terminal 或 stale-attempt 放宽。
  验证：在 `frontend/agent-web` 运行 `npm run test:e2e -- tests/e2e/session-live-run-identity-recovery.spec.cjs`、`npm test`、`npm run build`、`npm run build:vite:modes`；根目录运行 `openspec validate --all --strict`、`git diff --check`。
  来源：本 change 的用户可见不变量、性能/容量边界和 AGENTS.md review 门禁。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前：

- 将 identity binding 和 Turn continuity 同步到 `openspec/specs/ts-stream-history-consistency/spec.md`。
- 将 consumer-accepted cursor 和 exact-run coverage 同步到 `openspec/specs/ts-stream-resume-replay/spec.md`。
- 将 browser consumer acceptance、cursor 和 recovery 协作顺序提炼到 `openspec/designs/architecture/stream-projection.md`。
- 将 pending 三坐标、conversation append acceptance 和 bucket binding owner 提炼到 `openspec/designs/modules/agent-web.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md` 的验证入口。
- 不更新 `openspec/overview.md`，不新增 ADR，不重复定义 public stream schema、runtime lifecycle 或 history owner。
