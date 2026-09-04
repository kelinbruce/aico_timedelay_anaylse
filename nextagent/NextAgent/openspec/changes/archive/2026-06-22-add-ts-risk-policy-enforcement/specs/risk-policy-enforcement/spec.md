## ADDED Requirements

### Requirement: Risk policy runs synchronously before restricted operations execute

系统 SHALL 在受限操作真正执行前同步执行系统内置 risk policy。首版受限操作 MUST 至少包括：

- capability invocation；
- sandbox 动态执行；
- authorization 或 high-risk confirmation 相关目标操作；
- retry/recovery 中可能重放副作用的操作。

risk policy MUST 由当前主流程推进到受限操作执行前边界时触发，不得由后台 job、日志回放、离线扫描或执行后补采替代。

#### Scenario: Capability invocation waits for policy outcome

- **WHEN** 主流程准备执行一个 capability invocation
- **THEN** 系统先执行 risk policy
- **AND** capability 只在 policy outcome 允许后继续执行

#### Scenario: Dynamic execution is evaluated before sandbox submission

- **WHEN** 某个受控路径准备执行 shell、python、脚本或模型生成代码
- **THEN** 系统先形成受控动态执行摘要并执行 risk policy
- **AND** 不会在 policy 完成前提交真实 sandbox 执行

### Requirement: Risk policy uses trusted and bounded inputs only

每次 risk policy evaluation SHALL 只消费可信边界已经成立的安全输入。policy input MUST 至少能关联：

- trusted identity summary；
- `sessionId`、`requestId`、`runId`、`requestContextId`；
- `agentId`、`agentVersion`；
- operation kind；
- `capabilityId?`、`providerId?`、`toolCallId?`；
- capability availability 和 Agent 授权摘要；
- 操作风险摘要；
- 参数 validation 摘要；
- sandbox requirement 和依赖状态；
- 幂等 / retry / recovery 摘要；
- redaction、audit 和 policy 配置状态。

policy input MUST NOT 包含 raw prompt、raw model output、raw tool args/result、raw attachment content、raw secret、credential、本地路径、完整 sandbox request 或 provider 原始响应。

#### Scenario: Client-provided owner fields are not trusted

- **WHEN** capability 参数或客户端 payload 中包含 owner、tenant、subject、agent 或 run 字段
- **THEN** risk policy 不把这些字段当作可信身份或 owner scope
- **AND** 若这些字段影响目标资源选择，则 policy 拒绝该操作

#### Scenario: Policy diagnostics use summaries and refs

- **WHEN** policy 需要记录输入诊断
- **THEN** 诊断只包含 reason code、安全摘要和稳定 refs
- **AND** 不包含 raw args、secret、路径或附件正文

### Requirement: Risk policy returns one deterministic outcome per evaluation

每次 risk policy evaluation MUST 返回且只返回一个 outcome：

- `ALLOW`：操作可以继续；
- `DENY`：操作违反硬性规则或不可授权；
- `REQUIRE_AUTHORIZATION`：操作高风险但可由当前用户在当前 run 内一次性授权；
- `DEGRADED`：必要安全依赖、配置或治理链路不可用；
- `POLICY_FAILED`：policy 自身超时、异常、输出非法或无法完成安全判定。

系统 MUST NOT 在缺失 outcome、多个冲突 outcome 或非法 outcome 时继续执行受限操作。

#### Scenario: Low-risk authorized operation is allowed

- **WHEN** 操作为只读、无副作用、目标 owner 可验证、capability 已授权且所有前置校验通过
- **THEN** policy 返回 `ALLOW`
- **AND** 下游执行边界可以继续执行该操作

#### Scenario: Illegal policy output fails closed

- **WHEN** policy 返回缺失、冲突或非法 outcome
- **THEN** 系统按 `POLICY_FAILED` 处理
- **AND** 受限操作不得执行

### Requirement: Safety is determined by a fixed rule order

系统 SHALL 按固定顺序判定受限操作是否安全。首版规则顺序 MUST 为：

1. trusted identity 和 request/run/session/agent refs 可追溯；
2. capability 存在、可用、未禁用、未被冲突解析拒绝，且属于当前 Agent 授权范围；
3. 目标资源属于当前 owner 可见范围；
4. 参数 validation、大小、resource ref 和敏感字段边界通过；
5. 操作风险分类完成；
6. 动态执行满足 sandbox gateway 边界；
7. 高风险可授权操作具备有效当前 run 授权，或转入 authorization pending input；
8. retry/recovery 中的副作用操作满足幂等和 replay safety；
9. policy 结果可以形成安全观测事实；
10. 以上均通过后才能 `ALLOW`。

任一终止性规则命中 `DENY`、`REQUIRE_AUTHORIZATION`、`DEGRADED` 或 `POLICY_FAILED` 时，系统 MUST 停止后续放行判断，并按该 outcome 处理。

#### Scenario: Unauthorized capability is denied before risk classification

- **WHEN** 模型或客户端请求调用未授权 capability
- **THEN** policy 返回 `DENY`
- **AND** 系统不继续把该操作降级分类为低风险或可授权操作

#### Scenario: Non-idempotent recovery replay is not automatically allowed

- **WHEN** runtime recovery 准备重放一个可能产生副作用且不支持幂等的 capability
- **THEN** policy 不返回 `ALLOW`
- **AND** 系统拒绝或要求当前 run 内重新授权

### Requirement: Policy outcome consumption follows a fixed execution flow

系统 SHALL 按固定执行流程消费 risk policy outcome：

1. 识别 operation kind；
2. 收集可信上下文和安全摘要；
3. 执行系统内置 risk policy；
4. 生成唯一 outcome；
5. 形成 `RiskPolicyEvaluation`，并输出安全 log / audit / metric；
6. 在 outcome 改变执行路径时写入 timeline-only `POLICY_APPLIED`；
7. 由下游执行边界消费 outcome。

下游 MUST 按以下方式处理 outcome：

- `ALLOW`：继续执行目标 capability 或 sandbox 操作；
- `DENY`：不执行目标操作，并返回 SafeError；
- `REQUIRE_AUTHORIZATION`：创建 authorization pending input，目标操作等待用户回答；
- `DEGRADED`：不执行目标操作，并返回 degraded 或 unavailable SafeError；
- `POLICY_FAILED`：不执行目标操作，并返回 policy failure SafeError。

#### Scenario: Denied operation stops before capability execution

- **WHEN** policy 返回 `DENY`
- **THEN** 下游 capability invocation 不执行
- **AND** 系统返回 SafeError
- **AND** 记录 policy denied 的安全观测事实

#### Scenario: Authorization required suspends instead of executing

- **WHEN** policy 返回 `REQUIRE_AUTHORIZATION`
- **THEN** 系统创建 authorization pending input
- **AND** 目标操作在用户回答且授权 scope 匹配前不得执行

### Requirement: Operation risk classification is deterministic and fail-closed

系统 SHALL 使用稳定规则把操作分类为 `LOW`、`MEDIUM`、`HIGH` 或 `CRITICAL`。

- `LOW`：非工具的只读、无副作用、不访问外部系统、不动态执行、不写入用户或业务资源；
- `MEDIUM`：当前产品路径中的所有 builtin Tool 调用，包括读取、写入、编辑、检索和受治理的动态执行；
- `HIGH`：非当前 builtin Tool 基线内的外部 API 调用、业务对象修改、网络请求、放宽治理边界的动态执行或其他可能消耗大量资源的受限操作；
- `CRITICAL`：删除、批量修改、跨 owner 访问尝试、凭据操作、绕过 sandbox、未授权业务变更或无法审计的高风险操作。

当前 builtin Tool 基线 MUST 统一归类为 `MEDIUM`。这包括 `read`、`write`、`edit`、`glob`、`grep`、`bash`、`python`、`skill`、`agent` 及其他通过同一 builtin Tool catalog 暴露的工具调用。`bash`、`python` 与其他动态执行路径只有在继续受各自工具契约、参数治理和 sandbox gateway 边界约束时，才适用该 `MEDIUM` 基线；一旦放宽为超出当前 builtin Tool 治理边界的执行，仍按 `HIGH` 或更高风险处理。

`HIGH` 操作 MUST 默认要求当前 run 内一次性授权，除非明确配置为不可授权并拒绝。`CRITICAL` 操作 MUST 默认拒绝，除非明确配置为可在当前 run 内一次性授权。无法分类的操作 MUST fail closed。

#### Scenario: Builtin tool invocation is medium risk by default

- **WHEN** 当前产品路径执行任一 builtin Tool 调用
- **THEN** policy 将其分类为 `MEDIUM`
- **AND** 在其他前置校验通过时不会仅因工具风险等级而返回 `REQUIRE_AUTHORIZATION`

#### Scenario: Unknown operation risk is not allowed

- **WHEN** policy 无法判定某个受限操作的风险等级
- **THEN** policy 返回 `DEGRADED` 或 `DENY`
- **AND** 不返回 `ALLOW`

### Requirement: Dynamic execution requires both policy approval and sandbox boundary

所有 shell、python、脚本和模型生成代码执行 SHALL 同时满足 risk policy 与 sandbox gateway 边界。系统 MUST NOT 因 sandbox adapter 不可用、deny-by-default、配置缺失或远端不可达而回退到宿主直接执行。

#### Scenario: Missing sandbox prevents dynamic execution

- **WHEN** 动态执行请求命中 sandbox requirement
- **AND** 当前 sandbox adapter 不可用或处于 deny-by-default
- **THEN** policy 返回 `DEGRADED`
- **AND** 动态执行不得执行

#### Scenario: Host execution bypass is denied

- **WHEN** 某个调用点试图绕过 sandbox gateway 直接执行 shell、python 或脚本
- **THEN** policy 返回 `DENY`
- **AND** 系统记录稳定 reason code

### Requirement: Authorization is current-run scoped and single-use

当 policy 返回 `REQUIRE_AUTHORIZATION` 时，系统 SHALL 通过 authorization pending input 请求用户授权。授权 scope MUST 绑定当前 `tenantId`、`subjectId`、`runId`、目标 `capabilityId` 或 operation id、risk level 和 requested action ref。

授权 scope MUST 作为服务端绑定事实随 authorization pending input 保存或关联，不得进入客户端 answer payload，也不得形成独立 authorization store。授权结果 MUST 只对当前 run 内一次目标操作有效，不得跨 run、跨 session、跨 owner 或长期复用。用户 deny、timeout、pending input canceled 或 scope 不匹配时，目标操作 MUST NOT 执行。

#### Scenario: Approved authorization allows only the bound operation

- **WHEN** 用户 approve 一个 authorization pending input
- **AND** 授权 scope 与当前目标操作完全匹配
- **THEN** 该目标操作可以继续
- **AND** 该授权不能复用于另一个 capability 或后续 run

#### Scenario: Authorization timeout denies target execution

- **WHEN** authorization pending input 超时
- **THEN** 目标操作不得执行
- **AND** 系统记录 authorization timeout 的安全结果

### Requirement: Policy outcomes produce safe observability and timeline evidence

每次 policy evaluation MUST 形成 `RiskPolicyEvaluation` 结构化观测事实，并输出 redaction 后的日志和 metrics。`RiskPolicyEvaluation` MUST 归 `agent-contracts/observability` owning，且 MUST NOT 作为 runtime、capability、session、gateway 或 channel 的业务真相对象。若 outcome 改变执行路径或需要形成执行事实，runtime SHALL 写入 timeline-only `POLICY_APPLIED`。

`POLICY_APPLIED` 首版 MUST NOT 投影为新的用户可见 `StreamEventType`。

#### Scenario: Denied operation creates policy evidence

- **WHEN** policy 返回 `DENY`
- **THEN** 系统形成 `RiskPolicyEvaluation`
- **AND** 写入 timeline-only `POLICY_APPLIED`
- **AND** 输出安全 audit/log/metric 事实

#### Scenario: Allowed high-risk operation remains auditable

- **WHEN** 高风险操作经过有效授权后被允许执行
- **THEN** 系统记录 policy outcome、authorization ref 和目标 operation ref 的安全观测事实
- **AND** 不记录 raw args、raw output、secret 或路径

### Requirement: Authorization permission is derived from pending input and is not a separate durable truth

当 policy 返回 `REQUIRE_AUTHORIZATION` 并创建 authorization pending input 后，系统 SHALL 只允许 runtime 从已接收且 scope 匹配的 pending input answer 派生当前 run 内一次性执行许可。该许可 MUST NOT 作为独立 authorization store、长期授权记录或客户端可提交字段存在。

authorization scope MUST NOT 出现在客户端 answer payload 中。scope MUST 由 runtime/policy 绑定并在恢复或继续执行前校验。

#### Scenario: Runtime derives one-time permission from approved pending input

- **WHEN** 用户 approve 一个 authorization pending input
- **AND** pending input 绑定的 scope 与当前目标 operation 完全匹配
- **THEN** runtime 可以派生当前 run 内一次性执行许可
- **AND** 该许可不形成独立持久化对象

#### Scenario: Client answer cannot broaden authorization scope

- **WHEN** 客户端 answer payload 试图携带 capabilityId、operation id、tenantId、subjectId 或 riskLevel 扩大授权范围
- **THEN** runtime 不使用这些字段作为授权依据
- **AND** scope 校验只使用 policy 绑定的服务端事实

### Requirement: Policy failure and dependency degradation fail closed

当 policy 超时、异常、输出非法、配置缺失、redaction 无法保证安全输出、pending input 依赖不可用、sandbox 依赖不可用或无法形成最小安全观测事实时，系统 SHALL fail closed。受限操作 MUST NOT 静默继续。

#### Scenario: Policy timeout prevents restricted operation

- **WHEN** 高风险 capability invocation 前的 policy evaluation 超时
- **THEN** 系统返回 `POLICY_FAILED`
- **AND** capability 不执行
- **AND** 系统记录 timeout reason 和安全诊断

#### Scenario: Observability impossibility blocks high-risk execution

- **WHEN** 高风险操作无法形成任何安全观测事实
- **THEN** policy 返回 `DEGRADED`
- **AND** 操作不得执行

### Requirement: Policy enforcement does not own runtime, channel, or persistence truth

risk policy SHALL 只输出治理 outcome 和安全观测事实。它 MUST NOT 直接写入 RequestRun terminal truth、checkpoint、session history、channel state、stream envelope、capability result 或 sandbox result。

#### Scenario: Policy denial is consumed by runtime instead of writing terminal truth directly

- **WHEN** policy 返回 `DENY`
- **THEN** runtime 或上游受限操作边界消费该 outcome 并进入安全失败路径
- **AND** policy 本身不直接提交 RequestRun 终态

#### Scenario: Policy applied is not a user-visible stream type

- **WHEN** policy outcome 产生 `POLICY_APPLIED`
- **THEN** 该 event 只作为 timeline-only evidence
- **AND** channel 不新增用户可见 stream event type
