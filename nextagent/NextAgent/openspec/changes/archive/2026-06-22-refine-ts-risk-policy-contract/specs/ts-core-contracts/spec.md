## ADDED Requirements

### Requirement: Runtime owns risk policy evaluator contracts
TS 后端 SHALL 在 `agent-contracts/runtime` 下定义 risk policy 的 runtime-facing evaluator contracts：`RestrictedOperationSummary`、`RiskPolicyEvaluationInput`、`RiskPolicyDecision`、`RiskPolicyAuthorizationIntent` 和 `RiskPolicyEvaluator`。这些 contracts SHALL 表达受限操作的执行前治理输入、判定结果和授权意图；runtime、core、capability 和 app composition MUST 复用该 typed surface，而不是在实现包中定义平行 policy DTO、request context 字段或 helper-only contract。

#### Scenario: Restricted operation is evaluated through runtime-owned contract
- **WHEN** runtime 或受限操作执行前边界需要对 capability invocation、sandbox execution 或 authorization request 做 risk policy evaluation
- **THEN** 它 MUST 使用 `agent-contracts/runtime` 下的 risk policy evaluator contract 交换 typed input 和 typed decision
- **AND** 它 MUST NOT 通过修改 `CapabilityInvocationRequest`、`CapabilityInvocationResult`、`SandboxExecutionRequest` 或 `SandboxExecutionResult` 来承载 policy decision
- **AND** runtime-facing contract MUST 允许后续 change 在不重定义 public DTO 的前提下接入 capability、sandbox 和 authorization 路径

#### Scenario: Existing execution contracts remain execution-owned
- **WHEN** 团队扩展 risk policy contract surface
- **THEN** `CapabilityInvocationRequest` 和 `SandboxExecutionRequest` MUST 继续只承载执行输入
- **AND** risk policy outcome、authorization intent 和 policy evaluation fact MUST 有独立 contract 落点
- **AND** TS 后端 MUST NOT 引入新的 `agent-contracts/policy` owning subpath 或通用 `PolicyPort`

### Requirement: Risk policy shared vocabulary and facts are minimal and owner-aligned
TS 后端 SHALL 将 `RiskPolicyOutcome`、`RiskLevel` 和 `RestrictedOperationKind` 作为跨边界共享 vocabulary 归 `agent-common` owning；将 `RiskPolicyEvaluation` 作为结构化观测事实归 `agent-contracts/observability` owning。`RiskPolicyEvaluation` SHALL 只承载安全摘要、稳定 reason code、risk outcome 和 refs，MUST NOT 成为 runtime、session、gateway、channel 或 capability 的业务真相对象。

#### Scenario: Shared vocabulary is reused across boundaries
- **WHEN** runtime、capability、gateway、observability 或 app composition 需要表达 risk policy outcome、risk level 或 restricted operation kind
- **THEN** 它们 MUST 复用 `agent-common` owning vocabulary
- **AND** implementation package MUST NOT 在 `agent-contracts/*` 或私有实现包中重复定义同义 enum 或 string union

#### Scenario: Evaluation fact is observability-owned and safe
- **WHEN** 系统形成一次 risk policy evaluation 的结构化观测事实
- **THEN** 该事实 MUST 使用 `agent-contracts/observability` owning 的 `RiskPolicyEvaluation`
- **AND** 该 contract MUST NOT 包含 raw prompt、raw model output、raw tool args/result、raw attachment content、raw secret、credential、本地路径、完整 sandbox request 或 provider raw response
- **AND** 该 fact MAY 被 log、metric、audit 和 release/security gate 消费
- **AND** 它 MUST NOT 作为 RequestRun、PendingInput、SessionMessage、Gateway Record 或用户可见 stream event truth 使用

### Requirement: Authorization scope is stored as pending-input-bound gateway fact
TS 后端 SHALL 将 risk-policy-driven authorization scope 作为 `agent-contracts/gateway` owning 的 `AuthorizationScopeRecord` 表达，并允许 `PendingInputRecord.authorizationScope?` 持久化该服务端绑定事实。authorization scope SHALL 只绑定当前 owner、当前 run 和目标受限操作；它 MUST NOT 进入客户端 answer payload，MUST NOT 形成独立 authorization store，也 MUST NOT 被定义为跨 run 或跨 session 的长期授权记录。

#### Scenario: Authorization pending input carries server-bound scope
- **WHEN** 后续 change 为高风险受限操作创建 authorization pending input
- **THEN** gateway-visible pending input fact MAY 在 `PendingInputRecord.authorizationScope?` 中携带绑定的 authorization scope
- **AND** 该 scope MUST 由服务端 trusted owner scope、run scope 和目标 operation ref 组成
- **AND** 客户端 answer contract MUST NOT 直接提交、覆盖或伪造该 scope

#### Scenario: No parallel authorization persistence is introduced
- **WHEN** 团队实现 risk policy authorization contract
- **THEN** 系统 MUST NOT 引入独立 authorization durable truth、独立 authorization store 或平行 gateway record
- **AND** authorization permission MUST 继续作为 runtime 基于 pending input answer 和绑定 scope 派生的一次性执行许可
- **AND** `PendingInputRecord.authorizationScope?` 的存在 MUST NOT 改变现有 pending input lifecycle owner
