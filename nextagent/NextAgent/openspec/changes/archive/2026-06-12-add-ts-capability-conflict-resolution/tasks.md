## 1. 核心冲突裁决函数

- [x] 1.1 在 `agent-capability` 内部创建 `conflict-resolution.ts`，实现 `resolveConflictGroup(candidates): { winner, evidence }` 和 `resolveConflict(candidate, existing): ConflictResult`
  - 无同名 → ALLOW
  - 同 scope（同 `providerId`）同名 → 有 stable source fact identity 证明则 ALLOW(去重)，否则 REJECT
  - 跨 scope 同名 → 按 governed candidate priority SHADOW
  来源：spec "Same-Scope Same-Identity Conflicts Are Explicit"、"Cross-Scope Name Collisions Use Governed Priority And Shadowing"；design D1
- [x] 1.2 实现 `ConflictResult` 和 `ConflictDiagnostic` 类型定义
  来源：design D2
- [x] 1.3 实现 `isStableDuplicate()` 判断逻辑：同 `providerId` + 同 `capabilityId` + 同 `kind` + 实现内部可证明的 stable source fact identity；缺少 source fact proof 时返回 false
  来源：design "Stable Duplicate 判定"
- [x] 1.4 实现 `pickByPriority()` 逻辑：explicit Agent binding / Agent package binding > Agent-scoped source > BUNDLED > system-local LOCAL_DIRECTORY > remote/external provider；同级冲突必须稳定排序并记录安全诊断，不得按注册顺序产生不可解释结果
  来源：design "Priority"
- [x] 1.5 实现 `buildDiagnostic()` 诊断构建，只包含 capabilityId、providerId、providerKind、kind、priority、resolution、reason，确保脱敏
  来源：spec "Conflict Diagnostics Are Structured, Safe, And Traceable"；design D3

## 2. Catalog 集成

- [x] 2.1 在 `StaticCapabilityCatalog.resolveGovernedGroup()` 中集成 `resolveConflictGroup()`，替换现有 ad-hoc BUNDLED/local 优先级逻辑
  来源：spec scenario "Invalid conflict outcome prevents visibility and execution"；design D5
- [x] 2.2 从 `resolveConflictGroup()` 返回的 evidence 派生 `LocalSkillReadinessEvidence`（REJECT → LOCAL_SKILL_DUPLICATE_REJECTED，SHADOW → LOCAL_SKILL_GOVERNANCE_UNAVAILABLE 或 LOCAL_SKILL_SHADOWED_BY_AGENT）
  来源：design "与现有 Skill 治理证据不兼容" 取舍
- [x] 2.3 确保 conflict/shadowed candidates 不进入模型可见能力列表
  来源：spec scenario "Conflicted capability cannot be invoked directly"
- [x] 2.4 保持 `CapabilityConflictResolver` 接口不变，作为 `resolveGovernedGroup()` 的最终兜底
  来源：design D5
- [x] 2.5 确保 `resolve()` 与 `listAvailable()` 复用同一 conflict gate；无 winner 的冲突候选在 invocation 消费路径映射为 `category=CONFLICT` 的 safe failure，不重新按 provider 裁决
  来源：spec scenario "Conflicted capability cannot be invoked directly"；design D6

## 3. 诊断与可观测性

- [x] 3.1 通过内部 diagnostic/readiness evidence 暴露 `capability.conflict.detected`、`capability.conflict.rejected`、`capability.conflict.shadowed` 语义；若已有受控 structured log helper 可用，再接入日志；不在业务代码中直接调用 metric SDK 或 observability SDK
  来源：design "可观测性"；架构约束 "core business modules MUST NOT depend on metrics SDK types"

## 4. 测试

- [x] 4.1 编写 `resolveConflictGroup` 单元测试：无冲突 → ALLOW
- [x] 4.2 编写 `resolveConflictGroup` 单元测试：同 scope（同 providerId）同名无 stable duplicate → REJECT
- [x] 4.3 编写 `resolveConflictGroup` 单元测试：同 scope 同名同 kind 但缺少 stable source fact proof → REJECT
- [x] 4.4 编写 `resolveConflictGroup` 单元测试：跨 scope 同名 → 高 priority SHADOW 低 priority
- [x] 4.5 编写 `resolveConflictGroup` 单元测试：governed priority 比较覆盖 explicit Agent binding、Agent-scoped source、BUNDLED、system-local、remote/external provider
- [x] 4.6 编写 `resolveConflictGroup` 单元测试：Agent-owned local source 优先于 system-local，且 builtin 优先于 system-local
- [x] 4.7 编写诊断脱敏测试：确保不包含 raw path/manifest/secret
- [x] 4.8 编写 Skill candidate 冲突测试：走统一边界，生成 LocalSkillReadinessEvidence
- [x] 4.9 编写 Catalog 集成测试：conflict candidate 不进入可见列表
- [x] 4.10 编写直接 invocation conflict candidate 返回 SafeError 的测试
  来源：spec 所有 scenario；design D4

## 5. 验证

- [x] 5.1 运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`
- [x] 5.2 运行 `openspec validate add-ts-capability-conflict-resolution --strict`
  来源：AGENTS.md 验证门禁
