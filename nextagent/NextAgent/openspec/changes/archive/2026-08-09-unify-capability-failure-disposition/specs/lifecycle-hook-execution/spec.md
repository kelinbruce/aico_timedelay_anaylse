# lifecycle-hook-execution Delta Specification

所属 Function：`FN-10.1 注册和执行钩子`

Function 变更类型：修改

spec 角色：主规格

## MODIFIED Requirements

### Requirement: Stage-specific boundaries and mutations are minimal runtime contracts

系统 SHALL 把各 stage 的 `HookBoundary` 与 `BoundaryMutation` 定义为 `agent-contracts/runtime` contract。系统 MUST NOT 新增 `agent-contracts/hook` public surface，也 MUST NOT 从 capability、channel、observability 或 gateway contract 暴露这些 boundary 或 mutation。

首版每个 stage 的 boundary MUST 只包含当前 stage 已成立的安全事实、稳定 refs、低敏 safe summary、计数、状态枚举或 policy-neutral flags。每个 stage 的 mutation MUST 是封闭对象。目标 stage / mutation 支持范围 MUST 恰好为：

| Stage | Mutation fields |
|---|---|
| `BEFORE_REQUEST_ACCEPT` | none |
| `BEFORE_PLANNING` | `flowVariables`, `capabilityGeneratedMessages`, `capabilityContextPatch` |
| `BEFORE_MODEL_INVOKE` | `messages`, `tools`, `temperature`, `maxOutputTokens`, `topP`, `topK`, `presencePenalty`, `frequencyPenalty`, `thinking`, `toolChoice`, `providerOptions`, `timeoutMs`, `maxRetries` |
| `AFTER_MODEL_RESULT` | `content`, `reasoning`, `toolCalls` |
| `BEFORE_CAPABILITY_INVOKE` | `arguments`, `timeoutMs` |
| `AFTER_CAPABILITY_RESULT` | `structuredPayload`, `generatedMessages`, `contextPatch` |
| `BEFORE_CONTEXT_COMPACT` | `targetBudgetUnits` |
| `AFTER_CONTEXT_COMPACT` | `content` |
| `BEFORE_AGENT_TERMINAL` | `finalContent`, `toolCalls` |

`BEFORE_MODEL_INVOKE` mutation fields MUST 复用 `ModelInvocationRequest` 的同名字段约束。mutation 省略任一 optional 字段时 MUST 保持 hook 前的 effective value，MUST NOT 清空该字段或由 hook 合成默认值；hook 前 request/profile 均未提供的字段 MUST 继续使用模型调用契约定义的固定默认值或缺省语义。`providerOptions` 只有在 hook 已激活且具有 model-invocation transform authority、mutation 通过 runtime stage schema 校验并随后通过 selected-provider reserved-field validation 时，MUST 才构成授权来源。该 mutation MUST NOT 修改 selected `modelId`、`invocationScope`、provider identity、endpoint、credential、header、transport、Owner Scope、Agent Scope 或 execution budget。单一 scope 的 `operationId` 与 all-or-none optional `sessionId/requestId/runId` 是 owning lifecycle 已冻结的受保护 correlation coordinates，MUST NOT 由 mutation 修改或在顶层重复。系统 MUST 对通过统一 `ModelInvocationService` 进入的每一次 concrete provider invocation 执行当前 Agent 已激活的 `BEFORE_MODEL_INVOKE` 与 `AFTER_MODEL_RESULT` hook；run-bound/background lifecycle MUST 由可信活跃/终态事实决定，MUST NOT 从 scope shape、operation id 格式或调用方 marker 推断。没有活跃 accepted run 的 background caller MUST NOT 为进入 hook、pending 或 timeline 而合成 coordinates。background model hook MAY `PASS`、`SKIP`、`TRANSFORM`、`DENY` 或 `BLOCK`；`PEND` 依赖活跃 run checkpoint/resume truth，因此 background `BEFORE_MODEL_INVOKE` hook 返回 `PEND` 时 MUST 在 provider execution 前安全失败，MUST NOT 创建 pending input。background model hook invocation MUST NOT 写入或合成 request-run `HOOK_INVOKED` 或 `MODEL_INVOCATION_*` timeline fact。prompt locale 由上游选择和渲染消费。显式 `null`、closed schema 未列出的字段、非法值和修改受保护字段的尝试 MUST 在 provider access 前 fail closed。

系统交付给 hook 的 `messages`、`tools`、`thinking` 和 `providerOptions` MUST 与有效模型请求安全隔离。hook 对收到的嵌套值执行原地修改，或在返回 replacement 后继续修改同一引用，MUST NOT 改变 hook 前请求、已接受的 effective request 或 provider input。

未知 mutation 字段、owner/agent override、runtime state mutation、JSON Patch、expression DSL 和 cross-stage mutation MUST fail closed。Mutation type MUST 由 lifecycle stage 决定；runtime SHALL 在校验时推导 mutation kind。`HOOK_INVOKED.mutationSummary` MUST 只包含由 stage 推导的 mutation kind 和被替换字段名，MUST NOT 包含字段值或 provider option value。

**需求类别**：功能性需求

#### Scenario: 拒绝不受支持的 stage mutation

- **WHEN** `BEFORE_REQUEST_ACCEPT` stage 的 hook 返回任一 mutation
- **THEN** runtime MUST 把该 result 视为此 stage 的非法结果
- **AND** MUST 按 hook failure mode 处理

#### Scenario: Planning hook 不能覆盖 Agent loop limits

- **WHEN** `BEFORE_PLANNING` mutation 提供 `maxRounds`、`maxCalls`、`maxTurns`、`maxToolCallsPerTurn` 或其他 loop limit
- **THEN** runtime MUST 按 closed stage schema 拒绝该 mutation
- **AND** accepted Agent assembly 提供的 effective loop limits MUST 保持不变

#### Scenario: Boundary contracts 保持在 runtime surface

- **WHEN** 系统提供 stage-specific hook boundary 或 mutation type
- **THEN** 这些 contracts MUST 从 `agent-contracts/runtime` 导出
- **AND** MUST NOT 引入 `agent-contracts/hook` export surface

#### Scenario: Model hook 应用 provider-neutral 调用字段

- **WHEN** 已激活且已授权的 `BEFORE_MODEL_INVOKE` hook 返回通过 schema 校验的 provider-neutral inference fields、timeout 或 max retries
- **THEN** runtime MUST 只把这些字段应用到 effective model invocation boundary
- **AND** model invocation MUST 继续执行 selected profile defaults、runtime budget、cancellation 和 provider capability validation

#### Scenario: Model hook 省略可选调用字段

- **WHEN** `BEFORE_MODEL_INVOKE` mutation 省略一个或多个 optional model invocation fields
- **THEN** runtime MUST 保持这些字段的 hook 前 effective value
- **AND** hook MUST NOT 清空字段、合成默认值或改变模型调用契约的后续缺省解析

#### Scenario: Model hook 提供 selected-provider options

- **WHEN** 已激活且已授权的 `BEFORE_MODEL_INVOKE` hook 返回通过 schema 校验的 inner `providerOptions`
- **THEN** runtime MUST 把该值传给 effective provider-options merge 和 selected-provider validation
- **AND** raw option values MUST NOT 进入 `mutationSummary`、error、log、metric、trace、audit 或用户可见输出

#### Scenario: Model hook mutation 遵守封闭 schema

- **WHEN** `BEFORE_MODEL_INVOKE` mutation 包含该 stage contract 未列出的字段
- **THEN** runtime MUST 将其作为未知字段拒绝
- **AND** effective model invocation MUST 保持不变

#### Scenario: Model hook 原地修改嵌套 boundary

- **WHEN** hook 尝试原地修改 received `messages`、tool descriptor、`thinking` 或 `providerOptions` 的嵌套数组或对象，且未返回对应 replacement mutation
- **THEN** owner request、effective request 和 provider input MUST 保持不变
- **AND** 未替换字段 MUST NOT 仅因为 hook 运行而要求全量 deep clone

#### Scenario: Hook 返回 replacement 后继续修改原引用

- **WHEN** hook 返回合法 replacement mutation，runtime 接受该 mutation 后 hook code 继续修改同一 replacement object reference
- **THEN** 已应用的 effective model request MUST 保持不变
- **AND** provider input MUST 保持已接受 mutation 时的值

#### Scenario: Model hook 尝试修改受保护 authority

- **WHEN** `BEFORE_MODEL_INVOKE` mutation 包含 model identity、lifecycle scope、provider access、transport、Owner/Agent Scope 或 execution-budget authority
- **THEN** runtime MUST 在 provider access 前拒绝该 mutation
- **AND** selected model、scope 和 provider access MUST 保持不变

#### Scenario: Background 模型调用执行同一 model hook

- **WHEN** recommendation、memory extraction 或其他没有活跃 accepted run 的受治理 background caller 通过统一 `ModelInvocationService` 调用模型
- **THEN** 系统 MUST 执行当前 Agent 已激活的 `BEFORE_MODEL_INVOKE` 与 `AFTER_MODEL_RESULT` hook
- **AND** 合法 mutation MUST 按与 run-bound invocation 相同的模型字段规则生效
- **AND** runtime MUST NOT 创建或合成 request-run `HOOK_INVOKED` 或 `MODEL_INVOCATION_*` timeline fact

#### Scenario: Background model hook 请求 pending

- **WHEN** background `BEFORE_MODEL_INVOKE` hook 返回 `PEND`
- **THEN** provider execution MUST NOT 启动
- **AND** runtime MUST NOT 创建 pending input、checkpoint、synthetic run coordinates 或 request-run timeline fact
- **AND** background owner MUST 收到安全失败
#### Scenario: BEFORE_MODEL_INVOKE Hook 覆盖 ToolChoice

- **WHEN** 已激活且具有 model-invocation transform authority 的 `BEFORE_MODEL_INVOKE` hook 返回 `toolChoice=AUTO | NONE | REQUIRED`
- **THEN** mutation schema MUST 按 canonical `ToolChoice` 接受该字段
- **AND** 该值 MUST 覆盖 hook 前 effective `toolChoice`
- **AND** named-tool object、provider-native `tool_choice`、显式 `null` 或其他值 MUST 在 provider access 前 fail closed

#### Scenario: Hook 不能扩大 runtime-owned ToolChoice 硬约束

- **GIVEN** 当前 invocation 因 `executionMode=model-only` 或 finalizing 具有 runtime-owned `toolChoice=NONE` hard constraint
- **WHEN** `BEFORE_MODEL_INVOKE` Hook 返回 `toolChoice=AUTO` 或 `REQUIRED`
- **THEN** Hook merge 后的 effective `toolChoice` MUST 仍为 `NONE`
- **AND** selected provider MUST 接收 native none control
- **AND** Hook mutation MUST NOT 扩大当前 invocation 的 Tool execution authority

## Function 变更汇总

### 描述

- 变更类型：修改
- 目标内容：governed model-invocation Hook 可以通过 canonical `ToolChoice` 转换本次模型调用，但任何 Hook 都不能覆盖 Agent-owned loop limits。
- 依据 Requirements：`Stage-specific boundaries and mutations are minimal runtime contracts`

### 输入

- 变更类型：修改
- 目标内容：`BEFORE_MODEL_INVOKE` boundary/mutation closed schema 增加 optional `toolChoice`；`BEFORE_PLANNING` mutation 不包含任何 loop-limit 字段。
- 依据 Requirements：`Stage-specific boundaries and mutations are minimal runtime contracts`

### 输出

- 变更类型：修改
- 目标内容：合法 Hook mutation 可以在普通模型调用中产生新的 effective `toolChoice`，省略时保持原值；model-only 与 finalizing 的 runtime hard constraint 在 Hook merge 后保持 `NONE`。
- 依据 Requirements：`Stage-specific boundaries and mutations are minimal runtime contracts`

### 处理过程

- 变更类型：修改
- 目标内容：Hook mutation 按 canonical authority、ordering 和 fail-closed schema 生效，只能修改所属 stage 明确允许的字段，不能建立 provider-native 字段或 loop budget 的平行入口。
- 依据 Requirements：`Stage-specific boundaries and mutations are minimal runtime contracts`

### 结果

- 变更类型：修改
- 目标内容：Hook 可以在普通 invocation 中覆盖 `ToolChoice`；model-only/finalizing 不允许 Hook 扩大 Tool 选择权，Agent Core hard guard 继续防御 provider 违规返回。
- 依据 Requirements：`Stage-specific boundaries and mutations are minimal runtime contracts`
