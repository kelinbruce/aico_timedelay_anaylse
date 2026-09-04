## 1. Contract surface

- [x] 1.1 在 `agent-common` 新增 `RiskPolicyOutcome`、`RiskLevel`、`RestrictedOperationKind`，并在 `agent-contracts/runtime` 新增 `RestrictedOperationSummary`、`RiskPolicyEvaluationInput`、`RiskPolicyDecision`、`RiskPolicyAuthorizationIntent`、`RiskPolicyEvaluator`。
  验证：`npm run test:contract -- --run packages/agent-contracts/tests/risk-policy-contract.test.ts`；`npm run build`
  来源：spec `Runtime owns risk policy evaluator contracts`；design D1
- [x] 1.2 增加 contract negative tests，断言 risk policy outcome、authorization intent 和 evaluator input/output 不进入 `CapabilityInvocationRequest`、`CapabilityInvocationResult`、`SandboxExecutionRequest` 或 `SandboxExecutionResult`，并确认未新增 `agent-contracts/policy` 或通用 `PolicyPort`。
  验证：`npm run test:contract -- --run packages/agent-contracts/tests/risk-policy-contract.test.ts`；`rg -n "agent-contracts/policy|PolicyPort" packages`
  来源：spec `Runtime owns risk policy evaluator contracts`；design D2
- [x] 1.3 在 `agent-contracts/observability` 新增 `RiskPolicyEvaluation`，并增加 contract tests 断言 shared vocabulary 归 `agent-common` owning、evaluation fact 归 observability owning。
  验证：`npm run test:contract -- --run packages/agent-contracts/tests/risk-policy-contract.test.ts`
  来源：spec `Risk policy shared vocabulary and facts are minimal and owner-aligned`；design D4

## 2. Gateway authorization scope fact

- [x] 2.1 在 `agent-contracts/gateway` 新增 `AuthorizationScopeRecord`，并扩展 `PendingInputRecord.authorizationScope?` 作为 authorization pending input 的服务端绑定事实。
  验证：gateway contract tests；`npm run build`
  来源：spec `Authorization scope is stored as pending-input-bound gateway fact`；design D3
- [x] 2.2 增加 negative contract tests，断言客户端 answer shape 不包含 `authorizationScope`，且 `RiskPolicyEvaluation` 不包含 raw prompt、raw model output、raw tool args/result、raw secret、credential、本地路径、完整 sandbox request 或 provider raw response。
  验证：`npm run test:contract -- --run packages/agent-contracts/tests/risk-policy-contract.test.ts`
  来源：spec `Authorization scope is stored as pending-input-bound gateway fact`；spec `Risk policy shared vocabulary and facts are minimal and owner-aligned`

## 3. Architecture validation and change verification

- [x] 3.1 增加或更新 architecture/source assertions，断言未引入平行 authorization store、平行 policy DTO、用户可见 `StreamEventType` 扩展，且新增 surface 只落在 `agent-common`、`agent-contracts/runtime`、`agent-contracts/gateway`、`agent-contracts/observability`。
  验证：`npm run lint:architecture`
  来源：proposal scope；design D1 / D3 / D4
- [x] 3.2 运行 OpenSpec 和工程验证，确认该 refinement 可作为 `add-ts-risk-policy-enforcement` 的前置 change 被消费。
  验证：`openspec validate refine-ts-risk-policy-contract --strict`；`npm run build`；`npm run test:contract`
  来源：proposal `影响范围`；design `验证映射`

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，按 proposal/design 的 Baseline Promotion Plan 更新长期基线；不得在 apply 阶段把长期基线更新当作普通实施任务提前勾选。
