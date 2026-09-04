# 背景和现状（Context）

## 复现证据

使用 DeepSeek API（`deepseek-v4-flash`）在本地完整复现了 cancel 场景。关键发现：

**复现 1（thinking 阶段取消，无正文内容流式）：**

事件序列：`REQUEST_ACCEPTED → LLM_THINKING_DELTA(×N) → REQUEST_CANCELED`

`REQUEST_CANCELED` 事件 payload：
```json
{
  "status": "CANCELED",
  "content": "Request failed: Model invocation was canceled."
}
```

conversation 历史消息：
```
role=ASSISTANT visible=true
content="Request failed: Model invocation was canceled."
metadata={eventType: "REQUEST_CANCELED", status: "CANCELED"}
```

**复现 2（正文内容流式后取消）：**

事件序列：`REQUEST_ACCEPTED → LLM_THINKING_DELTA(×N) → LLM_CONTENT_DELTA(×15) → REQUEST_CANCELED`

终端 content 为已流式的中文正文，行为正确。

## 根因定位

`packages/agent-runtime/src/lifecycle/submit.ts` cancel catch 路径（约 4068-4090 行）：

```typescript
if (executionState.canceling || executionState.canceled) {
  const cancelOutput = this.runState.finishRun(run);
  const cancelContent = hasVisibleTerminalContent(cancelOutput.finalContent)
    ? cancelOutput.finalContent
    : hasVisibleTerminalContent(safeErrorContent(terminalError))
      ? safeErrorContent(terminalError)        // ← 问题根因
      : 'Request canceled by user.';
```

当取消发生在模型 thinking 阶段（无 `LLM_CONTENT_DELTA` 事件），`finalContent` 为空，走到 `safeErrorContent(terminalError)` 分支。`safeErrorContent()` 在 `failure-normalizer.ts` 中把 `AgentError.message`（来自 `safeModelInvocationFailure` 的 `'Model invocation was canceled.'`）包上 `'Request failed: '` 前缀，直接作为终端 content 持久化。

调用链：`safeModelInvocationFailure()` → `safeError.message = 'Model invocation was canceled.'` → `failModelTurn()` → `throw new AgentError({ message: safeError.message })` → catch block → `safeErrorContent(terminalError)` → `"Request failed: Model invocation was canceled."` → `commitTerminal()` → 持久化 + stream 投影。

## 与 `refine-ts-workflow-cancel-policy` D10 的关系

`refine-ts-workflow-cancel-policy`（active，0/全部 task 未完成）的 D10 决策明确写了：

> 内容保留：正常返回路径用 finishRun 提取 output.finalContent，有内容用回退内容，无内容 fallback 到 "Request canceled by user."。catch 路径同样用 finishRun 提取已有内容，fallback 到 safeErrorContent。

D10 的 catch 路径 fallback 设计是本问题的规格来源。本 change 修正 D10 的 catch 路径 fallback：从 `safeErrorContent` 改为 `'Request canceled by user.'`，与正常返回路径一致。`refine-ts-workflow-cancel-policy` 归档时应同步更新 D10 正文。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- cancel 终端 content 永远不包含内部错误消息。
- 前端答案正文区域在任何 cancel 场景下都不展示后端终端占位文本。
- 覆盖所有执行阶段的 cancel 场景。
- 前端防御性处理 cancel-category `REQUEST_FAILED` 竞态。
- 无流式正文时，答案正文区域内展示居中的 i18n 友好提示，而非完全空白。
- history 加载路径防御性处理：终端消息 content 不通过 `LLM_CONTENT_DELTA` fallback 泄漏进答案区域。
- cancel 作用于非执行中 run（pending input / queued）时，终端事件 `requestContextId` 与原始请求一致，前端正确接收并收束状态。
- 前端 conversation store 对 terminal 事件放宽 `attemptId` 匹配：同 `rootMessageId` 不同 `attemptId` 的 terminal 事件也接受，作为防御层。

**非目标：**
- 不新增 stream event、Web API、Gateway contract 或持久化表。
- 不新增 i18n key。
- 不改变 cancel 终态映射或 terminal commit 时序。
- 不重写已持久化的历史会话数据。

## 设计决策（Decisions）

### D1 cancel catch 路径移除 safeErrorContent，统一使用固定占位字符串

当前 cancel catch 路径的三级 fallback 为：`finalContent` → `safeErrorContent(terminalError)` → `'Request canceled by user.'`。改为两级：`finalContent` → `'Request canceled by user.'`。

理由：
- `safeErrorContent(terminalError)` 产生的英文错误消息（如 `"Request failed: Model invocation was canceled."`）是内部诊断信息，不是用户可见内容。
- cancel 正常返回路径（约 4012 行）已经使用 `'Request canceled by user.'` 作为 fallback，catch 路径应与之同策。
- 该固定字符串是中性的 cancel 占位文本，前端已通过 `CanceledNotice` 组件用 i18n 渲染取消提示，不需要后端提供 localized 文本。
- 该变更是 stage-agnostic 的：无论哪个执行阶段被 cancel 打断，catch 路径都使用同一固定字符串，不依赖 error 的 code/category/message。

影响范围：`agent-runtime/src/lifecycle/submit.ts` 约 2 行（移除 `safeErrorContent` 分支条件）。

### D2 前端 resolveStatus 归一化 cancel-category REQUEST_FAILED

存在竞态可能：cancel 设置 `canceling=true` 后 `controller.abort()`，但如果 abort error 在 `canceling` 被检查前传播，错误可能走正常失败路径，产生 `REQUEST_FAILED` 终端而非 `REQUEST_CANCELED`。该终端的 `failureReason.category` 为 `'CANCELED'`。

改动：`buildTurnBlocks.resolveStatus` 在遍历终端事件时，如果 `REQUEST_FAILED` 事件的 payload `category === 'CANCELED'`，归一化为 `CANCELED` 状态。

理由：
- cancel 引起的失败在语义上是取消，不是失败。
- 前端 `CanceledNotice` 已有完善的 i18n 提示，`FailedNotice` 不适合 cancel 场景。
- `failureReason.category` 来自后端 `AgentError.category`，cancel 类错误（如 `MODEL_ABORTED`）的 category 为 `'CANCELED'`，是可信的分类信号。

影响范围：`agent-web/src/features/chat/utils/buildTurnBlocks.ts` 约 2 行。

### D3 前端 readTerminalAnswerFact 跳过 cancel-category REQUEST_FAILED content

`TERMINAL_ANSWER_FALLBACK_EVENTS` 包含 `REQUEST_FAILED`，`readTerminalAnswerFact` 会用其 content 作为答案 fallback。`FAILED_TERMINAL_PLACEHOLDER` 正则只匹配 `"Request failed..."` 模式，不匹配 cancel 类 content（如 `"Model invocation was canceled."` 或 `'Request canceled by user.'`）。

改动：
- `readTerminalAnswerFact` 中对 `REQUEST_FAILED` 事件增加 cancel-category 检查：如果 `payload.category === 'CANCELED'`，跳过该事件（不作为答案 fallback）。
- `FAILED_TERMINAL_PLACEHOLDER` 正则扩展，覆盖 `'Request canceled by user.'` 占位文本。

理由：
- cancel 终端 content 不应进入答案正文区域，无论终端事件类型是 `REQUEST_CANCELED` 还是 cancel-category `REQUEST_FAILED`。
- 正则扩展覆盖 `'Request canceled by user.'` 确保历史加载路径也不泄漏。

影响范围：`agent-web/src/features/chat/presentation/answerContent.ts` 约 3 行。

### D4 无流式正文时答案正文区域展示 i18n 友好提示

当前 `TurnBlock` 在 `hasAnswerContent=false` 且 `isTerminal=true` 时，答案正文区域只渲染操作按钮（`assistant-action-region-failed`），没有友好提示。cancel 无内容时用户看到的是空白正文区域加分割线上方的灰色小字。

改动：当 `status === 'CANCELED'` 且 `!hasAnswerContent` 且 `!isGuardBlocked` 时，在答案正文区域渲染一个居中的 i18n 提示文本，使用已有 key `turn.canceledWithoutAnswer`（如「已取消，本次未生成回复内容。」）。该提示样式与 `CanceledNotice` 一致（`color: var(--color-text-tertiary)`, `fontSize: 12`, `textAlign: center`），位于分割线下方的答案正文区域内。

理由：
- 用户诉求"前端有友好性的展示"要求答案正文区域本身有可见反馈，而非完全空白。
- 已有 i18n key `turn.canceledWithoutAnswer` 语义完全匹配，不需要新增 key。
- `CanceledNotice`（分割线上方灰字）仍然保留，两者互补：上方是状态提示，正文区域是内容提示。
- 与 `FailedNotice` 的 `hasAnswerContent` 模式对称：FAILED 无内容时也在正文区域有提示。

影响范围：`agent-web/src/features/chat/components/TurnBlock.tsx` 约 5 行（在 cancel 无内容分支增加提示渲染）。

### D5 history 加载路径防御性处理

`conversationAdapter.ts` 的 `toHistoryEnvelope` 在 `resolveTerminalHistoryEventType` 返回 `null` 时，对 ASSISTANT 消息 fallback 到 `LLM_CONTENT_DELTA`。如果终端消息的 `metadata.eventType` 和 `metadata.status` 都丢失，且 content 不匹配已知占位模式，终端 content 会作为 `LLM_CONTENT_DELTA` 泄漏进答案区域。

当前 `resolveTerminalHistoryEventType` 已有三层识别：
1. `metadata.eventType` 在 `NON_COMPLETED_TERMINAL_EVENT_TYPES` 中 → 返回它
2. `metadata.status` 匹配已知终端状态 → 返回对应类型
3. `messageId` 以 `assistant-terminal-` 开头 → content 匹配已知模式

D1 修复后 content 变为 `'Request canceled by user.'`，路径 3 的 `content === 'Request canceled by user.'` 检查能正确识别为 `REQUEST_CANCELED`。但这是靠 content 字符串匹配的脆弱依赖。

改动：不修改 `resolveTerminalHistoryEventType` 本身（已有覆盖足够），但在 `toHistoryEnvelope` 中增加防御性检查：当 ASSISTANT 消息的 `messageId` 以 `assistant-terminal-` 开头但 `resolveTerminalHistoryEventType` 返回 `null` 时，不 fallback 到 `LLM_CONTENT_DELTA`，而是返回 `null`（跳过该消息，不生成 envelope）。

理由：
- `assistant-terminal-` 前缀是终端消息的可靠标识（由 `terminal-commit.ts` 的 `terminalMessageId` 生成）。
- 如果一个终端消息无法被识别为任何终端类型，它不应作为 `LLM_CONTENT_DELTA` 出现在答案区域。
- 该防御只在异常情况下触发（metadata 完全丢失），正常路径不受影响。

影响范围：`agent-web/src/features/chat/adapters/conversationAdapter.ts` 约 2 行（`toHistoryEnvelope` 的 event type fallback 逻辑增加前缀检查）。

### D6 不新增 i18n key，复用已有取消提示

已有 i18n key 完全覆盖 cancel 场景：
- `turn.canceledWithPartialContent`：有部分内容时显示（如「已取消，已保留取消前生成的部分内容。」）— 用于 `CanceledNotice`（分割线上方）
- `turn.canceledWithoutAnswer`：无内容时显示（如「已取消，本次未生成回复内容。」）— 用于 `CanceledNotice`（分割线上方）和 D4 的答案正文区域友好提示

理由：
- 后端不负责 localization，前端根据界面语言渲染 i18n 文本。
- 后端终端 content 是机器事实（用于持久化和模型上下文），不是用户可见文本。
- 已有 i18n 覆盖完整，不需要新增 key。


### D7 后端 commitCanceledRun 使用原始 requestContextId

当 cancel 作用于非执行中 run（pending input 或 queued）时，`commitCanceledRun` 通过 `toControlContext(command, run, 'context-cancel')` 创建新的 `requestContextId`。该新 ID 与原始请求的 `requestContextId` 不同，导致前端 conversation store 以 `getEnvelopeAttemptId()`（优先取 `requestContextId`）做 bucket 匹配时 `matchesActive = false`，`REQUEST_CANCELED` 事件被拒绝。

调用链：`cancel()` → `executing === undefined`（run 不在 `executingRuns`）→ `commitCanceledRun()` → `toControlContext()` → `requestContextId = this.id('context-cancel')` → `commitTerminal()` → `REQUEST_CANCELED` 事件携带新 `requestContextId` → stream 投影 → 前端 `appendEnvelopes` 拒绝。

对比：cancel 正常 catch 路径（run 在 `executingRuns` 中）使用 `work.context`（原始 `requestContextId`），事件 identity 一致，前端正确接收。retry/edit 路径的 `toControlContext` 用于新 run 的 terminal commit，identity 不同是预期的。supersede 路径同样使用 `toControlContext` 生成新 `requestContextId`，存在相同问题，但不在本 change 范围内（另立 follow-up）。

改动：在 `cancel()` 方法中，从 `pendingLaneWork` 中的 `QueuedRunWork.context.requestContextId`（queued run）或 `pendingInputStore.loadActivePendingInput()` 返回的 `PendingInputRecord.requestContextId`（pending input run）提取原始 `requestContextId`，传递给 `commitCanceledRun`。`RequestRunRecord` 本身不含 `requestContextId`，原始值只能从这两个来源获取。在 `commitCanceledRun` 中用该原始 `requestContextId` 替代 `toControlContext` 生成的新 ID。`toControlContext` 方法签名不变（其他调用者不受影响），在 `commitCanceledRun` 内部覆盖 `context.requestContextId`。

理由：
- `requestContextId` 是请求执行上下文的唯一标识，同一 run 的所有事件（`REQUEST_ACCEPTED`、`LLM_CONTENT_DELTA`、`USER_INPUT_REQUIRED`、终端事件）应共享同一 `requestContextId`。
- 前端 conversation store 依赖 `requestContextId` 作为 `attemptId` 做 bucket 匹配，identity 不一致会导致终端事件被拒绝。
- 该修复是 stage-agnostic 的：无论 run 处于 pending input、queued 还是其他非执行状态，cancel terminal commit 都使用原始 `requestContextId`。

影响范围：`agent-runtime/src/lifecycle/submit.ts` 约 12 行（`cancel()` 中从 queued work 或 pending input 提取 `requestContextId`，`commitCanceledRun` 接收并覆盖 `context.requestContextId`）。

### D8 前端 conversation store 对 terminal 事件放宽 attemptId 匹配

作为 D7 的防御层，前端 `conversationStore.appendEnvelopes` 对 terminal 事件放宽 `attemptId` 匹配。当前逻辑：terminal 事件与已有 active bucket 的 `rootMessageId` 匹配但 `attemptId` 不同时，事件被拒绝（`rejectedEnvelopes`）。

改动：在 `appendEnvelopes` 的 `!matchesActive && (activeBucket || settledBucket)` 分支中，如果 envelope 是 terminal 事件且 `activeBucket` 存在（`rootMessageId` 匹配），接受该事件并将 active bucket 移入 settled（标记为 terminal）。settled bucket 已存在且 `attemptId` 不同时，追加到 settled bucket。

理由：
- terminal 事件终结 run，无论 `attemptId` 是否匹配，都应能关闭对应的 active bucket。
- 该防御处理 D7 未覆盖的边界情况（如 supersede 路径的 `requestContextId` 不一致、未来新增的 control 操作）。
- 不影响 retry/edit 场景：retry/edit 的 `REQUEST_ACCEPTED` 事件以新 `attemptId` 创建新 bucket，旧 bucket 已被 terminal 事件关闭。
- 不影响 non-terminal 事件的 `attemptId` 严格匹配：non-terminal 事件仍需 `attemptId` 精确匹配。

影响范围：`agent-web/src/state/conversationStore.ts` `appendEnvelopes` 函数约 5 行（在 `!matchesActive` 分支中增加 terminal 事件接受逻辑）。

### D9 新 submit 重置 `activeRequestRootMessageId`，防止旧终端事件误杀新请求 pending identity

浏览器实测复现（同页面两轮 askUser + 非 UI cancel）：第一轮 cancel 正常收束；紧接着发送第二轮，过程数据完全不展示（只显示「NextAgent正在执行中...」），输入框区域出现 askUser 选项，10s 后 cancel 返回 200 且后端正确持久化 `REQUEST_CANCELED`，但对话面板永远停留在「NextAgent正在执行中...」，无任何过程数据和已取消提示。

根因链（已通过页面内插桩日志逐环确认）：

1. 第一轮 cancel 后 `settleRequestFromTerminal` 的 CANCELED/FAILED 分支**有意保留** `activeRequestRootMessageId`（用于把 canceled 状态映射到旧 turn block）；cancel safety net 也只清 `pendingRequest`/`activeRequestSessionId`，不动该字段。
2. 新一轮 `submitRequest` 初始 `set()` 只置 `requestStatus='submitting'` 与新 `pendingRequest`（乐观锚点 root 为临时 UUID），**不重置 `activeRequestRootMessageId`**，此时它仍是第一轮的旧 root。
3. `useChatSessionStream` 的 settle effect（`isExecuting && terminalForActiveRequest`）以旧 root 在 settled bucket 中读到第一轮的 `REQUEST_CANCELED`，identity 不匹配后走 force-settle 分支（`settleStaleSessionRequest`），把第二轮的 `pendingRequest` 清空。
4. 第二轮的流式 `REQUEST_ACCEPTED`（`acceptRequestFromStream`）与 submit HTTP 响应（`isCurrentPendingRequest`）都因 `pendingRequest === null` 跳过 `reconcileOptimisticRequest`，乐观锚点 bucket（临时 UUID root）与真实事件 bucket（`request-` 前缀 root）永久分裂。
5. 真实 bucket 没有 USER envelope，被 `buildLiveOnlyTurnBlocks` 跳过（`if (!userMsgEnv) continue`）→ 过程数据与已取消 UI 均不渲染；孤儿 bucket 只含乐观锚点、永远收不到终端事件 → 永远 EXECUTING。

第一轮不受影响的原因：首轮 submit 时 `activeRequestRootMessageId` 本就是 `null`，settle effect 不会触发。刷新页面后第二轮正常的原因：requestStore 重建后无残留 root。

改动：`submitRequest` 与 `submitRequestWithAttachments` 的初始 `set()` 增加 `activeRequestRootMessageId: null`——新 submit 开启新的身份生命周期，旧 root 属于上一个请求，不得继承。两处是同类 submit 入口，按同形同策一并修复。

理由：
- `activeRequestRootMessageId` 的不变量是"标识当前在飞请求的后端 root"；terminal 后保留它只是为了让 canceled/failed 状态映射到旧 turn block，一旦新 submit 开始，该映射已由旧 turn 的 settled bucket 自身（`resolveStatus` 读取桶内终端事件）承担，旧 root 不再被需要。
- 不改动 settle effect 的 force-settle 分支（它服务 askUser timeout 等 identity 不匹配兜底场景），也不改动 `settleRequestFromTerminal` 的保留语义（D4/D8 的取消展示依赖它）。
- retry/edit 路径不受影响：retry/edit 期间 `requestStatus` 为 `retrying`/`editing`，`isExecuting` 为 false，settle effect 不触发；其 `REQUEST_ACCEPTED` 到达后 root 更新为本请求身份。

影响范围：`agent-web/src/state/requestStore.ts` 两处各 1 行（含注释），回归测试 `requestStore.terminalSettle.test.ts` 新增 1 个用例。

## 验证策略（Verification）

### 后端验证

- cancel catch 路径 characterization test：无流式内容时 cancel，断言终端 content 为 `'Request canceled by user.'` 而非 `safeErrorContent` 输出。
- 多阶段 cancel 覆盖：model thinking 阶段、model content 阶段、capability 执行阶段 cancel，断言终端 content 不包含 error message。
- cancel 正常返回路径不回归：有流式内容时 cancel，终端 content 保留流式内容。
- cancel `requestContextId` 一致性 test：非执行中 run（pending input / queued）cancel 时，`REQUEST_CANCELED` 事件的 `requestContextId` 与原始请求一致，不为 `toControlContext` 生成的新 ID。

### 前端验证

- cancel-category `REQUEST_FAILED` 归一化：`resolveStatus` 对 `category === 'CANCELED'` 的 `REQUEST_FAILED` 返回 `CANCELED`。
- cancel-category `REQUEST_FAILED` content 不泄漏：`readTerminalAnswerFact` 跳过 cancel-category `REQUEST_FAILED`。
- `FAILED_TERMINAL_PLACEHOLDER` 正则覆盖 `'Request canceled by user.'`。
- `TurnBlock` 渲染：cancel 无内容时答案正文区域展示 i18n 友好提示；cancel 有内容时保留流式内容。
- history adapter 防御：`assistant-terminal-` 前缀消息无法识别终端类型时不 fallback 到 `LLM_CONTENT_DELTA`。
- conversation store terminal 事件 acceptance：terminal 事件与 active bucket `rootMessageId` 匹配但 `attemptId` 不同时被接受，active bucket 移入 settled。
- pending input / queued run cancel 后 `resolveStatus` 返回 `CANCELED`，stop 按钮消失。
- 新 submit 身份生命周期重置：上一轮 cancel 后发起新 submit，在飞期间 `activeRequestRootMessageId` 为 `null`，HTTP accept 后更新为新 root；无修复时该用例失败（旧 root 残留）。
- 浏览器端到端复现验证：同页面两轮 askUser + 非 UI cancel，第二轮过程数据正常展示，cancel 后两轮均展示「您已取消」。

### Negative case

- cancel 终端 content 不包含 `safeErrorContent` 输出（断言不 match `/Request failed:/` 或 `/Model invocation/` 等 error message 模式）。
- cancel-category `REQUEST_FAILED` content 不进入 `answerContent`。
- `assistant-terminal-` 前缀消息不生成 `LLM_CONTENT_DELTA` envelope。
- 非执行中 run cancel 的 `REQUEST_CANCELED` 事件 `requestContextId` 不为 `context-cancel-xxx`。
- terminal 事件 `attemptId` 不匹配时不进入 `rejectedEnvelopes`。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/request-cancel/spec.md`：新增 cancel 终端 content 不得包含内部错误消息、cancel 终端事件 `requestContextId` 与原始请求一致的 Requirement。
- `openspec/specs/ts-run-status-visibility/spec.md`：新增 cancel-category 终端事件 content 不得进入前端答案正文区域、无流式正文时答案正文区域展示 i18n 友好提示、非执行中 run cancel 时前端状态正确收束的 Requirement。
- `openspec/designs/functions/D2-请求运行时/D2.1-请求提交与控制/FN-2.2-取消请求.md`：处理过程补充终端 content 选择规则。
- `openspec/designs/functions/D1-会话与流式交互/D1.1-流式交互与恢复/FN-1.1-查看会话消息流.md`：补充 cancel 无内容时答案正文区域友好提示和 history 防御。
- `openspec/designs/modules/agent-runtime.md`：如已记录 cancel terminal content 选择逻辑，同步更新。
- `refine-ts-workflow-cancel-policy` D10：归档时同步更新 catch 路径 fallback 描述。
- ADR：无新增。
- spec-to-design-map：如涉及，同步更新引用。
