# workflow-llm-nodes Delta Specification

所属 Function：`FN-9.7 执行模型节点`

Function 变更类型：修改

spec 角色：主规格

## ADDED Requirements

### Requirement: DATA_ANALYSIS Python 子调用遵守统一失败处置

`DATA_ANALYSIS` 节点装配 Python Capability boundary 时，Python 子调用 MUST 使用可信 descriptor 和统一 `CapabilityInvocationResult`。`SUCCEEDED` 和合法 `DEGRADED` MUST 产生声明的数据分析结果；最终非取消 `FAILED` 或 `TIMED_OUT` MUST 保留 `safeError` 并上升为当前节点失败；`safeError.category=CANCELED` MUST 立即传播取消。

`DATA_ANALYSIS` 节点和 Workflow engine MUST NOT 因 Python Capability 最终失败而重新执行整个节点。节点声明的 retry 次数 MUST 通过 `CapabilityInvocationRequest.maxRetries` 约束 Python 子调用内部的额外 attempt 上限；未配置节点或 Recipe retry 时 MUST 使用 Capability 默认值 `1`。统一调用边界内部已经执行的安全瞬态重试是该子调用唯一的自动重试。

Python Capability boundary 完全未装配时，节点 MUST 只执行 model-only 路径；该路径未发生 Capability 调用，不得合成 Capability `safeError`。

**需求类别**：功能性需求

#### Scenario: Python 子调用最终失败

- **WHEN** `DATA_ANALYSIS` 的 Python Capability 返回最终 `FAILED`
- **THEN** 节点 MUST 保留该 Capability 的 `safeError`
- **AND** 节点 MUST 把失败交给 Workflow engine 求值显式 exception
- **AND** Workflow MUST NOT 自动重新执行整个 `DATA_ANALYSIS` 节点

#### Scenario: Python 子调用取消

- **WHEN** Python Capability 返回 `FAILED + safeError.category=CANCELED`
- **THEN** 节点 MUST 立即传播取消
- **AND** 节点 MUST NOT 求值 exception

#### Scenario: 未装配 Python boundary

- **WHEN** `DATA_ANALYSIS` 没有装配 Python Capability boundary
- **THEN** 节点 MUST 按 model-only 路径执行
- **AND** 系统 MUST NOT 创建伪造的 `CapabilityInvocationResult`

## Function 变更汇总

### 描述

- 变更类型：修改
- 目标内容：`DATA_ANALYSIS` 可选 Python 子调用与其他 Workflow Capability 调用遵守同一最终失败契约。
- 依据 Requirements：`DATA_ANALYSIS Python 子调用遵守统一失败处置`

### 输出

- 变更类型：修改
- 目标内容：Python 子调用失败保留安全 `safeError` 并上升，未装配 boundary 时保持 model-only 结果。
- 依据 Requirements：`DATA_ANALYSIS Python 子调用遵守统一失败处置`

### 处理过程

- 变更类型：修改
- 目标内容：系统不因 Python Capability 最终失败自动重新执行整个模型节点。
- 依据 Requirements：`DATA_ANALYSIS Python 子调用遵守统一失败处置`

### 结果

- 变更类型：修改
- 目标内容：数据分析 Capability 失败进入显式 exception，取消直接结束，正常 model-only 路径不受影响。
- 依据 Requirements：`DATA_ANALYSIS Python 子调用遵守统一失败处置`
