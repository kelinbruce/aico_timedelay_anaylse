## 1. `FN-5.6 向用户提问`

- [x] 1.1 在真实 descriptor 和 producer 路径建立新边界测试：十四项、十五项通过且完整保序，十六项失败且不创建 pending input；中文本地化资源精确显示“手动输入”；修改生产实现前运行并确认测试因现有十项上限和旧文案失败
  来源：`FN-5.6 向用户提问` + Requirements `单个问题支持至多十五个预定义选项`、`中文界面使用简洁的手动输入标签`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/builtin-tool-guidance.test.ts tests/agent-kernel/capability-governance.test.ts --maxWorkers=1 -t "requires AskUserQuestion|accepts and preserves|rejects sixteen"`；`npm test -- --run tests/i18n.test.ts`（目录：`frontend/agent-web`）
  结果（2026-08-14）：descriptor 断言确认生产实现仍为 `maxItems=10`，中文资源断言确认现有值仍为“我手动输入”；两项均按预期失败

- [x] 1.2 将 canonical `AskUserQuestion` schema 的单题 options 上限改为十五，同步 options 字段中模型可见的二至十五项简短选项指导和 producer 测试 descriptor
  来源：`FN-5.6 向用户提问` + Requirement `单个问题支持至多十五个预定义选项` 的全部 Scenarios；design `FN-5.6 向用户提问 / 修改方案`
  验证：十四项、十五项输入被接受并完整保序，十六项输入被同一校验路径安全拒绝且不创建 pending input；总 Tool description 不增长
  结果（2026-08-14）：后端目标测试 7/7 通过

- [x] 1.3 将中文自由文本入口本地化文案从“我手动输入”改为“手动输入”，不修改组件交互或回答 contract
  来源：`FN-5.6 向用户提问` + Requirement `中文界面使用简洁的手动输入标签` + Scenario `中文自由文本入口显示简洁标签`
  验证：`npm test -- --run tests/i18n.test.ts`（目录：`frontend/agent-web`）
  结果（2026-08-14）：前端 i18n 测试 7/7 通过

- [x] 1.4 验证相邻 AskUserQuestion 契约未回退：问题数量兼容、字符串长度、option uniqueness、`multiple`、`custom`、`requiresTextInput` 与自由文本指导保持现状，固定 Tool description 不超过既有 4096 字符门禁
  来源：design `FN-5.6 向用户提问 / 修改方案`、`验证策略`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/builtin-tool-guidance.test.ts --maxWorkers=1`；`npx vitest run --config vitest.config.release.ts tests/agent-kernel/capability-governance.test.ts --maxWorkers=1 -t "AskUserQuestion producer branch"`；`npx tsc -p packages/agent-capability/tsconfig.json --pretty false`
  结果（2026-08-14）：guidance 7/7、producer 23/23 通过；runtime workspace dist 重建后 `agent-capability` TypeScript 编译通过；总 Tool description 为 4,066 个 UTF-16 code units，低于 4,096 门禁

- [x] 1.5 验证中文 AskUserQuestion 自由文本入口文案、既有自由文本交互和前端类型检查
  来源：Requirement `中文界面使用简洁的手动输入标签`
  验证：在 `frontend/agent-web` 运行 `npm test -- --run tests/i18n.test.ts tests/RespondInput.test.tsx` 和 `npm run build`
  结果（2026-08-14）：i18n 与 RespondInput 共 28/28 通过；前端 TypeScript build 通过

## 2. Change 整体验证

- [x] 2.1 验证本 change 的 OpenSpec strict validation，并确认最终 diff 只包含上限、文案、对应测试与 active change 文档
  来源：proposal `影响范围` + design `验证策略`
  验证：`npx --yes @fission-ai/openspec validate increase-ask-user-question-option-limit --type change --strict`；`git diff --check`；语义检视不得为 `BLOCKED`
  结果（2026-08-14）：本 change strict validation 通过，`git diff --check` 通过；`nextagent-skill-review` 为 PASS，无 `agent-contracts` 变更或待群内确认项

## 归档前更新基线检查（非实施任务）

归档流程按照 design 的“长期基线刷新计划”同步 stable spec、Function 与 `agent-capability` module 设计；不在实施阶段直接修改长期基线。
