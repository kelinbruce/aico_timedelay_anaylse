## 1. guardrail-gateway Function 契约

- [ ] 1.1 对本 change 的 `agent-contracts/runtime` `SubmitRequestCommand.guardBlockRefusal` 可选字段、`TerminalCommitOptions.guardBlockedVisible` 选项、删除 `recordInputGuardBlock`/`RecordInputGuardBlockCommand` 完成契约确认。确认不新增 message role、stream event type、gateway port、RunStatus 枚举值或数据库表后再进入实现。
  验证：change review 记录列出 contract delta、owner（`agent-runtime` 实现、`agent-channel-web` 调用）、消费者、兼容性（可选字段、旧 runtime 无 guardBlockRefusal 时走正常 submit）和确认结论。
  来源：design 修改方案"契约"；仓库 agent-contracts 变更升级确认门禁。

- [ ] 1.2 在 `agent-contracts/runtime` 给 `SubmitRequestCommand` 加可选 `readonly guardBlockRefusal?: string`；删除 `RuntimeCommandPort.recordInputGuardBlock?` 与 `RecordInputGuardBlockCommand`（`agent-contracts/src/runtime/index.ts`）。
  验证：`npm test -- packages/agent-contracts/tests/runtime-contract.test.ts` 与 `npm run test:contract`；negative fixtures 断言 `guardBlockRefusal` 为非空字符串、与 OUTPUT 护栏的 `guardBlocked` 互斥。
  来源：spec `A blocked round is excluded from model-visible history in subsequent rounds` 的 `Input-blocked round is a normal run for retry/edit/title` 与 `Input-blocked round does not surface as a failure` scenario；design 修改方案。

- [ ] 1.3 为当前 `recordInputGuardBlock` 路径补 characterization tests，锁定"拦截调 recordInputGuardBlock、抛 HTTP 400、无 run、前端 submitError/removeRequestEnvelopes 特例"的现状，并新增目标态断言（submit 带 guardBlockRefusal 创建 run + 立即 COMPLETED、不调模型、不抛 400）在实现前按预期失败。
  验证：`npm test -- packages/agent-channel-web/tests/guard-forward-routes.test.ts packages/agent-runtime/tests/submit-acceptance-order.test.ts`；确认目标断言实现前失败、现状断言通过。
  来源：design GAP 分析；tasks characterization gate。

## 2. 后端 submit 与 terminal-commit

- [ ] 2.1 在 `agent-runtime/src/terminal/terminal-commit.ts` 给 `TerminalCommitOptions` 加 `guardBlockedVisible?: { readonly refusalMessage: string }`（与 `guardBlocked` 互斥）；`commitTerminalOutcome` terminal message 构造分支：`guardBlockedVisible` 时 `visible=true`、`content=refusalMessage`、`metadata` 加 `{ guardReason: 'INPUT_VIOLATION', modelVisibility: { excluded: true, reason: 'GUARD_BLOCKED' } }`（不带 `guardPhase`，避免触发前端 conversation adapter 的 INPUT_GUARD 投影）；同时传 `guardBlocked` 与 `guardBlockedVisible` 抛错。`guardBlocked`（visible=false）语义不变。
  验证：`npm test -- packages/agent-runtime/tests/`（新增 terminal-commit guardBlockedVisible test）；覆盖 visible=true、modelVisibility.excluded、guardReason、互斥校验、content 非空不触发 MODEL_FINAL_CONTENT_EMPTY 降级。
  来源：spec `Input-blocked round is displayed and survives page refresh`、`Input-blocked round produces no model-visible assistant message`；design 修改方案。

- [ ] 2.2 在 `agent-runtime/src/lifecycle/submit.ts:1052` `submit` 的 `saveRun`（line 1198）之后、`emit REQUEST_ACCEPTED`（line 1222）之前插入 `guardBlockRefusal` 分支：`commitTerminal(finalCommand, run, context, command.guardBlockRefusal, 'COMPLETED', { guardBlockedVisible: { refusalMessage: command.guardBlockRefusal } })` → `startSessionTitleGeneration(finalCommand, run)` → `return { sessionId, requestId, runId, attempt: 1 }`，跳过 `enqueueWork`。run 状态 QUEUED → COMPLETED。删除 `recordInputGuardBlock` 方法（line 5010）。
  验证：`npm test -- packages/agent-runtime/tests/`（新增 submit guardBlockRefusal test）；断言 run 创建并 COMPLETED 终态、`enqueueWork` 未调用、模型未 invoke、USER 消息持久化、terminal ASSISTANT 消息 visible=true + modelVisibility.excluded、startSessionTitleGeneration 触发、idempotency 不重复。
  来源：spec `Input-blocked round produces no model-visible assistant message`、`Input-blocked round is a normal run for retry/edit/title`；design 修改方案。

- [ ] 2.3 删除 `agent-observability/src/runtime/runtime-command-wrapper.ts:101` 与 `agent-session/src/services/question-activity-tracking-command-port.ts:59` 的 `recordInputGuardBlock` 透传。
  验证：`rg "recordInputGuardBlock" packages/*/src` 无残留（除契约删除后的空引用）；`npm run lint:architecture`。
  来源：design 修改方案"删除 recordInputGuardBlock"。

## 3. web channel submit 路径

- [ ] 3.1 修改 `packages/agent-channel-web/src/routes/requests.ts:2078` `submitStagedRequest` 拦截分支：`!guardResult.isLegal` 时删除 `recordInputGuardBlock` 调用与 HTTP 400 `GUARD_INPUT_BLOCKED` 抛错，改为 `return dependencies.runtime.submit({ sessionId, identityContext, inputText, attachmentIds: [], locale, idempotencyKey, guardBlockRefusal: guardResult.refusalMessage, ...(routingConstraints/modelOptions 透传) })`。返回正常 `RequestAccepted`。
  验证：`npm test -- packages/agent-channel-web/tests/guard-forward-routes.test.ts`；断言拦截后 `runtime.submit` 被调用且带 `guardBlockRefusal`、`recordInputGuardBlock` 不被调用、不抛 HTTP 400、返回 RequestAccepted、前端走正常 stream。
  来源：spec `Input-blocked round does not surface as a failure to the frontend`、`Input-blocked round is displayed and survives page refresh`；design 修改方案。

- [ ] 3.2 验证 conversation 接口返回拦截轮消息对且 context assembly 排除：conversation route 返回 `visible=true` 的 USER+ASSISTANT 消息（含 `modelVisibility.excluded` + `guardReason`）；`agent-context-engine` `isHiddenReplacement` 排除 `modelVisibility.excluded === true` 的消息（现有路径，确认未被破坏）。
  验证：`npm test -- packages/agent-channel-web/tests/conversation-route.test.ts packages/agent-context-engine/tests/history-candidate-selection.test.ts`；断言拦截轮在 conversation 响应中按真实时序出现、context assembly 不含该轮、下一轮 model context 不含拒答原文。
  来源：spec `Input-blocked round produces no model-visible assistant message`、`Blocked round safe marker is not model-visible`。

## 4. agent-web 前端删除特例

- [ ] 4.1 `frontend/agent-web/src/state/requestStore.ts`：删除两处 `GUARD_INPUT_BLOCKED` 分支（line 611 主 submit、line 799 convenience submit）的 `removeRequestEnvelopes` + `submitError` 特例（web channel 不再抛 400，此分支不再触发）；确认 `submitError` 不再为拒答设置。
  验证：`frontend/agent-web` 运行 `npm test -- tests/requestStore.test.ts tests/requestStore.terminalSettle.test.ts`；断言拦截时无 submitError 设置、无 removeRequestEnvelopes 调用。
  来源：spec `Input-blocked round does not surface as a failure to the frontend`；design 修改方案。

- [ ] 4.2 `frontend/agent-web/src/features/chat/hooks/useChatComposerController.ts:707` `handleRetryRequest`：guard round 现在有 run（COMPLETED），统一走 `retryRequest(rootMessageId)`，删除 `isGuardBlock` 特例分支。
  验证：`frontend/agent-web` 运行 `npm test -- tests/chat-composer-controller.retry-guard-block.test.tsx`；断言拦截轮重试走 retryLatest、不再"删旧 + 重新 submit"。
  来源：spec `Input-blocked round is a normal run for retry/edit/title`；design 修改方案。

- [ ] 4.3 `frontend/agent-web/src/pages/ChatPage.tsx:1209` `composerInlineNotice`：去掉 `submitError`（`uploadError ?? editError ?? retryError ?? cancelError`）。拒答文案走正常 stream 在会话列表显示，不在消息框。
  验证：`frontend/agent-web` 运行 `npm test -- tests/ChatPage.test.tsx`（若有）或手动验证；断言拦截时 composer 区域不显示拒答文案、会话列表显示拒答 round。
  来源：spec `Input-blocked round does not surface as a failure to the frontend`；用户明确要求"把在消息框展示的这块代码直接删掉"。

## 5. 跨 Function 共享验证与门禁

- [ ] 5.1 新增真实 browser 刷新对照旅程：输入拦截后记录当前页面拦截轮 snapshot（含 run、USER 消息、拒答 assistant 消息），hard reload 后只从 conversation 重建，比较拦截轮用户输入、拒答语、时序位置、run 状态；覆盖：追问正常问题后刷新拦截轮仍在、被拦 round 点重试恢复原输入重新 submit、首条被拦生成标题、关闭重开、锚定视图、游标分页、多轮时序。
  验证：`frontend/agent-web` 运行新增 Playwright spec 及 `npm run test:e2e`（按仓库实际 Playwright 入口），保存失败时 network/DOM/screenshot 证据；所有 semantic assertions 通过。
  来源：spec `Input-blocked round is displayed and survives page refresh`、`Input-blocked round is a normal run for retry/edit/title`；design 验证映射。

- [ ] 5.2 运行完整门禁：`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`、`npm run build`、`frontend/agent-web` `npm run build` 与 `npm run build:vite:modes`；确认无 `recordInputGuardBlock`/`isGuardBlock`/`submitError` 拦截分支残留、架构边界无回归、三宿主一致。
  验证：上述命令全部通过；`rg "recordInputGuardBlock|isInputGuardBlockedTurn|guardInputBlockPersistence" packages/*/src frontend/agent-web/src` 无残留引用。
  来源：proposal 全范围与非目标；design owner、KISS、兼容与三宿主约束；AGENTS.md 验证门禁。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 design 的"长期基线刷新计划"处理：

- 同步 `openspec/specs/guardrail-gateway/spec.md` 的 `A blocked round is excluded from model-visible history in subsequent rounds` Requirement（input-blocked 场景改为走正常 submit + 立即 COMPLETED 终态、`guardBlockedVisible` terminal option、删除 `recordInputGuardBlock`）。
- 更新 `openspec/designs/architecture/core-contracts.md`、`ts-backend-architecture.md`。
- 更新 `openspec/designs/modules/agent-channel-web.md`、`agent-runtime.md`、`agent-web.md`。
- 更新 `openspec/designs/spec-to-design-map.md`。
- 不更新 `openspec/overview.md`，不新增 ADR。
- 检查长期文档没有重复定义 `recordInputGuardBlock`（应已删除）或 input-guard 拦截轮的二等公民契约。
