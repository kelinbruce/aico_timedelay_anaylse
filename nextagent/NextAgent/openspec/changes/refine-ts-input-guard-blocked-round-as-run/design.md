## 设计范围（Scope）

本 change 修改单一 Function `guardrail-gateway`（canonical spec `openspec/specs/guardrail-gateway/spec.md`），目标把输入护栏拦截轮从"无 run 的二等公民 round（`recordInputGuardBlock`）"改为"走正常 `runtime.submit` 创建 run + 立即 `COMPLETED` 终态、不调模型"的一等公民 round，消除 5 个关联 bug 与全部前端特例。对应设计章节：下文 `guardrail-gateway` Function 章节。

## guardrail-gateway

### 目标与规范依据

消除输入拦截轮的二等公民身份：guard round 走正常 `runtime.submit` 创建 run，但在 run 持久化后、入队调模型前立即 `commitTerminal('COMPLETED', ...)` 终态化，content 为拒答文案。run 进入 `requestRunStore`，`retryLatest`/`editLatest`/`startSessionTitleGeneration` 全部走正常路径，零特例。guard round 的 USER + ASSISTANT 消息 `visible=true`（页面可见）+ `metadata.modelVisibility.excluded=true`（模型排除），现有 context assembly `isHiddenReplacement` 排除路径复用。前端走正常 stream（REQUEST_ACCEPTED → REQUEST_COMPLETED）与 conversation 重建，拒答文案作为 assistant 回复正常显示，前端不报失败（COMPLETED 非 FAILED）。

本 Function 的目标 Requirements：

- canonical spec：`openspec/specs/guardrail-gateway/spec.md`
- `MODIFIED`：`A blocked round is excluded from model-visible history in subsequent rounds`

### 当前实现

- `agent-runtime/src/lifecycle/submit.ts:5010` `recordInputGuardBlock`：写 USER + ASSISTANT 两条 `visible=true` 消息，共享 `guardRequestId`，**无 runId**，metadata 带 `modelVisibility.excluded=true`。不调用 `runtime.submit`、不创建 run。
- `agent-channel-web/src/routes/requests.ts:2078-2110` `submitStagedRequest` 拦截分支：调 `recordInputGuardBlock` 后抛 HTTP 400 `GUARD_INPUT_BLOCKED`。
- `agent-runtime/src/lifecycle/submit.ts:1522` `retryLatest`：从 `requestRunStore.loadSessionLaneSnapshot` 找源 run；guard round 无 run → `REQUEST_RETRY_NOT_FOUND`。
- `agent-runtime/src/lifecycle/submit.ts:6548` `generateSessionTitle`：只在 `runtime.submit` 成功路径调。
- `agent-runtime/src/terminal/terminal-commit.ts:19` `TerminalCommitOptions`：`guardBlocked?: boolean` → terminal message `visible=false`（OUTPUT 护栏用）。无"visible=true + modelVisibility.excluded"选项。
- `agent-context-engine/src/assembly/active-context-selector.ts:280` `isHiddenReplacement`：已排除 `metadata.modelVisibility.excluded === true` 的消息（`persist-ts-input-guard-blocked-round` 引入）。
- 前端 `agent-web/src/state/requestStore.ts:611/799` `GUARD_INPUT_BLOCKED` 分支：`removeRequestEnvelopes` + `submitError`，未 `refreshSessionSnapshot`。
- 前端 `agent-web/src/features/chat/hooks/useChatComposerController.ts:707` `handleRetryRequest`：guard round 无 run，retry 失效。
- 前端 `agent-web/src/pages/ChatPage.tsx:1209` `composerInlineNotice` 含 `submitError` → 拒答文案显示在消息框。

### GAP 分析

| 规范目标 | 当前事实 | 待闭合差距 |
|---|---|---|
| 拦截轮走正常 run 生命周期 | 无 run，二等公民 | 走 submit 创建 run + 立即 COMPLETED 终态 |
| 拦截轮不调模型 | 不调（因不 submit） | submit 后跳过 enqueueWork，模型循环不启动 |
| 拦截轮不进 model context | `modelVisibility.excluded` 排除（已实现） | 复用现有路径，terminal message 带该标记 |
| 拦截轮 retry/edit 走正常路径 | retryLatest 找不到（无 run） | run 进 requestRunStore，retryLatest 自然找到 |
| 拦截轮首条消息生成标题 | 不生成（不经 submit） | submit 路径自然触发 startSessionTitleGeneration |
| 前端无 guard 特例 | removeRequestEnvelopes/isGuardBlock/submitError 特例 | 走正常 stream + conversation 重建，删特例 |
| 前端不报失败 | HTTP 400 + submitError | COMPLETED 终态，前端走 REQUEST_COMPLETED 完成分支 |

### 修改方案

**契约（agent-contracts/runtime）**：

- `SubmitRequestCommand` 新增可选 `readonly guardBlockRefusal?: string`——非空时表示该 submit 是输入护栏拦截，content 为 RobotRouter 透传的拒答文案。
- 删除 `RuntimeCommandPort.recordInputGuardBlock?` 与 `RecordInputGuardBlockCommand`。

**terminal-commit（agent-runtime/src/terminal/terminal-commit.ts）**：

`TerminalCommitOptions` 新增（与 `guardBlocked` 互斥）：

```ts
/**
 * When set, the terminal assistant message is persisted visible=true (page
 * renders it) but carries metadata.modelVisibility.excluded=true so context
 * assembly keeps it out of model context. Used for input-guard-blocked rounds
 * that need a normal run lifecycle (retry/edit/title) but must not feed the
 * model. Mutually exclusive with guardBlocked.
 */
readonly guardBlockedVisible?: { readonly refusalMessage: string };
```

`commitTerminalOutcome` terminal message 构造（line 96-115）分支：
- `guardBlockedVisible` 时：`visible=true`，`content=refusalMessage`，`metadata` 加 `{ guardReason: 'INPUT_VIOLATION', modelVisibility: { excluded: true, reason: 'GUARD_BLOCKED' } }`（不带 `guardPhase`，避免触发前端 conversation adapter 的 INPUT_GUARD 投影，让 guard round 走正常 REQUEST_COMPLETED 终态路径）。
- `guardBlocked`（visible=false）语义不变，供 OUTPUT 护栏。
- 二者互斥：同时传抛错。

**submit（agent-runtime/src/lifecycle/submit.ts:1052）**：

在 `saveRun`（line 1198）之后、`emit REQUEST_ACCEPTED`（line 1222）之前插入：

```ts
if (command.guardBlockRefusal !== undefined) {
  await this.commitTerminal(
    finalCommand, run, context,
    command.guardBlockRefusal,    // content = refusalMessage（非空，不触发 MODEL_FINAL_CONTENT_EMPTY）
    'COMPLETED',
    { guardBlockedVisible: { refusalMessage: command.guardBlockRefusal } },
  );
  this.startSessionTitleGeneration(finalCommand, run);
  return { sessionId, requestId, runId, attempt: 1 };  // 不 enqueueWork，模型不启动
}
// 正常流程：emit REQUEST_ACCEPTED → startSessionTitleGeneration → enqueueWork
```

`return` 在 `enqueueWork`（line 1229）之前，模型工作循环不启动。run 状态 QUEUED → COMPLETED（经 commitTerminal）。terminal assistant 消息 visible=true + modelVisibility.excluded=true。

**web channel（agent-channel-web/src/routes/requests.ts:2078）**：

`!guardResult.isLegal` 分支改为：

```ts
if (!guardResult.isLegal) {
  return dependencies.runtime.submit({
    sessionId, identityContext, inputText, attachmentIds: [], locale,
    idempotencyKey,
    guardBlockRefusal: guardResult.refusalMessage,  // ← 新增
    ...(routingConstraints/modelOptions 透传),
  });
}
```

删除 `recordInputGuardBlock` 调用与 HTTP 400 `GUARD_INPUT_BLOCKED` 抛错。web channel 返回正常 `RequestAccepted`，前端走正常 stream 订阅。

**删除 recordInputGuardBlock**：

- `agent-runtime/src/lifecycle/submit.ts:5010` `recordInputGuardBlock` 方法删除。
- `agent-observability/src/runtime/runtime-command-wrapper.ts:101` 透传删除。
- `agent-session/src/services/question-activity-tracking-command-port.ts:59` 透传删除。

**前端删除特例（agent-web）**：

- `requestStore.ts:611/799` `GUARD_INPUT_BLOCKED` 分支：web channel 不再抛 400，此分支不再触发。删除两处分支（或保留为兜底，但 submitError 不再设）。
- `useChatComposerController.ts:707` `handleRetryRequest`：guard round 现在有 run（COMPLETED），`retryLatest` 能找到，统一走 `retryRequest(rootMessageId)`，删除 `isGuardBlock` 特例。
- `ChatPage.tsx:1209` `composerInlineNotice`：去掉 `submitError`（`uploadError ?? editError ?? retryError ?? cancelError`）。拒答文案走正常 stream 在会话列表显示，不在消息框。

**owner 边界**：web channel 只依赖 `RuntimeCommandPort.submit` 契约（带 `guardBlockRefusal`），不直接访问 `SessionMessageStoreGateway`。runtime 实现内部经 `commitTerminal` 写 terminal message。

**质量属性影响**：可靠性/恢复（retry/edit/标题走正常路径）、可维护性（消除二等公民与前端特例）、可测试性（统一 run 生命周期）。安全：拒答语仍由 RobotRouter 返回、透传不改写；`modelVisibility.excluded=true` 排除出 model context；不暴露 raw provider error。

## 长期基线刷新计划（Baseline Promotion Plan）

- 行为契约：`openspec/specs/guardrail-gateway/spec.md`——归并 input-blocked 轮走正常 submit + 立即 COMPLETED 终态、`guardBlockedVisible` terminal option、`modelVisibility.excluded` 排除、retry/edit/标题走正常路径契约。
- 架构：`openspec/designs/architecture/core-contracts.md`——归并 `guardBlockedVisible` 与 `guardBlocked` 的关系、guard round 的 run 生命周期。`ts-backend-architecture.md`——归并 web channel→runtime.submit(guardBlockRefusal)→commitTerminal 的 owner 协作。
- 模块：`agent-channel-web.md`——归并 submit 拦截路径调 submit 带 guardBlockRefusal。`agent-runtime.md`——归并 submit 内嵌护栏终态与 commitTerminal。`agent-web.md`——归并删除 guard 特例后的正常 stream/conversation 重建。
- ADR：无；本 change 沿用现有 run 生命周期、terminal commit、`modelVisibility.excluded` 决策。
- 导航：`openspec/designs/spec-to-design-map.md`——补充 guardrail-gateway input-guard-as-run 到上述模块与验证入口的导航。

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| submit 带 guardBlockRefusal 创建 run + 立即 COMPLETED 终态、不调模型 | T2 | `agent-runtime` submit/terminal-commit 测试、`runtime.submit` 未 enqueueWork 断言 |
| terminal message visible=true + modelVisibility.excluded + guardReason | T1、T2 | terminal-commit 测试、conversation route 返回断言 |
| guard round 不进 model context | T3 | `agent-context-engine` `history-candidate-selection.test.ts` |
| guard round retry/edit 走正常路径 | T4 | `retryLatest`/`editLatest` 找到 COMPLETED run 断言、前端 retry 测试 |
| 首条被拦生成标题 | T2 | submit 路径 startSessionTitleGeneration 断言 |
| 前端无 guard 特例、不报失败 | T4 | `requestStore`/`chat-composer-controller`/`ChatPage` 测试、COMPLETED 走完成分支 |
| 删除 recordInputGuardBlock 无残留 | T5 | `rg recordInputGuardBlock` 无 src 残留、architecture 测试 |
| 架构边界与三宿主一致 | T5 | `lint:architecture`、`build:vite:modes`、`openspec validate --all --strict` |
