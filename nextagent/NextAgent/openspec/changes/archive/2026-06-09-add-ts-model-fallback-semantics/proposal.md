## 背景与问题（Why）

模型失败后的后续处理不能被藏在 provider adapter 内部。当前最关键的问题是：

- 是否继续尝试其他 profile 不能由 provider adapter 自己决定
- 当前 change 落地前，失败后必须 fail closed，而不是提前实现一套不完整 fallback

这个 change 的目标是澄清 model 层与 orchestration 层的 fallback 边界：当前只冻结 `agent-model` 不隐式切 profile 的行为；真正的 decision/evidence 归口到后续 routing/orchestration change。

## 变更范围（What Changes）

- 保留 change 名称，但改为说明模型访问失败后的 fallback 边界约束。
- 明确 `agent-model` 不得在 invocation 内部做隐式 cross-profile fallback。
- 明确在上层 fallback orchestration 落地前，当前 profile 失败后运行时 fail closed。
- 明确 fallback 评估、已产生用户可见输出后的 replay gate、routing/fallback evidence 均由后续 routing evidence / orchestration change 承接。

## Capability 影响（Capabilities）

### 修改的 Capability
- `model-fallback-semantics`: 从 model-owned fallback contract 调整为 model/runtime/core 之间的边界澄清。
- `add-ts-routing-evidence-and-fallback`: 承接真正的 decision evidence 和审计语义。

## 影响范围（Impact）

- 受影响模块：
  - `modules/agent-model`
  - `tests/contract`

## 已知遗留事项（Deferred Work）

本 change 只冻结 fallback 边界，不宣称以下上层编排能力已经落地：

1. `agent-core` 备用 profile 评估与切换：当前 profile 返回 `SafeError` 后，基于 `modelProfileRegistry` 的 fallback-eligible selector、request/run/step 状态和安全失败事实决定是否选择下一候选，并在允许时重新发起模型调用。
2. fallback 决策安全闭环：在已有用户可见输出时显式阻断同一步骤 silent replay；无论执行切换、拒绝切换还是没有候选，都按 routing evidence contract 记录 decision、selected path 或 rejection evidence。

以上遗留事项必须由后续 `agent-core` orchestration / routing evidence change 承接，不得下沉到 `agent-model` provider adapter。

## 归档前基线提升计划（Baseline Promotion Plan）

行为契约：
- `openspec/specs/model-fallback-semantics/spec.md`：新增，描述边界约束

设计视图：
- `openspec/designs/architecture/context-engine-and-model-routing.md`
- `openspec/designs/architecture/observability-and-diagnostics.md`
- `openspec/designs/spec-to-design-map.md`

验证入口：
- fallback boundary contract tests
