## 1. guardrail-gateway Function

- [ ] 1.1 对本 change 的 `agent-contracts/runtime` `RuntimeCommandPort.recordInputGuardBlock` 可选方法与 `RecordInputGuardBlockCommand` 完成契约确认，确认不新增 message role、stream event type、gateway port 或数据库表后再进入实现。
  验证：在 change review 记录中列出 contract delta、owner（`agent-runtime` 实现、`agent-channel-web` 调用）、消费者、兼容性（可选方法、旧 runtime 回退）和确认结论。
  来源：design 修改方案“后端契约”；仓库 agent-contracts 变更升级确认门禁。

- [ ] 1.2 在 `agent-contracts/runtime` 定义 `RecordInputGuardBlockCommand`（`identityContext`、`agentId`、`sessionId`、`inputText`、`refusalMessage`、`requestId`、`idempotencyKey`）并把 `recordInputGuardBlock?` 加到 `RuntimeCommandPort`；复用现有 `SessionMessageRecord`、`VisibilityReason="GUARD_BLOCKED"`、`SessionMessageStoreGateway.appendSessionMessage`，不新增 message role/stream event type/gateway port/数据库表。
  验证：`npm test -- packages/agent-contracts/tests/runtime-contract.test.ts` 与 `npm run test:contract`；negative fixtures 实际断言 identity scope mismatch、缺失 `requestId`/`idempotencyKey`、客户端 metadata override 被拒绝。
  来源：spec `A blocked round is excluded from model-visible history in subsequent rounds` 的 `Input-blocked round is displayed and survives page refresh` 与 `Input-blocked round persistence is idempotent` scenario；design 修改方案。

- [ ] 1.3 为当前 submit 拦截路径补 characterization tests，锁定“拦截抛 HTTP 400 `GUARD_INPUT_BLOCKED`、不调 `runtime.submit`、后端不持久化消息、前端伪造 local-optimistic 信封 + sessionStorage 镜像”的现状，并新增目标态断言（conversation 返回 `visible=false` 消息对、无 local-optimistic 信封）在实现前按预期失败。
  验证：`npm test -- packages/agent-channel-web/tests/guard-forward-routes.test.ts`、`frontend/agent-web` 运行 `npm test -- tests/requestStore.test.ts tests/chat-composer-controller.retry-guard-block.test.tsx tests/conversationStore.test.ts`；确认目标断言实现前失败、现状断言通过。
  来源：design GAP 分析；tasks characterization gate。

## 2. 后端持久化与 submit 路径

- [ ] 2.1 在 `agent-runtime` 实现 `RuntimeCommandPort.recordInputGuardBlock`：校验 identity scope（owner/Agent/session 一致，fail-closed），经 `SessionMessageStoreGateway.appendSessionMessage` 写入用户输入消息（`role=USER`、`visible=false`、`visibilityReason=GUARD_BLOCKED`、`metadata.guardPhase=INPUT_GUARD`）与拒答消息（`role=ASSISTANT`、content 为 `refusalMessage`、`visible=false`、`metadata.guardReason=INPUT_VIOLATION`），共享同一 `requestId`、无 `runId`；按 `idempotencyKey` 幂等不复制。
  验证：`npm test -- packages/agent-runtime/tests/`（新增 record-input-guard-block test）；覆盖正常写入、scope mismatch fail-closed、重复 idempotencyKey 不复制、refusal 不进 active context、raw error 不入 message。
  来源：spec `Input-blocked round is displayed and survives page refresh`、`Input-blocked round persistence is idempotent`、`Blocked round safe marker is not model-visible`；design 修改方案。

- [ ] 2.2 修改 `packages/agent-channel-web/src/routes/requests.ts` `submitStagedRequest`（:1307-1320）拦截分支：`!guardResult.isLegal` 时先生成 `requestId`，`await dependencies.runtime.recordInputGuardBlock?.(...)` 持久化消息对，再 `throw new AgentError({ code: "GUARD_INPUT_BLOCKED", message: guardResult.refusalMessage, ... })`；`recordInputGuardBlock` 未实现时回退当前行为并记录 safe diagnostic。
  验证：`npm test -- packages/agent-channel-web/tests/guard-forward-routes.test.ts packages/agent-channel-web/tests/requests-stream.test.ts`；断言拦截后 conversation 返回 `visible=true` + `metadata.modelVisibility.excluded=true` USER+ASSISTANT 消息对、`runtime.submit` 未被调用、HTTP 400 `GUARD_INPUT_BLOCKED` 与 `error.message` 不变、不向客户端流注入新事件、重复 submit 同 idempotencyKey 不复制。
  来源：spec `Input-blocked round is displayed and survives page refresh`、`Input-blocked round HTTP feedback remains unchanged`；design 修改方案。

- [ ] 2.3 验证 conversation 接口返回拦截轮消息对且 context assembly 排除：conversation route（`requests.ts:1878` 透传 `visible`）返回 `visible=true` 的 USER+ASSISTANT 消息（不被 `includeHidden:false` 过滤）；`agent-context-engine` `active-context-selector.ts`/`assemble-context.ts` `isHiddenReplacement` 新路径排除 `metadata.modelVisibility.excluded === true` 的消息。
  验证：`npm test -- packages/agent-channel-web/tests/conversation-route.test.ts packages/agent-context-engine/tests/history-candidate-selection.test.ts`；断言拦截轮在 conversation 响应中按真实时序出现、context assembly 不含该轮、下一轮 model context 不含拒答原文。
  来源：spec `Input-blocked round produces no model-visible assistant message`、`Blocked round safe marker is not model-visible`；design GAP 分析。

## 3. agent-web 前端删除

- [ ] 3.1 删除 `frontend/agent-web/src/state/guardInputBlockPersistence.ts` 整个文件，移除 `conversationStore.ts`（:19 import、:2110-2116 重灌块）与 `requestStore.ts`（:4 import、:656-685、:856-883 两处 `GUARD_INPUT_BLOCKED` 分支的 `tempUserEnvelope`/`guardBlockedEnvelope`/`appendEnvelope`/`saveGuardInputBlockTurn`）中对它的全部引用；保留 400 错误的 `submitError`/`requestStatus="failed"` 即时提示。
  验证：`frontend/agent-web` 运行 `npm test -- tests/requestStore.test.ts tests/conversationStore.test.ts tests/streamingHelpers.test.ts`；断言拦截时无 `local-optimistic` 信封追加、无 sessionStorage 读写、400 即时提示保留。
  来源：design 修改方案“前端删除”；spec `Input-blocked round is displayed and survives page refresh`（前端 MUST NOT 依赖本地伪造信封或 sessionStorage 镜像）。

- [ ] 3.2 删除 `useChatComposerController.ts`（:17 import、:532-556 编辑、:685-705 重试）的 `isInputGuardBlockedTurn` 特例与 `removeGuardInputBlockTurn` 调用，统一走 `editLatest`/`retryLatest`；若 `streamingHelpers.ts:90-98` `isInputGuardBlockedTurn` 无其他消费者则一并删除。
  验证：`frontend/agent-web` 运行 `npm test -- tests/chat-composer-controller.retry-guard-block.test.tsx tests/chat-composer-controller.identity-bootstrap.test.ts`；断言拦截轮编辑/重试走正常 editLatest/retryLatest 路径、不再“删旧 + 重新 submit”。
  来源：design 修改方案“前端删除”；design GAP 分析“拦截轮 retry/edit 走正常路径”。

- [ ] 3.3 前端 conversation adapter 确认从 history 重建 `visible=false` 拒答消息的渲染路径与 OUTPUT 护栏 refusal 一致（`conversationAdapter.ts` 已处理 `OUTPUT_GUARD_BLOCKED` 终态与 refusal 渲染），无需新增渲染分支。
  验证：`frontend/agent-web` 运行 `npm test -- tests/conversationAdapter.test.ts tests/answerContent.test.ts tests/buildTurnBlocks.test.ts`；覆盖拦截轮 USER+ASSISTANT refusal 两条 `visible=true` + `modelVisibility.excluded` message 重建为带拒答标记的 Turn、多轮时序正确、无重复。
  来源：spec `Input-blocked round is displayed and survives page refresh`；design 修改方案。

## 4. 跨 Function 共享验证与门禁

- [ ] 4.1 新增真实 browser 刷新对照旅程：输入拦截后记录当前页面拦截轮 snapshot，hard reload 清空前端缓存后只从 conversation 重建，比较拦截轮用户输入、拒答语、时序位置；覆盖关闭重开、锚定视图、older/newer 游标分页、多轮时序、编辑/重试拦截轮走正常路径。
  验证：`frontend/agent-web` 运行新增 Playwright spec 及 `npm run test:e2e -- tests/session-history-streaming.spec.ts`（按仓库实际 Playwright 入口命名），保存失败时 network/DOM/screenshot 证据；所有 semantic assertions 通过。
  来源：spec `Input-blocked round is displayed and survives page refresh`；design 验证映射。

- [ ] 4.2 运行完整门禁：`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`、`npm run build`、`frontend/agent-web` `npm run build` 与 `npm run build:vite:modes`；确认无 local-optimistic 残留、无 sessionStorage 引用、架构边界无回归、三宿主一致。
  验证：上述命令全部通过；`rg "guardInputBlockPersistence|saveGuardInputBlockTurn|loadGuardInputBlockEnvelopes|isInputGuardBlockedTurn" frontend/agent-web/src` 无残留引用（或仅剩无消费者的待删 helper 已清）。
  来源：proposal 全范围与非目标；design owner、KISS、兼容与三宿主约束；AGENTS.md 验证门禁。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 design 的“长期基线刷新计划”处理：

- 同步 `openspec/specs/guardrail-gateway/spec.md` 的 `A blocked round is excluded from model-visible history in subsequent rounds` Requirement（input-blocked 场景改为后端 `visible=true` + `metadata.modelVisibility.excluded` safe marker）。
- 更新 `openspec/designs/architecture/core-contracts.md`、`ts-backend-architecture.md`。
- 更新 `openspec/designs/modules/agent-channel-web.md`、`agent-runtime.md`、`agent-web.md`。
- 更新 `openspec/designs/spec-to-design-map.md`。
- 不更新 `openspec/overview.md`，不新增 ADR。
- 检查长期文档没有重复定义 `recordInputGuardBlock`、`metadata.modelVisibility` 或 input-guard 拦截轮契约。
