## Function

- **所属 Function**：`FN-9.1 执行工作流`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Direct Workflow 通过 Capability 结果交付终态回答

Direct Workflow 与 Workflow-as-Tool MUST 使用同一 Workflow execution engine、recipe 解析、节点执行、pending input、checkpoint、取消和内部 Event 投影。Workflow 完成结果 MUST 被识别为 Capability Executor 结果，不得因 caller 不同而重新分类为 LLM Executor 输出。

Direct Workflow 成功完成且 routing 已选择 direct-terminal caller 时，Agent Core MUST 把 Workflow 结果作为 Capability 来源 terminal answer 交给 Runtime，并 MUST NOT 为该结果生成 final `LLM_CONTENT_DELTA`。Runtime MUST 把该结果投影为唯一 terminal Assistant Message；inline 结果 MUST 保持既有 `PLAIN_TEXT` 答案显示，结果超出 Capability inline 上限时 MUST 应用 `large-content-references` 的统一 workspace preview/ref 规则。

Workflow-as-Tool 成功完成时，系统 MUST 把同一类 engine result 作为真实 outer Tool invocation 的 `CapabilityInvocationResult` 返回父 Model Loop，并 MUST 保留 matching Tool use/result Message；父 LLM 生成的后续 final answer 继续属于 LLM Executor。两种 caller 均 MUST 保持 Workflow inner node 的 Event-owned process/product 边界，不得为 inner node 创建 Tool protocol Message。

对于不超过 Capability inline 上限的 Direct Workflow 结果，live 与 history presentation MUST 保持修改前相同的 terminal `PLAIN_TEXT` 答案和 structured presentation。Workflow inner process/product MUST 保留其公开条目、业务正文、状态和相对顺序，并 MUST 继续只按 `toolEventType` 决定展示区域：`ANSWER` 投影到答案区，`TITLE`、`SUB_TITLE`、`DETAIL`、`SUB_DETAIL` 等过程类型投影到执行过程区域。系统 MUST NOT 因 Workflow correlation 改写 `ANSWER` 的区域语义，也 MUST NOT 增加来源标签、Capability 卡片、容量提示或新的用户操作。live subscriber MUST 在 terminal completion presentation 中直接获得 committed terminal Message，MUST NOT 依赖刷新或额外读取才能看到正文。

**需求类别**：功能性需求

#### Scenario: Direct Workflow结果直接终态化

- **WHEN** Direct Workflow 成功完成并产生最终结果
- **THEN** Agent Core MUST 把该结果作为 Capability 来源 terminal answer 交给 Runtime
- **AND** Runtime MUST 从该 handoff 创建 terminal Assistant Message
- **AND**系统 MUST NOT 为该结果发出 final `LLM_CONTENT_DELTA`
- **AND** inline Message MUST 保持既有 `PLAIN_TEXT` 答案显示且不得新增来源标记

#### Scenario: Direct Workflow大结果复用Capability保护

- **GIVEN** Direct Workflow 的最终结果超过 Capability inline 上限
- **WHEN**系统提交请求终态
- **THEN** terminal Assistant Message MUST 保存 `large-content-references` 定义的 preview/ref projection
- **AND**完整结果 MUST 由 owner-scoped workspace 文件持有
- **AND**请求 MUST NOT 只因原始结果超长而缺失 terminal facts

#### Scenario: Workflow-as-Tool返回父Model Loop

- **WHEN**父 Model Loop 通过真实 Tool call 调用 Workflow
- **THEN** Workflow engine MUST 返回 matching outer `CapabilityInvocationResult`
- **AND**父 Model Loop MUST 消费 outer Tool result
- **AND**本 Requirement MUST NOT 把该结果直接提交为 request terminal answer
- **AND** matching outer Tool use/result、父模型后续调用条件和公开 inner process MUST 按 Workflow outcome 保持完整
- **AND**系统 MUST NOT 增加 direct terminal answer、答案卡片或重复过程条目

#### Scenario: 边界内Direct Workflow保持既有答案和过程投影

- **GIVEN** Direct Workflow 成功结果不超过 Capability inline 上限
- **WHEN**用户分别观察 live 执行、请求完成和 cold history
- **THEN** live 与 cold history MUST 在答案区显示正文相同、content type 为 `PLAIN_TEXT` 的恰好一个 terminal Message projection
- **AND** Workflow 产生 structured `ANSWER` 时 MUST 同时保留其既有答案区 presentation
- **AND** Workflow inner process/product MUST 保留其公开条目、业务正文、状态和相对顺序
- **AND** live MUST 在请求完成时直接显示 terminal Message projection，不得要求刷新或额外读取
- **AND**系统 MUST NOT 新增来源标签、Capability 卡片、容量提示或用户操作

#### Scenario: Workflow节点ANSWER产物留在答案区

- **GIVEN** Direct Workflow 的一个内部节点通过 `TOOL_STRUCTURED_DELTA` 产生 `toolEventType=ANSWER` 的 completed product
- **AND**请求终态关联到已提交的 terminal Assistant Message
- **WHEN**用户观察 settled live 或 cold history
- **THEN**该 Workflow completed product MUST 按 `ANSWER` 语义在答案区保持可见
- **AND**该 product MUST NOT 因 Workflow correlation 被移动到执行过程区域
- **AND** terminal Assistant Message MUST 继续按既有 terminal selection 显示；测试或 producer MUST NOT 为验证去重而构造两份语义重复的用户可见正文

#### Scenario: Direct Workflow失败不得提交成功答案

- **WHEN** Direct Workflow 返回 `FAILED` 或 `INTERRUPTED`
- **THEN** Agent Core MUST 按既有 Workflow safe failure 终止请求
- **AND** MUST NOT 调用 Capability terminal answer handoff

#### Scenario: 两种caller保持相同内部过程边界

- **WHEN**同一 recipe 分别由 Direct Workflow 与 Workflow-as-Tool 执行
- **THEN**两条路径 MUST 使用相同的 inner node execution 与 Event projection
- **AND** inner node MUST NOT 创建 `ASSISTANT_TOOL_USE` 或 `CAPABILITY_RESULT` Message
- **AND** caller 差异 MUST 只影响 engine 最终结果的 consumer

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：Direct caller 把 Workflow engine result 作为 Capability 来源 terminal answer 交给 Runtime；Tool caller 把 result 返回父 Model Loop；内部执行路径保持一致。
- **依据 Requirements**：`Direct Workflow 通过 Capability 结果交付终态回答`

### 结果

- **变更类型**：修改
- **目标内容**：Direct Workflow 最终结果形成 terminal Assistant Message；超长结果保留 workspace 全文和有界 preview/ref，不伪装成模型输出。
- **依据 Requirements**：`Direct Workflow 通过 Capability 结果交付终态回答`

### 规格

- **规格项**：Direct Workflow 终态结果来源
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：Capability 来源 terminal answer；不产生 final `LLM_CONTENT_DELTA`
- **依据 Requirements**：`Direct Workflow 通过 Capability 结果交付终态回答`
