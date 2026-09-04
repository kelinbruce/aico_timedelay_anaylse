# FN-1.1 查看会话消息流

> 能力域 D1 会话与流式交互 · 子域 [D1.1 流式交互与恢复](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 覆盖特性 | [F-1.1](../../../features/D1-会话与流式交互/D1.1-流式交互与恢复/F-1.1-实时查看处理过程.md) |
| 主规格 | [`ts-web-sse-ws-transports`](../../../../specs/ts-web-sse-ws-transports/spec.md) |
| 接口 | `GET /api/v1/sessions/:sessionId/stream`（SSE）/ `GET /api/v1/sessions/:sessionId/ws`（WebSocket）；跨会话 Activity 接口由 [FN-1.21](../D1.2-会话生命周期管理/FN-1.21-感知跨会话活动.md) 承载 |

## 描述

用户打开会话时查看当前 session 的 Request Execution Stream：不带游标只看打开之后的新消息，带游标 0 从头查看全部历史。SSE 与 WebSocket 在该流类型内推送内容一致；ordinary Capability 的语义结果只从 Message 安全投影，lifecycle Event 只提供顺序、状态和强引用。受治理 structured presentation 可使用有界 Event snapshot 作为封闭过渡载体，但只服务 Channel/UI，不进入模型 Context 或 terminal。跨会话 Activity 使用独立连接与协议，不进入本消息流。

## 前置条件

- 用户已登录。
- 目标会话已存在且属于当前用户。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| sessionId | 是 | 会话 ID |
| lastSeenSequence | 否 | 省略只看新消息；0 表示从头查看全部历史 |

## 输出

按序号推送安全会话事件（SSE 为 text/event-stream，WebSocket 为 text frame）。有效过程引用携带消息投影正文；受治理 structured snapshot 携带同形、有界 presentation 和可信 `truncated`；无效引用只携带顺序、类型、状态和 `contentUnavailable`，不暴露隐藏消息。同一订阅已安全交付的过程正文在对应完成边界原地收敛，完成投影保留同 occurrence 已交付的非空安全正文，空的内容不可用完成态不覆盖已展示内容；缓存未命中、刷新、重连、晚加入和历史加载仍以持久化 `SessionMessage` 为唯一正文来源。成功 RAG 检索结果在过程面板显示召回数量、每条结果的 `displaySource` 名称和按语言限制的内容预览，实时 stream 投影与历史重建为同一结果生成同形 `kind="ragRetrieval"` 安全摘要。

## 处理过程

1. 系统确认用户身份与权限，仅展示属于该用户的会话内容。
2. 未带游标时从会话尾部订阅，仅推送打开之后的新事件；带游标 0 时从开头补齐历史再接续新事件。
3. 推送前对内容脱敏。
4. 对 ordinary semantic result，系统校验用户、智能体、会话、请求、运行和 Tool 归属，只从有效 Message 引用生成安全正文；解析失败不读取 Event 旧正文。只有通过 canonical structured-delta 识别的有界 Event snapshot 可直接形成 UI presentation，且不得反推模型输入或 terminal。
5. 具有 `stepId` 的待定公开输出先进入无图标桥接位置；同轮 Tool 说明原地接管并连接 thinking 与 Tool，`final=true` 则由最终答案位置直接接管，不清空、重新打字或播放位置/透明度动画。
6. 收到最终结果后本次请求推送结束；若订阅整个会话则继续等待新消息。用户断开时释放订阅级关联缓存，不影响后台结果。

## 结果

- 正常：按顺序推送消息，直至请求结束或用户关闭。
- 权限不足：安全拒绝，不暴露会话是否存在。
- 参数无效：安全失败，不暴露敏感信息。
- 连接断开：清理资源，不影响后台处理结果。
- 引用无效：保留安全状态并标记内容不可用，不泄露正文或归属。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 支持通道 | SSE、WebSocket；同一运行的内容、顺序、终态和安全降级等价 | `ts-web-sse-ws-transports / 等价 Web Stream Transport` |
| 流类型隔离 | Request Execution Stream 与 Session Activity Projection Stream 不共享 payload、游标、订阅状态或恢复状态 | `ts-web-sse-ws-transports / 等价 Web Stream Transport` |
| 可恢复过程正文 | ordinary semantic result 只来自唯一 `SessionMessage`；受治理 structured presentation 可使用有界 Event snapshot 过渡，Message 仍是模型语义 owner | `ts-web-sse-ws-transports / 可恢复过程事件引用唯一消息正文` |
| 无效引用 | 保留安全类型、顺序和状态，正文标记 `contentUnavailable=true` | `ts-web-sse-ws-transports / Web stream 在服务端解析过程消息引用`
| 活跃流完成收敛 | 同一订阅已交付且全部 occurrence 坐标一致的非空安全累计正文原地收敛为完成态；未命中时从唯一 `SessionMessage` 恢复；空的内容不可用完成态不得覆盖同 occurrence 已交付的非空正文 | `ts-web-sse-ws-transports / Web stream 在服务端解析过程消息引用` |
| Tool 轮次说明 | 在 thinking 与同轮 Tool 之间使用最终答案的公开正文排版直接呈现，无独立标题、状态图标或展开控制；最终答案只随逐帧 Web stream 投影推进，接管时使用既有答案左边界且不播放位置、透明度或重新打字动画 | `ts-web-sse-ws-transports / Tool 轮次执行说明与 Tool 调用连续呈现` |
| 会话非续期请求头 | 浏览器自动重连的 SSE 流连接和 auth probe HTTP 请求携带 `x-non-renewal-session: true`，后端/网关收到时不得续期会话超时；WebSocket 不携带该头（受控例外）；用户主动请求不携带该头 | `ts-web-sse-ws-transports / 会话非续期请求头` |
| RAG 检索结果展示摘要 | 成功 RAG 结果生成 `kind="ragRetrieval"` 安全摘要，包含 `totalCount` 和有序 `items`；每个条目含 `displaySource`、`sourceMissing`、`contentPreview` 和 `contentTruncated`；预览上限按汉字/拉丁字母数量确定（40 或 100 个 Unicode code point）；摘要不含完整 `content`、`provenance`、`score`、`rankHint` 或诊断对象 | `ts-run-status-visibility`：`RAG 检索结果具有可展示的安全摘要`、`RAG 过程详情以来源标签和单行预览呈现` |
| Cancel 终端 content 不进入答案正文 | 答案正文区域只展示 `LLM_CONTENT_DELTA` 积累内容；`REQUEST_CANCELED` 和 cancel-category `REQUEST_FAILED` 的终端 content 不进入答案正文；cancel-category `REQUEST_FAILED` 归一化为 `CANCELED` 状态；`FAILED_TERMINAL_PLACEHOLDER` 正则覆盖 `'Request canceled by user.'`；history 加载时 `assistant-terminal-` 前缀消息无法识别终端类型时不 fallback 到 `LLM_CONTENT_DELTA` | `ts-run-status-visibility`：`Cancel 终端事件 content 不得进入前端答案正文区域` |
| Cancel 无内容时答案正文区域友好提示 | cancel 终态且 `hasAnswerContent === false` 时，答案正文区域渲染居中 i18n 提示（`turn.canceledWithoutAnswer`），不空白；`CanceledNotice` 继续在分割线上方保留 | `ts-run-status-visibility`：`无流式正文时答案正文区域展示 i18n 友好提示` |
| 非执行中 run cancel 状态收束 | pending input / queued run cancel 后 `resolveStatus` 返回 `CANCELED`、stop 按钮消失、输入框恢复；conversation store 接受 `attemptId` 不匹配的 terminal 事件；新 submit 重置 `activeRequestRootMessageId` 避免旧 root 残留误杀新请求 | `ts-run-status-visibility`：`非执行中 run cancel 时前端状态正确收束` |
