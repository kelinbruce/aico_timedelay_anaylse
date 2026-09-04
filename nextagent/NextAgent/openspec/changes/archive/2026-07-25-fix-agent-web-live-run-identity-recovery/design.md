## 背景和现状（Context）

### 用户可见不变量

用户提交问题后，只要 backend 已接受 request 且 stream 持续交付同一 run 的合法 envelope，当前页面就必须持续更新同一个 Turn，并在 matching terminal 到达后结束“执行中”状态。HTTP 与 stream 的先后顺序、是否观察到 `REQUEST_ACCEPTED`、以及 session 中是否已经存在其他 cursor，都不能改变这个结果。

### 当前代码路径

当前主路径如下：

1. `requestStore.submitRequest` 或 `submitRequestWithAttachments` 创建 client UUID，并向 `conversationStore` 写入 local optimistic `REQUEST_ACCEPTED` USER envelope。
2. `requestService.submitRequest` 的 HTTP response 返回 canonical `requestId`、`runId`。
3. `useStreamConnection` 接收并校验 `StreamEnvelope`，先更新 `streamCursorRef`，再调用 `useChatSessionStream.handleLiveEnvelope` 和 `conversationStore.appendEnvelope(s)`。
4. `requestStore.reconcilePendingRequestFromLiveEnvelope` 或 `acceptRequestFromStream` 更新 pending identity；`conversationStore.reconcileOptimisticRequest` 只把 optimistic request/root 改成 accepted root。
5. `conversationStore.applyLiveBucketBatch` 按 `rootMessageId + requestContextId/attempt` 选择 active/settled bucket。不同 attempt 的非 `REQUEST_ACCEPTED` envelope 被视为旧 attempt 并忽略。
6. `ChatPage` 把 `pendingRequest.acceptedAttemptId` 当作 `acceptedRun.runId` 交给 `useStreamConnection` 做 bounded recovery。

### 已确认的 implementation-vs-spec gap

- `acceptedAttemptId` 由 HTTP 路径写入 `runId`，由 stream 路径写入 `requestContextId`。字段语义由竞态决定，而两者在 runtime 中是不同标识。
- optimistic reconcile 只重键 root/request，没有把 provisional attempt 一并绑定到 canonical `requestContextId`。如果首条 canonical envelope 不是 `REQUEST_ACCEPTED`，`applyLiveBucketBatch` 会命中 mismatch 分支并静默忽略。
- `useStreamConnection` 在 owning frontend consumer 接纳前推进 `streamCursorRef`；active/accepted recovery effect 又用非空 session cursor 抑制 run-scoped replay。一个未被 store 接纳的 envelope或其他 run 的 envelope因此可能同时造成“内容没进入 Turn”和“恢复也不再启动”。
- 现有测试把 `requestId`、`runId`、`requestContextId` 简化成相同值或只提供单一字段，未覆盖真实三坐标和 HTTP/stream 顺序排列，所以没有锁定该缺陷。

这些 gap 违反当前 stable `ts-stream-resume-replay` 中“consumer 接纳后推进 cursor”和“activeRun 不得被 unrelated session cursor 跳过”的要求，也没有完整实现 `agent-web` 模块设计中按 session/root/attempt 原子 identity reconcile 的约束。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 让 submit、带附件 submit、retry 和 edit 共用一套 canonical identity binding，分别保存并消费 `requestId`、`runId`、`requestContextId`。
- HTTP acceptance 与 stream `REQUEST_ACCEPTED` 无论哪一侧先建立 canonical request/run identity，后续首条 matching 普通 live detail 或 terminal 都进入同一 optimistic/active/settled Turn；在 canonical request/run 尚不可证明时，普通 event 不得仅凭时间接近接管 pending Turn。
- 只在 conversation consumer 接纳 timeline-backed envelope 后推进 session cursor 和 exact-run coverage。
- 保留 stale attempt 隔离、history canonical source、active/settled 生命周期、anchored window、background task、frame batching和三 host mode 行为。

**非目标：**

- 不修改 `agent-contracts`、public DTO、Web API、stream event/schema、runtime command 或 backend lifecycle。
- 不增加 `/runs/:runId/events`、conversation 扩展、历史执行详情请求、轮询或页面自动刷新。
- 不用固定超时制造失败/完成状态，不把 transport close 当 terminal。
- 不重构 Turn projection、process detail rendering、viewport、Markdown、PIU、background task store 或历史分页。
- 不改变 committed conversation history 与 live process presentation 的 source precedence。

### 依赖和并行边界

- 本设计依赖当前代码已经具备的 history/active/settled 分层、root/attempt bucket、frame batching、opening reconcile 和三 host mode 共享 ChatWorkspace；不重新设计这些 owner。
- `stabilize-agent-web-popup-and-scroll` 仍是 active change，但当前 artifact 与实现任务已经完成，并与本 change 共享 `conversationStore`、`useStreamConnection`、`useChatSessionStream` 和 `ChatPage`。本 change 必须以其当前实现为前置基线串行落地，不允许两个 change 并行修改上述共享文件。
- 任何同时修改 Agent Web pending request、conversation bucket、stream cursor/recovery 或 terminal settlement 的 change 都必须与本 change 串行；只修改 backend 且不改变 Web/stream contract 的工作可以并行。
- 当前 roadmap 没有同名实施项。本 change 作为 stable spec conformance bugfix 独立验收，不新增 capability，不改变 Alpha/P1/postponed 分类。

## 设计决策（Decisions）

### 决策 1：Pending identity 使用三个单义坐标

唯一选定路径是在 Agent Web 私有 `PendingRequest` 中保留三个互不替代的 canonical 字段：

- `acceptedRootMessageId`：canonical request/root identity；
- `acceptedRunId`：HTTP 和 stream envelope 中的 canonical run identity；
- `acceptedRequestContextId`：stream attempt/bucket identity。

移除语义不确定的 `acceptedAttemptId`。HTTP acceptance 只补充 `acceptedRootMessageId` 和 `acceptedRunId`；stream acceptance/live envelope 只用自身明确字段补充缺失值。合并时如果已确认字段与 incoming canonical identity 冲突，则 incoming envelope 不得接管当前 pending action。

`ChatPage` 构造 `acceptedRun` 时只使用 `acceptedRootMessageId + acceptedRunId`。`requestContextId` 只服务 frontend live attempt/bucket，绝不进入 Web stream 的 `runId` filter。

放弃方案：

- 继续让 `acceptedAttemptId` 同时表示 run/context：无法消除竞态。
- 强制 backend 让三个 ID 相等：改变 frozen contract 和 runtime identity，不属于前端缺陷修复。
- 只按 root 分桶：会破坏 retry/edit 的 attempt isolation。

### 决策 2：用一个 conversation-store action 原子绑定 optimistic identity

`conversationStore` 继续是页面内 conversation projection lifecycle 的唯一 owner。现有 `reconcileOptimisticRequest` 收敛为一个 identity-aware action：输入 optimistic identity 和已确认的 canonical root/run/context，在同一次 Zustand transition 中完成：

1. local optimistic USER envelope 的 request/root/run/context 重写；
2. active 或 settled bucket 的 root key、attempt identity 和 envelope identity 重建；
3. `firstSeenOrdinal`、已有 process detail、terminal 状态和 latest-attempt precedence 保持不变；
4. 与其他 root、旧 attempt 和 anchored window state 隔离。

当 HTTP 先到且尚无 `requestContextId` 时，只记录 root/run，不猜测 context；当第一条 matching stream envelope 到达时，`requestStore` 先用其 `requestContextId` 完成上述 binding，再把 envelope 交给 store。该 envelope可以是 `REQUEST_ACCEPTED`、thinking、正文、capability detail、pending input 或 terminal。

在 HTTP canonical identity 尚未返回时，只有 matching session 的 live `REQUEST_ACCEPTED` 可以首次建立 pending canonical identity；普通 event 和 terminal 不凭“时间接近”单独接管 optimistic Turn。HTTP identity 一旦存在，普通 event/terminal 必须匹配已确认的 request 或 run 才能完成 context binding。

retry 不创建新的 local optimistic USER envelope，不能把既有 canonical root 当作 optimistic identity 的替代值。retry 的 HTTP 或 stream acceptance 由 `requestStore` 统一触发既有 conversation presentation cleanup：保留 history USER，移除旧 ASSISTANT，并保留已经属于新 run 的 live envelope；随后新 run 的首条 envelope 按自身 `requestContextId` 建立 active/settled bucket。`reconcileOptimisticRequest` 只重键 frontend-owned optimistic/live envelope，不重键 history-load envelope。该 cleanup 在 HTTP-first、stream-first 和重复 acceptance 下必须幂等。

pending 的三个 canonical identity 已完整绑定后，后续同 identity envelope 只返回匹配结果，不再重复执行 conversation reconcile 或发布新的 `pendingRequest` state；conversation append 和 frame batching 仍按原路径消费每条 envelope。

当 session live-tail 的普通 detail、正文或 terminal 先于 HTTP response 到达时，它们继续只能按自身 canonical root/run/context 进入独立 live bucket，不凭时间接近接管 pending Turn。HTTP response 随后确认 root/run 时，`reconcileOptimisticRequest` SHALL 在同一次 store transition 中查找 exact root/run 的既有 active/settled bucket；若存在，则采用该 bucket 的 `requestContextId` 重键 local optimistic USER anchor，并合并两个 bucket。该 transition MUST 保留已经接纳的 detail、正文、terminal、`firstSeenOrdinal` 和 settled 状态。只有无法找到 exact root/run bucket 时，optimistic anchor 才继续使用 canonical root 作为 provisional attempt，等待后续 matching envelope 完成 context binding。

HTTP response 是当前浏览器 POST 与 canonical request/run 的可信关联点。HTTP 尚未返回时，live `REQUEST_ACCEPTED` 可以建立 stream candidate 并维持即时 optimistic presentation，但 matching terminal 不得单独清除该 pending action，stream candidate 也不得暴露为 Stop/Cancel 的控制目标；HTTP 返回相同 identity 后确认 candidate，返回不同 identity 时 SHALL 用 HTTP root/run 替换 candidate、拆回 local optimistic USER anchor，并保持 candidate run 的 canonical envelope 隔离。该修正不按时间猜测归属，也不允许 candidate run 的 terminal 结算或取消 HTTP 已确认的其他 run。

放弃方案：

- 在 `applyLiveBucketBatch` 中无条件让任意新 attempt 继承 optimistic bucket：可能让其他 run 或旧 run 接管用户 pending request。
- 为 mismatch envelope 建立第二个临时 bucket再等待合并：会产生重复 Turn和第二套 reconciliation lifecycle。
- 收到 mismatch 时请求 conversation/history：会放大请求并覆盖 live-only process detail。
- 用 canonical root 伪造 retry optimistic identity：会把刷新后加载的旧回答重键为新 run，并使后续 preserve-run cleanup 错误保留旧内容。

### 决策 3：Conversation append 返回内部 acceptance result

扩展现有 `conversationStore.appendEnvelope(s)` 的 frontend-private 返回值，使其报告本次 conversation batch 中：

- 已新增、合并或确认为同一 bucket 已存在的 envelope；
- 被当前 bucket 的 attempt isolation、stale attempt 或缺失 identity 拒绝的 envelope；
- 已接纳 timeline-backed envelope 的最高 session sequence；
- 已接纳 envelope 的 exact `requestId + runId` keys。

该结果不形成 public DTO，不跨 package，也不持久化。现有不关心结果的调用方可以忽略返回值；`useStreamConnection` 是唯一消费 cursor/run coverage 部分的 owner。既有 `backgroundTaskStore` 继续拥有 `BACKGROUND_TASK_*` acceptance；只有其成功识别并接纳的 timeline-backed background envelope 才能推进 session cursor，并且只能建立该 envelope 自身的 exact-run coverage。

`applyLiveBucketBatch` 继续执行既有 attempt isolation，只把每条 envelope 的 acceptance 结果向上返回；不新增平行 filter。

放弃方案：

- transport 收帧即视为 accepted：无法区分浏览器收到与 conversation consumer 实际接纳。
- 通过重新扫描 store 判断是否写入：增加每帧全 session 扫描并引入竞态。
- 仅用 console warning 诊断：不能修复 cursor 和恢复语义。

### 决策 4：Cursor 与 exact-run coverage 在 store acceptance 后提交

`useStreamConnection.handleEnvelopeEvent` 的固定顺序调整为：

1. schema/session validation；
2. background-task routing 与 current pending identity binding；
3. immediate append 或 frame-batched append，并从 conversation/background owning consumer 取得 acceptance；
4. 根据 owning consumer acceptance result 推进 `streamCursorRef` 和 `acceptedRunKeysRef`；
5. 执行 matching request accepted、pending input 和 terminal callback。

Batchable delta 的 cursor 在该 batch 实际提交后推进；非 batchable lifecycle/terminal event 仍立即 append 和回调，不增加可见延迟。invalid、wrong-session、stale-attempt 或 identity mismatch envelope 不推进 cursor/run coverage。其他 run 或 background task 的合法 event 可以推进 session cursor及其自身 coverage，但不能标记当前目标 run 已覆盖。

Terminal callback 仍通过现有 exact request/root/run matching 结算 request；本 change 不改变 backend terminal truth，也不新增 client terminal。

`DEGRADATION_NOTICE` gap recovery、auth challenge probe 和 disconnect/reconnect 是 transport control，不以 conversation bucket acceptance 为前提；它们继续走现有恢复路径，并继续遵守 degradation notice 本身不推进 timeline cursor 的规则。

### 决策 5：Run recovery 判断 exact identity，不用 session cursor 代替

`useStreamConnection` 保留一个页面内、session-scoped 的 exact-run coverage set，key 固定为 `requestId + runId`，只由决策 4 的 accepted append result 更新。

- `activeRun` bootstrap：如果 exact run 未覆盖且未观察到 matching terminal，则按现有规则使用 `requestId`、`runId`、`lastSeenSequence=0`；非空 session cursor 不再单独阻止 bootstrap。
- 新 accepted run：如果 no-cursor live-tail 在 acceptance 前已经建立可信边界，则继续由现有 session live-tail 覆盖，不额外 replay；如果边界未建立、已断开或处于恢复状态，则按现有 accepted-run bounded replay 恢复。已有 session cursor不再把不可靠连接伪装成目标 run 已覆盖。
- bounded replay 完成/terminal 后继续返回现有 session resume 路径；不增加第二条 transport 或 history path。

session 切换时同时清空 cursor、exact-run coverage 和 bounded replay refs。SSE/WS 继续共享 `connectStream` 参数和状态机。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 不新增信任来源、API 或 payload；pending binding 仅接受同 session 且与已确认 request/run 匹配的 canonical identity。旧 attempt、history-load、local optimistic、invalid envelope 均不能接管 pending state。 | `requestStore.test.ts`、`conversationStore.test.ts` negative cases；semantic review |
| 性能/容量 | 每条 envelope 仍只更新目标 root/attempt bucket；acceptance result 在现有 append 循环中生成，不做每帧 session-wide scan。batch cursor 最多延后一个 animation frame，不增加网络请求。 | `conversationStore.test.ts`、`useStreamConnection.test.tsx` batching assertions；frontend build |
| 可靠性/恢复 | matching content/detail/terminal 不再因 provisional identity 丢失；cursor 不越过未接纳事件；activeRun 与 accepted-run 恢复继续使用现有 bounded replay。 | 四种到达顺序、terminal-first、unrelated cursor、disconnect/reconnect 集成测试和 Playwright |
| 可维护性 | identity 名称单义；conversation store 继续是 acceptance owner，stream hook 继续是 cursor/recovery owner；不新增第二套 store 或 adapter。 | TypeScript strict build、architecture/semantic review |
| 可测试性 | 使用显式不同的 `requestId`、`runId`、`requestContextId` fixture 和可控 HTTP/stream deferred 顺序，直接断言一个 Turn、accepted envelope 和 terminal settle。 | 定向 Vitest、route-state 集成测试、Playwright |
| 审计/可追溯性 | 不新增日志、metric、trace 或高基数字段；回归测试和 OpenSpec validation 作为缺陷修复证据。浏览器 console 不是正确性机制。 | 测试输出、review report、`openspec validate --all --strict` |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| request/run/context 单义且顺序无关 | 1.1、2.1 | `requestStore.test.ts` |
| optimistic root/attempt 原子绑定 | 1.2、2.2 | `conversationStore.test.ts` |
| 非 `REQUEST_ACCEPTED` 首事件进入同一 Turn | 1.1、2.1、2.2 | `requestStore.test.ts`、`buildSessionProjection.test.ts` |
| terminal-first 和部分内容后 terminal 正常结算 | 1.1、2.3 | `useChatSessionStream.test.tsx`、`chat-page.route-state.test.tsx` |
| stale attempt/other run 不接管 | 1.2、2.1、2.2 | request/conversation store negative tests |
| cursor 仅在 consumer acceptance 后推进 | 1.3、2.3 | `useStreamConnection.test.tsx` |
| unrelated cursor 不跳过 activeRun | 1.3、2.3 | `useStreamConnection.test.tsx` |
| live-tail、bounded replay、SSE/WS 既有语义不回归 | 2.3、3.1 | stream hook tests、transport tests |
| submit/attachment/retry/edit 共用同一规则 | 2.1、3.2 | request store tests、Playwright |
| API、backend、agent-contracts、history detail 无变化 | 3.3 | `git diff --name-only` review、`nextagent-code-review` |
| 三 host mode 同构 | 3.1 | `npm run build:vite:modes` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ts-stream-history-consistency/spec.md` 主承载 optimistic/canonical identity binding 与 Turn continuity；`openspec/specs/ts-stream-resume-replay/spec.md` 主承载 cursor 和 exact-run coverage。
- 架构和跨模块设计：`openspec/designs/architecture/stream-projection.md` 主承载 transport receive、browser consumer acceptance、cursor 和 recovery 的协作顺序。
- 模块设计：`openspec/designs/modules/agent-web.md` 主承载 pending identity、conversation append acceptance 和 active/settled bucket owner。
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md` 仅维护上述 specs 到设计和测试入口的导航。

## 风险与取舍（Risks / Trade-offs）

- [过宽 identity binding 可能让无关 run 接管 pending Turn] -> HTTP identity 存在时必须匹配 request/run；HTTP 前仅 `REQUEST_ACCEPTED` 可首次建立 identity；保留 session、history/local、stale attempt negative gates。
- [重键 bucket 时丢失 ordinal、detail 或 terminal] -> 在 conversation store 单次 transition 中重建目标 bucket，并用 active、settled、terminal-first 和 duplicate terminal tests 锁定。
- [cursor 延后到 frame commit 可能产生少量重复 replay] -> 现有 envelope dedupe 吸收重复；宁可重复交付并去重，不允许 cursor 越过未投影内容。
- [activeRun bootstrap 重复连接] -> exact-run coverage、terminal set 和 bounded-replay key 共同去重；可信 live-tail boundary 对当前页面新 accepted run 的既有例外保持不变。
- [retry/edit 的旧 attempt 迟到] -> bucket attempt isolation 不放宽；只有 matching current pending identity 可以触发 optimistic binding。
- [扩大到历史执行详情或请求放大] -> change scope 和 review 明确禁止新增 API、轮询、conversation fan-out 或 process-history hydration。

## 迁移计划（Migration Plan）

无持久化或 API 迁移。实现随同一个 Agent Web bundle 发布，页面刷新会自然清空旧的 frontend-only pending/cursor state。

回滚时整体回退本 change 的 Agent Web 私有状态和 hook 修改；backend、数据库和 public contract 无需回滚。若发布后出现回归，不得通过恢复 `acceptedAttemptId` 混合语义或增加页面刷新/轮询兜底，应回退该前端 bundle 并保留本 change 的复现测试用于修正。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-stream-history-consistency/spec.md`：归并 matching current run 的 identity binding、首事件和 terminal continuity。
- `openspec/specs/ts-stream-resume-replay/spec.md`：归并 consumer-accepted cursor 和 exact-run coverage。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/stream-projection.md`：归并 stream receive 到 consumer acceptance、cursor/recovery 的顺序。
- `openspec/designs/modules/agent-web.md`：归并三坐标 pending identity 和 conversation-store acceptance owner。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：更新 capability 到 Agent Web 设计与定向验证入口的导航。

## 待确认问题（Open Questions）

无。
