## MODIFIED Requirements

### Requirement: User Check

`user-check` MUST 按 `inputs.kind` 场景值（缺省 `QUESTION`）映射到 pending input kind，创建对应 pending input 并暂停 workflow execution，在收到回答后继续执行；`HUMAN_HANDOFF` 场景 MUST 通知后立即失败退出，不创建 pending input。

interaction 节点的 node-specific schema MUST 由本 capability owner 定义；`agent-contracts/core` 中的 `WorkflowNodeDef.inputs`、`outputs`、`outputParser` 只作为 opaque 容器，不得在 core contracts 中枚举 interaction 私有字段。

**场景与 kind 映射：**
- `inputs.kind` 为可选字段，取值为 `QUESTION`、`CONFIRMATION`、`AUTHORIZATION` 或 `HUMAN_HANDOFF`；缺省时 MUST 等价于 `QUESTION`。
- `QUESTION`：创建 `kind: "QUESTION"` pending input，recipe 通过 `tips`/`action_type`/`options`（choice 场景）或 `fields`（input 场景）定义提问内容。
- `CONFIRMATION`：创建 `kind: "CONFIRMATION"` pending input，handler MUST 自动构造固定二元 options（`approve`/`reject`），recipe 不写 `options` 和 `action_type`。
- `AUTHORIZATION`：创建 `kind: "AUTHORIZATION"` pending input，handler MUST 自动构造固定二元 options（`approve`/`deny`），recipe 不写 `options` 和 `action_type`。
- `HUMAN_HANDOFF`：MUST NOT 创建 pending input。handler MUST 通过 `emitOutputDelta` 将 `tips` 内容投影到 CONTENT channel，然后抛 `WORKFLOW_HUMAN_HANDOFF`（category: INTERNAL, retryable: false），走 exception 分支，无 exception 则 `terminalState: FAILED`。

**action_type 与 kind 交互规则：**
- `kind` 为 `QUESTION` 或缺省时，`action_type` 仍必填（`choice`/`input`/`confirm`），决定 question 结构和输出绑定。`confirm` 为兼容值，保留现有行为。
- `kind` 为 `CONFIRMATION`/`AUTHORIZATION`/`HUMAN_HANDOFF` 时，`action_type` MUST NOT 出现，handler MUST NOT 读取它。

**等待超时：**
- `user-check` 等待超时 MUST 复用节点顶层 `node.timeout`（秒），handler 读取 `context.node.timeout` 转换为 `timeoutAt`。
- 等待超时上限 MUST 为 48h（172800 秒），最小为 1s。
- 超时 MUST NOT 走兜底恢复。超时 MUST 抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT），由 engine exception 分支处理（支持 `error.category == "TIMEOUT"` 和自定义 condition 匹配），无 exception 则 `terminalState: FAILED`。
- `HUMAN_HANDOFF` 不需要等待超时（不等待回答，立即退出）。
- 废弃 `inputs.timeout`、`inputs.timeout_result`、`inputs.timeoutResult`、`timed_out` 输出变量。

**填空题格式约束（inputFormat）：**
- `QUESTION` + `action_type: input` 场景 MUST 支持通过 `inputs.fields` 定义填空题字段列表。`fields` 中每个 field 的字段不做约束，产品按需定义（如 `name`、`description`、`placeholder`、`pattern`、`maxLength` 等）。
- handler MUST 为每个 field 创建一个 `PendingInputQuestion`（`prompt` 取 `description`，`options` 为空，`custom: true`，`inputFormat` 携带 field 中除 `name`/`description` 外的格式约束字段）。
- `inputFormat` 随 `PendingInputQuestion` 透传给 task channel，task channel 据此渲染带前端校验的输入框。
- `inputFormat` 随 `PendingInputQuestionRecord` 持久化到 `PendingInputRecord`，stream gap 恢复后 task channel 仍可从 record 读取 `inputFormat` 重建 UI。
- resume 后 handler MUST 用 recipe `fields[].name` 做 key 组装结构化 `user_check_result`（多 field 时为对象，单 field 时为字符串）。`inputFormat` 本身 MUST NOT 进入 outputVariables。
- `CONFIRMATION`/`AUTHORIZATION`/`HUMAN_HANDOFF` 场景 MUST NOT 使用 `inputFormat`。

**触发机制：**
- 节点 ready 时由 scheduler 触发
- `QUESTION`/`CONFIRMATION`/`AUTHORIZATION` 在 workflow execution 阶段同步创建 pending input，随后异步等待用户动作
- `HUMAN_HANDOFF` 同步投影通知后立即抛错，不等待
- 用户回答属于 request lifecycle 之外的外部动作，由 runtime resume 机制重新触发

**输入与前置条件：**
- `inputs.kind`（可选，缺省 `QUESTION`）
- `tips`（提示/通知内容）
- `QUESTION` + choice 场景：`action_type: choice`、`options`
- `QUESTION` + input 场景：`action_type: input`、`fields`
- `CONFIRMATION`/`AUTHORIZATION` 场景：仅需 `tips`，无需 `options`/`action_type`
- `HUMAN_HANDOFF` 场景：仅需 `tips` 作通知内容
- `node.timeout`（`QUESTION`/`CONFIRMATION`/`AUTHORIZATION` 必填，`HUMAN_HANDOFF` 不需要）
- runtime pending input boundary 可用（`HUMAN_HANDOFF` 不需要）

**输出与副作用：**
- `QUESTION`/`CONFIRMATION`/`AUTHORIZATION`：创建 pending input 事实（`USER_INPUT_REQUIRED` timeline event），收到回答后输出 safe `user_check_result` 或等价回答结果
- `HUMAN_HANDOFF`：投影通知内容到 CONTENT channel（`emitOutputDelta` 产生 visible delta），无输出变量（抛错不产出）；抛错产生 `NODE_FAILED` timeline event，`safeError` 携带 `WORKFLOW_HUMAN_HANDOFF` code
- 超时：抛错产生 `NODE_FAILED` timeline event，`safeError` 携带 `WORKFLOW_NODE_TIMEOUT` code 和 `TIMEOUT` category

**核心判断逻辑：**
1. 读取 `inputs.kind`（缺省 `QUESTION`）
2. `HUMAN_HANDOFF` → `emitOutputDelta` + 抛 `WORKFLOW_HUMAN_HANDOFF`
3. 其他 kind → 校验 `tips` 和场景特定配置，按 kind 组装 pending input（CONFIRMATION/AUTHORIZATION 自动构造二元 options；QUESTION + input 从 fields 创建多 question）
4. 创建 pending input，暂停当前 execution
5. 回答到达后恢复 execution，按 kind 映射回答结果到输出变量

**状态 / 产物契约：**
- pending input 的 owner MUST 是 `agent-runtime`
- pending input 生命周期直到回答、超时或 cancel
- `HUMAN_HANDOFF` 不产生 pending input
- `inputFormat` 随 `PendingInputQuestionRecord` 持久化，消费方为 task channel，不进入 answer payload 或 outputVariables
- `emitOutputDelta` 投影内容与 execution / nodeId / retryCount 可追溯

**流程接入：**
- 上游：任意普通节点
- 下游：`QUESTION`/`CONFIRMATION`/`AUTHORIZATION` 回答结果供后续节点消费；`HUMAN_HANDOFF` 和超时走 exception 分支或 FAILED 终止

**失败与降级：**
- 超时 → 抛 `WORKFLOW_NODE_TIMEOUT`，走 exception，无 exception 则 FAILED
- `HUMAN_HANDOFF` → 抛 `WORKFLOW_HUMAN_HANDOFF`，走 exception，无 exception 则 FAILED
- CONFIRMATION reject / AUTHORIZATION deny → runtime 直接终态化 FAILED，workflow 不恢复
- pending input boundary 不可用 → 抛 `WORKFLOW_PENDING_INPUT_BOUNDARY_UNAVAILABLE`，节点失败
- 无效回答 → validation 失败，不得静默接受

#### Scenario: Pause And Resume On User Answer
- **WHEN** `user-check`（`kind: QUESTION`/`CONFIRMATION`/`AUTHORIZATION`）创建 pending input 后收到合法回答
- **THEN** execution MUST 恢复并继续下游

#### Scenario: Kind Defaults To Question
- **WHEN** `user-check` 节点未提供 `inputs.kind`
- **THEN** handler MUST 等价于 `kind: QUESTION` 处理
- **AND** `action_type`/`options`/`fields` 逻辑 MUST 与现有行为一致

#### Scenario: Confirmation Auto-Constructs Binary Options
- **WHEN** `user-check` 配置 `kind: CONFIRMATION` 且 recipe 未写 `options`
- **THEN** handler MUST 自动构造 options 为 `[{label:"approve", value:"approve"}, {label:"reject", value:"reject"}]`
- **AND** pending input kind MUST 为 `CONFIRMATION`

#### Scenario: Authorization Auto-Constructs Binary Options
- **WHEN** `user-check` 配置 `kind: AUTHORIZATION` 且 recipe 未写 `options`
- **THEN** handler MUST 自动构造 options 为 `[{label:"approve", value:"approve"}, {label:"deny", value:"deny"}]`
- **AND** pending input kind MUST 为 `AUTHORIZATION`

#### Scenario: Human Handoff Notifies And Exits
- **WHEN** `user-check` 配置 `kind: HUMAN_HANDOFF`
- **THEN** handler MUST 通过 `emitOutputDelta` 将 `tips` 投影到 CONTENT channel
- **AND** MUST 抛 `WORKFLOW_HUMAN_HANDOFF`（category: INTERNAL）
- **AND** MUST NOT 创建 pending input
- **AND** 无 exception 分支时 execution MUST 以 `terminalState: FAILED` 中断

#### Scenario: Timeout Is Failure Not Fallback
- **WHEN** `user-check`（`kind: QUESTION`/`CONFIRMATION`/`AUTHORIZATION`）等待超时且 `node.timeout` 到达
- **THEN** handler MUST 抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT）
- **AND** MUST NOT 使用兜底值冒充用户回答
- **AND** 无 exception 分支时 execution MUST 以 `terminalState: FAILED` 中断

#### Scenario: Timeout Routes Via Exception Condition
- **WHEN** `user-check` 超时抛 `WORKFLOW_NODE_TIMEOUT` 且节点定义了 `exception` 分支
- **THEN** exception condition MUST 能通过 `error.category == "TIMEOUT"` 或 `error.code == "WORKFLOW_NODE_TIMEOUT"` 匹配

#### Scenario: Node Timeout Reused As Wait Timeout
- **WHEN** `user-check` 配置节点顶层 `node.timeout`（秒）
- **THEN** handler MUST 读取 `context.node.timeout` 转换为 `timeoutAt`
- **AND** `inputs.timeout` MUST NOT 被读取

#### Scenario: Input Fields Create Questions With InputFormat
- **WHEN** `user-check` 配置 `kind: QUESTION`、`action_type: input` 且 `fields` 含多个字段定义
- **THEN** handler MUST 为每个 field 创建一个 `PendingInputQuestion`
- **AND** 每个 question 的 `prompt` MUST 取 field 的 `description`
- **AND** 每个 question 的 `options` MUST 为空、`custom` MUST 为 `true`
- **AND** 每个 question 的 `inputFormat` MUST 携带 field 中除 `name`/`description` 外的格式约束字段

#### Scenario: InputFormat Passed Through To Task Channel
- **WHEN** `user-check` 填空题场景创建带 `inputFormat` 的 pending input
- **THEN** pending input request 的 questions MUST 携带 `inputFormat`
- **AND** `inputFormat` MUST 随 `PendingInputQuestion` 透传给 task channel
- **AND** `inputFormat` MUST 随 `PendingInputQuestionRecord` 持久化到 `PendingInputRecord`
- **AND** resume 后 `inputFormat` MUST NOT 出现在 outputVariables

#### Scenario: Structured User Check Result For Multiple Fields
- **WHEN** `user-check` 填空题场景有多个 `fields` 且用户已回答
- **THEN** `user_check_result` MUST 为对象，key 取自 recipe `fields[].name`，value 取自对应 question 的回答
- **AND** 单 field 时 `user_check_result` MUST 为字符串

#### Scenario: Confirmation Reject Terminates Without Resume
- **WHEN** `user-check`（`kind: CONFIRMATION`）收到 `reject` 回答
- **THEN** runtime MUST 直接终态化为 FAILED
- **AND** workflow MUST NOT 恢复执行

#### Scenario: Pending Input Boundary Unavailable
- **WHEN** `user-check`（`kind: QUESTION`/`CONFIRMATION`/`AUTHORIZATION`）执行时 runtime pending input boundary 不可用
- **THEN** handler MUST 抛 `WORKFLOW_PENDING_INPUT_BOUNDARY_UNAVAILABLE`
- **AND** 节点 MUST 失败
