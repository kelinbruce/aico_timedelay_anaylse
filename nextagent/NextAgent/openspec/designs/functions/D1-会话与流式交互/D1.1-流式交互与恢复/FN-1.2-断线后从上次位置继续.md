# FN-1.2 断线后从上次位置继续

> 能力域 D1 会话与流式交互 · 子域 [D1.1 流式交互与恢复](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-1.2](../../../features/D1-会话与流式交互/D1.1-流式交互与恢复/F-1.2-断线重连恢复.md) |
| spec | `ts-stream-resume-replay`、`ts-stream-history-consistency` |
| 接口 | SSE/WS 携带 `lastSeenSequence=N` |

## 描述

用户在同一页面断线重连时，系统从上次查看的位置继续推送遗漏内容；刷新或历史加载时，服务端用 Message 语义正文与 Event 时序联合恢复过程。对于受治理 structured presentation，同一 run/tool 只选择 eligible persisted Event snapshot 或 Message-derived legacy compatibility projection 之一，并对无法安全关联的正文显式降级。

## 前置条件

- 用户已登录。
- 目标会话已存在且属于当前用户。
- 当前页面已接收过至少一条实时消息（游标已存在于内存中）。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| sessionId | 是 | 会话 ID |
| lastSeenSequence | 是 | 当前页面已接收的最后一条消息序号（仅存于内存） |

## 输出

从该序号之后补充推送遗漏内容，补充完成后接续实时推送；历史过程正文与实时流使用同一安全 projector，同一说明或 Tool 结果最多一次。

## 处理过程

1. 同一页面断线重连，游标仍保留在内存中。
2. 系统从游标位置之后补充推送遗漏内容。
3. 补充完成后接续实时推送。
4. 若断线期间遗漏内容较多（出现间隙），系统先要求刷新历史对话；仅当刷新成功后，方从新位置继续。
5. 若刷新失败，保持断开状态，不跳过遗漏内容，不伪装恢复成功。
6. 每次过程历史读取同时完成所需消息关联；零个或多个候选、损坏或越权引用只返回安全状态，不使用事件旧正文或客户端缓存补齐。
7. 同一 run/tool 存在 eligible persisted structured Event 时使用该 presentation 并抑制匹配的 Message compatibility envelope；不存在时保留 Message fallback。ordinary `ANSWER`、其他 Tool 或其他 run 不得误抑制。
8. 快速连续导航只保留最新一批自动加载目标；用户主动展开或重试无需等待自动加载窗口。

## 结果

- 正常：从游标位置补充后接续实时推送。
- 出现间隙：须先刷新历史对话，刷新成功后方可从新位置继续。
- 刷新失败：保持断开状态，不推进游标，不跳过遗漏内容，明确提示用户。
- 后续重试：使用最后已知游标，不使用间隙返回的新位置。
- 单项关联失败：其他合法过程仍可浏览，失败项明确显示内容不可用。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 过程关联附加 Web 请求 | 每个被加载运行 0 个；消息关联随既有过程历史请求完成 | `ts-stream-history-consistency / 大会话过程历史关联保持有界` |
| 自动目标合并窗口 | 连续变化停止后 120 ms 发布最新至多 16 个目标；主动展开和重试不等待 | `ts-stream-history-consistency / 大会话过程历史关联保持有界` |
| 过程历史在途上限 | 任意快速导航期间至多 4 个请求，旧结果不得覆盖新目标 | `ts-stream-history-consistency / 大会话过程历史关联保持有界` |
| 关联失败 | 保留过程顺序、类型和状态，正文明确不可用，其他已加载内容继续可浏览 | `ts-stream-history-consistency / 过程历史关联失败显式降级` |
| Structured presentation 单一选择 | 同一 run/tool 有 eligible Event snapshot 时使用 Event，否则使用 Message compatibility projection；最多展示一次且 Message 保持 semantic owner | `ts-stream-history-consistency / 结构化过程正文使用单一 Message 恢复` |
