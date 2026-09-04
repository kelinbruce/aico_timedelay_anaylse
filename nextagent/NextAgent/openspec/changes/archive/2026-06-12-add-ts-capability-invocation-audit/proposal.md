## Why

Capability invocation is one of the highest-risk execution boundaries in the TS backend because tools, Skill-backed capabilities, API-backed capabilities, executable capabilities and remote sources can all create side effects, access scoped data or produce large diagnostic output.

The system needs target-state audit behavior that explains capability use without spreading audit logic into every capability implementation. Invocation audit must be safe, owner-scoped, traceable through stable business identifiers and aligned with the app-composed audit path, redaction policy, structured logging, trace/log linking and metrics boundaries.

## What Changes

- Narrow the roadmap input to capability invocation audit only; hook and policy audit remain owned by their dedicated governance/observability changes.
- Define capability invocation audit as an app-composed internal collaboration owned by the capability executor and audit adapter, not by individual capability implementations.
- Define which invocation outcomes must produce safe audit facts: started, completed, failed, denied, timed out, canceled, aborted, disabled and not found.
- Define terminal audit uniqueness for each capability invocation.
- Define safe audit summaries for Skill invocation, on-demand Skill content disclosure and nested invocation.
- Define redaction requirements for invocation audit, including executable output, provider failures, raw tool args/results, raw model content, Skill content, local paths and secrets.
- Define failure/degradation behavior when audit cannot be written safely.

## Capability Impact

### Roadmap 输入承接说明

- 本 change 只承接 `add-ts-capability-invocation-audit` one-pager 中的 capability invocation audit 子范围。
- Hook invocation audit 由 lifecycle hook / audit sink 相关 change 承接；risk policy audit 由 risk policy / audit sink 相关 change 承接。
- 本 change 不定义 hook/policy event taxonomy、hook/policy outcome normalization、hook/policy storage/query 或 hook/policy metrics。

### 定义的 Audit 边界

- `capability-invocation`：executor boundary 在 capability invocation 完成时产生 safe invocation facts，传递给 app composition 注入的内部 audit adapter
- `audit-sink`：audit adapter 接收 executor 传来的 safe invocation facts 并构造 audit record
- `redaction-policy`：audit output 通过统一 redaction policy 过滤后才 emission

### 契约边界说明
- 本 change 不修改 `capability-invocation`、`audit-sink`、`redaction-policy` 的已有接口定义
- 本 change 定义 executor 如何向内部 audit adapter 传递 safe invocation facts，以及 audit output 的 safe field 契约；不新增 `agent-contracts` public SPI 或 audit DTO

## 主要 Owner

- Owner 9 Tool Capability

## Non-Goals

- This change does not define capability execution semantics, retry semantics, idempotency policy, Skill content disclosure execution rules, storage schema, query API, retention policy or alerting behavior.
- This change does not define concrete logger implementations, batching behavior or implementation-specific topology.
- This change does not make audit records authoritative for capability availability, invocation status, request terminal truth, session history or checkpoint state.
- This change does not allow raw payloads, raw prompts, raw model output, raw Skill content, generated message content, forked transcript, raw tool args/results, raw provider body, sandbox output, local paths, secrets, credentials or stack traces to enter audit output.
