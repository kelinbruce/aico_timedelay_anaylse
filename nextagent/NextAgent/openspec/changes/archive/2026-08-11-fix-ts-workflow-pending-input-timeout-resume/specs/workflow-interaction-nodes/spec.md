## Function

- **所属 Function**：`FN-9.5 执行交互节点`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Interrupt Gateway

`interrupt` 节点 MUST 创建 pending input 暂停 workflow execution，在收到外部恢复后继续执行。超时 resume 时 MUST 抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT），由 engine exception 分支处理，无 exception 则 `terminalState: FAILED`。

**触发机制：**
- 节点 ready 时由 scheduler 触发
- 创建 pending input 后暂停当前 execution，等待外部恢复
- 外部恢复属于 request lifecycle 之外的动作，由 runtime resume 机制重新触发

**输入与前置条件：**
- `inputs.timeoutAt`（可选，秒级时间戳）
- runtime pending input boundary 可用

**输出与副作用：**
- 创建 pending input 事实（`USER_INPUT_REQUIRED` timeline event），收到恢复后输出 `interrupt_result`
- 超时：抛错产生 `NODE_FAILED` timeline event，`safeError` 携带 `WORKFLOW_NODE_TIMEOUT` code 和 `TIMEOUT` category

**状态 / 产物契约：**
- pending input 的 owner MUST 是 `agent-runtime`
- pending input 生命周期直到回答、超时或 cancel
- 超时 resume 不创建 replacement pending input；resume 后 engine handler throw 产生 `NODE_FAILED` 事件，exception 分支中的新 pending input 属于新节点产生

**流程接入：**
- 上游：任意普通节点
- 下游：`interrupt_result` 供后续节点消费；超时走 exception 分支或 FAILED 终止

**核心判断逻辑：**
1. 读取 `resumeState`（若存在）
2. 若 `resumeState.answers !== undefined`（有恢复答案）→ 输出 `interrupt_result`，继续执行
3. 若 `resumeState.answers === undefined`（超时恢复）→ 抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT）
4. 无 `resumeState`（首次执行）→ 创建 pending input，暂停 execution

**失败与降级：**
- 超时 → 抛 `WORKFLOW_NODE_TIMEOUT`，走 exception，无 exception 则 FAILED
- pending input boundary 不可用 → 抛 `WORKFLOW_PENDING_INPUT_BOUNDARY_UNAVAILABLE`，节点失败

**需求类别**：功能性需求

#### Scenario: Pause And Resume On External Recovery
- **WHEN** `interrupt` 节点创建 pending input 后收到外部恢复
- **THEN** execution MUST 恢复并继续下游

#### Scenario: Timeout Resume Throws Workflow Node Timeout
- **WHEN** `interrupt` 节点的 pending input 超时后 runtime resume 原 run
- **AND** `resumeState.answers` 为 `undefined`
- **THEN** handler MUST 抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT）
- **AND** engine MUST 路由到匹配的 exception 分支（若配置）
- **AND** 无 exception 匹配时 terminal 状态 MUST 为 `FAILED`

#### Scenario: Timeout Resume Does Not Create New Pending Input
- **WHEN** `interrupt` 节点的 pending input 超时后 runtime resume 原 run
- **AND** `resumeState.answers` 为 `undefined`
- **THEN** handler MUST NOT 调用 `requestPendingInput` 创建新 pending input
- **AND** handler MUST NOT 进入 fall-through 创建 pending input 的代码路径

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：`interrupt` 节点超时 resume（`resumeState.answers` 为 `undefined`）时抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT），不创建新 pending input，由 engine exception 分支处理或终态化 `FAILED`。
- **依据 Requirements**：`Interrupt Gateway`

### 结果

- **变更类型**：修改
- **目标内容**：超时后走 exception 分支（terminal 可能为 `COMPLETED`）或 `FAILED`（`WORKFLOW_NODE_TIMEOUT`）。
- **依据 Requirements**：`Interrupt Gateway`

### 规格

#### 规格项：超时行为

- **变更类型**：修改
- **原规格值**：超时 resume 后 fall through 创建新 pending input
- **目标规格值**：超时 resume 时抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT），不创建新 pending input
- **依据 Requirements**：`Interrupt Gateway`
