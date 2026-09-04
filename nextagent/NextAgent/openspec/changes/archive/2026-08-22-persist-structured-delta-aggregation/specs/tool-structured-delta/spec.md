## Function

- **所属 Function**：`FN-5.16 识别和投射结构化工具增量`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Stream Envelope Projection

系统 MUST 将 `TOOL_STRUCTURED_DELTA` 包含在统一的 stream-visible timeline event 集合中。SSE、WebSocket 和 history 使用的同一投影 MUST 把 `toolEventType`、`toolMessageType`、`content`、`capabilityId` 和 `toolCallId` 写入 envelope payload；来源 `inlinePayload.truncated` 为 `true` 时还 MUST 写入顶层 `truncated=true`，字段缺省时 MUST NOT 推断截断。该投影 MUST NOT 从 `truncated` 生成 degradation、新的 request-level terminal fact 或 annotation、或 terminal status。

**需求类别**：功能性需求

#### Scenario: 完整结构化增量投影保持既有字段

- **WHEN** 一个未截断的 `TOOL_STRUCTURED_DELTA` 被投影到 stream 或 history
- **THEN** payload MUST 包含原有 `toolEventType`、`toolMessageType`、`content`、`capabilityId` 和 `toolCallId`
- **AND** payload MUST NOT 自行增加 `truncated=true`

#### Scenario: 截断的历史记录公开截断事实

- **WHEN** 一个持久化 `TOOL_STRUCTURED_DELTA` 携带 `inlinePayload.truncated=true`
- **THEN** SSE、WebSocket 和 history 的统一投影 payload MUST 携带 `truncated=true`
- **AND** `content` MUST 继续按其结构化 JSON shape 投影

#### Scenario: 截断不推导请求完成限制

- **WHEN** `TOOL_STRUCTURED_DELTA.truncated=true` 被投影
- **THEN** 投影 MUST NOT 产生 `DEGRADATION_NOTICE`
- **AND** MUST NOT 新增 request-level completion annotation
- **AND** MUST NOT 改变 request terminal status

### Requirement: Streaming TOOL_STRUCTURED_DELTA Persistence

runtime persistence policy MUST 继续把 `inlinePayload.streaming === true` 的 `TOOL_STRUCTURED_DELTA` 分类为 `PERSISTED`，并把无 `streaming` 字段的非 Workflow 事件分类为 `LIVE_ONLY`。对于两种分类结果，runtime-owned 聚合层 MUST 在 live 投影后接管所有经过可信识别的非 Workflow structured presentation `TOOL_STRUCTURED_DELTA`，按本 change 的聚合规则提交到 timeline store；因此非流式 presentation 也 MUST 可从 durable history 读取。该 timeline body MUST 只作为 Channel/UI presentation，MUST NOT 取代 `CAPABILITY_RESULT` Message 的 ordinary Capability 语义结果，也 MUST NOT 进入模型上下文。

Workflow `TOOL_STRUCTURED_DELTA` MUST 保持既有分类：`NODE_COMPLETED` product 为 `PERSISTED`，`NODE_OUTPUT_DELTA` fragment 为 `LIVE_ONLY`；匹配 Workflow product 规则的事件 MUST NOT 进入非 Workflow 聚合层。Workflow `NODE_COMPLETED` product 超过持久化容量时，系统 MUST 继续形成携带显式截断事实的 durable bounded product，而不是改为仅实时事件；settled live 与 cold history MUST 使用该同一 product 替换先前 fragment。

**需求类别**：功能性需求

#### Scenario: 流式结构化增量聚合后持久化

- **WHEN** 同一 Tool 调用发出多条携带 `streaming=true` 的非 Workflow 结构化增量
- **THEN** live subscriber MUST 按接收顺序收到每条实时增量
- **AND** timeline history MUST 在 flush 后包含按本 change 规则形成的聚合记录

#### Scenario: 非流式结构化增量也可从历史读取

- **WHEN** 非流式结构化增量被 persistence policy 分类为 `LIVE_ONLY`
- **THEN** live subscriber MUST 仍收到该实时事件
- **AND** 聚合层 MUST 在 flush 后把其结果写入 timeline history

#### Scenario: 容量内Workflow product保持既有持久化路径

- **WHEN** 容量内 `TOOL_STRUCTURED_DELTA` 匹配既有 Workflow `NODE_COMPLETED` product 规则
- **THEN** 该事件 MUST 按既有 Workflow classification 与 append 路径处理
- **AND** 本聚合层 MUST NOT 再次暂存或提交该事件

#### Scenario: 超长Workflow completed product形成可恢复的有界历史

- **GIVEN** Workflow `NODE_OUTPUT_DELTA` fragment 已按既有规则实时投影
- **AND** 对应 `NODE_COMPLETED` `TOOL_STRUCTURED_DELTA.inlinePayload` 超过 49,000 UTF-8 bytes
- **WHEN** 系统提交该 completed product
- **THEN** durable history MUST 包含满足持久化容量契约的 product
- **AND** product MUST 携带 `truncated=true`
- **AND** MUST 保留 `capabilityId`、`toolCallId`、`toolEventType`、`toolMessageType`、`accumulated`、`workflowEventType`、`nodeId` 与 `nodeType`
- **AND** settled live 与 cold history MUST 使用同一有界 `content` 和 `truncated` 事实替换 fragment
- **AND** 系统 MUST NOT 再发布一份完整的 `LIVE_ONLY` completed product

## ADDED Requirements

### Requirement: 结构化增量按run与Tool调用隔离聚合

系统 MUST 将每个非 Workflow `TOOL_STRUCTURED_DELTA` 的聚合身份定义为 `(runId, toolCallId)`。不同 run 即使使用相同 `toolCallId`，接收、聚合、显式 flush、run 终止兜底 flush 和状态清理也 MUST 互不读取、互不删除、互不写入对方数据。历史 record 的 Agent Scope、Owner Scope、session、request 和 run 坐标 MUST 来自该 record 所属 run 的可信上下文。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复、安全

**适用范围**：该 Function

#### Scenario: 并发run使用相同toolCallId仍独立flush

- **GIVEN** run A 与 run B 并发发出相同 `toolCallId` 的 PIU 增量且内容不同
- **WHEN** 系统先 flush run A
- **THEN** 只 MUST 提交 run A 的聚合内容和坐标
- **AND** run B 的待处理内容 MUST 保持可独立 flush

#### Scenario: 一个run终止不清除另一个run

- **GIVEN** run A 与 run B 均有相同 `toolCallId` 的未提交增量
- **WHEN** run A 执行终止兜底 flush 或状态清理
- **THEN** run B 的 group MUST 保持不变
- **AND** run B 后续 flush MUST 只产生 run B 的内容

### Requirement: PIU累积uuid合并持久化

同一 `(runId, toolCallId)` 内，系统收到 `toolMessageType=PIU` 且 `content.uuid` 为非空字符串时，MUST 按 `uuid` 将每条 `content.data` 作为一个完整数组项顺序累积。输出 MUST 保留第一条 PIU content 的其他字段，并把 `data` 设为累积数组。无 `uuid` 的 PIU MUST 按接收顺序逐条持久化。

单条持久化记录需要容量截断时，PIU `content` MUST 保持对象、`data` MUST 保持数组，并且只保留能完整放入记录预算的前缀项；MUST NOT 把对象或数组 JSON 化为字符串。

**需求类别**：功能性需求

#### Scenario: 同uuid的PIU按顺序合并

- **GIVEN** 同一聚合身份下依次收到 `uuid=abc` 且 data 为 `{x:1}`、`{x:2}`、`{x:3}` 的三条 PIU
- **WHEN** 系统 flush 该聚合身份
- **THEN** 输出 PIU 的 `content.data` MUST 为 `[{x:1},{x:2},{x:3}]`
- **AND** `content.uuid` MUST 为 `abc`

#### Scenario: 超限PIU只保留完整数组项

- **GIVEN** 聚合 PIU 的 data 数组不能完整放入单记录预算
- **WHEN** 系统形成有界历史记录
- **THEN** `content` MUST 仍为对象且 `content.data` MUST 仍为数组
- **AND** retained data MUST 是原数组的完整前缀项
- **AND** record MUST 携带 `truncated=true`

### Requirement: STREAM_DSL按content.type聚合持久化

同一 `(runId, toolCallId)` 内，系统 MUST 顺序拼接 `toolMessageType=STREAM_DSL` 且 `content.type=dsl` 的内层 `content.content` 字符串。`dataModel`、`done` 或 `error` 到达时，系统 MUST 先关闭并排入当前 dsl 结果，再按接收顺序排入该事件；flush 时未关闭的 dsl buffer MUST 作为最后一个 dsl 结果输出。

单条 dsl 记录需要容量截断时，`content` MUST 保持对象、`content.type` MUST 保持 `dsl`、内层 `content.content` MUST 保持字符串并在 UTF-8 code point 边界保留前缀。

**需求类别**：功能性需求

#### Scenario: dataModel到done顺序保持

- **GIVEN** 系统依次收到 `dataModel`、dsl `a`、dsl `b`、`done`
- **WHEN** 系统 flush
- **THEN** history MUST 依次得到 `dataModel`、dsl `ab`、`done`

#### Scenario: 超限dsl保持可解析shape

- **GIVEN** 拼接后的 dsl 字符串包含中文或 emoji 且超过单记录预算
- **WHEN** 系统形成有界历史记录
- **THEN** `content` MUST 保持 `{type:"dsl", content:string}` shape
- **AND** 字符串 MUST NOT 以破坏 UTF-8 code point 的位置结束
- **AND** record MUST 携带 `truncated=true`

### Requirement: 其他结构化增量按接收顺序持久化

对于 PIU 无 `uuid`、STREAM_DSL 的非 dsl 事件以及 `TEXT`、`DSL`、`ACTION`、`OPERATOR`、`FILE`，系统 MUST 按接收顺序逐条持久化。容量内的 `content` MUST 原样保留；超限时字符串、数组或对象 MUST 保持各自 JSON 类型并保留能够完整放入预算的前缀内容，同时设置 `truncated=true`。

**需求类别**：功能性需求

#### Scenario: 容量内TEXT逐条保持

- **GIVEN** 同一 Tool 调用依次发出 TEXT `hello` 与 `world`
- **WHEN** 系统 flush
- **THEN** history MUST 按顺序包含两条记录
- **AND** 两条 `content` MUST 分别为 `hello` 与 `world`

#### Scenario: 超限对象不变成字符串

- **GIVEN** 一个对象 content 超过单记录预算
- **WHEN** 系统形成有界历史记录
- **THEN** 该 `content` MUST 仍为 JSON object
- **AND** MUST NOT 变成 JSON 字符串
- **AND** record MUST 携带 `truncated=true`

### Requirement: 结构化增量聚合状态有界

系统 MUST 使用固定的内部容量预算限制每个 active run 最多 64 个待处理 Tool 调用 group、每个 group 最多 256 个待处理源事件以及 49,000 UTF-8 bytes 的待处理源 `inlinePayload`。达到任一 group 上限前，系统 MUST 先将已完成聚合批次通过既有 timeline 路径提交，再接收下一批；run group 数达到上限时 MUST 先提交最早待处理 group。单个源事件本身超过 byte 上限时 MUST 不进入驻留 accumulator，而是立即走同一有界 record 写入路径。

到界分批 MUST NOT 丢弃未超出单记录内容预算的完整源事件，MUST NOT 再通知一次 live subscriber，也 MUST NOT 改变 request terminal status。系统 MUST NOT 从 client payload、Tool payload 或 provider 配置覆盖这些上限。

**需求类别**：系统质量属性

**质量属性**：性能/容量、可靠性/恢复

**适用范围**：该 Function

#### Scenario: 第257个源事件触发分批但不无界驻留

- **GIVEN** 一个 group 已驻留 256 个源事件
- **WHEN** 第 257 个源事件到达
- **THEN** 系统 MUST 先提交前一批聚合结果
- **AND** 第 257 个事件 MUST 进入新的有界批次
- **AND** live subscriber MUST NOT 因分批收到重复事件

#### Scenario: 第65个group触发最早group提交

- **GIVEN** 一个 run 已有 64 个待处理 Tool 调用 group
- **WHEN** 新的 `toolCallId` 创建第 65 个 group
- **THEN** 系统 MUST 先提交最早待处理 group
- **AND** 驻留 group 数 MUST 不超过 64

#### Scenario: 单个超大事件不进入accumulator

- **GIVEN** 一个源 `inlinePayload` 已超过 49,000 UTF-8 bytes
- **WHEN** 聚合层接收该事件
- **THEN** 该事件 MUST 立即进入有界 record 写入路径
- **AND** accumulator MUST NOT 保留该超大 payload

### Requirement: 结构化增量显式flush与run终止兜底flush

Tool 执行完成后，系统 MUST 先成功追加普通 `CAPABILITY_RESULT` Message，再由 Runtime 私有地 flush 指定 `(runId, toolCallId)`；Message 写入失败时 MUST NOT 留下新的 durable presentation snapshot。run 终止时 MUST 兜底处理该 run 的全部未提交 group，但没有对应成功 result Message 的 partial snapshot MUST 只表示该 run 的不完整 UI presentation，MUST NOT 被视为 completed Capability result、模型上下文或 terminal answer。flush 写入聚合记录时 MUST NOT 触发 `onTimelineAppend` 或等价的第二次 subscriber 通知。显式与兜底 flush MUST 使用同一聚合和容量规则；空 flush MUST 不写入记录。该 flush MUST 是 Runtime 私有机制，MUST NOT 作为 `AgentRunStatePort` 公共方法暴露给 Core。

**需求类别**：功能性需求

#### Scenario: 显式flush只清空指定聚合身份

- **GIVEN** 同一 run 的两个 `toolCallId` 均有待处理内容
- **WHEN** 系统显式 flush 其中一个 `toolCallId`
- **THEN** 只 MUST 提交并清空指定 group
- **AND** 另一个 group MUST 保持待处理

#### Scenario: Message写入失败不留下过渡snapshot

- **GIVEN** 一个 ordinary Capability 已产生待提交的 structured presentation group
- **WHEN** 对应 `CAPABILITY_RESULT` Message 写入失败
- **THEN** 系统 MUST NOT flush 或持久化该 group 为新的 completed presentation snapshot
- **AND** 失败 MUST 进入既有显式安全失败路径

#### Scenario: run终止提交剩余group且不重复通知

- **GIVEN** run 终止时有两个未提交 group
- **WHEN** 系统执行兜底 flush
- **THEN** 两个 group MUST 各自按规则提交
- **AND** subscriber MUST NOT 收到 flush 产生的重复实时事件

#### Scenario: timeline append失败不被吞掉

- **GIVEN** flush 形成了容量合规的 record
- **AND** timeline gateway 拒绝该写入
- **WHEN** 系统等待 flush
- **THEN** 失败 MUST 向上传播
- **AND** 系统 MUST NOT 把该 group 报告为已可靠持久化

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：非 Workflow 结构化增量按 `(runId, toolCallId)` 隔离并在固定容量内聚合；到界分批、显式 flush 与 run 终止兜底 flush 复用同一规则；Workflow completed product 超限时仍形成 durable bounded product。
- **依据 Requirements**：`Streaming TOOL_STRUCTURED_DELTA Persistence`、`结构化增量按run与Tool调用隔离聚合`、`PIU累积uuid合并持久化`、`STREAM_DSL按content.type聚合持久化`、`其他结构化增量按接收顺序持久化`、`结构化增量聚合状态有界`、`结构化增量显式flush与run终止兜底flush`

### 结果

- **变更类型**：修改
- **目标内容**：历史返回 run-scoped、有界且结构可解析的聚合结果；发生内容截断时统一投影 `truncated=true`，不推导请求完成限制。
- **依据 Requirements**：`Stream Envelope Projection`、`结构化增量按run与Tool调用隔离聚合`、`PIU累积uuid合并持久化`、`STREAM_DSL按content.type聚合持久化`

### 规格

| 规格项 | 变更类型 | 原规格值 | 目标规格值 | 依据 Requirements |
|---|---|---|---|---|
| 聚合身份 | 新增 | 不适用（新增） | `(runId, toolCallId)` | `结构化增量按run与Tool调用隔离聚合` |
| 每个 run 的待处理 group 上限 | 新增 | 不适用（新增） | 64 groups | `结构化增量聚合状态有界` |
| 每个 group 的驻留上限 | 新增 | 不适用（新增） | 256 events 且源 `inlinePayload` 合计 49,000 UTF-8 bytes | `结构化增量聚合状态有界` |
| 历史截断标识 | 新增 | 不适用（新增） | 非 Workflow 聚合结果或 Workflow completed product 发生内容丢失时 `truncated=true`；不得推导 degradation、新的 request-level terminal fact 或 annotation、或 terminal status | `Stream Envelope Projection`、`Streaming TOOL_STRUCTURED_DELTA Persistence` |
