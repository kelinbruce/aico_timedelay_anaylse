## Function

- **所属 Function**：`FN-5.17 技能驱动 API 调用`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Orchestration Layer Invokes API Tool And Returns Terminal Response

系统 MUST 在 Skill result 出现 `nonAgenticApiCall=true` 时，由 `agent-core` orchestration 从当前请求头提取 header params、从 trusted context 取得 request params、构造 trusted `ApiCall` input，并通过 `capabilityInvocation.invoke()` 调用隐藏 API Tool。参数模型提取继续属于 API Tool，orchestration MUST NOT 自行执行参数模型提取。

API Tool 成功且当前路径已经由 `nonAgenticApiCall=true` 选择为 direct-terminal caller 时，orchestration MUST 保留真实 outer Tool invocation 已有的 matching Tool use/result Message、structured delta、completion Event 和 checkpoint，并 MUST 把 API Tool 最终结果作为 Capability 来源 terminal answer 交给 Runtime。系统 MUST 跳过后续普通 model loop，MUST NOT 为该 Capability 结果生成 final `LLM_CONTENT_DELTA`。Runtime MUST 按 `large-content-references` 对超长 Capability terminal answer 物化 workspace preview/ref；inline terminal Assistant Message MUST 保持既有 `PLAIN_TEXT` 答案显示，超长 Message MUST 使用物化后的 projection。

handoff content MUST 保持既有 non-agentic terminal selection：全 structured stream 使用当前零宽占位，存在 non-structured streaming parts 时使用其既有聚合正文，没有 streaming chunk 时使用既有最终 payload 序列化正文。orchestration MUST NOT 为采用 Capability handoff 而改变 PIU/structured answer presentation。模型 final-content 的长度与结构 guard MUST NOT 在该 Capability handoff 前拒绝成功的大结果；Runtime MUST 先执行 Capability materialization，再应用最终 Message 容量纵深校验。

同一 tool round 同时包含非 agentic API dispatch 和其他 Tool results 时，系统 MUST 以 `NON_AGENTIC_BATCH_CONFLICT` 拒绝该批次。API Tool 最终失败继续按既有 Capability failure 语义终止，不得把失败结果作为成功 terminal answer。

对于不超过 Capability inline 上限的非 agentic `ApiCall`，pre-round 与 post-tool-call 两条成功路径 MUST 保留其 terminal selection、structured ANSWER、PIU/DSL、过程条目、状态和相对顺序。live subscriber MUST 在 terminal completion presentation 中直接得到与 committed terminal Message 相同且恰好一个的最终答案，terminal content type MUST 为 `PLAIN_TEXT`；系统 MUST NOT 产生空白答案、重复答案、来源标签、新卡片、新提示或新的用户操作。普通 model-driven `ApiCall` MUST 保留 matching Tool protocol Message、Capability lifecycle、后续模型调用和 LLM 来源最终答案。

**需求类别**：功能性需求

#### Scenario: Orchestration detects non-agentic signal and invokes API tool

- **WHEN** `Skill` tool result 的 metadata 包含 `nonAgenticApiCall=true`
- **THEN** orchestration MUST 提取 api name、hiro、Skill identity、`apiHeaderParams` 与 `apiRequestParams`
- **AND** MUST 从当前请求头和 trusted context 取得声明参数
- **AND** MUST 从 `RequestContext.acceptedInputText` 取得原始问题
- **AND** MUST 通过 `capabilityInvocation.invoke()` 使用 trusted input 调用 `ApiCall`
- **AND** API Tool 返回后 MUST NOT 继续普通 model loop

#### Scenario: API tool result becomes Capability terminal response

- **WHEN** API Tool 返回成功 `CapabilityInvocationResult`
- **THEN** orchestration MUST 把最终结果作为 Capability 来源 terminal answer 交给 Runtime
- **AND** Runtime MUST 把该结果提交为 terminal Assistant Message
- **AND**系统 MUST NOT 为该结果生成 final `LLM_CONTENT_DELTA`
- **AND** inline terminal Message MUST 保持既有 `PLAIN_TEXT` 答案显示且不得新增来源标记

#### Scenario: API tool result becomes terminal response

- **WHEN** the API tool returns a successful `CapabilityInvocationResult`
- **THEN** the orchestration layer MUST hand the result to Runtime as a Capability-origin terminal answer
- **AND** Runtime MUST write the materialized projection to the terminal Assistant Message
- **AND** the orchestration layer MUST skip subsequent model invocation
- **AND** the run MUST reach terminal state with the API result projection as the final response

#### Scenario: 超长API结果安全终态化

- **GIVEN**成功 API Tool result 的 terminal 正文超过 50,000 个字符
- **WHEN** Runtime 准备 terminal composite write
- **THEN**系统 MUST 使用统一 Capability externalizer 保存完整原文
- **AND** terminal Assistant Message MUST 保存不超过 50,000 字符的 preview/ref projection
- **AND** request MUST 到达成功 terminal state

#### Scenario: Model-driven ApiCall不直接终态化

- **WHEN** `ApiCall` 由普通 Model Loop tool call 调用且没有 `nonAgenticApiCall=true` direct-terminal 选择
- **THEN** orchestration MUST NOT 调用 Capability terminal answer handoff
- **AND** MUST 把 outer Capability Result 反馈父 Model Loop
- **AND**系统 MUST 保留 matching Tool use/result Message、Capability lifecycle 与后续模型调用
- **AND**最终答案 MUST 继续由 LLM Executor 产生
- **AND**系统 MUST NOT 增加新的用户可见呈现

#### Scenario: Structured ApiCall保持既有答案显示

- **WHEN**非 agentic ApiCall 的 streaming chunks 全部匹配既有 structured presentation shape
- **THEN** Capability terminal handoff MUST 使用当前零宽 terminal 占位
- **AND** MUST NOT 把最终 raw structured payload 作为新的可见 terminal text
- **AND** structured Event presentation MUST 保留各 chunk 的 `toolMessageLevel`、`toolMessageType`、content 和相对顺序

#### Scenario: 边界内非agentic ApiCall保持单一答案和结构化呈现

- **GIVEN** pre-round 或 post-tool-call 的非 agentic `ApiCall` 成功结果不超过 Capability inline 上限
- **WHEN**结果分别使用全 structured stream、混合 stream 或无 streaming chunk 交付
- **THEN**系统 MUST 保留对应 terminal selection、PIU/DSL、过程条目、状态和相对顺序
- **AND** live MUST 在请求完成时直接显示与 committed terminal Message 相同且唯一的答案
- **AND** terminal content type MUST 为 `PLAIN_TEXT`
- **AND**系统 MUST NOT 产生空白、重复、来源标签、新卡片、新提示或新的用户操作

#### Scenario: Non-agentic batch conflict is rejected

- **WHEN**同一 tool round 同时包含 `nonAgenticApiCall=true` 的 Skill result 和其他 Tool results
- **THEN** orchestration MUST 拒绝该批次
- **AND** MUST 返回 `NON_AGENTIC_BATCH_CONFLICT` safe error

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：非 agentic ApiCall 成功结果通过 Capability 来源 terminal handoff 进入 Runtime，不再通过 final LLM delta 冒充模型结果。
- **依据 Requirements**：`Orchestration Layer Invokes API Tool And Returns Terminal Response`

### 结果

- **变更类型**：修改
- **目标内容**：ApiCall terminal response 在 50,000 字符内 inline，超限时显示 workspace preview/ref 并保留完整原文。
- **依据 Requirements**：`Orchestration Layer Invokes API Tool And Returns Terminal Response`

### 规格

- **规格项**：终态返回
- **变更类型**：修改
- **原规格值**：`ApiCall` Tool 结果写入 terminal Assistant Message，跳过后续 model invocation
- **目标规格值**：`ApiCall` Tool 结果通过 Capability 来源 terminal handoff 写入 terminal Assistant Message；超出 50,000 字符时使用 workspace preview/ref；不生成 final LLM delta
- **依据 Requirements**：`Orchestration Layer Invokes API Tool And Returns Terminal Response`
