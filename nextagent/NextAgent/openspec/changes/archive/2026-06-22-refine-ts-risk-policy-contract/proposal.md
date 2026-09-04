## 背景与问题（Why）

`add-ts-risk-policy-enforcement` 需要在 capability invocation、sandbox dynamic execution、authorization pending input 和 observability 之间复用同一组 risk policy contract。但当前稳定基线只有分散的现有 contract：`CapabilityInvocationRequest` / `SandboxExecutionRequest` 负责执行输入，`PendingInputRecord` 负责泛型待回答事实，`RunTimelineEvent` 与 `TimelineEventType` 负责 canonical timeline，`SafeError` 负责对外安全失败。它们都不能直接承载“执行前治理判定”这一语义。

如果直接在 `add-ts-risk-policy-enforcement` 实施阶段临时向 runtime、capability、gateway 或 observability 各自补字段，会同时引入以下问题：

- 同一 risk policy 语义可能在多个 package 中出现平行 DTO、平行 record 或私有 helper，破坏 owning subpath 边界；
- authorization pending input 需要的 scope 绑定事实没有稳定 gateway contract 落点，后续实现容易把授权意图、授权结果和 pending input truth 混成一层；
- `RiskPolicyEvaluation` 这类结构化观测事实若没有先冻结 owning module，容易被错误放入 runtime truth、channel DTO 或新的 `agent-contracts/policy` 平行 namespace；
- enforcement change 会同时承担 contract design 和流程接入，范围过大，难以验证“最小 contract surface”是否被遵守。

因此需要一个前置 refinement change，先冻结 risk policy 的最小 contract surface、字段边界、owner 和禁止项。后续 enforcement change 只消费这些 contract，不再新增其它 public contract。

## 变更范围（What Changes）

- 在 `agent-common` 新增 risk policy 共用 vocabulary：`RiskPolicyOutcome`、`RiskLevel`、`RestrictedOperationKind`。
- 在 `agent-contracts/runtime` 新增 runtime-facing evaluator contract：`RestrictedOperationSummary`、`RiskPolicyEvaluationInput`、`RiskPolicyDecision`、`RiskPolicyAuthorizationIntent`、`RiskPolicyEvaluator`。
- 在 `agent-contracts/gateway` 新增 `AuthorizationScopeRecord`，并扩展 `PendingInputRecord.authorizationScope?` 作为 authorization pending input 的服务端绑定事实。
- 在 `agent-contracts/observability` 新增 `RiskPolicyEvaluation` 结构化观测事实 contract。
- 明确 risk policy contract 的最小字段范围、安全限制和 carry/consume 边界，禁止把 raw prompt、raw model output、raw tool args/result、raw secret、credential、本地路径或 provider raw response 放入这些 contract。
- 明确本 refinement 不新增 `agent-contracts/policy`、通用 `PolicyPort`、`RiskPolicyEvaluationWriter`、独立 authorization store，也不修改 `CapabilityInvocationRequest` / `CapabilityInvocationResult`、`SandboxExecutionRequest` / `SandboxExecutionResult` 或新增用户可见 `StreamEventType`。

## Capability 影响（Capabilities）

### 新增 Capability
- 无。本 change 是 `ts-core-contracts` refinement，不新增新的运行时业务 capability。

### 修改的 Capability
- `ts-core-contracts`：补充 risk policy 的最小共享 vocabulary、runtime evaluator contract、gateway authorization scope fact 和 observability evaluation fact。

## 影响范围（Impact）

- `packages/agent-common`：新增 risk policy vocabulary。
- `packages/agent-contracts/src/runtime`：新增 risk policy evaluator input/output contract。
- `packages/agent-contracts/src/gateway`：新增 `AuthorizationScopeRecord` 并扩展 `PendingInputRecord`。
- `packages/agent-contracts/src/observability`：新增 `RiskPolicyEvaluation` contract。
- 下游依赖：`add-ts-risk-policy-enforcement` 和相关 authorization pending input 实现后续只消费该 refinement 提供的 typed surface，不再新增平行 public contract。
- 验证：contract tests、architecture review、OpenSpec strict validation。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-core-contracts/spec.md`：同步 risk policy 最小 contract refinement 行为契约。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/core-contracts.md`：补充 risk policy 相关 contract owner、最小字段边界和禁止项。
- `openspec/designs/architecture/security-and-governance.md`：补充 risk policy contract 在 capability、sandbox、authorization、observability 之间的跨模块承载边界。
- `openspec/designs/modules/agent-contracts.md`：补充 runtime/gateway/observability subpath 的新增 owning surface。
- `openspec/designs/modules/agent-runtime.md`：按需补充 runtime 只消费 risk policy evaluator contract、不拥有独立 policy namespace 的边界。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：按需补充 `ts-core-contracts` 到 core-contracts / security-and-governance 的导航。

验证入口：
- `npm run test:contract`
- `npm run lint:architecture`
- `openspec validate refine-ts-risk-policy-contract --strict`
