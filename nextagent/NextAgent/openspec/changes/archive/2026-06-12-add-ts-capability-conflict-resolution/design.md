# Capability Conflict Resolution Design

## 背景

`add-ts-capability-core-governance` 定义了 5-level priority，但缺少通用冲突检测算法和裁决规则。本 change 补全冲突裁决逻辑。

## 现状

`StaticCapabilityCatalog.resolveGovernedGroup()` 已有局部冲突逻辑：
- 同 local scope 重复 → REJECT（`LOCAL_SKILL_DUPLICATE_REJECTED`）
- BUNDLED 优先 → SHADOW local
- agent-owned 优先于 system-local → SHADOW

这些逻辑仅覆盖 Skill 和 BUNDLED，未处理 SKILL_HUB、MCP_SERVER、AGENT_REGISTRY、CUSTOM 等来源的冲突。本 change 用统一算法替换 ad-hoc 逻辑，同时保留 `LocalSkillReadinessEvidence` 追踪。

## 核心规则

1. **无同名** → ALLOW
2. **同 scope 同名** → 可证明 stable duplicate 则 ALLOW(去重)，否则 REJECT
3. **跨 scope 同名** → 按 governed candidate priority SHADOW（高优先级覆盖低优先级）

### Scope 定义

`CapabilityDescriptor` 没有 `providerScope` 字段（参见 `establish-ts-core-contracts` contract baseline）。Scope 从 `provider.providerId` 推导：

- **同 scope** = 同一 `providerId`（同一 provider 实例）
- **跨 scope** = 不同 `providerId`

### Priority

Governed candidate priority（高到低）：

| Priority | candidate class |
|----------|-----------------|
| 1 (最高) | request Agent explicit enabled binding / Agent package explicit binding |
| 2 | Agent-scoped source candidate |
| 3 | `BUNDLED` builtin candidate |
| 4 | system-local `LOCAL_DIRECTORY` candidate |
| 5 (最低) | remote or externally configured provider candidate, including `SKILL_HUB` / `MCP_SERVER` / `AGENT_REGISTRY` / `CUSTOM` |

Priority 不写入 `CapabilityDescriptor`。实现按 request-scope facts 推导：explicit binding 来自 `AgentAssembly.capabilityBindings`，Agent-scoped source 复用现有 `localSourceScope(candidate) === "agent-owned-local"`，system-local 复用 `localSourceScope(candidate) === "system-local"`，builtin 通过受信 builtin provider id 判断。远端或外部 provider 同级时必须保持确定性排序，并记录安全诊断；不得按注册顺序产生不可解释结果。

### Stable Duplicate 判定

两个 descriptor 可证明为 stable duplicate 当且仅当它们来自同一 provider 实例、同一 capability kind、同一 capability id，并且具备同一 stable source fact identity。当前已冻结 `CapabilityDescriptor` 不包含通用 source fact id，因此默认实现只能把完全相同的 descriptor key 与实现内部可证明的同源事实当作 duplicate；缺少证明时必须按 same-scope conflict 拒绝。

不同 `kind` 的同名 candidate 不构成 duplicate；它们是 same capability id 下的冲突候选，必须按冲突路径处理，不能静默保留两个 model-visible entry。

## 设计决策

### D1: 纯函数实现

```typescript
function resolveConflictGroup(
  candidates: readonly CapabilityDescriptor[]
): { winner: CapabilityDescriptor | undefined; evidence: ConflictEvidence[] } {
  if (candidates.length <= 1) {
    return { winner: candidates[0], evidence: [] };
  }

  const byScope = groupBy(candidates, d => d.provider.providerId);

  // 1. 同 scope 检测
  for (const group of byScope.values()) {
    if (group.length > 1) {
      const stable = group.filter((d, i) => i === 0 || isStableDuplicate(group[0], d));
      if (stable.length !== group.length) {
        // 存在非 stable duplicate → REJECT 整个 scope
        return { winner: undefined, evidence: group.map(d => conflictEvidence(d, 'REJECTED', 'same-scope-conflict')) };
      }
    }
  }

  // 2. 跨 scope：按 governed candidate priority 选 winner
  const representatives = [...byScope.values()].map(g => g[0]);
  const winner = pickByPriority(representatives, requestFacts);
  const shadowed = representatives.filter(d => d !== winner);
  return {
    winner,
    evidence: shadowed.map(d => conflictEvidence(d, 'SHADOWED', 'lower-priority'))
  };
}
```

**为什么**：规则确定，不需要策略抽象。

### D2: 最小数据结构

```typescript
type ConflictDecision = 'ALLOW' | 'REJECT' | 'SHADOW';

interface ConflictResult {
  decision: ConflictDecision;
  winner?: CapabilityDescriptor;
  shadowed?: readonly CapabilityDescriptor[];
  rejected?: readonly CapabilityDescriptor[];
  deduplicated?: boolean;
  reason?: string;
  diagnostic?: ConflictDiagnostic;
}

interface ConflictDiagnostic {
  conflictId: string;
  timestamp: string;
  capabilityId: string;
  candidates: Array<{
    providerId: string;
    providerKind: string;
    kind: string;
    priority: number;
    resolution: ConflictDecision;
  }>;
  resolution: ConflictDecision;
  reason: string;
}
```

**为什么**：Diagnostic 只记录安全字段，不包含 raw path、manifest、secret。

### D3: 脱敏原则

Diagnostic 只包含 `capabilityId`、`providerId`、`providerKind`、`kind`、`priority`、`reason`。
不包含 raw local path、raw manifest、hidden Skill content、secret、credential、raw provider response。

### D4: Skill capability 走统一边界

Skill candidates 与其他 capability 走同一冲突函数。不单独建 Skill 冲突引擎，不解析 Skill source/manifest。`LocalSkillReadinessEvidence` 由 `resolveGovernedGroup()` 从冲突结果生成，不在冲突函数内部产生。

### D5: 集成点

集成点在 `StaticCapabilityCatalog.resolveGovernedGroup()`，不在 `register()`：

- `register()` 保持 `void` 同步签名不变
- 冲突裁决在 `buildVisibleView()` → `resolveGovernedGroup()` 路径中执行
- 目标语义是 "before candidate enters the request-scope executable/visible catalog view"，不是修改 startup `register()` 签名或引入运行时 dispatch-time 冲突检测

`CapabilityConflictResolver` 接口保持不变，作为 `resolveGovernedGroup()` 的最终兜底（当 `resolveConflictGroup()` 无冲突但仍有多个候选时使用）。

### D6: Direct invocation 安全失败

`resolve()` 必须与 `listAvailable()` 复用同一 request-scope conflict gate。若 requested `capabilityId` 的候选在冲突裁决后没有 winner，`resolve()` 返回不可执行结果，invocation 消费路径必须把它映射为 conflict-compatible `SafeError`，例如 `category=CONFLICT`、稳定 safe reason code、且不暴露 raw source detail。冲突函数不进入 runtime dispatch，也不让 invocation path 重新裁决 provider。

## 模块归属

| 组件 | 位置 |
|------|------|
| `resolveConflictGroup()` / `resolveConflict()` | `agent-capability` 内部 |
| `ConflictResult` / `ConflictDiagnostic` | `agent-capability` 内部 |
| Catalog 集成 | `StaticCapabilityCatalog.resolveGovernedGroup()` |
| Invocation 安全失败消费 | catalog resolve 的调用方 |

## 可观测性

首版至少通过内部 diagnostic/readiness evidence 暴露冲突结果。若当前 observability helper 已可用，可通过受控 structured log 记录冲突事件；不得为了本 change 新增业务模块对 metric SDK 或 observability SDK 类型的直接依赖（遵守架构约束 "core business modules MUST NOT depend on metrics SDK types"）：

- `capability.conflict.detected`
- `capability.conflict.rejected`
- `capability.conflict.shadowed`

## 风险与取舍

| 风险 | 缓解 |
|------|------|
| 冲突检测性能 | 使用 Map 按 capabilityId 索引，O(1) 查询 |
| SHADOW 意外行为 | Diagnostic 明确记录 shadowed 原因和胜出者 |
| Skill source 泄漏 | Diagnostic 只记录安全字段 |
| 与现有 Skill 治理证据不兼容 | `resolveGovernedGroup()` 保留 evidence 生成，从 `resolveConflictGroup()` 结果派生 |
