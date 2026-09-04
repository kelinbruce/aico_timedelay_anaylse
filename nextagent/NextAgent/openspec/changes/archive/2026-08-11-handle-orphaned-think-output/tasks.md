## 1. `FN-1.20 查看推荐问题`

- [x] 1.1 为 `parseQuestions()` 增加异常思考标签行为测试，覆盖开启标签缺失、多个孤立闭合标签、大小写混合和闭合标签后无有效问题；修改实现前确认至少“开启标签缺失且前方包含推理”用例失败。
  来源：`FN-1.20 查看推荐问题` + `Recommendation Output Cleaning` + “开启标签缺失且推理位于孤立闭合标签之前”“存在多个孤立闭合标签”“孤立闭合标签之后没有有效问题”“孤立闭合标签大小写混合”
  验证：已运行 `npx.cmd vitest run --config vitest.config.release.ts packages/agent-app/tests/suggested-question-service.test.ts`；基线逻辑下 4 个新增用例失败（39 passed / 4 failed），确认缺陷可复现。

- [x] 1.2 修改问题推荐输出清洗，在既有完整和未闭合思考块清洗后，从最后一个大小写不敏感的孤立 `</think>` 结束位置截取后缀；无该标签时保持既有行为。
  来源：`FN-1.20 查看推荐问题` + `Recommendation Output Cleaning` + “开启标签缺失且推理位于孤立闭合标签之前”“存在多个孤立闭合标签”“孤立闭合标签之后没有有效问题”“孤立闭合标签大小写混合”；design `FN-1.20 查看推荐问题 / 修改方案`
  验证：已运行 `npx.cmd vitest run --config vitest.config.release.ts packages/agent-app/tests/suggested-question-service.test.ts`，1 file / 43 tests 全部通过。

- [x] 1.3 类型检查受影响后端 package，确认 TypeScript 源码有效。
  来源：design `验证策略`
  验证：全仓 `npx.cmd tsc -b --pretty false` 因既有 `dist` 文件不可写产生 `TS5033 EPERM`；改用 `npx.cmd tsc -p packages/agent-session/tsconfig.json --noEmit --tsBuildInfoFile "$env:TEMP\nextagent-agent-session-pr.tsbuildinfo" --pretty false`，退出码为 0。

## 2. Change 整体验证

- [x] 2.1 验证 OpenSpec delta、代码格式和架构边界，并确认 PR 不包含无关未跟踪产物。
  来源：proposal `影响范围` + design `验证策略`
  验证：targeted `openspec validate handle-orphaned-think-output --strict`、`git diff --check`、`npm.cmd run lint:architecture` 均通过（architecture 43 files / 259 tests）；全量 OpenSpec 中本 change 通过，另有两个无关 active changes 既有失败。人工检查将未跟踪压缩包排除在提交外。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”同步 stable spec、Function 和 `agent-session` module 文档；其他长期基线类别保持不变。
