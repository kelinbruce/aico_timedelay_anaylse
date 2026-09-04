## Function

- **所属 Function**：`FN-1.1 查看会话消息流`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 可恢复过程事件引用唯一消息正文

当一次模型 Tool 轮次的公开说明、Tool 调用参数或 Tool 终态结果已经形成持久化 `SessionMessage` 时，系统 MUST 先确认该消息写入成功，再发布对应的可恢复过程事件。该事件 MUST 通过 `messageId` 引用该消息，MUST NOT 在持久化事件 payload 中重复保存可从该消息恢复的正文、Tool 参数或 Tool 结果。

`messageId` MUST 是非空 `MessageId`。引用事件与目标消息 MUST 具有相同的 Owner Scope、Agent Scope、`sessionId`、`requestId` 和 `runId`；Tool 事件还 MUST 具有一致的 `toolCallId`。不满足全部关联条件的引用 MUST 被视为无效引用。

公开说明的引用事件 MUST 是携带非空 `stepId` 和 `completed=true` 的 `LLM_CONTENT_DELTA`；Tool 调用的引用事件 MUST 是 `CAPABILITY_STARTED`；已形成结果消息的 Tool 终态引用事件 MUST 是 `CAPABILITY_COMPLETED`。Tool 在结果消息形成前失败时，`CAPABILITY_COMPLETED` MUST 不携带 `messageId`，并且 MUST 只表达安全终态。

当模型或 Tool 已产生可公开的进行中累计内容时，系统 MAY 使用 live-only delta 投影该内容；系统不选择投影或上游没有产生该内容时，系统 MUST NOT 虚构进行中正文。该 delta MUST NOT 作为历史、派生会话过程快照或模型上下文事实。最终 Assistant Message 继续遵循既有终态消息语义，不适用本 Requirement。

**需求类别**：功能性需求

#### Scenario: Tool 轮次公开说明先写消息再发布引用事件

- **WHEN** 模型在同一轮输出非空公开说明和至少一个 Tool 调用
- **THEN** 系统 MUST 先持久化包含该轮公开说明与 Tool 调用事实的消息
- **AND** completed `LLM_CONTENT_DELTA` MUST 通过该消息的 `messageId` 引用公开说明
- **AND** 每个 `CAPABILITY_STARTED` MUST 通过同一消息的 `messageId` 和自身 `toolCallId` 引用对应 Tool 调用
- **AND** 持久化事件 payload MUST NOT 再包含该公开说明正文或 Tool 参数副本

#### Scenario: Tool 终态事件引用结果消息

- **WHEN** Tool 调用形成持久化 `CAPABILITY_RESULT` 消息和可恢复 `CAPABILITY_COMPLETED` 终态事件
- **THEN** `CAPABILITY_COMPLETED` MUST 携带该结果消息的 `messageId`
- **AND** 事件与消息的 `toolCallId`、Owner Scope、Agent Scope、会话、请求和运行坐标 MUST 一致
- **AND** 持久化事件 payload MUST NOT 再包含可从结果消息恢复的 Tool 结果正文

#### Scenario: 进行中 delta 不成为持久化正文

- **WHEN** 模型或 Tool 在持久化消息形成前发布累计的进行中内容
- **THEN** 该内容事件 MUST 为 live-only
- **AND** 历史读取和派生会话过程快照 MUST NOT 把该内容当作持久化正文

#### Scenario: 消息写入失败阻止引用事件

- **WHEN** 公开过程内容对应的消息写入失败
- **THEN** 系统 MUST NOT 发布声称引用该消息的可恢复过程事件
- **AND** 本次执行 MUST 进入既有显式安全失败路径

### Requirement: Tool 轮次执行说明与 Tool 调用连续呈现

当模型在同一 Tool 轮次输出公开说明和 Tool 调用时，系统 MUST 按“该轮前置 thinking、公开执行说明、关联 Tool 调用”的规范顺序向用户呈现过程。公开执行说明 MUST 使用关联消息中的安全公开正文，并 MUST NOT 被呈现为具有独立标题、独立状态图标、完成对勾或独立展开控制的过程步骤。

执行说明 MUST 随执行详情大面板统一显示或隐藏；大面板展开时，该说明 MUST 直接可见。系统 MUST NOT 为说明增加“接下来”或其他不属于关联消息正文的固定界面文案。既有 thinking、Tool、PIU 和普通过程步骤的图标、状态与 disclosure 语义 MUST 保持不变。

待定桥接内容和完成执行说明 MUST 使用与最终答案相同的公开正文排版和 Markdown 渲染语义，包括字体、字号、行高、字重、主文字色和换行规则。执行说明正文 MUST 与展开后的 thinking 正文使用同一内容列左边界，并且 MUST NOT 使用独立底色、独立边框、圆角容器或额外水平内边距表达其归属。

模型公开输出尚未完成、系统尚不能确定其后是否存在 Tool 调用时，具有非空 `stepId` 且不具有 `final=true` 的进行中累计内容 MUST 在执行详情中使用无独立图标的待定桥接位置流式呈现，并且 MUST NOT 同时出现在最终答案位置。后续产生 Tool 调用时，同一 `stepId` 的完成说明 MUST 在该位置原地接管进行中内容；后续没有产生 Tool 调用时，最终 Assistant 输出 MUST 接管既有最终答案位置，并且执行详情 MUST 不再保留该待定内容。语义确认过程 MUST NOT 清空后重新播放已经呈现的文字。

SSE 与 WebSocket 的共享 Web 投影 MUST 保留运行时 `LLM_CONTENT_DELTA` 中安全的 `final` 布尔标识。浏览器 MUST 使用该 canonical 标识区分待定过程内容与最终 Assistant 输出，并 MUST NOT 仅根据 `REQUEST_COMPLETED` 到达或刷新后的历史快照推断终局语义。

最终 Assistant 输出接管待定内容时 MUST 保持既有最终答案的左对齐位置。接管过程 MUST NOT 改变正文的字体、字号、行高、透明度或换行规则，也 MUST NOT 清空、重建或重新打字；非 reduced-motion 环境 MAY 通过不超过 200 ms 且只改变 `transform` 的短距离横向过渡对齐既有答案位置，并 MUST 复用既有执行详情高度与滚动锚点补偿保持正文首行的纵向阅读焦点。reduced-motion 环境 MUST 直接完成最终对齐且不得播放位置动画。

只有同时包含 Tool 调用事实的公开内容适用本 Requirement。没有后续 Tool 调用的模型公开输出 MUST 继续遵循最终 Assistant Message 的既有输出与持久化语义。

**需求类别**：功能性需求

#### Scenario: 执行说明连接思考与同轮 Tool 调用

- **WHEN** 一个 Tool 轮次具有已完成 thinking、非空公开说明和至少一个 Tool 调用
- **THEN** 用户 MUST 先看到该轮 thinking，再看到消息中的安全公开说明，随后看到关联 Tool 调用
- **AND** 公开说明 MUST NOT 显示独立标题、独立状态图标、完成对勾或展开按钮
- **AND** 公开说明对应的完成事件 MUST 在用户可见序列中位于同轮关联 Tool 的 `CAPABILITY_STARTED` 之前
- **AND** 用户看到的说明正文 MUST NOT 包含系统额外添加的固定引导文案
- **AND** 说明正文 MUST 与展开后的 thinking 正文左边界对齐
- **AND** 说明正文 MUST 使用最终答案的公开正文排版且不得具有独立底色或边框

#### Scenario: 进行中公开输出保持待定桥接位置

- **WHEN** 模型正在流式输出具有非空 `stepId` 且不具有 `final=true` 的累计公开内容
- **AND** 系统尚未确认该轮是否产生 Tool 调用
- **THEN** 用户 MUST 在执行详情中的无独立图标桥接位置看到该内容
- **AND** 最终答案位置 MUST NOT 同时显示该内容
- **AND** 同一 `stepId` 的后续完成说明 MUST 原地接管该桥接位置且不得重新播放正文

#### Scenario: 没有后续 Tool 调用时保持最终答案语义

- **WHEN** 模型公开输出完成后没有产生 Tool 调用
- **THEN** 该输出 MUST 继续显示在既有最终答案位置
- **AND** 系统 MUST NOT 将其投影为执行详情中的桥接说明
- **AND** 执行详情 MUST 移除同一轮的待定桥接内容且不得在最终答案位置重新播放已经呈现的正文
- **AND** 最终答案 MUST 保持既有左对齐位置
- **AND** 接管过程 MUST 不改变正文排版、透明度或换行，并 MUST 保持正文首行的纵向阅读焦点

#### Scenario: Web 投影保留最终答案标识

- **GIVEN** runtime 发布携带 `final=true` 的 `LLM_CONTENT_DELTA`
- **WHEN** channel 将该事件投影为 SSE 或 WebSocket `StreamEnvelope`
- **THEN** 投影 payload MUST 保留 `final=true`
- **AND** 浏览器 MUST 在 live 状态立即移除未完成待定过程副本
- **AND** 最终答案 MUST 只在既有答案位置显示一次

#### Scenario: 减少动态效果时直接完成最终答案接管

- **GIVEN** 用户环境声明 `prefers-reduced-motion`
- **WHEN** 最终 Assistant 输出接管执行详情中的待定桥接内容
- **THEN** 系统 MUST 直接使用既有最终答案位置和排版显示正文
- **AND** 系统 MUST NOT 播放横向位置过渡、淡入淡出或重新打字效果

### Requirement: Web stream 在服务端解析过程消息引用

SSE 与 WebSocket 的共享过程投影 MUST 在服务端解析过程事件的 `messageId`，并且 MUST 仅从通过关联校验的消息生成用户可见正文。两种 transport MUST 对同一事件与消息产生相同的 `StreamEnvelope` 内容和相同的安全降级结果。

浏览器 MUST NOT 接收原始隐藏消息、消息可见性控制字段或未投影的 Tool 输入输出来完成关联。过程消息关联 MUST NOT 改变最终 Assistant Message、thinking、terminal event 或既有消息可见性语义。

`RuntimeSessionPort` MUST 提供 server-only `resolveProcessMessages(query)` 关联入口。`query` MUST 包含可信 `identityContext`、`sessionId`、`requestId`、`runId` 和去重后的 `messageIds`，并且 MAY 包含 `includeLegacyCandidates` 与 `signal`。引用模式 MUST 接受一至一千个 `messageIds`，结果 MUST 只包含同时匹配全部可信坐标和请求标识的 `SessionMessage` 领域对象。仅当 history route 需要关联无消息引用的旧事件时，`includeLegacyCandidates=true` MAY 与空 `messageIds` 组合，并返回当前可信运行内至多一千条完整候选；候选超过上限时 MUST 安全失败，不得返回截断集合。缺少 `signal` 时调用 MUST 正常执行，提供 `signal` 时取消 MUST 只终止本次关联读取。结果 MUST NOT 返回 gateway `*Record` 或数据库字段。该入口 MUST NOT 作为 Web route 暴露，也 MUST NOT 接受客户端直接提供的 `messageIds` 或 legacy candidate 开关。

消息关联有效时，用户可见 payload MUST 不包含 `contentUnavailable`。消息关联无效时，用户可见 payload MUST 包含布尔值 `contentUnavailable=true`，并且 MUST 不包含消息正文、Tool 参数或 Tool 结果正文。

**需求类别**：功能性需求

#### Scenario: 实时投影读取同一条消息正文

- **WHEN** SSE 与 WebSocket 分别投影同一个有效消息引用事件
- **THEN** 两种 transport MUST 从同一个目标消息生成内容
- **AND** 两种 transport MUST 输出相同的安全正文、过程类型、顺序和状态
- **AND** 浏览器响应 MUST NOT 包含该目标消息的原始隐藏记录

#### Scenario: 无效引用降级为仅状态过程项

- **WHEN** `messageId` 不存在、目标消息作用域不匹配、消息类型不匹配或 `toolCallId` 不一致
- **THEN** Web stream MUST NOT 输出目标消息或事件中残留的正文
- **AND** 对应过程项 MUST 保留可安全公开的类型、顺序和状态
- **AND** 系统 MUST 输出安全的内容不可用标识或诊断，不得泄露目标消息是否属于其他 owner 或 Agent

#### Scenario: 服务端批量关联入口不成为公开消息读取 API

- **WHEN** 共享 Web 投影需要解析同一运行的一至一千个事件消息引用
- **THEN** server-only 关联入口 MUST 只返回与可信会话、请求、运行和请求标识同时匹配的 `SessionMessage`
- **AND** Web route MUST NOT 允许客户端直接调用该入口或提交任意 `messageIds`
- **AND** 关联结果 MUST NOT 包含 gateway `*Record` 或数据库字段

#### Scenario: 旧事件候选查询保持完整且有界

- **WHEN** history route 需要为同一运行中没有 `messageId` 的旧过程事件建立唯一关联
- **THEN** server-only 入口 MAY 在空 `messageIds` 下返回当前可信运行内至多一千条完整候选
- **AND** 候选超过一千条时 MUST 安全失败并使旧事件降级为仅状态结果
- **AND** 系统 MUST NOT 从截断候选集合推断唯一消息

### Requirement: 过程消息引用保持作用域隔离

系统 MUST 对每次过程消息关联执行 Owner Scope、Agent Scope、会话、请求和运行坐标校验。任何一个坐标不一致时，系统 MUST 拒绝正文关联，并且 MUST NOT 通过 Web API、stream、日志、metric、audit 或 SafeError 暴露未授权消息内容、原始 Tool 输入输出或模型正文。

**需求类别**：系统质量属性

**质量属性**：安全

**适用范围**：该 Function

#### Scenario: 跨会话引用不泄露正文

- **WHEN** 一个过程事件引用同一用户或不同用户的另一会话消息
- **THEN** 系统 MUST 拒绝正文关联
- **AND** 用户可见结果 MUST 仅保留安全状态
- **AND** 响应与诊断 MUST NOT 暴露被引用消息的正文或归属信息

#### Scenario: 跨 Agent 引用不泄露正文

- **WHEN** 一个过程事件引用同一 Owner Scope 下另一 Agent 的消息
- **THEN** 系统 MUST 拒绝正文关联
- **AND** 系统 MUST NOT 将该消息投影到 SSE 或 WebSocket

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：系统按时序推送会话处理过程；已经持久化为消息的公开过程正文通过受作用域校验的消息引用投影，尚未定性的进行中公开输出位于待定桥接位置，同轮执行说明连续连接前置 thinking 与后续 Tool 调用，进行中临时内容保持 live-only，SSE 与 WebSocket 输出一致。
- **依据 Requirements**：`可恢复过程事件引用唯一消息正文`、`Tool 轮次执行说明与 Tool 调用连续呈现`、`Web stream 在服务端解析过程消息引用`、`过程消息引用保持作用域隔离`

### 输出

- **变更类型**：修改
- **目标内容**：会话流输出按序的安全过程事件；尚未定性的进行中公开输出和有效的 Tool 轮次公开说明以无独立步骤语义的同一桥接位置呈现，最终答案位置不重复显示待定内容；无效引用产生仅含安全类型、顺序、状态和内容不可用结果的过程项。
- **依据 Requirements**：`Tool 轮次执行说明与 Tool 调用连续呈现`、`Web stream 在服务端解析过程消息引用`、`过程消息引用保持作用域隔离`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统先把具有 `stepId` 的进行中公开输出投影到待定桥接位置；确认 Tool 轮次后由完成说明原地接管，确认最终答案后由最终答案位置接管并移除待定内容。系统在发布引用事件前确认公开过程消息可用，投影前校验消息与事件的作用域及业务坐标，只对有效关联生成正文，并按同轮事件顺序连续呈现说明与 Tool 调用。
- **依据 Requirements**：`可恢复过程事件引用唯一消息正文`、`Tool 轮次执行说明与 Tool 调用连续呈现`、`Web stream 在服务端解析过程消息引用`、`过程消息引用保持作用域隔离`

### 结果

- **变更类型**：修改
- **目标内容**：引用有效时用户看到与唯一消息正文一致且说明—Tool 关系连续的实时过程；关联失败时过程顺序和状态仍可见，但未授权或损坏正文不可见。
- **依据 Requirements**：`Tool 轮次执行说明与 Tool 调用连续呈现`、`Web stream 在服务端解析过程消息引用`、`过程消息引用保持作用域隔离`
