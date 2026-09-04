## ADDED Requirements

### Requirement: AskUserQuestion 工具创建 runtime 拥有的问题 pending input

系统 SHALL 把 `AskUserQuestion` 暴露为内置 Tool entry，其规范的 model/tool/capability id 与显示名称均为 `AskUserQuestion`。调用该工具会创建一个 runtime 拥有的 `QUESTION` pending input 请求。该工具 MUST NOT 创建与之竞争的交互状态机，也 MUST NOT 在 tool handler 内部等待用户响应。

#### Scenario: 工具创建文本问题 pending input
- **WHEN** 模型以一个有效的文本问题调用 `AskUserQuestion`
- **THEN** Agent/core MUST 通过既有 capability resolver/catalog 路径解析 `AskUserQuestion` descriptor
- **AND** 系统 MUST 只应用本 change 定义的确定性 model 输出规范化，然后对照解析出的 descriptor schema 和确定性可见文本规则校验并安全检查规范化后的问题
- **AND** 将接受的输入转换为既有 `PendingInputIntent` contract，并带有 `kind="QUESTION"`
- **AND** 只通过 `AgentRunStatePort.requestPendingInput(run, context, intent)` 创建 pending input
- **AND** 在 runtime 拥有的移交接受该 pending input 后，立即返回仅带安全 pending input 引用的 `AgentExecutionOutcome{ status: "PENDING_INPUT" }`。

#### Scenario: 初始生产者请求绕过普通 capability invocation
- **WHEN** `AskUserQuestion` 为当前 tool call 创建一个 pending input
- **THEN** Agent/core MUST 在普通 capability invocation 之前，在 AskUserQuestion producer 分支中处理该初始请求
- **AND** 该分支 MUST 限定为经过正常 descriptor 解析后具有 `kind="TOOL"`、`capabilityId="AskUserQuestion"`、`provider.providerId="builtin-tools"`、`provider.providerKind="BUNDLED"` 和 `availabilityStatus="AVAILABLE"` 的解析 descriptor
- **AND** MUST NOT 调用 `CapabilityInvocationPort.invoke(...)` 来创建初始 pending 请求
- **AND** MUST NOT 引入通用的 pending producer registry、descriptor 标志、metadata 标记或通过 capability 发现的 pending 路由
- **AND** MUST NOT 依赖 `CapabilityDescriptor.metadata` 做路由、授权、重放安全或 pending 生命周期决策
- **AND** MUST NOT 依赖显示名称、描述、schema 形状、字符串相似度或自然语言推断来决定路由
- **AND** MUST NOT import agent-capability 实现路径。
- **AND** 如果同一 model tool 批次包含多个 `AskUserQuestion` 调用，Agent/core MUST 只处理当前正在执行的调用，并且在恢复执行到达之前 MUST NOT 为后续 `AskUserQuestion` 调用创建 pending input。

#### Scenario: 相似的工具名称或 descriptor 不创建 pending input
- **WHEN** 模型调用 `question`、`AskUser`、`ask_user_question`、`askUserQuestion`、`askUser`、`ask_user`、`ask_user_questions`、一个输入 schema 匹配的普通工具，或一个 `capabilityId="AskUserQuestion"` 的非 bundled descriptor
- **THEN** Agent/core MUST NOT 为该调用进入 AskUserQuestion producer 分支
- **AND** MUST NOT 通过 AskUserQuestion 路径创建 pending input。

#### Scenario: Descriptor 不可用时不创建 pending input
- **WHEN** 模型调用 `AskUserQuestion` 但解析出的 capability descriptor 缺失、被禁用或不可用
- **THEN** Agent/core MUST 返回既有的安全 capability 不可用结果
- **AND** MUST NOT 创建 pending input。

#### Scenario: 工具创建选择问题 pending input
- **WHEN** 模型以有效的选项和可选 `multiple` 或 `custom` 约束调用 `AskUserQuestion`
- **THEN** 被接受的 pending 请求 MUST 保留这些约束供 runtime 答案校验使用
- **AND** 工具响应 MUST NOT 包含答案 schema、答案值、身份或幂等材料。

#### Scenario: 工具规范化有限的 model 输出漂移
- **WHEN** 模型以编码为有界 JSON 字符串数组的 `questions` 调用 `AskUserQuestion`，或某个问题包含选项数少于两个的欠指定 `options` 数组
- **THEN** Agent/core MAY 在 descriptor schema 校验之前将输入规范化为规范的 question 数组和文本问题形状
- **AND** 规范化后的输入 MUST 仍满足解析出的 descriptor schema、可见文本预算、问题数量和禁止 purpose 规则
- **AND** 被接受的 pending 请求 MUST NOT 保留欠指定的 `options`、`multiple` 或文本问题的 `custom=true` 兼容标记。

#### Scenario: 工具拒绝非法选项问题约束
- **WHEN** 模型调用 `AskUserQuestion` 时同一问题内的选项 `value` 重复，或在没有选项的文本问题上带 `multiple` 或 `custom=false`
- **THEN** 系统 MUST 以安全的 `INVALID_INPUT` 校验结果拒绝该请求
- **AND** MUST NOT 创建 pending input。

#### Scenario: 工具拒绝一次调用中的四个及以上问题
- **WHEN** 模型以四个及以上问题调用 `AskUserQuestion`
- **THEN** 系统 MUST 以安全的 `INVALID_INPUT` 校验结果拒绝该请求
- **AND** MUST NOT 截断这些问题
- **AND** MUST NOT 创建部分 pending input。

#### Scenario: 工具拒绝为空或超预算的可见问题文本
- **WHEN** 模型调用 `AskUserQuestion` 时可见文本字段为空、`prompt` 超过 500 个字符、选项 `value` 超过 500 个字符，或选项 `label` 超过 500 个字符
- **THEN** 系统 MUST 以安全的 `INVALID_INPUT` 校验结果拒绝该请求
- **AND** MUST NOT 创建 pending input。

#### Scenario: 工具 descriptor 向 model 暴露可见文本预算
- **WHEN** context rendering 将 `AskUserQuestion` 暴露为可调用的 model tool
- **THEN** 当面向 provider 的 tool schema 支持 JSON Schema 兼容的字符串约束时，渲染的 tool 输入 schema MUST 为 `questions[].prompt`、`questions[].options[].value` 和 `questions[].options[].label` 包含具体的字符串长度边界
- **AND** Agent/core 在创建 pending input 之前，仍 MUST 对照解析出的 descriptor schema 校验规范化后返回的 tool 参数
- **AND** provider 无法表达这些边界 MUST NOT 放宽 Agent/core 校验。

#### Scenario: 工具 descriptor 向 model 解释问题种类形状
- **WHEN** context rendering 将 `AskUserQuestion` 暴露为可调用的 model tool
- **THEN** 面向 model 的 tool schema 和字段描述 MUST 解释：文本问题省略 `options` 并可冗余地携带 `custom=true` 作为兼容 no-op；单选问题具有 `options` 且 `multiple` 缺省或为 false；多选问题具有 `options` 且 `multiple=true`；自定义选项问题具有 `options` 且 `custom=true`
- **AND** context rendering 和 provider 适配器 MUST 保留解析出的 descriptor 中受支持的 schema 条目数、字符串边界和字段描述
- **AND** 工具输入 MUST NOT 添加 `questionType`、`kind`、`header`、选项 `description`、annotation、答案 schema、身份、幂等、timeout 行为或生产者坐标
- **AND** Agent/core 在创建 pending input 之前仍 MUST 从已校验的参数形状推导所接受的问题种类。

#### Scenario: 工具 descriptor 保持精确的规范名称
- **WHEN** context rendering 或 model provider 适配器向 model 暴露该可调用工具
- **THEN** 可调用的工具名 MUST 保持恰好为 `AskUserQuestion`
- **AND** 适配器 MUST NOT 把名称规范化为 `AskUser`、`ask_user_question`、`askUserQuestion`、`askUser`、`ask_user` 或任何 provider 本地别名
- **AND** 如果 provider 不能精确暴露 `AskUserQuestion`，适配器 MUST 安全失败，并且 MUST NOT 将别名化的返回 tool call 当作 AskUserQuestion 接受。

#### Scenario: 生产者失败映射到安全的 reason code
- **WHEN** `AskUserQuestion` 无法继续
- **THEN** descriptor 缺失、禁用、不可用或非 bundled 解析 MUST 映射到 `CAPABILITY_UNAVAILABLE`
- **AND** schema、预算、选项约束或禁止 purpose 校验失败 MUST 映射到 `INVALID_INPUT`
- **AND** pending 边界不可用、checkpoint/pending 接受失败或活跃 pending 冲突 MUST 映射到 `PENDING_INPUT_UNAVAILABLE`
- **AND** pending 接受完成前的 abort 或 cancellation MUST 映射到 `ABORTED`
- **AND** 意外的生产者失败 MUST 映射到 `EXECUTION_FAILED`。

#### Scenario: Pending 问题不是即时的 capability result
- **WHEN** `AskUserQuestion` 成功创建一个 pending input
- **THEN** Agent/core MUST 通过 `AgentExecutionOutcome.status="PENDING_INPUT"` 停止当前 dispatch
- **AND** 在 pending input 被回答之前，Agent/core MUST NOT 为该 `AskUserQuestion` tool call 追加 model 可见的 `CAPABILITY_RESULT`
- **AND** pending 移交成功之后，Agent/core MUST NOT 继续同一 dispatch 中的后续 tool call
- **AND** runtime MUST NOT 因 `AskUserQuestion` 返回了 pending 引用而对 run 做 terminal commit。

#### Scenario: 可信坐标不由工具输入提供
- **WHEN** `AskUserQuestion` 提交 pending input intent
- **THEN** 已接受的 `RequestRun`、可信 `RequestContext`、owner scope、session id、request id 和 run id MUST 来自 Agent/core runtime 调用路径
- **AND** 工具输入 MUST NOT 提供或覆盖身份、幂等 key、session id、request id、run id、timeout 行为或答案 schema
- **AND** `multiple` 和 `custom` MAY 只作为被接受的问题约束出现，并且 MUST NOT 由客户端答案 payload 提供。

#### Scenario: 工具拒绝禁止的 prompt purpose
- **WHEN** 工具输入要求用户提供 credential、raw secret、授权授予、受保护操作的审批、高风险确认决策或人工移交/升级
- **THEN** 该工具 MUST 以安全的 `INVALID_INPUT` 校验结果拒绝该请求
- **AND** MUST NOT 创建 pending input
- **AND** AskUserQuestion MUST 只创建 `QUESTION` pending input，并且 MUST NOT 创建 `CONFIRMATION`、`AUTHORIZATION` 或 `HUMAN_HANDOFF` pending input
- **AND** 该工具 MUST NOT 将被拒绝的请求转发、升级、变换或重新路由到其他 pending input 种类、hook、guard、policy 路径或移交生产者
- **AND** 禁止 purpose 校验 MUST 是确定性的并由 fixture 驱动
- **AND** 本 change MUST NOT 引入 policy 引擎、风险分类器、语义意图分类器、model moderation 调用或可配置的 moderation 规则系统
- **AND** 模糊的非硬性情形 MUST 通过面向 model 的指导和 schema 边界处理，而不是在本 change 中引入新的 policy 逻辑。

#### Scenario: 问卷和长表单指导不创建 policy 引擎
- **WHEN** 面向 model 的工具描述劝阻问卷或长表单输入
- **THEN** 该指导 MUST NOT 在本 change 中引入 policy 引擎、风险分类器或问卷/表单分类器
- **AND** 系统只在该输入同时违反 descriptor schema/预算或请求了禁止的 prompt purpose 时才 MUST 拒绝它。

#### Scenario: 工具不拥有恢复状态
- **WHEN** 用户稍后回答该 pending input
- **THEN** runtime 拥有的 pending input 流 MUST 处理答案校验和恢复
- **AND** runtime/core MUST 将被接受的答案物化为恰好一条安全的 `CAPABILITY_RESULT`，对应由持久 runtime 拥有的 `producerRef.toolCallId` 标识的原始 `AskUserQuestion` tool call
- **AND** 当同一当前 tool 批次中存在多个 `AskUserQuestion` tool call 时，每个 pending input MUST 只物化由其自身 `producerRef.toolCallId` 标识的 tool call；后续调用只在恢复执行到达后才被处理
- **AND** runtime/core MUST NOT 在恢复期间重新调用 `AskUserQuestion`
- **AND** 该 tool handler MUST NOT 拥有终端状态、timeout 处理、答案校验或请求生命周期。

#### Scenario: 无新的 capability pending facade
- **WHEN** `AskUserQuestion` 与 pending input 集成
- **THEN** 本 change MUST NOT 引入 `CapabilityInvocationRuntimeContext.requestPendingInput(...)`
- **AND** 本 change MUST NOT 引入通用 pending producer registry、公开的 create-pending command、通用 policy port、新的 `RunStatus`、新的生命周期阶段、新的 checkpoint 触发器，或超出 contract/core pending change 所定义的 runtime 拥有的最小 `producerRef` 之外的 pending record 生产者/tool-call 字段。
