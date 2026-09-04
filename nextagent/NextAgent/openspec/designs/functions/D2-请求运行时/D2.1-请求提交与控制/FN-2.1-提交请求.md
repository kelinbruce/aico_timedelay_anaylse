# FN-2.1 提交请求

> 能力域 D2 请求运行时 · 子域 [D2.1 请求提交与控制](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 覆盖特性 | [F-2.1](../../../features/D2-请求运行时/D2.1-请求提交与控制/F-2.1-提交请求.md) |
| 主规格 | `routing-constraint-validation` |
| 遗留规格 | `ts-web-command-idempotency`、`session-lane-scheduling` |
| 接口 | `POST /api/v1/requests`（便捷）/ `POST /api/v1/sessions/:sessionId/requests`（会话内） |

## 描述

用户提交问题，系统返回请求标识和运行标识并进入处理生命周期；支持便捷提交（自动创建会话）和会话内提交两种方式。

## 前置条件

- 用户已登录。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| inputText | 是 | 用户问题文本 |
| idempotencyKey | 是 | 幂等键，非空 |
| sessionId | 否 | 会话标识，省略时便捷提交自动创建会话 |
| locale | 否 | 语言偏好 |
| routingConstraints | 否 | 封闭的路由约束；可用 `executionMode=model-only` 禁用 Tool，但不能携带 Tool-call 数量预算 |
| attachments | 否 | 附件标识列表 |

## 输出

```json
{
  "sessionId": "sess_123",
  "requestId": "req_1",
  "runId": "run_1",
  "attempt": 1
}
```

## 处理过程

1. 系统校验用户身份、智能体归属、封闭 routing allow-list 和受治理 request model options，身份只来自可信边界。
2. 便捷提交（不带会话标识）：自动创建会话。
3. 会话内提交（带会话标识）：校验会话归属，进入同会话排队。
4. 校验幂等键，相同键重复提交返回首次结果，不产生重复副作用。
5. 校验同会话无活动请求，有则拒绝并发。
6. 创建请求运行，返回请求标识、运行标识和尝试序号。
7. 最新轮次 Edit 确认时区分未变化输入与有效变化：附件队列为空、未选择新 Skill 定向且 trim 后文本与进入 edit 模式时加载的原始用户文本相同时判定为未变化 Edit，不生成 request identity、不乐观替换、不调用 service，保持 edit 模式和当前文本并显示“内容未修改”提示；文本变化或选择新 Skill 定向时执行既有 Edit replacement，附件非空时沿用既有附件拒绝。

## 结果

- 正常：受理成功，返回标识。
- 幂等重复：返回首次受理结果，不产生重复副作用。
- 同会话有活动请求：安全拒绝并发。
- 参数无效：安全失败。
- 未变化 Edit：不产生新 request、Retry attempt 或可见性副作用，向用户提示内容未修改；文本或 Skill 定向变化时 Edit 正常提交。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 请求级 Tool 使用约束 | request 可以通过 `executionMode=model-only` 禁用 Tool，但不能携带或覆盖任一 Agent-owned Tool-call 数量预算 | `routing-constraint-validation`：`Routing constraints use an allow-list schema`、`Budget and execution constraints are enforced before slow boundaries` |
| 单会话并发活动请求数 | 1 | `session-lane-scheduling`：同会话 lane 约束 |
| 最新继承轮次 edit 入口 | latest target 存在、属于当前最新轮次、conversation 不处于界面转换状态且用户拥有 Write permission 时暴露 edit 入口和 `/edit` 命令；`metadata.forkInherited: true` 不单独禁用或隐藏入口，最终资格由后端权威校验决定 | `request-edit-resubmit`：`Agent Web SHALL expose edit only for the current latest turn` |
| 未变化 Edit 判定条件 | 附件队列为空、未选择新 Skill 定向且 trim 后编辑文本与进入 edit 模式时加载的原始用户文本相同 | `request-edit-resubmit`：`Agent Web SHALL expose edit only for the current latest turn` |
