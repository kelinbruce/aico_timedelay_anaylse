## ADDED Requirements

### Requirement: AskUserQuestion 可纠正输入错误进入安全模型纠错

当 canonical `AskUserQuestion` 的模型参数可通过修改参数结构或普通字段约束纠正时，Agent/core MUST 先持久化模型返回的原始 assistant tool-use batch，再在创建 pending input 和执行该 batch 任一 Tool 之前完成无副作用校验。系统 MUST 为失败 AskUserQuestion 写入与原 `toolCallId` 配对的失败 `CAPABILITY_RESULT`，MUST 向下一模型轮次提供具体、安全、有界的纠错信息，并 MUST NOT 立即把 request 终止为 `REQUEST_FAILED`。

失败 result MUST 使用普通 Capability 的 `status/result/safeError` 结构，`safeError.code` MUST 为 `CAPABILITY_INPUT_INVALID`，`safeError.category` MUST 为 `VALIDATION`，`safeError.retryable` MUST 为 `false`。`safeError.errorMessage` MUST 使用 `Capability input failed validation: ` 前缀，MUST 标识安全字段路径或违反的约束，最多包含 3 个去重问题且总长度不超过 768 字符。纠错信息 MUST NOT 包含被拒绝的原始值、prompt、option label/value、placeholder、credential、token、路径、附件内容、provider 响应或 raw exception。

同一 assistant batch 中因 AskUserQuestion 预检失败而未执行的其它 tool call MUST 各自获得一个配对的失败 result，且 MUST NOT 被执行。系统 MUST NOT 使用普通 `USER` 或 request-local generated message 代替上述 tool result。

同一个 request 最多允许连续 3 次 AskUserQuestion 参数纠错；模型提交合法参数后计数 MUST 重置。第 4 次连续可纠正失败 MUST 以 safe `INVALID_INPUT` 终止 request。设计入口：`openspec/designs/architecture/capability-spi.md`。

#### Scenario: questions 使用无法解析的字符串

- **WHEN** 模型把 `questions` 作为无法解析成有界 JSON array 的字符串提交
- **THEN** 系统 MUST 告诉模型 `questions` 需要 native JSON array 且不得 `JSON.stringify`
- **AND** 系统 MUST NOT 回显该字符串
- **AND** 系统 MUST 持久化该次 assistant tool-use batch 和配对失败 result
- **AND** 系统 MUST NOT 创建 pending input、执行该 batch 的其它 Tool 或进入前端提问状态
- **AND** 下一模型轮次 MUST 能提交修正后的 AskUserQuestion。

#### Scenario: 禁止字段和错误层级可纠正

- **WHEN** 模型在根对象、question 或 option 中提交 Schema 未定义的字段
- **THEN** 系统 MUST 以有界字段路径指出该字段不受支持并要求移除后重试
- **AND** 根级 `multiple` 与 `questions[0].header` 等错误 MUST 分别标识为根字段和 question 字段
- **AND** 系统 MUST NOT 回显该字段的值。

#### Scenario: option-attached text input 违反最新参数约束

- **WHEN** option 使用 `inputPlaceholder` 但未使用 `requiresTextInput=true`
- **OR** 同一 question 的任一 option 使用 `requiresTextInput=true`，同时 question 使用 `multiple=true` 或 `custom=true`
- **THEN** 系统 MUST 基于 resolved descriptor 的最新 Schema 告诉模型缺少的 required 字段或必须为 `false` 的互斥字段
- **AND** 纠错信息 MUST NOT 包含 placeholder、prompt、label 或 value 原文。

#### Scenario: 语义约束可纠正

- **WHEN** AskUserQuestion 参数通过 descriptor Schema，但 option value 重复、文本题使用不允许的 modifier，或可见文本违反普通长度边界
- **THEN** 系统 MUST 提供稳定、可操作且不包含原始值的纠错信息
- **AND** 下一模型轮次 MUST 能提交修正后的调用。

#### Scenario: 合法修正创建 pending input

- **GIVEN** 前一轮 AskUserQuestion 因可纠正输入错误进入模型纠错
- **WHEN** 下一轮模型提交符合 resolved descriptor 和 producer 语义约束的参数
- **THEN** 系统 MUST 按原有 runtime-owned lifecycle 创建恰好一个 `QUESTION` pending input
- **AND** 当前 request MUST 进入 `PENDING_INPUT` 而不是 `REQUEST_FAILED`
- **AND** 连续纠错计数 MUST 重置。

#### Scenario: 纠错预算耗尽

- **WHEN** 同一个 request 连续 4 次提交可纠正的 AskUserQuestion 非法参数
- **THEN** 前 3 次 MUST 向下一模型轮次提供安全纠错信息
- **AND** 四次调用均 MUST 保留 assistant tool-use 和配对失败 result
- **AND** 第 4 次写入失败 result 后 MUST 以 safe `INVALID_INPUT` 终止 request
- **AND** 系统 MUST NOT 创建 pending input 或执行当前无效 AskUserQuestion 之后的 tool call。

#### Scenario: 同批其它调用获得明确未执行结果

- **WHEN** 一个 assistant tool-use batch 同时包含非法 AskUserQuestion 和其它 tool call
- **THEN** 非法 AskUserQuestion MUST 获得 `CAPABILITY_INPUT_INVALID` 失败 result
- **AND** 每个其它未执行调用 MUST 获得 `CAPABILITY_BATCH_REJECTED` 失败 result
- **AND** 所有 result MUST 使用对应的原始 `toolCallId`
- **AND** 下一模型轮次 MUST 收到无孤立、无重复、顺序有效的 tool-use/tool-result transcript。

### Requirement: AskUserQuestion 非纠正性失败保持终止和安全边界

AskUserQuestion 的禁止用途、descriptor 不可用、pending-input boundary 不可用、取消和内部错误 MUST NOT 伪装成模型可纠正参数错误。系统 MUST 保持对应的 safe terminal failure，不得向模型暴露受保护判定细节或 raw exception。

#### Scenario: 禁止用途不通过改写参数重试

- **WHEN** AskUserQuestion 可见文本请求 credential、raw secret、authorization grant、protected-operation approval、high-risk confirmation 或 human handoff
- **THEN** 系统 MUST 拒绝创建 pending input
- **AND** 系统 MUST NOT 把禁止用途的原文或具体匹配内容放入模型纠错信息
- **AND** 当前 request MUST 以 safe terminal failure 结束。

#### Scenario: producer 基础设施失败不进入参数纠错

- **WHEN** resolved descriptor 不可用、pending-input boundary 不可用、请求已取消或 producer 发生内部错误
- **THEN** 系统 MUST 保持现有 safe failure code/category
- **AND** 系统 MUST NOT 消耗 AskUserQuestion 参数纠错预算或自动启动新的模型轮次。

### Requirement: AskUserQuestion 有界兼容输入保持既有语义

AskUserQuestion 的模型纠错不得删除既有有界兼容行为。能够完整解析为 JSON array 的 bounded stringified `questions` MUST 继续规范化为 array；包含少于两个 options 的 underspecified question MUST 继续按既有规则规范化；这些兼容输入规范化后仍 MUST 通过 resolved descriptor 和 producer 安全语义校验。

#### Scenario: 可解析 stringified questions 继续被接受

- **WHEN** 模型提交的 `questions` 是预算内且能完整解析成 JSON array 的字符串
- **AND** 规范化后的问题满足 resolved descriptor 和 producer 语义约束
- **THEN** 系统 MUST 创建正常的 runtime-owned pending input
- **AND** 系统 MUST NOT生成参数纠错信息。

### Requirement: AskUserQuestion 用户回答提供可信且模型友好的结果

用户对 pending question 的回答 MUST 继续通过可信 channel/runtime answer boundary 提交，MUST NOT 由模型在 AskUserQuestion input 中提供或覆盖。Runtime MUST 保留既有有序 `answers: string[][]` 事实，并 MUST 在正常 AskUserQuestion `CAPABILITY_RESULT` 中提供根据 accepted question shape 解析的 `resolvedAnswers`。

`resolvedAnswers` MUST 通过 `questionIndex` 与原问题对应，MUST 明确区分纯文本、预设 option selection、option-attached text input 和 custom text。解析 MUST NOT 改变 Web API、pending answer command、PendingInput Record 或数据库 schema。

#### Scenario: option-attached text answer 被语义化

- **GIVEN** accepted question 的 option `later` 使用 `requiresTextInput=true`
- **WHEN** 用户通过可信 answer boundary 提交 `[["later", "10分钟"]]`
- **THEN** 正常 capability result 的原始 `answers` MUST 保持 `[["later", "10分钟"]]`
- **AND** `resolvedAnswers[0].selections[0]` MUST 包含 option 的 `value`、`label` 和 `textInput="10分钟"`。

#### Scenario: custom 与纯文本回答不与选项值混淆

- **WHEN** 用户对 custom-enabled option question 提交列表外文本
- **THEN** runtime MUST 把该值投影为 `customText`
- **WHEN** 用户回答无 options 的文本问题
- **THEN** runtime MUST 把该值投影为 `text`
- **AND** 两种场景都 MUST 保留原始 `answers`。
