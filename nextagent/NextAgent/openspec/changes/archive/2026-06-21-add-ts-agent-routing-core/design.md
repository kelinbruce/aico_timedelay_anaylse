## 背景和现状（Context）

当前 `agent-core` 的 `DefaultAgent` 已经在 accepted request 后读取冻结 `AgentAssembly`，再进入 context/model/tool loop。这个形状满足最小内核，但还缺少一个显式 Agent routing policy 决策点。roadmap 要求 routing 位于 Agent 内部，runtime/channel 不做业务语义路由。

本设计把 routing-core 定义为 Agent boundary 内的最小决策层：它不定义复杂规则库，只定义触发点、输入、受控输出、失败关闭和下游接入。

当前 change 的最小可交付行为是：在现有 `DefaultAgent` 模型循环前增加 routing decision point；正常 accepted request 选择 `MODEL_DRIVEN_LOOP`；trusted input 缺失、assembly 读取失败、未知 decision 或必需依赖不可用时 fail closed。其他 decision kind 只保持可翻译边界，不在本 change 中实现真实选择规则。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 在 Agent boundary 内建立 routing policy 决策点。
- 复用已冻结 routing decision vocabulary，并固定下游命令边界。
- 明确 router 需要支持从可信 Agent 配置读取 routing 规则配置，并约束 `default` / `policy` 两类受控模式。
- 明确 `policy` 模式下 routing policy 的输入和输出 contract，确保后续规则路由能以固定 shape 产出 skill 目标。
- 明确 runtime/channel 只传递 accepted facts 和 typed constraints。
- 保持现有最小模型驱动 loop 可作为默认受控路径。
- 将 deterministic、clarify、human handoff 的真实选择规则留给后续 change。

**非目标：**
- 不实现 recipe dispatch、routing policy extension 或外部规则 DSL。
- 不实现规格路由配置的规则匹配、优先级、冲突解决或 rule-based policy 执行算法。
- 不实现 deterministic flow、clarify 或 human handoff 的业务选择规则。
- 不定义用户显式指定 Skill 的完整校验细节。
- 不定义 routing evidence 的 audit 字段细节。
- 不修改 request acceptance、same-session lane、terminal commit、stream projection 状态机或 `agent-contracts/core` routing decision vocabulary。

## 设计决策（Decisions）

1. routing policy 位于 `agent-core` 的 Agent 执行入口之后。
2. policy 输入只来自 accepted request facts、冻结 `AgentAssembly`、由可信 Agent 配置提供的 routing 规则配置、governed capability/model view、locale/security context、typed constraints 和预算/取消上下文。
3. 初版 decision kind 复用已冻结 `DETERMINISTIC_FLOW`、`MODEL_DRIVEN_LOOP`、`CLARIFY`、`REJECT` 和 `HUMAN_HANDOFF`。
4. 初始 policy 只实现两类 outcome：正常请求选择 `MODEL_DRIVEN_LOOP`；trusted input 无法满足时选择 safe reject/fail closed。
5. deterministic、clarify、human handoff 只保留为已冻结 vocabulary 的下游翻译边界；只有后续 change 定义明确规则后才可被选择。
6. 不引入泛化 `PolicyPort`；如需要契约，使用 Agent routing 专用最小接口。
7. routing 规则配置的最小模式固定为：
   - 未配置或 `mode=default`：router 进入默认 `MODEL_DRIVEN_LOOP` 路径。
   - `mode=policy`：router 读取受控 policy 配置。当前只预制系统默认 `policy:intent-recognition` 配置方法；本 change 仅识别该配置并保留受控入口，不实现真正的 intent-recognition policy evaluation；未来可扩展到用户自定义代码型 policy，但该能力不在本 change 实现。
8. 本 change 先冻结 `policy` 的输入和输出 shape，不冻结规则匹配、优先级、冲突解决和完整执行算法。

最小 contract shape 的 owner 由 `refine-ts-routing-constraints-contract` 承担；本 change 只消费等价于 `AgentRoutingConfig`、`AgentRoutingPolicyInput`、`AgentRoutingPolicyResult` 的受控 shape，不在此重复定义 owner。

## 触发机制（Trigger）

- 用户动作：用户或上游系统提交请求，经 channel schema/auth 和 runtime admission 接受后触发。
- 生命周期阶段：request acceptance 之后，Agent Core 第一次 context assembly、model invocation、capability invocation、pending input 或 terminal rejection 之前。
- 状态触发：retry/edit/resume 产生新的 accepted request 或恢复到 Agent execution boundary 时重新触发或恢复当前阶段的 policy outcome；不得复用旧请求 decision 作为新请求输入。
- 预算检查：routing 读取已接受请求 deadline、AbortSignal、runtime settings 和可用能力预算；预算不足时选择 reject/clarify/handoff 或 policy-declared safe default。
- 后台 job：本 change 不由后台 job 主动触发；后台 recovery 只能恢复已接受 request 的 lifecycle stage，再进入 Agent boundary。
- 同步/异步：routing decision 是主请求路径同步决策；audit/log/trace 消费可以异步。

## 输入与前置条件（Inputs / Preconditions）

输入：
- `RequestRun`：sessionId、requestId、runId、agentId、agentVersion、agentAssemblyRef 和 acceptance facts。
- `RequestContext`：requestContextId、identityContext、locale、tool call recovery state、cancellation/deadline context。
- `AgentAssembly`：runtime 固化版本，通过 `require(agentId, agentVersion)` 读取。
- routing rule configuration：仅来自可信 Agent 配置来源。最小 shape 至少要能表达 `mode`，其中未配置或 `default` 表示默认路由，`policy` 表示启用受控 policy 配置。当前 `policy` 只允许系统内置 `policy:intent-recognition` 配置方法；用户自定义代码型 policy 的 DSL、加载和执行边界由后续 change 定义。
- `AgentRoutingConfig` 等价 shape：
  - `mode` 缺省或为 `default` 时，router 进入默认 `MODEL_DRIVEN_LOOP`。
  - `mode=policy` 时，必须提供 `policy`，且当前 `policy.method` 仅允许 `policy:intent-recognition`。
- governed capability/model views：仅来自 capability/model governance 后的 request-scope 可见集合。
- typed routing constraints：仅在后续 contract refinement 明确承载字段后由 channel/auth/upstream typed boundary 传入；本 change 不新增 request command 或 `RequestContext` 字段。
- budget facts：max tool calls、max tool rounds、context/model budget、allow human input/subagents 等策略输入。

`AgentRoutingPolicyInput` 等价 shape 的最小边界：
- `run`: accepted request/run facts。
- `context`: accepted context、identity、locale 和 typed constraints carrier。
- `agentAssembly`: frozen Agent 配置事实。
- `signal`: routing cancellation boundary。

前置条件：
- request 已被 runtime 接受并绑定 Agent Scope 与 Owner Scope。
- `Session.agentId` 与 accepted run agent scope 已完成一致性校验。
- runtime/channel 未执行业务路径选择。
- 不信任客户端请求体、模型输出、capability 参数中的 owner、tenant、agent、provider override 或 raw system prompt。

## 输出与副作用（Outputs / Side Effects）

输出：
- routing decision：已冻结 controlled decision kind、safe reason code、optional evidence ref、downstream command。
- safe routing outcome：供 observability/evidence change 消费的脱敏 outcome。
- policy routing result：当 `mode=policy` 时，policy 必须返回固定结果 shape，至少包含：
  - `skillName?`: 被规则选中的 Skill 名称。
  - `decisionKind`: 对应受控 routing decision vocabulary 的结果。
  - `safeReason`: 供 downstream/observability 使用的安全原因码。
  结果可以缺省 `skillName`，表示未命中特殊规则并回到默认路径；不得返回未治理的任意目标字段。`workflowName` 留给后续 change。
- `AgentRoutingPolicyResult` 等价 shape 约束：
  - `decisionKind` 必须属于已冻结 routing decision vocabulary。
  - `safeReason` 是唯一必填诊断字段。
  - `skillName` 只能作为受控 policy 目标字段出现，且可缺省。
- downstream invocation：初始实现只进入 Context Engine、Model Service 或 safe terminal path；CapabilityInvocationPort、pending input boundary 和 human handoff boundary 由后续明确规则触发。

副作用：
- 本 change 不新增 timeline event vocabulary；routing evidence 如需记录 timeline-only 诊断事件，必须由 `add-ts-routing-evidence-and-fallback` 复用已冻结 `POLICY_APPLIED` 或先提出 contract refinement。
- 不把 routing decision 写入用户 message/history。
- 不修改 AgentAssembly、provider config、catalog state 或 session owner scope。

## 核心判断逻辑（Core Decision Logic）

1. 读取 accepted `RequestRun`、`RequestContext` 和冻结 `AgentAssembly`。
2. 读取可信 Agent 配置提供的 routing 规则配置。
3. 若配置缺失或 `mode=default`，直接进入默认 `MODEL_DRIVEN_LOOP` 路径。
4. 若配置声明 `mode=policy`，则当前只允许识别系统预制 `policy:intent-recognition` 配置方法，并只允许读取受控 policy 输入、保留受控 policy 输出入口；用户自定义代码型 policy 不在本 change 执行。若配置不可加载、来源不可信或格式无法按当前已定义契约安全识别，则 fail closed 或忽略后进入 policy-declared safe default，不得按未治理配置执行规则。
5. 读取 request-scope capability/model visibility；必需依赖失败时 fail closed。
6. 读取 typed routing constraints，但只把它们作为待校验输入。
7. 若必需 trusted input 缺失、冻结 assembly 不可加载、必需 governed view 不可用或 cancellation 已触发，选择 safe reject/fail closed。
8. 若存在 typed routing constraints 但前置 contract/governance 未完成，视为不可用约束，不按原样使用。
9. 对正常 accepted request，选择 `MODEL_DRIVEN_LOOP`，或在 `mode=policy` 时消费 policy routing result 再翻译到已冻结 decision kind。
10. 校验 decision kind 属于受控 vocabulary，且 `skillName` 只来自受控 policy 输出。
11. 将 `MODEL_DRIVEN_LOOP` 翻译为现有 Context Engine + Model Service + tool loop；将 safe reject/fail closed 翻译为安全错误路径。

## 状态 / 产物契约（State / Artifact Contract）

Routing decision 是 request/run 内的短生命周期决策事实：
- 语义：描述 Agent Core 本次请求选择哪个受控处理路径。
- 规则配置：路由配置 owner 为可信 Agent 配置；router 只读取，不回写。未配置或 `mode=default` 时不产生额外 policy 目标；`mode=policy` 时当前只保留 `skillName` 目标入口。
- 生命周期：只在当前 request/run 决策和诊断中有效；retry/edit 新请求必须重新决策。
- 消费方：Agent Core 下游调度、routing evidence、audit/log/trace、测试断言。
- 与原始事实关系：必须可追溯到 sessionId、runId、requestContextId、agentId、agentVersion 和 policy identity。
- 安全限制：不得包含 raw prompt、raw model output、raw tool args/result、secret、本地路径、provider-private config 或未脱敏异常。

本 change 不创建 artifact、summary、memory record 或 learning event。若后续 change 需要这些产物，必须另行定义语义、生命周期和消费方。

## 流程接入（Flow Integration）

主流程：

`Channel -> Runtime admission -> Agent Core -> Routing Policy -> Context/Model/Capability/Pending/Handoff/Terminal -> Runtime terminal -> Channel projection`

- 上游：runtime 提供 accepted request facts 和 frozen Agent Scope。
- 接入点：`agent-core` 在 `executeRun` 的 first handling step 前执行 routing policy，并把可信 Agent 配置中的 routing 规则配置纳入 router 输入边界。
- 下游：Context Engine 接收目的和安全 request facts；Model Service 接收 rendered model request；safe reject/fail closed 走安全错误路径。
- 后续消费：routing evidence change 消费 safe outcome；constraint validation change 消费 typed constraints；targeted skill routing change 在 Agent Core 内部把 directed Skill 映射为 deterministic branch 并补齐 capability invocation。
- 当前 `skillName` 执行链：当 routing decision 提供 `skillName` 时，Agent Core 先通过 governed Skill loading path 执行一次定向 Skill 加载，把 skill 产生的 `generatedMessages` / `contextPatch` 合并进 request-local state，然后再进入后续 Context Engine 和 Model 主流程；当前不是直接终结为独立 workflow。
- 后续规则路由：由单独 change 定义 `mode=policy` 的完整配置 schema、rule matching、priority、conflict handling、`skillName` 到 deterministic/clarify/handoff 的选择映射，以及 `workflowName`、用户自定义代码型 policy 的加载、执行、沙箱和治理；本 change 不执行这些扩展规则。

## 失败与降级（Failure / Degradation）

- policy implementation unavailable：safe internal unavailable error；不得默默进入任意模型或 capability。
- routing rule configuration unavailable/invalid：若当前 policy 声明必须依赖该配置，则 fail closed；否则只允许进入已定义的 safe default，不得执行未定义规则。
- frozen assembly 读取失败：safe unavailable/internal error；不得重新按 active Agent version 选择。
- capability/model governed view 不可用：fail closed；本 change 不定义 no-capability fallback 策略。
- constraints 格式无效：交给 constraint validation change，初始 core 必须视为不可用约束，不得按原样使用。
- budget 不足：safe reject/fail closed；不得超预算调用模型/能力。
- cancellation：遵守 AbortSignal，routing 不得启动不可取消慢边界。
- observability 失败：主 routing decision 不变，按 evidence change 降级。

## 验收样例（Acceptance Examples）

- 正常路径：accepted request 进入 Agent Core，routing policy 选择 model-driven loop，随后调用 Context Engine 和 Model Service；runtime/channel 未选择业务路径。
- policy 路径：Agent 配置声明 `mode=policy` 且使用系统预制 `policy:intent-recognition`，router 识别该配置并保留受控 policy 入口；当前如果 routing decision 提供 `skillName`，Agent Core 会先通过 governed Skill loading path 装载该 Skill，再带着 Skill 注入后的 request-local state 进入 Context Engine 和 Model 主流程，不直接解释未定义 DSL。
- 边界路径：accepted request 带 typed constraint，但前置 contract/governance 尚未完成；routing-core 不直接信任 constraint，按不可用约束处理。
- 失败路径：`AgentAssemblyRegistry.require(agentId, agentVersion)` 失败；routing 以 safe error 结束，不回退到 active version。
- 降级路径：capability view 暂不可用且 routing 必须依赖它；routing 以 safe unavailable/internal error fail closed，并产生 safe outcome。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | routing 只消费 trusted Agent Scope/Owner Scope；拒绝 untrusted override。 | routing contract tests；architecture tests |
| 性能/容量 | routing 是轻量同步决策，不做慢 provider discovery；慢边界必须可取消。 | unit tests；code review |
| 可靠性/恢复 | accepted request 使用冻结 assembly；policy 失败 fail closed。 | characterization tests |
| 可维护性 | routing-core 只定义最小受控 vocabulary，不扩展泛化 policy 框架。 | architecture lint；code review |
| 可测试性 | decision input/output 可用测试替身确定性断言。 | agent-core routing tests |
| 一致性 | `default` / `policy` 两类模式有固定输入输出边界，当前只有 `skillName` 从受控 policy 输出进入 routing 结果。 | contract tests；agent-core routing tests |
| 安全扩展性 | 当前 `policy` 仅允许系统内置 `policy:intent-recognition`；用户自定义代码型 policy 延后到单独 change，以避免未治理执行边界提前落地。 | OpenSpec review；后续 sandbox/governance tests |
| 审计/可追溯性 | 输出 safe routing outcome；详细 evidence 由后续 change 归口并复用既有 timeline vocabulary。 | evidence integration tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| routing 位于 Agent boundary 内 | 1.1 | `npm run lint:architecture`；agent-core tests |
| runtime/channel 不做业务路由 | 1.2 | architecture negative tests |
| frozen assembly facts 被使用 | 2.1 | agent-core tests |
| unknown decision fail closed | 2.2 | routing policy unit tests |
| no untrusted scope override | 2.3 | negative tests |
| routing config supports `default` / `policy` | 2.4 | routing policy unit tests |
| policy output carries `skillName` safely | 2.5 | routing policy unit tests |
| current policy method is built-in only | 2.6 | OpenSpec validation |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/agent-routing-core/spec.md`
- 架构和跨模块设计：`openspec/designs/architecture/ts-backend-architecture.md`
- 模块设计：`openspec/designs/modules/agent-core.md`、`openspec/designs/modules/agent-runtime.md`、`openspec/designs/modules/agent-channel-web.md`
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md`

## 风险与取舍（Risks / Trade-offs）

- [风险] routing-core 过早抽象成通用 policy 框架 -> [缓解] 只定义 Agent routing 专用最小 vocabulary。
- [风险] 默认模型循环与新 routing path 发生重复入口 -> [缓解] 把现有 loop 作为唯一初始正常路径，即 `MODEL_DRIVEN_LOOP` 的下游命令。
- [风险] `policy` 配置过早泄露成未治理 DSL -> [缓解] 当前只冻结 `mode` 与 policy 输入输出边界，不冻结内部规则 DSL。
- [风险] 用户自定义代码型 policy 过早进入主路径执行 -> [缓解] 当前只允许系统内置 `policy:intent-recognition`，自定义代码执行能力拆到后续 change，并要求 sandbox/gateway/governance 边界。
- [风险] 后续 Skill/recipe change 扩展决策字段 -> [缓解] 当前 decision 只复用已冻结 kind、safe reason 和 evidence ref；当前仅 `skillName` 作为受控 policy 结果字段使用，`workflowName` 和新增字段必须走后续 contract refinement。

## 迁移计划（Migration Plan）

现有 `DefaultAgent` 模型驱动 loop 前置一个最小 routing policy，正常请求仍进入默认 `MODEL_DRIVEN_LOOP` branch。迁移期间不改变外部 Web API、stream vocabulary 或 terminal commit 语义。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/agent-routing-core/spec.md`：同步新增行为契约。
- `openspec/designs/architecture/ts-backend-architecture.md`：同步 Agent routing flow。
- `openspec/designs/modules/agent-core.md`：同步 routing policy owner。
- `openspec/designs/modules/agent-runtime.md`：同步 runtime non-owner。
- `openspec/designs/modules/agent-channel-web.md`：同步 channel non-owner。
- `openspec/designs/spec-to-design-map.md`：增加导航。

## 待确认问题（Open Questions）

无。
