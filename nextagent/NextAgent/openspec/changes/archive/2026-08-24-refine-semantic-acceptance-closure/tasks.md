## 0. 实施前置门禁

- [x] 0.1 确认 `improve-harnessbench-complex-task-execution` 的有界产物执行指导已作为实施基线落地，且本 change 不与其他进行中的修改并行改写 builtin `task_approach` 内容资源
  来源：design `FN-10.4 自定义工具和提示词 / 目标与规范依据`、`风险与取舍`
  验证：运行 `rg -n "内置系统提示提供有界产物执行指导|minimum inspection needed|verify that every required artifact exists" openspec packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/task-approach.md` 并检查 `git status --short`；预期前置目标态及其规格来源可追溯，且没有未协调的同文件并行修改。
  实际结果（2026-08-17）：检索命中前置 change 的 Requirement、已完成 tasks 及 builtin prompt 第 9、12 行目标指导；`git status --short -- packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/task-approach.md` 无输出，确认实施前没有未协调的同文件修改。

## 1. `FN-10.4 自定义工具和提示词`

- [x] 1.1 在 builtin Prompt Template assembly 测试中建立失败回归：装配结果必须包含规则—证据—结果关联、来源复核、差异修正、证据不足或规则冲突时的限制说明，以及“格式通过不能单独证明语义完成”的指导；同时不得包含评测特化内容
  来源：`FN-10.4` + 可靠性/恢复 + `内置系统提示提供语义验收闭环指导` + `规则驱动任务接收语义验收指导`、`分类和聚合结果从来源证据重新核对`、`证据不足或规则冲突时不编造结果`、`Builtin 指导保持通用且可覆盖`
  验证：实现前运行 `npx vitest run --config vitest.config.release.ts packages/agent-context-engine/tests/prompt-shaping.test.ts`；预期新增 positive 文案断言失败，既有 benchmark 特化词 negative assertions 和 Agent source priority/override 测试继续通过。
  实际结果（2026-08-17）：实现前定向命令 23 tests 中新增用例失败 1 项，缺失点准确落在 `map every explicit rule relevant to the requested result`；其余 22 tests（含既有 benchmark 特化词 negative assertions 和 source priority/override 语义）通过。

- [x] 1.2 扩展 builtin `SYSTEM_PROMPT` 的既有 `task_approach` 内容资源，仅加入语义验收闭环指导；完成后规则驱动任务得到逐项核对、重新计算、差异修正和限制说明指导，且不新增 section、schema、配置、状态、服务、Tool、模型调用或公共 contract
  来源：`FN-10.4` + 可靠性/恢复 + `内置系统提示提供语义验收闭环指导` + 全部 Scenarios；design `FN-10.4 自定义工具和提示词 / 修改方案`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-context-engine/tests/prompt-shaping.test.ts`；预期新增与既有 prompt assembly 断言全部通过。
  实际结果（2026-08-17）：定向命令 1 file / 23 tests 全部通过；builtin 装配结果包含规则映射、证据复核、差异修正、格式与语义区分及证据不足说明，且既有断言全部保持通过。

- [x] 1.3 验证 `FN-10.4` 的 Prompt Template assembly 非回归：builtin 新指导可见、Agent package 同名 section 仍覆盖 builtin、通用 template selection 和 system section 规则不变
  来源：`FN-10.4` + 可靠性/恢复 + `内置系统提示提供语义验收闭环指导` + `Builtin 指导保持通用且可覆盖`；design `FN-10.4 自定义工具和提示词 / 修改方案`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-context-engine/tests/prompt-shaping.test.ts packages/agent-context-engine/tests/prompt-template-assembly.test.ts`；预期两个测试文件全部通过，且没有新增跨 package contract 或依赖。
  实际结果（2026-08-17）：定向命令 2 files / 44 tests 全部通过；`git diff --name-only -- packages` 仅列出 builtin `task-approach.md` 与 `prompt-shaping.test.ts`，`git diff --check -- packages/agent-context-engine` 通过。

## 2. Change 整体验证

- [x] 2.1 验证 package 构建、公共契约、架构边界和 OpenSpec 一致性；确认源码变更仅限 `agent-context-engine` 的 builtin Prompt Template 内容资源与测试，不涉及其他 `packages` 源码
  来源：proposal `目标与非目标`、`影响范围`；design `验证策略`
  验证：运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate refine-semantic-acceptance-closure --strict`、`openspec validate --all --strict`、`git diff --check` 和 `git diff --name-only -- packages`；预期全部门禁通过，package diff 仅包含 `packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/task-approach.md` 与对应测试文件。
  实际结果（2026-08-17）：拉取最新 `origin/main` 并独立修复其测试期望回归后，`npm run build` 通过；`npm test` 167 files / 2,126 tests 全部通过；`npm run test:contract` 49 files / 387 tests 全部通过；`npm run lint:architecture` 50 files / 308 tests 全部通过；change strict 与全量 OpenSpec 293 items 全部通过；`git diff --check` 通过；本 change 的 package diff 仅包含 builtin `task-approach.md` 与 `prompt-shaping.test.ts`。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”归并 stable `prompt-template-assembly` spec、`FN-10.4` 以及对应 architecture/module 事实，并确认没有把前置 change 的有界产物指导重复定义为平行 Requirement。
