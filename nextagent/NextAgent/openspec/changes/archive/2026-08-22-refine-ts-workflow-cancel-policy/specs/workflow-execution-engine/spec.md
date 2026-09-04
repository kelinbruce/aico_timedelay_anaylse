# MODIFIED Requirements

### Requirement: Interrupt

engine MUST 通过 AbortSignal 响应中断。当 AbortSignal 被触发时，engine MUST 停止继续启动正向节点，并返回 INTERRUPTED。

例外：若 recipe 配置了 runtime.controlPolicy.cancel，engine 在 abort 后 MAY 启动 cancel 回退节点（补偿动作），回退节点使用独立子信号执行，不继承已 abort 的父 signal。回退完成后仍返回 INTERRUPTED。未配置 controlPolicy.cancel 时，engine MUST NOT 在 abort 后启动任何节点。

#### Scenario: Abort Without Cancel Policy

- **WHEN** AbortSignal 被触发且 recipe 未配置 controlPolicy.cancel
- **THEN** engine MUST 停止启动新节点
- **AND** MUST 返回 INTERRUPTED

#### Scenario: Abort With Cancel Policy Allows Rollback Nodes

- **WHEN** AbortSignal 被触发且 recipe 配置了 controlPolicy.cancel
- **THEN** engine MAY 启动 cancel 回退节点（使用独立子信号）
- **AND** 回退完成后 MUST 返回 INTERRUPTED

## ADDED Requirements

### Requirement: External Cancel Rollback Execution

外部 cancel（runtime controller.abort）触发后，workflow execution engine MUST 检索 recipe.runtime.controlPolicy.cancel，决定取消后的回退行为。

触发机制：runtime cancel 接口调用 controller.abort()，信号传递到 workflow engine 的 signal。engine 在检测到 signal.aborted 时（节点间循环顶部、节点执行后、节点内 abort 捕获）MUST 调用 cancel policy 处理。同步执行，回退在 agent.execute() 内部完成。runtime cancel() 对 executing run 不提前提交终态，等 agent.execute() 返回后用 cancel 幂等键提交 CANCELED 并保留回退 content（D10）。

输入与前置条件：
- recipe 已通过 schema 校验，controlPolicy.cancel 配置在 recipe.runtime 下。
- 当前 run 的 agent scope / owner scope 来自 runtime accepted RequestRun，MUST 传入回退路径。
- 回退节点可读当前 variables（正向节点已产出的变量），但回退路径不写 checkpoint。

已配置 controlPolicy.cancel 时：
- engine MUST 取 cancel 的第一个 entry 作为回退目标节点（首版 condition 不求值，当前无入口传入 variables）。MUST 允许多 entry 存在但只取第一个生效。
- engine MUST 创建独立子 AbortController，用其 signal 执行回退路径，MUST NOT 使用已 abort 的父 signal。若配置了 cancelTimeout 则子信号 MUST 设该超时作为兜底；未配置则跟随回退节点自身 timeout/retry 默认逻辑。
- 回退路径 MUST 通过 executePath 从目标节点开始执行，沿 next 边自然执行到 END 或 TERMINAL。
- 回退路径 MUST NOT 写 checkpoint（补偿非正向流程）。
- 回退路径 MUST 继承原 run 的 agent scope / owner scope，MUST NOT 使用不可信来源覆盖 scope。
- 回退路径完成后 MUST 返回 INTERRUPTED（对应 runtime CANCELED）。
- 回退路径用 try/catch 包住 executePath，catch 里 MUST 记录一行 structured log（reasonCode WORKFLOW_ROLLBACK_FAILED），然后返回 INTERRUPTED。MUST NOT 额外发 NODE_FAILED event（回退节点自身失败时 executeNode 已 emit）。MUST NOT 改 runtime 终态映射。WORKFLOW_ROLLBACK_FAILED reasonCode 仅存在于 structured log，MUST NOT 作为独立 timeline event、SafeError 字段、Web API response 或 audit 字段。回退节点自身的 NODE_FAILED event 可进 timeline（节点执行事实），但 reasonCode 分类不额外传播。

回退路径中的节点失败行为：回退路径中节点执行失败（非 abort）时 MUST NOT 走 exception 分支或 retry，MUST 直接中断回退路径，记录 WORKFLOW_ROLLBACK_FAILED 后返回 INTERRUPTED。回退是补偿动作，失败行为必须可预测。

输出与副作用：
- 回退节点正常执行时 MUST 发出 NODE_COMPLETED 等 WorkflowExecutionEvent（与正向节点一致），timeline 可见，用户可观察回退执行进度。
- 回退节点产出的 outputVariables MUST 合并到 WorkflowExecutionResult.outputVariables，消费方为 default-agent 的 projectWorkflowExecutionResult（投影为 terminalContent）和 runtime terminal commit。
- 回退路径不写 checkpoint，不产生持久化 resume state。
- 回退失败时 structured log 记录 WORKFLOW_ROLLBACK_FAILED，可通过 observability 追溯，不含敏感字段。
- cancel 路径 MUST 在 info 级别输出 runtime diagnostic log，记录 cancel 信号检测、无 rollback 节点、rollback 执行开始与完成四个里程碑事件。事件名称分别为 `workflow.cancel_detected`（reasonCode `WORKFLOW_CANCEL_SIGNAL_RECEIVED`）、`workflow.cancel_no_rollback`（reasonCode `WORKFLOW_CANCEL_NO_ROLLBACK_NODE`）、`workflow.cancel_rollback_started`（reasonCode `WORKFLOW_CANCEL_ROLLBACK_ENTERING`，含 `rollbackNodeId` 和可选 `cancelTimeoutS`）、`workflow.cancel_rollback_completed`（reasonCode `WORKFLOW_CANCEL_ROLLBACK_SUCCEEDED`，含 `rollbackNodeId` 和 `rollbackPathState`）。这些 diagnostic log 仅用于本地运行诊断，MUST NOT 进入 timeline event、audit、metric、trace 或 Web API response。字段仅包含 `executionId`、`recipeName`、`rollbackNodeId`、`cancelTimeoutS`、`rollbackPathState`、`reasonCode` 等低基数诊断字段，MUST NOT 包含 prompt、模型输出、credential、路径或高基数字段。

流程接入：
- 上游：runtime cancel 接口（POST /cancel）→ controller.abort() → agent.execute(run, context, signal) → default-agent executeRecipeRoute → workflowExecutionService.execute(request, signal, observer, runtime) → engine 检测 signal.aborted。
- 下游：engine 返回 INTERRUPTED → default-agent projectWorkflowExecutionResult 投影 terminalContent → agent.execute 返回 → runtime 检测 canceling → terminal commit CANCELED → 发布 REQUEST_CANCELED timeline event。
- runtime 不感知 workflow cancel 策略，只做 abort 和 terminal commit。engine 在 agent.execute 内部完成回退，runtime 等待 agent 返回。

失败与降级：
- 回退路径节点失败：记录 WORKFLOW_ROLLBACK_FAILED log，返回 INTERRUPTED。MUST NOT 递归回滚。MUST NOT 走 exception 分支或 retry。
- 回退路径超时（配置了 cancelTimeout）：abort 子信号，executePath 自然返回 INTERRUPTED。MUST NOT 静默吞错。
- 回退节点自身 retry 耗尽：视为回退路径节点失败，记录 WORKFLOW_ROLLBACK_FAILED，返回 INTERRUPTED。MUST NOT 走 exception 分支。
- 无 controlPolicy.cancel：直接返回 INTERRUPTED（兼容当前行为），MUST NOT 执行任何回退节点。
- 回退期间不允许静默截断、静默丢弃或静默吞错。

#### Scenario: External Cancel Without Policy

- **WHEN** 外部 cancel 触发 signal.aborted 且 recipe 未配置 controlPolicy.cancel
- **THEN** engine MUST 直接返回 INTERRUPTED
- **AND** MUST NOT 执行任何回退节点

#### Scenario: External Cancel With Rollback

- **WHEN** 外部 cancel 触发 signal.aborted 且 recipe 配置 controlPolicy.cancel 含 rollback_cleanup
- **THEN** engine MUST 从 rollback_cleanup 开始执行回退路径
- **AND** 回退路径 MUST 使用独立子信号
- **AND** 回退路径完成后 MUST 返回 INTERRUPTED

#### Scenario: Rollback Uses Independent Sub-Signal

- **WHEN** cancel 回退路径执行中
- **THEN** 回退节点 MUST 使用独立子 AbortController 的 signal
- **AND** MUST NOT 继承已 abort 的父 signal
- **AND** 若配置了 cancelTimeout 则子信号 MUST 设该超时；未配置则不设额外超时

#### Scenario: Rollback Timeout

- **WHEN** 配置了 cancelTimeout 且回退路径执行超过该值
- **THEN** engine MUST abort 子信号
- **AND** executePath 自然返回 INTERRUPTED
- **AND** MUST 返回 INTERRUPTED

#### Scenario: Rollback Node Failure

- **WHEN** cancel 回退路径中节点执行失败
- **THEN** engine MUST 记录诊断 reasonCode WORKFLOW_ROLLBACK_FAILED
- **AND** MUST 返回 INTERRUPTED
- **AND** MUST NOT 递归回滚
- **AND** MUST NOT 走 exception 分支或 retry

#### Scenario: Rollback Node Retry Exhausted

- **WHEN** cancel 回退路径中节点 retry 耗尽
- **THEN** engine MUST 视为回退路径节点失败
- **AND** MUST 记录 WORKFLOW_ROLLBACK_FAILED
- **AND** MUST 返回 INTERRUPTED
- **AND** MUST NOT 走 exception 分支

#### Scenario: Rollback Does Not Write Checkpoint

- **WHEN** cancel 回退路径执行节点
- **THEN** MUST NOT 写 checkpoint
- **AND** 回退是补偿动作，非正向流程

#### Scenario: Rollback Inherits Scope

- **WHEN** cancel 回退路径执行
- **THEN** 回退节点 MUST 继承原 run 的 agent scope / owner scope
- **AND** MUST NOT 使用不可信来源覆盖 scope

#### Scenario: Rollback Events Visible

- **WHEN** cancel 回退路径节点正常执行完成
- **THEN** engine MUST 发出 NODE_COMPLETED 等 WorkflowExecutionEvent
- **AND** timeline MUST 可见回退节点执行
- **AND** 回退节点 outputVariables MUST 合并到 WorkflowExecutionResult.outputVariables

#### Scenario: Condition Reserved Not Evaluated

- **WHEN** controlPolicy.cancel 含多个 entry 且 condition 非空
- **THEN** 首版 MUST 取第一个 entry 作为回退目标
- **AND** MUST NOT 求值 condition（当前无入口传入 variables）
- **AND** MUST 允许多 entry 存在但只取第一个生效

### Requirement: Node Failure Decoupled From ControlPolicy

节点失败（非 abort）MUST NOT 触发 controlPolicy。节点失败处置完全由 retry（节点级重试）和 exception 分支（节点级异常转移）承载。

- 节点抛出非 abort 错误且 retry 未耗尽时 MUST 重试。
- 节点抛出非 abort 错误且 retry 耗尽且有 exception 分支时 MUST 走 exception 分支转移。
- 节点抛出非 abort 错误且 retry 耗尽且无 exception 分支时 MUST 返回 terminalState FAILED，流程终止。
- 节点抛出 abort 错误时 MUST 走外部 cancel 回退路径（若配置）。

engine MUST NOT 保留 applyControlPolicy 方法或 skipControlPolicy 参数。engine MUST NOT 在 terminalState FAILED 时检索 controlPolicy。

#### Scenario: Node Failure Without Exception

- **WHEN** 节点抛出非 abort 错误且 retry 耗尽且无 exception 分支
- **THEN** engine MUST 返回 terminalState FAILED
- **AND** MUST NOT 检索 controlPolicy

#### Scenario: Node Failure With Exception

- **WHEN** 节点抛出非 abort 错误且 retry 耗尽且有 exception 分支
- **THEN** engine MUST 走 exception 分支转移
- **AND** MUST NOT 检索 controlPolicy

#### Scenario: Node Abort Triggers Cancel Policy

- **WHEN** 节点抛出 abort 错误（外部取消）
- **THEN** engine MUST 走外部 cancel 回退路径（若配置 controlPolicy.cancel）
- **AND** MUST NOT 返回 terminalState FAILED
### Requirement: Cancel Terminal Commit Timing For Executing Runs

runtime cancel() 对 executing run MUST NOT 提前提交终态。cancel() 对 executing run 只 abort + 存 cancel 幂等键到 executionState，不调 commitCanceledRun。executeQueuedWork 等 agent.execute() 返回后，检查 canceling 状态，用 finishRun 提取回退 content，调 commitTerminal 提交 CANCELED 并传入 cancel 幂等键。

排队中请求的 cancel 仍走 commitCanceledRun（无 executing run）。

幂等性：executionState 新增 cancelIdempotencyKey 和 cancelIdempotencySemantic 字段。重复 cancel 的幂等锚检查在 cancel() 入口命中。cancel 与自然完成的 race 由 CAS 版本保证。

内容保留：有回退 content 用回退 content，无内容 fallback 到 "Request canceled by user."。

#### Scenario: Cancel Executing Run Defers Terminal Commit

- **WHEN** cancel() 对 executing run 触发
- **THEN** cancel() MUST 只 abort + 存 cancel 幂等键
- **AND** MUST NOT 调 commitCanceledRun
- **AND** executeQueuedWork 等 agent.execute() 返回后 MUST 用 finishRun 提取 content
- **AND** MUST 调 commitTerminal 提交 CANCELED 并传入 cancel 幂等键

#### Scenario: Cancel Queued Run Keeps Immediate Commit

- **WHEN** cancel() 对排队中请求触发（无 executing run）
- **THEN** cancel() MUST 调 commitCanceledRun 立即提交
- **AND** 行为不变

#### Scenario: Cancel Preserves Rollback Content

- **WHEN** agent.execute() 返回且 canceling 为 true 且回退节点产出了 content
- **THEN** terminal commit 的 content MUST 使用回退 content
- **AND** MUST NOT 使用固定文案 "Request canceled by user."

#### Scenario: Cancel Without Rollback Content Falls Back

- **WHEN** agent.execute() 返回且 canceling 为 true 且无回退 content
- **THEN** terminal commit 的 content MUST fallback 到 "Request canceled by user."
### Requirement: Cancel Terminal Content Not Suppressed

runtime 的 shouldSuppress 机制在 cancel 期间（canceling/canceled/terminalized 为 true）MUST 豁免 LLM_CONTENT_DELTA 且 inlinePayload.final === true 的事件。该事件携带 workflow rollback 投影的完整终态内容，MUST 到达 output.content 赋值和 stream 推送路径。

中间流式内容（LLM_CONTENT_DELTA 且 final 不为 true）、NODE_STARTED、NODE_COMPLETED、TOOL_STRUCTURED_DELTA、CAPABILITY_RESULT_DELTA 等非终态事件在 cancel 期间 MUST 继续被 suppress。

豁免的 final:true 事件 MUST 正常走 persistence policy 解析（通常为 LIVE_ONLY）、output.content 赋值和 onLiveTimelineEvent 推送。MUST NOT 持久化到 timeline store（与正常路径一致）。

terminal message size limit MUST 对豁免的 final 内容同样生效。

#### Scenario: Final Terminal Content Exempted From Suppression

- **WHEN** shouldSuppress 返回 true 且事件为 LLM_CONTENT_DELTA 且 inlinePayload.final === true
- **THEN** emitEvent MUST NOT 提前返回
- **AND** MUST 执行 output.content 赋值
- **AND** MUST 推送给 onLiveTimelineEvent（LIVE_ONLY）
- **AND** finishRun().finalContent MUST 包含回退内容

#### Scenario: Intermediate Streaming Content Still Suppressed

- **WHEN** shouldSuppress 返回 true 且事件为 LLM_CONTENT_DELTA 且 inlinePayload.final 不为 true
- **THEN** emitEvent MUST 提前返回
- **AND** MUST NOT 执行 output.content 赋值
- **AND** MUST NOT 推送给 onLiveTimelineEvent

#### Scenario: Non-Content Events Still Suppressed

- **WHEN** shouldSuppress 返回 true 且事件类型不是 LLM_CONTENT_DELTA
- **THEN** emitEvent MUST 提前返回
- **AND** MUST NOT 推送给 onLiveTimelineEvent 或 onTimelineAppend

#### Scenario: Normal Path Unchanged

- **WHEN** shouldSuppress 返回 false 或未配置
- **THEN** 所有事件 MUST 正常处理
- **AND** 行为与豁免前一致
