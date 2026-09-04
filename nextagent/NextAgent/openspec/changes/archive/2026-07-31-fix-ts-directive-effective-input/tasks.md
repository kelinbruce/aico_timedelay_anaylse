## 1. FN-2.8 指令定向请求处理

- [x] 1.1 依据 `Directive 生成有效用户问题` 的 Skill、Workflow、重复同目标、非前缀与冲突 Scenarios，先在 `packages/agent-core/tests/capability-directive-parser.test.ts` 增加目标行为测试；运行 `npx vitest run --config vitest.config.release.ts packages/agent-core/tests/capability-directive-parser.test.ts`，修复前必须因缺少有效问题投影而失败。
- [x] 1.2 依据 `Directive 生成有效用户问题` 的全部 Scenarios，在 `agent-core` 实现唯一 directive 输入归一化入口，使成功解析同时产出净化后的用户问题和结构化路由约束；运行 `npx vitest run --config vitest.config.release.ts packages/agent-core/tests/capability-directive-parser.test.ts`，预期全部通过。
- [x] 1.3 依据 `有效用户问题成为持久化和执行事实` 的 USER message 与执行输入 Scenarios，在 `agent-runtime` acceptance 边界应用输入投影，使 submit、edit 的 `acceptedInputText`、`input_question`、根 USER message content 与执行输入一致；运行 `npx vitest run --config vitest.config.release.ts packages/agent-runtime/tests/retry-input-text-recovery.test.ts tests/e2e/retry-directive-recovery.test.ts`，预期持久化和执行断言均不含 directive。
- [x] 1.4 依据系统质量属性 `可靠性/恢复` Requirement `重试编辑与恢复保持净化语义` 的 retry、edit、recovery 与非法 metadata Scenarios，将结构化路由约束随根 USER message 持久化，并在 retry/recovery 时通过既有 runtime schema 校验后恢复；运行 `npx vitest run --config vitest.config.release.ts packages/agent-runtime/tests/retry-input-text-recovery.test.ts tests/agent-kernel/local-runtime-recovery.test.ts tests/agent-kernel/runtime-recovery-guard.test.ts`，预期恢复不依赖 directive 文本且非法约束失败关闭。

## 2. FN-2.6 指定技能处理

- [x] 2.1 依据 proposal 的 `FN-2.6 指定技能处理` 不变边界，以及 `Directive 生成有效用户问题` 的 Skill prompt Scenario，补充产品路径测试，验证目标 Skill 治理语义保持不变且模型 prompt 仅接收有效用户问题；运行 `npx vitest run --config vitest.config.release.ts tests/e2e/retry-directive-recovery.test.ts`，预期 Skill 仍被定向且 prompt 不含 directive。

## 3. FN-9.2 Workflow 路由

- [x] 3.1 依据 proposal 的 `FN-9.2 加载和匹配配方` 不变边界，以及 `Directive 生成有效用户问题` 的 Workflow Scenario，补充产品路径测试，验证 workflow engine 的 `inputText`/`input_question` 为有效用户问题且目标 Workflow 仍由结构化约束选择；运行 `npx vitest run --config vitest.config.release.ts tests/e2e/retry-directive-recovery.test.ts tests/e2e/p1-p2-scenario-gate/workflow-routing.test.ts`，预期 Workflow 仍被定向且输入不含 directive。

## 4. Composition 与架构边界

- [x] 4.1 依据 design `FN-2.8 指令定向请求处理 / 修改方案` 第 2、3 点，在 `agent-app` composition root 注入 `agent-core` 输入归一化能力，并增加架构断言，保证 `agent-runtime` 不反向依赖 core、产品 composition 不遗漏该投影；运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/request-runtime-composition.test.ts` 与 `npm run lint:architecture`，预期 composition 断言和依赖边界全部通过。

## 5. 完整验证与交付门禁

- [x] 5.1 依据 design `验证策略`，运行 `npx vitest run --config vitest.config.release.ts packages/agent-core/tests/capability-directive-parser.test.ts packages/agent-runtime/tests/retry-input-text-recovery.test.ts packages/agent-app/tests/request-runtime-composition.test.ts tests/agent-kernel/local-runtime-recovery.test.ts tests/agent-kernel/runtime-recovery-guard.test.ts tests/e2e/retry-directive-recovery.test.ts tests/e2e/p1-p2-scenario-gate/workflow-routing.test.ts`；预期全部聚焦单元、生命周期、恢复和 E2E 测试通过。
- [x] 5.2 依据 AGENTS.md `验证门禁` 和 design `验证策略`，运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict` 和 `git diff --check`；预期全部命令以退出码 0 完成。
- [x] 5.3 依据 AGENTS.md `Push 门禁`，Push 前使用 `$nextagent-code-review` 对提交范围完成语义检视；P0/P1 清零并取得 `PASS` 或 `PASS WITH FOLLOW-UP` 后方可推送。
