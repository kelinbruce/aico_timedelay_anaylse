# workflow-event-history Specification

## Purpose

定义 Workflow 内部过程与模型会话事实分离的 durable 边界：Direct Workflow 与 Workflow-as-Tool 的 inner process 使用 Event-owned lifecycle/product 语义（`PRODUCT_PROCESS` 从 persisted Event 恢复且不进入模型上下文），`TURN_ANSWER` 继续从 terminal Assistant Message 恢复。确保已完成 Workflow 的 live 与 cold history 最终显示一致，产品过程、模型协议和最终回答各自只有明确的 durable owner。
## Requirements
### Requirement: Workflow 内部过程与模型会话事实分离

系统 MUST 把 Workflow 产品过程与模型会话事实作为不同语义类别管理。Direct Workflow 内部 `TOOL`、`SKILL`、`SUBFLOW` 节点 MUST NOT 创建 `ASSISTANT_TOOL_USE` 或 `CAPABILITY_RESULT` Message，也 MUST NOT 为同一 inner result 产生 ordinary `CAPABILITY_RESULT_DELTA`。Workflow-as-Tool MUST 只为 model loop 真实发起的 outer invocation 保留 matching Tool protocol Message；inner Workflow process MUST NOT 创建第二组 protocol Message。

Workflow inner lifecycle MUST 由 Event 持有，且 MUST 只包含 Workflow、node 和 invocation identity、状态、顺序、耗时、重试或拓扑坐标以及安全失败事实。该 lifecycle MUST NOT 包含 description、input、output、arguments、result、safeResult、structuredPayload 或其他业务正文。Workflow `PRODUCT_PROCESS` MUST 由独立 product Event 持有；Direct Workflow 的 canonical `TURN_ANSWER` MUST 继续由 terminal Assistant Message 持有。

`PRODUCT_PROCESS` 与 `TURN_ANSWER` 的 TEXT 可能相同。系统 MUST 保留两个语义事实的各自 durable owner；值相等 MUST NOT 改变 owner，也 MUST NOT 把 Event body 写入 Message。Workflow Event 的模型上下文边界继承 `ts-stream-history-consistency` 的 `Process history never affects model context or prefix cache`，本 Requirement 不定义第二套 context、retry、edit 或 fork 规则。

**需求类别**：功能性需求

#### Scenario: Direct Workflow 内部节点不创建模型协议 Message

- **WHEN** Direct Workflow 执行内部 `TOOL`、`SKILL` 或 `SUBFLOW` 节点
- **THEN** 该节点的 lifecycle 与 product MUST 只由 Workflow process Event 表达
- **AND** 系统 MUST NOT 为该节点创建 `ASSISTANT_TOOL_USE` 或 `CAPABILITY_RESULT` Message
- **AND** 系统 MUST NOT 为该 inner result 产生 ordinary `CAPABILITY_RESULT_DELTA`
- **AND** terminal Assistant Message MUST 继续持有该轮 canonical `TURN_ANSWER`

#### Scenario: Workflow-as-Tool 只保留 outer 模型协议

- **WHEN** model loop 以 Tool 方式调用 Workflow
- **THEN** outer invocation MUST 保留 matching Tool use/result Message
- **AND** inner Workflow node MUST 只产生 Workflow process Event
- **AND** inner node MUST NOT 产生嵌套模型协议 Message

#### Scenario: 相同文本保持两个 durable owner

- **WHEN** 可信 Workflow `PRODUCT_PROCESS` TEXT 与 terminal `TURN_ANSWER` 文本完全相同
- **THEN** product Event 与 terminal Assistant Message MUST 同时保留
- **AND** 值相等 MUST NOT 改变两类事实的 durable owner
- **AND** 系统 MUST NOT 把 product Event body 写入 terminal Assistant Message

### Requirement: Workflow 完成态产品过程可从 Event 恢复

系统 MUST 把 Workflow `NODE_OUTPUT_DELTA` product fragment 保持为 `LIVE_ONLY`，并 MUST 把可信 Workflow 执行产生的 `NODE_STARTED` title 与 `NODE_COMPLETED` accumulated product 写为 durable Event。completed product MUST 保留 canonical Tool event/message vocabulary、content 与 Workflow execution identity。

当 Workflow product 的语义层级属于 title、detail 或 answer 三类之一时，Direct Workflow root recipe MUST 分别映射为 `TITLE`、`DETAIL`、`ANSWER`，Direct nested recipe 与 Workflow-as-Tool inner product MUST 分别映射为 `SUB_TITLE`、`SUB_DETAIL`、`SUB_CONCLUSION`。系统 MUST 根据已注册 recipe 与 execution 坐标确定 root/sub 层级，MUST NOT 根据 Event 到达顺序猜测。`EXPAND_PANEL` 以及本 Requirement 未修改的其他既有 canonical `ToolEventType` 映射 MUST 保持不变。

只有通过可信 Agent routing 或 governed Workflow Tool invocation 执行已注册 recipe 所产生的 Workflow lifecycle/product Event，才具有 message-free 资格。ordinary Tool、Skill、Bash、LLM、ApiCall、CLIP 或任意 output 自报的 Workflow namespace、event type 或 persistence hint MUST NOT 获得该例外。现有 structured projection validation 与安全投影规则 MUST 保持不变。

**需求类别**：功能性需求

#### Scenario: 完成态产品是唯一过程正文 carrier

- **WHEN** Workflow node 产生合法 completed product
- **THEN** 系统 MUST 把 completed product Event 持久化为该产品过程的唯一 durable body carrier
- **AND** Direct 与 Workflow-as-Tool inner process MUST 使用同一 product Event contract
- **AND** matching fragment MUST 保持 live-only
- **AND** matching fragment MUST NOT 写入 timeline

#### Scenario: 内部 Capability Result 不形成第二个 carrier

- **WHEN** Workflow 内部 `TOOL`、`SKILL` 或 `SUBFLOW` 完成并产生用户可见 product
- **THEN** matching Workflow product Event MUST 是该 product 的唯一 durable body carrier
- **AND** 系统 MUST NOT 为该 inner node 创建 `CAPABILITY_RESULT` Message 或 ordinary `CAPABILITY_RESULT_DELTA`

#### Scenario: 自报 Workflow identity 不能取得 message-free 资格

- **WHEN** ordinary Capability output 自报 Workflow namespace、event type 或 persistence hint
- **THEN** 系统 MUST NOT 把该 output 识别为 Event-owned Workflow process
- **AND** ordinary Message-backed process MUST 继续遵循既有 Message association 与 persistence 规则

#### Scenario: 产品层级不改变 canonical answer owner

- **WHEN** Workflow completed product 使用 `ANSWER` 或 `SUB_CONCLUSION` 展示层级
- **THEN** 该字段 MUST 只表示 product hierarchy
- **AND** terminal Assistant Message MUST 继续是 canonical `TURN_ANSWER` owner

#### Scenario: 未触及 canonical level 保持既有映射

- **WHEN** Workflow product 使用 `EXPAND_PANEL` 或本 Requirement 未修改的其他 canonical `ToolEventType`
- **THEN** 系统 MUST 沿用该 level 的既有映射
- **AND** 系统 MUST NOT 将其重映射为 `TITLE`、`DETAIL`、`ANSWER`、`SUB_TITLE`、`SUB_DETAIL` 或 `SUB_CONCLUSION`

