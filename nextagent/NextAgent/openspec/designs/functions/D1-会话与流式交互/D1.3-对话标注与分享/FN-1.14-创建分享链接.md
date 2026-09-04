# FN-1.14 创建分享链接

> 能力域 D1 会话与流式交互 · 子域 [D1.3 对话标注与分享](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-1.8](../../../features/D1-会话与流式交互/D1.3-对话标注与分享/F-1.8-分享对话.md) |
| spec | `conversation-share` |
| 接口 | `POST /api/v1/sessions/:sessionId/shares` |

## 描述

为会话中的指定运行创建分享链接，他人可通过链接只读查看。

## 前置条件

- 用户已登录。
- 目标会话属于当前用户和智能体。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| sessionId | 是 | 会话 ID |
| runIds | 是 | 要分享的运行 ID 列表，非空 |
| originUrl | 是 | 来源 URL，非空 |
| expiresIn | 是 | 过期时长：24 小时、7 天、30 天或永久 |
| allowedOps | 是 | 允许的操作列表，如只读查看 |

## 输出

```json
{
  "shareId": "share_1",
  "shareUrl": "http://127.0.0.1:3000/share/share_1"
}
```

## 处理过程

1. 校验会话归属。
2. 系统对请求体执行字段级 schema 校验，校验失败返回 HTTP `400` 与 `REQUEST_VALIDATION_FAILED`，并使用确定消息定位缺失或非法的 `runIds`：缺失 `runIds` 返回 `runIds is required.`；空数组返回 `runIds must contain at least 1 item(s).`；超过 100 项返回 `runIds must not exceed 100 items.`；单项超过 256 字符返回 `runIds must not exceed 256 characters.`。消息不包含数组下标或未解析的约束值。
3. `ConversationShareService.createShare` 在持久化分享记录之前，对请求体中的每个 `runId` 复用 `loadSharedConversation` 的 resolve 逻辑校验能否在创建者 scope `(tenantId, subjectId, agentId, sessionId)` 下形成完整问答对（canonical USER 问题 + final assistant answer）；任一 `runId` 不可 resolve 时 throw `AgentError(SHARE_RUN_NOT_RESOLVABLE, NOT_FOUND)` 并中止，不落库、不返回分享结果。fork 生成的 copied run anchor（无 `RequestRunRecord` 但有可读 messages 且能唯一补齐 canonical USER 与 assistant answer）通过校验；校验不回源 parent / ancestor session。
4. 生成分享链接，绑定指定运行和过期时间。
5. 返回分享标识和链接。

## 结果

- 正常：创建成功，返回分享链接。
- `runIds` 缺失、为空数组、超过 100 项或单项超过 256 字符：返回 `400 REQUEST_VALIDATION_FAILED` 与确定字段级消息。
- `runIds` 含不存在、不可 resolve、跨 scope 或跨 session 的 runId：返回 `404 SHARE_RUN_NOT_RESOLVABLE`，不落库、不返回分享结果。
- 运行列表为空或参数无效：安全失败。
- 权限不足：安全拒绝。

## 规格

| 规格项 | 规格值 | 状态 | 来源 |
|---|---|---|---|
| 分享 run 解析方式 | 一次 `RequestRunStoreGateway.listRuns` 批量查询（limit 等于选中 runIds 数量），映射命中沿用原 scope/session 校验与 attempt 精度；不逐条 `loadRun`，行为与逐条解析等价 | `conversation-share`：`分享 run 解析使用批量查询` |
| 过期时长选项 | 24 小时、7 天、30 天、永久 | 已定义 | `conversation-share` |
| 创建分享的 runId 可 resolve 校验 | 创建分享前对每个 `runId` 复用查看期 resolve 逻辑校验；不可 resolve 返回 `404 SHARE_RUN_NOT_RESOLVABLE` 且不落库；copied run anchor 通过校验；不回源 parent / ancestor session | 已定义 | `conversation-share`：`Share creation Web API contract` |
| `runIds` 字段级校验消息 | 缺失返回 `runIds is required.`；空数组返回 `runIds must contain at least 1 item(s).`；超 100 项返回 `runIds must not exceed 100 items.`；单项超 256 字符返回 `runIds must not exceed 256 characters.`；消息不含数组下标或未解析约束值 | 已定义 | `conversation-share`：`分享创建校验返回确定字段级结果` |
| 单会话最大分享数 | 50 | 建议评审值 | 建议补充 |
