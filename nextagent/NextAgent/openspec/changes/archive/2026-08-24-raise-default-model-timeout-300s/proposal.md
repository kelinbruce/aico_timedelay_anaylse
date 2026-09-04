## Why

使用内置默认模型配置的运维人员和评测系统在复杂电信网络任务中会遇到单次模型响应超过 120 秒并触发 `MODEL_TIMEOUT`，任务在能够形成有效结果前失败。评测证据显示该边界会显著降低复杂、多轮任务的完成率，因此需要扩大产品内置 profile 的默认等待窗口，同时保留部署方按模型覆盖超时的能力。

规范上下文：

- 本 change 只修改内置默认模型 profile 的显式 `timeoutMs`，目标值为 `300000 ms`。
- `ModelProfile.timeoutMs` 缺失时的固定 schema fallback 仍为 `30000 ms`。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 使用内置默认系统配置时，单次逻辑模型调用获得 300 秒的显式超时窗口。
- 发布配置样例、配置解析结果和用户可见限制说明对该默认值保持一致。
- 用户显式配置的模型超时继续覆盖内置默认值。

**非目标：**

- 不增加自适应超时、模型超时后的 Agent 级重试或新的失败降级语义。
- 不修改请求总预算、provider 重试次数或 `timeoutMs` 缺失时的固定 schema fallback。

## What Changes

- 将内置默认模型 profile 的显式 `timeoutMs` 从 `120000 ms` 修改为 `300000 ms`。
- 修改默认配置的黑盒契约，使配置解析和发布产物均可观察到 `300000 ms`。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-4.1 调用模型` → `specs/model-invocation-contract/spec.md`
  - 功能边界：内置默认系统配置选择模型时使用的显式单次逻辑调用超时从 120 秒调整为 300 秒；显式部署覆盖和缺失字段 fallback 不变。
  - 系统质量属性：可靠性/恢复、可测试性。
  - 映射说明：canonical spec。

## 影响范围（Impact）

- 未覆盖默认值的部署将允许模型调用等待更长时间，降低慢模型在复杂任务中的误超时概率，同时可能延长真实上游无响应时的失败确认时间。
- 默认配置、发布产物、配置 contract tests 和用户配置说明需要同步。
