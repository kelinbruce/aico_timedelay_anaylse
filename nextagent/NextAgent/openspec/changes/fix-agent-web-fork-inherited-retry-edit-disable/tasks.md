## 0. 契约前置门禁

- [ ] 0.1 完成三个 canonical specs 的原子 delta：移除 retry "暴露" Requirement、新增 retry 禁用 Requirement、更新 edit eligibility 和 forkInherited provenance 语义
  来源：`FN-1.11`、`FN-2.3`、`FN-2.1`；design"存量 Requirement 迁移方案"
  验证：`openspec validate fix-agent-web-fork-inherited-retry-edit-disable --strict`

## 1. `FN-2.3 重试请求`

- [ ] 1.1 恢复 TurnBlock `BubbleActions` 对 `forkInherited` 的 retry 禁用分支：`retryBlocked = retryDisabled || forkInherited`，禁用态含 `aria-disabled`、不可点击、`not-allowed` 光标、低透明度和专用 Tooltip
  来源：`FN-2.3` + `Agent Web 禁用继承 latest turn 的 retry 入口`
  验证：`npm test -- src/features/chat/components/TurnBlock.forkInherited.test.tsx`（inherited latest turn retry 禁用断言通过）

- [ ] 1.2 恢复 `useChatComposerController` 对继承轮次 retry 入口的排除：`canRetryLatest` 和 `showRetryLatestButton` 排除 `forkInherited === true`
  来源：`FN-2.3` + `Agent Web 禁用继承 latest turn 的 retry 入口`
  验证：`npm test -- tests/chat-composer-controller.retry-guard-block.test.tsx`（通过）

## 2. `FN-2.1 提交请求`

- [ ] 2.1 恢复 TurnBlock `BubbleActions` 对 `forkInherited` 的 edit 禁用分支：`aria-disabled`、不可点击回调、`not-allowed` 光标、低透明度和专用 Tooltip
  来源：`FN-2.1` + `Agent Web SHALL expose edit only for the current latest turn`
  验证：`npm test -- src/features/chat/components/TurnBlock.forkInherited.test.tsx`（inherited latest turn edit 禁用断言通过）

- [ ] 2.2 恢复 `useChatComposerController` 对继承轮次 edit 入口的排除：`canEditLatest` 排除 `forkInherited === true`
  来源：`FN-2.1` + `Agent Web SHALL expose edit only for the current latest turn`
  验证：`npm test -- tests/chat-composer-controller.retry-guard-block.test.tsx`（通过）

## 3. `FN-1.11 从消息派生子会话`

- [ ] 3.1 恢复 `forkInherited` provenance 标记的前端操作禁用语义：projection 仍透出标记，下游交互层重新读取该标记禁用 retry/edit
  来源：`FN-1.11` + `Copied message 携带继承 provenance 标记`
  验证：`npm test -- src/features/chat/view-model/buildSessionProjection.forkInherited.test.ts`（projection 仍透出标记）

## 4. i18n 恢复

- [ ] 4.1 恢复 zh-CN 和 en-US 的 `retryForkInherited` 和 `editForkInherited` 文案 key
  来源：design"修改方案"
  验证：`npm run build`（tsc --noEmit 通过）

## 5. Change 整体验证

- [ ] 5.1 完成 Agent Web build、相关单测和 OpenSpec strict validation
  来源：proposal"影响范围"；design"验证策略"
  验证：`npm run build`、`npm test -- src/features/chat/components/TurnBlock.forkInherited.test.tsx`、`npm test -- tests/chat-composer-controller.retry-guard-block.test.tsx`、`openspec validate fix-agent-web-fork-inherited-retry-edit-disable --strict`

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的"长期基线刷新计划"合并三个 stable specs，并检查 Function、Feature 和 Agent Web 模块说明恢复 `forkInherited` 禁用 retry/edit 的一致性。