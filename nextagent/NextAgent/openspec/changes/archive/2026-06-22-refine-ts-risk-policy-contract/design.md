## 背景和现状（Context）

`add-ts-risk-policy-enforcement` 已经把 risk policy 的执行路径、输出语义和禁止项收敛成一个最小方案，但它依赖的共享 contract 目前并不存在。现有稳定 contract 的状态是：

- `CapabilityInvocationRequest` / `CapabilityInvocationResult` 只承载 capability 执行输入和执行结果；
- `SandboxExecutionRequest` / `SandboxExecutionResult` 只承载 sandbox 执行输入和执行结果；
- `PendingInputRecord` 只承载泛型 pending input truth，不带 risk-policy-specific authorization scope；
- `RunTimelineEvent` 与 `TimelineEventType` 只能表达 canonical timeline evidence，不能替代 typed evaluator input/output；
- `SafeError` 负责对外安全失败，不负责表达风险等级、授权意图或结构化观测事实。

因此，当前现有 contract 不是“差一个字段”，而是缺少一组 owner 明确、边界最小、能被 enforcement change 复用的 risk policy contract surface。该 refinement 的任务，是在不改变执行类 contract owner 的前提下，为 risk policy 提供唯一合法落点。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 冻结 risk policy 的最小共享 vocabulary、runtime-facing evaluator contract、gateway authorization scope fact 和 observability evaluation fact。
- 明确这些 contract 的 owning module、允许字段范围和禁止项。
- 让后续 `add-ts-risk-policy-enforcement` 只消费该 refinement，不再新增其它 public contract。
- 保持 capability/sandbox/pending input/timeline 的现有 owner 不变，不创造平行执行通道。

**非目标：**

- 不在本 change 中定义 risk policy enforcement 的完整流程、判定顺序或执行前接入点。
- 不新增 `agent-contracts/policy`、通用 `PolicyPort`、`RiskPolicyEvaluationWriter`、独立 authorization store。
- 不修改 `CapabilityInvocationRequest`、`CapabilityInvocationResult`、`SandboxExecutionRequest`、`SandboxExecutionResult`、用户可见 `StreamEventType`。
- 不把授权结果提升为跨 run、跨 session 或长期持久化授权真相。

## 设计决策（Decisions）

### D1. 以最小 contract surface 解决 owner 对齐问题

本 refinement 只新增四类 contract：

1. `agent-common`：`RiskPolicyOutcome`、`RiskLevel`、`RestrictedOperationKind`
2. `agent-contracts/runtime`：`RestrictedOperationSummary`、`RiskPolicyEvaluationInput`、`RiskPolicyDecision`、`RiskPolicyAuthorizationIntent`、`RiskPolicyEvaluator`
3. `agent-contracts/gateway`：`AuthorizationScopeRecord`、`PendingInputRecord.authorizationScope?`
4. `agent-contracts/observability`：`RiskPolicyEvaluation`

选择这个方案，是因为 risk policy 横跨 capability、sandbox、authorization pending input 和 observability，但真正需要跨边界复用的只有 vocabulary、evaluation input/output、authorization scope fact 和 evaluation fact。再往上抽一层 `agent-contracts/policy` 或 generic `PolicyPort` 会把当前单一 use case 过度抽象成策略平台。

### D2. execution contract 继续只承载执行事实

`CapabilityInvocationRequest` 和 `SandboxExecutionRequest` 当前已经有清晰 owner：前者属于 capability invocation，后者属于 sandbox gateway。risk policy 的治理语义不是执行输入，也不是执行输出，因此不向这两个 contract 写入 policy outcome、authorization intent 或 evaluation refs。

选择这个方案，是为了避免同一调用同时出现“执行参数”和“治理结果”两层职责。后续 enforcement change 必须在这些 execution contract 之前调用 `RiskPolicyEvaluator`，而不是修改 execution contract 本身。

### D3. authorization scope 绑定到 pending input durable fact，而不是新建 authorization store

高风险授权需要 durable scope 绑定事实，但该事实的生命周期仍从属于 authorization pending input。为此，本 refinement 只在 gateway 层补充 `AuthorizationScopeRecord` 和 `PendingInputRecord.authorizationScope?`。

选择这个方案，是因为现有系统已经有 pending input durable truth、answer 接收和恢复路径。若再新增独立 authorization store，会出现两份“当前 run 内授权状态”事实来源，破坏 runtime owner 边界。

### D4. `RiskPolicyEvaluation` 只作为 observability fact，不是业务真相

`RiskPolicyEvaluation` 被归入 `agent-contracts/observability`，只允许输出安全摘要、稳定 reason code、risk outcome 和 refs。它可以被结构化日志、metrics、audit sink、release/security gate 消费，但不成为 RequestRun、PendingInput 或 SessionMessage 的 truth。

选择这个方案，是为了保证观测事实可追溯，但不让 observability contract 反向成为主路径业务状态来源。

### D5. refinement 只收敛 contract，不提前承诺 enforcement 细节

该 change 只冻结 contract shape 和 owner，不在这里规定 enforcement change 的具体实现类名、端口注入方式或时序细节。唯一承诺是：后续 enforcement 必须消费这里定义的 typed surface，且不得新增平行 contract。

## 简化设计检查（KISS）

| 检查项 | 结论 |
|---|---|
| 现有事实是否足够 | 现有 `CapabilityInvocationRequest`、`SandboxExecutionRequest`、`PendingInputRecord`、`RunTimelineEvent` 和 `SafeError` 各自只覆盖执行、待输入、timeline 或错误输出语义，无法单独或组合表达 risk policy evaluator input/output、authorization scope fact 和 evaluation observability fact。 |
| 真实消费者 | `agent-runtime` 消费 evaluator input/output 和 authorization intent；`agent-capability`、sandbox 入口消费 restricted operation summary；gateway/pending input 路径消费 `AuthorizationScopeRecord`；`agent-observability` 消费 `RiskPolicyEvaluation`。 |
| 最小改动路径 | 不改 execution contract，不增 policy subpath，只在 `agent-common`、`agent-contracts/runtime`、`agent-contracts/gateway`、`agent-contracts/observability` 各补一层最小 surface。 |
| 新对象必要性 | 必要新增对象只有 `RiskPolicyOutcome`、`RiskLevel`、`RestrictedOperationKind`、`RestrictedOperationSummary`、`RiskPolicyEvaluationInput`、`RiskPolicyDecision`、`RiskPolicyAuthorizationIntent`、`RiskPolicyEvaluator`、`AuthorizationScopeRecord`、`RiskPolicyEvaluation`。它们分别承载 vocabulary、typed input/output、gateway scope fact 和 observability fact，没有平行旧路径可复用。 |

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 所有 risk policy contract 只允许安全摘要和稳定 refs；raw prompt、raw tool args/result、secret、credential、本地路径和 provider raw response 不得进入 public contract。 | contract negative tests；code review 检查新增字段不含敏感原文 |
| 性能/容量 | 本 refinement 只增加 typed contract，不引入新的执行路径或持久化扫描要求；authorization scope 复用 pending input record，避免新增独立 persistence plane。 | contract tests；architecture review |
| 可靠性/恢复 | authorization scope 与 pending input truth 同步持久化，避免 runtime 依赖 process-local 授权状态；evaluation fact 不作为业务真相，避免恢复路径双事实源。 | gateway contract tests；recovery-oriented design review |
| 可维护性 | 明确 owner 后，后续 enforcement 只消费固定 subpath surface，不会在多个 package 中长出平行 DTO 或 helper contract。 | `npm run lint:architecture`；contract diff review |
| 可测试性 | 新 contract 都是 typed surface，可通过 contract tests、negative shape tests 和 architecture tests 独立验证。 | `npm run test:contract`；OpenSpec strict validation |
| 审计/可追溯性 | `RiskPolicyEvaluation` 作为 observability-owned fact 提供稳定 evidence；timeline 仍只保留 `POLICY_APPLIED` 作为 canonical evidence，不新增用户可见 stream event。 | observability contract tests；spec review |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| risk policy evaluator contract 归 `agent-contracts/runtime` owning | 1.1 | `npm run test:contract -- --run packages/agent-contracts/tests/risk-policy-contract.test.ts` |
| execution contract 不承载 policy decision，且不新增 `agent-contracts/policy` | 1.2 | contract negative tests；`rg -n "agent-contracts/policy|PolicyPort"` |
| shared vocabulary 归 `agent-common`，evaluation fact 归 `agent-contracts/observability` | 1.3 | contract tests；public export review |
| authorization scope 只作为 pending input 服务端绑定事实存在 | 2.1 | gateway contract tests；negative answer-shape tests |
| `RiskPolicyEvaluation` 不包含 raw/sensitive fields | 2.2 | redaction/contract negative tests |
| architecture 边界不引入平行 DTO、store 或 stream event | 3.1 | `npm run lint:architecture`；source review |
| change 文档自洽并可被后续 enforcement 消费 | 3.2 | `openspec validate refine-ts-risk-policy-contract --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ts-core-contracts/spec.md` 承载 risk policy 最小 contract refinement 的外部可验证行为。
- 架构和跨模块设计：`openspec/designs/architecture/core-contracts.md` 承载 owner alignment 和最小 contract surface；`openspec/designs/architecture/security-and-governance.md` 承载 risk policy contract 在 runtime/capability/gateway/observability 间的跨模块边界。
- 模块设计：`openspec/designs/modules/agent-contracts.md` 承载 `agent-contracts/runtime`、`agent-contracts/gateway`、`agent-contracts/observability` 的新增 owning surface；`openspec/designs/modules/agent-runtime.md` 按需承载 runtime 消费这些 contract 的边界。
- ADR：无。本 change 不引入新的长期架构抉择类别，只做最小 contract refinement。
- 导航：`openspec/designs/spec-to-design-map.md` 按需增加 `ts-core-contracts` 到上述设计文档的导航。

## 风险与取舍（Risks / Trade-offs）

- [风险] refinement 只冻结 contract，后续 enforcement 可能仍试图扩大 public surface -> 缓解方式：在 spec/tasks 中明确禁止新增 `agent-contracts/policy`、`PolicyPort`、独立 authorization store 和 execution contract 字段。
- [风险] `RiskPolicyEvaluation` 若字段过多，可能退化为隐式业务真相 -> 缓解方式：spec 只允许安全摘要、reason code、outcome 和 refs，不允许 raw execution payload。
- [风险] authorization scope 若设计过宽，可能被误用为长期授权事实 -> 缓解方式：要求它只绑定当前 owner、当前 run、目标 operation，并且只存在于 pending input durable fact 上。

## 迁移计划（Migration Plan）

无。本 change 只新增 contract surface，不要求立即迁移线上行为。后续 `add-ts-risk-policy-enforcement` 和相关 authorization pending input change 在消费这些 contract 时完成实现落地。若 refinement 实现后发现字段边界不正确，可在真正接入 enforcement 前回滚或收紧 contract，而不会改变当前主路径行为。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-core-contracts/spec.md`：提炼 risk policy 最小 contract refinement 的 stable behavior。
- `openspec/designs/architecture/core-contracts.md`：提炼 risk policy vocabulary、runtime evaluator contract、gateway authorization scope fact、observability evaluation fact 的 owner alignment。
- `openspec/designs/architecture/security-and-governance.md`：提炼这些 contract 在 capability/sandbox/authorization/observability 之间的跨模块设计边界。
- `openspec/designs/modules/agent-contracts.md`：提炼新增 public subpath surface 的 owning 事实。
- `openspec/designs/modules/agent-runtime.md`：按需提炼 runtime 消费 risk policy evaluator contract、而不拥有 policy namespace 的边界。
- `openspec/designs/spec-to-design-map.md`：补充导航和验证入口。

## 待确认问题（Open Questions）

无。该 refinement 的边界已经收敛为最小 contract surface，不保留 “后续实现时决定 owner/shape” 的空间。
