# FN-3.4 工具循环失败保护

> 能力域 D3 Agent 装配与主链路 · 子域 [D3.2 智能体协同与保护](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 覆盖特性 | [F-3.3](../../../features/D3-Agent装配与主链路/D3.2-智能体协同与保护/F-3.3-工具循环失败保护.md) |
| 主规格 | `tool-loop` |
| 接口 | 系统内部，工具循环执行时触发 |

## 描述

Agent 将所有非取消 Capability 最终失败交给模型决策，以 `maxTurns` 作为唯一 loop-count 上限，以 `maxToolCallsPerTurn` 接纳每轮有序 Tool-call 前缀，并在普通轮次耗尽后提供一次无 Tool 执行权的模型收尾。

## 前置条件

- 请求正在执行工具循环。

## 输入

最终 `CapabilityInvocationResult`、模型返回的有序 Tool calls、accepted assembly limits 和显式生命周期控制事实。

## 输出

与 tool-use 配对的安全结果、超限省略反馈、模型最终答复或真实失败/取消终态。

## 处理过程

1. 每个 normal turn 只保存并治理 `maxToolCallsPerTurn` 内的有序前缀；尾部不保存、不执行、不生成 synthetic result。
2. 每个非取消最终失败以完整安全 `CAPABILITY_RESULT` 反馈模型；普通 `AUTHORIZATION` 错误不创建 pending input，只有显式 `REQUIRE_AUTHORIZATION` 控制进入授权生命周期。
3. 重复失败、空 Tool 名称和连续超限只产生可修正反馈，不建立 fingerprint、局部计数或终止阈值。
4. 模型结束、显式控制或取消按真实语义收敛；达到 `maxTurns` 后保留 Tool descriptors、强制 `toolChoice=NONE` 并只调用模型一次，任何返回 Tool call 均零执行。

## 结果

- 普通循环：模型基于完整安全事实选择下一动作。
- 达到普通轮次上限：最多一次 finalizing turn；有可用文本则正常完成，否则保持真实失败或取消。
- 单轮 Tool calls 超限：接纳前缀闭合后反馈 requested/admitted/omitted counts，继续普通循环。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 局部纠正阈值 | 无重复失败、空 Tool 名称或 Tool-call 超限终止阈值；安全反馈继续进入普通 Agent loop | `tool-loop`：`Agent loop 对最终 Capability 失败执行唯一处置`、`空 Tool 名称只产生可修正反馈` |
| 普通轮次上限后的收尾 | 达到 accepted `maxTurns` 后追加且仅追加一次保留 Tool descriptors、但无 Tool 执行权的模型收尾 | `tool-loop`：`maxTurns 达到上限后只执行一次无工具模型收尾` |
| 单轮 Tool call 接纳 | 每个 normal turn 只接纳 accepted `maxToolCallsPerTurn` 内的顺序前缀；尾部不保存、不执行并反馈模型拆分 | `tool-loop`：`maxToolCallsPerTurn 只接纳有界 Tool call 前缀` |
