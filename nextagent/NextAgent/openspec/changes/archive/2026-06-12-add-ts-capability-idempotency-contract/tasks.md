## 1. Contract 和类型对齐

- [x] 1.1 `CapabilityReplayPolicy` 归属与总体架构对齐。
  总体架构对齐：`core-contracts.md` §归类不变量已明确规定 `CapabilityReplayPolicy` 归 `agent-common`，不得在 capability/gateway/runtime subpath 中重新定义等价 enum；`establish-ts-core-contracts` (archive/2026-05-29) 已将 `type CapabilityReplayPolicy = "NON_IDEMPOTENT" | "IDEMPOTENT"` 固化至核心契约。
  本 task 后续：capability descriptor 使用 `CapabilityReplayPolicy`，缺省为 `NON_IDEMPOTENT`，由 task 2.1 覆盖。
  来源：`CapabilityReplayPolicy` owning 归属见 `core-contracts.md`；design D1。
- [x] 1.2 移除 public contract 中的 `isIdempotent`、`IdempotencyDeclaration`、`IdempotencyScope`、`IdempotencyHandling` 和 `IdempotencyValidator` 依赖。
  验证：运行 `rg -n "isIdempotent|IdempotencyDeclaration|IdempotencyScope|IdempotencyHandling|IdempotencyValidator" packages modules src openspec/changes/add-ts-capability-idempotency-contract`；源码中不得作为 TS public contract 出现，OpenSpec 命中只允许作为拒绝方案或非目标出现；若实际源码目录不同，按 workspace package 目录执行同等检查。
  来源：proposal 变更范围；design D1/D2。
- [x] 1.3 确认 `CapabilityInvocationRequest` 保留可选 `idempotencyKey`，且不新增 `recoveryReplay`、`workspaceDir` 或 provider cache 字段。确认 `deriveCapabilityInvocationIdempotencyKey(runId, toolCallId)` 在 `agent-common` 中定义（格式为 `${runId}:${toolCallId}`），并被 `agent-core`（`tool-loop.ts` capability 调用段）和 `agent-runtime` recovery guard（`submit.ts` `resolveStableIdempotencyKey` 注入段）共用，不重复定义平行 key 派生规则。
  验证：运行 capability invocation request schema/type tests；code review 检查 request contract 字段；`rg -n "deriveCapabilityInvocationIdempotencyKey" packages` 确认只被 `agent-core` 和 `agent-runtime` 产品路径调用，不存在平行 key 派生实现。
  来源：`Runtime MUST Pass Stable Idempotency Key For Replay`；design D2；`deriveCapabilityInvocationIdempotencyKey` in `agent-common`。

## 2. Runtime/Capability 集成

- [x] 2.1 在 capability descriptor/assembly 构建路径中读取并传播 `CapabilityReplayPolicy`。
  验证：运行 assembly/capability descriptor tests，断言 explicit `IDEMPOTENT` 被保留，缺省值为 `NON_IDEMPOTENT`。
  来源：`Capability Descriptor MUST Declare Replay Policy`；design D1。
- [x] 2.2 在 runtime retry/recovery 调用 capability 时传递稳定 `idempotencyKey`，普通首次调用不因本 change 强制要求 key。
  验证：运行 runtime capability invocation tests，断言 replay invocation 带 key，ordinary first invocation 可不带 key。
  来源：`Runtime MUST Pass Stable Idempotency Key For Replay`；design D3。
- [x] 2.3 在 runtime replay eligibility 判断中只使用 `CapabilityReplayPolicy`，不得因为存在 `idempotencyKey` 就允许 `NON_IDEMPOTENT` capability 重放。
  验证：运行 runtime replay policy tests，断言 non-idempotent capability with key 仍被拒绝。
  来源：`Idempotent Provider MUST Preserve Same-Key Replay Semantics`；design D1/D3。
- [x] 2.4 为 capability provider contract 添加 `IDEMPOTENT` same-key replay 语义测试或 provider conformance test stub。
  验证：运行 provider conformance tests，断言 same-key repeated call 不产生第二次 irreversible side effect 的 contract fixture。
  来源：`Idempotent Provider MUST Preserve Same-Key Replay Semantics`；design D3。

## 3. Redaction 和边界验证

- [x] 3.1 实现或接入 idempotency key redaction，确保 key 原文不进入 logs、trace、metrics labels、audit、stream、safe error 或 provider metadata。
  验证：运行 observability/redaction tests，断言 raw key 不出现在 captured diagnostics。
  来源：`Idempotency Key MUST Be Redacted`；design D4。
- [x] 3.2 做 cross-change 检查，确认 `add-ts-runtime-recovery-idempotency-guard` 使用 `CapabilityReplayPolicy` 和 stable `idempotencyKey`，不引用 `isIdempotent`。
  验证：运行 `rg -n "isIdempotent|CapabilityReplayPolicy|idempotencyKey" openspec/changes/archive/*add-ts-runtime-recovery-idempotency-guard openspec/changes/add-ts-capability-idempotency-contract` 并 code review 结果；`isIdempotent` 只允许作为拒绝方案或非目标出现。
  来源：proposal 影响范围；design Verification Map。
- [x] 3.3 运行 OpenSpec 严格校验。
  验证：`openspec validate add-ts-capability-idempotency-contract --strict`。
  来源：OpenSpec config；proposal 验证入口。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/idempotency-contract/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/contracts/core-contracts.md`。
- 按需更新 `openspec/designs/modules/agent-capability.md` 和 `openspec/designs/modules/agent-runtime.md`。
- 按需新增或更新 `openspec/designs/adr/capability-replay-policy.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
