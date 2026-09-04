# ask-user-question-tool Specification

## Purpose
定义 AskUserQuestion 工具创建运行时拥有的提问 pending input 的行为、输入类型和恢复边界，使 Agent 能以受治理方式等待普通用户补充信息。
## Function

- **所属 Function**：`FN-5.6 向用户提问`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: AskUserQuestion tool creates runtime-owned question pending input

系统 SHALL 暴露 canonical model/tool/capability id 和 display name 均为 `AskUserQuestion` 的 builtin Tool。合法调用 MUST 在当前 `RequestRun` 创建恰好一个 runtime-owned `QUESTION` pending input，并 MUST 让请求进入 `PENDING_INPUT`；用户回答前 MUST NOT 产生该 Tool 的最终 `CAPABILITY_RESULT` 或结束当前 run。model-facing descriptor MUST 要求每次调用包含 `1..3` 个问题；模型返回 `4..20` 个其他方面合法的问题时，系统 MUST 作为有界兼容输入接受为同一个 pending input，但 MUST NOT 扩大或修改 model-facing descriptor。Runtime MUST 继续拥有 pending-input acceptance、answer validation、resume、timeout 和 terminal lifecycle。

**需求类别**：功能性需求

#### Scenario: 有效文本问题创建 QUESTION pending input

- **WHEN** 模型使用合法文本问题调用 canonical `AskUserQuestion`
- **THEN** 系统 MUST 根据已解析且可用的 builtin Tool descriptor 校验问题结构、可见文本边界和用途约束
- **AND** MUST 在当前 `RequestRun` 创建恰好一个 `kind="QUESTION"` 的 pending input
- **AND** 请求 MUST 进入 `PENDING_INPUT` 并只返回安全 pending input reference
- **AND** 用户回答前 MUST NOT 产生该 Tool 的最终 `CAPABILITY_RESULT` 或 terminal commit

#### Scenario: 同批多个提问调用不创建竞争 pending input

- **WHEN** 同一个 model Tool-call batch 包含多个 canonical `AskUserQuestion` calls
- **THEN** 系统 MUST 只允许当前按模型顺序处理的 call 创建 pending input
- **AND** 后续 calls MUST 等到当前 run resume 并执行到对应 call 时才可分别创建 pending input
- **AND** 同一时刻 MUST NOT 创建多个竞争 pending-input facts

#### Scenario: 相似 Tool 名称或 descriptor 不创建提问 pending input

- **WHEN** 模型调用 `question`、`AskUser`、`ask_user_question`、`askUserQuestion`、`askUser`、`ask_user`、`ask_user_questions`、input schema 相似的普通 Tool，或 `capabilityId="AskUserQuestion"` 的非 builtin descriptor
- **THEN** 系统 MUST NOT 把该调用识别为 canonical `AskUserQuestion`
- **AND** MUST NOT 通过 AskUserQuestion 行为创建 pending input

#### Scenario: Descriptor 不可用时不创建 pending input

- **WHEN** 模型调用 `AskUserQuestion`，但 canonical builtin descriptor 缺失、停用或不可用
- **THEN** 系统 MUST 返回该 Capability contract 定义的安全 capability-unavailable outcome
- **AND** MUST NOT 创建 pending input

#### Scenario: 选择题保留回答约束

- **WHEN** 模型使用合法 options 和 optional `multiple` 或 `custom` 约束调用 `AskUserQuestion`
- **THEN** accepted pending request MUST 保留这些约束供 Runtime 校验回答
- **AND** Tool response MUST NOT 包含 answer schema、answer values、identity 或 idempotency material

#### Scenario: 有界模型输出偏差按唯一规则归一

- **WHEN** 模型把 `questions` 编码为有界 JSON string array、问题携带少于两个 options 的欠完整 `options` array，或 text question 冗余携带 `custom=true`
- **THEN** 系统 MUST 分别解释为 canonical question array 或 text-question shape 后再执行同一完整校验
- **AND** 除 `4..20` 问题的兼容输入仅放宽 question count 外，归一后的输入 MUST 满足 descriptor schema、可见文本边界和 forbidden-purpose 规则
- **AND** accepted pending request MUST NOT 保留欠完整 `options`、`multiple` 或 text-question `custom=true` compatibility marker

#### Scenario: 非法选项约束安全失败

- **WHEN** 一个问题包含重复 option `value`，或没有 options 的文本问题携带 `multiple` 或 `custom=false`
- **THEN** 系统 MUST 返回安全 `INVALID_INPUT` validation outcome
- **AND** MUST NOT 创建 pending input

#### Scenario: 四到二十个问题作为有界兼容输入接受

- **WHEN** 模型调用 `AskUserQuestion` 时返回 `4..20` 个其他方面合法的问题
- **THEN** 系统 MUST 把整批问题作为一个 `QUESTION` pending input 接受
- **AND** MUST 保持原始问题顺序和约束，并执行除 question count 外的全部正常校验
- **AND** MUST NOT 修改 model-facing descriptor、向模型暴露兼容上限或把该调用拆成多个 pending inputs

#### Scenario: 超过兼容上限产生配对失败

- **WHEN** normalized `questions` 超过 `20` 个
- **THEN** canonical transcript MUST 先包含原 assistant tool-use batch，再包含配对失败结果
- **AND** 系统 MUST NOT 创建 pending input、发布 `USER_INPUT_REQUIRED`、截断问题或执行 rejected batch 中的任一 Tool call
- **AND** invalid AskUserQuestion MUST 获得一个携带完整安全 violations 和可操作修正说明的 `CAPABILITY_INPUT_INVALID` 配对结果
- **AND** rejected batch 的其他 calls MUST 各自获得一个 `CAPABILITY_BATCH_REJECTED` 配对结果
- **AND** 日志和安全结果 MUST NOT 包含 question text 或其他 raw Tool arguments

#### Scenario: 修正后的问题继续原 RequestRun

- **GIVEN** question-count overflow failure 已反馈模型
- **WHEN** 模型在后续普通 turn 使用不超过三个且通过其余校验的问题再次调用 `AskUserQuestion`
- **THEN** 系统 MUST 为修正后的 call 创建恰好一个 pending input
- **AND** MUST 保持原 session、request 和 run
- **AND** MUST NOT 向用户暴露被拒绝的问题批次

#### Scenario: 重复问题数量超限不建立局部阈值

- **WHEN** 模型在连续普通 turns 中重复返回超过 `20` 个问题
- **THEN** 每次 invalid call MUST 产生配对安全失败并进入下一普通模型轮次
- **AND** question-count failure MUST NOT 使用独立连续计数或局部终止阈值
- **AND** rejected calls MUST NOT 创建 partial pending input
- **AND** Agent loop MUST 继续受 accepted `maxTurns` 和 `maxToolCallsPerTurn` 约束，达到普通轮次上限后只进入 `tool-loop` 定义的一次 finalizing turn

#### Scenario: 非数量校验失败保持自身映射

- **WHEN** AskUserQuestion input 不超过 `20` 个问题，但违反 option uniqueness、visible-text budget、forbidden-purpose、descriptor availability 或其他非数量约束
- **THEN** 系统 MUST 保持对应安全失败映射
- **AND** MUST NOT 把该失败标记为 question-count overflow

#### Scenario: 空文本或超长可见文本安全失败

- **WHEN** 模型调用 `AskUserQuestion` 时包含空 visible text、超过 `500` 个字符的 `prompt`、option `value` 或 option `label`
- **THEN** 系统 MUST 返回安全 `INVALID_INPUT` validation outcome
- **AND** MUST NOT 创建 pending input

#### Scenario: Tool descriptor 向模型公开正常输入边界

- **WHEN** context rendering 把 `AskUserQuestion` 作为 callable model Tool 暴露
- **THEN** provider-facing schema 支持 JSON Schema string constraints 时，rendered Tool schema MUST 包含 `questions[].prompt`、`questions[].options[].value` 和 `questions[].options[].label` 的明确长度边界
- **AND** rendered schema MUST 声明正常问题数量为 `1..3`，description MUST 指导模型只询问当前必要且不超过三个的问题
- **AND** rendered schema 和 description MUST NOT 把 `20` 个问题的兼容上限暴露为正常调用能力
- **AND** provider 无法表达上述边界时，系统仍 MUST 在创建 pending input 前执行同一输入校验

#### Scenario: Tool descriptor 说明问题类型形状

- **WHEN** context rendering 把 `AskUserQuestion` 作为 callable model Tool 暴露
- **THEN** model-facing schema 和 field descriptions MUST 明确：文本问题省略 `options`；单选问题包含 `options` 且 `multiple` 缺失或为 false；多选问题包含 `options` 且 `multiple=true`；自定义选项问题包含 `options` 且 `custom=true`
- **AND** context rendering 和 provider adapter MUST 保持 resolved descriptor 支持的 item counts、string bounds 和 field descriptions
- **AND** Tool input MUST NOT 增加 `questionType`、`kind`、`header`、option `description`、annotations、answer schema、identity、idempotency、timeout behavior 或 producer coordinates

#### Scenario: Tool descriptor 保持 exact canonical name

- **WHEN** 上下文渲染或模型 provider adapter 向模型暴露该 callable Tool
- **THEN** callable Tool 名称 MUST 精确保持为 `AskUserQuestion`
- **AND** adapter MUST NOT 把名称归一化为 `AskUser`、`ask_user_question`、`askUserQuestion`、`askUser`、`ask_user` 或任何 provider-local alias
- **AND** provider 无法精确暴露 `AskUserQuestion` 时，adapter MUST 安全失败，且 MUST NOT 把 alias 形式的返回调用接受为 AskUserQuestion

#### Scenario: 提问建立失败映射为安全 reason code

- **WHEN** `AskUserQuestion` 无法建立 pending input
- **THEN** descriptor 缺失、停用、不可用或不是 canonical builtin Tool MUST 映射为 `CAPABILITY_UNAVAILABLE`
- **AND** schema、budget、option constraint 或 forbidden-purpose validation failure MUST 映射为 `INVALID_INPUT`
- **AND** Runtime 无法接受 pending input 或存在 active pending conflict MUST 映射为 `PENDING_INPUT_UNAVAILABLE`
- **AND** pending acceptance 完成前的 abort 或 cancellation MUST 映射为 `ABORTED`
- **AND** 其他 unexpected failure MUST 映射为 `EXECUTION_FAILED`

#### Scenario: Pending question 不产生立即 Tool result

- **WHEN** `AskUserQuestion` 成功创建 pending input
- **THEN** 当前 request outcome MUST 为 `PENDING_INPUT`
- **AND** 用户回答前 MUST NOT 为该 Tool call 追加 model-visible `CAPABILITY_RESULT`
- **AND** 同批后续 Tool calls MUST NOT 在该 pending input 完成前执行
- **AND** Runtime MUST NOT 因 pending reference 对该 run 执行 terminal commit

#### Scenario: Tool input 不能提供可信运行坐标

- **WHEN** `AskUserQuestion` 建立 pending input
- **THEN** accepted `RequestRun`、trusted `RequestContext`、Owner Scope、session id、request id 和 run id MUST 来自当前受信 request lifecycle
- **AND** Tool input MUST NOT 提供或覆盖 identity、idempotency key、session id、request id、run id、timeout behavior 或 answer schema
- **AND** `multiple` 和 `custom` 如存在 MUST 只作为已接受的问题约束，client answer payload MUST NOT 提供它们

#### Scenario: Tool 拒绝禁止的提问用途

- **WHEN** Tool input 要求用户提供 credential、raw secret、授权授予、受保护操作批准、高风险确认决定或人工移交/升级
- **THEN** Tool MUST 以安全 `INVALID_INPUT` validation outcome 拒绝请求
- **AND** MUST NOT create a pending input
- **AND** AskUserQuestion MUST only create `QUESTION` pending input and MUST NOT create `CONFIRMATION`, `AUTHORIZATION` or `HUMAN_HANDOFF` pending input
- **AND** Tool MUST NOT 把被拒请求转发、升级、转换或改路由到其他 pending-input kind、Hook、guard、policy path 或 handoff producer
- **AND** forbidden-purpose validation MUST 对相同输入产生相同安全结果
- **AND** 不满足明确禁止用途的模糊输入 MUST 只受 model-facing guidance 和 schema bounds 约束，不得仅因主题模糊而拒绝

#### Scenario: 调查表和长表单只接受明确契约校验

- **WHEN** model-facing guidance 说明 `AskUserQuestion` 的适用方式
- **THEN** guidance MUST 提醒模型避免 broad survey 或 form，只询问当前必要的 clarification
- **AND** 系统 MUST 仅在输入违反 descriptor schema、budgets 或 forbidden-purpose 时拒绝，不得仅按 survey/form 标签拒绝

#### Scenario: 用户回答恢复原 Tool call

- **WHEN** 用户回答 pending input
- **THEN** runtime-owned pending input flow MUST 校验回答并恢复原 `RequestRun`
- **AND** accepted answer MUST 成为原 `producerRef.toolCallId` 对应的恰好一个安全 `CAPABILITY_RESULT`
- **AND** 同批存在多个 `AskUserQuestion` calls 时，每次 resume MUST 只闭合当前 producer call；后续 calls 仅在恢复执行到达时处理
- **AND** resume MUST NOT 重新调用已创建 pending input 的同一个 `AskUserQuestion` call

### Requirement: Accepted AskUserQuestion answer publishes a durable-first visible result

当 runtime 接受由 canonical `AskUserQuestion` 创建的 `QUESTION` pending input 回答时，系统 MUST 先为原始 tool call 持久化恰好一个可见 `CAPABILITY_RESULT` message，再向当前 session stream 发布对应的 `CAPABILITY_RESULT_DELTA` 安全结果投影，最后继续原始 run。该结果投影 MUST 使用 durable pending input 中的 `producerRef.toolCallId`、`producerRef.capabilityId`、`pendingInputId` 和已接受回答；MUST NOT 使用浏览器 request body、本地 composer state 或重新调用 `AskUserQuestion` 得到结果。

缺少当前 stream subscriber 或 live-only delivery 未到达客户端时，runtime MUST 保留 durable result 并继续既有恢复路径；MUST NOT 回滚已接受回答、重复恢复 run 或重复调用 `AskUserQuestion`。

#### Scenario: Accepted question answer is visible before resumed model output

- **WHEN** runtime 接受 canonical `AskUserQuestion` 的有效 `QUESTION` 回答
- **THEN** 系统 MUST 先持久化原始 tool call 的可见 `CAPABILITY_RESULT` message
- **AND** 当前 session stream MUST 在后续 resumed model output 之前发布该 tool call 的 `CAPABILITY_RESULT_DELTA` 安全结果投影
- **AND** result message 与 stream projection MUST 指向同一 request、run、tool call 和 pending input
- **AND** runtime MUST NOT 为该交互发布 `CAPABILITY_STARTED` 或 `CAPABILITY_COMPLETED`

#### Scenario: Durable result write failure does not publish an answer result

- **WHEN** pending input 已解析为 `RECEIVED`，但原始 tool call 的可见 `CAPABILITY_RESULT` message 未能持久化
- **THEN** runtime MUST NOT 发布声称回答结果已经可恢复的 `CAPABILITY_RESULT_DELTA`
- **AND** runtime MUST NOT 继续一个缺少该 durable result 的 AskUserQuestion producer tool call
- **AND** 既有 recoverable pending-input resume failure 行为 MUST 保持有效

#### Scenario: Replayed answer command does not duplicate the result

- **WHEN** 同一已接受 answer command 以相同 idempotency semantic 再次提交
- **THEN** runtime MUST NOT 写入第二个 `CAPABILITY_RESULT` message
- **AND** runtime MUST NOT 发布第二个 answer-result `CAPABILITY_RESULT_DELTA`
- **AND** runtime MUST NOT 再次恢复原始 run

#### Scenario: Missing live delivery preserves durable recovery

- **WHEN** durable `CAPABILITY_RESULT` message 已经写入，但当前没有匹配的 stream subscriber 或客户端没有收到 live-only answer result
- **THEN** runtime MUST 继续原始 run
- **AND** 后续 conversation/history 读取 MUST 仍能返回该 durable result
- **AND** 系统 MUST NOT 为补偿 live delivery 缺失而重复写入 result、重复恢复 run 或改变 pending input 状态

#### Scenario: Timeout and cancellation do not synthesize an answer result

- **WHEN** canonical `AskUserQuestion` pending input 超时或被取消，而不是解析为 `RECEIVED`
- **THEN** runtime MUST NOT 写入包含回答的 `CAPABILITY_RESULT`
- **AND** runtime MUST NOT 发布 `pendingInputAnswer` result projection

### Requirement: AskUserQuestion 支持具体选项附带文本输入

`AskUserQuestion` SHALL allow multiple different options in one single-select question to independently declare that selecting the option requires one attached text value. The model-facing Tool description and input schema MUST distinguish free-text questions, ordinary option questions, question-level custom answers, and option-attached text input without adding a parallel question type discriminator.

#### Scenario: Tool 描述向模型说明全部输入形态

- **WHEN** context rendering exposes `AskUserQuestion` as a callable model Tool
- **THEN** description and schema MUST explain that a free-text question omits `options` and directly accepts user text
- **AND** an ordinary option omits `requiresTextInput`
- **AND** an option that needs a parameter sets `requiresTextInput=true` and may supply `inputPlaceholder`
- **AND** multiple different options in the same single-select question MAY each set `requiresTextInput=true`
- **AND** the model MUST use a unique meaningful option `value` for each such option and MUST NOT use the reserved value `custom` to identify option-attached input
- **AND** question-level `custom=true` MUST remain the one generic non-option answer mechanism rather than an option-attached parameter.

#### Scenario: Producer preserves valid option-attached input constraints

- **WHEN** the model calls `AskUserQuestion` with a single-select question whose options have unique values and one or more options set `requiresTextInput=true`
- **THEN** Agent/core MUST validate the resolved descriptor schema and visible-text limits
- **AND** the accepted `QUESTION` pending request MUST preserve each option's `requiresTextInput` and optional `inputPlaceholder`
- **AND** the producer MUST NOT add an answer schema, client identity, idempotency material or lifecycle ownership to the Tool result.

#### Scenario: Producer rejects ambiguous option-attached input combinations

- **WHEN** a question with any `requiresTextInput=true` option also has `multiple=true` or `custom=true`
- **THEN** Agent/core MUST reject the input with safe `INVALID_INPUT`
- **AND** MUST NOT create or partially persist a pending input.

#### Scenario: Producer rejects invalid option input presentation fields

- **WHEN** an option supplies `inputPlaceholder` without `requiresTextInput=true`, supplies a non-boolean `requiresTextInput`, or supplies an empty or more than 200 character `inputPlaceholder`
- **THEN** Agent/core MUST reject the input with safe `INVALID_INPUT`
- **AND** MUST NOT create a pending input.

### Requirement: AskUserQuestion 可纠正输入错误进入安全模型纠错

当 canonical `AskUserQuestion` 的模型参数可通过修改参数结构或普通字段约束纠正时，Agent MUST 先持久化模型返回的原始 assistant tool-use batch，再在创建 pending input 和执行该 batch 任一 Tool 之前完成无副作用校验。系统 MUST 为失败 AskUserQuestion 写入与原 `toolCallId` 配对的失败 `CAPABILITY_RESULT`，MUST 按 `capability-catalog / Capability 输入校验返回完整安全诊断` 返回当前校验阶段全部安全 violations，并 MUST NOT 在第一次可纠正失败后立即终止 request。

失败结果 MUST 使用普通 `CapabilityInvocationResult.safeError` 语义和 canonical `status/result/safeError` 模型投影。`safeError.code` MUST 为 `CAPABILITY_INPUT_INVALID`，`safeError.category` MUST 为 `VALIDATION`，`safeError.retryable` MUST 为 `false`；owning `safeError.message` 的安全投影和 `safeError.safeDetails.violations` MUST 遵守统一参数诊断与公共结果容量规则，MUST NOT 使用独立条数或字符上限，也 MUST NOT 回显被拒绝的原始值、prompt、option label/value、placeholder、credential、token、路径、附件内容、provider response 或 raw exception。

同一 assistant batch 中因 AskUserQuestion 预检失败而未执行的其他 tool call MUST 各自获得与原 `toolCallId` 配对的 `CAPABILITY_BATCH_REJECTED` 失败结果，MUST NOT 被执行。系统 MUST NOT 使用普通 `USER` 或 request-local generated message 代替上述 tool result。

AskUserQuestion 可纠正失败 MUST 遵守 `tool-loop / Agent loop 对最终 Capability 失败执行唯一处置`：每次非取消失败都写入配对结果并进入下一模型轮次，MUST NOT 建立独立纠错次数、failure fingerprint 或重复失败终止阈值。模型可以修改参数、改用其他 Capability、给出普通答复、再次显式选择同一调用或结束；每次后续调用继续受 canonical `maxTurns` 和每轮 `maxToolCallsPerTurn` 约束，达到 `maxTurns` 后只允许 `tool-loop` 定义的一次无 Tool 执行权模型收尾。模型提交合法参数后 MUST 按 runtime-owned lifecycle 创建 pending input。

**需求类别**：功能性需求

#### Scenario: 一次返回全部 AskUserQuestion 参数违规

- **WHEN** 同一次调用同时包含错误层级、禁止字段、option value 重复和 modifier 组合冲突
- **THEN** 失败结果 MUST 包含当前校验阶段全部可独立判断的 violations
- **AND** 每个 violation MUST 使用安全字段路径、约束和期望形态
- **AND** 结果 MUST NOT 包含任一被拒绝原值
- **AND** 系统 MUST 保存 assistant tool-use batch 和配对失败 result

#### Scenario: 同批其他调用获得明确未执行结果

- **WHEN** 一个 assistant tool-use batch 同时包含非法 AskUserQuestion 和其他 tool call
- **THEN** 非法 AskUserQuestion MUST 获得 `CAPABILITY_INPUT_INVALID` 失败 result
- **AND** 每个其他未执行调用 MUST 获得 `CAPABILITY_BATCH_REJECTED` 失败 result
- **AND** 全部 result MUST 使用对应的原始 `toolCallId`
- **AND** 下一模型轮次 MUST 收到无孤立、无重复、顺序有效的 tool-use/tool-result transcript

#### Scenario: 合法修正创建 pending input

- **GIVEN** 前一轮 AskUserQuestion 因可纠正输入错误进入模型纠错
- **WHEN** 下一轮模型提交符合 resolved descriptor 和 producer 语义约束的参数
- **THEN** 系统 MUST 按 runtime-owned lifecycle 创建恰好一个 `QUESTION` pending input
- **AND** 当前 request MUST 进入 `PENDING_INPUT` 而不是 `REQUEST_FAILED`

#### Scenario: 相同可纠正失败继续进入模型

- **WHEN** 同一 request 再次产生相同 AskUserQuestion 可纠正失败
- **THEN** 系统 MUST 保存新的配对失败 result
- **AND** 系统 MUST 发起下一模型轮次而不是因重复失败终止
- **AND** 系统 MUST NOT 发出 `CAPABILITY_REPEATED_FAILURE`
- **AND** 系统 MUST NOT 创建 pending input 或执行同批其他 tool call
- **AND** 后续循环 MUST 继续受 canonical `maxTurns` 和每轮 `maxToolCallsPerTurn` 约束

### Requirement: AskUserQuestion 非纠正性失败保持终止和安全边界

AskUserQuestion 的禁止用途、descriptor 不可用、pending-input boundary 不可用、取消和内部错误 MUST NOT 伪装成模型可纠正参数错误。禁止用途 MUST 使用其定义的安全 validation outcome；内部错误 MUST 映射为 `INTERNAL`；这些非取消失败每次出现时 MUST 写入配对失败结果并允许模型选择普通答复、其他 Capability、再次显式调用或结束，MUST NOT 建立独立错误预算或重复失败终止。取消 MUST 返回 `FAILED + safeError.category=CANCELED + retryable=false` 并结束为请求取消终态。

descriptor 不可用或 pending-input boundary 明确不可用时，系统 MUST 返回安全 `NOT_FOUND` 或 `UNAVAILABLE` 最终结果，MUST 允许模型选择普通答复、其他 Capability、再次显式调用或结束，MUST NOT 自动重放 AskUserQuestion。任何上述失败 MUST NOT 暴露受保护判定细节、禁止用途原文、pending state、provider response 或 raw exception。

**需求类别**：功能性需求

#### Scenario: 禁止用途保持安全分类并反馈模型

- **WHEN** AskUserQuestion 可见文本请求 credential、raw secret、authorization grant、protected-operation approval、high-risk confirmation 或 human handoff
- **THEN** 系统 MUST 拒绝创建 pending input
- **AND** 系统 MUST 使用该禁止用途定义的安全 validation outcome 写入配对失败结果且不得伪装为普通字段约束错误
- **AND** 系统 MUST NOT 把禁止用途原文或具体匹配内容反馈给模型
- **AND** 第一次相同失败 MUST 允许模型选择普通答复、其他 Capability 或结束

#### Scenario: Pending boundary 不可用时允许安全替代

- **WHEN** pending-input boundary 明确不可用且请求未取消
- **THEN** 系统 MUST 写入安全 `UNAVAILABLE` 失败结果
- **AND** 系统 MUST 允许模型选择普通答复、其他 Capability 或结束
- **AND** 系统 MUST NOT 自动重放 AskUserQuestion

#### Scenario: AskUserQuestion 取消与内部错误采用不同处置

- **WHEN** 请求取消或 AskUserQuestion producer 发生内部错误
- **THEN** 取消 MUST 返回 `FAILED + safeError.category=CANCELED + retryable=false` 并结束为请求取消终态
- **AND** 取消 MUST NOT 进入新的模型轮次
- **AND** 内部错误 MUST 写入 `FAILED + safeError.category=INTERNAL` 的配对结果并进入下一模型轮次
- **AND** 相同内部失败再次出现时 MUST 继续写入新的配对结果并进入下一模型轮次

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

### Requirement: User-facing agents trigger AskUserQuestion for blocking ordinary user input

当面向用户的 Agent 实际需要用户回答一个普通问题时，NextAgent MUST 通过模型可见指导要求 Agent 调用 `AskUserQuestion`，并 MUST 禁止 Agent 只在普通 assistant 文本中直接写出需要用户回答的问题。本 Requirement 中的普通问题由追问、澄清、偏好、实现选择和普通确认五类组成；当同一次交互同时符合普通问题和禁止用途时，禁止用途 MUST 优先。

模型可见指导 MUST 保持 System Prompt、Tool description 和输入 Schema description 的语义一致，并 MUST NOT 增加自然语言推断、forced tool choice、自动 pending-input routing 或 runtime 语义路由。

**需求类别**：功能性需求

#### Scenario: 需要用户回答的普通问题使用 AskUserQuestion

- **WHEN** 面向用户的 Agent 需要用户回答追问、澄清、偏好、实现选择或普通确认
- **AND** 该问题不属于禁止用途
- **THEN** 模型可见指导 MUST 要求 Agent 调用 `AskUserQuestion`
- **AND** 模型可见指导 MUST 禁止 Agent 在普通 assistant 文本中直接写出该问题
- **AND** 面向用户的问题文本 MUST 直接表达问题，不得暴露内部 Tool 名称

#### Scenario: 可从上下文或工具取得的信息不形成用户问题

- **WHEN** Agent 可以从对话上下文推断所需信息、通过可用工具取得所需信息或使用安全且明确的假设继续
- **THEN** Agent MUST 先使用该信息来源或假设，而不是构造一个不需要用户回答的问题
- **AND** 如果 Agent 最终仍实际需要用户回答，模型可见指导 MUST 要求该问题通过 `AskUserQuestion` 发出

#### Scenario: 已知选项时使用结构化选项

- **WHEN** Agent 已知普通问题的全部有效选项
- **THEN** 模型可见指导 MUST 要求 Agent 使用 `AskUserQuestion` 的预设选项
- **AND** 仅当有效选项未知时，Agent MUST 使用自由文本问题

#### Scenario: 禁止用途不使用 AskUserQuestion

- **WHEN** 交互用于 generic permission to proceed、plan approval、status acknowledgement、credential、secret、authorization grant、protected-operation approval、high-risk confirmation、human handoff、survey 或 long-form form
- **THEN** 模型可见指导 MUST 要求 Agent 不调用 `AskUserQuestion`
- **AND** 系统 MUST 继续依赖对应 owner 已定义的 purpose-specific pending input、guard 或 safe refusal 行为

#### Scenario: AskUserQuestion 不可用时不退化为文本问句

- **WHEN** 面向用户的 Agent 实际需要用户回答普通问题，但 `AskUserQuestion` 不可用
- **THEN** Agent MUST NOT 在普通 assistant 文本中直接写出该问题
- **AND** Agent MUST 使用无需用户回答的安全假设继续，或输出不含问句的 blocked explanation

### Requirement: 单个问题支持至多十五个预定义选项

`AskUserQuestion` 的 model-facing input schema 中，当单个问题包含 `options` 数组时，该数组 MUST 接受二至十五个合法预定义选项。系统接受该输入后 MUST 按输入顺序完整保留所有选项，不得截断或重排。包含十六个或更多选项的调用 MUST 返回安全 `INVALID_INPUT` validation outcome，并且 MUST NOT 创建部分 pending input。

**需求类别**：功能性需求

#### Scenario: 九个预定义选项被完整接受

- **GIVEN** 一个其他字段均合法且包含九个唯一预定义选项的问题
- **WHEN** Agent 调用 `AskUserQuestion`
- **THEN** 系统 MUST 接受该调用并创建 `QUESTION` pending input
- **AND** pending input MUST 按输入顺序包含全部九个选项

#### Scenario: 十五个预定义选项在上边界被完整接受

- **GIVEN** 一个其他字段均合法且包含十五个唯一预定义选项的问题
- **WHEN** Agent 调用 `AskUserQuestion`
- **THEN** 系统 MUST 接受该调用并创建 `QUESTION` pending input
- **AND** pending input MUST 按输入顺序包含全部十五个选项

#### Scenario: 十六个预定义选项被拒绝

- **GIVEN** 一个其他字段均合法但包含十六个预定义选项的问题
- **WHEN** Agent 调用 `AskUserQuestion`
- **THEN** 系统 MUST 返回安全 `INVALID_INPUT` validation outcome
- **AND** 系统 MUST NOT 截断选项或创建 pending input

#### Scenario: 模型可见 schema 声明新边界

- **WHEN** Agent 获取 `AskUserQuestion` Tool descriptor
- **THEN** `questions[].options` schema MUST 声明 `minItems: 2` 和 `maxItems: 15`
- **AND** `questions[].options.description` MUST 表明单个问题可提供二至十五个预定义选项

### Requirement: 中文界面使用简洁的手动输入标签

当中文界面为允许自由文本回答的 `AskUserQuestion` 问题显示自由文本入口时，系统 MUST 将该入口标记为“手动输入”，并且 MUST NOT 改变该入口原有的自由文本回答语义。

**需求类别**：功能性需求

#### Scenario: 中文自由文本入口显示简洁标签

- **GIVEN** 当前界面语言为 `zh-CN`
- **WHEN** 前端呈现允许自由文本回答的 `AskUserQuestion` 问题
- **THEN** 自由文本入口 MUST 显示“手动输入”

### Requirement: AskUserQuestion default timeout uses portal ability config

当 canonical builtin `AskUserQuestion` 创建 pending input 且 pending input intent 未显式提供 `timeoutAt` 时，runtime MUST 使用 effective `ask-user-question-time-minutes` 计算默认 accepted `timeoutAt`。该值必须为 `1..1440` 分钟，非法配置回退 `30` 分钟。pending input intent 显式提供 `timeoutAt` 时，显式值 MUST 优先，MUST NOT 被配置值覆盖。

该配置 MUST 只影响 canonical builtin `AskUserQuestion` 产生的新 pending input。其他 QUESTION producer、CONFIRMATION、AUTHORIZATION、HUMAN_HANDOFF 和 Workflow interrupt pending input MUST 继续使用既有默认 timeout。REMOTE 配置变化后，已 accepted pending input 的 `timeoutAt` MUST 保持不变，只有之后新创建的 canonical `AskUserQuestion` pending input 使用新 effective 值。

**需求类别**：功能性需求

#### Scenario: 配置值成为默认等待时间
- **WHEN** canonical `AskUserQuestion` 创建未显式提供 `timeoutAt` 的 pending input
- **AND** effective `ask-user-question-time-minutes=5`
- **THEN** accepted `timeoutAt` MUST 等于 pending input 创建时刻后 5 分钟

#### Scenario: 非法配置回到默认等待时间
- **WHEN** canonical `AskUserQuestion` 创建未显式提供 `timeoutAt` 的 pending input
- **AND** effective 配置解析结果为非法回退
- **THEN** accepted `timeoutAt` MUST 等于创建时刻后 30 分钟

#### Scenario: 显式 timeout 优先
- **WHEN** canonical `AskUserQuestion` 的 pending input intent 显式提供合法 `timeoutAt`
- **THEN** runtime MUST 使用显式 `timeoutAt`
- **AND** MUST NOT 用 portal ability 配置值覆盖该值

#### Scenario: 只影响 canonical AskUserQuestion
- **WHEN** Hook、Workflow 或其他 Capability producer 创建未显式提供 `timeoutAt` 的 pending input
- **THEN** runtime MUST 继续使用既有默认 30 分钟
- **AND** MUST NOT 使用 `ask-user-question-time-minutes`

#### Scenario: 配置变化不影响已接受提问
- **WHEN** canonical `AskUserQuestion` pending input 已被 accepted
- **AND** REMOTE 模式下 `ask-user-question-time-minutes` 之后发生变化
- **THEN**该 pending input 的 accepted `timeoutAt` MUST 保持不变
- **AND** 之后新创建的 canonical `AskUserQuestion` pending input MUST 使用新的 effective 值
