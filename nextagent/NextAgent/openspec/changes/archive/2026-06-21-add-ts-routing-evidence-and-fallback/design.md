## 背景和现状（Context）

Agent routing decision 属于 Agent orchestration。Runtime 负责 request lifecycle、timeline 和 terminal commit；channel 负责用户可见投影；observability 负责 audit/log/trace/redaction。Archive 的 `add-ts-model-fallback-semantics` 已冻结 `agent-model` 不做隐式 cross-profile fallback，并把上层 fallback orchestration/evidence 留给 Agent orchestration/routing evidence 承接。

## 黑盒目标（Blackbox Goal）

当 routing、constraint validation 或 targeted Skill routing 产生 safe outcome 时，系统记录脱敏 evidence。当当前 model profile 失败时，Agent Core 基于 frozen fallback-eligible profile set、当前 `SafeError`、request/run/step 状态和 visible-output gate 做显式 fallback orchestration，并记录 fallback-applied、fallback-denied 或 fallback-exhausted evidence。用户侧只看到最终结果、pending input、handoff 或 `SafeError`。

## 边界（Boundary）

- 负责：safe outcome evidence 记录、model fallback orchestration、constraint outcome evidence、`POLICY_APPLIED` timeline-only 诊断事实、audit/log/trace 脱敏投影、用户不可见边界。
- 不负责：通用 routing 算法、constraint governance、preferred Skill governance、model provider adapter fallback、runtime lifecycle 修改、公共核心 DTO、timeline event vocabulary。
- owner：`agent-core` 主责 fallback orchestration 和 evidence 生成，`agent-observability` 负责脱敏投影，`agent-runtime` 只接收 timeline-only event，`agent-channel-web` 只做用户可见投影。

## 触发机制（Trigger）

- 同步触发：Agent routing policy 选择 path、reject、clarify 或 handoff 后记录 routing safe outcome evidence。
- 同步触发：constraint validation 产生 accepted/rejected/ignored/degraded safe outcome 后记录 constraint evidence。
- 同步触发：targeted Skill routing 产生 accepted/rejected/fallback safe outcome 后记录 preferred Skill evidence。
- 同步触发：model invocation 返回 safe failure result 后，Agent Core 在同一步 terminal decision 前执行 fallback orchestration，并记录 fallback-applied、fallback-denied 或 fallback-exhausted evidence。
- 异步消费：audit、structured log、trace 和 metric 可异步消费 evidence；消费失败不得改变 routing decision。
- timeline 接入：Agent/core 通过 runtime timeline boundary 记录 timeline-only `POLICY_APPLIED` diagnostic event；该事件不进入默认用户可见 stream vocabulary。

## 输入与前置条件（Inputs / Preconditions）

输入：

- accepted `RequestRun` 和 `RequestContext`。
- frozen `AgentAssembly` facts。
- frozen `modelProfileRegistry.fallbackEligibleProfileIds` 和 safe provider route descriptors。
- 上游 routing core、constraint validation、targeted Skill routing 产生的 safe outcome。
- current selected model profile id、current `SafeError`、model failure stage、是否已有用户可见输出、已尝试 profile set。
- safe reason code、selected path kind、optional selected capability id、optional rejected constraint field name、optional fallback outcome kind。
- redaction policy 和可用 observability sinks。
- AbortSignal/deadline for request execution context。

前置条件：

- request 已由 runtime 接受并进入 Agent boundary。
- Agent Scope 和 Owner Scope 已固化。
- evidence 输入必须来自系统决策事实，不得来自模型输出、capability 参数或用户 payload。
- fallback candidate 只能来自 frozen `modelProfileRegistry.fallbackEligibleProfileIds`，不得重新读取 raw config、provider adapter internals 或用户 payload。
- `agent-model` 只返回当前 selected profile 的 safe failure result，不得自行切换 profile。
- raw prompt、raw model output、raw tool args/result、raw provider error、secret、local path、provider-private ref 和 policy internals 不得进入 evidence projection。
- fallback orchestration 的 request-local state 只限当前 accepted request/run：已尝试 profile set、当前 step 是否已产生用户可见输出、fallback attempt 次序和本次 decision reason 必须由 Agent orchestration 使用现有 runtime-owned execution facts 承载，例如当前 `RequestContext`、已发出的 runtime timeline facts、既有 checkpoint/flow state 扩展位或等价的 runtime-owned request-local state；本 change 不新增 public contract，也不在本 change 内承诺新的跨恢复 fallback state DTO。
- 若实现阶段无法在既有 runtime-owned request-local state 中安全恢复 fallback attempt state，则首版 fallback orchestration 至少必须对单次 accepted execution attempt 保持正确，并明确把跨恢复 replay/fallback exactness 作为 deferred，而不是由 runtime、channel 或 model adapter 自行补洞。

## 输出与副作用（Outputs / Side Effects）

输出：

- safe outcome evidence：只包含 stable refs、outcome kind、safe reason code、safe summary 和有限稳定标识。
- fallback orchestration command：当 fallback-applied 时，选择下一 fallback-eligible profile 并重新进入 governed model invocation path。
- `POLICY_APPLIED` timeline-only diagnostic event。
- audit event with redacted safe summary。
- structured log with redacted safe summary and reason code。
- trace entry with routing stage and safe outcome summary。

副作用：

- 不新增 `agent-contracts` public DTO、Record、enum 或 timeline event type。
- 不修改 AgentAssembly、capability catalog、model profile、session history 或 terminal commit。
- 不让 `agent-model`、runtime 或 channel 选择 fallback candidate。
- 不向用户 stream/history 投影 detailed evidence。
- evidence 写入失败只产生 observability degradation，不改变 routing/fallback/constraint outcome。

## 核心判断逻辑（Core Decision Logic）

1. 接收上游 routing/constraint/targeted Skill safe outcome；本 change 不重新判断这些 outcome 是否允许。
2. 校验 outcome source 是系统决策事实，不接受用户或模型提供的 evidence 字段。
3. 当 model invocation 失败且未产生 terminal fact 时，读取 current `SafeError`、当前 selected profile、已尝试 profile set、visible-output state 和 frozen fallback-eligible profile set。
4. 若已有用户可见输出，选择 fallback-denied，safe reason 为 visible-output replay blocked；不得 replay 同一步。
5. 若 fallback dependency 不可用、当前 failure 不可安全 fallback、AbortSignal canceled 或 deadline/budget 不足，选择 fallback-denied。
6. 若 fallback registry 可用但从 frozen `fallbackEligibleProfileIds` 排除已尝试 profile 后没有剩余候选，选择 fallback-exhausted。
7. 若存在剩余候选，按 frozen `fallbackEligibleProfileIds` 顺序选择第一个未尝试 profile，选择 fallback-applied，并通过 governed model invocation path 重新调用该 selected profile。
8. 将 routing/constraint/fallback outcome 映射为最小 evidence：outcome kind、safe reason code、safe summary、request/run/agent refs、optional selected capability id、constraint field name 或 selected fallback profile id。
9. 执行 redaction；若不能安全脱敏，则降级为 reason-only summary 或跳过对应 sink。
10. 通过 runtime boundary 写 `POLICY_APPLIED` timeline-only event。
11. 将 redacted evidence 投影到 audit、structured log 和 trace。
12. 若某个 sink 失败，记录 safe observability degradation，主流程继续使用原 routing/fallback outcome。

## 状态 / 产物契约（State / Artifact Contract）

Safe outcome evidence 是 request/run 范围内的诊断事实：

- 语义：说明某次 routing、constraint 或 fallback outcome 已发生，以及安全原因；fallback-applied 表示 Agent Core 显式选择了下一 model profile，fallback-denied 表示策略拒绝切换，fallback-exhausted 表示没有剩余安全候选。
- 生命周期：仅关联当前 request/run；retry/edit 必须重新决策并生成新 evidence。
- 消费方：audit、structured log、trace、runtime timeline diagnostic、tests。
- 与原始事实关系：通过 sessionId、runId、requestContextId、agentId、agentVersion 和 optional timeline event id 追溯到系统决策事实；不是 raw payload 副本。
- 安全限制：只包含稳定 id、outcome kind、safe reason code 和 safe summary；不得包含 raw prompt、raw model output、raw tool args/result、raw attachment content、raw provider exception、secret、本地路径、provider-private ref 或 policy internals。

本 change 不产生 summary、artifact、checkpoint、pending input、configuration state、memory record 或 learning event。

## 流程接入（Flow Integration）

主链路：

`Channel -> Runtime -> Agent Orchestration -> Routing/Constraint Outcome -> Model Invocation -> Fallback Orchestration -> Evidence Recording -> Runtime POLICY_APPLIED + Observability -> Terminal/User Projection`

- 上游：Agent routing core、constraint validation、targeted Skill routing、model invocation safe failure 和 model profile registry。
- 接入点：Agent orchestration 在 routing/constraint outcome 产生后记录 evidence；在 model invocation safe failure 后、terminal commit 前执行 fallback orchestration 并记录 evidence。
- 下游：runtime 接收 timeline-only diagnostic event；observability 接收 redacted projection；channel 只接收最终用户可见结果。
- 后续消费：audit/log/trace 可用于运维与合规定位；用户默认不可见。
- 调度依赖顺序：`add-ts-agent-routing-core` 提供 routing decision 入口；`add-ts-routing-constraint-validation` 先产出约束治理 outcome；`add-ts-targeted-skill-routing` 在需要时产出 preferred Skill outcome；本 change 只消费这些上游 safe outcome 并补齐统一 evidence/fallback 编排，不让 evidence 反向拥有 routing/constraint/Skill governance。

### 端到端核心流程

1. Channel 接收用户请求和 typed routing constraints，只做传输和 schema projection，不选择业务 Skill、Tool、Agent capability 或 fallback path。
2. Runtime 接受请求，固化 `RequestRun`、Agent Scope、Owner Scope 和 request lifecycle facts，然后调用 Agent orchestration。
3. Agent orchestration 调用 routing core、constraint validation 或 targeted Skill routing，得到 selected、rejected、clarification、handoff、accepted、ignored 或 degraded safe outcome。
4. Agent orchestration 立即把该 safe outcome 映射为最小 evidence，并通过 runtime timeline boundary 写 `POLICY_APPLIED` timeline-only diagnostic event，同时向 observability 发送 redacted projection。
5. 若流程进入 model invocation，`agent-model` 只按当前 selected profile 调用 provider；它不得读取 fallback candidate，也不得隐式切换 profile。
6. 当前 selected profile 成功时，Agent orchestration 继续正常 terminal path；用户只看到最终 answer、pending input 或 handoff。
7. 当前 selected profile 返回 safe failure 且尚未 terminal commit 时，Agent Core 进入 fallback orchestration，读取当前 `SafeError`、已尝试 profile set、visible-output state、budget/deadline/AbortSignal 和 frozen `modelProfileRegistry.fallbackEligibleProfileIds`。
8. 若已有用户可见输出，Agent Core 产生 `fallback-denied`，safe reason 为 visible-output replay blocked，并不得 replay 同一步。
9. 若 fallback dependency 不可用、failure 不可安全 fallback、deadline/budget 不足或 AbortSignal canceled，Agent Core 产生 `fallback-denied`。
10. 若没有未尝试的 fallback-eligible profile，Agent Core 产生 `fallback-exhausted`，并在首版进入明确的 safe failure path。
11. 若存在未尝试 fallback-eligible profile 且执行上下文允许，Agent Core 产生 `fallback-applied`，按 frozen `fallbackEligibleProfileIds` 顺序选择第一个未尝试 profile，并重新进入 governed model invocation path。
12. 每个 fallback outcome 都按同一 evidence 规则记录：写 `POLICY_APPLIED` timeline-only diagnostic event，投影 redacted audit/log/trace；详细 evidence 不进入用户 stream/history。

## 嵌入业务流程示例（Embedded Business Flow Examples）

### 用户指定 Skill 分析告警

1. `targeted-skill-routing` 对 `targetSkill=alarm-diagnosis` 产生 accepted 或 rejected safe outcome。
2. 本 change 记录 outcome kind、safe reason code、selected capability id 或 rejected constraint field name。
3. evidence 投影到 audit/log/trace，并写 `POLICY_APPLIED` timeline-only event。
4. 用户只看到 Skill 执行结果、safe error、clarification 或 handoff；看不到候选列表或 policy internals。

### 模型失败后的 fallback orchestration

1. 当前 selected profile 返回带 `SafeError` 的失败 result。
2. Agent Core 检查是否已有用户可见输出；若已有，则产生 fallback-denied，不 replay 同一步。
3. Agent Core 从 frozen `modelProfileRegistry.fallbackEligibleProfileIds` 中排除已尝试 profile。
4. 若没有剩余候选，产生 fallback-exhausted。
5. 若存在剩余候选且 deadline/budget/AbortSignal 允许，按 frozen `fallbackEligibleProfileIds` 顺序选择第一个未尝试 profile，产生 fallback-applied，并重新进入 governed model invocation path。
6. 每个 fallback outcome 都写 safe evidence、`POLICY_APPLIED` timeline-only event 和 redacted observability projection。

## 失败与降级（Failure / Degradation）

- outcome source 缺失：记录 safe diagnostic，主 routing decision 按上游结果继续；不得生成伪造 evidence。
- fallback registry 缺失或不可用：fallback-denied，safe reason 为 dependency unavailable；不得从 raw config 或 provider adapter 推断候选。
- 已有用户可见输出：fallback-denied，safe reason 为 visible-output replay blocked；不得 silent replay。
- fallback 候选耗尽：fallback-exhausted，并在首版按当前 safe failure 结束；只有 clarify/handoff 独立 change 完成后，才允许把它们作为 fallback-exhausted 的可选下游。
- fallback candidate invocation 失败：再次进入 fallback orchestration，直到 denied、exhausted、canceled、timeout 或成功；每次 attempt 必须受 deadline/AbortSignal 约束。
- invalid evidence shape：丢弃该 evidence projection 并记录 safe diagnostic；不得写 raw payload。
- audit sink 不可用：主流程继续，记录 audit unavailable metric 或脱敏日志。
- trace/log 写入失败：主流程继续，记录 observability degradation；不得影响 terminal commit。
- redaction 失败：降级为 reason-only summary 或跳过该 sink；不得输出未脱敏 evidence。
- runtime timeline write 失败：按 runtime timeline failure policy 返回 safe error 或降级；不得直接写 gateway 私有记录绕过 runtime。

## 验收样例（Acceptance Examples）

- 正常路径：routing policy 选择 deterministic path；系统记录 selected-path safe outcome，写 `POLICY_APPLIED` timeline-only event，并投影 audit/log/trace。
- constraint 路径：`targetSkill` 不可用；targeted Skill routing 产生 rejected safe outcome；系统记录 rejected constraint evidence，不重新判断 Skill 是否允许。
- fallback applied 路径：当前 profile 失败且无用户可见输出；存在未尝试 fallback-eligible profile；Agent Core 按 frozen `fallbackEligibleProfileIds` 顺序选择第一个未尝试 profile，记录 fallback-applied evidence，并重新进入 governed model invocation path。
- fallback denied 路径：当前 profile 已输出用户可见内容后失败；Agent Core 记录 fallback-denied evidence，不 silent replay。
- fallback exhausted 路径：当前 profile 失败且没有剩余 fallback-eligible profile；Agent Core 记录 fallback-exhausted evidence，并按当前 safe failure 结束。
- 用户不可见路径：用户读取 history；只看到最终 answer、pending input、handoff 或 `SafeError`，看不到 detailed evidence。
- 降级路径：redaction 失败；对应 sink 只收到 reason-only summary 或被跳过，主 routing outcome 不变。
