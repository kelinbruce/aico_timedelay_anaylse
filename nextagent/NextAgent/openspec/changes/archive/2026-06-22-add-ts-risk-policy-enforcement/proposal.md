## 背景与问题（Why）

TS 后端已经冻结了 capability invocation、sandbox gateway、authorization pending input、SafeError、timeline-only `POLICY_APPLIED` 和 observability/redaction 的核心边界。受限操作如果只由各执行点自行判断，会产生三类问题：

- capability、sandbox 和 authorization 路径可能出现不一致的放行、拒绝和用户授权口径；
- 高风险操作缺少统一的执行前治理判断，无法稳定回答“为什么允许、为什么拒绝、为什么需要授权”；
- policy 结果如果没有标准产物，后续 audit、structured logging、metrics、release gate 和安全测试无法验证受限操作是否经过治理。

本 change 的目标，是新增首版最小 `risk-policy-enforcement` 规格：在 capability 调用、sandbox 动态执行和授权/高风险确认等受限操作真正执行前，使用系统内置 risk policy 做确定性判定，并把结果以安全、可审计、可追溯的方式交给 runtime、capability、pending input 和 observability 消费。

## 变更范围（What Changes）

- 新增 `risk-policy-enforcement` spec，冻结 risk policy 的触发机制、输入前置、输出副作用、状态产物、判定规则、失败降级和验收样例。
- 定义首版 policy outcome：`ALLOW`、`DENY`、`REQUIRE_AUTHORIZATION`、`DEGRADED`、`POLICY_FAILED`。
- 明确受限操作前的确定性判定顺序：上下文可信性、capability 可执行性、owner scope、操作风险、sandbox 要求、secret/redaction、幂等恢复和审计可见性。
- 明确 policy 结果如何接入 `POLICY_APPLIED`、SafeError、authorization pending input、audit/log/metric，以及 capability/sandbox 的执行边界。
- 明确首版只支持系统内置 risk policy，不引入通用 `PolicyPort`、远端策略插件、脚本策略或开放式策略生态。
- 本实施 change 依赖前置 `refine-ts-risk-policy-contract` 提供最小 contract surface；当前 change 不新增 `agent-contracts/policy`，不新增通用 `PolicyPort`，不重定义 sandbox 或 capability invocation contract。

## 核心实现策略（Current Strategy To Freeze）

冻结以下目标策略：

- risk policy 由受限操作的权威执行前边界同步触发，不由后台 job、日志回放或异步补采触发；
- policy 输入只来自已成立的可信 request/capability/sandbox/authorization 上下文和安全摘要，不消费 raw prompt、raw model output、raw tool args/result、raw secret 或本地路径；
- policy 判定采用 fail-closed 规则：缺失关键依赖、policy 超时、输出非法或无法审计时，不得静默放行高风险操作；
- policy 不拥有 RequestRun lifecycle、checkpoint、terminal commit、channel projection 或 capability 执行结果；
- 需要用户授权时，policy 只产生授权意图，真正 pending input 生命周期由 authorization pending input 边界负责；
- policy 结果如需形成执行事实，写入 timeline-only `POLICY_APPLIED`，首版不新增用户可见 `StreamEventType`。
- contract 仅保留最小清单：`agent-common` 的 `RiskPolicyOutcome` / `RiskLevel` / `RestrictedOperationKind`，`agent-contracts/runtime` 的 `RestrictedOperationSummary` / `RiskPolicyEvaluationInput` / `RiskPolicyDecision` / `RiskPolicyAuthorizationIntent` / `RiskPolicyEvaluator`，`agent-contracts/gateway` 的 `AuthorizationScopeRecord` 与 `PendingInputRecord.authorizationScope?`，以及 `agent-contracts/observability` 的 `RiskPolicyEvaluation`。
- 唯一实施路径：capability invocation policy 接在 `agent-core` tool loop 的 descriptor resolve 之后、`CAPABILITY_STARTED` / `CapabilityInvocationPort.invoke()` 之前；sandbox dynamic execution policy 接在 app-composed sandbox tool port 的 sandbox request summary 形成之后、`SandboxGatewayPort.execute()` 之前；authorization outcome 只由 `agent-runtime` 创建 pending input、绑定 scope、消费 answer 并恢复或重新评估目标 operation。

## Impact

- 影响 capability invocation 的执行前治理边界：调用前必须先得到 policy outcome。
- 影响 sandbox 动态执行边界：shell、python、脚本和模型生成代码执行前必须经过 policy 和 sandbox gateway，不得绕过。
- 影响 authorization pending input：高风险但可授权的操作必须产生当前 run 内一次性授权意图。
- 影响 observability：policy evaluated/allowed/denied/failed 等结果必须进入结构化日志、metrics 和 audit sink 的安全事件流。
- 影响 release/security gate：需要增加正向、拒绝、授权、降级和失败路径验证。
- 主要 owner 为 `agent-runtime`；`agent-capability` 只提供受限操作摘要并按 outcome 停止或继续，`agent-observability` 只消费安全观测事实。

## 归档前基线提升计划（Baseline Promotion Plan）

- 行为契约：新增 `openspec/specs/risk-policy-enforcement/spec.md`。
- 架构设计：在 `openspec/designs/architecture/security-and-governance.md` 或等价安全治理文档中提炼 risk policy 在 capability/sandbox/authorization 之前执行的跨模块流程。
- 领域设计：如存在治理领域文档，提炼 `RiskPolicyDecision` / `RestrictedOperation` 的语义和生命周期。
- 契约设计：在 capability、runtime 或 observability contract 文档中提炼 policy input/outcome、timeline-only `POLICY_APPLIED` 和 audit/log/metric 消费语义。
- 模块设计：在 runtime、capability、observability、app composition 相关模块文档中提炼职责边界。
- ADR：无需新增 ADR，除非后续引入开放式策略扩展。
- spec-to-design-map：归档时补充 risk policy spec 到安全治理、capability invocation、sandbox 和 observability 设计入口的导航。
