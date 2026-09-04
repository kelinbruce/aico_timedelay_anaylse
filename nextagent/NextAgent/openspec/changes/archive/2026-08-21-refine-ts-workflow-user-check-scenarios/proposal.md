## 背景与问题（Why）

`user-check` 节点当前只支持一种交互形态：创建 `kind: "QUESTION"` 的 pending input，用 `inputs.timeout`（秒）做等待超时，超时后用 `inputs.timeout_result` 兜底值冒充用户回答继续执行。这个实现与电信网络智能体的实际人机协同需求存在三个 gap：

1. **等待超时语义错位**。`inputs.timeout` 走的是「超时后用兜底值继续执行」的恢复语义，而电信场景需要的是「超时即失败」——缺信息没人补、高危确认没人批、异常退出没人接，都应让 workflow 失败退出。此外等待超时上限为 24h，而人工接管的实际响应窗口可能跨天（如夜间告警），需要放宽到 48h。`node.timeout`（节点顶层属性）当前只被 engine 用作单次 handler 执行的 abort signal，在 user-check 等待期间不计时，没有被复用为等待超时。

2. **填空题无法传递格式约束**。QUESTION + input 场景下，用户需要自由输入，但 `PendingInputQuestion` 的 `custom: true` 只表示「允许自定义文本」，不携带字段标识（name）、placeholder、正则、maxLength 等格式约束信息。task channel 拿到一个填空题 pending input，只知道问什么（prompt），不知道期望什么格式，无法渲染带前端校验的输入框。当前 `PendingInputQuestion` 结构只有 `{ prompt, options, multiple?, custom? }`，无格式约束字段。

3. **场景只有 QUESTION 一种**。电信场景需要三种人机协同：缺信息补充（QUESTION）、高危确认（CONFIRMATION/AUTHORIZATION）、异常退出人工接管（HUMAN_HANDOFF）。当前 handler 硬编码 `kind: "QUESTION"`，不读取场景字段，不映射到 runtime 的四种 pending input kind。CONFIRMATION/AUTHORIZATION 的固定二元 options（approve/reject、approve/deny）由 handler 自动构造的需求无法实现；HUMAN_HANDOFF 作为「通知后立即失败退出」的单向通知（不走 pending input、不等待回答）也无法实现。

## 变更范围（What Changes）

### 超时字段（Gap1）

- **BREAKING** `user-check` 等待超时字段从 `inputs.timeout` 改为复用节点顶层 `node.timeout`（秒），handler 读取 `context.node.timeout` 转换为 `timeoutAt`。
- **BREAKING** 废弃 `inputs.timeout`、`inputs.timeout_result`、`inputs.timeoutResult`、`readTimeoutResult` 和 `timed_out` 输出变量。超时不再走兜底恢复，改为抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT），由 engine 现有 exception 分支处理（支持 `error.category == "TIMEOUT"` 和自定义 condition 匹配），无 exception 分支则 `terminalState: FAILED`。
- runtime pending input 等待超时上限从 24h 放宽到 48h（`pendingInputMaxTimeoutMs` 常量值变更），最小保持 1s。该变更是 runtime 实现内部常量调整，不涉及 contract 字段。

### 填空题格式约束（Gap2）

- recipe 在 `inputs.fields` 中定义填空题字段列表（含 `name`、`description`、`placeholder`、`pattern`、`maxLength` 等），handler 为每个 field 创建一个 `PendingInputQuestion`（prompt 取 description，options 为空，custom=true，inputFormat 携带格式约束）。
- **BREAKING** `agent-contracts` 的 `PendingInputQuestion`（runtime）和 `PendingInputQuestionRecord`（gateway）新增 `inputFormat?: JsonObject` 字段。`inputFormat` 为 opaque JSON 对象，子字段不做约束，产品按需定义。
- askUserQuestion 不设 inputFormat，行为完全不变（向后兼容）。
- runtime `assertValidPendingInputAnswerEntry` 对填空题可选校验 inputFormat.pattern 和 maxLength（如果 inputFormat 存在）。
- handler resume 路径用 inputFormat.name 做 key 组装结构化 `user_check_result`（多 field 时为对象，单 field 时为字符串）。inputFormat 不进 outputVariables（它是 question 级元数据，不是回答结果）。
- workflow → runtime bridge（default-agent）透传 inputFormat（随 PendingInputQuestion 一起透传，无需额外字段）。
- CONFIRMATION/AUTHORIZATION/HUMAN_HANDOFF 场景不使用 inputFormat。

### 场景支持（Gap3）

- **BREAKING** 新增 `inputs.kind` 字段，值为 `QUESTION`/`CONFIRMATION`/`AUTHORIZATION`/`HUMAN_HANDOFF`，handler 按值映射 pending input kind。
- QUESTION：保留现有 `tips`/`action_type`/`options` 字段（choice 场景）或 `fields` 字段（input 场景），handler 组装 pending input（kind=QUESTION）。
- CONFIRMATION/AUTHORIZATION：recipe 不写 `options`，不写 `action_type`，handler 按 kind 自动构造固定二元 options（CONFIRMATION → approve/reject，AUTHORIZATION → approve/deny）。
- **BREAKING** HUMAN_HANDOFF 不走 pending input。handler 通过 `emitOutputDelta` 投影 `tips` 通知内容到 CONTENT channel，然后抛 `WORKFLOW_HUMAN_HANDOFF`（category: INTERNAL, retryable: false），走 exception 分支，无 exception 则 FAILED 中断。
- handler resume 路径按 kind 区分 answers 结构和输出绑定（QUESTION 自定义值、CONFIRMATION/AUTHORIZATION approve、HUMAN_HANDOFF 不 resume）。
- QUESTION 场景下 `action_type` 与 `kind` 的交互规则：`kind: QUESTION` 时 `action_type` 仍必填（choice/input/confirm，`confirm` 为兼容值保留现有行为），决定 question 结构和输出绑定；`kind` 非 QUESTION 时 `action_type` MUST NOT 出现，handler MUST NOT 读取它。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `workflow-interaction-nodes`: `User Check` requirement 重述——kind 场景映射、`node.timeout` 等待超时、超时失败走 exception、填空题 inputFormat 透传、HUMAN_HANDOFF 通知后失败退出。
- `workflow-execution-engine`: `Timeout and Retry` requirement 更新——对齐 `node.timeout` 在 user-check 等待型节点的复用语义和超时失败变量空间。
- `ts-core-contracts`: pending input 边界对象 requirement 更新——`PendingInputQuestion` 和 `PendingInputQuestionRecord` 新增 `inputFormat?` 字段（BREAKING，需 frozen core contract refinement 确认）。

## 影响范围（Impact）

- **agent-contracts**: `PendingInputQuestion`（runtime）和 `PendingInputQuestionRecord`（gateway）新增 `inputFormat?: JsonObject` 字段。
- **agent-workflow**: `executeUserCheckNode` 重构——读 `context.node.timeout`、读 `inputs.kind`、读 `inputs.fields`（input 场景）、按 kind 组装/分流；废弃 `inputs.timeout`/`timeout_result`/`readTimeoutResult`/`timed_out`；`pendingInputActivationToJson`/`parsePendingInputActivation`/`parsePendingInputRequest`/`parsePendingInputQuestions` 透传 inputFormat。
- **agent-core**: default-agent bridge 透传 inputFormat（随 questions 一起透传）。
- **agent-runtime**: `pendingInputMaxTimeoutMs` 24h→48h（实现内部常量）；`assertValidPendingInputAnswerEntry` 对填空题可选校验 inputFormat.pattern/maxLength；`acceptPendingInput` 构造 `PendingInputRequestRecord` 时透传 `question.inputFormat` 到持久化 record。
- **agent-channel-web**: pending input stream projection 暴露 inputFormat。
- **测试**: gap1 超时抛错走 exception/无 exception 则 FAILED/48h 边界；gap2 inputFormat 透传与校验；gap3 四种 kind 创建/resume/终态、HUMAN_HANDOFF emitOutputDelta+FAILED。
- **依赖**: gap1 超时 exception 路由依赖 `refine-ts-workflow-exception-failure-contract` active change 的 `error.category == "TIMEOUT"` shape 约定，该 change 须先落地；gap2 inputFormat 字段涉及 `ts-core-contracts` frozen core contract（PendingInputQuestion），需 contract refinement 确认。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/workflow-interaction-nodes/spec.md`：修改，重述 User Check requirement（kind 场景、node.timeout 等待超时、超时失败、inputFormat 透传、HUMAN_HANDOFF 通知后失败退出）。
- `openspec/specs/workflow-execution-engine/spec.md`：修改，更新 Timeout and Retry requirement 对齐 node.timeout 复用语义。
- `openspec/specs/ts-core-contracts/spec.md`：修改，pending input 边界对象 requirement 新增 inputFormat 字段（PendingInputQuestion + PendingInputQuestionRecord）。

长期背景：
- `openspec/overview.md`：无（user-check 场景增强是模块内行为，不影响系统级背景）。

设计视图：
- `openspec/designs/architecture/workflow-execution-and-routing.md`：修改，补充 user-check 等待超时复用 node.timeout、超时失败走 exception、HUMAN_HANDOFF 通知后失败退出的跨模块流程。
- `openspec/designs/modules/agent-workflow.md`：修改，补充 executeUserCheckNode 按 kind 分流、inputFormat 透传的设计落点。
- `openspec/designs/adr/workflow-user-check-timeout-reuse.md`：新增 ADR，记录 node.timeout 复用为等待超时的取舍（abort signal 与等待超时生命周期不重叠、同形同策例外）。
- `openspec/designs/adr/workflow-human-handoff-notify-exit.md`：新增 ADR，记录 HUMAN_HANDOFF 在 user-check 中不走 pending input、通知后失败退出的取舍。
- `openspec/designs/spec-to-design-map.md`：修改，新增 workflow-interaction-nodes User Check 和 workflow-execution-engine Timeout 到 architecture/module/adr 的导航。

验证入口：
- `packages/agent-workflow/tests/workflow-interaction-nodes.test.ts`：四种 kind 创建/resume/超时/HUMAN_HANDOFF 通知退出测试。
- `packages/agent-workflow/tests/workflow-execution-engine.test.ts`：超时 exception 路由测试。
- contract test：pending input timeout 上限 48h 边界。
- contract test：inputFormat 全链路透传。

## 不在本次范围（Deferred Non-Goals）

以下两项从本 change 拆出，单开后续 change 实现：

1. **填空题格式约束 inputFormat**：PendingInputQuestion/PendingInputQuestionRecord 新增 inputFormat 字段、workflow handler 透传、runtime assertValidPendingInputAnswerEntry 可选校验、web channel 投影。涉及 frozen core contract 变更，需 contract refinement 确认，拆到独立 change。
2. **pending input 等待超时上限 24h 放宽至 48h**：pendingInputMaxTimeoutMs 常量调整及对应 negative test。runtime 实现内部常量变更，拆到独立 change。

本 change 实际实施范围：Gap1 超时语义（node.timeout 复用、超时即失败走 exception）和 Gap3 场景支持（四种 kind 分流、CONFIRMATION/AUTHORIZATION 自动构造二元 options、HUMAN_HANDOFF 通知后失败退出）。
