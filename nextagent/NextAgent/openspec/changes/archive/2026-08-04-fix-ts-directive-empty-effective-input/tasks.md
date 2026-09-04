## 1. FN-2.8 指令定向请求处理

- [x] 1.1 依据 `Directive 生成有效用户问题` 的“纯 directive 无附加文本时有效问题为空被拒绝” Scenario，先在 `packages/agent-core/tests/capability-directive-parser.test.ts` 增加目标行为测试；运行 `npx vitest run packages/agent-core/tests/capability-directive-parser.test.ts`，修复前必须因缺少空有效问题校验而失败。
- [x] 1.2 依据同一 Scenario，在 `agent-core` 的 `normalizeCapabilityDirectiveInput` 的 directive 剥离并 `trim()` 之后增加非空校验：结果为空时抛 `AgentError`（`code: 'CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY'`、`category: 'VALIDATION'`、`retryable: false`、`safeDetails.reasonCode` 同名）；运行 `npx vitest run packages/agent-core/tests/capability-directive-parser.test.ts`，预期全部通过。
- [x] 1.3 依据“纯 directive 无附加文本时有效问题为空被拒绝”与 edit 不继承 directive 的既有语义，同步 `packages/agent-runtime/tests/retry-input-text-recovery.test.ts` 中与 `normalizeCapabilityDirectiveInput` 等价的内联 projector 校验，避免测试 harness 绕过产品校验；运行 `npx vitest run packages/agent-runtime/tests/retry-input-text-recovery.test.ts`，预期 submit/edit 纯指令输入被拒绝且不持久化空 content。

## 2. FN-2.6 指定技能处理

- [x] 2.1 依据 proposal 的 `FN-2.6 指定技能处理` 失败透传目标，在 `agent-core` 的 `targeted-skill-router.ts` 的 UNAVAILABLE / FORBIDDEN / BUDGET / DEADLINE 与 `consumeResult` FAILED 抛错点的 `AgentError.safeDetails` 补 `targetSkill` 字段；不改 `code` / `category` / `retryable`。
- [x] 2.2 依据同一目标，在 `agent-runtime` 的 `commitExecutionTerminal` 增加 `options` 参数并透传给 `commitTerminal`；`executeQueuedWork` catch 路径在 `terminalStatus === 'FAILED'` 且 `terminalError instanceof AgentError` 时构造 `{ failureReason: { code, category } }` 传入，使 `REQUEST_FAILED` event payload 携带 failure code；运行 `npx vitest run packages/agent-runtime/tests/retry-input-text-recovery.test.ts`，预期失败原因透传不破坏既有恢复路径。

## 3. 前端预检与占位痕迹

- [x] 3.1 依据 proposal 的前端预检目标，新增 `frontend/agent-web/src/features/composer/capabilityDirective.ts` helper（`stripDirectives` / `parseDirectiveTarget`），正则与后端 `directivePattern` 对齐。
- [x] 3.2 依据同一目标，在 `MessageInput.handleSubmit` 提交前预检：剥离后为空 → inline 提示 `composer.emptyAfterDirective` 并阻止提交；手敲 `$skill:<name>` 不在已加载 `slashSkills` 列表 → inline 提示 `composer.skillNotFound` 并阻止提交；运行 `npm --prefix frontend/agent-web test -- MessageInputExecuting.test.tsx`，预期纯指令不调用 `onSend`、带文本调用 `onSend`。
- [x] 3.3 依据 proposal 的占位痕迹目标，在 `requestStore` 乐观 envelope 剥离 directive 后写入 content 并注入 `metadata.targetSkill`；`SyntheticUserMessage` 增加 `targetSkill`；`buildSyntheticUserMessage` 从 `payload.metadata.targetSkill` / `routingConstraints.targetSkill` 读取，`overlayLiveTurnBlocks` 经 `mergeTargetSkill` 继承 targetSkill；`TurnBlock` 在空 content 且有 directive 派生 targetSkill 时渲染占位气泡；运行 `npm --prefix frontend/agent-web test -- TurnBlock.pinQuestion.test.tsx`，预期占位气泡渲染且文案含 skill 名。

## 4. 前端失败原因友好化

- [x] 4.1 依据 proposal 的失败原因友好化目标，在 `failureDetails.ts` 的 `FAILURE_REASON_BY_CODE` 补充 `ROUTING_PREFERRED_SKILL_*` / `ROUTING_CONSTRAINT_DEPENDENCY_UNAVAILABLE` / `CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY` 映射；`failureAction` 增加对应分支（stage `CAPABILITY_EXECUTION` / `CAPABILITY_INPUT`、retry false、remediation `skillRouting`）；`FailureReasonPresentation` 增加 `skillName`，`readFailureReasonPresentation` 从 payload `safeError.safeDetails.targetSkill` / `metadata.targetSkill` 回填；运行 `npm --prefix frontend/agent-web test -- failureDetails.test.ts`，预期 skill 路由失败 code 映射正确且 skillName 透传。
- [x] 4.2 依据 proposal 的“主对话流不暴露 error code”目标，`TurnBlock` 的 `failureReason` useMemo 在无 skillName 时用 `readDirectiveTargetSkill(userMessage)` 回填（支持 `metadata.routingConstraints.targetSkill` 嵌套路径）；`FailedNotice` 渲染 `t(translationKey, { skill })` 并移除 error code 行；降级通知（`processDetails` 三个函数）保留既有 error code 展示行为不变；运行 `npm --prefix frontend/agent-web test -- TurnBlock.failed.test.tsx processDetailsProjection.test.ts`，预期主 FailedNotice 不显示 error code、降级通知行为不变。
- [x] 4.3 依据 proposal 的 i18n 目标，在 `zh-CN.ts` / `en-US.ts` 新增 `composer.emptyAfterDirective` / `skillNotFound` / `skillUnavailable` / `skillForbidden` / `skillSelectedPlaceholder` 与 `turn.failureReasons.skillUnavailable` / `skillForbidden` / `directiveEmpty` / `turn.failureRemediations.skillRouting`；运行 `npm run build:web --workspace @nextagent/agent-dev-workbench`，预期构建通过。

## 5. 完整验证与交付门禁

- [x] 5.1 依据 design `验证策略`，运行 `npx vitest run packages/agent-core/tests/capability-directive-parser.test.ts packages/agent-runtime/tests/retry-input-text-recovery.test.ts packages/agent-core/tests/agent-routing-core.test.ts` 与 `npm --prefix frontend/agent-web test -- failureDetails.test.ts TurnBlock.failed.test.tsx TurnBlock.pinQuestion.test.tsx MessageInputExecuting.test.tsx processDetailsProjection.test.ts`；预期全部聚焦单元与前端测试通过。
- [x] 5.2 依据 design `验证策略`，运行 `npm run build`、`npm run test:contract`、`npm run lint:architecture`；预期 typecheck、前端 build、架构依赖边界与契约测试通过（已知的与本 change 无关预存失败除外）。
- [x] 5.3 依据 AGENTS.md `验证门禁` 和 design `验证策略`，运行 `npm run lint:openspec`（`openspec validate --all --strict`）；预期本 change 文档合规、转绿。
- [ ] 5.4 依据 AGENTS.md `Push 门禁`，Push 前使用 `$nextagent-code-review` / `$nextagent-skill-review` 对提交范围完成语义检视；P0/P1 清零并取得 `PASS` 或 `PASS WITH FOLLOW-UP` 后方可推送。
