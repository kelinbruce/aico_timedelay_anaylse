# FN-5.16 识别和投射结构化工具增量

> 能力域 D5 Capability 能力体系 · 子域 [D5.1 能力治理](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 覆盖特性 | [F-5.1](../../../features/D5-Capability能力体系/D5.1-能力治理/F-5.1-统一能力治理.md) |
| 主规格 | [`tool-structured-delta`](../../../../specs/tool-structured-delta/spec.md) |
| 接口 | 系统内部，受治理 Tool 结构化增量识别、聚合和安全投影 |

## 描述

系统只从受治理 producer/adapter 的 canonical shape 识别结构化 Tool 增量，实时投影每个合法片段，并按 `(runId, toolCallId)` 隔离、聚合和有界持久化最终 UI presentation。ordinary Capability 的 canonical semantic result 继续由 `CAPABILITY_RESULT` Message 拥有；structured Event snapshot 只是有退出条件的 Channel/UI 过渡载体，不进入模型 Context、terminal truth 或 completion limitation。

## 前置条件

- Tool 调用已通过统一 Capability 边界，当前 Agent Scope、Owner Scope、run 和 cancellation context 已固化。
- producer/adapter 位于 canonical structured-delta 识别白名单；任意 stdout、JSON、Message 内容或 Tool 自报字段不能自行建立持久化例外。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 候选结构化载荷 | 是 | 工具结果中待识别的候选 JSON 对象，可能为直接三段式或信封包装 |
| 归属坐标 | 是 | 可信 `runId`、`capabilityId`、`toolCallId` |

## 输出

安全 `TOOL_STRUCTURED_DELTA` presentation，携带 `toolEventType`、`toolMessageType`、同形 `content`、Capability/Tool 坐标，以及仅在确有内容损失时出现的 `truncated=true`。

## 处理过程

1. 按直接 shape、status 信封、code 信封的固定顺序识别，并统一执行 event/message type 枚举和敏感内容校验；识别失败走既有 ordinary result 路径。
2. 合法非 Workflow 增量实时投影一次，同时进入 runtime-owned accumulator；accumulator 以 `(runId, toolCallId)` 隔离，限制每 run 64 groups、每 group 256 events、每 group 49,000 UTF-8 source bytes。
3. PIU 按相同 uuid 顺序累积完整 `data` 项；STREAM_DSL 顺序拼接 dsl content 并保持控制事件顺序；其他受支持内容按接收顺序形成 presentation records。
4. ordinary Tool 完成时先成功写入 canonical `CAPABILITY_RESULT` Message，再由 Runtime 私有 flush 同一 group；Message 失败不产生新的 completed snapshot。run 终止 fallback 只形成 partial presentation，不成为 completed semantic result。
5. direct、容量到界、显式和 fallback 写入在 timeline gateway 前统一执行 49,000-byte JSON UTF-8 normalization。截断保持 TEXT、DSL、PIU object/array shape 与完整前缀项，并投影 `truncated=true`；真实 append failure 继续传播。
6. Workflow inner `NODE_COMPLETED` product 使用独立 Event-owned 封闭例外，并在 settled publish 前采用同一容量边界；`NODE_OUTPUT_DELTA` fragment 仍为 live-only。
7. history 对同一 run/tool 在 eligible persisted Event presentation 与 Message-derived legacy compatibility presentation 中只选择一个；ordinary `ANSWER` 继续由 Message 恢复。
8. 非 agentic 流式 ApiCall 的 orchestration 层逐 chunk 记录是否命中 structured delta：任一 chunk 命中即抑制终态 `LLM_CONTENT_DELTA { final: true }`（残留非 structured 数据不再触发 terminal 正文事件）；全部未命中时照常以非 structured chunk 聚合（或无 chunk 时完整 terminal content）发出终态事件。`terminalContent` 与 terminal commit 保持原值，抑制只影响 `LLM_CONTENT_DELTA` emit；pre-round 与 post-tool-call 两条路径同等适用，模型驱动 tool-loop 不受影响。

## 结果

- 合法且容量内：live 与 cold history 得到同形、有序 structured presentation。
- 内容超限：持久化并展示可解析的有界前缀，显式标记 `truncated=true`，不改变 request terminal。
- 跨 run 相同 `toolCallId`：互不读取、flush、清理或写错坐标。
- Message 或 timeline 写入失败：进入既有显式失败路径，不伪装成功、不吞错。
- 不可信或不匹配：不建立 structured durable Event 例外，继续 ordinary projection。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 可信识别与安全投影 | 只接受 canonical shapes 和白名单 producer；投影 allowlisted 字段及可信 `truncated`，不泄露敏感内容 | `tool-structured-delta / Structured Event Shape Validation`、`Security Constraints`、`Stream Envelope Projection` |
| 聚合身份与容量 | `(runId, toolCallId)` 隔离；每 run 64 groups、每 group 256 events、49,000 UTF-8 source bytes；到界分批且不重复 live 通知 | `tool-structured-delta / 结构化增量按run与Tool调用隔离聚合`、`结构化增量聚合状态有界` |
| Message 语义 owner 与 history 选择 | ordinary result Message 先写、Runtime 私有 flush；Event 仅 UI presentation；history 对同 run/tool 只选一个 carrier | `tool-structured-delta / 结构化增量显式flush与run终止兜底flush`、`ts-stream-history-consistency / 结构化过程正文使用单一 Message 恢复` |
| 终态 LLM_CONTENT_DELTA 抑制 | 非 agentic 流式 ApiCall 任一 chunk 命中 structured delta 即抑制 `LLM_CONTENT_DELTA { final: true }`；全部未命中才发出非 structured 聚合终态；terminal commit 不受影响 | `tool-structured-delta / Streaming Terminal LLM_CONTENT_DELTA Suppression` |
| 结构保真与 Workflow 例外 | PIU/STREAM_DSL/其他内容裁剪保持 JSON shape；Workflow completed product 使用同一 49,000-byte gateway 边界和 settled live/history truth | `tool-structured-delta / PIU累积uuid合并持久化`、`STREAM_DSL按content.type聚合持久化`、`其他结构化增量按接收顺序持久化`、`Streaming TOOL_STRUCTURED_DELTA Persistence` |
