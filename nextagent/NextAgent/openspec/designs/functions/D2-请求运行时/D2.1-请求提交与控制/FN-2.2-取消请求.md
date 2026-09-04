# FN-2.2 取消请求

> 能力域 D2 请求运行时 · 子域 [D2.1 请求提交与控制](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-2.2](../../../features/D2-请求运行时/D2.1-请求提交与控制/F-2.2-取消请求.md) |
| spec | `request-cancel` |
| 接口 | `POST /api/v1/sessions/:sessionId/cancel` |

## 描述

取消当前会话中最新进行中的请求，级联中止相关处理，产生权威取消终态。

## 前置条件

- 用户已登录。
- 目标会话属于当前用户和智能体。
- 存在进行中的最新请求（已受理、排队或执行中）。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| sessionId | 是 | 会话标识 |
| expectedLatestRequestId | 是 | 期望的最新请求标识 |
| idempotencyKey | 是 | 幂等键，非空 |

## 输出

```json
{
  "sessionId": "sess_123",
  "targetRequestId": "req_1",
  "action": "CANCEL",
  "idempotencyKey": "idem-cancel-001"
}
```

## 处理过程

1. 校验身份、归属和最新请求标识匹配。
2. 校验请求可取消（已受理、排队或执行中）。
3. 通过中止信号级联传播到模型、工具、技能和子智能体。
4. 提交取消终态，产生取消事件。终端 content 选择规则：有流式正文内容时保留 `finalContent`，无流式正文内容时统一使用固定中性占位字符串 `'Request canceled by user.'`；MUST NOT 使用 `safeErrorContent`、`AgentError.message` 或任何执行阶段特定的错误描述作为终端 content。catch 路径与正常返回路径使用相同 fallback。该规则对所有执行阶段（模型调用、capability 执行、routing、sandbox、lifecycle hook、memory 等）一致成立。
5. cancel 终端提交使用与原始请求相同的 `requestContextId`，MUST NOT 为 cancel 操作生成新的 `requestContextId`；执行中 run 的 catch 路径和非执行中 run（pending input / queued）的 `commitCanceledRun` 路径一致。前端 conversation store 依赖 `requestContextId` 作为 `attemptId` 做 bucket 匹配，identity 不一致会导致终端事件被拒绝、run 状态无法收束。
6. 取消后的延迟输出不改变终态，不作为最终结果。

## 结果

- 正常：取消成功，产生取消终态。
- 非最新请求：安全拒绝。
- 已结束请求：安全拒绝。
- 终态待定：不接收第二次取消。
- 幂等重复：返回首次结果。
- 幂等键冲突：安全拒绝。

## 规格

| 规格项 | 规格值 | Requirement source |
|---|---|---|
| 取消可见时延 | <= 1,000 ms | `request-cancel` / `Canceled terminal visibility 和 lane release`（建议评审值） |
| Cancel 终端 content 选择 | 有流式正文时保留 `finalContent`；无流式正文时统一为 `'Request canceled by user.'`；MUST NOT 使用 `safeErrorContent` 或执行阶段错误描述；catch 路径与正常返回路径同策 | `request-cancel` / `Canceled run 终端 content 不得包含内部错误消息` |
| Cancel 终端事件 requestContextId | 使用原始请求的 `requestContextId`，MUST NOT 为 cancel 生成新 ID；catch 路径和 `commitCanceledRun` 路径一致 | `request-cancel` / `Cancel 终端事件 requestContextId 与原始请求一致` |
