## Function

- **所属 Function**：`FN-4.3 装配上下文`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Context Engine protects minimum safe current-request context

Context Engine SHALL treat root user message, current-request protocol-required messages, and latest-request-required attachment context as minimum safe current-request context. This baseline SHALL NOT be silently dropped to make room for prior history.

Historical attachment context MAY be degraded when context overflow is governed by the proactive auto-compact strategy, but such degradation MUST be explicit and explainable. A latest-request-required attachment that cannot be safely projected or budgeted MUST fail the current assembly rather than silently continuing as pure text.

**需求类别**：功能性需求

#### Scenario: Latest request minimum safe context is protected

- **WHEN** Context Engine identifies the root user message, current-request protocol-required messages, and latest-request-required attachment context
- **THEN** it treats them as minimum safe current-request context
- **AND** it protects them from silent omission to make room for prior history

#### Scenario: Minimum safe context cannot fit

- **WHEN** minimum safe current-request context still cannot fit within the safe input budget
- **THEN** Context Engine MUST return an explicit insufficient-context failure or an equivalent safe degraded outcome
- **AND** it MUST NOT fake a successful assembly by removing request-critical content

#### Scenario: Latest request attachment cannot be silently degraded away

- **WHEN** a latest-request-required attachment becomes unavailable or cannot fit as part of minimum safe current-request context
- **THEN** the system MUST fail explicitly with a safe error or insufficient-context outcome
- **AND** it MUST NOT silently continue as if the request were pure text

**Appendix H1-a (revised by baseline promotion, 2026-08-11).** The large-content thresholds defined in `openspec/specs/large-content-references/spec.md` and re-asserted in this baseline under `Large-content thresholds referenced from context-engine are fixed` (from `add-ts-large-content-references`) are independent of, and not a substitute for, the history budget governance: `inline-max-bytes` (default 8192 chars), `aggregate-max-chars` (default 16384), `preview-max-chars` (default 1024), configuration namespace `adnclaw.large-content.*`. Concretely: a fresh large content entry that exceeds `inline-max-bytes` MUST be offloaded to an owner-scoped `ContentRef` regardless of how the history budget would otherwise apply; aggregate offload uses the shared `aggregate-max-chars` key; neither threshold can be redefined inside context assembly. The two mechanisms are 互不替代、不互相覆盖. The forward side of this cross-reference is already in the large-content baseline entry quoted above; this appendix closes the reverse side from the budget-protection side so both share a single source of truth in the `large-content-references` spec.

### Requirement: Large-content thresholds referenced from context-engine are fixed

Context Engine MUST reference the same large-content threshold and configuration baseline as `openspec/specs/large-content-references/spec.md` "Large-content thresholds and configuration are fixed": `inline-max-bytes` default 8192 chars、aggregate offload 阈值 default 16384 chars、preview 字符数上限 default 1024 chars，配置命名空间 `adnclaw.large-content.*`。

Context Engine 在 aggregate offload 与 fresh offload 判断中 MUST 复用以上同一阈值，不允许实现层重新定义。阈值修改仅限于对应的 `adnclaw.large-content.*` 配置覆盖与 contract refinement change 两种路径，不允许在上下文装配内联限流。

aggregate offload 决策 MUST 遵循以下顺序：保留 prior frozen decisions → 只考虑 fresh results → 按 size 从大到小 offload 直至聚合 ≤ aggregate 阈值或没有可选 fresh result 剩余。

**需求类别**：功能性需求

#### Scenario: Aggregate offload uses the shared threshold key

- **WHEN** 同一 user message 下 fresh text results 聚合体积 = 16385 chars
- **THEN** Context Engine MUST 使用 `adnclaw.large-content.aggregate-max-chars` 阈值判断，按 size 从大到小 offload 直至聚合 ≤ 16384 chars

#### Scenario: Threshold configuration override is honored

- **WHEN** `adnclaw.large-content.aggregate-max-chars` 被配置覆盖为 M
- **THEN** Context Engine MUST 以 M 为聚合阈值判断，不使用 16384 chars 硬编码

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：移除 context-engine spec 中 60% prior-history budget cap 的 OUTER cap 声明和 H1-a 双向交叉引用的 60% 依赖；保留 minimum safe current-request context 保护不变量和 large-content 阈值独立 offload 不变量。
- **依据 Requirements**：`Context Engine protects minimum safe current-request context`、`Large-content thresholds referenced from context-engine are fixed`

### 规格

- **规格项**：历史上下文预算 cap 机制
- **变更类型**：移除
- **原规格值**：历史上下文预算 ≤60% 模型窗口（OUTER cap on prior-history context）
- **目标规格值**：不适用（cap 机制移除；上下文溢出由 proactive auto-compact strategy 治理）
- **依据 Requirements**：`Context Engine protects minimum safe current-request context`

- **规格项**：minimum safe context 保护
- **变更类型**：修改
- **原规格值**：baseline 不进入 60% prior-history budget cap，不被静默丢弃
- **目标规格值**：baseline 不被静默丢弃以腾出历史空间
- **依据 Requirements**：`Context Engine protects minimum safe current-request context`

- **规格项**：large-content 阈值与 history budget 的关系
- **变更类型**：修改
- **原规格值**：60% cap 是 OUTER cap，大内容阈值独立于 cap（"regardless of how the 60% cap would otherwise apply"）
- **目标规格值**：大内容阈值独立于 history budget governance（"regardless of how the history budget would otherwise apply"）
- **依据 Requirements**：`Context Engine protects minimum safe current-request context`、`Large-content thresholds referenced from context-engine are fixed`

- **规格项**：aggregate offload 顺序规则
- **变更类型**：修改
- **原规格值**：顺序规则 + "该决策不会因 60% history window budget 而改变顺序"
- **目标规格值**：顺序规则（无 60% 引用）
- **依据 Requirements**：`Large-content thresholds referenced from context-engine are fixed`
