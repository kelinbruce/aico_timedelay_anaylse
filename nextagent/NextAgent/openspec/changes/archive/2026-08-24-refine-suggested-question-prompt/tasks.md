## 1. `FN-1.20 查看推荐问题`

- [x] 1.1 更新推荐问题 prompt characterization tests，先表达用户追问预测、上下文不足时预测追问、用户口吻、助手口吻禁止和编号 7 能力范围规则的目标行为。
  来源：`FN-1.20 查看推荐问题` + `Prompt Variable Resolution` + `正常上下文组装`、`上下文不足`、`用户口吻`、`产品能力范围非空时包含`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/suggested-question-service.test.ts`；实施前目标断言失败，实施后全部通过。
  结果：2026-08-24 实施前运行该命令，2 个新增目标断言失败（48 tests：2 failed / 46 passed），分别确认旧 prompt 缺少用户追问预测定位和编号 7 能力范围规则。

- [x] 1.2 替换 `SUGGESTED_QUESTION_SYSTEM_PROMPT` 和 `CAPABILITY_DESCRIPTION_SYSTEM_RULE`，不修改 user prompt、模型调用、解析、缓存和触发行为。
  来源：`FN-1.20 查看推荐问题` + `Prompt Variable Resolution` + `输出格式`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/suggested-question-service.test.ts`；相关 characterization tests 全部通过。
  结果：2026-08-24 实现后运行该命令，1 file / 48 tests 全部通过；`npx prettier --check` 覆盖两个变更 TS 文件通过。

- [x] 1.3 验证后端类型构建和 OpenSpec 变更有效性。
  来源：`FN-1.20 查看推荐问题` + design `Architecture Boundary`
  验证：`npm run build`；`npm exec -- openspec validate refine-suggested-question-prompt --type change --strict`；同时运行 `npm run lint:openspec` 核对本 change 不在全仓失败清单。
  结果：2026-08-24 `npm run build` 退出码 0；本 change strict validation 通过。`npm run lint:openspec` 在当前 main 上为 287 passed / 23 failed，本 change 显示通过，失败项均不属于本 change。

## 2. 整体验证

- [x] 2.1 运行后端 architecture gate，确认 prompt 变更未破坏 package boundary 和 architecture assertions。
  来源：design `Architecture Boundary`
  验证：`npm run lint:architecture`；成功完成且无新增违规。
  结果：2026-08-24 dependency-cruiser 1594 modules / 7293 dependencies 无违规，package manifest policy 通过，architecture tests 54 files / 321 tests 全部通过。另运行 `npm test` 为 171 files / 2240 tests passed，`npm run test:contract` 为 50 files / 388 tests passed，`git diff --check` 通过。
