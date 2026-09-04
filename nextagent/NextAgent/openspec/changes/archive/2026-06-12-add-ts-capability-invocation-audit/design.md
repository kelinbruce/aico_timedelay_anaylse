## Context

Capability invocation audit must explain who invoked which capability, under which owner scope, through which request/run, and with what safe outcome. It must do this without creating a second invocation state machine and without making concrete capabilities responsible for audit persistence or audit schemas.

The target design is to centralize audit construction at stable invocation boundaries. Capability catalog, risk policy, sandbox, provider and capability implementation paths provide governed facts and safe outcomes. The capability executor owns invocation outcome normalization. `agent-observability` owns the audit/observability implementation that turns those facts into redacted audit records, and `agent-app` wires it through composition-time wrapping or injection.

## Goals / Non-Goals

Goals:

- Keep capability invocation audit on the same app-composed audit path used by the rest of the TS backend, without adding a new `agent-contracts` SPI.
- Narrow the roadmap input to capability invocation audit only; hook and policy audit remain owned by their dedicated changes.
- Preserve stable business identifiers as the primary correlation keys.
- Ensure individual capability implementations do not write audit records directly.
- Guarantee at most one terminal audit fact per invocation.
- Keep Skill, nested invocation and generated message audit minimal and safe.
- Treat audit failures as explicit degradation without changing invocation or request truth.

Non-goals:

- Define hook invocation audit or risk policy audit behavior.
- Define storage schema, query APIs, retention policy, alerting, concrete logger implementation, batching, queueing or implementation-specific topology.
- Redefine capability execution, risk policy, sandbox execution, idempotency or Skill content disclosure behavior.
- Use trace/span identifiers as required audit keys.

## Decisions

### Decision 1: Audit construction is centralized at the capability executor boundary

The capability executor boundary is the point where invocation inputs, governance decisions, provider execution outcome, cancellation/timeout handling and safe result normalization converge. It is therefore the right boundary to expose owner-safe invocation facts to the app-composed observability wrapper.

Concrete capability implementations only return governed invocation results or safe failure outcomes. They do not own audit write behavior, audit retry behavior, audit field taxonomy or audit event names.

**Fact passing interface**：executor 在 invocation 进入边界时提供 non-terminal started fact，在 denied/disabled/not-found/executor-unavailable 等 pre-execution rejection 时提供 terminal fact，在返回 `CapabilityInvocationResult` 后提供 terminal fact。"not found" covers both genuinely absent capability ids and candidates that were rejected by catalog conflict resolution before reaching the executor boundary; the executor receives only the catalog resolve outcome and does not distinguish between these cases. fact 通过 `agent-app` composition-time wrapper/injection 交给 `agent-observability` 的审计实现；audit write 不影响 invocation result 返回。audit write 失败（sink unavailable、serialization error 等）只产生 bounded degradation evidence，不改变 invocation 终态。

**接口位置**：safe invocation fact shape 可以作为 `agent-capability` 的 implementation-local callback/input shape 或 `agent-observability` 的 internal observation input 存在，但 `agent-capability` 不得直接 import `agent-observability` implementation package。`agent-app` 是唯一把 capability invocation boundary 和 observability audit implementation 接起来的位置。该协作不得进入 `agent-contracts/capability`、不得新增 public SPI、不得定义第二套 audit schema；若后续需要 public audit contract，必须单独提出 contract refinement change。

### Decision 2: Stable business identifiers are primary

Invocation audit uses stable owner and execution refs such as `tenantId`, `subjectId`, `sessionId`, `requestId`, `runId`, `requestContextId`, `capabilityInvocationId`, `capabilityId`, `providerId`, `providerKind`, `agentId` and `agentVersion` when those refs are already authoritative.

Missing optional refs are omitted rather than fabricated. Trace/span fields remain supplemental observability diagnostics and are not required audit contract fields.

### Decision 3: Terminal audit is unique per invocation

Each invocation can have at most one terminal audit fact. Completed, failed, denied, timed out, canceled, aborted, disabled and not found are terminal outcomes for audit purposes. Late results, duplicate completions or post-terminal provider callbacks may only create bounded safe degradation evidence.

### Decision 4: Audit content is safe by construction and redacted before emission

Invocation audit stores safe summaries, reason codes, status, latency, retryability, result refs, artifact refs and low-cardinality classifications. It must never emit raw tool args/results, raw provider bodies, raw model input/output, raw sandbox output, raw Skill content, generated message content, local paths, secrets, credentials, tokens or stack traces.

Redaction is applied before audit emission through the unified redaction policy. Redaction failure fails closed for the audit path and records safe degradation evidence.

### Decision 5: Skill and nested invocation audit stays scoped

Skill invocation, on-demand Skill content disclosure and nested invocation use the same app-composed capability invocation audit path. Inline generated messages are represented by count, role, meta flag and bounded length only. Forked nested invocation records parent/child invocation refs, execution mode, status, safe terminal summary and safe refs without merging forked transcript into parent audit.

When the builtin `Skill` tool resolves to a target Skill capability invocation, audit may record only owner-safe correlation ids for the model-facing tool invocation and target Skill invocation. It must not introduce a second invocation envelope or include raw args, raw Skill content, raw source refs, raw manifest content or forked transcript.

## Boundary With Related Changes

- `add-ts-audit-sink` owns shared audit event construction/write order and audit degradation rules.
- `add-ts-redaction-policy` owns output sanitization before audit emission.
- `add-ts-lifecycle-hook-execution` and related hook observability changes own hook invocation audit behavior.
- `add-ts-risk-policy-enforcement` and related policy observability changes own risk policy audit behavior.
- `add-ts-trace-log-linking` may attach supplemental diagnostic correlation but does not define audit authority.
- `add-ts-runtime-metrics` may observe aggregate invocation audit outcomes but does not define audit records.
- `add-ts-capability-core-governance` owns capability catalog, descriptor and invocation boundary semantics.
- `add-ts-capability-conflict-resolution` may determine that a candidate is rejected or shadowed at catalog build time. When `catalog.resolve()` returns no executable descriptor because the only candidate was conflict-rejected, the invocation port produces a "not found" terminal audit fact through the same app-composed executor boundary. Invocation audit does not treat catalog-level conflict reject as a separate audit category; it observes only the executor-boundary outcome (descriptor found vs not found) and never reads conflict diagnostics or shadowed candidate details.

## Acceptance Focus

- Capability executor started, pre-execution rejection and terminal outcomes produce safe invocation facts through the app-composed observability wrapper.
- Concrete capability implementations do not directly write audit records.
- Audit and observability implementation is owned by `agent-observability`; `agent-capability` does not depend on observability implementation packages.
- Raw sensitive content is absent from invocation audit output.
- Terminal audit uniqueness holds under timeout, cancellation and late result conditions.
- Audit degradation does not change capability invocation result or request terminal truth.

## Quality Attributes

**安全（Security）**：
- 审计记录必须经过 redaction policy 过滤，不得包含原始工具参数/结果、provider body、模型输入输出、sandbox 输出、Skill 内容、生成消息内容、本地路径、secrets、credentials、tokens 或 stack traces
- 审计写入必须验证调用者身份和 owner scope，防止跨租户/跨用户审计污染
- 审计记录中的 business identifiers（tenantId、subjectId、sessionId 等）必须来自可信上下文，不得从 capability 参数中推导

**性能（Performance）**：
- 审计写入必须是异步非阻塞的，不得影响 capability invocation 的主流程延迟
- 审计 sink 必须支持批量写入和背压控制，防止审计积压拖慢系统
- 审计记录序列化必须是轻量级的，避免在热路径上进行复杂转换

**可靠性（Reliability）**：
- 审计写入失败必须显式降级（记录 degradation evidence），不得静默丢失或重试无限次
- 审计降级不得改变 capability invocation 结果或 request terminal truth
- 每次 invocation 最多产生一个 terminal audit fact，即使在 timeout、cancellation、late result 条件下也必须保持唯一性

**可观测性（Observability）**：
- 审计事实必须包含低基数 outcome、reason code 和 capability/provider 分类，供后续 audit sink、logging 或 metrics change 投影消费
- 审计降级事件必须产生 bounded safe degradation evidence，记录降级原因和影响范围
- 本 change 不定义审计查询接口、metrics 端点、批处理、队列或保留策略

**审计（Auditability）**：
- 审计事实必须包含当前 invocation 阶段已经 authoritative 的业务关联字段；缺失 required owner/run/session/agent 字段时进入 audit degradation
- 审计记录必须记录时间戳、latency、retryability、result refs、artifact refs 等执行元数据
- 审计记录必须支持事后追溯和合规性审查

## Verification Map

| 验证要求 | 验证方法 | 优先级 |
|---------|---------|--------|
| 审计记录不包含原始敏感内容 | Contract Test：验证 redaction policy 应用 | P0 |
| 审计写入不阻塞主调用路径 | Integration Test：测量 invocation 延迟无显著增加 | P0 |
| 审计写入失败时显式降级 | Integration Test：模拟 audit sink 故障，验证降级行为 | P0 |
| 每次 invocation 最多一个 terminal audit fact | Contract Test：验证唯一性约束 | P0 |
| 审计记录包含 required business identifiers 并正确省略 optional refs | Contract Test：验证字段分层 | P0 |
| 具体 capability 实现不直接写审计 | Architecture Test：验证审计写入只在 executor 边界 | P1 |
| Skill 和嵌套调用审计保持 scoped | Integration Test：验证 Skill invocation 审计格式 | P1 |
| 审计降级不改变 invocation 结果 | Integration Test：验证降级后结果不变 | P1 |

## Documentation Ownership

**规格文档**：
- `openspec/specs/capability-invocation-audit.md` - 审计行为规格、审计记录 schema、降级规则

**设计文档**：
- `openspec/designs/modules/agent-capability.md` - Capability executor 审计边界设计
- `openspec/designs/cross-cutting/audit-and-observability.md` - 审计与 observability 集成设计
- `openspec/designs/cross-cutting/redaction-policy.md` - Redaction policy 在审计中的应用



## Remaining Design Decisions (D6-D8)

### D6: Late Result Behavior (task 2.3)

Late results after a terminal audit fact has been emitted MUST NOT rewrite the terminal fact. The executor boundary MUST track whether a terminal fact has been emitted for a given `capabilityInvocationId` and suppress duplicate terminal emissions. Late results MAY produce bounded safe degradation evidence via the observability host's degradation path.

### D7: Skill and Nested Invocation Audit (task 2.4-2.5)

Skill invocation, on-demand Skill content disclosure and nested invocation SHALL use the same `InvocationAuditObserver` callback and `SafeInvocationAuditFact` structure. Additional safe correlation fields (`parentInvocationId`, `executionMode`, `generatedMessageCount`, `generatedMessageRole`) are available via the `nested` parameter on `buildTerminalFact()`. The observer callback does NOT carry raw Skill content, raw source refs, raw manifests, forked transcripts, or raw model/tool arguments.

When a model-facing builtin Skill tool invocation resolves to a target Skill capability invocation, audit correlation uses the tool invocation id as `parentInvocationId` without introducing a second public invocation envelope.

### D8: Audit Degradation Path (task 2.6)

Audit sink outage, redaction failure, serialization error, or missing required owner-safe fields MUST NOT change the capability invocation result. The `InvocationAuditObserver` callback is fire-and-forget; the executor boundary does not await or check the observer's outcome. Degradation evidence is the responsibility of the observability host and audit projector, not the capability executor.

## Risks / Trade-offs

**风险 1：审计积压导致系统过载**
- **影响**：审计 sink 写入延迟或失败时，积压的审计记录可能消耗内存和 CPU
- **缓解**：本 change 只要求 executor 的 fact passing 非阻塞并有 bounded degradation evidence；具体队列、背压和丢弃策略由 audit sink change 承接
- **验证**：Integration Test 模拟 sink 故障，验证 capability result 不被审计写入拖慢或改写

**风险 2：审计降级导致合规性缺口**
- **影响**：审计 sink 故障时，部分 invocation 可能没有完整审计记录，影响合规性审查
- **缓解**：审计降级本身产生 bounded safe degradation evidence，记录降级原因和影响范围；事后补全不在本 change 范围
- **验证**：Integration Test 验证降级记录完整性

**权衡 1：审计完整性 vs 主流程性能**
- **选择**：优先保证主流程性能，审计写入异步化且允许降级
- **理由**：capability invocation 是用户可见的热路径，审计是后台 observability 功能；审计缺失可以通过降级记录追溯，但主流程延迟会直接影响用户体验
- **替代方案**：同步审计写入 + 快速失败，但会导致 invocation 失败率上升

**权衡 2：集中式审计 vs 分布式审计**
- **选择**：集中式审计边界（capability executor），具体 capability 不直接写审计
- **理由**：集中式审计保证一致性和可控性，避免审计 schema 碎片化；具体 capability 实现者不需要理解审计规则
- **替代方案**：允许 capability 自定义审计字段，但会增加审计 schema 复杂度和安全风险

## Baseline Promotion Plan

**Draft → Stable**：
- 所有 P0 验证要求通过（审计安全性、非阻塞性、降级行为、唯一性、字段完整性）
- 审计记录 schema 冻结，字段语义明确
- 与 `add-ts-audit-sink`、`add-ts-redaction-policy`、`add-ts-capability-core-governance` 的边界稳定
- 至少一个 provider 类型（如 builtin tool）完成端到端审计集成验证

**Stable → Baseline**：
- 所有 P1 验证要求通过（具体 capability 审计隔离、Skill 审计）
- 至少 3 个不同 provider 类型（builtin tool、external API、sandbox executable）完成审计集成验证
- 审计 sink 在生产负载下稳定运行，降级率 < 0.1%
- 审计 sink、query、metrics 和 retention 能力由对应 changes 提升为基线
