# FN-4.2 模型失败降级

> 能力域 D4 模型与上下文 · 子域 [D4.1 模型调用与降级](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-4.2](../../../features/D4-模型与上下文/D4.1-模型调用与降级/F-4.2-模型失败降级.md) |
| 主规格 | `model-fallback-semantics` |
| 遗留规格 | `routing-evidence-and-fallback` |
| 接口 | 系统内部，主链路触发 |

## 描述

模型调用失败时，系统评估备选模型并切换继续处理，记录降级证据。

## 前置条件

- 模型调用失败。
- 存在可用的备选模型。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 失败结果 | 是 | 模型调用的失败信息 |
| 候选模型 | 是 | 可用的备选模型列表 |

## 输出

降级决策和降级证据。

## 处理过程

1. 系统根据安全错误、重试状态和已发布的流式增量判断是否允许跨模型降级。
2. 系统从当前 Agent 可用模型中选择下一个符合策略的 `modelId`。
3. 系统按新模型的上下文窗口与提示词兼容性重新计算输入，再继续处理。
4. 记录降级证据。

## 结果

- 正常：降级到备选模型，继续处理。
- 无可用备选：失败终态。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 降级触发 | 当前模型的同模型重试耗尽或不适用后显式评估，不自动切换模型 | `model-fallback-semantics`：`Fallback is not owned by the model invocation boundary`、`Agent-model must not perform implicit cross-profile fallback` |
| 备选模型范围 | 当前 Agent 已激活、`AVAILABLE`、`fallbackEligible=true` 且尚未尝试的模型 | `model-fallback-semantics`：`Agent Core orchestrates model fallback explicitly` |
| 再次尝试门禁 | 已产生用户可见输出、请求已终止或取消、预算不足或状态事实不完整时禁止降级重试 | `model-fallback-semantics`：`Agent Core orchestrates model fallback explicitly` |
