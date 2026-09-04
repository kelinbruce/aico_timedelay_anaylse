## 1. `FN-5.6 向用户提问`

- [ ] 1.1 修改 `ask-user-question-schemas.ts` 的 `allOf` 约束：移除 `requiresTextInput` option 与 `custom=true` 的互斥（`custom: { const: false }`），保留与 `multiple=true` 的互斥（`multiple: { const: false }`）。
  来源：`FN-5.6 向用户提问` + Requirement `AskUserQuestion 支持具体选项附带文本输入` + Scenario「Producer rejects ambiguous option-attached input combinations」
  验证：运行 `npx vitest run packages/agent-capability/tests/builtin-tool-guidance.test.ts`；预期 schema 约束测试通过，⑤+custom 不再被拒绝，⑤+multiple 仍被拒绝。

- [ ] 1.2 修改 `submit.ts` 的 `assertValidPendingInputAnswerEntry`：移除 QUESTION kind 的 `custom !== true` 自定义值拒绝；QUESTION kind 总是接受 `customValues.length <= 1` 的自定义值，保留 `customValues.length > 1` 的拒绝。
  来源：`FN-5.6 向用户提问` + Requirement `AskUserQuestion QUESTION kind accepts free-text answers regardless of custom declaration` + `question-pending-input` MODIFIED Requirement `Question pending input supports text, single select, multi-select, and custom answers` + Scenario「未声明 custom 的单选问题接受自由文本回答」「超过一个自定义值仍被拒绝」「Free-text answer without custom declaration」「More than one non-option value is rejected」
  验证：运行 `npx vitest run packages/agent-runtime/tests/` 中 pending input answer 校验相关测试；预期未声明 custom 时的自由文本回答被接受，超过一个自定义值仍被拒绝。

- [x] 1.3 修改 `resolvePendingQuestionAnswers`：缺失 `answerKinds` 时保留既有 value 匹配兼容路径；存在已校验 kind 时优先按显式来源投影，确保自由文本等于 option value 时仍投影为 `customText`。
  来源：`FN-5.6 向用户提问` + Requirement `AskUserQuestion 用户回答提供可信且模型友好的结果` + Scenario「未声明 custom 时的自由文本被投影为 customText」
  验证：运行 `npx vitest run` 中 resolvedAnswers 投影相关测试；预期 customText 投影在未声明 custom 时也正确。

- [ ] 1.4 确认 `projectAskUserQuestionAnswerResult` 无需修改：answer 安全投影不区分 custom 与非 custom 来源。
  来源：`FN-5.6 向用户提问` + Requirement `AskUserQuestion QUESTION kind accepts free-text answers regardless of custom declaration`
  验证：运行 `npx vitest run packages/agent-channel-common/tests/ask-user-question-answer.test.ts`；预期自由文本回答的安全投影正确。

- [ ] 1.5 修改 `stream-envelope.ts` 的 `safePendingInputQuestions`：移除 `requiresTextInput` option 与 `custom=true` 的互斥检查（`custom === true` 条件），只保留与 `multiple=true` 的互斥检查。否则 ⑤+custom 的问题在 `USER_INPUT_REQUIRED` 事件投影时会被静默丢弃。
  来源：`FN-5.6 向用户提问` + Requirement `AskUserQuestion 支持具体选项附带文本输入` + design「修改方案 4. Stream projection」
  验证：运行 `npx vitest run packages/agent-channel-common/tests/process-message-projection.test.ts`；预期 ⑤+custom 的问题不再被投影丢弃，⑤+multiple 仍被丢弃。

- [ ] 1.6 在 `AskUserQuestion` Tool description 中增加一句模型可见指导：用户可能提供选项列表外的自由文本回答，需在后续步骤中参考和使用。同时修改 Tool description 中已有的互斥指导文本：将 "do not combine such options with multiple=true or custom=true" 改为 "do not combine such options with multiple=true"，移除对 `custom=true` 的互斥提及。
  来源：`FN-5.6 向用户提问` + Requirement `AskUserQuestion QUESTION kind accepts free-text answers regardless of custom declaration` + Scenario「模型可见指导提及用户自由文本可能性」+ Requirement `AskUserQuestion 支持具体选项附带文本输入` + Scenario「Tool 描述向模型说明全部输入形态」
  验证：运行 `npx vitest run packages/agent-capability/tests/builtin-tool-guidance.test.ts packages/agent-context-engine/tests/prompt-shaping.test.ts`；预期 guidance 断言通过，互斥指导文本不再提及 custom。

- [x] 1.7 为 QUESTION answer 增加可选 `answerKinds`，贯通 Web DTO、runtime 校验、pending answer durable record 与恢复；显式 `CUSTOM_TEXT` 必须在文本等于 option value 时仍投影为 `customText`。正常 Tool Result 对包含 `customText` 的回答按实际类型增加英文动态 instruction；`OPTION_SELECTIONS_WITH_CUSTOM_TEXT` 必须要求模型同时保留和使用 `selections` 与 `customText`。
  来源：`FN-5.6 向用户提问` + Requirement `AskUserQuestion QUESTION kind accepts free-text answers regardless of custom declaration` + Scenario「自由文本与 option value 相同仍保持自由输入语义」
  验证：运行 QUESTION pending answer contract/runtime/local gateway 测试和前端 `RespondInput` 测试；预期显式来源通过重启可恢复、非法 kind/shape 被拒绝、旧 payload 仍兼容、纯自由文本与“选项+自由文本”分别获得匹配其类型的英文 instruction，前端混合输入提交 `OPTION_SELECTIONS_WITH_CUSTOM_TEXT`。

## 2. 前端交互

- [ ] 2.1 修改 `RespondInput.tsx` 的 `QuestionInput`：在所有有 options 的子形态（②③④⑤）底部增加 type anything textarea；②③ 无 `custom=true` 时也显示。单选时与选项互斥（选选项清空文本，打字清空选项）；多选时与选项共存。⑤ 的 `requiresTextInput` option 行为不变。
  来源：`FN-5.6 向用户提问` + Requirement `AskUserQuestion QUESTION kind accepts free-text answers regardless of custom declaration` + Scenario「单选模式 answer 格式不产生歧义」
  验证：运行 `cd frontend/agent-web && npm run build && npm test -- RespondInput`；预期所有子形态显示 type anything，互斥/共存行为正确。

- [x] 2.1a `QuestionInput` 提交与每个问题对应的 `answerKinds`，来源必须取自实际 UI 状态而不是 option value 比较；增加自由文本恰好等于 option value 的测试。
  来源：Scenario「自由文本与 option value 相同仍保持自由输入语义」
  验证：运行 `cd frontend/agent-web && npm test -- RespondInput requestService`；预期请求携带 `CUSTOM_TEXT` 且保留原始文本。

- [ ] 2.2 修改 `processDetails.ts` 的 `buildSupplementalInputDetail`：QUESTION kind 的输入方式标签始终包含自由文本可用标识，不只依赖 `question.custom === true`。
  来源：`FN-5.6 向用户提问` + Requirement `AskUserQuestion QUESTION kind accepts free-text answers regardless of custom declaration`
  验证：运行 `cd frontend/agent-web && npm run build && npm test -- processDetails`；预期自由文本可用标签在所有 QUESTION 子形态中显示。

- [ ] 2.3 确认 ProcessDetail 回答展示无需修改：`options.get(answer) ?? answer` fallback 天然能显示自由文本。
  来源：`FN-5.6 向用户提问` + Requirement `AskUserQuestion 用户回答提供可信且模型友好的结果`
  验证：在 2.2 的测试中一并覆盖自由文本回答的展示。

## 3. Change 整体验证

- [ ] 3.1 运行后端与 OpenSpec 门禁，确认变更未引入 TypeScript、contract 或 architecture 回归，并对提交范围执行 NextAgent 模型语义检视。
  来源：proposal「影响范围」+ design「质量属性」
  验证：运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`npx --yes @fission-ai/openspec@latest validate enable-ask-user-question-free-text-answer --strict`，并按 `$nextagent-code-review` 检视本 change；预期所有命令退出码为 0，模型检视结论为 `PASS` 或无 P0/P1 的 `PASS WITH FOLLOW-UP`。

- [ ] 3.2 运行前端 build 和相关测试。
  来源：proposal「影响范围」+ AGENTS.md 前端验证要求
  验证：运行 `cd frontend/agent-web && npm run build && npm test`；预期前端 build 和测试通过。

## 归档前更新基线检查（非实施任务）

归档时更新 stable specs、`FN-5.6`、`F-5.4`、overview、相关 architecture/modules 与 spec-to-design map；确认 `requiresTextInput` 与 `custom` 的互斥约束修改已同步到 stable spec，且 `customText` 投影不依赖 `custom` 声明的行为已文档化。
