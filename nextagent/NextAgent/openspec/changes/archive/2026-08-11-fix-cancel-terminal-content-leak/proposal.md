## 背景与问题（Why）

用户通过 API（非界面）发送 cancel 请求取消正在执行的大模型调用时，前端答案正文区域展示了英文内部错误消息 `Model invocation was canceled.`。该文本出现在正常答案展示区域（分割线下方），分割线上方同时展示了灰色小字「已取消，已保留取消前生成的部分内容」，说明前端已正确识别 `CANCELED` 终态且 `hasAnswerContent=true`。

复现确认：后端 cancel catch 路径在无流式正文内容时，使用 `safeErrorContent(terminalError)` 作为终端 content，产生 `"Request failed: Model invocation was canceled."` 并持久化为 ASSISTANT terminal 消息和 `REQUEST_CANCELED` 事件 payload。该英文错误消息随后通过 stream 和 history 投影到达前端，泄漏进答案正文区域。

该问题不限于模型调用阶段：capability 执行、routing、sandbox、lifecycle hook、memory 等所有执行阶段被 cancel 打断时，都会经同一 catch 路径产生不同的英文错误消息作为终端 content。

此外，当无流式正文内容时，答案正文区域完全空白，仅在分割线上方有灰色小字提示，缺少正文区域内的友好性展示。

此外，当 cancel 作用于非执行中的 run（pending input 等待用户输入状态或 queued 排队状态）时，后端 `commitCanceledRun` 通过 `toControlContext` 生成新的 `requestContextId`，导致 `REQUEST_CANCELED` 终端事件的 `requestContextId` 与原始请求不一致。前端 conversation store 以 `requestContextId` 作为 `attemptId` 进行 bucket 匹配，identity 不匹配时拒绝该终端事件。被拒绝后 `handleTerminalEvent` 不被调用，`resolveStatus` 找不到终端事件，turn 状态保持 `EXECUTING`；对 queued run（无 pending input），连 `USER_INPUT_CANCELED` 兜底也没有，stop 按钮常驻不消失。

此外，实测发现同页面连续两轮 askUser + 非 UI cancel 场景：第一轮 cancel 正常收束后，紧接着发送的第二轮过程数据完全不展示（只显示「NextAgent正在执行中...」），输入框区域出现 askUser 选项，10s 后 cancel 返回 200 且后端正确持久化 `REQUEST_CANCELED`，但对话面板永远停留在执行中状态，无任何过程数据和已取消提示。根因：上一轮 cancel 后 `activeRequestRootMessageId` 残留旧 root，新一轮 submit 不重置该字段，`useChatSessionStream` 的 settle effect 用旧 root 读到旧 `REQUEST_CANCELED` 并 force-settle 杀掉新请求的 `pendingRequest`，导致乐观锚点 bucket 与真实事件 bucket 永久分裂（真实 bucket 无 USER envelope 被投影层跳过，孤儿 bucket 永远 EXECUTING）。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- cancel 终端 content 永远不包含内部错误消息；无流式正文时使用固定中性占位字符串，有流式正文时保留已生成内容。
- 前端答案正文区域在任何 cancel 场景下都不展示后端终端占位文本或错误消息；取消提示由前端 i18n 随界面语言渲染。
- 覆盖所有执行阶段的 cancel 场景：模型调用、capability 执行、routing、sandbox、lifecycle hook、memory 等。
- 前端防御性处理 cancel-category `REQUEST_FAILED` 竞态：status 归一化为 `CANCELED`，content 不进入答案区域。
- 无流式正文时，答案正文区域内展示居中的 i18n 友好提示（如「已取消，本次未生成回复内容。」），而非完全空白。
- history 加载路径防御性处理：终端消息被误判为 `LLM_CONTENT_DELTA` 时，cancel 占位文本不进入答案区域。
- cancel 作用于非执行中 run（pending input / queued）时，终端事件 `requestContextId` 与原始请求一致，前端正确接收并收束状态。
- 前端 conversation store 对 terminal 事件放宽 `attemptId` 匹配：同 `rootMessageId` 不同 `attemptId` 的 terminal 事件也接受，作为防御层。
- 上一轮 cancel 后在同页面发起新 submit 时，新请求的身份生命周期不受旧 root 残留影响：过程数据正常流式展示，cancel 后正确收束为已取消。

**非目标：**

- 不新增 stream event 类型、Web API、Gateway contract 或持久化表。
- 不新增 i18n key；复用已有 `turn.canceledWithPartialContent` / `turn.canceledWithoutAnswer`。
- 不改变 cancel 终态映射（`CANCELED` 保持）、cancel 幂等机制或 terminal commit 时序。
- 不重写已持久化的历史会话数据。
- 不改变 `REQUEST_CANCELED` 事件类型或 stream projection vocabulary。

## 变更范围（What Changes）

- 修改 cancel catch 路径终端 content 选择逻辑：移除 `safeErrorContent(terminalError)` 分支，无流式正文时统一使用 `'Request canceled by user.'`，与 cancel 正常返回路径一致。
- 修改前端 `resolveStatus`：cancel-category（`category === 'CANCELED'`）的 `REQUEST_FAILED` 事件归一化为 `CANCELED` 状态。
- 修改前端 `readTerminalAnswerFact`：cancel-category `REQUEST_FAILED` 事件的 content 不作为答案 fallback。
- 修改前端 `FAILED_TERMINAL_PLACEHOLDER` 正则：覆盖 `'Request canceled by user.'` 占位文本，确保历史加载时不泄漏进答案区域。
- 修改前端 `TurnBlock`：cancel 且无答案内容时，在答案正文区域渲染居中的 i18n 友好提示，替代空白。
- 修改前端 `conversationAdapter`：`resolveTerminalHistoryEventType` 对 cancel 终端消息的 content 匹配增加 `'Request canceled by user.'` 已有覆盖确认，并确保 `metadata.status === 'CANCELED'` 路径在 `eventType` 缺失时仍能正确识别。
- 修改后端 `commitCanceledRun`：使用 run record 的原始 `requestContextId` 而非 `toControlContext` 生成的新 ID，确保 `REQUEST_CANCELED` 终端事件 identity 与原始请求一致。
- 修改前端 `conversationStore.appendEnvelopes`：terminal 事件与已有 active bucket 的 `rootMessageId` 匹配但 `attemptId` 不同时，接受该事件并将 active bucket 移入 settled，作为防御层。
- 修改前端 `requestStore.submitRequest` / `submitRequestWithAttachments`：新 submit 初始状态重置 `activeRequestRootMessageId: null`，避免旧 turn 的终端事件被 settle effect 误匹配并清空新请求的 pending identity。

## Capability 影响（Capabilities）

### 修改的 Capability

- `request-cancel`：cancel 终端 content 不得包含内部错误消息，无流式正文时使用固定中性占位字符串；cancel 终端事件 `requestContextId` 与原始请求一致。
- `ts-run-status-visibility`：cancel-category 终端事件的 content 不得进入前端答案正文区域；无流式正文时答案正文区域展示 i18n 友好提示；非执行中 run cancel 时前端状态正确收束为 CANCELED。

## 影响范围（Impact）

- `agent-runtime`：`submit.ts` cancel catch 路径 terminal content 选择逻辑（约 2 行变更）。
- `agent-web`：`answerContent.ts` 正则和 fallback 过滤、`buildTurnBlocks.ts` status 归一化、`TurnBlock.tsx` cancel 无内容时的友好提示渲染、`conversationAdapter.ts` history 终端识别防御（约 5 处变更）。
- `refine-ts-workflow-cancel-policy` D10 决策：catch 路径 fallback 从 `safeErrorContent` 改为固定字符串，需同步更新该 active change 的 design。
- `agent-runtime`：`submit.ts` `commitCanceledRun` 的 `requestContextId` 来源调整（约 3 行变更）。
- `agent-web`：`conversationStore.ts` `appendEnvelopes` terminal 事件 acceptance 放宽（约 5 行变更）。
- `agent-web`：`requestStore.ts` 两个 submit 入口各 1 行变更 + `requestStore.terminalSettle.test.ts` 回归测试。
- 跨 package 边界不变，无新公共 contract。
