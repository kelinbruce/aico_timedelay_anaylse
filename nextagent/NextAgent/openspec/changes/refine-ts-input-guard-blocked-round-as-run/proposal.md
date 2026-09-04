## 背景与问题（Why）

`persist-ts-input-guard-blocked-round` 把输入护栏拦截轮从前端 `sessionStorage` 镜像改为后端 `recordInputGuardBlock` 持久化，消除了双数据源。但它引入了一个"无 run 的二等公民 round"：`recordInputGuardBlock` 写 USER + ASSISTANT 两条 `visible=true` 消息，**故意不创建 run、不调用 `runtime.submit`**。这个二等公民身份导致 5 个关联 bug：

1. **重试不生效**：`retryLatest`（`agent-runtime/src/lifecycle/submit.ts:1522`）从 `requestRunStore.loadSessionLaneSnapshot` 找源 run；guard round 无 run，`snapshot.latestRun`/`latestRequestId` 不含它 → 报 `REQUEST_RETRY_NOT_FOUND`。前端 `handleRetryRequest` 传的 rootMessageId 是 guardRequestId，后端匹配不上，重试退化成发送新消息。
2. **追加被拦问题后消失，刷新又出现**：`requestStore.ts:620` 在 `GUARD_INPUT_BLOCKED` 时 `removeRequestEnvelopes(sessionId, clientRequestId)` 删乐观 envelope，但未调 `refreshSessionSnapshot` 拉回服务端 guard round → 当下界面消失，刷新后 `loadConversation` 才拉回。
3. **追问后刷新被拦消息消失**：guard round 的 `guardRequestId`（web channel 生成）与乐观 envelope 的 `clientRequestId` 不同，`loadConversation` 合并/去重竞态（`backgroundSnapshotMissesLocalOptimisticEnvelope`）。
4. **第一条被拦，标题不出现**：`generateSessionTitle`（`submit.ts:6548`）只在 `runtime.submit` 成功路径调；`recordInputGuardBlock` 不经 submit，标题永不生成 → 左侧会话列表无标题。
5. **拒答文案出现在消息框**：`ChatPage.tsx:1209` `composerInlineNotice = uploadError ?? submitError ?? ...`，拒答时 `submitError` 被设（`requestStore.ts:624`），渲染在 composer 区域而非会话列表。

根因：guard round 是"二等公民"——没有 run、没走 submit、标题不生成、retry 找不到、前端需写一堆特例（`removeRequestEnvelopes`/`refreshSessionSnapshot`/`isGuardBlock` retry 分支）补它的可见性与可操作性。特例正是 bug 温床。`persist-ts-input-guard-blocked-round` 的 GAP 分析目标"拦截轮 retry/edit 走正常路径"从未兑现。

## 目标结果（Goals）

- 输入护栏拦截轮成为"一等公民 round"：走正常 `runtime.submit` 创建 run，但**不调模型**——在 run 持久化后、入队调模型前立即终态化为 `COMPLETED`，content 为拒答文案。
- run 进入 `requestRunStore`，`retryLatest`/`editLatest` 自然找到它，retry/edit 走正常路径，零特例。
- 标题生成走正常 `startSessionTitleGeneration`，首条消息被拦也能生成标题。
- 前端走正常 stream + conversation 重建（收到 `REQUEST_ACCEPTED` → `REQUEST_COMPLETED`），拒答文案作为 assistant 回复正常显示在会话列表，**前端不报失败**（COMPLETED 非 FAILED）。
- guard round 的 USER + ASSISTANT 消息 `visible=true`（页面可见）+ `metadata.modelVisibility.excluded=true`（不进 model context），现有 context assembly `isHiddenReplacement` 排除路径直接复用。
- 删除 `recordInputGuardBlock` 命令与全部前端 guard 特例（`removeRequestEnvelopes` guard 分支、`isGuardBlock` retry 特例、`composerInlineNotice` 的 `submitError`）。

## 非目标（Non-Goals）

- 不改 OUTPUT 护栏路径（`web-stream-delivery.ts`、`hideRunMessages`、`OUTPUT_GUARD_BLOCKED` 事件、`TerminalCommitOptions.guardBlocked` 的 visible=false 语义）。
- 不改 `RunStatus` 枚举（复用 `COMPLETED`，不新增 `BLOCKED`/`REFUSED` 状态）。
- 不改 context assembly 的 `modelVisibility.excluded` 排除路径（已实现，复用）。
- 不改 conversation route 查询（`listMessages` 已返回 `visible=true` 消息）。
- 不改 HTTP 400 `GUARD_INPUT_BLOCKED` 即时反馈契约——改为正常 submit + 流式终态，HTTP 400 不再触发（见变更范围）。

## 变更范围（What Changes）

- `SubmitRequestCommand`（`agent-contracts/runtime`）新增可选 `guardBlockRefusal?: string` 字段。web channel 拦截时不抛 400，而是调 `runtime.submit({ ..., guardBlockRefusal: guardResult.refusalMessage })`。
- `runtime.submit`（`agent-runtime/src/lifecycle/submit.ts`）在 `saveRun` 之后、`emit REQUEST_ACCEPTED` 之前检测 `command.guardBlockRefusal`：若存在，立即 `commitTerminal('COMPLETED', ...)` 终态化（content = refusalMessage，terminal message `visible=true` + `metadata.modelVisibility.excluded=true` + `guardReason=INPUT_VIOLATION`），调 `startSessionTitleGeneration`，然后 `return`——**跳过 `enqueueWork`，模型循环不启动**。
- `TerminalCommitOptions`（`agent-runtime/src/terminal/terminal-commit.ts`）新增 `guardBlockedVisible?: { readonly refusalMessage: string }` 选项，与 `guardBlocked` 互斥：terminal message `visible=true`（页面可见）+ `metadata.modelVisibility.excluded=true`（模型排除）+ `guardReason=INPUT_VIOLATION`。`guardBlocked`（visible=false）语义不变，供 OUTPUT 护栏继续使用。
- 删除 `RuntimeCommandPort.recordInputGuardBlock` 与 `RecordInputGuardBlockCommand`（`agent-contracts/runtime`）；删除 `agent-runtime` 的 `recordInputGuardBlock` 实现；删除 `runtime-command-wrapper.ts`、`question-activity-tracking-command-port.ts` 的透传。
- `agent-channel-web/src/routes/requests.ts` `submitStagedRequest` 拦截分支：删除 `recordInputGuardBlock` 调用与 HTTP 400 `GUARD_INPUT_BLOCKED` 抛错，改为调 `runtime.submit` 带 `guardBlockRefusal`。
- 前端删除 guard 特例：`requestStore.ts` 两处 `GUARD_INPUT_BLOCKED` 分支（不再触发，可删/简化）；`useChatComposerController.ts` `handleRetryRequest` 统一走 `retryLatest`（guard round 现在有 run）；`ChatPage.tsx:1209` `composerInlineNotice` 去掉 `submitError`。

## Function 影响（OpenSpec Capabilities）

### 修改的 Capability

- `guardrail-gateway`（canonical spec `openspec/specs/guardrail-gateway/spec.md`）：MODIFIED `A blocked round is excluded from model-visible history in subsequent rounds` Requirement 的 input-blocked 场景，把"不创建 run、走 `recordInputGuardBlock`"改为"走正常 `runtime.submit` 创建 run + 立即 `COMPLETED` 终态、不调模型、`modelVisibility.excluded` 排除"。涉及系统质量属性：可靠性/恢复（retry/edit/标题走正常路径）、可维护性（消除二等公民与前端特例）、可测试性（统一 run 生命周期）。

## 影响范围（Impact）

- 主要 owner：`agent-runtime` 的 `submit`（`submit.ts:1052`）与 `terminal-commit.ts`；`agent-channel-web` 的 `submitStagedRequest`（`requests.ts:2078`）；`agent-contracts/runtime` 的 `SubmitRequestCommand` 与 `RuntimeCommandPort`。
- 契约：`SubmitRequestCommand` 加可选 `guardBlockRefusal`；删除 `recordInputGuardBlock?` 与 `RecordInputGuardBlockCommand`。`TerminalCommitOptions` 加 `guardBlockedVisible`。
- 持久化：guard round 现在产生 `RequestRunRecord`（status=COMPLETED, terminalCommitState=COMMITTED）+ USER 消息 + ASSISTANT 终态消息（visible=true + modelVisibility.excluded）。复用现有 message table 与 run store，不新增表/字段。
- 前端：`agent-web` 的 `requestStore`、`conversationStore`、`useChatComposerController`、`ChatPage` 删除 guard 特例。guard round 走正常 stream（REQUEST_ACCEPTED → REQUEST_COMPLETED）与 conversation 重建。
- 兼容性：HTTP 400 `GUARD_INPUT_BLOCKED` 不再触发——改为正常 submit 接受（200 + stream）。前端 `GUARD_INPUT_BLOCKED` 错误分支不再触发。旧 guard round 记录（`recordInputGuardBlock` 写的无 run 消息对）无迁移负担（此前的 change 未上线或可接受不一致）。
- 安全：拒答语仍由 RobotRouter 返回、NextAgent 透传不改写；`modelVisibility.excluded=true` 使 context assembly 排除；不暴露 raw provider error/credential/endpoint。
- 验证：`agent-runtime` submit/terminal-commit 测试、`agent-channel-web` submit route 测试（更新：断言 submit + 立即 COMPLETED 终态、不调模型、不抛 400）、前端 `requestStore`/`chat-composer-controller` 测试、context assembly `history-candidate-selection.test.ts`、`openspec validate --all --strict`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`npm run build`。
- 依赖与并行边界：与 OUTPUT 护栏路径（`hideRunMessages`/`OUTPUT_GUARD_BLOCKED`/`guardBlocked` visible=false）不交叉——本 change 仅触及 input-guard 与 `TerminalCommitOptions.guardBlockedVisible` 新选项，不改 `guardBlocked` 语义。
