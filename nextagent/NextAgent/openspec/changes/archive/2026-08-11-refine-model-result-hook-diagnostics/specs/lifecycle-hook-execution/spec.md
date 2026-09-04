## Function

- **所属 Function**：`FN-10.1 注册和执行钩子`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Stage-specific boundaries and mutations are minimal runtime contracts

系统 SHALL 把各 stage 的 `HookBoundary` 与 `BoundaryMutation` 定义为 `agent-contracts/runtime` contract。系统 MUST NOT 新增 `agent-contracts/hook` public surface，也 MUST NOT 从 capability、channel、observability 或 gateway contract 暴露这些 boundary 或 mutation。

首版每个 stage 的 boundary MUST 只包含当前 stage 已成立的安全事实、稳定 refs、低敏 safe summary、计数、状态枚举或 policy-neutral flags。每个 stage 的 mutation MUST 是封闭对象。目标 stage / mutation 支持范围 MUST 恰好为：

| Stage | Mutation fields |
|---|---|
| `BEFORE_REQUEST_ACCEPT` | none |
| `BEFORE_PLANNING` | `flowVariables`, `capabilityGeneratedMessages`, `capabilityContextPatch`, `maxRounds`, `maxCalls` |
| `BEFORE_MODEL_INVOKE` | `messages`, `tools`, `temperature`, `maxOutputTokens`, `topP`, `topK`, `presencePenalty`, `frequencyPenalty`, `thinking`, `providerOptions`, `timeoutMs`, `maxRetries` |
| `AFTER_MODEL_RESULT` | `content`, `reasoning`, `toolCalls` |
| `BEFORE_CAPABILITY_INVOKE` | `arguments`, `timeoutMs` |
| `AFTER_CAPABILITY_RESULT` | `structuredPayload`, `generatedMessages`, `contextPatch` |
| `BEFORE_CONTEXT_COMPACT` | `targetBudgetUnits` |
| `AFTER_CONTEXT_COMPACT` | `content` |
| `BEFORE_AGENT_TERMINAL` | `finalContent`, `toolCalls` |

`BEFORE_MODEL_INVOKE` mutation fields MUST 复用 `ModelInvocationRequest` 的同名字段约束。mutation 省略任一 optional 字段时 MUST 保持 hook 前的 effective value，MUST NOT 清空该字段或由 hook 合成默认值；hook 前 request/profile 均未提供的字段 MUST 继续使用模型调用契约定义的固定默认值或缺省语义。`providerOptions` 只有在 hook 已激活且具有 model-invocation transform authority、mutation 通过 runtime stage schema 校验并随后通过 selected-provider reserved-field validation 时，MUST 才构成授权来源。该 mutation MUST NOT 修改 selected `modelId`、`invocationScope`、provider identity、endpoint、credential、header、transport、Owner Scope、Agent Scope 或 execution budget。单一 scope 的 `operationId` 与 all-or-none optional `sessionId/requestId/runId` 是 owning lifecycle 已冻结的受保护 correlation coordinates，MUST NOT 由 mutation 修改或在顶层重复。系统 MUST 对通过统一 `ModelInvocationService` 进入的每一次 concrete provider invocation 执行当前 Agent 已激活的 `BEFORE_MODEL_INVOKE` 与 `AFTER_MODEL_RESULT` hook；run-bound/background lifecycle MUST 由可信活跃/终态事实决定，MUST NOT 从 scope shape、operation id 格式或调用方 marker 推断。没有活跃 accepted run 的 background caller MUST NOT 为进入 hook、pending 或 timeline 而合成 coordinates。background model hook MAY `PASS`、`SKIP`、`TRANSFORM`、`DENY` 或 `BLOCK`；`PEND` 依赖活跃 run checkpoint/resume truth，因此 background `BEFORE_MODEL_INVOKE` hook 返回 `PEND` 时 MUST 在 provider execution 前安全失败，MUST NOT 创建 pending input。background model hook invocation MUST NOT 写入或合成 request-run `HOOK_INVOKED` 或 `MODEL_INVOCATION_*` timeline fact。prompt locale 由上游选择和渲染消费。显式 `null`、closed schema 未列出的字段、非法值和修改受保护字段的尝试 MUST 在 provider access 前 fail closed。

成功完成的 `AFTER_MODEL_RESULT` boundary MUST 包含 `modelE2ELatencyMs`。该字段 MUST 是非负整数毫秒，测量起点是 concrete provider invocation 开始，终点是成功 terminal result 返回。系统检测到首个非空 content delta、非空 reasoning delta、tool call delta，或成功 terminal result 中首个非空 content、非空 reasoning、至少一个 tool call 时，boundary MUST 包含 `firstContentLatencyMs`；该字段 MUST 是从同一测量起点到首个可识别反馈的非负整数毫秒。content、reasoning 和 tool call 同时出现时，最先被系统观察到的任一反馈 MUST 确定该值。成功结果没有上述任一反馈时，boundary MUST 省略 `firstContentLatencyMs`。

成功 `ModelFinalResult` 携带 `usage` 时，`AFTER_MODEL_RESULT` boundary MUST 投影同一 `usage` 对象中已提供的 `inputTokens`、`outputTokens` 和 `totalTokens`；每个已提供字段 MUST 保持原始非负安全整数值，未提供字段 MUST 保持缺失。成功结果未携带 `usage` 时，boundary MUST 省略 `usage`。系统 MUST NOT 估算、补齐或从其他 token 字段推导 usage。`modelE2ELatencyMs`、`firstContentLatencyMs` 和 `usage` 仅是 observe-only boundary facts，MUST NOT 成为 mutation fields；hook 对这些字段返回的任何修改 MUST NOT 改变模型结果。

系统交付给 hook 的 `messages`、`tools`、`thinking` 和 `providerOptions` MUST 与有效模型请求安全隔离。hook 对收到的嵌套值执行原地修改，或在返回 replacement 后继续修改同一引用，MUST NOT 改变 hook 前请求、已接受的 effective request 或 provider input。

未知 mutation 字段、owner/agent override、runtime state mutation、JSON Patch、expression DSL 和 cross-stage mutation MUST fail closed。Mutation type MUST 由 lifecycle stage 决定；runtime SHALL 在校验时推导 mutation kind。`HOOK_INVOKED.mutationSummary` MUST 只包含由 stage 推导的 mutation kind 和被替换字段名，MUST NOT 包含字段值或 provider option value。

**需求类别**：功能性需求

#### Scenario: 拒绝不受支持的 stage mutation

- **WHEN** `BEFORE_REQUEST_ACCEPT` stage 的 hook 返回任一 mutation
- **THEN** runtime MUST 把该 result 视为此 stage 的非法结果
- **AND** MUST 按 hook failure mode 处理

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

#### Scenario: 流式调用以首个模型反馈计时

- **WHEN** 成功流式模型调用首次返回非空 content delta、非空 reasoning delta 或 tool call delta 中的任一反馈
- **THEN** `AFTER_MODEL_RESULT` boundary MUST 包含从 provider invocation 开始到该反馈的 `firstContentLatencyMs`
- **AND** boundary MUST 包含从 provider invocation 开始到成功 terminal result 的 `modelE2ELatencyMs`

#### Scenario: 非流式结果以 terminal tool call 计时

- **WHEN** 成功非流式模型调用的 terminal result 没有非空 content 和 reasoning，但包含至少一个 tool call
- **THEN** `AFTER_MODEL_RESULT` boundary MUST 包含以该 terminal result 为首次反馈的 `firstContentLatencyMs`
- **AND** `modelE2ELatencyMs` MUST 使用同一调用起点和成功 terminal result 终点

#### Scenario: 成功结果不包含可识别反馈

- **WHEN** 成功模型调用的 stream 和 terminal result 均不包含非空 content、非空 reasoning 或 tool call
- **THEN** `AFTER_MODEL_RESULT` boundary MUST 省略 `firstContentLatencyMs`
- **AND** MUST 仍包含 `modelE2ELatencyMs`

#### Scenario: 精确投影部分 usage

- **WHEN** 成功 `ModelFinalResult.usage` 只提供 `inputTokens` 和 `totalTokens`
- **THEN** `AFTER_MODEL_RESULT.usage` MUST 保持这两个字段的原始值
- **AND** MUST 省略 `outputTokens`

#### Scenario: Provider 未返回 usage

- **WHEN** 成功 `ModelFinalResult` 未携带 `usage`
- **THEN** `AFTER_MODEL_RESULT` boundary MUST 省略 `usage`
- **AND** 系统 MUST NOT 估算、补齐或推导 token 计数

#### Scenario: 模型调用失败

- **WHEN** concrete provider invocation 未返回成功 terminal result
- **THEN** 系统 MUST NOT 合成 `AFTER_MODEL_RESULT` boundary
- **AND** MUST NOT 以失败时刻合成 model E2E、first feedback 或 usage 诊断事实

## Function 变更汇总

### 输出

- **变更类型**：修改
- **目标内容**：成功模型调用的 `AFTER_MODEL_RESULT` 输出包含端到端耗时，在出现可识别模型反馈时包含首次反馈耗时，并在 provider 提供 usage 时精确投影已提供的 token 计数字段。
- **依据 Requirements**：`Stage-specific boundaries and mutations are minimal runtime contracts`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统从模型调用开始测量成功结果和首次可识别反馈，并保持 usage 缺失语义；诊断事实只供观察，不参与 hook mutation。
- **依据 Requirements**：`Stage-specific boundaries and mutations are minimal runtime contracts`
