# FN-4.3 装配上下文

> 能力域 D4 模型与上下文 · 子域 [D4.2 上下文管理与压缩](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 覆盖特性 | [F-4.3](../../../features/D4-模型与上下文/D4.2-上下文管理与压缩/F-4.3-自动管理上下文窗口.md) |
| 主规格 | `context-engine` |
| 遗留规格 | `context-token-estimator`、`context-assembly-contracts` |
| 接口 | 系统内部，上下文装配服务 |

## 描述

系统选择历史消息并计算上下文预算，渲染模型输入。

## 前置条件

- 请求已进入上下文装配阶段。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 请求 | 是 | 当前请求 |
| 会话 | 是 | 会话标识 |
| 活动上下文 | 是 | 当前活动上下文 |

## 输出

装配后的上下文、effective provider-neutral model options、保留的 Tool descriptors 和预算证据。

## 处理过程

1. 系统根据已接受请求所绑定的 Agent 配置执行初始模型选择或降级模型选择。
2. 使用所选模型的有效上下文窗口计算预算，确保历史不超过模型窗口的 60%。
3. 保护当前请求的最小安全上下文；fallback 时按新模型重新装配。
4. 按 profile、Prompt Template、governed Capability patch、trusted request 和 Hook 的固定优先级逐字段合并 `toolChoice` 等选项。
5. model-only 与 finalizing 使用 effective `toolChoice=NONE`，但不清空 Tool descriptors；完成模型输入渲染。
6. 按 `requestId` 边界分组 prior conversation 时，对每个 raw unit 先从具有 `metadata.visibility.reason="RETRY_REPLACED"` 且 `runId` 已定义的非 USER message 收集被替换 run，排除该 unit 内所有属于这些 run 的非 USER messages（含 Retry 前已 `visible=false` 且无 replacement reason 的 assistant tool-use），缺少 `runId` 的 marker 只排除自身；再对剩余消息验证完整有序的 tool-use / capability-result 序列和 terminal assistant response。不按时间、run 顺序或 `runId` 值猜测 latest attempt；非 `RETRY_REPLACED` 的其他 hidden reason 和不完整协议继续整体排除。

## 结果

- 正常：上下文装配成功。
- 预算不足：降级或显式失败。
- Retry 后的完整 prior turn 由原始用户问题和最新有效 attempt 组成，旧 attempt 不进入普通模型上下文；最新 attempt 不完整时该轮次不作为 history candidate。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 模型候选范围 | 仅当前 Agent 已激活、`AVAILABLE` 且与 Prompt/Capability 兼容的模型；降级时还须可降级且尚未尝试 | `context-engine`：`Model selection uses Agent-activated model configurations`、`Fallback selection recomputes model-specific context` |
| 历史上下文预算 | 每次 initial/fallback selection 最多占所选模型 `contextWindowTokens` 的 60% | `context-engine`：`上下文预算使用所选模型的已解析窗口` |
| 当前请求保护 | 必须保留最小安全当前请求上下文，不得为了满足历史预算静默丢弃 | `context-engine`：`Context Engine protects minimum safe current-request context` |
| Retry 后历史选择 | 保留原始用户问题和最新完整可见 attempt；排除全部 `RETRY_REPLACED` 旧输出（含无 replacement reason 的 hidden assistant tool-use）；具有其他 visibility reason 的 replacement message 和不完整 Tool protocol 不恢复为有效轮次 | `context-engine`：`Prior conversation preserves valid conversation boundaries` |
