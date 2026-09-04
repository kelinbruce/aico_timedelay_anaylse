## 1. `FN-2.4 查看请求状态`

- [x] 1.1 为四个 Capability 建立默认内置策略失败测试；变更前测试必须因缺少精确 `STATUS_ONLY` 条目失败。
  来源：`FN-2.4 查看请求状态` + Requirement“Capability 结果呈现策略受平台安全上限约束” + Scenario“默认配置仅显示记忆与 Skill 获取状态”
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/capability-result-presentation-config.test.ts`；实现前预期出现四个缺失条目断言失败，实现后预期通过。
  完成证据：实现前运行得到 1 个失败，diff 精确显示缺少四个 `STATUS_ONLY` 条目；实现后纳入任务 1.7 聚焦回归并通过。

- [x] 1.2 为四个 Capability 建立 `SUMMARY`、`DETAIL` 精确覆盖配置 characterization，并断言未覆盖内置项保持原级别。
  来源：`FN-2.4 查看请求状态` + Requirement“Capability 结果呈现策略受平台安全上限约束” + Scenarios“SUMMARY 精确覆盖不能突破四类结果安全上限”“DETAIL 精确覆盖不能突破四类结果安全上限”“集成方精确覆盖不删除其他内置基线项”
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/capability-result-presentation-config.test.ts`；预期全部覆盖规则进入冻结策略且其他基线不变。
  完成证据：实现前后 characterization 均通过；聚焦回归包含该文件 13 个测试。

- [x] 1.3 为四个 Capability 建立默认、`SUMMARY`、`DETAIL` 成功投影矩阵，并用每类结果的泄漏哨兵断言全部安全摘要、详情和原始字段缺失。
  来源：`FN-2.4 查看请求状态` + Requirement“Capability 结果呈现策略受平台安全上限约束” + Scenarios“默认配置仅显示记忆与 Skill 获取状态”“SUMMARY 精确覆盖不能突破四类结果安全上限”“DETAIL 精确覆盖不能突破四类结果安全上限”
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts`；预期 4×3 个成功路径均为 `STATUS_ONLY` 且无泄漏哨兵。
  完成证据：实现前 characterization 120 个测试通过，实现后纳入任务 1.7 聚焦回归并通过。

- [x] 1.4 为四个 Capability 建立三档安全失败回归矩阵，断言事实性安全原因保持可见且原始结果仍不可见。
  来源：`FN-2.4 查看请求状态` + Requirement“Capability 结果呈现策略受平台安全上限约束”中的安全失败不变量
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts`；预期四类 Capability 在三档配置下失败语义一致且不含原始结果。
  完成证据：4×3 个失败路径随共享投影测试通过，安全原因 code/category/summary 保持一致且泄漏哨兵缺失。

- [x] 1.5 在唯一内置策略表中为 `search_memory`、`get_memory_detail`、`add_memory`、`acquire_skill` 增加 `STATUS_ONLY` 条目，不修改精确覆盖或共享投影算法。
  来源：design“唯一修改路径”第 1、2 项
  验证：运行任务 1.1、1.2 的配置测试；预期从任务 1.1 的 RED 转为 GREEN，且覆盖行为保持通过。
  完成证据：生产代码只在既有内置表增加四个条目；聚焦回归从 RED 转为 3 个文件、136 个测试全部通过。

- [x] 1.6 同步用户配置说明中的四类内置基线和 `SUMMARY`、`DETAIL` 受平台安全上限约束的实际效果。
  来源：proposal“影响范围”与 design“唯一修改路径”第 5 项
  验证：人工检视 `docs/用户配置和使用指导.md` 的内置清单与 delta spec 完全一致，并运行 `git diff --check`；预期无歧义或格式错误。
  完成证据：文档已列出四类 `STATUS_ONLY` 基线并说明三档有效结果；`git diff --check` 通过。

- [x] 1.7 执行 `FN-2.4` 聚焦自动化与配置组合回归。
  来源：design“验证策略”中的配置测试、共享投影测试与组合回归
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/capability-result-presentation-config.test.ts packages/agent-app/tests/configuration-composition.test.ts packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts`；预期全部通过。
  完成证据：3 个测试文件、136 个测试全部通过。

## 2. Change 整体验证

- [x] 2.1 使用 MiniMax 完整服务依次验证默认、`SUMMARY`、`DETAIL` 三档：每档新建会话真实调用可用的 memory tools，检查实时页面、刷新后页面和 run events history；记录 `acquire_skill` 的真实组合可达性。
  来源：design“验证策略”中的完整服务
  验证：三档页面均只显示 `保存长期记忆`、`检索长期记忆`、`查看记忆详情` 的业务标题和完成状态，不显示唯一记忆正文或标识；history 投影均为 `STATUS_ONLY` 且无摘要/详情字段。若 `acquire_skill` 在默认组合不可达，必须以配置和共享投影自动化结果作为契约证据并明确记录限制。
  完成证据：MiniMax 完整服务在默认、`SUMMARY`、`DETAIL` 三档分别使用全新会话和 run 完成实时页面、刷新后页面及 events history 验证；run 分别为 `run-9ad7217d-20ac-47a0-9e9a-bcbe3c8adf54`、`run-9ef44af3-c83c-4646-ac50-e95c21434ef8`、`run-fd2b12cb-2619-4306-8dd0-61910c4974e2`，三类 memory Capability 的投影均为 `STATUS_ONLY` 且无结果字段、页面进程项无摘要或详情。默认 Agent 未绑定 `acquire_skill`，完整服务也未组合 SkillHub access factory，因此真实 Web 不可达；其默认及两档覆盖行为由任务 1.2 至 1.4 的配置和共享投影矩阵覆盖，未伪造真实调用。

- [x] 2.2 执行 change 影响范围内的 OpenSpec、后端、前端和架构门禁，识别全仓既有基线失败，并完成 NextAgent 语义代码检视。
  来源：proposal“影响范围” + design“验证策略”中的全量门禁
  验证：运行 `openspec validate govern-memory-and-acquire-skill-result-presentation --type change --strict --no-interactive`、`openspec validate --all --strict --no-interactive`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、前端 `npm run build`、相关前端聚焦测试与 `git diff --check`，并按 `$nextagent-code-review` 检视；change 影响范围门禁必须通过且无 P0/P1，全仓既有失败必须记录并确认与本 change 无关。
  完成证据：在 `origin/main@eaca840c4` 上重放后，change strict、根 workspace build、1926 个后端测试（另 2 个 skipped）、364 个 contract 测试、前端 build、132 个受影响配置与共享投影测试及 `git diff --check` 均通过，语义检视无 P0/P1。全仓 OpenSpec strict 的 311 项中 308 项通过，既有 `fix-conversation-preview-validation`、`fix-session-list-validation`、`fix-share-validation-error-messages` 因无 delta 失败；architecture 为 292 个通过、1 个既有 `runtime-logging-boundary` 失败，指向本 change 未修改的 `api-call-tool.ts`；配置组合回归 6 个测试中 4 个通过、2 个既有 `allowedExecutables` 断言失败；相关前端聚焦测试 144 个中 143 个通过、1 个既有 reduced-motion transition 断言失败。上述失败路径与文件相对 `origin/main` 均无提交差异，本 change 无前端生产代码或 runtime logging 改动。

## 归档前更新基线检查（非实施任务）

归档流程按照 design“长期基线刷新计划”同步 stable spec、`FN-2.4` 与两份 architecture 文档；实施阶段不直接修改长期 OpenSpec 基线。
