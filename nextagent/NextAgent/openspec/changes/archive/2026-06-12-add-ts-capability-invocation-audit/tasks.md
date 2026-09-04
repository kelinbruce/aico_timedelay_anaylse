## 1. Specification

- [x] 1.1 Add capability invocation audit requirements defining target-state invocation audit behavior at the executor boundary, since `agent-capability` currently has no audit code.
  来源：proposal 影响范围
- [x] 1.2 Confirm invocation audit uses the app-composed audit path and does not define private audit writers, private audit queues, private audit schemas inside capability implementations, or public audit SPI/DTO contracts under `agent-contracts`.
  来源：spec requirement "Capability invocation audit uses the app-composed audit path"；design D1
- [x] 1.3 Confirm stable business identifiers are the primary correlation keys and trace/span identifiers remain supplemental observability fields only.
  来源：spec requirement "Invocation audit facts use stable business identifiers"；design D2
- [x] 1.4 Confirm audit output passes through unified redaction and never emits raw tool args/result, raw model input/output, raw provider response, raw sandbox output, raw Skill content, local paths, secrets or stack traces.
  来源：spec requirement "Invocation audit records only safe summaries and refs"；design D4

## 2. Design

- [x] 2.1 Define the authority chain: capability catalog/risk/sandbox/provider boundaries produce safe invocation facts; capability executor owns invocation outcome; `agent-observability` constructs audit records through an `agent-app` composition-time wrapper/injection.
  来源：design D1
- [x] 2.2 Define terminal audit uniqueness for completed, failed, denied, timed out, canceled, aborted, disabled and not found outcomes.
  来源：spec requirement "Invocation audit has a single terminal audit fact per invocation"；design D3
- [x] 2.3 Define late result behavior as safe diagnostic or audit degradation evidence only.
  来源：spec requirement scenario "Late result after timeout is diagnostic only"；design D3
- [x] 2.4 Define Skill, on-demand Skill content disclosure and nested invocation audit as minimal safe summaries under the same app-composed invocation audit path.
  来源：spec requirement "Skill and nested invocation audit remains minimal and scoped"；design D5
- [x] 2.5 Define safe correlation between model-facing builtin `Skill` tool invocation and resolved target Skill invocation without adding a second public invocation envelope.
  来源：spec requirement scenario "Skill tool target resolution is correlated safely"；design D5
- [x] 2.6 Define failure handling for sink outage, redaction failure, missing owner-safe fields and serialization errors without changing invocation or request truth.
  来源：spec requirement "Invocation audit failures are explicit and non-blocking"；design D4

## 3. Acceptance

- [x] 3.1 Normal path: started and completed invocation produces audit records through the app-composed audit path with owner scope, invocation refs, capability/provider identity, status, safe summary and bounded latency.
  来源：AGENTS.md 验证门禁
- [x] 3.2 Denied/disabled/not-found path: rejection before execution produces safe audit evidence without fabricated optional refs. Must explicitly cover conflict-rejected candidates where `catalog.resolve()` returns no executable descriptor because the only candidate was conflict-rejected by `add-ts-capability-conflict-resolution`; the executor boundary produces a "not found" terminal audit fact and never reads conflict diagnostics or shadowed candidate details.
  来源：AGENTS.md 验证门禁
- [x] 3.3 Timeout/late result path: timeout produces one terminal audit fact and late result cannot rewrite it.
  来源：AGENTS.md 验证门禁
- [x] 3.4 Redaction path: raw args, raw result, raw provider body, raw sandbox output, raw Skill content and local paths are absent from audit records.
  来源：AGENTS.md 验证门禁
- [x] 3.5 Boundary path: concrete capability implementations do not directly write audit sink or define independent audit schema.
  来源：AGENTS.md 验证门禁
- [x] 3.6 Correlation path: builtin `Skill` tool invocation and target Skill invocation audit records include only safe invocation ids and never raw args/content/source refs/manifest/fork transcript.
  来源：AGENTS.md 验证门禁
- [x] 3.7 Run `openspec validate add-ts-capability-invocation-audit --strict`.
  来源：AGENTS.md 验证门禁

## 4. Implementation

- [x] 4.1 定义 executor 内部 safe invocation fact 结构：明确 required owner-safe 字段（tenantId, subjectId, sessionId, requestId, runId, requestContextId, capabilityInvocationId, capabilityId, agentId, agentVersion, status, outcome, occurredAt）和 descriptor-resolved 后 required provider 字段（providerId, providerKind），并明确 latency、retryability、reasonCode、result refs、artifact refs 为 present-and-authoritative 时才记录；不得新增 `CapabilityAuditInput`、`IAuditBoundary` 或等价 `agent-contracts` public SPI/DTO
  来源：design D1, D2；spec requirement "Invocation audit facts use stable business identifiers"
- [x] 4.2 定义 executor → observability wrapper 的 fact passing 接口：executor 在 invocation 进入边界时提供 non-terminal started fact，在 denied/disabled/not-found/executor-unavailable 等 pre-execution rejection 时提供 terminal fact，在返回 `CapabilityInvocationResult` 后提供 terminal fact；由 `agent-app` 将该边界与 `agent-observability` 审计实现装配起来；所有 fact passing 均为 non-blocking，audit write 失败只产生 bounded degradation evidence，不改变 invocation result
  来源：design D1；spec requirement "Capability invocation audit uses the app-composed audit path"
- [x] 4.3 在 capability executor boundary 接入 audit fact passing：每次 capability invocation started、pre-execution rejection 和 terminal outcome 都向 app-composed observability wrapper 暴露 safe invocation facts；`BuiltinToolExecutor` 或具体 tool implementation 不直接写 audit sink
  来源：design D1
- [x] 4.4 实现 terminal audit uniqueness：同一 `capabilityInvocationId` 只产生一个 terminal audit fact，late result 只产生 bounded degradation evidence
  来源：design D3；spec requirement "Invocation audit has a single terminal audit fact per invocation"
- [x] 4.5 实现 audit degradation 路径：audit sink outage、redaction failure、serialization error、missing required owner-safe fields 时记录 bounded safe degradation evidence，不改变 invocation result 或 request terminal truth
  来源：design D4；spec requirement "Invocation audit failures are explicit and non-blocking"
- [x] 4.6 实现 Skill/nested invocation 的 minimal audit fact passing
  来源：design D5；spec requirement "Skill and nested invocation audit remains minimal and scoped"
