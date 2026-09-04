## 1. `FN-5.2 调用能力`

- [x] 1.1 为 portal ability 配置解析建立失败先行测试，覆盖缺失配置、非法 boolean、非法分钟数、`1`、`1440`、`0`、`1441`、非 integer 输入和未知字段。
  来源：`FN-5.2 调用能力 + Requirement “Portal ability configuration fields and defaults” + Scenario “缺失配置使用默认值”“非法等待时间回到默认值”“边界值合法”“非法推荐问题开关回到默认值”“未知字段不改变有效配置”`
  验证：在仓库根运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/portal-ability-config.test.ts`；实现前新增测试必须失败，完成后同一命令必须通过。

- [x] 1.2 为 `PortalAbilityConfigProvider` 建立 LOCAL/REMOTE 生命周期测试，覆盖 LOCAL 不热更新、REMOTE fingerprint 变化后重载、REMOTE 文件缺失返回默认值、REMOTE 非法配置返回默认值。
  来源：`FN-5.2 调用能力 + 可靠性/恢复 + Requirement “PortalAbilityConfigProvider follows deployment-mode loading policy” + 全部 Scenario`
  验证：在仓库根运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/portal-ability-config.test.ts`；实现前新增测试必须失败，完成后同一命令必须通过。

- [x] 1.3 在 `agent-app` 实现 `PortalAbilityConfig` parser 和 LOCAL/REMOTE provider，保持配置只来自 active Agent package，并让 1.1、1.2 测试通过。
  来源：`FN-5.2 调用能力 + Requirement “Portal ability configuration fields and defaults” + Requirement “PortalAbilityConfigProvider follows deployment-mode loading policy”`
  验证：在仓库根运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/portal-ability-config.test.ts`；预期全部用例通过，且非法值均回退默认值。

## 2. `FN-8.5 上传和管理附件`

- [x] 2.1 为 runtime bootstrap public DTO 建立失败先行 contract 测试，断言 response 必须包含 `portalAbilityConfig.suggestedQuestionsEnabled`、不得包含 `askUserQuestionTimeMinutes` 或毫秒派生值，并覆盖 REMOTE 配置变化和缺失配置默认开启。
  来源：`FN-8.5 上传和管理附件 + Requirement “Bootstrap API exposes portal ability configuration” + 全部 Scenario`
  验证：在仓库根运行 `npm test --workspace @nextagent/agent-channel-web -- tests/runtime-bootstrap-portal-ability.test.ts`；实现前新增测试必须失败，完成后同一命令必须通过。

- [x] 2.2 在 `agent-channel-web` 实现 bootstrap schema、provider port、route 请求时解析和 `projectRuntimeBootstrap` 投影。
  来源：`FN-8.5 上传和管理附件 + Requirement “Bootstrap API exposes portal ability configuration”`
  验证：在仓库根运行 `npm test --workspace @nextagent/agent-channel-web -- tests/runtime-bootstrap-portal-ability.test.ts`；预期 schema 校验和 provider 投影全部通过。

- [x] 2.3 为前端 runtime bootstrap 解析建立失败先行测试，覆盖合法 boolean、缺失字段默认 `true`、非法字段默认 `true`，并确认不保存 AskUserQuestion 等待时间。
  来源：`FN-8.5 上传和管理附件 + Requirement “Bootstrap API exposes portal ability configuration” + Scenario “bootstrap 返回推荐问题开关”“bootstrap 不暴露 AskUserQuestion 等待时间”`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/runtime-config.test.ts`；实现前新增测试必须失败，完成后同一命令必须通过。

- [x] 2.4 在 `frontend/agent-web` 的 `runtimeConfig.ts` 实现 `portalAbilityConfig` public DTO 解析和赋值。
  来源：`FN-8.5 上传和管理附件 + Requirement “Bootstrap API exposes portal ability configuration”`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/runtime-config.test.ts`；预期解析结果只包含 `suggestedQuestionsEnabled`。

## 3. `FN-1.20 查看推荐问题`

- [x] 3.1 为前端推荐问题 gate 建立失败先行组件测试，覆盖 `false` 时不渲染组件、不显示 loading、不调用 API，以及 bootstrap 缺失 `portalAbilityConfig` 时默认开启。
  来源：`FN-1.20 查看推荐问题 + Requirement “Frontend Recommendation Trigger” + Scenario “推荐问题开关关闭时不调用接口”“bootstrap 缺失 portalAbilityConfig 时使用默认开启”`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/TurnBlock.suggestedQuestions.test.tsx`；实现前新增用例必须失败，完成后同一命令必须通过。

- [x] 3.2 为推荐问题后端 gate 建立失败先行测试，覆盖 `false` 时 terminal precompute 不执行、REST 返回 `{ questions: [] }`、无 model invocation，以及 `true` 时保持既有行为。
  来源：`FN-1.20 查看推荐问题 + 性能/容量 + Requirement “Suggested questions backend feature gate” + 全部 Scenario`
  验证：在仓库根运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/portal-ability-suggested-question-gate.test.ts packages/agent-channel-web/tests/suggested-questions-routes.test.ts`；实现前新增用例必须失败，完成后同一命令必须通过。

- [x] 3.3 在 `frontend/agent-web` 的 `SuggestedQuestions` 组件实现 public DTO gate，保留既有 completed/latest/live/history 条件。
  来源：`FN-1.20 查看推荐问题 + Requirement “Frontend Recommendation Trigger”`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/TurnBlock.suggestedQuestions.test.tsx`；预期 false 时无组件和无 API 调用，默认/true 行为保持。

- [x] 3.4 在 `agent-app` composition 实现 `PrecomputedSuggestedQuestionPort` gate wrapper，使 terminal precompute 和 REST 共享同一个关闭语义。
  来源：`FN-1.20 查看推荐问题 + Requirement “Suggested questions backend feature gate”`
  验证：在仓库根运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/portal-ability-suggested-question-gate.test.ts packages/agent-channel-web/tests/suggested-questions-routes.test.ts`；预期 false 时无模型调用，true 时既有行为不变。

## 4. `FN-5.6 向用户提问`

- [x] 4.1 为 runtime AskUserQuestion timeout 建立失败先行测试，覆盖配置分钟数、非法回退 30 分钟、显式 `timeoutAt` 优先、其他 producer 仍为 30 分钟、REMOTE 配置变化不影响已 accepted pending input。
  来源：`FN-5.6 向用户提问 + Requirement “AskUserQuestion default timeout uses portal ability config” + 全部 Scenario`
  验证：在仓库根运行 `npm test --workspace @nextagent/agent-runtime -- tests/ask-user-question-timeout.test.ts`；实现前新增测试必须失败，完成后同一命令必须通过。

- [x] 4.2 在 `agent-runtime` 增加窄化 `askUserQuestionDefaultTimeoutMs` dependency，并按 canonical `AskUserQuestion` producer、显式 `timeoutAt` 和其他 pending input 的优先级实现默认 timeout 决策。
  来源：`FN-5.6 向用户提问 + Requirement “AskUserQuestion default timeout uses portal ability config”`
  验证：在仓库根运行 `npm test --workspace @nextagent/agent-runtime -- tests/ask-user-question-timeout.test.ts`；预期全部决策表用例通过。

## 5. `FN-6.5 请求用户确认或授权`

- [x] 5.1 为 pending input lifecycle invariant 建立 characterization/contract 测试，覆盖非 `AskUserQuestion` pending input 仍默认 30 分钟、显式 timeout 校验保持既有语义、已 accepted deadline 不随配置变化、timeout processing 与 workflow resume 行为不变。
  来源：`FN-6.5 请求用户确认或授权 + Requirement “Runtime resolves pending input timeout” + Scenario “Runtime owns timeout decision”“Default timeout is assigned”“AskUserQuestion uses controlled default timeout”“Explicit timeout is bounded”“Due timeout is processed without external traffic”“WORKFLOW_NODE timeout resumes original run”`
  验证：在仓库根运行 `npm test --workspace @nextagent/agent-runtime -- tests/ask-user-question-timeout.test.ts tests/workflow-pending-input-timeout-resume.test.ts`；预期既有 lifecycle 用例继续通过，新增窄化例外用例通过。

- [x] 5.2 验证 runtime timeout authority 不被请求、模型、channel 或 gateway facts 覆盖，并确认 provider 只能提供 canonical `AskUserQuestion` 默认值。
  来源：`FN-6.5 请求用户确认或授权 + Requirement “Runtime resolves pending input timeout” + Scenario “Runtime owns timeout decision”`
  验证：在仓库根运行 `npm test --workspace @nextagent/agent-runtime -- tests/ask-user-question-timeout.test.ts`；预期请求侧和 producer 显式值均不能绕过 runtime 最终校验。

## 6. 跨 Function 集成与迁移

- [x] 6.1 在 `agent-app` composition 将同一个 portal ability effective config source 注入 bootstrap、推荐问题 gate 和 runtime timeout，并验证三个消费方读取同一当前值。
  来源：design「跨 Function 协作与端到端流程」
  验证：在仓库根运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/portal-ability-composition.test.ts packages/agent-app/tests/portal-ability-config.test.ts packages/agent-app/tests/portal-ability-suggested-question-gate.test.ts`；预期 bootstrap projection、推荐问题 gate 和 runtime timeout 对同一配置输入产生一致结果，且不存在平行配置读取路径。

- [x] 6.2 增加 LOCAL/REMOTE 端到端集成测试：LOCAL 配置变化后不热更新；REMOTE 配置变化后后续 bootstrap 和新 `AskUserQuestion` 使用新值，已 accepted pending input 不变。
  来源：design「跨 Function 协作与端到端流程」「跨 Function 质量属性设计」
  验证：在仓库根运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/portal-ability-config.test.ts` 和 `npm test --workspace @nextagent/agent-runtime -- tests/ask-user-question-timeout.test.ts`；预期部署模式行为分离且 accepted deadline 固化。

- [x] 6.3 增加架构边界测试，断言 `agent-runtime` 不读取 `config/config.json`、`agent-channel-web` 不解析 raw portal config、`frontend/agent-web` 只消费 public bootstrap DTO、无 private path import。
  来源：design「验证策略」Architecture 层
  验证：在仓库根运行 `npm run lint:architecture`；预期 architecture gate 通过，并新增/调整的 source-level assertion 覆盖上述边界。

- [x] 6.4 增加聚焦浏览器旅程测试，验证推荐问题开关为 `false` 时页面不显示下一步问题推荐、不发起 suggested-questions API 请求；默认和 `true` 保持现有展示。
  来源：design「验证策略」Browser journey 层
  验证：在 `frontend/agent-web` 运行相关 `npm run test:e2e -- tests/e2e/portal-ability-config.spec.cjs`；预期 false 旅程无推荐组件和 API 请求，默认/true 旅程保持现有行为。

## 7. Change 整体验证

- [x] 7.1 运行后端完整验证门禁。
  验证记录（2026-08-24）：`npm run build` 通过（Vite build 22.36s）；`npm test` 172 files / 2242 tests 全部通过；`npm run test:contract` 50 files / 388 tests 全部通过；`npm run lint:architecture` 54 files / 321 tests 全部通过。
  来源：proposal 影响范围 + design 验证策略
  验证：在仓库根运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`；预期全部通过。

- [x] 7.2 运行前端验证门禁。
  来源：proposal 影响范围 + design 验证策略
  验证：在 `frontend/agent-web` 运行 `npm run build` 和相关 `npm test -- tests/runtime-config.test.ts tests/TurnBlock.suggestedQuestions.test.tsx`；预期全部通过。本 change 不涉及 artifact、宿主模式或静态托管，不运行 `npm run build:vite:modes`。

- [x] 7.3 运行 OpenSpec 严格校验并确认本 change 未引入新的规格失败。
  来源：proposal + specs + design + tasks
  验证：在仓库根运行 `./node_modules/.bin/openspec validate add-portal-ability-config --strict`，预期通过；再运行 `./node_modules/.bin/openspec validate --all --strict`，若因既有 active changes 或 stable specs 失败，记录失败清单并确认其中不包含 `add-portal-ability-config`，且本 change 未新增失败项。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，按 design「长期基线刷新计划」归并 stable specs、Function、Feature、overview、architecture、modules 和 spec-to-design-map，并确认没有重复定义 portal ability 配置、bootstrap DTO、推荐问题开关或 pending input timeout 例外。
