# 优化 Sandbox 拒绝 Safe Error 设计

## 设计范围（Design Scope）

- Function：`FN-Sandbox Runtime`
- Canonical spec：`openspec/specs/sandbox-runtime/spec.md`
- 目标：把 sandbox 治理拒绝保留为可采取行动的失败，同时让真正的 sandbox 启动失败保持 unavailable。

## FN-Sandbox Runtime

### 目标与规范依据

目标 Requirement 是 `Sandbox Failure And Resource Limits Are Explicit`。sandbox 失败必须保持安全且显式，不支持的 Python 调用形态必须给模型一条纠正路径，而不是通用的 unavailable 信号。

### 当前实现

本地 sandbox adapter 已经检测治理拒绝，并把详细原因存入 `safeDetails.reason`。外层 safe error code 对治理拒绝和真正的启动失败仍可能都使用 unavailable code。capability 映射随后把其余 unavailable 的 sandbox 失败折叠为 `SANDBOX_UNAVAILABLE`，除非原因已被其他授权映射处理。

### GAP 分析

可观察的失败类别并不总能告诉模型下一步应该是稍后重试还是修改输入。不支持的 Python 调用是确定性的输入反馈，不是平台不可用。

### 修改方案

- 当 adapter 因已知治理原因拒绝请求时，local gateway 返回 `PYTHON_EXECUTION_REJECTED` 或 `BASH_EXECUTION_REJECTED`。
- 对真正的 adapter 启动或平台不可用，保留 `PYTHON_EXECUTION_UNAVAILABLE` 或 `BASH_EXECUTION_UNAVAILABLE`。
- 在 capability 边界把 `unsupported-python-invocation` 映射为 `CAPABILITY_INPUT_INVALID`，并附带安全的纠正提示。
- 对路径拒绝和被拒绝的可执行文件治理原因，保留既有映射。

### 质量属性影响

- 可靠性/恢复：确定性的非法调用失败引导模型纠正，而不是反复以 unavailable 重试。
- 可诊断性：gateway safe error code 区分被拒绝的请求与不可用的执行。
- 安全：不支持的调用形态仍被拒绝；本 change 只改进安全分类和提示。

## 长期基线刷新计划（Baseline Promotion Plan）

- 归档时更新 `openspec/specs/sandbox-runtime/spec.md`，纳入细化后的拒绝/不可用区分。
- 除目标 stable spec 外，不需要刷新 Function、Feature、architecture、module、ADR 或 spec-to-design-map。
