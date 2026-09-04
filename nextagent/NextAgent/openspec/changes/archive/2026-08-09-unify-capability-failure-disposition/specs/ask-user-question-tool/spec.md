# ask-user-question-tool Delta Specification

所属 Function：`FN-5.6 向用户提问`

Function 变更类型：修改

spec 角色：主规格

## MODIFIED Requirements

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

## Function 变更汇总

### 输入

- 变更类型：修改
- 目标内容：AskUserQuestion 在创建 pending input 前一次返回当前阶段全部可独立判断的安全参数违规。
- 依据 Requirements：`AskUserQuestion 可纠正输入错误进入安全模型纠错`

### 输出

- 变更类型：修改
- 目标内容：非法调用产生与原 tool call 配对的 canonical `status/result/safeError` 安全投影；合法修正产生 runtime-owned pending input。
- 依据 Requirements：`AskUserQuestion tool creates runtime-owned question pending input`、`AskUserQuestion 可纠正输入错误进入安全模型纠错`、`AskUserQuestion 非纠正性失败保持终止和安全边界`

### 处理过程

- 变更类型：修改
- 目标内容：全部非取消失败都允许模型修正、再次显式调用或选择安全替代，不设置局部重复失败阈值；cancellation 结束为取消终态，同批其他调用保持明确未执行结果。
- 依据 Requirements：`AskUserQuestion tool creates runtime-owned question pending input`、`AskUserQuestion 可纠正输入错误进入安全模型纠错`、`AskUserQuestion 非纠正性失败保持终止和安全边界`

### 结果

- 变更类型：修改
- 目标内容：AskUserQuestion 具有完整参数诊断、有效 tool-use/result transcript 和全部非取消失败的模型决策机会，不改变合法 pending-input 生命周期；`maxToolCallsPerTurn` 限制单轮接纳，`maxTurns` 达到上限后由统一单次模型收尾结束。
- 依据 Requirements：`AskUserQuestion tool creates runtime-owned question pending input`、`AskUserQuestion 可纠正输入错误进入安全模型纠错`、`AskUserQuestion 非纠正性失败保持终止和安全边界`

### 规格

- 规格项：AskUserQuestion 失败反馈边界
- 变更类型：新增
- 原规格值：不适用（新增）
- 目标规格值：无独立纠错次数或相同失败阈值；全部非取消失败反馈模型，达到 Agent 的普通轮次上限后进入恰好一次无 Tool 执行权的模型收尾
- 依据 Requirements：`AskUserQuestion 可纠正输入错误进入安全模型纠错`

### 接口

- 变更类型：修改
- 目标内容：`safeError.errorMessage` 模型投影来源于统一 `safeError.message`；完整诊断只位于 `safeError.safeDetails.violations`。
- 依据 Requirements：`AskUserQuestion 可纠正输入错误进入安全模型纠错`
