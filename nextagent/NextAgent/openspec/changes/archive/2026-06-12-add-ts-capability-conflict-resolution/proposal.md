## 背景与问题（Why）

`add-ts-capability-core-governance` 已经建立了 capability 治理骨架：预留了单一冲突解决扩展点，供 eager 注册和未来 search 结果合并复用。该骨架没有定义：

- 冲突检测的详细算法（进入 request-scope 可见/可执行 catalog view 前检测，而不是运行时 dispatch 时检测）
- 冲突发生时系统如何记录和传播诊断信息
- higher priority capability 如何替代 lower priority capability
- 冲突安全失败和安全诊断如何被 catalog / invocation 路径消费
- Skill capability 的 duplicate、conflict 和 shadowing 解析规则

## 变更范围（What Changes）

- **新增** `add-ts-capability-conflict-resolution` change
- **新增** `agent-capability` 内部冲突检测逻辑：识别 duplicate、same-scope conflict 和 cross-scope shadowing
- **新增** `agent-capability` 内部冲突解决逻辑：同作用域冲突拒绝，不同作用域 shadowing 可解释
- **新增** 内部冲突诊断 read model：仅用于安全诊断、测试和 catalog 装配解释
- **新增** Skill capability 的 duplicate、same-scope conflict、cross-scope shadowing 和安全诊断约束
- **补充** `add-ts-capability-core-governance` 的 capability-catalog spec：冲突解决章节

## Capability 影响（Capabilities）

### 新增的内部实现接口
- `agent-capability` - 新增内部 conflict detection/resolution 接口、场景结构、诊断结构和 resolution vocabulary；这些对象不进入 public exports。

### 契约边界说明
- 本 change 不新增 `agent-contracts` public SPI、DTO 或 enum。
- 冲突检测/解决接口、冲突场景、诊断结构和 resolution vocabulary 均为 `agent-capability` 内部实现细节，不重命名或修改已冻结的 `CapabilityDescriptor`、`CapabilityCatalog`、`CapabilityInvocationRequest`、`CapabilityInvocationResult` 等契约字段。

## 影响范围（Impact）

- `packages/agent-contracts` - 无修改
- `packages/agent-capability` - 内部冲突检测/解决默认实现与 catalog 可见/可执行 view 集成
- `packages/agent-core` / invocation 消费路径 - 通过 catalog resolve 的安全失败结果消费冲突裁决，不拥有冲突决策

## 主要 Owner

- Owner 9 Tool Capability

## 非目标（Non-Goals）

- 不定义跨平台的 capability 兼容或搬移策略
- 不定义 capability 版本升级时的冲突处理
- 不定义运行时动态 capability 的冲突解决（首版只支持 request-scope catalog view 构建时的静态候选检测）
- 不定义 Skill source layout、manifest parsing、discovery lifecycle 或 capability execution semantics；本 change 只处理已经 assembled 的 capability candidates
