## 1. `FN-2.2 取消请求`

- [x] 1.1 在 cancel catch 路径编写 characterization test：无流式正文时 cancel（thinking 阶段取消），断言终端 content 为 `'Request canceled by user.'` 且不包含 `safeErrorContent` 输出；在修改生产代码前运行测试并确认断言按预期失败。
  来源：`FN-2.2 取消请求` + `Canceled run 终端 content 不得包含内部错误消息` + `无流式正文时 cancel 终端 content 使用固定占位字符串`、`cancel catch 路径与正常返回路径使用相同 fallback`。
  验证：`npx vitest run packages/agent-runtime/tests/ --reporter=dot -t "cancel.*terminal.*content"`；预期修改前 FAIL，终端 content 包含 `Request failed: Model invocation was canceled.`。

- [x] 1.2 修改 `submit.ts` cancel catch 路径：移除 `safeErrorContent(terminalError)` 分支，无流式正文时统一使用 `'Request canceled by user.'`；保持 `finalContent` 优先逻辑和 cancel 幂等键传递不变。
  来源：`FN-2.2 取消请求` + `Canceled run 终端 content 不得包含内部错误消息` + `cancel catch 路径与正常返回路径使用相同 fallback`、`不同执行阶段 cancel 产生相同终端 content`；design D1。
  验证：`npx vitest run packages/agent-runtime/tests/ --reporter=dot -t "cancel.*terminal.*content"`；预期 PASS，终端 content 为 `'Request canceled by user.'`。

- [x] 1.3 增加多阶段 cancel 覆盖测试：model thinking 阶段、model content 阶段、capability 执行阶段 cancel，断言无流式正文时终端 content 统一为 `'Request canceled by user.'`，有流式正文时保留 `finalContent`；断言终端 content 不 match `/Request failed:/` 或 `/Model invocation/`。
  来源：`FN-2.2 取消请求` + `Canceled run 终端 content 不得包含内部错误消息` + `不同执行阶段 cancel 产生相同终端 content`、`有流式正文时 cancel 终端 content 保留已生成内容`；design `验证策略`。
  验证：`npx vitest run packages/agent-runtime/tests/ --reporter=dot -t "cancel.*stage"`；预期全部 PASS。

- [x] 1.4 验证 cancel 正常返回路径和 non-catch cancel 路径不回归：有流式内容时 cancel，终端 content 保留流式内容；排队中请求 cancel 仍走 `commitCanceledRun`；cancel 幂等键正确传递。
  来源：`FN-2.2 取消请求` + `Canceled run 终端 content 不得包含内部错误消息` + `有流式正文时 cancel 终端 content 保留已生成内容`；design `验证策略`。
  验证：`npx vitest run packages/agent-runtime/tests/ --reporter=dot -t "cancel"`；预期全部 PASS，已有 cancel 测试不回归。

## 2. `FN-1.1 查看会话消息流`

- [x] 2.1 在 `buildTurnBlocks.resolveStatus` 编写测试：cancel-category（`category === 'CANCELED'`）的 `REQUEST_FAILED` 事件归一化为 `CANCELED` 状态；修改前运行确认失败。
  来源：`FN-1.1 查看会话消息流` + `Cancel 终端事件 content 不得进入前端答案正文区域` + `cancel-category REQUEST_FAILED 归一化为 CANCELED`。
  验证：`npx vitest run frontend/agent-web/src/features/chat/utils/ --reporter=dot -t "cancel.*REQUEST_FAILED"`；预期修改前 FAIL。

- [x] 2.2 修改 `buildTurnBlocks.resolveStatus`：遍历终端事件时，如果 `REQUEST_FAILED` 事件的 payload `category === 'CANCELED'`，返回 `'CANCELED'` 而非 `'FAILED'`。
  来源：`FN-1.1 查看会话消息流` + `Cancel 终端事件 content 不得进入前端答案正文区域` + `cancel-category REQUEST_FAILED 归一化为 CANCELED`；design D2。
  验证：`npx vitest run frontend/agent-web/src/features/chat/utils/ --reporter=dot -t "cancel.*REQUEST_FAILED"`；预期 PASS。

- [x] 2.3 在 `answerContent.ts` 编写测试：cancel-category `REQUEST_FAILED` 事件的 content 不作为答案 fallback；`FAILED_TERMINAL_PLACEHOLDER` 正则覆盖 `'Request canceled by user.'`；修改前运行确认失败。
  来源：`FN-1.1 查看会话消息流` + `Cancel 终端事件 content 不得进入前端答案正文区域` + `cancel-category REQUEST_FAILED content 不作为答案 fallback`、`固定占位文本不泄漏进答案正文区域`。
  验证：`npx vitest run frontend/agent-web/src/features/chat/presentation/ --reporter=dot -t "cancel.*fallback"`；预期修改前 FAIL。

- [x] 2.4 修改 `answerContent.ts`：`readTerminalAnswerFact` 中对 `REQUEST_FAILED` 事件增加 cancel-category 检查（`payload.category === 'CANCELED'` 时跳过）；`FAILED_TERMINAL_PLACEHOLDER` 正则扩展覆盖 `'Request canceled by user.'`。
  来源：`FN-1.1 查看会话消息流` + `Cancel 终端事件 content 不得进入前端答案正文区域` + `cancel-category REQUEST_FAILED content 不作为答案 fallback`、`固定占位文本不泄漏进答案正文区域`；design D3。
  验证：`npx vitest run frontend/agent-web/src/features/chat/presentation/ --reporter=dot -t "cancel.*fallback"`；预期 PASS。

- [x] 2.5 在 `conversationAdapter.ts` 编写测试：`assistant-terminal-` 前缀的 ASSISTANT 消息在 `resolveTerminalHistoryEventType` 返回 `null` 时，`toHistoryEnvelope` 不 fallback 到 `LLM_CONTENT_DELTA`，返回 `null`；修改前运行确认失败。
  来源：`FN-1.1 查看会话消息流` + `Cancel 终端事件 content 不得进入前端答案正文区域` + `history 加载时终端消息不 fallback 到 LLM_CONTENT_DELTA`；design D5。
  验证：`npx vitest run frontend/agent-web/src/features/chat/adapters/ --reporter=dot -t "terminal.*fallback"`；预期修改前 FAIL。

- [x] 2.6 修改 `conversationAdapter.ts`：`toHistoryEnvelope` 的 event type fallback 逻辑增加 `assistant-terminal-` 前缀检查——当消息 `messageId` 以 `assistant-terminal-` 开头且 `resolveTerminalHistoryEventType` 返回 `null` 时，不 fallback 到 `LLM_CONTENT_DELTA`，返回 `null`。
  来源：`FN-1.1 查看会话消息流` + `Cancel 终端事件 content 不得进入前端答案正文区域` + `history 加载时终端消息不 fallback 到 LLM_CONTENT_DELTA`；design D5。
  验证：`npx vitest run frontend/agent-web/src/features/chat/adapters/ --reporter=dot -t "terminal.*fallback"`；预期 PASS。

- [x] 2.7 在 `TurnBlock.tsx` 编写测试：cancel 无内容时答案正文区域展示 `turn.canceledWithoutAnswer` 的 i18n 文本；cancel 有内容时保留流式内容且不展示该提示；非 cancel 终态不展示该提示。
  来源：`FN-1.1 查看会话消息流` + `无流式正文时答案正文区域展示 i18n 友好提示` + `cancel 无内容时答案正文区域展示友好提示`、`cancel 有内容时答案正文区域保留流式内容`；design D4。
  验证：`npx vitest run frontend/agent-web/src/features/chat/components/ --reporter=dot -t "cancel.*answer.*notice"`；预期修改前 FAIL（正文区域无提示文本）。

- [x] 2.8 修改 `TurnBlock.tsx`：在 `status === 'CANCELED'` 且 `!hasAnswerContent` 且 `!isGuardBlocked` 时，于答案正文区域（分割线下方）渲染居中的 i18n 提示，使用 `t('turn.canceledWithoutAnswer')`；样式与 `CanceledNotice` 一致（`color: var(--color-text-tertiary)`, `fontSize: 12`, `textAlign: center`）；保持 `CanceledNotice` 不变。
  来源：`FN-1.1 查看会话消息流` + `无流式正文时答案正文区域展示 i18n 友好提示` + `cancel 无内容时答案正文区域展示友好提示`；design D4。
  验证：`npx vitest run frontend/agent-web/src/features/chat/components/ --reporter=dot -t "cancel.*answer.*notice"`；预期 PASS。

- [x] 2.9 编写 `TurnBlock` 渲染集成测试：cancel 场景答案正文区域不展示终端 content，只展示 `LLM_CONTENT_DELTA` 内容或 i18n 友好提示；`CanceledNotice` 使用 i18n 文本渲染；两种提示（上方灰字和正文区域居中提示）同时存在且互补。
  来源：`FN-1.1 查看会话消息流` + `Cancel 终端事件 content 不得进入前端答案正文区域` + `REQUEST_CANCELED content 不进入答案正文区域`、`无流式正文时答案正文区域展示 i18n 友好提示` + `cancel 无内容时答案正文区域展示友好提示`；design D4、D6。
  验证：`npx vitest run frontend/agent-web/src/features/chat/components/ --reporter=dot -t "cancel.*render"`；预期 PASS。


## 3. `FN-2.2 取消请求` — D7 requestContextId 一致性

- [x] 3.1 在 `commitCanceledRun` 编写 characterization test：cancel 作用于非执行中 run（pending input 或 queued 状态），断言 `REQUEST_CANCELED` 终端事件的 `requestContextId` 与原始请求的 `requestContextId` 一致，而非 `toControlContext` 生成的新 ID；修改前运行确认失败。
  来源：`FN-2.2 取消请求` + `Cancel 终端事件 requestContextId 与原始请求一致` + `非执行中 run cancel 终端事件使用原始 requestContextId`；design D7。
  验证：`npx vitest run packages/agent-runtime/tests/ --reporter=dot -t "cancel.*requestContextId"`；预期修改前 FAIL，终端事件 `requestContextId` 为 `context-cancel-xxx` 而非原始值。

- [x] 3.2 修改 `submit.ts`：在 `cancel()` 方法中将 `target.requestContextId`（来自 `RequestRunRecord`）传递给 `commitCanceledRun`；在 `commitCanceledRun` 中使用该原始 `requestContextId` 覆盖 `toControlContext` 生成的 `context.requestContextId`；保持 `toControlContext` 方法签名不变（其他调用者不受影响）。
  来源：`FN-2.2 取消请求` + `Cancel 终端事件 requestContextId 与原始请求一致` + `非执行中 run cancel 终端事件使用原始 requestContextId`、`执行中 run cancel 终端事件使用原始 requestContextId`；design D7。
  验证：`npx vitest run packages/agent-runtime/tests/ --reporter=dot -t "cancel.*requestContextId"`；预期 PASS，终端事件 `requestContextId` 与原始请求一致。

- [x] 3.3 增加覆盖测试：pending input 状态 cancel 和 queued 状态 cancel，断言 `REQUEST_CANCELED` 事件的 `requestContextId` 与 `REQUEST_ACCEPTED` 事件的 `requestContextId` 一致；断言两条 cancel 路径（catch 路径和 `commitCanceledRun` 路径）的 `requestContextId` 一致。
  来源：`FN-2.2 取消请求` + `Cancel 终端事件 requestContextId 与原始请求一致` + `执行中 run cancel 终端事件使用原始 requestContextId`；design D7。
  验证：`npx vitest run packages/agent-runtime/tests/ --reporter=dot -t "cancel.*requestContextId"`；预期全部 PASS。

## 4. `FN-1.1 查看会话消息流` — D8 terminal 事件 attemptId 放宽

- [x] 4.1 在 `conversationStore.appendEnvelopes` 编写测试：terminal 事件与已有 active bucket 的 `rootMessageId` 匹配但 `attemptId` 不同时，事件被接受（出现在 `acceptedEnvelopes` 中），active bucket 被移入 settled；修改前运行确认失败（事件被拒绝，出现在 `rejectedEnvelopes` 中）。
  来源：`FN-1.1 查看会话消息流` + `非执行中 run cancel 时前端状态正确收束` + `terminal 事件 attemptId 不匹配时仍被接受`；design D8。
  验证：`npx vitest run frontend/agent-web/src/state/ --reporter=dot -t "terminal.*attemptId.*mismatch"`；预期修改前 FAIL。

- [x] 4.2 修改 `conversationStore.ts` `appendEnvelopes`：在 `!matchesActive && (activeBucket || settledBucket)` 分支中，如果 envelope 是 terminal 事件且 `activeBucket` 存在（`rootMessageId` 匹配），接受该事件并将 active bucket 移入 settled（`terminal = true`）；non-terminal 事件仍保持严格 `attemptId` 匹配。
  来源：`FN-1.1 查看会话消息流` + `非执行中 run cancel 时前端状态正确收束` + `terminal 事件 attemptId 不匹配时仍被接受`；design D8。
  验证：`npx vitest run frontend/agent-web/src/state/ --reporter=dot -t "terminal.*attemptId.*mismatch"`；预期 PASS。

- [x] 4.3 编写集成测试：pending input run cancel 后 `resolveStatus` 返回 `CANCELED`（而非 `EXECUTING`），turn 状态显示已取消；queued run cancel 后 `resolveStatus` 返回 `CANCELED`，stop 按钮消失。
  来源：`FN-1.1 查看会话消息流` + `非执行中 run cancel 时前端状态正确收束` + `pending input run cancel 后状态收束为 CANCELED`、`queued run cancel 后状态收束为 CANCELED`；design D8。
  验证：`npx vitest run frontend/agent-web/src/features/chat/ --reporter=dot -t "cancel.*status.*converge"`；预期 PASS。

## 5. `FN-1.1 查看会话消息流` — D9 新 submit 重置 activeRequestRootMessageId

- [x] 5.1 编写回归测试：上一轮 cancel（`requestStatus='canceled'`、`activeRequestRootMessageId='msg-old'`）后发起新 `submitRequest`，断言 HTTP 在飞期间 `activeRequestRootMessageId === null` 且新 `pendingRequest` 存活；HTTP accept 后 `activeRequestRootMessageId` 更新为新 root。修改生产代码前运行确认失败（旧 root 残留）。
  来源：`FN-1.1 查看会话消息流` + `非执行中 run cancel 时前端状态正确收束`；design D9。
  验证：`cd frontend/agent-web && npx vitest run src/state/requestStore.terminalSettle.test.ts --reporter=dot -t "stale root"`；预期修改前 FAIL，修改后 PASS。

- [x] 5.2 修改 `requestStore.ts`：`submitRequest` 与 `submitRequestWithAttachments` 初始 `set()` 增加 `activeRequestRootMessageId: null`（同形同策，两个同类 submit 入口一并修复）。
  来源：`FN-1.1 查看会话消息流` + `非执行中 run cancel 时前端状态正确收束`；design D9。
  验证：`cd frontend/agent-web && npx vitest run src/state/requestStore.terminalSettle.test.ts --reporter=dot`；预期 11 个用例全部 PASS。

- [x] 5.3 浏览器端到端复现验证：同页面两轮 askUser + 非 UI cancel（监测脚本在 askUser 出现 10s 后调 cancel 接口），断言第二轮执行中过程数据（思考/能力调用/等待补充信息）正常展示，第二次 cancel 后两轮均展示「您已取消」而非停留在「NextAgent正在执行中...」。
  来源：用户实测场景；design D9 根因链。
  验证：本地全栈（`with-frontend` + `@nextagent/agent-web` artifact）+ in-app 浏览器实测；预期第二轮过程数据正常流式展示、cancel 后正确收束。

## 6. Change 整体验证

- [x] 6.1 完成 OpenSpec、前后端 build/test、contract 和 architecture 门禁，并确认没有新增公共 contract、Gateway schema、持久化表、配置项或 i18n key。
  来源：proposal `目标与非目标`、`影响范围`；design `验证策略`。
  验证：`openspec validate fix-cancel-terminal-content-leak --strict`、`openspec validate --all --strict`、`npm run build`、`cd frontend/agent-web && npm run build && npm test`、`npm run test:contract`、`npm run lint:architecture`；预期命令全部通过。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按 design 的"长期基线刷新计划"同步 stable spec（`request-cancel`、`ts-run-status-visibility`）、`FN-2.2 取消请求`、`FN-1.1 查看会话消息流`、`agent-runtime` module 和 spec-to-design-map；同步更新 `refine-ts-workflow-cancel-policy` D10 决策的 catch 路径 fallback 描述；补充 cancel 终端事件 `requestContextId` 一致性约束和前端 terminal 事件 acceptance 放宽规则；不新增 ADR，不重写已持久化的历史会话数据。
