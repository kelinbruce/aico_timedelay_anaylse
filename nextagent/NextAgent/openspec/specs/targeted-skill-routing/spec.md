# targeted-skill-routing Specification

## Purpose
Define the stable governed routing path for trusted request-directed `targetSkill` handling without bypassing capability governance, request lifecycle boundaries, or model-facing Skill tool semantics.
## Function

- **所属 Function**：`FN-2.6 指定技能处理`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: Target Skill is a routing constraint
After routing constraint contracts are refined, the system SHALL treat `targetSkill` from user or upstream input as a typed routing constraint. It SHALL NOT treat it as direct authorization to invoke a Skill.

#### Scenario: Channel receives targetSkill
- **WHEN** channel receives a request with `targetSkill`
- **THEN** channel MAY forward it as a typed routing constraint through runtime request submission
- **AND** channel MUST NOT call the Skill directly
- **AND** runtime MUST NOT resolve or execute the Skill before Agent routing policy accepts the constraint

### Requirement: Target Skill routing is governed before execution
Agent routing policy SHALL resolve a target Skill only through the request-scope capability governance boundary and SHALL validate kind=`SKILL`, current Agent binding, Owner Scope visibility/authorization, availability, forbidden constraints, capability invocation budget, deadline, and cancellation before execution.

#### Scenario: Target Skill is accepted
- **WHEN** a request specifies `targetSkill=alarm-diagnosis`
- **AND** the Skill belongs to the current frozen Agent assembly, is enabled, available, visible and authorized for the current Owner Scope, not forbidden, and within capability invocation budget
- **THEN** Agent routing policy MAY select an Agent-owned deterministic flow that internally invokes the governed Skill
- **AND** Skill execution MUST use the governed capability invocation path
- **AND** the decision MUST produce safe routing outcome/evidence for downstream observability

#### Scenario: Target Skill is forbidden by constraint
- **WHEN** `targetSkill` names a Skill also present in `forbiddenCapabilityIds`
- **THEN** Agent routing policy MUST reject the target Skill
- **AND** it MUST NOT execute that Skill
- **AND** it MUST return safe error, clarification, or an allowed fallback path according to policy

#### Scenario: Target Skill is outside Agent scope
- **WHEN** `targetSkill` resolves to a Skill not bound to the current accepted Agent assembly
- **THEN** Agent routing policy MUST reject the directed Skill path
- **AND** it MUST NOT search another Agent or global catalog to execute it

### Requirement: Targeted Skill execution preserves request lifecycle boundaries
Targeted Skill routing SHALL execute within the accepted request/run lifecycle and SHALL not create session messages, terminal commits, audit events, checkpoints, or timeline events outside the existing runtime/core ports. This change SHALL NOT add a new public routing decision kind for directed Skill execution.

#### Scenario: Directed Skill succeeds
- **WHEN** a governed preferred Skill invocation succeeds
- **THEN** Agent Core MUST consume the `CapabilityInvocationResult` through the unified result contract
- **AND** generated messages, context patches, refs, safe payloads, degradation, or safe errors MUST follow existing capability result consumption rules

#### Scenario: Directed Skill requires user input
- **WHEN** the selected Skill needs clarification, confirmation, authorization, or human handoff before execution
- **THEN** Agent Core MUST use the runtime-owned pending input or handoff boundary
- **AND** it MUST NOT create an Agent-local pending state invisible to runtime

### Requirement: Target Skill failures degrade explicitly

当请求通过可信 `routingConstraints.targetSkill` 指定 Skill 时，系统 MUST 使用当前 Agent scope 解析目标 Skill，并通过统一 Capability 调用边界执行。调用成功或合法降级时，系统 MUST 保留定向 Skill 结果和 request-local context 行为。

目标不可用、输入非法、父 `AbortSignal` 已取消、descriptor 解析失败、最终 Capability 失败、非法 `CapabilityInvocationResult` 或调用 rejection MUST 形成安全且确定的结果。定向 Skill 路径 MUST NOT 回退到普通模型选路，MUST NOT 在 Agent loop 中自动重放。统一调用边界 MUST 仅按 `capability-catalog / 瞬态失败只在统一执行边界安全重试` 和当前 invocation 的 effective `maxRetries` 执行内部自动重试；字段缺失时 MUST 使用该 Requirement 定义的 canonical 缺省行为。

最终 `safeError.category=CANCELED` MUST 结束为取消终态。其他最终失败 MUST 使用 `CapabilityInvocationResult.safeError` 或规范化的安全内部错误构造终止 message，并 MUST 结束当前请求；raw Skill body、source 路径、resolver exception、owner scope 和 provider response MUST NOT 进入 message。

**需求类别**：功能性需求

#### Scenario: 定向 Skill 成功

- **WHEN** 可信 target Skill 可用且执行成功
- **THEN** 系统 MUST 使用该 Skill 的结果继续当前请求
- **AND** 系统 MUST NOT 改为普通模型自主选择 Skill

#### Scenario: 定向 Skill 最终失败

- **WHEN** 统一调用边界返回最终 `FAILED` 或 `TIMED_OUT`
- **THEN** 系统 MUST 保留 `safeError.code/category/message`
- **AND** 系统 MUST 结束当前请求
- **AND** 系统 MUST NOT 进入普通 Agent tool loop 或执行第二层自动重试

#### Scenario: 定向 Skill 取消

- **WHEN** 解析或执行定向 Skill 时请求被取消
- **THEN** 系统 MUST 结束为取消终态
- **AND** 系统 MUST NOT 创建失败终态或模型恢复轮次

#### Scenario: 定向 Skill 返回非法结果

- **WHEN** 定向 Skill 返回的 `CapabilityInvocationResult` 不满足公共 schema
- **THEN** 系统 MUST 使用稳定 `INTERNAL + retryable=false` 错误终止
- **AND** 非法结果内容 MUST NOT 进入终止 message

### Requirement: Targeted Skill routing is distinct from model Skill tool use
User-directed Skill routing SHALL be a trusted Agent routing path. Model-originated `Skill` tool use SHALL remain governed by the Skill tool contract and MUST NOT be treated as a user-directed `targetSkill`.

#### Scenario: Model emits a Skill tool call
- **WHEN** the model calls the `Skill` tool with a `name`
- **THEN** that call MUST follow the model-facing Skill tool governance path
- **AND** it MUST NOT retroactively become a user-trusted `targetSkill`

#### Scenario: User specifies target Skill
- **WHEN** the user or upstream trusted boundary supplies `targetSkill`
- **THEN** Agent routing policy MUST handle it before model-generated tool calls
- **AND** model output MUST NOT override or broaden the trusted target Skill constraint
- **AND** targeted Skill routing MUST NOT re-accept a `targetSkill` that has already been rejected by routing constraint governance for the same accepted request

### Requirement: Skill Directive Produces Target Skill Constraint

The router SHALL treat a valid `$skill:<name>` natural-language directive as a request-local source for the existing governed target Skill routing path. A directive-derived Skill target SHALL NOT bypass capability governance, request lifecycle boundaries, or model-facing Skill tool semantics.

#### Scenario: Directive-derived targetSkill is governed
- **WHEN** accepted request text contains `$skill:alarm-diagnosis`
- **THEN** router MUST produce the same governed target Skill routing input used for request-directed Skill routing
- **AND** Agent routing policy MUST validate kind=`SKILL`, current Agent binding, Owner Scope visibility/authorization, availability, forbidden constraints, budget, deadline, and cancellation before execution

#### Scenario: Skill directive does not become model Skill tool use
- **WHEN** accepted request text contains `$skill:alarm-diagnosis`
- **THEN** router MUST handle it before model-generated tool calls
- **AND** model output MUST NOT override, broaden, or reclassify the directive-derived target Skill

#### Scenario: Skill directive target is not a workflow
- **WHEN** accepted request text contains `$skill:push-gate`
- **AND** `push-gate` is visible only as a `WORKFLOW` capability
- **THEN** target Skill routing MUST reject or degrade the directed Skill target
- **AND** it MUST NOT reinterpret `$skill:push-gate` as `routingConstraints.targetRecipe`

### Requirement: 定向 Skill 加载必须发布 Capability lifecycle facts

当可信 `routingConstraints.targetSkill` 指定的 Skill 已通过治理校验并实际进入受治理 Capability 调用边界时，系统 MUST 发布 `CAPABILITY_STARTED`；该调用产生最终结果后，系统 MUST 发布 `CAPABILITY_COMPLETED`。同一调用的两个事件 MUST 逐值复用相同 `capabilityKind`、`capabilityId`、`targetCapabilityId` 和 `toolCallId`，且 `targetCapabilityId` MUST 等于已解析的目标 Skill id。`CAPABILITY_STARTED` MUST 引用已持久化的 Tool-use message，`CAPABILITY_COMPLETED` MUST 引用已持久化的 Capability result message。目标 Skill 在 Capability 调用开始前被拒绝、不可用或因请求取消而未开始时，系统 MUST NOT 发布这两类 Capability lifecycle facts；已有 routing evidence 和安全失败语义 MUST 保持不变。

**需求类别**：功能性需求

#### Scenario: 定向 Skill 成功加载

- **WHEN** 请求指定 `targetSkill=alarm-diagnosis`，且该 Skill 通过当前 Agent Scope、Owner Scope 和 capability governance 校验并开始加载
- **THEN** 系统 MUST 发布引用持久化 Tool-use message 的 `CAPABILITY_STARTED`
- **AND** 该事件 MUST 使用 `capabilityKind=TOOL`、`capabilityId=Skill`、`targetCapabilityId=alarm-diagnosis` 和同一 directed Skill 调用的 `toolCallId`
- **AND** 加载产生最终成功结果后，系统 MUST 发布引用持久化 Capability result message 的 `CAPABILITY_COMPLETED`
- **AND** completion MUST 逐值复用 started 事件中的 Capability 身份

#### Scenario: 定向 Skill 在调用前不可用

- **WHEN** 请求指定 `targetSkill=alarm-diagnosis`，但该 Skill 被禁止、超出 Agent Scope 或在 Capability 调用开始前不可用
- **THEN** 系统 MUST NOT 发布 `CAPABILITY_STARTED` 或 `CAPABILITY_COMPLETED`
- **AND** 系统 MUST 保留现有 routing evidence、安全错误或请求失败语义

#### Scenario: 定向 Skill 降级或最终失败

- **WHEN** 定向 Skill 已开始受治理调用，并返回合法降级、失败或超时结果
- **THEN** 系统 MUST 发布引用持久化 Capability result message 的 `CAPABILITY_COMPLETED`
- **AND** 该事件 MUST 表达对应最终状态和安全失败事实，且 MUST NOT 重新解释目标 Skill 身份
