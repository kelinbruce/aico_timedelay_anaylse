# FN-2.3 重试请求

> 能力域 D2 请求运行时 · 子域 [D2.1 请求提交与控制](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-2.3](../../../features/D2-请求运行时/D2.1-请求提交与控制/F-2.3-重试请求.md) |
| spec | `request-retry` |
| 接口 | `POST /api/v1/sessions/:sessionId/retry` |

## 描述

对当前会话中最新已结束的请求重新执行，创建同一请求的新尝试。

## 前置条件

- 用户已登录。
- 目标会话属于当前用户和智能体。
- 最新请求已结束（终态已稳定）。

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
  "requestId": "req_1",
  "runId": "run_2",
  "attempt": 2
}
```

## 处理过程

1. 校验身份、归属和最新请求标识匹配。
2. 校验请求可重试（终态已稳定）。
3. 复校验源请求的附件仍可用。
4. 创建同一请求的新尝试，记录重试关联。
5. 新尝试进入同会话排队。
6. 隐藏旧尝试的助手输出（可追溯）。
7. 新尝试成为最新请求。
8. Retry pending 时移除旧 attempt 的当前展示，HTTP acceptance 或权威状态确认新 `runId` 后只以该 run 的事实组成当前过程和答案，并自动展开新过程；当前轮次的 Think、工具步骤、阶段文字和 canonical assistant answer 只由当前 `runId` 的事实组成，其他 attempt 的过程或答案不参与当前 attempt 的合并、去重、完成判定或答案抑制。该过滤规则贯穿 live overlay、会话切换返回和 authoritative history reload。旧 attempt 的 process-history 缓存和后端可追溯事实保留，但不参与默认当前轮次投影。分享页面继续读取创建分享时冻结的 snapshot，fork child 的 Retry 只切换 child-owned attempt，不修改 parent session 或已有分享。

## 结果

- 正常：重试成功，返回新运行标识和尝试序号。
- 非最新请求：安全拒绝。
- 活动请求：安全拒绝。
- 附件不可用：安全拒绝。
- 幂等重复：返回首次结果。
- 幂等键冲突：安全拒绝。
- Retry pending 失败：恢复原轮次及其过程和答案。
- 用户在 live、会话切换返回和重新加载后只看到当前 retry attempt 的执行过程与答案；旧 attempt 事实仍可追溯。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 最新继承轮次 retry 入口 | 最新轮次存在、会话不处于界面转换状态且 retry 次数未达上限时暴露 retry 入口；`metadata.forkInherited: true` 不单独禁用或隐藏入口，最终资格由后端权威校验决定 | `request-retry`：`Agent Web 对可操作的最新轮次暴露 retry 入口` |
| 当前 attempt 投影边界 | Retry 确认新 `runId` 后，当前轮次的 Think、工具步骤、阶段文字和 canonical assistant answer 只由当前 `runId` 的事实组成；其他 attempt 的过程或答案不参与合并、去重、完成判定或答案抑制；live、会话切换返回和 authoritative history reload 对当前 `runId` 得出一致默认可见结果 | `request-retry`：`Retry 新 run 自动展开实时过程` |
