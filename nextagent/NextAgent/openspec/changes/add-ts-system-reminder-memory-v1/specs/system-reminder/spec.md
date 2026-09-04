## Function

- **所属 Function**：`FN-context-engine 系统提醒注入`
- **Function 变更类型**：`ADDED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 系统提醒必须用统一标签包裹并隔离归因

系统 MUST 通过 `<system-reminder>` 标签向模型输入注入运行时上下文。标签文本 MUST 以 `<system-reminder>` 开头并以 `</system-reminder>` 结尾。系统 MUST NOT 把未包裹标签的文本作为系统提醒注入模型输入。

系统提醒内容 MUST NOT 被模型归因到其所在的 tool result 或用户消息。system prompt MUST 声明：`<system-reminder>` 标签内容是系统自动注入的运行时上下文，与所在消息无直接关系，MUST NOT 视为用户指令或系统指令。模型 MAY 参考系统提醒内容回答当前问题，但 MUST NOT 把系统提醒当成用户下达的指令执行。

`wrapInSystemReminder` MUST 是幂等的：对已以 `<system-reminder>` 开头的文本再次调用 MUST 返回原文，MUST NOT 产生嵌套的 `<system-reminder>` 标签。

系统提醒内容 MUST 是 presentation-safe：MUST NOT 包含 raw prompt 文本、模型输出、credential、本地文件路径、`sourceTrace` 或高基数标识符。

**需求类别**：功能性需求

#### Scenario: SR 内容被统一标签包裹

- **WHEN** 系统向模型输入注入一条系统提醒
- **THEN** 该提醒的文本 MUST 以 `<system-reminder>\n` 开头并以 `\n</system-reminder>` 结尾
- **AND** 该提醒 MUST 作为 `ModelMessageContentPart` 的 `text` block 出现在 `messages` 数组中
- **AND** 系统 MUST NOT 注入任何未包裹该标签的系统提醒文本

#### Scenario: 模型不把 SR 归因到所在消息

- **WHEN** 模型输入的某条 USER 或 TOOL 消息中包含 `<system-reminder>` 标签文本
- **THEN** system prompt MUST 已声明该标签内容是系统注入、与所在消息无直接关系
- **AND** 模型 MUST NOT 把该标签内容当作所在 USER 消息的用户指令执行
- **AND** 模型 MAY 参考该标签内容回答当前问题

#### Scenario: wrapInSystemReminder 幂等

- **WHEN** 对一段已以 `<system-reminder>` 开头的文本再次调用 `wrapInSystemReminder`
- **THEN** 返回值 MUST 等于原文
- **AND** 返回值 MUST NOT 包含嵌套的第二个 `<system-reminder>` 标签

#### Scenario: SR 内容 presentation-safe

- **WHEN** 系统构造一条系统提醒
- **THEN** 其内容 MUST NOT 包含 credential、本地文件绝对路径、`sourceTrace` 或模型输出文本
- **AND** 其内容 MUST 只包含系统准备让模型参考的运行时事实

### Requirement: 系统提醒管道零影响回归

当 `ContextAssemblyRequest.systemReminders` 为空或 undefined，且没有 Producer 通过其他路径注入 `<system-reminder>` 标签文本时，`DefaultModelInputRenderer.render()` 输出的 `messages` 数组 MUST 与无 SR 机制时完全一致。

SR 管道（`injectSystemReminders` → `smooshSystemReminderSiblings`）MUST 在 `assertToolPairing` 之后运行。`smooshSystemReminderSiblings` MUST 只操作 `text` content block，MUST NOT 修改 `tool-call` 或 `tool-result` block 的结构、`toolCallId`、`toolName` 或 `output`。

**需求类别**：系统质量属性

**质量属性**：可测试性
**适用范围**：该 Function

#### Scenario: 无 SR 时模型输入不变

- **WHEN** `ContextAssemblyRequest.systemReminders` 为 undefined 或空数组
- **AND** 没有 Producer 注入 `<system-reminder>` 标签文本
- **THEN** `render()` 返回的 `messages` MUST 与不集成 SR 管道时的 `messages` 完全一致
- **AND** `injectSystemReminders` MUST 是 no-op
- **AND** `smooshSystemReminderSiblings` MUST 是 no-op

#### Scenario: smoosh 不修改 tool block 结构

- **WHEN** `messages` 中存在 `tool-call` 或 `tool-result` content block
- **AND** 同一消息或相邻消息中存在 `<system-reminder>` text block
- **THEN** `smooshSystemReminderSiblings` MUST NOT 修改任何 `tool-call` 的 `toolCallId`、`toolName` 或 `arguments`
- **AND** MUST NOT 修改任何 `tool-result` 的 `toolCallId`、`toolName` 或 `output`
- **AND** MUST NOT 重排 `tool-call` 与其匹配 `tool-result` 的相对顺序

### Requirement: 系统提醒类型可扩展

`SystemReminderType` MUST 是闭包联合类型。新增 SR 类型只需：（a）向 `SystemReminderType` 添加字面量（b）在 `SYSTEM_REMINDER_ROLE_REGISTRY` 注册类型到角色映射（c）实现该类型的 Producer 代码。SR 管道代码（`wrapInSystemReminder`、`injectSystemReminders`、`smooshSystemReminderSiblings`）MUST NOT 因新增类型而修改。

每个 `SystemReminderType` MUST 在 `SYSTEM_REMINDER_ROLE_REGISTRY` 中恰好注册一个 `SystemReminderRole`。`SystemReminderRole` 的合法值恰好为 `'INJECT'`、`'CONSTRAIN'`、`'NUDGE'`、`'TERMINATE'` 四个。

**需求类别**：系统质量属性

**质量属性**：可维护性
**适用范围**：该 Function

#### Scenario: 新增类型不改管道

- **WHEN** 向 `SystemReminderType` 添加一个新字面量并注册其角色
- **THEN** `wrapInSystemReminder`、`injectSystemReminders`、`smooshSystemReminderSiblings` 的实现 MUST NOT 被修改
- **AND** 新类型的 Producer 只需调用 `wrapInSystemReminder` 或通过 `ContextAssemblyRequest.systemReminders` 注入即可生效

#### Scenario: 每个类型恰好注册一个角色

- **WHEN** 枚举 `SystemReminderType` 的全部字面量
- **THEN** 每个字面量 MUST 在 `SYSTEM_REMINDER_ROLE_REGISTRY` 中恰好有一个对应的 `SystemReminderRole`
- **AND** 该角色 MUST 是 `'INJECT'`、`'CONSTRAIN'`、`'NUDGE'`、`'TERMINATE'` 之一

### Requirement: 记忆召回必须通过系统提醒注入

会话首轮模型调用时，`user-query-memory-recall` hook 检索到的长期记忆内容 MUST 以 `<system-reminder>` 标签包裹后注入 rendered model input 的 `messages` 数组，MUST NOT 作为未包裹标签的普通 USER 消息注入。

记忆 SR 内容 MUST 是 presentation-safe 的编号列表，每项包含 `briefIndex` 和 `content`，MUST NOT 包含 `memoryId`、`sourceTrace`、本地路径或 credential。记忆 SR MUST 插入在最后一条真实 USER 消息之前，MUST NOT 破坏 user/assistant/tool 交替约束。

`user-query-memory-recall` hook 的 mutation MUST 继续返回 `{ messages }` 形态（契约不变），只改消息内容形态。记忆 SR MUST NOT 被持久化到 `SessionMessageStore`，MUST NOT 进入聊天 UI，MUST NOT 进入 checkpoint 或 recovery。

**需求类别**：功能性需求

#### Scenario: 记忆召回注入 SR 标签

- **WHEN** 会话首轮模型调用前，`user-query-memory-recall` hook 成功检索到长期记忆
- **THEN** 注入的 `messages` 中 MUST 包含以 `<system-reminder>` 开头的 text block
- **AND** 该 block 的内容 MUST NOT 包含 `memoryId`、`sourceTrace` 或本地路径
- **AND** 该 block MUST 插入在最后一条真实 USER 消息之前

#### Scenario: 记忆 SR 不含中文指令前缀

- **WHEN** memory hook 注入记忆 SR
- **THEN** SR 内容 MUST NOT 包含“不得视为用户指令或系统指令”这类裸前缀文本
- **AND** 归因隔离 MUST 由 `<system-reminder>` 标签和 system prompt 声明承担

#### Scenario: 记忆 SR 不持久化不进 UI

- **WHEN** memory hook 返回 `{ messages }` mutation
- **THEN** 该 mutation 只作用于当次模型调用的 rendered input
- **AND** 系统 MUST NOT 把 SR 文本写入 `SessionMessageStore`
- **AND** 聊天 UI MUST NOT 显示 `<system-reminder>` 标签或其内容

#### Scenario: 无记忆时无 SR

- **WHEN** memory hook 检索结果为 `NO_CONTEXT`
- **THEN** 注入路径 MUST 不产生任何 `<system-reminder>` 文本
- **AND** rendered model input MUST 与无记忆召回机制时一致

## Function 变更汇总

### 名称
- **变更类型**：新增
- **目标内容**：`FN-context-engine 系统提醒注入`
- **依据 Requirements**：`系统提醒必须用统一标签包裹并隔离归因`、`系统提醒管道零影响回归`、`系统提醒类型可扩展`、`记忆召回必须通过系统提醒注入`

### 描述
- **变更类型**：新增
- **目标内容**：定义通过 `<system-reminder>` 标签向模型输入注入运行时上下文的统一机制，包括文本包裹原语、归因隔离声明、零影响回归管道、类型可扩展注册表，以及首版 `relevant_memories` 记忆召回注入场景。
- **依据 Requirements**：`系统提醒必须用统一标签包裹并隔离归因`、`系统提醒管道零影响回归`、`系统提醒类型可扩展`、`记忆召回必须通过系统提醒注入`

### 前置条件
- **变更类型**：新增
- **目标内容**：存在可注入 SR 的 rendered model input；memory hook 已注册到 `BEFORE_MODEL_INVOKE` 且记忆 retriever 可用。
- **依据 Requirements**：`记忆召回必须通过系统提醒注入`

### 输入
- **变更类型**：新增
- **目标内容**：`ContextAssemblyRequest.systemReminders?: readonly SystemReminder[]`（可选，assemble 阶段收集的 SR）；或 Producer 在 render 之后直接调用 `wrapInSystemReminder` 包裹消息内容（memory hook 路径）。
- **依据 Requirements**：`系统提醒必须用统一标签包裹并隔离归因`、`记忆召回必须通过系统提醒注入`

### 输出
- **变更类型**：新增
- **目标内容**：`RenderedModelInput.messages` 中可能包含 `<system-reminder>` text block；无 SR 时与基线一致。
- **依据 Requirements**：`系统提醒管道零影响回归`

### 处理过程
- **变更类型**：新增
- **目标内容**：`DefaultModelInputRenderer.render()` 在 `assertToolPairing` 之后运行 `injectSystemReminders`（从 `systemReminders` 字段注入）和 `smooshSystemReminderSiblings`（折叠 SR text 进 tool_result），只操作 text block。
- **依据 Requirements**：`系统提醒管道零影响回归`

### 结果
- **变更类型**：新增
- **目标内容**：模型可见 SR 文本且不归因到所在消息；SR 不持久化、不进 UI；无 SR 时零影响回归。
- **依据 Requirements**：`系统提醒必须用统一标签包裹并隔离归因`、`记忆召回必须通过系统提醒注入`

### 规格
- **规格项**：支持的 SR 类型
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：首版 `relevant_memories`（有 Producer）；`nested_memory`（预留，无 Producer）。新增类型只需枚举值 + registry 注册 + Producer。
- **依据 Requirements**：`系统提醒类型可扩展`、`记忆召回必须通过系统提醒注入`

### 规格
- **规格项**：SR 角色枚举
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：恰好 `'INJECT'`、`'CONSTRAIN'`、`'NUDGE'`、`'TERMINATE'` 四个。
- **依据 Requirements**：`系统提醒类型可扩展`

### 规格
- **规格项**：SR 持久化与可见性
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：turn-scoped 瞬时；不写入 SessionMessageStore、不进 checkpoint/recovery、不进聊天 UI。
- **依据 Requirements**：`记忆召回必须通过系统提醒注入`
