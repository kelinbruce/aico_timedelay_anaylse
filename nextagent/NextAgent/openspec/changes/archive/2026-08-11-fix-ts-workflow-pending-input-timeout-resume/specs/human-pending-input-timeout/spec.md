## Function

- **所属 Function**：`FN-6.5 请求用户确认或授权`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：补充规格

## MODIFIED Requirements

### Requirement: Timeout never auto-approves

NextAgent SHALL never treat timeout as approval for any pending input kind。

对于 `producerRef.kind === 'WORKFLOW_NODE'` 的 pending input 超时，runtime resume 原 run 后由 workflow engine handler 决定终态：engine handler throw `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT）后，若 recipe 配置了匹配的 exception 分支（如 `error.category == 'TIMEOUT'`），run 走 exception 分支（terminal 可能为 `COMPLETED`）；若无 exception 匹配，run 终态为 `FAILED`，`failureReason` 为 `WORKFLOW_NODE_TIMEOUT`。

对于 `producerRef.kind !== 'WORKFLOW_NODE'` 的 pending input 超时，runtime 直接终态化 `FAILED`，`failureReason` 为 `PENDING_INPUT_TIMEOUT`。

**需求类别**：功能性需求

#### Scenario: Confirmation timeout is not approval
- **WHEN** a `CONFIRMATION` pending input times out
- **THEN** runtime MUST treat the result as non-approval
- **AND** protected continuation MUST NOT proceed as if the user approved
- **AND** if the original run or confirmed step is terminalized by timeout, the visible terminal reason MUST be `PENDING_INPUT_TIMEOUT`（对于 non-WORKFLOW_NODE producerRef）或 `WORKFLOW_NODE_TIMEOUT`（对于 WORKFLOW_NODE producerRef 且无 exception 匹配）

#### Scenario: Authorization timeout is not approval
- **WHEN** an `AUTHORIZATION` pending input times out
- **THEN** runtime MUST treat the result as denial or safe non-execution
- **AND** the protected operation MUST NOT execute
- **AND** if the original run or guarded step is terminalized by timeout, the visible terminal reason MUST be `PENDING_INPUT_TIMEOUT`（对于 non-WORKFLOW_NODE producerRef）或 `WORKFLOW_NODE_TIMEOUT`（对于 WORKFLOW_NODE producerRef 且无 exception 匹配）

#### Scenario: Question and handoff timeout do not invent answers
- **WHEN** a `QUESTION` or `HUMAN_HANDOFF` pending input times out
- **THEN** runtime MUST NOT synthesize a user answer, final answer or resume instruction
- **AND** runtime MUST terminalize or resume the original run through the timeout outcome defined for that kind
- **AND** 对于 WORKFLOW_NODE producerRef，runtime MUST resume 原 run 且 MUST NOT 设置 `answers` 字段，由 engine handler 决定终态
- **AND** 对于 non-WORKFLOW_NODE producerRef，runtime MUST terminalize the original run，visible terminal reason MUST be `PENDING_INPUT_TIMEOUT`

#### Scenario: WORKFLOW_NODE timeout routes via engine exception
- **WHEN** 一个 `producerRef.kind === 'WORKFLOW_NODE'` 的 pending input 超时
- **AND** recipe 配置了 `exception: { condition: "${error.category == 'TIMEOUT'}" }` 分支
- **AND** checkpoint 可用
- **THEN** runtime MUST resume 原 run（不设 `answers`）
- **AND** engine handler MUST throw `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT）
- **AND** engine MUST 路由到匹配的 exception 分支
- **AND** terminal 状态 MAY 为 `COMPLETED`（exception 分支成功执行后）

#### Scenario: WORKFLOW_NODE timeout without exception terminalizes FAILED
- **WHEN** 一个 `producerRef.kind === 'WORKFLOW_NODE'` 的 pending input 超时
- **AND** recipe 未配置匹配的 exception 分支
- **AND** checkpoint 可用
- **THEN** runtime MUST resume 原 run（不设 `answers`）
- **AND** engine handler MUST throw `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT）
- **AND** terminal 状态 MUST 为 `FAILED`
- **AND** `failureReason` MUST 为 `WORKFLOW_NODE_TIMEOUT`

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：WORKFLOW_NODE 超时 resume 原 run（不设 `answers`）后由 engine handler throw `WORKFLOW_NODE_TIMEOUT`，走 exception 分支或终态化 `FAILED`；非 WORKFLOW_NODE 超时直接终态化 `FAILED`（`PENDING_INPUT_TIMEOUT`）。
- **依据 Requirements**：`Timeout never auto-approves`

### 结果

- **变更类型**：修改
- **目标内容**：WORKFLOW_NODE 超时可见终态原因为 `WORKFLOW_NODE_TIMEOUT`（无 exception 匹配）或 `COMPLETED`（exception 分支成功执行）；非 WORKFLOW_NODE 超时可见终态原因为 `PENDING_INPUT_TIMEOUT`。
- **依据 Requirements**：`Timeout never auto-approves`

### 规格

#### 规格项：超时终态原因

- **变更类型**：修改
- **原规格值**：超时终态可见原因固定为 `PENDING_INPUT_TIMEOUT`
- **目标规格值**：WORKFLOW_NODE 超时终态原因为 `WORKFLOW_NODE_TIMEOUT`（无 exception）或 `COMPLETED`（有 exception）；非 WORKFLOW_NODE 为 `PENDING_INPUT_TIMEOUT`
- **依据 Requirements**：`Timeout never auto-approves`
