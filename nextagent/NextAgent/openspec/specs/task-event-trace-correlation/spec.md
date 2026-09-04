# task-event-trace-correlation Specification

## Purpose
定义任务通道事件与请求追踪之间的受控关联和可诊断投影，使运维人员能关联任务事件而不把高敏感运行内容暴露到公共接口。
## Requirements
### Requirement: 任务通道 MUST 接收受控 taskEventId

任务通道创建任务的 JSON 和 multipart 请求 MUST 在每个创建项唯一的 `taskMessages[0].metadata.eventId` 位置接受 OPTIONAL 业务事件标识。该值存在时长度 MUST 为 1 至 32 个字符，并 MUST 只包含 ASCII 字母、数字、连字符、下划线、空格、点或冒号，等价校验规则为 `^[A-Za-z0-9_.: -]{1,32}$`。trace 启用时，任务通道 MUST 在该 item 的会话或运行创建前把有效值映射为内部 `taskEventId`；trace 关闭时 MUST 不执行该映射。`metadata` 的其他成员 MUST NOT 进入提交命令、运行上下文、timeline、span、日志、指标、审计或下游请求头。

缺少 `taskMessages[0].metadata.eventId` 时，任务创建 MUST 保持既有业务行为。无效值 MUST 在为该 item 创建任何 session、request run、message 或 timeline event 前被拒绝。JSON batch MUST 保持既有逐项处理和部分失败语义；一个 item 的无效值 MUST NOT 阻止其他有效 item。multipart 创建仍 MUST 表示一个任务项。

#### Scenario: 有效 eventId 被映射

- **WHEN** trace 已启用，且任务通道创建项收到长度为 1 至 32、只包含允许字符的 `taskMessages[0].metadata.eventId`
- **THEN** 已接收运行的提交执行上下文 MUST 携带相同值的内部 `taskEventId`
- **AND** 该映射 MUST NOT 信任或转换 `metadata` 的其他成员

#### Scenario: 无效 eventId 没有持久化副作用

- **WHEN** `taskMessages[0].metadata.eventId` 是空字符串、超过 32 个字符或包含允许集合之外的字符
- **THEN** 任务通道 MUST 拒绝请求
- **AND** 系统 MUST NOT 创建 session、request run、message 或 timeline event

#### Scenario: 缺少 eventId 时任务仍可执行

- **WHEN** 任务创建项没有 `taskMessages[0].metadata.eventId`
- **THEN** 任务通道 MUST 按既有契约创建和执行任务
- **AND** 该运行的提交执行上下文 MUST 不包含 `taskEventId`

#### Scenario: trace 关闭时有效 eventId 不进入执行

- **WHEN** trace 已关闭且任务创建项携带有效 `taskMessages[0].metadata.eventId`
- **THEN** 任务通道 MUST 完成字段校验但 MUST 不把该值映射到提交执行上下文
- **AND** 该值 MUST 不参与提交幂等语义
- **AND** 任务 MUST 按没有 eventId 的既有契约继续执行

#### Scenario: Batch item 关联相互隔离

- **WHEN** trace 已启用，且一个带有效 W3C carrier 的 JSON batch 包含两个有效创建项，并分别携带不同的 `taskMessages[0].metadata.eventId`
- **THEN** 两个 request span MAY 使用同一个上游 parent
- **AND** 每个运行的执行上下文、timeline、timeline 权威执行 span 和下游请求 MUST 只使用自身 item 的 taskEventId
- **AND** 任一 item 的 eventId 校验或运行失败 MUST NOT 回滚另一个成功 item

### Requirement: taskEventId MUST 投影为 timeline eventId 属性

trace 启用且运行时提交上下文携带 `taskEventId` 时，`REQUEST_ACCEPTED` MUST 在 `inlinePayload.attributes.eventId` 中保存相同值，并 MUST 成为该 run 中 taskEventId 的唯一权威恢复锚点。请求 accepted 响应和后台执行 MUST 在该 event 成功持久化后开始。

当前执行上下文或从该锚点恢复的上下文携带 `taskEventId` 时，每条适用的后续持久化 timeline event MUST 在 `inlinePayload.attributes.eventId` 中保存相同值。该规则 MUST 覆盖请求终止、模型 lifecycle、能力 lifecycle 和本地工作流节点 lifecycle。`RequestRun`、`RequestRunRecord`、checkpoint、message、数据库 ActiveContext 和 SQLite 专用列 MUST NOT 保存 taskEventId。

`inlinePayload.attributes.eventId` MUST 只来自运行绑定的 `taskEventId`。业务 event producer、模型、能力参数和客户端 metadata 的其他成员 MUST NOT 提供或覆盖该值。顶层 `RunTimelineEvent.eventId` MUST 继续表示 timeline event 自身标识。

缺少绑定值或 trace 关闭时，timeline event MUST 省略 `inlinePayload.attributes.eventId`。trace 关闭时系统 MUST 不映射、恢复或绑定 `taskEventId`。属性 enrichment 失败 MUST NOT 改变 timeline 顺序、生命周期、终止提交或请求结果。

#### Scenario: 运行中的任务 timeline 可按 eventId 查询

- **WHEN** trace 已启用，且已绑定 `taskEventId` 的任务持久化 `REQUEST_ACCEPTED`、两个节点的 `CAPABILITY_STARTED` 和 `CAPABILITY_COMPLETED` 以及请求终止 event
- **THEN** 每条 event MUST 包含相同的 `inlinePayload.attributes.eventId`
- **AND** 轨迹查询通过既有 AgentMemory timeline 查询接口读取这些持久化 event 时 MUST 不依赖消息 payload

#### Scenario: REQUEST_ACCEPTED 是唯一恢复锚点

- **WHEN** trace 已启用，且 runtime 需要为 retry、edit/resubmit、pending input resume 或运行上下文重建恢复 taskEventId
- **THEN** runtime MUST 通过既有 timeline query 按 runId 读取最早的至多 9 条持久化 event
- **AND** 第一个 `REQUEST_ACCEPTED` 前 MUST 只允许零至八条 `HOOK_INVOKED`
- **AND** 只有该 `REQUEST_ACCEPTED.inlinePayload.attributes.eventId` 有效时才能恢复
- **AND** runtime MUST NOT 从该锚点后的 lifecycle event、message、checkpoint、RequestRun、数据库 ActiveContext 或 AgentMemory 推断该值

#### Scenario: 业务生产者不能覆盖 eventId

- **WHEN** event producer 提供与运行绑定值不同的 `inlinePayload.attributes.eventId`
- **THEN** 持久化 event MUST 保存运行绑定值
- **AND** producer 值 MUST NOT 出现在 span、日志、指标、审计或下游请求头

### Requirement: taskEventId MUST 作为 eventId span attribute

trace 启用且运行绑定 `taskEventId` 时，每个 timeline 权威执行 span MUST 包含字符串 attribute `eventId`，其值 MUST 等于该运行的 `taskEventId`。该规则 MUST 覆盖请求、直接模型、直接能力和本地工作流真实执行节点 span。辅助观测 span MUST 省略 `eventId`，避免在同一请求中重复高基数属性。

`eventId` span attribute MUST 只来自持久化 timeline lifecycle 中的可信属性。`TraceProjector`、客户端、模型输出、能力输入和任意 observation payload MUST NOT 推导或覆盖该值。缺少 `taskEventId` 时，timeline 权威执行 span MUST 省略 `eventId`。

#### Scenario: 一个运行的权威执行 span 使用同一 eventId

- **WHEN** 已绑定 `taskEventId` 的请求执行一个直接模型调用和两个本地工作流节点
- **THEN** request、model 和两个 node timeline 权威执行 span MUST 包含相同的 `eventId`
- **AND** system/gateway 辅助 span MUST 省略该 attribute

#### Scenario: 同一上游 trace 下的运行相互隔离

- **WHEN** 两个并发请求运行使用同一个上游 trace 和不同的 `taskEventId`
- **THEN** 每个运行的 timeline、timeline 权威执行 span 和下游请求 MUST 只使用自身绑定值
- **AND** 任一值 MUST NOT 出现在另一运行的关联中

### Requirement: taskEventId MUST 通过 x-task-event-id 传播

trace 启用且当前执行引用能够解析到已绑定 `taskEventId` 时，OpenRouter、CLIP、SkillHub HTTP v1、RobotRouter guardrail 和本地工作流使用的远端 RAG 检索出站边界 MUST 把 `x-task-event-id` 设置为该值。系统值 MUST 覆盖大小写不敏感的同名业务请求头。

当前执行引用没有绑定值或 trace 关闭时，出站边界 MUST 删除不可信的 `x-task-event-id` 并省略系统值。

#### Scenario: CLIP 接收系统 task event header

- **WHEN** CLIP 在已绑定 `taskEventId` 的工作流节点执行范围内被调用
- **THEN** CLIP 请求 MUST 恰好包含一个值为绑定值的 `x-task-event-id`
- **AND** 节点输入中的同名请求头 MUST NOT 覆盖该值

#### Scenario: trace 关闭时不使用 task event

- **WHEN** trace 已关闭且任务 metadata 提供有效 `eventId`
- **THEN** 运行上下文和 timeline MUST 不包含 taskEventId 或 `attributes.eventId`
- **AND** 下游请求 MUST 不包含 `x-task-event-id`
- **AND** 下游请求 MUST 不包含系统生成的 `traceparent` 或 `tracestate`

### Requirement: taskEventId MUST 遵循运行延续语义

trace 启用时，retry 和 edit/resubmit MUST 在创建任何新运行事实前从来源 run 的有界接收前缀读取 `REQUEST_ACCEPTED` 锚点。锚点包含有效 eventId 时，新运行的执行上下文和 `REQUEST_ACCEPTED` MUST 使用相同值。pending input resume 和运行上下文重建 MUST 从当前 run 的有界接收前缀恢复。fork 后创建的新运行 MUST 保持 taskEventId 缺失，并且 MUST NOT 读取来源或复制的历史 timeline event 恢复该值。trace 关闭时 MUST 不执行 taskEventId 恢复。

锚点查询失败、有界接收前缀中出现 `HOOK_INVOKED` 以外的前置类型、前九条内没有 `REQUEST_ACCEPTED`，或 `REQUEST_ACCEPTED.inlinePayload.attributes.eventId` 无效或缺失时，系统 MUST 把 taskEventId 视为缺失，输出不包含候选原值的有界安全降级证据，并 MUST NOT 扫描锚点后的 lifecycle event 猜测。系统 MUST NOT 仅因 taskEventId 无法恢复而拒绝 retry、edit/resubmit、pending input resume 或运行上下文重建。

trace 启用时，使用同一个创建任务幂等键重复提交，缺失值与缺失值 MUST 被视为相同语义，相同值 MUST 被视为相同语义，不同值 MUST 产生幂等冲突。trace 关闭时 eventId MUST 不参与提交幂等语义。持久化的幂等语义 MUST NOT 包含 taskEventId 原值，也 MUST NOT 成为 taskEventId 的恢复或传播来源。

#### Scenario: retry 和 edit 继承

- **WHEN** trace 已启用，且带 `taskEventId` 的来源运行被 retry 或 edit/resubmit
- **THEN** runtime MUST 从来源 `REQUEST_ACCEPTED` 恢复相同 `taskEventId`
- **AND** 新运行的 `REQUEST_ACCEPTED` MUST 保存相同的 `inlinePayload.attributes.eventId`
- **AND** 新运行的 timeline、timeline 权威执行 span 和下游请求 MUST 使用该值

#### Scenario: pending resume 从当前锚点恢复

- **WHEN** trace 已启用，且 pending input resume 重建一个带 taskEventId 的运行上下文
- **THEN** runtime MUST 从当前 run 的 `REQUEST_ACCEPTED` 恢复该值
- **AND** 恢复后的 timeline、timeline 权威执行 span 和下游请求 MUST 使用该值

#### Scenario: 锚点不可用时不猜测

- **WHEN** 锚点查询失败，或来源或当前 run 的有界接收前缀不包含有效的 taskEventId 锚点
- **THEN** 恢复后的上下文 MUST 不包含 taskEventId
- **AND** runtime MUST NOT 从该 run 中锚点后的 lifecycle event 恢复候选值
- **AND** 对应的 retry、edit/resubmit、pending input resume 或运行上下文重建 MUST 继续执行

#### Scenario: fork 清除

- **WHEN** 会话从带 `taskEventId` 的历史位置 fork，并在子会话创建新运行
- **THEN** 新运行 MUST 不绑定来源 `taskEventId`
- **AND** 复制的历史 timeline event MUST 保持不可变

#### Scenario: 幂等键不能替换 taskEventId

- **WHEN** trace 已启用，且客户端对同一个创建项使用同一个幂等键提交不同的有效 `taskMessages[0].metadata.eventId`
- **THEN** 系统 MUST 返回幂等冲突
- **AND** 首次运行及其关联值 MUST 保持不变
- **AND** RequestRun、RequestRunRecord 和持久化幂等语义 MUST NOT 包含任一 taskEventId 原值
