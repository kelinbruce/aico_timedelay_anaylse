## Function

- **所属 Function**：`FN-10.6 前端定制`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: TOOL_STRUCTURED_DELTA 过程面板处理

过程面板 MUST 按稳定关联身份处理 `TOOL_STRUCTURED_DELTA`。当事件具有非空 `toolCallId` 且存在相同 `toolCallId` 的 runtime Capability lifecycle 时，`CAPABILITY_STARTED`、全部结构化过程、普通安全结果和 `CAPABILITY_COMPLETED` MUST 形成恰好一个 Capability 卡片。该卡片 MUST 使用 `CAPABILITY_STARTED` 的 sequence 和 created time 作为排序锚点；后续事件 MUST 只更新原卡片，不得创建竞争的顶层条目或移动卡片。

匹配 runtime Capability lifecycle 的 `TITLE` 和 `SUB_TITLE` MUST 在该 Capability 卡片内部创建有序过程分段；`DETAIL` MUST 累积到匹配的最近 `TITLE`，`SUB_DETAIL` 和 `SUB_CONCLUSION` MUST 累积到匹配的最近 `SUB_TITLE`。独立安全结果投影存在时 MUST 位于全部结构化过程分段之后。已被识别并呈现为结构化过程的协议帧 MUST NOT 再以普通命令输出、摘要或原始协议文本重复显示。completion stdout preview 同时承载已解析结构化帧且没有独立的普通安全结果投影时，过程面板 MUST 省略该 stdout preview，MUST 保留退出状态、安全错误和已投影结构化过程；系统 MUST NOT 在浏览器中解析原始 stdout 以猜测可保留片段。

不存在匹配 runtime Capability lifecycle 时，`TITLE` 和 `SUB_TITLE` MUST 继续形成独立结构化过程条目。`TITLE` 和 `SUB_TITLE` MUST 按首个非空稳定关联字段建立索引，优先级依次为 `toolCallId`、`invocationId`、`metadata.invocationId`、`capabilityId`。带稳定关联字段的 detail 或 conclusion MUST 只更新同一关联身份下的匹配标题；不存在匹配标题时 MUST 忽略。只有完全不带上述稳定关联字段的 legacy 事件 MAY 更新最近同类型标题；未选择该兼容行为时 MUST 忽略该事件。

TEXT detail MUST 同时按顺序进入纯文本 detail 和结构化 TEXT segments；相邻 TEXT segments MUST 拼接，非 TEXT segment MUST 打断拼接链。DSL、PIU、ACTION、OPERATOR 和 FILE MUST 分别形成独立结构化 segment，MUST NOT 通过 `JSON.stringify` 写入纯文本 detail。过程面板 MUST 按 message type 使用既有专用 renderer 呈现这些 segments。

`ANSWER` MUST NOT 创建过程面板条目，MUST 进入 answer content。`EXPAND_PANEL` MUST NOT 创建独立条目；带稳定关联字段时 MUST 只挂到匹配 `TITLE`，完全无稳定关联字段时 MAY 挂到最近 `TITLE`，没有可用标题时 MUST 忽略。同一 attempt、event type 和 sequence 下，不同 `toolEventType` 或稳定关联身份的事件 MUST 全部保留；相同关联身份的标题 MUST 先于其 detail 投影。

**需求类别**：功能性需求

#### Scenario: Bash 任务进展归入执行命令卡片

- **GIVEN** `CAPABILITY_STARTED` 以 `toolCallId=T1` 创建“执行命令”卡片
- **WHEN** T1 依次产生 `SUB_TITLE="任务进展"`、两个 `SUB_CONCLUSION` 和 `CAPABILITY_COMPLETED`
- **THEN** 过程面板 MUST 只显示一张以 started 时序定位的“执行命令”卡片
- **AND** “任务进展”及两个 conclusion MUST 按事件顺序显示在卡片内部
- **AND** “任务进展” MUST NOT 成为位于“执行命令”之前或之后的独立顶层条目

#### Scenario: 任务进展与普通命令结果混合呈现

- **GIVEN** 同一 tool call 既产生结构化任务进展，又通过独立安全结果投影产生普通命令结果
- **WHEN** Capability 完成
- **THEN** 卡片 MUST 先显示全部结构化任务进展，再显示“命令结果”分段
- **AND** 结构化任务进展对应的协议帧 MUST NOT 在“命令结果”中重复
- **AND** 独立安全结果投影中的普通输出 MUST 保留在“命令结果”中

#### Scenario: 混合 stdout 无法安全拆分

- **GIVEN** completion stdout preview 同时包含已投影结构化帧与未独立投影的其他文本
- **WHEN** 过程面板构建同一 tool call 的命令结果
- **THEN** 过程面板 MUST 省略该 stdout preview
- **AND** 卡片 MUST 保留结构化任务进展、退出状态和安全错误
- **AND** 浏览器 MUST NOT 解析 raw stdout 或使用字符串相似度恢复其他文本

#### Scenario: 失败保留已经发生的进展

- **GIVEN** 执行命令已经产生至少一个结构化任务进展
- **WHEN** 同一 tool call 以失败、超时或阻止终态完成
- **THEN** 卡片 MUST 保留全部已发生进展
- **AND** 失败原因或安全错误 MUST 位于进展之后
- **AND** 终态 MUST NOT 删除、替换或移动该卡片

#### Scenario: 独立结构化过程保持既有条目语义

- **GIVEN** `TOOL_STRUCTURED_DELTA` 具有稳定关联身份但不存在匹配 runtime Capability lifecycle
- **WHEN** 事件产生 `TITLE`、TEXT detail、DSL detail 和 `SUB_TITLE`
- **THEN** 过程面板 MUST 创建对应的独立有序结构化过程条目
- **AND** TEXT MUST 进入文本和 TEXT segment
- **AND** DSL MUST 只进入独立 DSL segment

#### Scenario: 关联 detail 没有匹配标题

- **GIVEN** 已存在关联身份 T1 的 `TITLE`
- **WHEN** 关联身份 T2 的 detail 到达且不存在 T2 标题
- **THEN** 过程面板 MUST 忽略该 detail
- **AND** T1 标题和详情 MUST 保持不变

#### Scenario: 相同 sequence 的标题先于详情

- **WHEN** 相同 attempt、event type、sequence 和关联身份包含一个标题与一个 detail
- **THEN** 两个事件 MUST 都进入过程投影
- **AND** 标题 MUST 先于 detail 处理，即使输入数组中 detail 位于标题之前

#### Scenario: ANSWER 与 EXPAND_PANEL 不创建过程步骤

- **WHEN** `ANSWER` 和 `EXPAND_PANEL` 结构化事件到达
- **THEN** `ANSWER` MUST 进入 answer content 且不得创建过程条目
- **AND** `EXPAND_PANEL` MUST 只挂到符合本 Requirement 的目标 `TITLE`
- **AND** 没有目标 `TITLE` 时 `EXPAND_PANEL` MUST 被忽略

### Requirement: Active process entries follow execution lifecycle

`ProcessPanel` SHALL 自动展开每个新进入活动状态的 thinking 或 runtime Capability 条目。thinking 条目只有在连续条目收到 `metadata.completed=true` 时进入 settled；runtime Capability 条目只有在 terminal projection 到达时进入 settled。正常动效模式下，成功完成的活动条目 MUST 在 settled 后保持展开 800 ms，随后自动折叠但不得删除详情；失败、超时或被阻止的 runtime Capability 条目 MUST 保持展开。并发活动条目 MUST 独立跟踪。

**需求类别**：功能性需求

#### Scenario: Thinking 流式更新后收敛

- **WHEN** 进行中的累计 thinking envelopes 更新当前连续 thinking 条目
- **THEN** 条目 MUST 保持展开并显示最新完整累计正文
- **AND** completed thinking envelope 使该条目 settled 后，条目 MUST 保留最终正文并在 800 ms 后自动折叠

#### Scenario: 累计 thinking 保持同一布局生命周期

- **WHEN** 连续累计 thinking envelopes 更新同一运行中条目，包括容量压缩后 `eventId` 改变
- **THEN** `ProcessPanel` MUST 保持已挂载条目和 disclosure state
- **AND** 实际内容高度变化 MUST 在该 render lifecycle 中复用同一 active observer

#### Scenario: 成功命令完成后折叠

- **GIVEN** 一张运行中自动展开的执行命令卡片包含任务进展和命令结果
- **WHEN** 该 Capability 成功完成
- **THEN** 卡片 MUST 保留“执行命令 · 已完成”标题和全部详情
- **AND** 详情 MUST 在 settled 后保持展开 800 ms，随后自动折叠

#### Scenario: 失败命令保持展开

- **GIVEN** 一张运行中自动展开的执行命令卡片已经显示任务进展
- **WHEN** 该 Capability 以失败、超时或阻止终态完成
- **THEN** 卡片 MUST 保持展开
- **AND** 用户 MUST 无需再次操作即可看到已经发生的进展和失败原因

#### Scenario: 并发 Capability 独立收敛

- **WHEN** 两个 runtime Capability 条目同时活动且只有一个达到终态
- **THEN** 达到成功终态的条目 MUST 独立进入自动折叠生命周期
- **AND** 达到失败、超时或阻止终态的条目 MUST 独立保持展开
- **AND** 仍在运行的条目 MUST 保持展开

### Requirement: Structured workflow process presentation remains visible

`ProcessPanel` MUST 只把不属于匹配 runtime Capability 卡片的独立 `TITLE` 或 `SUB_TITLE` 条目视为 structured workflow presentation。该独立呈现首次渲染已经 settled 时 MUST 默认展开，运行中转为 settled 时 MUST NOT 自动折叠；显式用户折叠 MUST 保持权威。相同 `toolCallId` 的 runtime Capability 卡片内部结构化内容 MUST 遵循 `Active process entries follow execution lifecycle`，MUST NOT 因包含 `TITLE` 或 `SUB_TITLE` 而获得 structured workflow 的默认展开例外。没有独立 structured workflow 条目的 settled process panel MUST 保持既有默认折叠行为。

**需求类别**：功能性需求

#### Scenario: 快速完成的独立 structured workflow 首次展开

- **GIVEN** 已完成 turn 包含不属于 runtime Capability 卡片的 TITLE 和 DETAIL
- **WHEN** `ProcessPanel` 首次以 settled phase 渲染
- **THEN** TITLE 和 DETAIL MUST 无需用户操作即可见

#### Scenario: 独立 structured workflow settled 后不自动折叠

- **GIVEN** 独立 structured workflow process panel 在运行中自动展开
- **WHEN** execution phase 变为 settled
- **THEN** panel MUST 保持展开

#### Scenario: runtime Capability 内结构化内容不改变终态 disclosure

- **GIVEN** 一张 runtime Capability 卡片内部包含 TITLE 或 SUB_TITLE
- **WHEN** Capability 成功完成
- **THEN** 卡片 MUST 按 `Active process entries follow execution lifecycle` 自动折叠
- **AND** 它 MUST NOT 被分类为独立 structured workflow presentation

#### Scenario: 用户折叠独立 structured workflow

- **GIVEN** 独立 structured workflow process panel 可见
- **WHEN** 用户显式折叠
- **THEN** panel MUST 保持用户折叠状态

#### Scenario: 普通 settled process 保持折叠默认值

- **GIVEN** settled process panel 没有独立 structured workflow 条目
- **WHEN** `ProcessPanel` 首次渲染
- **THEN** panel MUST 使用既有默认折叠行为

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：过程面板按模型步骤或 runtime Capability 的真实发生实例聚合内容；同一 runtime Capability 的开始、结构化过程、普通结果和终态形成一张卡片，并按开始时序固定位置。
- **依据 Requirements**：`TOOL_STRUCTURED_DELTA 过程面板处理`、`Active process entries follow execution lifecycle`

### 结果

- **变更类型**：修改
- **目标内容**：用户在一张执行命令卡片内先查看任务进展、再查看普通结果；成功后详情默认折叠，失败、超时或阻止时详情保持展开，独立 structured workflow 行为不变。
- **依据 Requirements**：`TOOL_STRUCTURED_DELTA 过程面板处理`、`Active process entries follow execution lifecycle`、`Structured workflow process presentation remains visible`

### 规格

- **规格项**：runtime Capability 过程卡片
- **变更类型**：修改
- **原规格值**：同一 `toolCallId` 存在结构化输出时抑制 lifecycle 卡片，结构化标题独立成项。
- **目标规格值**：同一 `toolCallId` 的 lifecycle、结构化过程、普通安全结果和终态形成一张以 started 时序定位的卡片。
- **依据 Requirements**：`TOOL_STRUCTURED_DELTA 过程面板处理`
- **规格项**：runtime Capability 默认 disclosure
- **变更类型**：修改
- **原规格值**：活动条目展开，settled 后统一自动折叠；含结构化标题的 settled panel 默认保持展开。
- **目标规格值**：运行中展开；成功 settled 800 ms 后折叠；失败、超时或阻止保持展开；用户显式选择优先。
- **依据 Requirements**：`Active process entries follow execution lifecycle`、`Structured workflow process presentation remains visible`
