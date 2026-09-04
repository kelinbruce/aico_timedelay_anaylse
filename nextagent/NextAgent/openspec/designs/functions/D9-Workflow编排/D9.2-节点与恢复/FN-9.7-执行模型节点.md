# FN-9.7 执行模型节点

> 能力域 D9 Workflow 编排 · 子域 [D9.2 节点与恢复](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 覆盖特性 | [F-9.2](../../../features/D9-Workflow编排/D9.2-节点与恢复/F-9.2-工作流节点.md) |
| 主规格 | `workflow-llm-nodes` |
| 接口 | 系统内部，节点处理器 |

## 描述

执行模型节点，调用模型完成推理；`DATA_ANALYSIS` 的可选 Python Capability 子调用与其他 Workflow Capability 调用遵守同一最终失败处置。

## 前置条件

- 工作流正在执行。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 节点定义 | 是 | 模型节点定义 |
| 节点输入 | 是 | 节点输入数据 |

## 输出

节点执行结果（模型推理输出）。

## 处理过程

1. 节点处理器装配模型输入。
2. `modelParamsInferenceOptions` 处理节点 `inputs.model_params`：剥离 `enable_thinking`（boolean）并转换为 `thinking.depth`（`true` -> `"HIGH"`、`false` -> `"OFF"`、absent 或非 boolean 不产生 `thinking` 配置），其余字段（包括 temperature、top_p、max_tokens 等）放入单一 opaque `modelParams` `JsonObject`；无剩余字段时不设置 `modelParams`，`model_params` 缺失或非对象时返回 `undefined`。
3. 调用模型完成推理。`mergeModelInferenceOptions` 浅合并 `providerOptions`（override 的 top-level key 替换 base 同名 key，base 独有 key 保留），`modelParams` 由 override 整体替换 base（不合并）。
4. `DATA_ANALYSIS` 如调用 Python Capability，则保留最终 `safeError` 并上升，不因最终失败重跑整个模型节点；未装配该边界时保持 model-only 结果。
5. 输出经安全处理，经状态接口与运行时协作，返回结果。

## 结果

- 正常：节点执行完成。
- 失败：安全失败。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| Python 子调用最终失败 | 进入显式 exception，取消直接结束；不得自动重新执行整个模型节点 | `workflow-llm-nodes`：`DATA_ANALYSIS Python 子调用遵守统一失败处置` |
| model_params 透传 | `modelParamsInferenceOptions` 只剥离 `enable_thinking` 转为 `thinking.depth`，其余字段作为 opaque `modelParams` 透传；`model_params` 缺失或非对象时返回 `undefined` | `workflow-llm-nodes`：`Shared LLM Node Execution` |
| 推理选项合并 | `mergeModelInferenceOptions` 浅合并 `providerOptions`（保留 base 独有 key），`modelParams` override 整体替换 base | `workflow-llm-nodes`：`Shared LLM Node Execution` |
