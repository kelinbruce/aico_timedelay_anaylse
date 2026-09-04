### `unify-capability-failure-disposition`

状态：archived（2026-08-09，`openspec/changes/archive/2026-08-09-unify-capability-failure-disposition`）

类型：实施型 contract refinement 与失败处置闭环

主要 owner：`agent-capability`

依赖：

- 已满足（2026-08-03 群内确认通过且无异议）：`CapabilityInvocationRequest.timeoutMs` per-attempt 语义完成 frozen contract 群内确认。
- 已满足（2026-08-04 群内确认通过，相关人员同意）：`CapabilityInvocationRequest.maxRetries?: number` additive refinement；字段表示初始 attempt 后允许的额外重试次数，缺失时默认 `1`，因此默认总 attempt 数最多为 `2`；Workflow 既有 retry 次数只约束统一调用边界内部 attempt 上限。
- 已满足（2026-08-07 用户确认群内通过）：frozen `agent-contracts/model` additive refinement。公共类型名为 `ToolChoice`（不得带 `Model`），值域恰好为 `AUTO | NONE | REQUIRED`，字段为 `ModelInferenceOptions.toolChoice?: ToolChoice`，profile 缺省为 `AUTO`，normal precedence 为 profile、Prompt Template、governed Capability patch、trusted request、governed hook；Skill metadata 复用同形 closed model options，首版不支持 named-tool object。
- 已满足（2026-08-07 用户确认群内通过）：frozen `agent-contracts/agent-assembly` clean replacement。删除 `AgentRuntimeSettings.maxToolIterations`，新增 `maxTurns`（正安全整数、缺省 `50`）和 `maxToolCallsPerTurn`（`1..100` 安全整数、缺省 `30`）；不保留 deprecated alias、双写 precedence 或 migration window。
- 已满足（2026-08-07 用户确认群内通过）：frozen `agent-contracts/runtime` refinement。从 `RoutingConstraints` 删除 `maxToolCalls`，从 planning Hook 删除 `maxRounds/maxCalls`，`RequestContext` 与 checkpoint 只增加同一个 `agentTurnIndex`，normal/finalizing 由 index 与 accepted `maxTurns` 的关系推导；request-scoped 禁用 Tool 只保留 `executionMode=model-only`，同步确认 Web/runtime schema、Hook contract 和 checkpoint recovery mapping。
- 当前实现与 stable OpenSpec 已在 2026-08-09 完成归档同步；后续 change 必须以归档后的 canonical specs 和长期设计为基线。
- `add-ts-response-memory-disclosure`、`refine-ts-workflow-exception-failure-contract`、`refine-ts-workflow-user-check-scenarios`、`refine-ts-workflow-cancel-policy` 和 `add-ts-runtime-operational-log-hardening` 会触及相同 Requirement 或行为不变量；本 change 整条移除 mixed `ts-minimal-agent-kernel / 最小 Capability Tool 集合`，Tool diagnostic 迁回 canonical logging owner。后合入 `main` 的 change 必须基于届时最新 stable 与代码重建 delta 并消解冲突，不能恢复旧预算、日志开关或覆盖先合入行为。
- `add-ts-workflow-event-history`、`add-ts-workflow-output-parser-contract` 和 `refine-ts-workflow-recipe-v2-contracts` 是邻接协同项；`refine-ts-tool-default-root` 与失败处置无关。它们均不阻塞当前实施。
- 归档时已对照 stable 应用来源 `REMOVED` 与目标 `ADDED/MODIFIED`，并记录仍存活冲突 change 的后合入责任；并行 change 后续集成时必须基于最新 stable 重建重叠 delta。

目标：

- Tool、Skill 和 Agent 的全部生产调用通过唯一受治理执行边界获得统一最终失败结果。
- 幂等瞬态失败在安全门禁成立时按调用声明的 `maxRetries` 上限自动同参重试；缺省为一次重试，每次 attempt 获得完整 `timeoutMs`，父 `AbortSignal` 控制上层生命周期。
- 普通 Agent 将取消之外的最终 Capability 失败作为完整且可操作的安全反馈交给模型决定下一步；不按重复错误、空 Tool 名称或 Tool-call 超限次数局部终止，canonical `maxTurns`（缺省 50）按 accepted `RequestRun` 约束普通 logical turns，pause/resume/recovery 不重置，达到上限后追加且仅追加一次无 Tool 执行权的模型收尾。
- `maxToolCallsPerTurn`（缺省 30、有效域 1..100）是唯一单轮 Tool-call admission limit；它计数模型返回的调用，不按 Tool 名称去重，也不保证通过后续 preflight 的调用成功执行。超限时只保存顺序前缀并按统一 preflight、治理、执行和配对规则处理，尾部不保存、不执行、不生成 synthetic result，反馈 requested/admitted/omitted counts 后继续 loop。
- `ToolChoice` 纳入 canonical `ModelInferenceOptions`，允许 profile、Prompt Template、受治理 patch、trusted request 和 governed hook 修改；达到 `maxTurns` 后通过 runtime-owned request-local `contextPatch.modelOptions.toolChoice=NONE` 复用同一 merge/render/model loop，并保留 Tool descriptors。
- 只有 risk policy 明确 `REQUIRE_AUTHORIZATION` 是授权控制；普通 `AUTHORIZATION` SafeError 按一般最终失败反馈模型。
- 当前 20 个 first-party Tool 及扩展 Tool 公共边界不留已知失败出口旁路。

规格输入：

- `CapabilityInvocationResult` 使用 `safeError?: SafeError` 作为唯一调用失败字段；agent-capability 私有严格 schema 拒绝未声明字段和非法 status/`safeError` 组合。
- 同参自动重试只发生于 `IDEMPOTENT + UNAVAILABLE|TIMEOUT + retryable=true + 未取消 + 未调用 emitResultDelta` 的失败，并受 effective `maxRetries` 限制；字段缺失时为 `1`，显式 `0` 时不重试；同一逻辑调用的全部 attempt 使用首次调用已接受的同一 descriptor snapshot 和 execution target。
- `timeoutMs` 是单次 attempt 的完整预算；第二次 attempt 使用与第一次相同的原始值。
- 所有状态的规范化 `CapabilityInvocationResult` 共用 `256000` UTF-16 code unit 单结果容量；当前阶段完整 violations 在容量内全部返回，超过容量时显式失败、不截断，且 Capability execution 不开始。
- Agent 对全部非取消最终失败持续反馈模型，不建立 failure fingerprint、局部错误次数阈值或重复失败终止；`maxTurns` 保持唯一 loop-count bound，达到上限后通过一次 finalizing model turn 收尾；`maxToolCallsPerTurn` 只做单轮顺序前缀接纳。risk policy 明确 `REQUIRE_AUTHORIZATION` 和 lifecycle PEND/DENY/BLOCK 保持既有控制流；普通 `AUTHORIZATION` SafeError 不产生 pending control。
- `ModelInferenceOptions.toolChoice` 使用唯一公共 `ToolChoice` 三值类型；`NONE` 保留 Tool descriptors，`REQUIRED + tools=[]` 在 provider access 前失败，`providerOptions` 与 `modelParams` 不得提供平行 tool choice；`modelParams` 的其他透传语义保持由其 owning contract 定义。
- Workflow 收到最终 Capability 失败后不执行节点重试；取消中断，其他失败进入显式 exception，无匹配分支则失败。

契约输入：

- `CapabilityInvocationRequest.timeoutMs` 的 per-attempt 语义和可选 `maxRetries` 的额外重试次数语义；`CapabilityInvocationResult`、`CapabilityInvocationPort`、`SafeError`、`CapabilityReplayPolicy` 和 `AbortSignal` 是实现必须遵守的既有契约输入。
- runtime `safeError.message` 在模型 `CAPABILITY_RESULT` 投影边界映射为 `safeError.errorMessage`。
- `ToolChoice`、`ModelInferenceOptions`、`ModelProfile`、`ResolvedModelConfiguration`、`ModelInvocationRequest`、Prompt `modelOptions`、Capability context patch 和 `BEFORE_MODEL_INVOKE` mutation 是本次模型选择控制的统一 contract chain；实施前必须完成上述 frozen contract 群内确认。
- `AgentRuntimeSettings.maxTurns/maxToolCallsPerTurn` 是唯一 Agent-owned loop limits；`RoutingConstraints` 和 planning Hook 不再携带数量预算；`RequestContext` 与 checkpoint 只携带同一个 run-level `agentTurnIndex`，不增加 phase。这些 frozen contract refinement 必须在实施前完成群内确认。

实现约束：

- `GovernedCapabilityInvocationPort` 是 descriptor 取消传播、attempt-local delta 门禁和同参 retry 唯一 owner；agent-core、agent-workflow 和 channel/frontend 不重放 Capability。
- `agent-capability` 是失败结果主要写入模块；agent-core、agent-workflow、agent-memory、agent-runtime、agent-model、agent-context-engine、Prompt/Skill/Hook 与 channel/frontend 只做对应 Function 的必要 contract/producer/consumer 接入。
- retry 使用固定安全 truth table；可信调用方只能通过 `CapabilityInvocationRequest.maxRetries` 限制额外 attempt 上限，缺省值为 `1`，不得绕过幂等、可见 delta、结果未知或取消门禁。
- runtime 继续独占 terminal commit；Agent Core 只构造安全终止错误。
- Agent Core 独占 `maxTurns`、`maxToolCallsPerTurn` admission 与 finalizing decision；Agent Core 从 trusted `RequestContext.agentTurnIndex` 读取当前坐标，Runtime 通过既有 checkpoint 原样保存并在同一 run 恢复，finalizing 由 `index=maxTurns` 推导，不新增 phase 或 loop state machine。Context/Prompt/Skill/Hook/model provider 只消费 canonical `ToolChoice`，不能扩大 finalizing turn 的 Tool execution authority。
- 公共 contract package 不新增本 change 专用 schema、retry、normalization 或 message helper；严格 result schema 留在 agent-capability。

非目标：

- 不修改 Model Provider retry/fallback、Gateway 通用重试、Capability replay eligibility 或 Recipe error shape；durable recovery 只在 `RequestContext` 与对应 checkpoint 增加同一个 `agentTurnIndex`，模型边界只增加 canonical `ToolChoice` 的校验、合并和 selected-provider 映射。
- 不在本 change 实现 Tool call 流式到达即执行；未来 change 另行定义 stream admission、并发、取消、恢复和 durable transcript sealing，本 change 只固定顺序前缀语义。
- 不改变合法成功、空结果、具有可用业务内容的 `DEGRADED`、pending input 或 sandbox authority。
- 不让 automatic retry 延长父请求或 Workflow 的生命周期，也不保证父 signal 已接近截止时仍能完成第二次 attempt。

验收要点：

- Contract tests 覆盖 `safeError` 唯一失败字段、严格 status/`safeError` 组合、未声明字段拒绝、`256000` UTF-16 code unit 统一容量和持久化/外置投影回归。
- Retry tests 证明缺省与 `maxRetries=1` 时总 attempt 数最多为 `2`、显式 `0` 时不重试、显式更高值按额外 retry 次数计数；全部 attempt 获得原始完整 `timeoutMs`，调用前/descriptor 解析期间取消时 executor count 为 0，父 signal 在重试前或期间取消会阻止后续 attempt，delta emitter 已调用或拒绝后不重试。
- Tool ledger 闭合 20 个 first-party Tool、全部已知 failure/degraded exits 和扩展公共边界。
- Agent 黑盒 tests 证明 Bash `COMMAND_NOT_ALLOWED` 等非取消失败进入下一模型轮次、普通授权错误与明确 authorization control 不混淆、lifecycle 控制流不被改写、同批预检失败时 executor count 为 0、相同失败和空 Tool 名称多次继续；达到 `maxTurns` 只进入一次 finalizing logical turn且 pause/recovery 不重置；`maxToolCallsPerTurn` 的 29/30/31/100/101 边界只保存接纳前缀且无孤立 Tool message pair，连续超限不提前终止。
- Model/Context/Prompt/Skill/Hook tests 证明唯一 `ToolChoice` 命名、三值 schema、profile 缺省/precedence、Skill patch、provider 映射、`providerOptions`/`modelParams` collision、request-local patch、保留 Tool descriptors、Hook override、planning budget rejection 和 named-tool negative case。
- Workflow tests 证明 Capability 最终失败零节点重试，非 Capability attempt timeout/retry/exhausted 行为保持完整。
- backend contract/build/test/architecture gate、frontend build/test/三宿主 gate 和 OpenSpec strict validate 全部通过。

并行边界：

- 后续 change 不得未经协调地覆盖已归档的 `CapabilityInvocationResult`、`GovernedCapabilityInvocationPort` retry ownership、`workflow-contracts` timeout/retry Requirement、`workflow-capability-nodes / Restful Node`、`memory-tools` 或 `rag-tool` 的同一失败语义；同 spec 内不触及这些 Requirement 或行为不变量的 change 可以并行。
- agent-runtime 仅修改 FAILED terminal content 优先级，不取得 Capability 失败分类或 retry owner。
- frontend 通过 channel 安全投影消费最终失败，不接管 terminal truth。
