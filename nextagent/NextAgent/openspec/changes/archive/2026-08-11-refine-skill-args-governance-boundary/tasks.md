## 1. `FN-5.9 调用技能`

- [x] 1.1 更新 `packages/agent-capability/tests/skill-tool.test.ts`：十二个治理同名字段在根层和嵌套层均成功通过，并保留既有 JSON envelope 负例；修改实现前运行测试并确认当前五字段黑名单导致失败。
  来源：`FN-5.9 调用技能` + Requirement `Skill args 不按字段名承担执行治理`（Scenario `治理同名业务字段在根层和嵌套层通过`、`Args 中的治理同名字段不改变执行控制`）
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-tool.test.ts`；实现前新增正例失败，实现后该文件全部通过。
  实际（2026-08-06）：实现前 30 tests 中 2 failed，分别证明 descriptor 仍列禁止字段且五字段业务输入被拒绝；实现后 30/30 passed。

- [x] 1.2 删除 `packages/agent-capability/src/builtins/skill-tool.ts` 的字段名黑名单、递归扫描与专用 reserved-key error details，使任意字段名通过字段名检查，同时保留 JSON object、可序列化、深度和字节数边界。
  来源：`FN-5.9 调用技能` + Requirement `Skill args 不按字段名承担执行治理`（Scenario `治理同名业务字段在根层和嵌套层通过`、`Args 中的治理同名字段不改变执行控制`）+ design `FN-5.9 调用技能 / 修改方案`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-tool.test.ts`；十二字段正例与既有 envelope 负例全部通过，代码检索无 `forbiddenArgKeys`、`findForbiddenKey` 或 `SKILL_ARGS_RESERVED_GOVERNANCE_KEY` 残留。
  实际（2026-08-06）：目标 Vitest 30/30 passed；字段名扫描、两个递归 helper 和 reserved-key error detail 已删除，残留检索为 0。

- [x] 1.3 更新 Skill Tool description 与 `args` property description，只声明 task data 与 trusted execution governance 的边界，不列出禁止字段。
  来源：`FN-5.9 调用技能` + Requirement `Skill args 不按字段名承担执行治理`（Scenario `Tool 描述区分 task data 与执行治理`）
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-tool.test.ts`；descriptor 文本断言通过，且不包含任何字段禁止清单。
  实际（2026-08-06）：目标 Vitest 30/30 passed；descriptor 与 input schema 只说明 task data 不改变可信 runtime governance，未列禁止字段。

## 2. Change 整体验证

- [x] 2.1 验证 TypeScript 构建、目标 change 和仓库 OpenSpec 严格门禁，确认没有 public `agent-contracts` 或架构边界变更。
  来源：proposal `影响范围` + design `验证策略（Verification Strategy）`
  验证：`npm run build`、`openspec validate refine-skill-args-governance-boundary --strict`、`openspec validate --all --strict` 全部 exit 0；`git diff --check` 无错误。
  实际（2026-08-06）：目标 Vitest 30/30 passed；`npm run build` exit 0；目标 change strict valid；全仓 OpenSpec 284/284 passed；`git diff --check` exit 0。模型语义审查结论 PASS，无 `agent-contracts` 变更或架构边界漂移。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按 design 的“长期基线刷新计划”同步 `skill-tool` stable spec、`FN-5.9 调用技能` 和 `agent-capability` module design；不在实施阶段更新长期基线。
