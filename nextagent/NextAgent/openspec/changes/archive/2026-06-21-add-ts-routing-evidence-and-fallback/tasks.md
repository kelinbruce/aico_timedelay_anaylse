## 1. Evidence Recording

- [x] 1.0 确认 `add-ts-routing-constraint-validation` 和 `add-ts-targeted-skill-routing` 已分别定义并验证可被消费的 safe outcome；本 change 不反向定义 constraint governance 或 preferred Skill governance。
  验证：`openspec validate add-ts-routing-constraint-validation --strict`；`openspec validate add-ts-targeted-skill-routing --strict`
  来源：design "调度依赖顺序"
- [x] 1.1 在 Agent orchestration 中记录 routing safe outcome evidence：selected、rejected、clarification、handoff。
  验证：`npm test -- --run packages/agent-core/tests/routing-evidence-and-fallback.test.ts`
  来源：Requirement "Routing safe outcomes produce evidence"
- [x] 1.2 记录 constraint / targeted Skill safe outcome evidence：accepted、rejected、ignored、degraded；不得重新判断 constraint 或 Skill 是否允许。
  验证：`npm test -- --run packages/agent-core/tests/routing-evidence-and-fallback.test.ts`
  来源：Requirement "Constraint safe outcomes can be recorded as evidence"
- [x] 1.3 在 Agent Core 中实现 model fallback orchestration：消费 frozen `modelProfileRegistry.fallbackEligibleProfileIds`、当前 `SafeError`、request/run/step state、visible-output state、budget/deadline、AbortSignal 和已尝试 profile ids；不得让 `agent-model` 隐式切换 profile。
  验证：`npm test -- --run packages/agent-core/tests/routing-evidence-and-fallback.test.ts`
  来源：Requirement "Agent Core orchestrates model fallback explicitly"
- [x] 1.3a 明确 fallback orchestration 的 request-local state owner 和恢复边界：实现必须使用现有 runtime-owned request-local execution facts 承载 attempt state；若当前增量无法安全覆盖跨恢复精确 fallback，则测试和实现必须显式锁定“只保证单次 accepted execution attempt 正确”的首版边界。
  验证：`npm test -- --run packages/agent-core/tests/model-fallback-orchestration.test.ts`
  来源：design "输入与前置条件"
- [x] 1.4 覆盖 fallback-applied：当前 profile 失败且无用户可见输出、存在未尝试 fallback-eligible profile 时，Agent Core 按 frozen `fallbackEligibleProfileIds` 顺序选择第一个未尝试 profile，并重新进入 governed model invocation path。
  验证：`npm test -- --run packages/agent-core/tests/model-fallback-orchestration.test.ts`
  来源：Requirement "Agent Core orchestrates model fallback explicitly"
- [x] 1.5 覆盖 fallback-denied：已有用户可见输出、deadline/budget 不足、AbortSignal canceled 或 fallback dependency unavailable 时，不 silent replay，并记录 safe reason。
  验证：`npm test -- --run packages/agent-core/tests/model-fallback-orchestration.test.ts`
  来源：Requirement "Agent Core orchestrates model fallback explicitly"
- [x] 1.6 覆盖 fallback-exhausted：无剩余 fallback-eligible profile 时记录 exhausted outcome，并进入 explicit safe failure、clarification 或 handoff path。
  验证：`npm test -- --run packages/agent-core/tests/model-fallback-orchestration.test.ts`
  来源：Requirement "Agent Core orchestrates model fallback explicitly"
- [x] 1.7 记录 fallback-applied、fallback-denied、fallback-exhausted evidence。
  验证：`npm test -- --run packages/agent-core/tests/routing-evidence-and-fallback.test.ts`
  来源：Requirement "Model fallback evidence is recorded"

## 2. Boundary And Projection

- [x] 2.1 通过 runtime timeline boundary 为 routing、constraint 和 fallback outcome 写入既有 `POLICY_APPLIED` timeline-only diagnostic event；不得新增 `TimelineEventType`。
  验证：`npm test -- --run packages/agent-core/tests/routing-evidence-and-fallback.test.ts`；`npm run lint:architecture`
  来源：Requirement "Timeline use remains timeline-only"；Requirement "Routing evidence is not a new public core DTO"
- [x] 2.2 投影到 audit、structured log 和 trace 时必须脱敏；redaction 失败降级为 reason-only 或跳过对应 sink。
  验证：`npm test -- --run packages/agent-observability/tests/routing-evidence-redaction.test.ts`
  来源：Requirement "Evidence observability degrades safely"
- [x] 2.3 channel/history 不投影 detailed evidence，只展示最终 answer、pending input、handoff 或 `SafeError`。
  验证：`npm test -- --run packages/agent-channel-web/tests/*routing*`
  来源：Requirement "Routing evidence is not user-visible by default"
- [x] 2.4 确认本 change 不新增 public routing evidence DTO、gateway Record、stream event type 或 `agent-contracts` public export。
  验证：code review；`rg -n "RoutingEvidence|RoutingEvidenceRecord|ROUTING_EVIDENCE|FALLBACK_APPLIED|FALLBACK_DENIED" packages/agent-contracts packages/agent-common`
  来源：Requirement "Routing evidence is not a new public core DTO"

## 3. Failure And Degradation

- [x] 3.1 覆盖 audit sink unavailable、trace/log write failure 和 redaction failure 时主 routing outcome 不变，且不输出 raw evidence。
  验证：`npm test -- --run packages/agent-observability/tests/routing-evidence-redaction.test.ts`
  来源：Requirement "Evidence observability degrades safely"
- [x] 3.2 覆盖 runtime/channel 不创建业务 routing decision 或 evidence source。
  验证：`npm run lint:architecture`
  来源：Requirement "Routing evidence is owned by Agent orchestration"

## 4. 验证和收尾

- [x] 4.1 运行相关 Agent Core、Observability 和 Channel 测试。
  验证：`npm test -- --run packages/agent-core/tests/routing-evidence-and-fallback.test.ts packages/agent-core/tests/model-fallback-orchestration.test.ts packages/agent-observability/tests/routing-evidence-redaction.test.ts`
  来源：AGENTS.md 验证门禁
- [x] 4.2 运行架构验证。
  验证：`npm run lint:architecture`
  来源：AGENTS.md 架构边界
- [x] 4.3 运行 OpenSpec 验证。
  验证：`openspec validate add-ts-routing-evidence-and-fallback --strict`
  来源：AGENTS.md OpenSpec 验证门禁

## 归档前更新基线检查（非实施任务）

- 同步 `openspec/specs/routing-evidence-and-fallback/spec.md`。
- 按需更新 `openspec/designs/architecture/ts-backend-architecture.md`。
- 按需更新 `openspec/designs/architecture/observability-boundaries.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
