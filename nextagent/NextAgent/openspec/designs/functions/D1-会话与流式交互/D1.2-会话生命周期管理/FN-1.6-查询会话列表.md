# FN-1.6 查询会话列表

> 能力域 D1 会话与流式交互 · 子域 [D1.2 会话生命周期管理](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-1.3](../../../features/D1-会话与流式交互/D1.2-会话生命周期管理/F-1.3-管理会话.md) |
| spec | `session-history-search` |
| 接口 | `GET /api/v1/sessions` |

## 描述

查询当前用户和智能体归属下的会话列表，支持分页和按关键词搜索。

## 前置条件

- 用户已登录。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| offset | 否 | 分页偏移，默认 0 |
| limit | 否 | 分页大小，普通列表默认 50，搜索默认 20 最大 50 |
| q | 否 | 搜索关键词 |
| createdFrom | 否 | 起始时间，须与 createdTo 同时提供 |
| createdTo | 否 | 结束时间，须大于等于 createdFrom |

## 输出

```json
{
  "entries": [
    {
      "sessionId": "sess_123",
      "displayTitle": "基站故障诊断",
      "lastActivityAt": 1719878400000,
      "lastRunStatus": "COMPLETED",
      "hasInFlightRequest": false
    }
  ],
  "offset": 0,
  "limit": 50,
  "hasMore": false
}
```

## 处理过程

1. 系统按当前用户归属和智能体归属过滤。
2. 不带搜索词：返回会话列表，按最后活动时间排序。
3. 带搜索词：按关键词和时间范围过滤匹配的会话。
4. 路由 parser 对时间范围和分页参数执行字段级校验，产出与权威 API 文档一致的确定消息：`createdFrom`/`createdTo` 仅提供一个返回 `createdFrom and createdTo must be provided together.`；非整数返回 `{field} must be an integer.`；超有限安全整数返回 `{field} must be a finite safe integer.`；`createdFrom` 大于 `createdTo` 返回 `createdFrom must be less than or equal to createdTo.`；超过 90 天返回 `created time range must not exceed 90 days.`；负 `offset` 返回 `offset must be a non-negative integer.`；非正 `limit` 返回 `limit must be a positive integer.`；搜索 `limit` 大于 50 返回 `search limit must not exceed 50.`；普通 `limit` 大于 200 返回 `limit must not exceed 200.`。校验失败统一返回 HTTP 400 + `REQUEST_VALIDATION_FAILED`。

## 结果

- 正常：返回会话列表和分页信息。
- 搜索条件无效：安全失败（HTTP 400 + `REQUEST_VALIDATION_FAILED` 与字段级确定消息）。
- 可安全表示为有限安全整数的前导零或较长整数串（如 `limit=01`、超 13 位的 `createdFrom`）按整数值接受，不被字符形状约束误拒绝。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 普通列表默认分页 | 50 | `session-history-search` |
| 搜索默认分页/上限 | 20 / 50 | `session-history-search` |
| 搜索词长度 | trim 后非空且不超过 50 个 Unicode code point；无 ASCII/非 ASCII 最小长度限制 | `session-history-search`：`搜索查询保持 scope 隔离和安全校验` |
| 时间范围上限 | 90 天（90 天减 1 ms = 7,775,999,999 ms） | `session-history-search` |
| 列表最大分页大小 | 200 | `session-history-search` |
| 校验失败消息 | 时间范围与分页参数返回确定字段级消息，HTTP 400 + `REQUEST_VALIDATION_FAILED` | `session-history-search`：`会话列表查询校验返回确定字段级结果` |
