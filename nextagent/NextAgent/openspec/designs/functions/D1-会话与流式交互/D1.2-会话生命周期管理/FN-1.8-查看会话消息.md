# FN-1.8 查看会话消息

> 能力域 D1 会话与流式交互 · 子域 [D1.2 会话生命周期管理](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-1.4](../../../features/D1-会话与流式交互/D1.2-会话生命周期管理/F-1.4-查看会话内容.md) |
| spec | `session-conversation-preview` |
| 接口 | `GET /api/v1/sessions/:sessionId/conversation` |

## 描述

读取会话历史消息，支持向历史方向翻页、向新消息方向加载，以及按锚点定位特定消息。

## 前置条件

- 用户已登录。
- 目标会话属于当前用户和智能体。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| sessionId | 是 | 会话 ID |
| limit | 否 | 分页大小，默认 50 |
| cursor | 否 | 向历史方向翻页的游标 |
| newerCursor | 否 | 向新消息方向加载的游标 |
| anchorMessageId | 否 | 锚点消息 ID，定位到特定消息 |
| includeCapabilityResults | 否 | 为 "true" 时包含能力调用结果 |

## 输出

```json
{
  "items": [
    {
      "messageId": "msg_1",
      "role": "USER",
      "sequence": 1,
      "content": "分析小区掉话率升高原因",
      "contentType": "TEXT",
      "createdAt": 1719878400000,
      "visible": true
    }
  ],
  "nextCursor": "msg_1",
  "newerCursor": "msg_9",
  "activeRun": {
    "requestId": "req_2",
    "runId": "run_2",
    "status": "RUNNING"
  }
}
```

## 处理过程

1. 系统校验会话归属。
2. 默认返回最近可见消息窗口。
3. 带 cursor 向历史方向翻页，带 newerCursor 加载更新消息。
4. 带 anchorMessageId 时定位到特定消息。
5. 若存在活动请求，返回活动请求信息。
6. preview 路由对 `offset`/`limit` 执行字段级校验：缺失 `limit` 返回 `limit is required.`；非整数返回 `{field} must be an integer.`；超有限安全整数返回 `{field} must be a finite safe integer.`；负 `offset` 返回 `offset must be a non-negative integer.`；`limit` 不在 1..500 返回 `limit must be between 1 and 500.`；额外参数返回 `Conversation preview only supports offset and limit query parameters.`。合法前导零正整数（如 `limit=01`）按整数值处理。校验失败统一返回 HTTP 400 + `REQUEST_VALIDATION_FAILED`。

## 结果

- 正常：返回消息列表、翻页游标和活动请求信息。
- 会话不存在或不属于当前用户：安全拒绝。
- preview 校验失败：返回 HTTP 400 + `REQUEST_VALIDATION_FAILED` 与字段级确定消息；`limit=01` 等合法前导零正整数成功并等同整数 `1`。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 默认分页大小 | 50 条消息 | `session-conversation-preview` |
| preview limit 上限 | 500 | `session-conversation-preview` |
| preview 校验失败消息 | 缺失/非整数/负数/越界/额外参数返回确定字段级消息，HTTP 400 + `REQUEST_VALIDATION_FAILED` | `session-conversation-preview`：`会话预览查询校验返回确定字段级结果` |
| 前导零正整数 limit | 合法前导零正整数（如 `limit=01`）按整数值处理并返回成功 | `session-conversation-preview`：`会话预览查询校验返回确定字段级结果` |
