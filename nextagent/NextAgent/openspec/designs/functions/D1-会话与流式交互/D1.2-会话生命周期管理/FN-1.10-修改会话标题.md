# FN-1.10 修改会话标题

> 能力域 D1 会话与流式交互 · 子域 [D1.2 会话生命周期管理](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-1.5](../../../features/D1-会话与流式交互/D1.2-会话生命周期管理/F-1.5-命名会话.md) |
| spec | `session-title-update` |
| 接口 | `PUT /api/v1/sessions/:sessionId/title` |

## 描述

用户手动修改会话标题，设置后系统不再自动覆盖。

## 前置条件

- 用户已登录。
- 目标会话属于当前用户和智能体。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| sessionId | 是 | 会话 ID |
| title | 是 | 标题内容，raw 最大 100 字符；session owner trim 后校验并持久化 trimmed 值，trim 后 1-100 字符；trim 后为空或仅空白被拒绝 |

## 输出

```json
{
  "sessionId": "sess_123",
  "title": "基站故障诊断"
}
```

## 处理过程

1. 校验会话归属和 owner-and-Agent scope。
2. Web route 校验 raw title 最大 100 字符；session owner trim 后校验长度（1-100）、prohibited content patterns，持久化 trimmed title。
3. trim 后为空或仅空白字符的标题被拒绝，不清除或修改已存储标题。
4. 标题通过校验后标记为 `titleSource="manual"`，阻断后续自动覆盖。

## 结果

- 正常：标题修改成功，标记为手动设置。
- 标题长度无效（trim 后为空或超过 100）：安全失败。
- 标题含 prohibited content：安全失败，错误不包含 unsafe 内容。
- 权限不足：安全拒绝。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 标题长度 | raw 最大 100 字符；session owner trim 后 1-100 字符；trim 后为空或仅空白被拒绝，不清除已存储标题 | `session-title-update`：`Manual title validation SHALL match current session-owner rules` |
| 标题 prohibited content | trim 后匹配 secret- 或 XSS-sensitive pattern 时拒绝，返回 `SESSION_TITLE_UNSAFE_CONTENT`，错误不包含 unsafe 内容 | `session-title-update`：`Unsafe title content SHALL report a category-specific safe message` |
