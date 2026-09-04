## 背景和现状（Context）

核心契约已经把 `CapabilityReplayPolicy` 放在 `agent-common`，供 runtime、app configuration、assembly、capability 和 recovery 边界共同复用。`CapabilityInvocationRequest` 已经包含可选 `idempotencyKey?`，且不包含 `workspaceDir` 或 `recoveryReplay`。恢复重放资格由 runtime 在调用 capability 前判断。

目标态不使用 `isIdempotent` boolean、`IdempotencyDeclaration`、validator/cache 策略或多种 handling 策略。这些内容会和 core contracts 形成两套等价判断，也会把 provider 存储、结果缓存和重复调用处理过早提升为 public contract。本 change 把范围收敛为最小可执行契约：声明是否可安全重放，以及在允许重放时使用稳定 key。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 使用 `CapabilityReplayPolicy` 作为唯一 replay/idempotency 声明。
- 规定 Tool 默认 `NON_IDEMPOTENT`，显式 `IDEMPOTENT` 后才允许恢复/重试重放。
- 规定 runtime 在允许重放时通过 `CapabilityInvocationRequest.idempotencyKey` 传递稳定 key。
- 规定 provider 对 `IDEMPOTENT` capability 在同一 key 下的重复调用语义负责。
- 规定 idempotency key 原文不得泄露到日志、trace、audit、stream 或 safe error。
- 为 `add-ts-runtime-recovery-idempotency-guard` 提供唯一判断依据。

**非目标：**

- 不定义 `isIdempotent`、`IdempotencyDeclaration`、`IdempotencyScope` 或 `IdempotencyHandling`。
- 不定义通用 `IdempotencyValidator` SPI、duplicate cache、RETURN_CACHED 策略或全局幂等存储。
- 不定义跨 session/global 幂等。
- 不定义 idempotency key 的 provider-specific 物理存储或 TTL。
- 不改变普通首次 capability invocation 的执行语义。

## 设计决策（Decisions）

### D1: 唯一声明字段是 `CapabilityReplayPolicy`

选定方案：capability descriptor / assembly 暴露 `replayPolicy: CapabilityReplayPolicy`，取值为 `NON_IDEMPOTENT` 或 `IDEMPOTENT`。缺省值为 `NON_IDEMPOTENT`。

理由：core contracts 已使用 replay policy enum；enum 比 boolean 更适合后续扩展，同时避免 runtime guard 读取两套字段。

拒绝方案：保留 `isIdempotent` boolean。拒绝原因是它会和 `CapabilityReplayPolicy` 重复，表达力不足，并让 recovery guard 的判断依据变得不唯一。

### D2: Stable key 只作为 invocation request 输入，不定义独立 validator/cache

选定方案：`CapabilityInvocationRequest.idempotencyKey?` 是 runtime 提供给 capability/provider 的稳定调用 key。稳定 key 由 `agent-common` 的 `deriveCapabilityInvocationIdempotencyKey(runId, toolCallId)` 提供，格式为 `${runId}:${toolCallId}`。`agent-core` 在普通 capability 调用时使用该 helper（[tool-loop.ts](/packages/agent-core/src/tools/tool-loop.ts:98)），`agent-runtime` recovery guard 注入同一 helper 作为 `resolveStableIdempotencyKey`（[submit.ts](/packages/agent-runtime/src/lifecycle/submit.ts:814)）。provider 可以内部使用该 key 实现去重或幂等，但本 change 不定义公共 cache/validator 系统。

理由：本阶段需要解决的是“能否重放”和“用什么 key 关联同一重放”，不是定义跨 provider 存储系统。把 validator/cache 做成 public SPI 会扩大 scope，并与 gateway/persistence ownership 冲突。

拒绝方案：定义 `IdempotencyValidator`、duplicate cache 和 RETURN_CACHED 策略。拒绝原因是它把实现存储策略、缓存结果安全和重复调用结果语义过早固化。

### D3: Runtime 决定何时使用 key，Provider 保证 key 下语义

选定方案：runtime/recovery/retry 根据 request lifecycle 和 replay policy 判断是否传入 idempotency key。capability provider 只保证当 descriptor 声明 `IDEMPOTENT` 且收到同一 key 时，重复调用不会产生第二次不可逆 side effect。

理由：runtime 拥有 retry/recovery lifecycle，provider 拥有外部 side effect 实现细节。两者职责分开才能保持边界清晰。

拒绝方案：让 provider 决定某次调用是否来自 recovery/retry。拒绝原因是 provider 不应依赖 runtime lifecycle 标志，也看不到 checkpoint/message/terminal facts。

### D4: Key 原文禁止进入可观测和用户可见面

选定方案：日志、trace、audit、stream、safe error 和 provider metadata 不得包含 idempotency key 原文；需要关联时只能使用 hash、truncated 或稳定 correlation id。

理由：key 可能包含 request/run/capability 关联信息或外部系统操作标识，属于需要脱敏的诊断字段。

拒绝方案：日志中直接记录 key 便于排障。拒绝原因是它会突破 redaction 和 safe error 边界。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 默认非幂等，fail closed；key 原文脱敏；provider 不从 arguments 或 metadata 接收 replay 信号。 | descriptor contract tests；redaction tests；code review。 |
| 性能/容量 | 无通用 duplicate cache 或全局存储；普通 invocation 只携带可选 key，不增加全局查询。 | unit tests；code review 检查无新增 cache SPI。 |
| 可靠性/恢复 | runtime recovery/retry 只允许显式 `IDEMPOTENT` Tool 重放；key 稳定性由 runtime/calling flow 保证。 | recovery guard integration tests；retry policy tests。 |
| 可维护性 | 单一 enum contract 替代 boolean/declaration/validator 多套概念。 | OpenSpec validation；rg 检查 `isIdempotent` 不作为 public contract。 |
| 可测试性 | replay policy、默认值、key 传递和 redaction 都可用 deterministic unit/contract tests 覆盖。 | capability descriptor and invocation request tests。 |
| 审计/可追溯性 | 可记录 replay policy、capabilityId、toolCallId、hashed key correlation；不得记录 key 原文。 | observability/redaction tests。 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| descriptor 使用 `CapabilityReplayPolicy` 且默认 `NON_IDEMPOTENT` | 1.1, 2.1 | descriptor contract tests |
| 不使用 `isIdempotent` / `IdempotencyDeclaration` | 1.2, 3.1 | `rg` 检查和 OpenSpec review |
| invocation request 支持可选 stable `idempotencyKey` | 1.3, 2.2 | schema/type tests |
| 只有 `IDEMPOTENT` Tool 可被 recovery/retry 重放 | 2.3 | runtime integration tests |
| key 原文不得泄露 | 3.1 | redaction tests |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/idempotency-contract/spec.md`。
- API/SPI/event/schema：`openspec/designs/contracts/core-contracts.md` 主承载 `CapabilityReplayPolicy` 和 `CapabilityInvocationRequest.idempotencyKey?`。
- 模块职责：`openspec/designs/modules/agent-capability.md` 主承载 descriptor/provider 责任；`openspec/designs/modules/agent-runtime.md` 主承载 runtime 何时传 key。
- ADR：`openspec/designs/adr/capability-replay-policy.md` 主承载 enum policy 替代 boolean/declaration 的取舍。
- 导航：`openspec/designs/spec-to-design-map.md`。

## 风险与取舍（Risks / Trade-offs）

- [不定义通用 cache 可能让 provider 实现差异变大] -> 首版只定义跨边界安全契约；provider 内部实现由 provider 自测和 capability governance 约束。
- [稳定 key 格式] -> 稳定 key 由 `deriveCapabilityInvocationIdempotencyKey()` 提供；`agent-core` 和 `agent-runtime` recovery guard 已共用同一 helper，不再需要跨 change 格式对齐。
- [并行契约造成误读] -> tasks 中加入 `rg` 检查，实施前必须确认 `isIdempotent` / `IdempotencyDeclaration` 不作为 public contract 出现。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/idempotency-contract/spec.md`：提炼 replay policy、stable key、默认非幂等和 redaction 行为。
- `openspec/overview.md`：补充 side-effect idempotency 对恢复/重试安全的长期意义。
- `openspec/designs/contracts/core-contracts.md`：提炼 `CapabilityReplayPolicy` 和 `CapabilityInvocationRequest.idempotencyKey?`。
- `openspec/designs/modules/agent-capability.md`：提炼 descriptor replay policy 和 provider 责任。
- `openspec/designs/modules/agent-runtime.md`：提炼 runtime key 传递和 replay decision 消费关系。
- `openspec/designs/adr/capability-replay-policy.md`：记录 enum policy 取舍。
- `openspec/designs/spec-to-design-map.md`：增加导航。

## 待确认问题（Open Questions）

无。已确认：不使用 `isIdempotent`；runtime/recovery guard 使用 `CapabilityReplayPolicy`。
