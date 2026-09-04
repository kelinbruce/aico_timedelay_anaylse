# Tasks

## 1. FN-2.5 请求自动路由

### 1.1 目标行为测试

- [x] 1.1.1 补充"命中的 SKILL 规则目标不可用 → 降级到模型驱动循环"的黑盒回归：断言请求不失败、未发起任何 capability 调用、`POLICY_APPLIED` 原因码为 `POLICY_RULE_SKILL_MISS_FALLBACK`。
  验证：`packages/agent-core/tests/agent-routing-core.test.ts` 用例 `falls back to the model-driven loop when a configured Skill rule targets an unavailable Skill`
  来源：spec `Policy routing uses controlled input and output contracts` / design GAP 1

- [x] 1.1.2 补充"SKILL 规则目标解析为 WORKFLOW capability"的替换防护回归：断言不执行 workflow、按未命中降级。
  验证：同文件用例 `does not reinterpret a workflow capability as a configured Skill rule target`
  来源：spec 同上 / design GAP 2

- [x] 1.1.3 补充"可信路由目标 Skill 加载"的回归：断言定向调用声明了已披露 Skill，且目标解析携带会话作用域。
  验证：同文件用例 `discloses the routed Skill to the governed Skill loader so it does not require model-side discovery`
  来源：spec `Routing core emits safe downstream commands` / design GAP 4、GAP 5

- [x] 1.1.4 补充"显式可信定向 Skill 约束优先于配置规则"的回归：断言 workflow 规则不执行、Skill 恰好加载一次、原因码为 `POLICY_RULE_TARGET_SKILL_PRIORITY`。
  验证：同文件用例 `keeps a trusted targetSkill constraint ahead of configured policy rules`
  来源：spec `Policy routing uses controlled input and output contracts` / design GAP 3

### 1.2 实现

- [x] 1.2.1 抽出共用的治理能力解析入口，`SKILL` 与 `WORKFLOW` 可用性判定复用同一实现。
  验证：`agent-routing-policy.ts` 的 `isGovernedCapabilityAvailable`；`npm run typecheck`
  来源：design 修改方案 1

- [x] 1.2.2 `mode=policy` 命中 `SKILL` 规则时判定可用性，未通过返回模型驱动循环与 `POLICY_RULE_SKILL_MISS_FALLBACK`。
  验证：用例 1.1.1、1.1.2
  来源：design 修改方案 2

- [x] 1.2.3 `mode=policy` 分支内，可信 `targetSkill` 约束短路配置规则并返回 `POLICY_RULE_TARGET_SKILL_PRIORITY`；`mode=default` 行为不变。
  验证：用例 1.1.4；既有用例 `routes a normal accepted request through MODEL_DRIVEN_LOOP before model execution`
  来源：design 修改方案 3

- [x] 1.2.4 定向 Skill 调用声明本次已披露 Skill，使已治理的 `DEFERRED` 或非模型可调用 Skill 可以加载。
  验证：用例 1.1.3；既有加载器用例 `packages/agent-capability/tests/skill-tool.test.ts` 的 `requires ToolSearch discovery before loading a non-model-invocable Skill`、`requires ToolSearch discovery before loading deferred Skills` 证明未披露仍被拒绝
  来源：design 修改方案 4

- [x] 1.2.5 定向 Skill 能力解析携带受理请求的 `sessionId`。
  验证：用例 1.1.3
  来源：design 修改方案 5

### 1.3 Function 验证

- [x] 1.3.1 显式选择的安全失败语义不回退：`$skill:` 指令与 `targetSkill` 约束在目标不可用、被禁用或预算耗尽时仍安全失败。
  验证：既有用例 `does not reinterpret workflow-only capability as a skill directive target`、`packages/agent-core/tests/targeted-skill-routing-security.test.ts` 全量保持不变
  来源：proposal 非目标 1、2

- [x] 1.3.2 使用指导与目标态一致：补充 target 可用性判定规则与安全原因码排障表。
  验证：`docs/workflow-usage-guide.md` 方式四章节
  来源：design 长期基线刷新计划

## 2. 共享任务：整体验证与归档检查

- [ ] 2.1 TypeScript 构建通过。
  验证：`npm run typecheck`
  来源：AGENTS.md 验证门禁

- [ ] 2.2 受影响单测通过。
  验证：`npx vitest run packages/agent-core/tests/agent-routing-core.test.ts packages/agent-core/tests/targeted-skill-routing.test.ts packages/agent-core/tests/targeted-skill-routing-security.test.ts` 与 `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-tool.test.ts`
  来源：AGENTS.md 验证门禁

- [ ] 2.3 后端常规门禁通过。
  验证：`npm test`、`npm run test:contract`、`npm run lint:architecture`
  来源：AGENTS.md 验证门禁

- [ ] 2.4 OpenSpec 严格校验通过。
  验证：`openspec validate --all --strict`
  来源：AGENTS.md 验证门禁

- [ ] 2.5 归档前刷新长期基线。
  验证：design"长期基线刷新计划"列出的 stable spec 与 FN-2.5 Function 文档
  来源：design 长期基线刷新计划
