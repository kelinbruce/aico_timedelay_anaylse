## 1. 安全输入诊断

- [x] 1.1 扩展普通 Tool Schema formatter，使 string 误传 array 时提示 native JSON array，并为安全 `const` 约束生成具体文案，同时忽略有具体子错误的 composition 噪声。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/tool-framework.test.ts --maxWorkers=2`
  来源：Requirement `AskUserQuestion 可纠正输入错误进入安全模型纠错`；Design D3。
- [x] 1.2 在 agent-core 增加 AskUserQuestion producer-owned 的有界 Ajv 诊断 adapter，覆盖 type、required、additional property、array bounds、`const` 和非泄漏约束。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/capability-governance.test.ts --maxWorkers=2`
  来源：Requirement `AskUserQuestion 可纠正输入错误进入安全模型纠错`；Design D3、D4。

## 2. AskUserQuestion 模型纠错流程

- [x] 2.1 将 canonical AskUserQuestion assistant tool-use batch 在全量无副作用预检前持久化，并区分可纠正输入、禁止用途和 producer/infrastructure failure。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/capability-governance.test.ts packages/agent-core/tests/parallel-tool-loop.test.ts --maxWorkers=2`
  来源：Requirement `AskUserQuestion 可纠正输入错误进入安全模型纠错`、`AskUserQuestion 非纠正性失败保持终止和安全边界`；Design D1、D4、D6。
- [x] 2.2 对预检失败的 AskUserQuestion 和同批未执行调用写入一一配对的普通失败 `CAPABILITY_RESULT`，移除 request-local `USER` correction message，并验证 invalid result → corrected → pending 的完整模型轮次。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/capability-governance.test.ts --maxWorkers=2`
  来源：Requirement `AskUserQuestion 可纠正输入错误进入安全模型纠错`；Design D2、D5。
- [x] 2.3 更新第 4 次连续非法参数 safe terminal negative test，断言四次 assistant batch 和失败 results 均保留、同 batch tools 均不执行、不创建 pending，第 4 次在写入结果后以 `INVALID_INPUT` 失败。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/capability-governance.test.ts packages/agent-core/tests/parallel-tool-loop.test.ts --maxWorkers=2`
  来源：Scenario `纠错预算耗尽`；Design D1、D5。
- [x] 2.4 增加 forbidden-purpose、descriptor/pending boundary/abort 负例和 credential/prompt/option/placeholder canary，断言它们不进入参数纠错且不泄漏原文。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/capability-governance.test.ts --maxWorkers=2`
  来源：Requirement `AskUserQuestion 非纠正性失败保持终止和安全边界`；Design D6。
- [x] 2.5 保持 bounded stringified questions、underspecified options 和合法 option-attached text input 的兼容成功路径。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/capability-governance.test.ts tests/agent-kernel/tool-loop.test.ts --maxWorkers=2`
  来源：Requirement `AskUserQuestion 有界兼容输入保持既有语义`；Design D4。
- [x] 2.6 在 runtime pending resume 的正常 `CAPABILITY_RESULT` 中保留原始 `answers` 并增加 `resolvedAnswers`，覆盖纯文本、预设选项、option-attached text、custom 和 multi-select。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/session-lane-scheduling.test.ts packages/agent-core/tests/capability-result-projection.test.ts --maxWorkers=2`
  来源：Requirement `AskUserQuestion 用户回答提供可信且模型友好的结果`；Design D7。

## 3. 验证和收尾

- [x] 3.1 运行 OpenSpec 和后端完整验证门禁，记录任何既有失败与本 change 的关系。
  验证：`npx --yes @fission-ai/openspec@1.6.0 validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`
  来源：Proposal 影响范围；Design 质量属性与验证映射。
- [x] 3.2 对 OpenSpec change 执行 `$nextagent-skill-review`，修复所有 blocker/high finding并达到 PASS。
  验证：语义审查报告覆盖 requirement/design/tasks、owner、当前代码、唯一实现路径和 agent-contracts 无变更。
  来源：AGENTS.md OpenSpec change authoring gate。
- [x] 3.3 对目标分支差异执行 `$nextagent-code-review` push 门禁，确认 Frozen core contract、architecture、minimal kernel、security、OpenSpec consistency 和 Clean Code 均通过。
  验证：模型语义代码审查结论为 PASS 或无 P0/P1 的 PASS WITH FOLLOW-UP。
  来源：AGENTS.md Push 门禁。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/ask-user-question-tool/spec.md`。
- 更新 `openspec/designs/architecture/capability-spi.md`。
- 更新 `openspec/designs/modules/agent-core.md`。
- 更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一模型纠错流程、pending owner 或错误 contract。
