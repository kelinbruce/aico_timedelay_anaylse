## 1. Runtime Contract Surface

- [x] 1.1 在 `agent-contracts/runtime` 增加 request-carried `RoutingConstraints` DTO/schema，字段仅包含 `targetSkill`、`forbiddenCapabilityIds`、`executionMode`、`locale`、`maxToolCalls`、`allowHumanInput`、`allowSubagents`。
  验证：`npm run test:contract -- --run packages/agent-contracts/tests/routing-constraints-contract.test.ts`
  来源：Requirement "Runtime owns request-carried RoutingConstraints contract"；Requirement "RoutingConstraints fields are minimal and safe"
- [x] 1.2 扩展 `SubmitRequestCommand.routingConstraints?` 和 accepted `RequestContext.routingConstraints?`，并保持 absence 时现有 request lifecycle 不变。
  验证：`npm run test:contract -- --run packages/agent-contracts/tests/routing-constraints-contract.test.ts`
  来源：Requirement "Runtime owns request-carried RoutingConstraints contract"
- [x] 1.3 增加 forbidden override negative contract tests，确认 owner、tenant、subject、agent/provider/model/prompt/policy/tool authority override、credential、path、provider-private fields 不进入 `RoutingConstraints` contract。
  验证：`npm run test:contract -- --run packages/agent-contracts/tests/routing-constraints-contract.test.ts`
  来源：Requirement "RoutingConstraints fields are minimal and safe"
- [x] 1.4 在 contract refinement 中声明 downstream routing core 消费的最小 shape：`AgentRoutingConfig`、`AgentRoutingPolicyInput`、`AgentRoutingPolicyResult`，并明确 `mode?: "default" | "policy"`、`policy.method = "policy:intent-recognition"`、以及 `skillName` 结果字段。
  验证：`openspec validate refine-ts-routing-constraints-contract --strict`
  来源：Requirement "Routing core contract shapes have a single owner"

## 2. Carry-Only Boundary

- [x] 2.1 runtime acceptance 只携带 typed `routingConstraints` 到 accepted `RequestContext`，不得解析 Skill、Tool、Agent capability、provider、model profile 或业务路径。
  验证：`npm run lint:architecture`；`npm test -- --run packages/agent-runtime/tests/routing-constraints-carry.test.ts`
  来源：Requirement "Runtime carries but does not govern RoutingConstraints"
- [x] 2.2 code review 确认未新增 `agent-contracts/routing`、generic `PolicyPort` 或 public routing decision kind。
  验证：`rg -n "agent-contracts/routing|PolicyPort|DIRECTED_SKILL|DIRECTED_CAPABILITY" packages openspec/changes/refine-ts-routing-constraints-contract`
  来源：design "非目标"

## 3. 验证和收尾

- [x] 3.1 运行相关 contract 和 runtime carry 测试。
  验证：`npm run test:contract -- --run packages/agent-contracts/tests/routing-constraints-contract.test.ts`；`npm test -- --run packages/agent-runtime/tests/routing-constraints-carry.test.ts`
  来源：AGENTS.md 验证门禁
- [x] 3.2 运行架构验证。
  验证：`npm run lint:architecture`
  来源：AGENTS.md 架构边界
- [x] 3.3 运行 OpenSpec 验证。
  验证：`openspec validate refine-ts-routing-constraints-contract --strict`
  来源：AGENTS.md OpenSpec 验证门禁

## 归档前更新基线检查（非实施任务）

- 同步 `openspec/specs/ts-core-contracts/spec.md`。
- 同步 `openspec/designs/architecture/core-contracts.md`。
- 按需更新 `openspec/designs/modules/agent-contracts.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
