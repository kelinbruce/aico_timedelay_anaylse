## 1. `FN-5.2 调用能力`

- [x] 1.1 为 `portal-ability-config` 的三个入口开关建立失败先行测试，覆盖默认值、`true`、`false`、非法值、字段独立回退和未知字段。
  来源：`FN-5.2 调用能力` + `Portal ability entry configuration fields and defaults` + 全部 Scenario
  验证：在仓库根运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/portal-ability-config.test.ts`；实施前新增断言必须失败，完成后同一命令必须通过。
  结果：2026-08-24 实施前 9 tests 中 7 failed / 2 passed，新增入口开关断言按预期失败；实施后同一命令 9/9 通过。

- [x] 1.2 扩展 `PortalAbilityConfigProvider` 解析三个入口开关，并保持 LOCAL/REMOTE 生命周期不变。
  来源：`FN-5.2 调用能力` + `Portal ability entry configuration fields and defaults` + `明确 false 关闭入口`、`非法值回退默认值`、`字段独立回退`
  验证：在仓库根运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/portal-ability-config.test.ts`；预期默认值、`false`、非法值和字段独立回退全部通过。
  结果：2026-08-24 同一命令 9/9 通过，覆盖默认值、`false`、非法值、字段独立回退和 LOCAL/REMOTE 生命周期。

## 2. `FN-8.5 上传和管理附件`

- [x] 2.1 为 runtime bootstrap public DTO 建立失败先行 contract 测试，断言 response 包含三个入口开关，且不包含 AskUserQuestion 等待时间或派生值。
  来源：`FN-8.5 上传和管理附件` + `Bootstrap API exposes portal ability entry gates` + 全部 Scenario
  验证：在仓库根运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-web/tests/runtime-bootstrap-portal-ability.test.ts`；实施前新增断言必须失败，完成后同一命令必须通过。
  结果：2026-08-24 实施前 4 tests 全部失败，均缺少三个新 public 字段；实施后同一命令 4/4 通过。

- [x] 2.2 扩展 bootstrap schema、provider port 和投影，返回三个入口开关。
  来源：`FN-8.5 上传和管理附件` + `Bootstrap API exposes portal ability entry gates` + `bootstrap 返回三个入口开关`
  验证：在仓库根运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-web/tests/runtime-bootstrap-portal-ability.test.ts`；预期 schema 校验和三个字段投影全部通过。
  结果：2026-08-24 同一命令 4/4 通过，覆盖三个字段投影、非法值默认 `true`、无 provider 默认值和 AskUserQuestion timeout 不暴露。

- [x] 2.3 扩展前端 `runtimeConfig` 解析三个入口开关，缺失或非法时回退 `true`。
  来源：`FN-8.5 上传和管理附件` + `Bootstrap API exposes portal ability entry gates` + `配置缺失时返回默认开启`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/runtime-config.test.ts`；预期三个新字段解析和默认值行为通过。
  结果：2026-08-24 实施前 18 tests 中 5 failed / 13 passed；实施后同一命令 18/18 通过。

## 3. `FN-10.9 Cron 工具`

- [x] 3.1 为定时任务入口 gate 建立失败先行组件测试，覆盖默认可见、`true` 可见、`false` 隐藏，以及 Local、Immersive、Collaborative/PIU 一致隐藏。
  来源：`FN-10.9 Cron 工具` + `Cron task dashboard entry gate` + 全部 Scenario
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/sidebar.component.test.tsx tests/piu-runtime-contract.test.tsx`；实施前新增断言必须失败，完成后同一命令必须通过。
  结果：2026-08-24 实施前 Sidebar 45 tests 中 1 failed / 44 passed，PIU 63 tests 中 1 failed / 62 passed；实施后分别为 45/45 和 63/63。

- [x] 3.2 在 Sidebar 和 Collaborative/PIU MoreMenuButton 中接入 `cronTasksEnabled`，并保持 `/cron-tasks` 直达路由和 Cron API 不变。
  来源：`FN-10.9 Cron 工具` + `Cron task dashboard entry gate` + `关闭定时任务入口`、`三宿主入口一致`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/sidebar.component.test.tsx tests/piu-runtime-contract.test.tsx`；预期 `false` 时三宿主入口均隐藏，直达路由行为不变。
  结果：2026-08-24 Sidebar 45/45、PIU 63/63 通过；未修改 `/cron-tasks` 路由和 Cron API。

## 4. `FN-8.15 管理长期记忆`

- [x] 4.1 为长期记忆管理入口 gate 建立失败先行组件测试，覆盖默认可见、`true` 可见、`false` 隐藏，以及 Local 继续不可见。
  来源：`FN-8.15 管理长期记忆` + `Long-term memory management entry gate` + 全部 Scenario
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/sidebar.component.test.tsx tests/piu-runtime-contract.test.tsx`；实施前新增断言必须失败，完成后同一命令必须通过。
  结果：2026-08-24 实施前相关新增 gate 断言失败；实施后 Sidebar 45/45、PIU 63/63 通过。

- [x] 4.2 在 Sidebar、Immersive RIGHT 顶部栏和 Collaborative/PIU MoreMenuButton 中接入 `longTermMemoryManagementEnabled`，并保持 `#/memory` 直达行为不变。
  来源：`FN-8.15 管理长期记忆` + `Long-term memory management entry gate` + `关闭长期记忆管理入口`、`多宿主入口一致`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/sidebar.component.test.tsx tests/piu-runtime-contract.test.tsx tests/immersive-routing.test.tsx`；预期 `false` 时 Immersive 与 Collaborative/PIU 入口均隐藏，Local 继续不可见。
  结果：2026-08-24 Sidebar 45/45、PIU 63/63、Immersive routing 23/23 通过；未修改 `#/memory` 直达行为。

## 5. `FN-8.16 知识导入`

- [x] 5.1 为知识导入入口 gate 建立失败先行组件测试，覆盖默认可见、`true` 可见、`false` 隐藏，以及 Local 继续不可见。
  来源：`FN-8.16 知识导入` + `Knowledge import entry gate` + 全部 Scenario
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/sidebar.component.test.tsx tests/piu-runtime-contract.test.tsx`；实施前新增断言必须失败，完成后同一命令必须通过。
  结果：2026-08-24 实施前相关新增 gate 断言失败；实施后 Sidebar 45/45、PIU 63/63 通过。

- [x] 5.2 在 Sidebar、Immersive RIGHT 顶部栏和 Collaborative/PIU MoreMenuButton 中接入 `knowledgeImportEnabled`，并保持直达内容视图行为不变。
  来源：`FN-8.16 知识导入` + `Knowledge import entry gate` + `关闭知识导入入口`、`多宿主入口一致`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/sidebar.component.test.tsx tests/piu-runtime-contract.test.tsx tests/immersive-routing.test.tsx`；预期 `false` 时 Immersive 与 Collaborative/PIU 入口均隐藏，Local 继续不可见。
  结果：2026-08-24 Sidebar 45/45、PIU 63/63、Immersive routing 23/23 通过；未修改直达内容视图行为。

## 6. 跨 Function 验证

- [x] 6.1 运行前端构建和定向测试，确认三宿主入口 gate 与 runtime config 解析一致。
  来源：design `跨 Function 协作与端到端流程`
  验证：在 `frontend/agent-web` 运行 `npm run build` 和 `npm test -- tests/runtime-config.test.ts tests/sidebar.component.test.tsx tests/piu-runtime-contract.test.tsx tests/immersive-routing.test.tsx tests/TurnBlock.suggestedQuestions.test.tsx`；预期全部通过。
  结果：2026-08-24 `npm run build` 退出码 0；定向测试 5 files / 157 tests 全部通过。

- [x] 6.2 运行后端定向测试和 contract 测试，确认 provider、bootstrap DTO 和前端解析使用同一配置语义。
  来源：design `跨 Function 协作与端到端流程`
  验证：在仓库根运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/portal-ability-config.test.ts`、`npm test` 和 `npm run test:contract`；预期全部通过。
  结果：2026-08-24 portal ability 定向测试 9/9 通过；`npm test` 为 171 files / 2240 tests passed；contract tests 为 50 files / 388 tests passed。

- [x] 6.3 运行 architecture gate，确认未引入第二套配置来源或 private path import。
  来源：design `验证策略` Architecture 层
  验证：在仓库根运行 `npm run lint:architecture`；预期无新增违规。
  结果：2026-08-24 dependency-cruiser 1594 modules / 7293 dependencies 无违规；package manifest policy 通过；architecture tests 54 files / 321 tests 全部通过。

- [x] 6.4 运行 OpenSpec strict validation，确认本 change 有效。
  来源：proposal + specs + design + tasks
  验证：在仓库根运行 `./node_modules/.bin/openspec validate add-portal-ability-entry-gates --strict`；预期通过。
  结果：2026-08-24 本 change strict validation 通过。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，按 design「长期基线刷新计划」同步 stable specs、Function 文档和 spec-to-design-map，并确认没有重复定义 portal ability 入口开关或第二套配置来源。
