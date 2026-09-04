## 1. `FN-10.33 查看插件诊断轨迹`

- [x] 1.1 为本地运行包的 companion 文件建立边界测试：既有 helper 仍返回并生成 `plugin.json`、`index.js`，打包 staging 在不修改 manifest 与插件主入口的前提下同级增加 `trace-viewer.html`。
  来源：`FN-10.33` + Requirement `查看器作为本地运行包的插件伴随文件交付` + Scenario `打包官方调测插件及伴随查看器`、`装载带查看器的插件`；design `FN-10.33 查看插件诊断轨迹 / 修改方案` 第 1–3 项
  验证：`npx vitest run packages/agent-plugin-sdk/tests/plugin-sdk.test.ts && npx vitest run --config vitest.config.release.ts tests/fullstack-packaging-boundary.test.ts`；实现前预期新增断言失败且原因仅为 `trace-viewer.html` 未生成，实现后预期全部通过。

- [x] 1.2 为独立静态查看器建立浏览器测试：导入包含碰撞坐标、多轨迹、乱序/同时间/无效时间、非法行和 HTML 字符串的 fixture，断言精确分轨、默认选择、轨迹切换、稳定排序、问题原因、原始详情文本安全、无网络请求和无持久存储 API。
  来源：`FN-10.33` + Requirement `查看器按会话和请求区分执行轨迹` + Scenario `一份文件包含多条执行轨迹`、`相同文本拼接不能合并不同组合`；Requirement `查看器以确定顺序呈现轨迹事件` + Scenario `乱序记录按时间与行号稳定排序`、`展开节点查看原始记录`；安全 + Requirement `查看过程保持本地只读边界` + Scenario `离线打开查看器`、`导入内容不离开页面内存`
  验证：`npx vitest run packages/agent-plugin-sdk/tests/developer-hook-trace-viewer.test.ts`；实现前预期因生成物没有 `trace-viewer.html` 失败，实现后在可用 Chromium 环境中预期通过且无 skip。

- [x] 1.3 在 `agent-plugin-sdk/assets` 中实现自包含静态查看器，并由本地打包 composition 复制为插件目录的 `trace-viewer.html`；完成逐行校验、嵌套 Map 精确分组、确定排序、流程/详情呈现与重新导入状态替换，不修改 `developer-hook-trace` 实现/helper、插件运行时公共 contract、manifest、loader、`agent-contracts`、`agent-dev-workbench` 或产品前端。
  来源：`FN-10.33` 全部 Requirements；design `FN-10.33 查看插件诊断轨迹 / 修改方案` 与 `私有数据结构`
  验证：`npm run build --workspace @nextagent/agent-plugin-sdk && npx vitest run packages/agent-plugin-sdk/tests/plugin-sdk.test.ts packages/agent-plugin-sdk/tests/developer-hook-trace-viewer.test.ts && npx vitest run --config vitest.config.release.ts tests/fullstack-packaging-boundary.test.ts`；预期 TypeScript build 及全部目标测试通过，浏览器测试无 skip，`git diff -- packages/agent-plugin-sdk/src/developer-hook-trace.ts packages/agent-plugin-sdk/tests/plugin-sdk.test.ts` 无输出。

- [x] 1.4 触发非法输入与禁止边界负例：全非法文件显示无可用轨迹及问题总数，混合文件保留合法轨迹，导入字符串不执行为 HTML，生成 HTML 不含外部资源、网络调用或持久存储 API。
  来源：`FN-10.33` + 可靠性/恢复 + Requirement `单行错误只降级当前记录` + Scenario `合法记录与损坏记录混合导入`、`文件没有合法轨迹事件`；安全 + Requirement `查看过程保持本地只读边界` + Scenario `导入内容不离开页面内存`
  验证：`npx vitest run packages/agent-plugin-sdk/tests/developer-hook-trace-viewer.test.ts packages/agent-plugin-sdk/tests/plugin-sdk.test.ts`；预期全部负例均被实际触发并通过断言。

- [x] 1.5 扩展真实浏览器失败测试：以实际 diagnostic boundary shape 断言 `BEFORE_PLANNING` 显示 `input_question`、`AFTER_MODEL_RESULT` 显示完整 `toolCalls` JSON、`BEFORE_CAPABILITY_INVOKE` 显示 `capabilityId`，并覆盖映射路径缺失显示“不可用”和其他 stage 不显示核心指标。
  来源：`FN-10.33` + Requirement `查看器按事件阶段展示核心指标` + Scenario `规划前展示输入问题`、`模型结果后展示 Tool 调用`、`能力调用前展示目标 Capability`、`核心指标路径缺失`
  验证：`npx vitest run packages/agent-plugin-sdk/tests/developer-hook-trace-viewer.test.ts`；实现前预期因没有 `.event-core` 摘要失败，实现后预期 2 个 tests 全部通过且浏览器测试无 skip。

- [x] 1.6 仅修改独立 HTML 资产，为三个目标 stage 渲染确定核心指标区域，全部值使用文本节点并保持其他 stage 无摘要；不得修改 `developer-hook-trace` 实现/helper、manifest、loader、产品前端或 `agent-dev-workbench`。
  来源：`FN-10.33` + Requirement `查看器按事件阶段展示核心指标` 全部 Scenarios；design `FN-10.33 查看插件诊断轨迹 / 修改方案` 第 9–10 项
  验证：`npx vitest run packages/agent-plugin-sdk/tests/developer-hook-trace-viewer.test.ts && npx vitest run --config vitest.config.release.ts tests/fullstack-packaging-boundary.test.ts && git diff --name-only -- packages/agent-plugin-sdk/src/developer-hook-trace.ts packages/agent-plugin-sdk/tests/plugin-sdk.test.ts packages/agent-dev-workbench frontend/agent-web`；预期测试全部通过且最后命令无输出。

- [x] 1.7 扩展真实浏览器失败测试：`AFTER_MODEL_RESULT` 同时断言首次反馈时延、模型端到端时延、部分 usage 和完整 Tool 调用的固定顺序与文本值，并覆盖四个字段全部缺失时逐项显示“不可用”。
  来源：`FN-10.33` + Requirement `查看器按事件阶段展示核心指标` + Scenario `模型结果后展示时延、usage 和 Tool 调用`、`核心指标路径缺失`
  验证：`npx vitest run packages/agent-plugin-sdk/tests/developer-hook-trace-viewer.test.ts`；实现前预期新增的时延与 usage 断言失败，实现后预期全部通过且浏览器测试无 skip。

- [x] 1.8 仅修改独立 HTML 资产，把 `AFTER_MODEL_RESULT` 的四项核心指标按固定顺序呈现；完成后每项独立处理缺失值，时延带毫秒单位，usage 与 Tool 调用保持完整 JSON 文本。
  来源：`FN-10.33` + Requirement `查看器按事件阶段展示核心指标` + Scenario `模型结果后展示时延、usage 和 Tool 调用`、`核心指标路径缺失`；design `FN-10.33 查看插件诊断轨迹 / 修改方案` 第 9–10 项
  验证：`npx vitest run packages/agent-plugin-sdk/tests/developer-hook-trace-viewer.test.ts && git diff --name-only -- packages/agent-plugin-sdk/src/developer-hook-trace.ts packages/agent-dev-workbench frontend/agent-web`；预期测试全部通过且禁止目录无 diff。

## 2. Change 整体验证

- [ ] 2.1 完成 OpenSpec、构建、常规测试、contract、architecture 与模型语义检视，确认实现与 `FN-10.33` 一致且工作区没有 `agent-dev-workbench` 改动。
  来源：proposal `影响范围`；design `验证策略`
  验证：`openspec validate add-plugin-diagnostic-trace-viewer --strict && openspec validate --all --strict && npm run build && npm test && npm run test:contract && npm run lint:architecture` 全部通过；`git diff --name-only -- packages/agent-dev-workbench frontend/agent-web` 无输出；`nextagent-skill-review` 与 `nextagent-code-review` 结论无 P0/P1。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design“长期基线刷新计划”把新 stable spec、`FN-10.33`、`F-10.2`、overview、插件 composition/module 和 `spec-to-design-map` 归并为长期事实；实施阶段不直接修改这些稳定基线。

## 验证记录

- 2026-08-05：实现前的初始验收确认本地运行包和浏览器入口均缺少 `trace-viewer.html`。根据“不修改 `developer-hook-trace` 代码”的后续边界，最终方案撤销 helper 改动，改由独立静态资产与打包 composition 交付；根 `vitest.config.ts` 不包含 `tests/fullstack-packaging-boundary.test.ts`，因此 packaging 验证使用 release config 精确执行。
- 2026-08-05：运行 `npm run build --workspace @nextagent/agent-plugin-sdk`；通过。
- 2026-08-05：运行 `npx vitest run packages/agent-plugin-sdk/tests/plugin-sdk.test.ts packages/agent-plugin-sdk/tests/developer-hook-trace-viewer.test.ts`；2 个 test files、8 个 tests 全部通过，浏览器测试实际执行且无 skip；`developer-hook-trace` 源码和既有测试均为零 diff。
- 2026-08-05：运行 `npx vitest run --config vitest.config.release.ts tests/fullstack-packaging-boundary.test.ts`；1 个 test file、20 个 tests 全部通过。
- 2026-08-05：使用 `nextagent-plugin-diagnostic.2026-08-05.1.ndjson` 实际导入生成后的本地查看器；识别 1 条 `(sessionId, requestId)` 轨迹、0 条问题、8 个有序事件。
- 2026-08-05：运行 `openspec validate add-plugin-diagnostic-trace-viewer --strict` 与 `git diff --check`；均通过。
- 2026-08-05：运行 `npm test`；144 个 test files、1591 个 tests 全部通过。运行 `npm run lint:architecture`；依赖、manifest policy、45 个 architecture test files 和 280 个 tests 全部通过。运行 focused ESLint；通过。
- 2026-08-05：`nextagent-skill-review` 结论 `PASS`；Function/spec 1:1、受约束自然语言、唯一 owner 和实现路径均无阻断。`nextagent-code-review` 对本次 diff 未发现 P0/P1，但整体验证结论为 `BLOCKED`：仓库基线的 `npm run build` 被未触及的 `skill-resource-projection.test.ts:794/796` 类型错误阻断；`npm run test:contract` 有未触及的 model vocabulary 断言和 workflow 临时目录清理失败；`openspec validate --all --strict` 的唯一失败项是未触及的 `fix-skill-projection-diagnostics`。因此 2.1 保持未勾选，不把无关修复混入本 change。
- 2026-08-05：根据“不修改 `developer-hook-trace` 代码”的边界完成二次收敛；`git status --short` 和精确 diff 确认 `packages/agent-plugin-sdk/src/developer-hook-trace.ts`、`packages/agent-plugin-sdk/tests/plugin-sdk.test.ts` 均无改动。重新运行 change strict validation、SDK build、8 个 focused tests、20 个 packaging tests、focused ESLint 与 `git diff --check`，全部通过。
- 2026-08-05：阶段核心指标实现前运行 `npx vitest run packages/agent-plugin-sdk/tests/developer-hook-trace-viewer.test.ts`；浏览器断言因 `.event-core` 数量为 0 失败，确认目标行为尚未实现。实现后同命令 2 个 tests 全部通过且浏览器测试无 skip；release-config packaging 20 个 tests、change strict validation 与 `git diff --check` 均通过，禁止目录精确 diff 无输出。
- 2026-08-05：实际导入给定 `nextagent-plugin-diagnostic.2026-08-05.1.ndjson`；识别 2 条轨迹、0 条问题，首条轨迹显示 `input_question=回答你是谁`、完整 `toolCalls` JSON、`capabilityId=search_memory`，空 Tool 调用显示 `toolCalls=[]`。
- 2026-08-05 push 前复核：`npm test` 的 144 个 test files、1592 个 tests 全部通过，`npm run lint:architecture` 的 45 个 test files、280 个 tests 及依赖/manifest policy 全部通过；`npm run build` 仍被未触及的 `skill-resource-projection.test.ts:794/796` 类型错误阻断，`npm run test:contract` 仍仅有未触及的 `model-invocation-contracts.test.ts` 对 `modelParams` 的旧词汇断言失败，`openspec validate --all --strict` 仍为 273 通过、仅未触及的 `fix-skill-projection-diagnostics` 失败。`nextagent-code-review` 结论 `BLOCKED`，禁止 push，2.1 保持未勾选。
- 2026-08-06：新增 `AFTER_MODEL_RESULT` 时延与 usage 断言后运行 `npx vitest run packages/agent-plugin-sdk/tests/developer-hook-trace-viewer.test.ts`，测试按预期失败，实际页面仍只显示 `toolCalls`；实现四项固定顺序核心指标后重跑，1 个 test file、2 个 tests 全部通过且浏览器测试无 skip。
- 2026-08-06：运行 SDK build、2 个 SDK test files / 8 tests、release-config packaging 20 tests、根 build、144 个常规 test files / 1616 tests、44 个 contract test files / 357 tests、change strict validation、全量 OpenSpec 276 项和 `git diff --check`，全部通过；禁止目录检查确认 `developer-hook-trace` 实现、`agent-dev-workbench` 和产品前端均为零 diff。
- 2026-08-06：`npm run lint:architecture` 的 dependency-cruiser、manifest policy 和 44/45 个 architecture test files 通过；唯一失败仍是未触及的 `tests/architecture/context-assembly-contracts.test.ts:41` 对 `agent-runtime` 子字符串的宽泛断言，本次未修改 `packages/agent-context-engine` 或该 architecture test。`nextagent-skill-review` 结论 `PASS`；`nextagent-code-review` 未发现 P0/P1，结论 `PASS WITH FOLLOW-UP`。由于 2.1 明确要求 architecture 全部通过，该 task 保持未勾选。
