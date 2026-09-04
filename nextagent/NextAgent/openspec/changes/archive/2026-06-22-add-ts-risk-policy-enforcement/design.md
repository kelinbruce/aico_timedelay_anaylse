## 背景和现状（Context）

本 change 只收敛首版系统内置 risk policy enforcement，不扩展为开放式策略平台，也不让 policy 成为新的执行真相来源。

当前已冻结或已规划的相关边界包括：

- capability invocation 使用统一请求和结果边界；
- sandbox 动态执行必须通过 sandbox gateway；
- authorization pending input 支持当前 run 内一次受限操作的显式授权；
- `POLICY_APPLIED` 是 timeline-only event，首版不进入用户可见 stream event；
- SafeError、redaction、structured logging、audit 和 metrics 是 Owner 11 的横切治理面；
- 核心契约不定义泛化 `PolicyPort`。

本 change 要做的，是把这些边界收敛成一个可落地、可验证、不会越权的执行前安全判定模型。

## 目标和非目标（Goals / Non-Goals）

### 目标

- 明确 risk policy 在哪些受限操作前同步触发。
- 明确 policy 判定所需输入、前置状态、配置和安全上下文。
- 明确 policy outcome、SafeError、authorization intent、`POLICY_APPLIED`、audit/log/metric 的产物语义。
- 明确“是否安全”的确定性判断顺序，不把关键判断留给实现阶段。
- 明确失败、超时、依赖缺失、审计不可用和 sandbox 不可用时如何 fail closed。

### 非目标

- 不定义开放式策略插件、远端策略服务、脚本策略、热加载策略或策略 marketplace。
- 不定义通用 `PolicyPort`。
- 不让 policy 拥有 RequestRun lifecycle、checkpoint、terminal commit、session history 或 channel projection。
- 不让模型、客户端 payload 或 capability 参数自行声明“已授权”或“安全”。
- 不规定代码类名、文件组织、TS/TSX 实现细节或具体框架 API。

## 第一性原理（First Principle）

risk policy 的职责不是“执行操作”，而是在受限操作进入真实执行前，基于当前可信事实给出治理结论：

- 这个操作是否可在当前 owner、Agent、capability 和运行环境下执行；
- 是否必须拒绝；
- 是否需要当前用户在当前 run 内做一次显式授权；
- 是否因为依赖不可用或治理链路不完整而 fail closed；
- 如何留下安全、可审计、可追溯的判定事实。

它负责“执行前是否允许继续”，不负责“如何执行 capability/sandbox”，也不负责“如何提交 run 终态”。

## 黑盒目标（Blackbox Goal）

当主流程准备执行 capability、sandbox 动态执行或授权/高风险确认相关受限操作时，系统能够同步执行系统内置 risk policy，并输出一个稳定 outcome：

- `ALLOW`：继续执行；
- `DENY`：拒绝执行并返回安全失败；
- `REQUIRE_AUTHORIZATION`：创建当前 run 内一次性 authorization pending input；
- `DEGRADED`：治理依赖不可用或运行态不满足安全前置，操作不得执行；
- `POLICY_FAILED`：policy 自身失败、超时或非法输出，操作不得执行。

每次判定都必须留下安全观测事实；涉及执行路径改变的结果必须写入 timeline-only `POLICY_APPLIED`。

## 边界（Boundary）

- 负责：受限操作分类、执行前同步判定、policy outcome、授权意图、SafeError、安全观测事实、`POLICY_APPLIED`
- 不负责：capability catalog 真相、sandbox 实际隔离、pending input 领域生命周期、RequestRun 终态、checkpoint、用户可见 stream event、长期策略扩展生态

## 契约归属对齐（Contract Ownership Alignment）

本 change 不新增 `agent-contracts/policy` owning subpath，也不把 risk policy 提升为独立架构 package。相关 contract 必须落到已冻结的 owning export module：

- 本实施 change 依赖前置 `refine-ts-risk-policy-contract` 提供最小 contract surface；若该前置未完成，本 change 不进入实现。
- `agent-common` 只新增共享 vocabulary：`RiskPolicyOutcome`、`RiskLevel`、`RestrictedOperationKind`。
- `agent-contracts/runtime` 只承载 runtime-facing 专用 evaluator contract：`RestrictedOperationSummary`、`RiskPolicyEvaluationInput`、`RiskPolicyDecision`、`RiskPolicyAuthorizationIntent`、`RiskPolicyEvaluator`。
- `agent-contracts/gateway` 只承载 authorization pending input 的服务端绑定事实：`AuthorizationScopeRecord` 与 `PendingInputRecord.authorizationScope?`；该 scope 不进入客户端 answer payload，也不是独立 authorization store。
- `RiskPolicyEvaluation` 是结构化观测事实，归 `agent-contracts/observability` owning；它可以被 structured logging、metrics、audit sink 和 release/security gate 消费，但不是业务真相对象。
- `POLICY_APPLIED` 继续使用 runtime-owned canonical timeline vocabulary，不新增 channel stream event 或 policy event namespace。
- authorization fact 不是独立持久化对象；它是 runtime 基于 authorization pending input answer、policy-bound scope 和当前 run 状态派生出的一次性执行许可。
- authorization scope 不进入客户端 answer payload，也不形成跨 run、跨 session 或长期授权记录。

首版不增加 `RiskPolicyEvaluationWriter`、`PolicyAppliedTimelinePayload`、sandbox contract 修改、capability invocation request/result 字段、新 `StreamEventType` 或独立 authorization store。

## 当前冻结的核心实现策略（Current Strategy To Freeze）

首版冻结以下策略：

1. 系统内置 policy 集合
2. 受限操作前同步执行
3. 确定性判定顺序
4. 默认 fail closed
5. 高风险可授权操作转为 authorization pending input
6. 动态执行必须同时满足 policy 允许和 sandbox gateway 边界
7. 每次 policy evaluation 产生安全观测事实
8. 改变执行路径时写入 timeline-only `POLICY_APPLIED`

## 唯一实施路径（Unique Implementation Path）

本 change 只能沿现有请求主链路接入，不新增 policy execution pipeline，也不把 policy 做成 lifecycle hook、gateway adapter 内部逻辑或各 Tool 私有判断。

唯一实施路径如下：

```text
Web/channel
  -> agent-runtime submit / scheduler / RequestRun
  -> Agent.execute()
  -> agent-core tool loop
  -> CapabilityCatalog.resolve
  -> RiskPolicyEvaluator.evaluate(CAPABILITY_INVOCATION)
  -> runtime consumes policy outcome
  -> CAPABILITY_STARTED timeline
  -> CapabilityInvocationPort.invoke()
  -> agent-capability executor
  -> executable tool builds SandboxExecutionRequest summary
  -> RiskPolicyEvaluator.evaluate(SANDBOX_EXECUTION)
  -> SandboxGatewayPort.execute()
  -> CapabilityInvocationResult
  -> runtime timeline / terminal commit / observability
```

接入点必须固定：

1. Capability invocation policy 接在 `agent-core` tool loop 中，发生在 `CapabilityCatalog.resolve` 成功之后、`CAPABILITY_STARTED` 和 `CapabilityInvocationPort.invoke()` 之前。该点已有 descriptor、request、run、context、identity、Agent scope 和 owner scope，可构造 `RestrictedOperationSummary`。
2. Sandbox dynamic execution policy 接在 app-composed sandbox tool port / `runSandbox` 等价边界中，发生在 `SandboxExecutionRequest` 安全摘要形成之后、`SandboxGatewayPort.execute()` 之前。该点只消费 sandbox summary 和 adapter readiness，不修改 sandbox request/result contract。
3. `REQUIRE_AUTHORIZATION` 只能由 `agent-runtime` 消费：runtime 基于 `RiskPolicyAuthorizationIntent` 创建 authorization pending input，把 `authorizationScope` 作为服务端绑定事实随 pending input 保存或关联，并在用户 answer 后校验 scope。
4. `DENY`、`DEGRADED`、`POLICY_FAILED` 由 runtime 或受限操作边界映射为 SafeError-compatible 停止路径，目标 capability/sandbox 不执行。
5. `POLICY_APPLIED` 只由 runtime 在 outcome 改变执行路径时写入 timeline-only event。policy evaluator 自身不得直接写 timeline、terminal truth、checkpoint、session history 或 channel state。
6. `RiskPolicyEvaluation` 由现有 observability projection path 消费；业务核心不得直接依赖 logging、metric、trace SDK。

授权路径依赖 `add-ts-authorization-pending-input` 已提供运行中 pending input 挂起、answer 接收、scope 校验和目标 operation 恢复/重新评估能力。若该依赖未完成，本 change 不得伪装支持高风险授权执行；实现只能 fail closed 或保持对应任务未完成。

禁止接入位置：

- 不在 `agent-channel-web` 做 policy 判定；
- 不在 sandbox gateway adapter 内部做 risk policy；
- 不在每个 Tool implementation 内各自实现 risk policy；
- 不把 risk policy 建模为 lifecycle hook；
- 不新增 runtime 之外的 authorization store；
- 不修改 `CapabilityInvocationRequest`、`CapabilityInvocationResult`、`SandboxExecutionRequest` 或 `SandboxExecutionResult`。

## 安全判定与执行流程（Safety Decision and Execution Flow）

首版安全判定不是评分模型，也不依赖模型自行判断。它是一组必须全部满足的前置条件，按固定顺序执行；任一终止性规则命中后，系统立即输出对应 outcome，不再继续寻找放行理由。

执行流程固定为：

```text
受限操作即将执行
  -> 识别 operation kind
  -> 收集可信上下文和安全摘要
  -> 执行系统内置 risk policy
  -> 按固定规则顺序判定
  -> 生成唯一 outcome
  -> 记录 RiskPolicyEvaluation / log / audit / metric
  -> 必要时写 timeline-only POLICY_APPLIED
  -> 下游按 outcome 执行后续动作
```

安全判定入口必须先确认该操作属于哪个受限类别：capability invocation、sandbox dynamic execution、authorization request，或 retry/recovery 中可能重放副作用的操作。无法识别 operation kind 的操作不得默认放行。

判定时按以下顺序处理：

1. 身份必须可信，且 owner scope 可追溯；客户端、模型输出或 capability 参数中的 owner 字段不能成为授权依据。
2. capability 必须存在、可用、未禁用、未被冲突解析拒绝，并属于当前 Agent 授权范围。
3. 目标资源必须属于当前 owner 可见范围；无法证明 owner scope 时拒绝或降级。
4. 参数必须通过 schema、大小、resource ref 和敏感字段边界检查。
5. 操作必须被确定性分类为 `LOW`、`MEDIUM`、`HIGH` 或 `CRITICAL`。
6. 动态执行必须通过 sandbox gateway 边界；sandbox 不可用时不得回退宿主执行。
7. 高风险但可授权的操作必须转入当前 run 内一次性 authorization；授权 scope 不匹配时不得复用。
8. retry/recovery 中的副作用操作必须满足幂等和 replay safety。
9. 高风险或动态执行操作必须能形成安全观测事实；完全无法留痕时不得放行。
10. 以上全部通过后，才能输出 `ALLOW`。

outcome 消费顺序固定为：

| Outcome | 下游动作 |
|---|---|
| `ALLOW` | capability 或 sandbox 继续执行 |
| `DENY` | 不执行目标操作，返回 SafeError，记录 denied 事实 |
| `REQUIRE_AUTHORIZATION` | 创建 authorization pending input，等待用户回答 |
| `DEGRADED` | 不执行目标操作，返回 degraded/unavailable SafeError |
| `POLICY_FAILED` | 不执行目标操作，返回 policy failure SafeError |

关键不变量是：不确定、不完整、不可审计、依赖不可用或越权的受限操作不得继续执行。

## 触发机制（Triggering Mechanisms）

### 1. Capability invocation 前同步触发

当 Agent loop 或 capability executor 准备发起 capability invocation 时，系统必须先执行 risk policy。该触发发生在 capability 真正执行之前，属于请求主流程内的同步治理边界。

适用场景包括：

- 内置工具调用；
- API-backed tool 调用；
- 由 Skill 或 Agent package 暴露后进入统一 capability catalog 的能力调用；
- 本地 invoked agent 作为 capability 被父 run 调用；
- 任何声明为有副作用、需要授权、需要 sandbox 或具有高风险类别的 capability。

### 2. Sandbox 动态执行前同步触发

当 capability、hook 或 policy 相关受控路径准备执行 shell、python、脚本或模型生成代码时，系统必须在形成 sandbox execution request 后、提交 sandbox gateway 前执行 risk policy。

该触发不得由 sandbox adapter 自行补做，也不得在 sandbox 执行后补采。

### 3. Authorization / high-risk confirmation 前同步触发

当系统识别到某个操作需要当前用户确认或授权时，risk policy 必须在创建 authorization pending input 前给出 `REQUIRE_AUTHORIZATION` outcome。pending input 的创建是 policy outcome 的后续副作用，不是 policy 直接写领域真相。

### 4. 恢复或重试路径重新进入受限操作前触发

当 runtime recovery、retry 或 edit-resubmit 重新推进到受限操作执行前，如果该操作仍会真实执行或可能重放副作用，系统必须重新评估 risk policy。若幂等声明、授权范围或 sandbox 依赖不满足，必须拒绝或要求重新授权。

## 输入与前置条件（Inputs and Preconditions）

每次 policy evaluation 至少需要以下输入：

- 可信 `identityContext` 摘要；
- `sessionId`、`requestId`、`runId`、`requestContextId`；
- `agentId`、`agentVersion`；
- 目标 operation kind：`CAPABILITY_INVOCATION`、`SANDBOX_EXECUTION`、`AUTHORIZATION_REQUEST` 或等价受限操作类别；
- `capabilityId?`、`capabilityKind?`、`providerId?`、`toolCallId?`；
- capability availability 和 Agent binding/assembly 授权结论；
- 操作风险摘要：side-effect、network、filesystem、external API、dynamic execution、credential use、data mutation、business impact；
- 安全参数摘要：schema validation outcome、argument size class、resource target summary、sandbox requirement、timeout budget、output limit；
- 幂等和恢复摘要：是否 retry/recovery、是否有 idempotency key、capability replay policy；
- 配置状态：risk policy enabled state、内置规则版本、sandbox dependency status、redaction/audit availability；
- 当前 run 内已回答的 authorization pending input ref，以及 runtime 可由其派生的一次性授权许可（如有）。

### 前置条件

1. 当前请求已经由可信 channel/auth boundary 注入身份。
2. 目标 capability 已通过 catalog/availability/Agent binding 基础解析，或基础解析失败已经形成可供 policy 记录的安全事实。
3. 操作参数已经过 schema 级 validation 或已形成 validation failure 摘要。
4. 对动态执行类操作，sandbox requirement 已被识别，且不得存在绕过 sandbox gateway 的执行路径。
5. policy 输入必须是安全摘要或稳定 refs，不得包含 raw prompt、raw model output、raw tool args/result、raw attachment content、raw secret、credential、本地路径或 provider 原始响应。
6. 若 policy 需要创建 authorization pending input，pending input core 和 authorization pending input 依赖必须可用。
7. 若 policy 结果需要 audit/log/metric，redaction policy 必须先于输出生效。

## 输出与副作用（Outputs and Side Effects）

### Policy outcome

每次 evaluation 必须输出一个 outcome：

| Outcome | 语义 | 主流程后果 |
|---|---|---|
| `ALLOW` | 当前操作满足执行前安全条件 | 下游继续执行 |
| `DENY` | 当前操作违反硬性规则或不可授权 | 不执行操作，返回 SafeError |
| `REQUIRE_AUTHORIZATION` | 当前操作高风险但可由当前用户在当前 run 内一次性授权 | 创建 authorization pending input，目标操作等待用户回答 |
| `DEGRADED` | 必要安全依赖、配置或治理链路不可用 | 不执行操作，返回 unavailable/degraded SafeError |
| `POLICY_FAILED` | policy 超时、异常、输出非法或无法完成安全判定 | 不执行操作，返回 policy failure SafeError |

### 允许的副作用

- 形成 `RiskPolicyEvaluation` 结构化观测事实；
- 写出 redaction 后的 structured log；
- 写出 policy evaluated/allowed/denied/authorization_required/degraded/failed metrics；
- 向 audit sink 输出安全 audit event；
- 在 outcome 改变执行路径或需要形成执行事实时写入 timeline-only `POLICY_APPLIED`；
- 当 outcome 为 `REQUIRE_AUTHORIZATION` 时，向 runtime/pending input 边界提交 authorization intent。

### 不允许的副作用

- 直接执行 capability 或 sandbox；
- 直接写 RequestRun 终态；
- 直接创建或修改 checkpoint；
- 直接修改 session history 或 channel state；
- 直接投影新的用户可见 stream event；
- 把 raw args、raw output、raw secret、local path 或完整 policy input/result 写入日志、audit、SafeError 或 stream。

## 核心判断逻辑（Core Decision Rules）

每次 policy evaluation 必须按以下顺序判定。先命中的终止性规则直接给出 outcome；只有全部通过后才能 `ALLOW`。

### 1. 可信上下文校验

1. 若缺少可信 `identityContext`、`tenantId` / `subjectId` 不可追溯、或身份来自客户端 payload / 模型输出 / capability 参数，则 `DENY`。
2. 若 request/run/session/agent refs 缺失到无法关联 audit 和 owner scope，则 `DEGRADED`。

### 2. Capability 可执行性校验

1. 若目标 capability 不存在、不可用、被禁用、未进入当前 Agent 授权范围或被冲突解析拒绝，则 `DENY`。
2. 若 capability availability reason 只包含 unavailable/degraded 且可安全表达，则 `DEGRADED`。
3. 若模型或客户端试图调用未暴露给当前 Agent 的 capability，则 `DENY`。

### 3. Owner scope 与数据访问校验

1. 若操作目标属于不同 owner，或无法证明属于当前 owner 可见范围，则 `DENY`。
2. 若参数中出现试图覆盖 owner、tenant、subject、agent 或 run 的字段，则忽略该字段并按越权尝试记录；若该字段影响目标资源选择，则 `DENY`。

### 4. 参数和资源边界校验

1. 若参数 schema validation 失败、超过大小限制、缺少必填安全字段或包含不允许的 resource ref，则 `DENY` 或 validation SafeError。
2. 若参数包含 raw secret、credential、local path、provider raw response 或未脱敏敏感载荷，且该内容将进入执行边界或观测边界，则 `DENY`。

### 5. 操作风险分类

按稳定规则将操作分为：

- `LOW`：非工具的只读、无副作用、不访问外部系统、不动态执行、不写入用户或业务资源；
- `MEDIUM`：当前 builtin Tool catalog 中的所有工具调用，包括读取、写入、编辑、检索和受治理的动态执行；
- `HIGH`：不属于当前 builtin Tool 基线的外部 API 调用、业务对象修改、网络请求、放宽治理边界的动态执行或其他可能消耗大量资源的受限操作；
- `CRITICAL`：删除、批量修改、跨 owner 访问尝试、凭据操作、绕过 sandbox、未授权业务变更或无法审计的高风险操作。

当前实现将 builtin Tool 风险基线统一收敛到 `MEDIUM`。这包括 `read`、`write`、`edit`、`glob`、`grep`、`bash`、`python`、`skill`、`agent` 及其他通过 builtin Tool catalog 暴露的工具调用。这样做的目的是让“是否可执行”继续主要由 owner scope、参数边界、sandbox readiness、可观测性和各工具自己的治理规则决定，而不是再把 builtin Tool 内部按写入/动态执行拆成需要显式授权的高风险分层。超出 builtin Tool 既有契约的外部 API、放宽 sandbox/命令治理的动态执行，或未来新增的更强副作用能力，仍归 `HIGH` 或更高。

判定规则：

1. `LOW` 且前置校验全部通过，可以继续后续规则。
2. `MEDIUM` 若配置要求授权或依赖 readiness 不满足，则 `REQUIRE_AUTHORIZATION` 或 `DEGRADED`。
3. `HIGH` 若可授权且 pending input 依赖可用，则 `REQUIRE_AUTHORIZATION`；若不可授权则 `DENY`。当前 builtin Tool 基线不走这一分支。
4. `CRITICAL` 默认 `DENY`；只有明确配置为可授权的当前 run 内一次性操作，才可转为 `REQUIRE_AUTHORIZATION`。

### 6. Sandbox 和动态执行校验

1. 动态执行类操作必须声明 sandbox requirement。
2. 若动态执行未通过 sandbox gateway 边界，或存在宿主直接执行路径，则 `DENY`。
3. 若 sandbox adapter 为 deny-by-default、unavailable 或依赖不可达，则 `DEGRADED`，不得回退到宿主执行。
4. 若 sandbox 请求缺少工作目录隔离、环境变量白名单、网络策略、超时、stdout/stderr 限制或输出安全摘要，则 `DENY` 或 `DEGRADED`。

### 7. Authorization 校验

1. 若当前操作命中 `REQUIRE_AUTHORIZATION`，policy 必须生成 authorization intent，scope 绑定当前 `tenantId`、`subjectId`、`runId`、`capabilityId` 或 operation id、risk level 和 requested action ref。
2. 授权只对当前 run 内一次目标操作有效，不得跨 run、跨 session 或长期复用。
3. 若已存在有效授权 fact，必须校验其 scope 与当前目标操作完全匹配；不匹配则不得复用。
4. 用户 deny、timeout、pending input canceled 或回答无法验证时，目标操作不得执行。

### 8. 幂等和恢复校验

1. 若当前路径是 retry/recovery 且操作可能产生副作用，必须检查 capability replay/idempotency 声明。
2. 若不支持幂等或缺少有效 idempotency key，则 `DENY` 或 `REQUIRE_AUTHORIZATION`，不得自动重放。
3. 若支持幂等，policy 仍需校验 operation scope 与当前 request/run/owner 一致。

### 9. 审计和可观测性校验

1. 高风险或动态执行操作必须能形成 policy audit/log/metric 安全事实。
2. 若 audit/log/metric 的下游 sink 不可用但本地可形成最小安全证据，则可继续按 outcome 执行；若无法形成任何安全证据，则 `DEGRADED`。
3. 观测输出必须先经过 redaction policy。

### 10. 最终允许

只有以上规则均未产生 `DENY`、`REQUIRE_AUTHORIZATION`、`DEGRADED` 或 `POLICY_FAILED`，系统才能输出 `ALLOW`。

## 状态 / 产物契约（State and Artifact Contracts）

### RiskPolicyEvaluation

`RiskPolicyEvaluation` 是每次 policy evaluation 的结构化观测事实，归 `agent-contracts/observability` owning。它不是业务真相对象，不拥有 run 状态，也不是 checkpoint、artifact、summary、memory record 或 learning event。

至少包含：

- `policyId`
- `policyVersion`
- `outcome`
- `reasonCode`
- `riskLevel`
- `operationKind`
- `sessionId`
- `requestId`
- `runId`
- `requestContextId`
- `agentId`
- `agentVersion`
- `capabilityId?`
- `providerId?`
- `toolCallId?`
- `authorizationIntentRef?`
- `timelineEventRef?`
- `evaluatedAt`
- `durationMs`
- `safeDetails?`

安全限制：

- 不包含 raw prompt、raw model output、raw tool args/result、raw attachment content、raw secret、credential、本地路径、完整 sandbox request 或 provider raw response；
- `safeDetails` 只能包含稳定 reason code、字段名、风险分类、安全摘要和 refs；
- 可被 structured logging、metrics、audit sink 和 release/security gate 消费。

### POLICY_APPLIED

`POLICY_APPLIED` 是 runtime canonical timeline 中的 timeline-only evidence。

语义：

- 记录某次 policy outcome 已被 runtime 或受限操作边界消费；
- 用于恢复、审计、诊断和 stream/history consistency；
- 首版不投影为用户可见 `StreamEventType`。

生命周期：

- 在 policy outcome 改变执行路径时生成，例如 `DENY`、`REQUIRE_AUTHORIZATION`、`DEGRADED`、`POLICY_FAILED`；
- `ALLOW` 可只进入 audit/log/metric，除非下游需要 timeline evidence 证明某个高风险操作被允许。

### Authorization intent

当 outcome 为 `REQUIRE_AUTHORIZATION` 时，policy 产出 authorization intent。它不是 pending input truth，只是 runtime 创建 pending input 的控制输入。

必须绑定：

- 当前 `tenantId` / `subjectId`；
- 当前 `runId`；
- 目标 `capabilityId` 或 operation id；
- `riskLevel`；
- requested action safe summary 或 ref；
- 过期时间或 pending input 默认超时策略引用。

消费方：

- runtime / pending input 边界消费该 intent；
- channel 只看到 pending input 投影；
- capability/sandbox 只有在授权成功且 scope 匹配后才能继续执行。

authorization pending input 被用户 approve 后，runtime 可以派生当前 run 内一次性授权许可。该许可只存在于 runtime 恢复和继续执行语义中，不作为独立持久化对象；其来源、scope 和消费结果必须可追溯到原 pending input answer、policy evaluation 和目标 operation ref。

## 流程接入（Flow Integration）

### 请求主链路

`Channel -> Runtime -> Agent Loop -> Capability/Sandbox -> Runtime terminal -> Observability`

`agent-runtime` 是 policy evaluation orchestration 的主要 owner，负责消费专用 evaluator outcome、创建 authorization pending input、派生一次性授权许可、写入必要的 timeline-only `POLICY_APPLIED`，并保证 RequestRun lifecycle truth 仍由 runtime 拥有。上游提供可信 request、agent、capability 和操作摘要；下游只消费 policy outcome，不重新解释安全规则。

### Capability 治理链路

`Capability catalog / Agent binding -> Risk policy -> Capability invocation -> Capability audit`

capability catalog 和 Agent binding 决定能力是否可见、可调用；risk policy 决定本次操作是否允许执行、拒绝或需要授权；capability invocation 只在 `ALLOW` 或授权成功后执行。

`agent-capability` 只负责提供受限操作安全摘要、在 outcome 不允许时停止目标 invocation、以及在允许时继续既有 invocation / sandbox path；不得实现第二套 policy truth 或 authorization store。

### Sandbox 治理链路

`Executable capability -> Sandbox request summary -> Risk policy -> Sandbox gateway -> Sandbox result`

动态执行必须先形成受控 sandbox request summary。policy 允许后才能提交 sandbox gateway；sandbox unavailable 或 deny-by-default 时不得绕过 gateway。

sandbox availability 仍由当前装配的 `SandboxGatewayPort` / deny-by-default adapter 表达；risk policy 只消费该安全摘要并输出 outcome，不重定义 sandbox request/result。

### Authorization 链路

`Risk policy -> Authorization intent -> Pending input -> User answer -> Runtime resume -> Re-evaluate or consume authorization`

授权只对当前 run 内一次目标操作有效。用户 approve 后，runtime 必须校验 authorization scope；deny、timeout、cancel 均禁止目标操作继续。

## 质量属性审视（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | fail closed；高风险和动态执行默认不可静默放行；raw secret/path/prompt/output 不进入输出 | negative security tests、redaction assertions |
| 性能/容量 | policy 同步执行但必须有固定超时；观测 sink 不应无限阻塞主流程 | timeout tests、metrics assertions |
| 可靠性/恢复 | retry/recovery 重新评估受限操作；非幂等副作用不得自动重放 | recovery/idempotency tests |
| 可维护性 | 只定义系统内置最小规则，不引入通用策略平台 | architecture review、change boundary review |
| 可测试性 | 每个 outcome 都有可触发样例和明确断言 | contract/integration/security tests |
| 审计/可追溯性 | 每次 evaluation 形成安全观测事实；路径改变写 `POLICY_APPLIED` | audit/log/metric tests |

## 失败与降级（Failure and Degradation）

| 失败场景 | 处理方式 | 不允许发生的事 |
|---|---|---|
| policy 超时 | `POLICY_FAILED`，高风险操作不得执行，记录 timeout reason | 无限等待或静默放行 |
| policy 抛错 / 输出非法 | `POLICY_FAILED`，返回 SafeError，记录 safe diagnostics | 输出 raw exception |
| policy 配置缺失 | `DEGRADED`，受限操作不得执行 | 使用默认 allow |
| sandbox 依赖不可用 | `DEGRADED`，动态执行不得执行 | 回退宿主执行 |
| pending input 依赖不可用 | `DEGRADED` 或 `DENY`，不得伪装成已挂起 | 静默丢弃授权需求 |
| audit/log/metric sink 不可用 | 若可形成最小本地安全证据，主流程按 policy outcome 继续；否则高风险操作 `DEGRADED` | 完全无证据地允许高风险操作 |
| redaction 失败 | `DEGRADED` 或省略不安全字段；不得输出 raw 内容 | 带敏感信息输出 |
| 用户 deny/timeout/cancel | 目标操作不得执行，记录 policy/authorization outcome | 继续执行目标操作 |

## 典型验收样例（Acceptance Examples）

### 正常路径：低风险只读 capability 被允许

1. 当前 Agent 已授权内置只读 capability。
2. 输入参数 schema 有效，目标资源属于当前 owner。
3. 操作风险分类为 `LOW`。
4. policy 输出 `ALLOW`。
5. capability invocation 继续执行。
6. 系统记录 policy evaluated/allowed 日志、metric 和安全 audit 事件。

### 边界路径：高风险写操作要求授权

1. capability 已授权且可用，但本次操作会修改外部业务资源。
2. 操作风险分类为 `HIGH`。
3. 当前 run 内没有匹配该操作的有效授权 fact。
4. policy 输出 `REQUIRE_AUTHORIZATION` 并产出 authorization intent。
5. runtime 创建 authorization pending input。
6. 目标 capability 在用户 approve 且 scope 匹配前不得执行。
7. 系统写入 timeline-only `POLICY_APPLIED` 并记录安全观测事实。

### 失败路径：动态执行缺少 sandbox

1. 某 capability 请求执行 shell 或 python。
2. 操作被识别为 dynamic execution。
3. 当前 sandbox adapter 不可用或为 deny-by-default。
4. policy 输出 `DEGRADED`。
5. 操作不执行，不回退宿主执行。
6. 用户侧只收到 SafeError 或安全降级提示，日志/audit/metric 保留稳定 reason code。

### 降级路径：policy 自身超时

1. 高风险 capability invocation 前触发 policy evaluation。
2. policy 未在配置 timeout 内返回。
3. 系统输出 `POLICY_FAILED`。
4. capability 不执行。
5. 系统记录 timeout reason、policy id、run/capability refs 和 safe details。

## 待确认问题（Open Questions）

无。首版 risk policy enforcement 收敛为系统内置、同步执行、确定性规则和 fail-closed 语义。
