## 设计范围（Scope）

本 change 修改单一 Function `guardrail-gateway`（canonical spec `openspec/specs/guardrail-gateway/spec.md`），目标把输入护栏拦截轮的持久化归属从前端 `sessionStorage` 镜像移到后端 `visible=true` + `metadata.modelVisibility.excluded=true` safe marker，消除双数据源刷新错乱。涉及 delta spec：`specs/guardrail-gateway/spec.md`（MODIFIED `A blocked round is excluded from model-visible history in subsequent rounds` Requirement 的 input-blocked 场景）。对应设计章节：下文 `guardrail-gateway` Function 章节。

## guardrail-gateway

### 目标与规范依据

消除输入拦截轮的双数据源：服务器成为该轮的唯一权威来源，前端不再伪造 `local-optimistic` 信封或维护 `sessionStorage` 镜像。拦截轮在后端持久化为 `visible=true` 的用户输入消息与拒答消息（携带 `metadata.modelVisibility.excluded=true`），经 conversation 返回（`visible=true` 不被 `includeHidden=false` 过滤），刷新/关闭重开/锚定/游标分页后按真实时序可见；context assembly 因 `metadata.modelVisibility.excluded=true` 排除它不进 model context。页面可见（`visible`）与模型可见（`modelVisibility.excluded`）解耦。HTTP 400 `GUARD_INPUT_BLOCKED` 即时反馈契约不变。

本 Function 的目标 Requirements：

- canonical spec：`openspec/specs/guardrail-gateway/spec.md`
- `MODIFIED`：`A blocked round is excluded from model-visible history in subsequent rounds`

### 当前实现

- 后端 submit 路径 `packages/agent-channel-web/src/routes/requests.ts` 的 `submitStagedRequest`（:1292-1320）：`dependencies.guardrail.checkQuestion` 返回 `isLegal=false` 时直接 `throw new AgentError({ code: "GUARD_INPUT_BLOCKED", ... })`（HTTP 400），不调用 `runtime.submit`，不持久化任何消息。
- 前端 `frontend/agent-web/src/state/requestStore.ts`（:656-685、:856-883 两处 `GUARD_INPUT_BLOCKED` 分支）：构造 `tempUserEnvelope`（`local-optimistic` `REQUEST_ACCEPTED`）与 `guardBlockedEnvelope`（`local-optimistic` `OUTPUT_GUARD_BLOCKED`/`phase=INPUT_GUARD`），`appendEnvelope` 进 live 层，`saveGuardInputBlockTurn` mirror 到 `sessionStorage`。
- 前端 `frontend/agent-web/src/state/guardInputBlockPersistence.ts`：`sessionStorage` 读写，key 为 `na-guard-input-blocked:<sessionId>`。
- 前端 `frontend/agent-web/src/state/conversationStore.ts`（:2110-2116）：`loadConversation` 末尾 `loadGuardInputBlockEnvelopes` 重灌进 live 层（`appendEnvelopes`），仅在主 load 路径，`loadAnchoredConversation`/游标分页不重灌。
- 前端 `frontend/agent-web/src/features/chat/hooks/useChatComposerController.ts`（:532-556、:685-705）：`isInputGuardBlockedTurn` 特例使编辑/重试走"删旧轮 + 重新 submit"而非正常 `editLatest`/`retryLatest`。
- 现有 `RuntimeCommandPort`（`packages/agent-contracts/src/runtime/index.ts:1089-1107`）：`submit`/`cancel`/`retryLatest`/`editLatest`/`hideRunMessages` 均操作已有 run；`hideRunMessages` 隐藏已有 run 的 assistant 消息为 `visible=false`（`VisibilityReason="GUARD_BLOCKED"`），由 OUTPUT 护栏经 `websocket.ts:89-103` 调用。
- 现有 `SessionMessageStoreGateway.appendSessionMessage`（`packages/agent-contracts/src/gateway/index.ts:1791`）：底层消息写入，由 `agent-platform-gateway-local` SQLite 实现。
- 现有 context assembly `active-context-selector.ts:207-216` 与 `assemble-context.ts:1595-1607` 的 `isHiddenReplacement`：排除 `!record.visible` 与 `metadata.replacement.kind` 存在的消息；**不**排除 `visible=true` 但需模型排除的消息——本 change 新增第 4 条路径 `metadata.modelVisibility.excluded === true` 填补该缺口。
- 现有 conversation 投影 `requests.ts:1878`：透传 `msg.visible`。

### GAP 分析

| 规范目标 | 当前事实 | 待闭合差距 |
|---|---|---|
| 拦截轮单一数据源 = 服务器 | 后端不持久化，前端 `sessionStorage` 副本 | 后端持久化 `visible=true` + `modelVisibility.excluded` 消息对，前端删除副本 |
| 拦截轮刷新/锚定/分页后可见 | 仅主 `loadConversation` 重灌进 live 层 | 作为普通 history 消息自动随各路径返回 |
| 拦截轮按真实时序排序 | `sequence=0` + 客户端时钟，排序脆弱 | 服务器分配 sequence，`createdAt` 由后端 clock |
| 拦截轮不进 model context | 前端副本本就不进；但无服务端 safe marker | `visible=true` + `modelVisibility.excluded=true` safe marker 经 context assembly 新路径排除 |
| 拦截轮 retry/edit 走正常路径 | 前端特例"删旧 + 重新 submit" | 有后端终态后统一走 `editLatest`/`retryLatest` |
| `RuntimeCommandPort` 能记录无 run 拦截轮 | 无此能力，`hideRunMessages` 需已有 run | 新增 `recordInputGuardBlock` |

### 修改方案

**后端契约（agent-contracts/runtime）**：`RuntimeCommandPort` 新增可选方法：

```ts
recordInputGuardBlock?(command: RecordInputGuardBlockCommand): Promise<void>;

interface RecordInputGuardBlockCommand {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly inputText: string;
  readonly refusalMessage: string;
  readonly requestId: MessageId;       // 由 web channel 生成，关联两条消息
  readonly idempotencyKey: IdempotencyKey;
}
```

与 `hideRunMessages` 对称：一个 hide 已有 run 消息，一个 record 无 run 拦截轮。`requestId` 由 web channel 生成（`crypto.randomUUID` 等价），不关联 `runId`（无 run）。identity 来自 trusted owner/Agent/session scope，不接受客户端 metadata override。不新增 message role、stream event type、gateway port 或数据库表——复用 `SessionMessageRecord`、`VisibilityReason="GUARD_BLOCKED"`、`SessionMessageStoreGateway.appendSessionMessage`。

**后端实现（agent-runtime）**：`recordInputGuardBlock` 实现内部：
1. 校验 identity scope（owner/Agent/session 一致，fail-closed）。
2. 经 `SessionMessageStoreGateway.appendSessionMessage` 写入用户输入消息：`{ role: "USER", content: inputText, contentType: "PLAIN_TEXT", visible: true, requestId, sessionId, agentId, metadata: { guardPhase: "INPUT_GUARD", modelVisibility: { excluded: true, reason: "GUARD_BLOCKED" } }, createdAt: clock() }`。
3. 写入拒答消息：`{ role: "ASSISTANT", content: refusalMessage, contentType: "PLAIN_TEXT", visible: true, requestId, sessionId, agentId, metadata: { guardPhase: "INPUT_GUARD", guardReason: "INPUT_VIOLATION", modelVisibility: { excluded: true, reason: "GUARD_BLOCKED" } }, createdAt: clock() }`。
4. 幂等：`appendSessionMessage` 的 `IdempotentWriteOptions` 按 `idempotencyKey` 防重复写；重复触发不复制消息对。

**web channel submit 路径（agent-channel-web/src/routes/requests.ts `submitStagedRequest`）**：`!guardResult.isLegal` 分支改为：
1. 生成 `requestId`（`crypto.randomUUID` 等）。
2. `await dependencies.runtime.recordInputGuardBlock?.({ identityContext, agentId: session.agentId, sessionId, inputText: request.inputText, refusalMessage: guardResult.refusalMessage, requestId, idempotencyKey })`。
3. 仍 `throw new AgentError({ code: "GUARD_INPUT_BLOCKED", message: guardResult.refusalMessage, ... })`（HTTP 400 即时反馈不变）。
4. `recordInputGuardBlock` 为可选方法：若 runtime 未实现（旧 runtime），回退为当前行为（不持久化、仅 400），前端仍可凭 400 展示（但刷新丢失——可接受的渐进降级，记录 safe diagnostic）。

**前端删除（agent-web）**：
- 删除 `guardInputBlockPersistence.ts` 整个文件。
- `requestStore.ts` 两处 `GUARD_INPUT_BLOCKED` 分支：删除 `tempUserEnvelope`/`guardBlockedEnvelope` 构造、`appendEnvelope`、`saveGuardInputBlockTurn`；保留 400 错误的 `submitError`/`requestStatus="failed"` 即时提示。
- `conversationStore.ts`：删除 `:2110-2116` 重灌块与 `:19` import。
- `useChatComposerController.ts`：删除 `isInputGuardBlockedTurn` 编辑/重试特例（:532-556、:685-705），统一走 `editLatest`/`retryLatest`；删除 `removeGuardInputBlockTurn` 调用与 import（:17）。
- `streamingHelpers.ts` `isInputGuardBlockedTurn`（:90-98）：若无其他消费者则删除。

**context assembly 排除路径（agent-context-engine）**：`active-context-selector.ts:207` 与 `assemble-context.ts:1595` 的 `isHiddenReplacement` 新增第 4 条路径——在现有 `!visible` / `PERSISTED_PREVIEW` 例外 / `replacement.kind` 三条之后，加 `metadata.modelVisibility.excluded === true → return true`。纯 additive，不修改现有三条路径行为。

**command port 透传（agent-session）**：`createQuestionActivityTrackingCommandPort`（LOCAL deployment 包裹层）手动列举透传的 `RuntimeCommandPort` 方法，新增 `recordInputGuardBlock` 透传 `...(inner.recordInputGuardBlock === undefined ? {} : { recordInputGuardBlock: inner.recordInputGuardBlock.bind(inner) })`，否则 web channel 拿到的 tracked port 上 `recordInputGuardBlock === undefined`，拦截分支跳过持久化。

**owner 边界**：web channel 只依赖 `RuntimeCommandPort` 契约，不直接访问 `SessionMessageStoreGateway`（gateway store 由 runtime 实现内部使用），保持现有 owner 分层。conversation 读路径（`RuntimeSessionPort.listMessages`）不变，拦截轮作为 `visible=true` 消息自动返回（不被 `includeHidden=false` 过滤）。

**质量属性影响**：可靠性/恢复（刷新/关 tab/锚定/分页一致）、可维护性（消除双数据源与前端特例）、审计/可追溯性（拦截轮进入服务端持久化与审计面）。安全：拒答语仍由 RobotRouter 返回、NextAgent 透传不改写；`metadata.modelVisibility.excluded=true` 使 context assembly 排除，不进 model context；不暴露 raw provider error/credential/endpoint。无新增黑盒质量目标，均由 `A blocked round is excluded from model-visible history in subsequent rounds` 派生。

## 长期基线刷新计划（Baseline Promotion Plan）

- 行为契约：`openspec/specs/guardrail-gateway/spec.md`——归并 input-blocked 轮后端 `visible=true` + `metadata.modelVisibility.excluded` safe marker 持久化、`recordInputGuardBlock` runtime command、conversation 返回、刷新可见与 model-context 排除契约。
- 长期背景：`openspec/overview.md`——无；该问题是现有 visible-message history 不变量对 input-guard 例外的收敛。
- 架构和跨模块设计：`openspec/designs/architecture/core-contracts.md`——归并 `recordInputGuardBlock` 与 `hideRunMessages` 的对称关系、`metadata.modelVisibility` 与 `visible` 字段的解耦。`openspec/designs/architecture/ts-backend-architecture.md`——归并 web channel→runtime command→gateway store 的 owner 协作。
- 模块设计：`openspec/designs/modules/agent-channel-web.md`——归并 submit 拦截路径调用 `recordInputGuardBlock`。`openspec/designs/modules/agent-runtime.md`——归并 `recordInputGuardBlock` 实现与 `appendSessionMessage` 写入。`openspec/designs/modules/agent-web.md`——归并删除本地伪造与 sessionStorage 镜像后的 history 重建。
- ADR：无；本 change 沿用现有 visible-message history、runtime command 决策，新增 `metadata.modelVisibility` 作为页面/模型可见性解耦的 additive extension。
- 导航：`openspec/designs/spec-to-design-map.md`——补充 `guardrail-gateway` input-guard 持久化到上述模块与验证入口的导航。

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `recordInputGuardBlock` 契约与负向校验 | T1、T2 | `agent-contracts` runtime contract tests、negative fixtures |
| submit 拦截持久化消息对、不调 `runtime.submit` | T2 | `agent-channel-web` submit route tests、`runtime.submit` 未被调用断言 |
| 幂等不重复写 | T2 | idempotent replay test |
| conversation 返回 `visible=true` 消息对 | T3 | `agent-channel-web` conversation route test、probe 脚本 |
| context assembly 排除 `modelVisibility.excluded` | T3 | `agent-context-engine` `history-candidate-selection.test.ts` |
| 前端无 local-optimistic 信封/sessionStorage | T4 | `requestStore`/`conversationStore`/`buildTurnBlocks` tests |
| 前端编辑/重试走正常路径 | T4 | `chat-composer-controller.retry-guard-block.test.tsx` |
| 刷新/锚定/分页后拦截轮可见且时序正确 | T5 | Playwright 刷新对照旅程、多轮时序断言 |
| HTTP 400 `GUARD_INPUT_BLOCKED` 不变 | T2、T3 | submit route + 前端即时提示断言 |
| 架构边界与三宿主一致 | T6 | `lint:architecture`、`build:vite:modes`、`openspec validate --all --strict` |
