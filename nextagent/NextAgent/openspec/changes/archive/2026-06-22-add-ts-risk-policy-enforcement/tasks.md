## 0. Contract Prerequisite

- [x] 0.1 确认前置 `refine-ts-risk-policy-contract` 已完成并通过 strict validate；本 change 只消费其最小 contract 清单，不在实施阶段新增其它 public contract。
  最小清单：`agent-common` 的 `RiskPolicyOutcome` / `RiskLevel` / `RestrictedOperationKind`；`agent-contracts/runtime` 的 `RestrictedOperationSummary` / `RiskPolicyEvaluationInput` / `RiskPolicyDecision` / `RiskPolicyAuthorizationIntent` / `RiskPolicyEvaluator`；`agent-contracts/gateway` 的 `AuthorizationScopeRecord` 与 `PendingInputRecord.authorizationScope?`；`agent-contracts/observability` 的 `RiskPolicyEvaluation`。
  验证：`openspec validate refine-ts-risk-policy-contract --strict`；contract review 确认未新增 `agent-contracts/policy`、通用 `PolicyPort`、`RiskPolicyEvaluationWriter`、`PolicyAppliedTimelinePayload`、sandbox contract 修改、capability invocation request/result 字段、新 `StreamEventType` 或独立 authorization store。

## 1. Spec

- [x] 1.1 新增 `risk-policy-enforcement` spec，冻结触发机制、输入前置、输出副作用、核心判断逻辑、状态产物、失败降级和验收样例。
  来源：proposal scope、design Triggering Mechanisms、spec `Risk policy runs synchronously before restricted operations execute`
  验证：`openspec validate add-ts-risk-policy-enforcement --strict`

- [x] 1.2 明确 policy outcome 集合和 fail-closed 语义，覆盖 `ALLOW`、`DENY`、`REQUIRE_AUTHORIZATION`、`DEGRADED`、`POLICY_FAILED`。
  来源：design Policy outcome、spec `Risk policy returns one deterministic outcome per evaluation`
  验证：spec review 确认每个 outcome 至少有一个 scenario 或失败表映射

- [x] 1.3 明确安全判定固定规则顺序，包括 trusted identity、capability 授权、owner scope、参数边界、风险分类、sandbox、authorization、幂等恢复和观测事实。
  来源：design Core Decision Rules、spec `Safety is determined by a fixed rule order`
  验证：spec review 确认规则顺序完整且没有“实现时决定”的判定项

- [x] 1.4 明确 policy outcome 的固定消费流程，覆盖 `ALLOW`、`DENY`、`REQUIRE_AUTHORIZATION`、`DEGRADED`、`POLICY_FAILED` 到下游执行动作的映射。
  来源：design Safety Decision and Execution Flow、spec `Policy outcome consumption follows a fixed execution flow`
  验证：spec review 确认每个 outcome 都有明确下游动作和至少一个验收场景

## 2. Design

- [x] 2.1 写清 risk policy 只由受限操作执行前同步触发，不由后台 job、日志回放、离线扫描或执行后补采触发。
  来源：design Triggering Mechanisms
  验证：design review 检查 capability、sandbox、authorization、recovery 四类触发点均已覆盖

- [x] 2.1a 写清安全判定和执行流程：识别 operation kind、收集安全摘要、执行 policy、生成 outcome、记录观测事实、写入必要 timeline evidence、下游消费 outcome。
  来源：design Safety Decision and Execution Flow
  验证：design review 检查流程中没有后台补采、事后补判或默认放行路径

- [x] 2.1b 写清唯一实施路径：capability invocation policy 固定接在 `agent-core` tool loop 的 descriptor resolve 之后、`CAPABILITY_STARTED` / `CapabilityInvocationPort.invoke()` 之前；sandbox dynamic execution policy 固定接在 app-composed sandbox tool port 的 sandbox request summary 形成之后、`SandboxGatewayPort.execute()` 之前；authorization outcome 只由 `agent-runtime` 创建 pending input、绑定 scope、消费 answer 并恢复或重新评估目标 operation。
  来源：design Unique Implementation Path
  验证：architecture review 确认未把 policy 接到 `agent-channel-web`、sandbox gateway adapter 内部、各 Tool 私有实现、lifecycle hook、独立 authorization store、capability invocation contract 或 sandbox contract。

- [x] 2.2 写清 policy 输入只包含可信安全摘要和 refs，不包含 raw prompt、raw model output、raw tool args/result、raw secret、credential、本地路径或 provider 原始响应。
  来源：design Inputs and Preconditions、spec `Risk policy uses trusted and bounded inputs only`
  验证：negative spec review 检查禁止字段清单在 design 和 spec 中一致

- [x] 2.3 写清 policy 与 runtime、capability、sandbox、authorization pending input、observability 的流程接入和 ownership 边界。
  来源：design Flow Integration、spec `Policy enforcement does not own runtime, channel, or persistence truth`
  验证：architecture review 确认 policy 不拥有 RequestRun、checkpoint、terminal commit、channel state 或 sandbox result

- [x] 2.3a 写清 contract ownership alignment：本 change 依赖前置最小 contract refinement，`RiskPolicyEvaluation` 归 `agent-contracts/observability`，不新增 `agent-contracts/policy`，authorization scope 只作为 pending input 服务端绑定事实存在，authorization permission 由 runtime 从 pending input answer 派生且不形成独立持久化对象。
  来源：design Contract Ownership Alignment、spec `Policy outcomes produce safe observability and timeline evidence`、spec `Authorization permission is derived from pending input and is not a separate durable truth`
  验证：architecture/contract review 确认仅消费 0.1 最小清单，无新增 policy subpath、无重复 DTO、无独立 authorization store

- [x] 2.4 写清质量属性审视，覆盖安全、性能/容量、可靠性/恢复、可维护性、可测试性、审计/可追溯性。
  来源：openspec config design rules、design Quality Attributes
  验证：design review 检查每个质量属性均有验证入口

## 3. Contract and Integration

- [x] 3.1 在实现中消费前置 `RiskPolicyEvaluation` 观测事实 contract，并验证其稳定字段、生命周期、消费方和安全限制。
  来源：design State and Artifact Contracts、design Contract Ownership Alignment、spec `Policy outcomes produce safe observability and timeline evidence`
  验证：contract test 断言 evaluation 由 `agent-contracts/observability` owning，且不包含 raw args、secret、路径、raw output 或完整 sandbox request

- [x] 3.2 实现 policy outcome 到 SafeError、authorization intent、`POLICY_APPLIED`、audit/log/metric 的映射。
  来源：design Outputs and Side Effects、spec `Policy outcomes produce safe observability and timeline evidence`
  验证：integration tests 覆盖 deny、authorization required、degraded、policy failed 四类 outcome 的下游产物

- [x] 3.3 接入 capability invocation 前置边界，确保 capability 只在 `ALLOW` 或有效授权 scope 匹配后执行。
  来源：spec `Capability invocation waits for policy outcome`、`Authorization is current-run scoped and single-use`
  验证：agent-core/tool-loop integration tests 断言 policy evaluation 发生在 descriptor resolve 之后、`CAPABILITY_STARTED` 和 `CapabilityInvocationPort.invoke()` 之前；未授权高风险调用不执行；approve 后仅绑定操作执行一次

- [x] 3.4 接入 sandbox 动态执行前置边界，确保动态执行必须同时满足 policy 和 sandbox gateway。
  来源：spec `Dynamic execution requires both policy approval and sandbox boundary`
  验证：app-composed sandbox tool port tests 断言 policy evaluation 发生在 sandbox request summary 形成之后、`SandboxGatewayPort.execute()` 之前；security tests 触发 sandbox unavailable、deny-by-default、host bypass 三类路径并断言不执行宿主命令

- [x] 3.5 接入 retry/recovery 判定，确保可能产生副作用的非幂等操作不会自动重放。
  来源：spec `Safety is determined by a fixed rule order`
  验证：resilience tests 触发 recovery replay，断言无幂等声明时返回 safe denial 或 authorization requirement

## 4. Validation

- [x] 4.1 覆盖正常路径：低风险、只读、已授权 capability 返回 `ALLOW`，下游 capability 执行，并输出 policy allowed 观测事实。
  来源：spec `Low-risk authorized operation is allowed`
  验证：integration test

- [x] 4.2 覆盖当前 builtin Tool 风险基线：工具调用统一分类为 `MEDIUM`，主路径不再仅因 tool risk level 创建 authorization pending input；authorization 绑定路径保留给未来 `HIGH`/`CRITICAL` 非 builtin-tool 操作。
  来源：spec `Builtin tool invocation is medium risk by default`、`Approved authorization allows only the bound operation`
  验证：integration test + negative replay/scope mismatch test

- [x] 4.3 覆盖拒绝路径：未授权 capability、跨 owner 目标、客户端伪造 owner 字段、host execution bypass 均返回 `DENY`，不执行目标操作。
  来源：spec `Unauthorized capability is denied before risk classification`、`Client-provided owner fields are not trusted`、`Host execution bypass is denied`
  验证：negative security tests

- [x] 4.4 覆盖降级路径：sandbox unavailable、policy 配置缺失、无法形成最小安全观测事实时返回 `DEGRADED`，不静默放行。
  来源：spec `Missing sandbox prevents dynamic execution`、`Policy failure and dependency degradation fail closed`
  验证：degradation integration tests

- [x] 4.5 覆盖失败路径：policy timeout、异常、非法 outcome 均返回 `POLICY_FAILED`，目标 capability/sandbox 不执行。
  来源：spec `Illegal policy output fails closed`、`Policy timeout prevents restricted operation`
  验证：fault-injection tests

- [x] 4.6 覆盖安全输出：SafeError、audit、structured log、metric 和 `POLICY_APPLIED` 均不包含 raw prompt、raw model output、raw tool args/result、raw secret、credential、本地路径或完整 sandbox request。
  来源：spec `Risk policy uses trusted and bounded inputs only`、`Policy outcomes produce safe observability and timeline evidence`
  验证：redaction assertions + snapshot/contract tests
