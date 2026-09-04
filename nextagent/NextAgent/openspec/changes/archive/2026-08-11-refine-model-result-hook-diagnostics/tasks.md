## 1. `FN-10.1 注册和执行钩子`

- [x] 1.1 为 `AFTER_MODEL_RESULT` 增加 timing 与 usage 的目标行为测试；完成后流式、非流式、content、reasoning、tool call、空反馈、部分 usage 和缺失 usage 均有可观察断言
  来源：`FN-10.1 注册和执行钩子` + Requirement `Stage-specific boundaries and mutations are minimal runtime contracts` + Scenarios `流式调用以首个模型反馈计时`、`非流式结果以 terminal tool call 计时`、`成功结果不包含可识别反馈`、`精确投影部分 usage`、`Provider 未返回 usage`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-model/tests/lifecycle-hook-wrapper.test.ts`，预期相关目标行为用例全部通过

- [x] 1.2 扩展 `ModelResultBoundary` 并在统一模型生命周期 wrapper 投影 timing 与 usage；完成后所有成功 concrete provider invocation 遵守同一首次反馈、E2E 和缺失字段语义，既有 mutation 白名单保持不变
  来源：`FN-10.1 注册和执行钩子` + Requirement `Stage-specific boundaries and mutations are minimal runtime contracts` + Scenarios `流式调用以首个模型反馈计时`、`非流式结果以 terminal tool call 计时`、`成功结果不包含可识别反馈`、`精确投影部分 usage`、`Provider 未返回 usage`；design `FN-10.1 注册和执行钩子 / 修改方案`
  验证：运行 `npm run typecheck` 和 `npx vitest run --config vitest.config.release.ts packages/agent-model/tests/lifecycle-hook-wrapper.test.ts`，预期类型检查和全部 wrapper tests 通过

- [x] 1.3 验证失败与 mutation 边界不扩张；完成后模型失败不产生合成 `AFTER_MODEL_RESULT`，hook 不能通过诊断字段改变模型结果
  来源：`FN-10.1 注册和执行钩子` + Requirement `Stage-specific boundaries and mutations are minimal runtime contracts` + Scenario `模型调用失败`；design `FN-10.1 注册和执行钩子 / 修改方案`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-model/tests/lifecycle-hook-wrapper.test.ts`，预期 safe error、非法 terminal、consumer error 和 after mutation 用例全部通过

- [x] 1.4 在产品路径验证最终 NDJSON artifact 的关键模型诊断事实；完成后真实 plugin 装配路径可按 `sessionId-requestId` 轨迹观察非负 timing 与精确 usage
  来源：`FN-10.1 注册和执行钩子` + Requirement `Stage-specific boundaries and mutations are minimal runtime contracts` + Scenarios `流式调用以首个模型反馈计时`、`精确投影部分 usage`；design `验证策略`
  验证：运行 `npx vitest run --config vitest.config.release.ts tests/e2e/developer-hook-trace-plugin-product-path.test.ts`，预期产品路径用例通过并断言最终 artifact boundary

## 2. Change 整体验证

- [x] 2.1 执行规格、构建、测试、contract 与 architecture 门禁；完成后本 change 可重复验证且没有 P0/P1 语义检视问题
  来源：proposal `影响范围` + design `验证策略`
  验证：运行 `openspec validate refine-model-result-hook-diagnostics --strict`、`openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` 和 `git diff --check`；预期全部通过，若仓库既有非本次差异导致门禁失败则记录精确证据并确认本次提交未触及失败 owner

## 归档前更新基线检查（非实施任务）

归档流程按照 design 的“长期基线刷新计划”归并 stable spec、Function、architecture、module 和必要导航，并确认诊断字段只由 lifecycle hook 公共契约定义。
