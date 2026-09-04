## 1. 公共契约：EditLatestRequestCommand 新增 guardBlockRefusal

- [x] 1.1 在 `agent-contracts/src/runtime/index.ts` 的 `EditLatestRequestCommand` 新增 `guardBlockRefusal?: string` 可选字段，语义与 `SubmitRequestCommand.guardBlockRefusal` 一致。
  来源：design `公共契约变更`
  验证：`npm run build` 通过。

## 2. question-activity-tracking-command-port 拦截豁免

- [x] 2.1 先补测试：submit 时 `guardBlockRefusal` 存在，断言 `upsertActivity` 不被调用。
  来源：spec MODIFIED `ask_frequency 增长时机` Scenario "安全护栏拦截的 submit 不记录问题活动"
  验证：`npx vitest run` session tests；预期新增断言在实现前失败、实现后通过。

- [x] 2.2 先补测试：editLatest 时 `guardBlockRefusal` 存在，断言 `upsertActivity` 不被调用。
  来源：spec MODIFIED `ask_frequency 增长时机` Scenario "安全护栏拦截的 editLatest 不记录问题活动"
  验证：同上。

- [x] 2.3 在 `question-activity-tracking-command-port.ts` 的 `submit` 方法中，当 `command.guardBlockRefusal !== undefined` 时跳过 `trackQuestionActivity`。
  来源：design `guardBlockRefusal 豁免`
  验证：session tests 全部通过。

- [x] 2.4 在 `question-activity-tracking-command-port.ts` 的 `editLatest` 方法中，当 `command.guardBlockRefusal !== undefined` 时跳过 `trackQuestionActivity`。
  来源：design `guardBlockRefusal 豁免`
  验证：同上。

## 3. channel-web editLatest 路由接入 guardrail

- [x] 3.1 在 `agent-channel-web/src/routes/requests.ts` 的 editLatest 路由中，当 guardrail 启用且 `checkQuestion` 返回 `isLegal=false` 时，传入 `guardBlockRefusal` 调用 `runtime.editLatest`。
  来源：design `editLatest 路由接入 guardrail`
  验证：`npm run build` 通过。

## 4. runtime editLatest 处理 guardBlockRefusal

- [x] 4.1 在 `agent-runtime/src/lifecycle/submit.ts` 的 `editLatest` 方法中，`emitCanonical` 之后、`replaceOlderLaneWork` 之前，当 `command.guardBlockRefusal` 存在时 commitTerminal + hideEditedSourceRequestMessages，不 enqueueWork。
  来源：design `runtime editLatest 处理 guardBlockRefusal`
  验证：`npm run build` 通过。

## 5. 整体验证

- [x] 5.1 执行 `npx vitest run` session tests 确认无回归。
  来源：design `验证策略`
  验证：166 tests passed。

- [x] 5.2 执行 `npx vitest run packages/agent-core/tests/` 确认无回归。
  来源：design `验证策略`
  验证：468 tests passed, 2 skipped。

- [x] 5.3 执行 `npm run build` 确认构建通过。
  来源：design `验证策略`
  验证：构建成功。

- [x] 5.4 执行 `npx openspec validate skip-question-activity-when-guardrail-blocked --strict` 确认 OpenSpec change 校验通过。
  来源：OpenSpec 验证门禁
  验证：校验通过。
