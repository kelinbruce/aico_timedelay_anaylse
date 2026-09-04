## 1. `FN-10.32 管理插件开发诊断产物`

- [x] 1.1 为 app composition 和 developer-hook-trace product path 增加 LOCAL/REMOTE 参数化行为测试；实现前确认 REMOTE 用例因 sink 不可用或缺少物理记录而失败。
  来源：`FN-10.32` + Requirement `系统统一接收插件开发诊断记录` + Scenario `两种部署模式均接受合法记录`；Requirement `开发诊断记录使用独立的短期产物文件族` + Scenario `两种部署模式使用同一产物边界`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/composition.test.ts tests/e2e/developer-hook-trace-plugin-product-path.test.ts --maxWorkers=8`；实现前新增 REMOTE 断言失败，实现后全部通过。
  验证记录（2026-08-04）：实现前 REMOTE composition 收到 factory 调用 `[]`，REMOTE product-path 找不到物理文件；实现后分别运行 composition 目标用例和 product-path 文件，结果为 `2 passed`、`2 passed`。

- [x] 1.2 将 developer diagnostic artifact writer 及 fixed file policy 从 `agent-platform-gateway-local` 原样迁入 `agent-log`，使用 deployment-neutral public factory；先增加 owner/entrypoint architecture 断言并确认现有入口注入实现失败。
  来源：design `FN-10.32 管理插件开发诊断产物` 的“修改方案”第 1、4 项
  验证：运行 `npx vitest run --config vitest.config.architecture.ts tests/architecture/runtime-logging-boundary.test.ts tests/architecture/netagent-external-dependency-interface-guard.test.ts` 和 `npx vitest run --config vitest.config.release.ts packages/agent-log/tests/developer-diagnostic-artifact-writer.test.ts`；预期 writer 只有 `agent-log` owner，LOCAL/REMOTE entrypoint 均不导入或注入 writer，物理策略测试通过。
  验证记录（2026-08-04）：实现前 architecture 用例因 `agent-log` writer 不存在且 REMOTE 仍导入 gateway-local factory 而失败；实现后 architecture 为 `2 files / 19 tests passed`，writer 为 `1 file / 7 tests passed`。workspace 级 `npm test -w @nextagent/agent-log` 因根 Vitest include 在 workspace cwd 下无法匹配测试而报告 `No test files found`，故使用仓库 release config 的显式路径作为可重复验证命令。

- [x] 1.3 修改 `agent-app` 同步与异步 Plugin host composition：显式 factory 优先，否则默认使用 `agent-log` writer；删除部署模式判断、LOCAL 动态加载特例以及 LOCAL/REMOTE 产品入口全部 writer 接线。
  来源：design `FN-10.32 管理插件开发诊断产物` 的“修改方案”第 2、3、4、5 项
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/composition.test.ts packages/agent-app/tests/plugin-host-externals.test.ts packages/agent-app/tests/app-lifecycle-composition.test.ts tests/e2e/developer-hook-trace-plugin-product-path.test.ts --maxWorkers=8` 和 `npm test -w @nextagent/agent-remote-deployment`；预期 LOCAL/REMOTE 默认写入、显式 override、loader noop isolation 及 writer lifecycle 全部通过，REMOTE 测试不再断言入口注入。
  验证记录（2026-08-04）：LOCAL/REMOTE composition 目标用例为 `2 passed`；product path、loader isolation、lifecycle、remote package 和 writer 组合验证为 `5 files / 24 tests passed`，REMOTE workspace 为 `2 files / 5 tests passed`。composition 全文件另有 2 个既有源码文本单双引号断言失败，与本改动无关。

- [x] 1.4 验证 owner 迁移后既有 writer 的目录、envelope、容量、轮转、保留和失败隔离保持不变，并实际触发非法物理输出与 destination unavailable 反例。
  来源：`FN-10.32` + stable 系统质量属性 Requirements `产物写入具有有界容量和生命周期`、`产物失败不改变受保护操作`、`原始调测内容与主输出面隔离`；design“质量属性影响”
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-log/tests/developer-diagnostic-artifact-writer.test.ts packages/agent-plugin-sdk/tests/plugin-sdk.test.ts packages/agent-app/tests/plugin-host-externals.test.ts --maxWorkers=8`；预期覆盖 `INVALID_RECORD`、`RECORD_TOO_LARGE`、`QUEUE_OVERLOADED`、`OUTPUT_UNAVAILABLE`、fixed file policy 和 bounded close，且路径与 envelope 不变。
  验证记录（2026-08-04）：与 REMOTE/product-path 回归合并运行，结果为 `5 files / 24 tests passed`；writer 的 7 个行为测试覆盖 fixed file policy、原 envelope、四类 failure code、maintenance failure 和 idempotent bounded close。

## 2. Change 整体验证

- [ ] 2.1 完成 OpenSpec、构建、测试、contract 和 architecture 门禁。
  来源：proposal“影响范围” + design“验证策略”
  验证：运行 `openspec validate support-plugin-diagnostics-across-deployments --strict`、`openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` 和 `git diff --check`；预期全部通过。
  验证记录（2026-08-04）：本 change strict validate 通过；受影响四个 package 按依赖顺序 build 通过；`npm test` 为 `143 files / 1590 tests passed`；`lint:architecture` 为 `45 files / 280 tests passed`；`git diff --check` 通过。整体 task 暂不勾选：根 build 被既有 `skill-resource-projection.test.ts` 类型错误阻断，contract 被既有 model inference field-count 断言阻断，OpenSpec-all 被既有 `fix-skill-projection-diagnostics` change 阻断。

- [x] 2.2 使用 `$nextagent-skill-review` 与 `$nextagent-code-review` 完成语义检视，确认 Frozen core contract、architecture、minimal kernel、security、OpenSpec consistency、Clean Code 与 KISS 均无阻塞问题。
  来源：AGENTS.md Push/Review 门禁 + design“验证策略”
  验证：OpenSpec 审查结论为 PASS；代码检视结论为 PASS 或 PASS WITH FOLLOW-UP，且 P0/P1 为零。
  验证记录（2026-08-04）：`$nextagent-skill-review` 为 PASS；`$nextagent-code-review` 为 PASS WITH FOLLOW-UP，P0/P1/P2 为零。follow-up 仅为 task 2.1 中三个既有全仓门禁阻塞，不属于本 change 引入的问题。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design“长期基线刷新计划”把 `plugin-developer-diagnostic-artifacts`、`FN-10.32`、`F-10.2`、相关 architecture/modules 与 `spec-to-design-map` 归并为长期事实；不得在实施阶段直接修改这些稳定基线。
