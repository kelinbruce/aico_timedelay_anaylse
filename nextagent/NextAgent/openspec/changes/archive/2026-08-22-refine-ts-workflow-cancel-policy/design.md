# 背景和现状（Context）

NextAgent workflow 的 `runtime.controlPolicy` 当前定义在 `agent-contracts/core`，含 `resume`/`modify`/`cancel`/`restart` 四入口，每入口 `{ strategy, rollbackNode? }`，strategy 取六值枚举。该设计由 `refine-ts-workflow-recipe-v2-contracts` 引入契约，由 `add-ts-workflow-persistence-recovery` 实现引擎执行路径。

实现现状（已查证）：
- 引擎 `applyControlPolicy` 唯一调用点是 `terminalState === "FAILED"`（节点失败，retry 耗尽），即规范把 "cancel" 绑定到"节点失败"。
- 外部 `controller.abort()` 路径（节点间循环顶部、节点执行后、节点内 abort 捕获）直接返回 `INTERRUPTED`，完全绕过 controlPolicy。
- `resume`/`modify`/`restart` 三个入口无场景、无实现。
- controlPolicy 未归档进 baseline spec，全仓无 recipe 在用。
- runtime cancel 接口 `POST /cancel` → `controller.abort()`，终态映射 `canceling → CANCELED`。
- baseline `workflow-execution-engine` spec 的 Interrupt requirement 规定 abort 后 engine MUST 停止启动新节点。

电信运维诉求：取消后需做写操作回退（配置回滚、资源释放、状态复位），当前无法表达。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 重构 controlPolicy，让 `cancel` 表达"外部取消后的回退策略"，而非"节点失败处置"。
- `cancel` 与 `next`/`exception` 同形同策，复用 `WorkflowBranchDef`，支持 condition 预留。
- 外部 cancel（abort signal）触发后，引擎检索 cancel 策略，有回退目标则执行回退节点子路径再终止。
- 节点失败从 controlPolicy 解耦，回归 `retry` + `exception` 两层。
- runtime 不感知 workflow cancel 策略，只做 abort；cancel 对 executing run 的终态提交时序改为等 agent.execute() 返回后提交（D10）。

**非目标：**
- 不改 runtime cancel 终态映射（CANCELED 保持），但修改 cancel 对 executing run 的终态提交时序（D10）。
- 不实现 condition 动态求值。
- 不实现 resume/modify/restart。
- 不新增 Web API / runtime command。
- 不引入 durable cancel recovery。

## 设计决策（Decisions）

### D1 废弃旧 controlPolicy，cancel 语义从"节点失败"改为"外部取消"

旧设计把 cancel 绑定到节点失败，与命名冲突。废弃后 cancel 只由 runtime cancel 接口（`controller.abort()`）触发。节点失败改由 `retry`（节点级重试）和 `exception` 分支（节点级异常转移，与 `next` 同级）承载，无 exception 则直接 `terminalState: FAILED` 终止。三层各司其职：`retry` → `exception` → `cancel`（外部取消）。controlPolicy 尚未归档、无 recipe 在用，废弃重构成本可控。

### D2 cancel 与 next/exception 同形同策，复用 WorkflowBranchDef

`cancel` 直接是 `Record<WorkflowSafeId, WorkflowBranchDef>`，与 `WorkflowNodeDef.next`、`WorkflowNodeDef.exception` 完全对称。`WorkflowBranchDef` 含可选 `condition`（minLength 0，空串合法）。理由：同形同策，跳转到某节点加可选 condition，复用 `resolveWorkflowBranchTransition` 的 condition 求值基建，不引入新 schema 类型；少一层嵌套，cancel 下跳转节点本质是回退/补偿节点，语义已由 cancel 上下文界定，不需要 `rollbackNode` 包装层；预留扩展零成本，未来支持 condition 选择不同回退分支时 schema 不变。

### D3 cancelTimeout 可选兜底超时

`controlPolicy.cancelTimeout` 为 Optional。未配置时回退路径不设额外超时，跟随回退节点自身的 timeout/retry 默认逻辑。已配置时作为回退路径整体兜底超时（秒，最小 1）。理由：回退节点（TOOL/GATEWAY）本身有 timeout 和 retry 机制，未配置时不需双重超时；已配置时提供整体兜底防多节点回退链无限阻塞。

### D4 回退用独立子信号，不继承已 abort 的父 signal

外部 cancel 已 abort 父 `signal`，但回退节点（TOOL/GATEWAY 调用）需要未 abort 的 signal 驱动异步操作。回退路径创建独立 `AbortController`，用其 signal 执行回退 `executePath`。若配置了 cancelTimeout 则设该超时作为兜底；未配置则跟随回退节点自身 timeout/retry 默认逻辑。父 abort 不影响回退；回退超时则 abort 子信号。回退路径通过 `executePath` 执行，从 cancel 目标节点开始，沿 `next` 边自然执行到 END/TERMINAL。回退路径不写 checkpoint（补偿非正向流程），继承原 run 的 agent scope / owner scope。

### D5 首版取第一个 entry，condition 暂不求值

`condition` 为预留字段，首版不参与回退分支选择。首版取 `cancel` 的第一个 entry 作为回退目标（condition 忽略）。原因：当前 condition 没有入口传入 variables，无法求值。首版允许多 entry 存在但只取第一个生效，不拒绝多 entry。未来 condition 支持入口传入后，多 entry 将按 condition 求值选择回退分支，复用 `resolveWorkflowBranchTransition`，schema 不变。

### D6 回退失败仅记日志，不改终态

回退路径用 try/catch 包住 executePath。catch 里记录一行 structured log（reasonCode `WORKFLOW_ROLLBACK_FAILED`），然后返回 `INTERRUPTED`（对应 runtime CANCELED）。不需额外发 NODE_FAILED event：回退节点自身失败时 executeNode 已 emit NODE_FAILED event。回退超时时子信号 abort，executePath 自然返回 INTERRUPTED。不改 runtime cancel 终态映射。理由：runtime cancel 终态逻辑暂不动（`canceling` 走 `CANCELED`），回退失败无法在终态层表达 FAILED。未来如需回退失败转 FAILED，另起 change 改 runtime 终态映射。

### D7 节点失败路径回归 exception + FAILED

废弃 controlPolicy 节点失败分支后，`executeNode` 失败处置：abort 错误（外部取消）走新 cancel 回退路径（D4）；非 abort 错误且有 exception 分支走 `resolveErrorTransition` 分支转移（现有逻辑不变）；非 abort 错误且无 exception 则 `terminalState: FAILED` 流程终止（现有逻辑不变）。移除 `applyControlPolicy`/`skipControlPolicy`，`executePath` 中"节点失败触发 controlPolicy"分支删除。

### D8 MODIFIED baseline Interrupt requirement，允许 cancel 回退启动节点

baseline `workflow-execution-engine` spec 的 Interrupt requirement 规定 abort 后 engine MUST 停止启动新节点。本 change MODIFIED 该 requirement：abort 后 engine MUST 停止启动正向节点，但若配置了 controlPolicy.cancel 则 MAY 启动 cancel 回退节点（补偿动作）。回退节点使用独立子信号，不继承已 abort 的父 signal。未配置 controlPolicy.cancel 时保持原行为（停止启动任何节点，返回 INTERRUPTED）。

这是显式架构变更：cancel 回退是 abort 后的受控补偿，不是正向执行延续。回退节点的启动由 recipe 静态声明，不接受动态输入。与 ts-backend-architecture 的异步边界约束一致：回退路径的节点仍遵守 async contract 和 cancellation context（独立子信号即为回退路径的 cancellation context）。

与 request-cancel 契约一致：回退是 agent.execute() 内部的同步行为，runtime 等待 agent 返回后 terminal commit，不违反"MUST NOT require downstream physically stop before attempting terminal commit"（runtime 不要求 downstream 物理停止，而是等待 agent 正常返回）。回退路径的节点不发布 terminal lifecycle event（遵守 ts-core-contracts "Agent MUST NOT publish REQUEST_CANCELED"）。

### D9 回退路径节点失败不经过 exception/retry

回退路径中的节点执行失败（非 abort）时 MUST NOT 走 exception 分支或 retry。MUST 直接中断回退路径，记录 WORKFLOW_ROLLBACK_FAILED 后返回 INTERRUPTED。回退是补偿动作，失败行为必须可预测——如果回退节点失败后再走 exception 分支或 retry，回退行为会变得不可预测且可能无限延长。回退节点自身 retry 耗尽也视为回退路径节点失败，同样不经过 exception 分支。

实现上，回退路径的 executePath 需要一个标记（如 rollbackMode）让 executeNode 在失败时跳过 exception 分支和 retry，直接抛错由外层 try/catch 捕获。

## 流程接入（Process Integration）

上游链路：runtime cancel 接口（POST /cancel）→ RuntimeCommandPort.cancel → controller.abort() → agent.execute(run, context, signal) → default-agent executeRecipeRoute → workflowExecutionService.execute(request, signal, observer, runtime) → engine 检测 signal.aborted。

下游链路：engine 返回 WorkflowExecutionResult(status=INTERRUPTED) → default-agent projectWorkflowExecutionResult 投影 terminalContent → agent.execute 返回 → runtime 检测 canceling/canceled → terminal commit CANCELED → 发布 REQUEST_CANCELED timeline event → stream 可见。

runtime 不感知 workflow cancel 策略，只做 abort 和 terminal commit。cancel() 对 executing run 不提前提交终态（D10），等 agent.execute() 返回后用 cancel 幂等键提交 CANCELED 并保留回退 content。engine 在 agent.execute() 内部完成回退，runtime 等待 agent 返回。回退期间 runtime 不发布 terminal event。

## 状态/产物契约（State and Artifact Contract）

回退节点正常执行时发出 NODE_COMPLETED 等 WorkflowExecutionEvent，与正向节点一致，timeline 可见，用户可观察回退执行进度。回退节点产出的 outputVariables 合并到 WorkflowExecutionResult.outputVariables，消费方为 default-agent 的 projectWorkflowExecutionResult（投影为 terminalContent）和 runtime terminal commit。回退路径不写 checkpoint，不产生持久化 resume state（补偿非正向流程）。回退失败时 structured log 记录 WORKFLOW_ROLLBACK_FAILED，可通过 observability 追溯，不含敏感字段（遵守 redaction 约束）。回退节点 side effect 真实发生，executionId/nodeId 可追溯。
cancel 路径在 info 级别输出四个 runtime diagnostic log 里程碑事件：`workflow.cancel_detected`（`WORKFLOW_CANCEL_SIGNAL_RECEIVED`）、`workflow.cancel_no_rollback`（`WORKFLOW_CANCEL_NO_ROLLBACK_NODE`）、`workflow.cancel_rollback_started`（`WORKFLOW_CANCEL_ROLLBACK_ENTERING`，含 `rollbackNodeId` 和可选 `cancelTimeoutS`）、`workflow.cancel_rollback_completed`（`WORKFLOW_CANCEL_ROLLBACK_SUCCEEDED`，含 `rollbackNodeId` 和 `rollbackPathState`）。这些事件仅用于本地运行诊断，不进入 timeline、audit、metric、trace 或 Web API response；字段仅含低基数诊断值，遵守 redaction 约束。

## 目标架构

流程：runtime `POST /cancel` 调用 `controller.abort()`；引擎检测 `signal.aborted`；检索 `controlPolicy.cancel` 是否配置；未配置则返回 `INTERRUPTED` 对应 CANCELED；已配置则解析 cancel 目标节点（首个 entry），创建独立子信号（若配置 cancelTimeout 则设兜底超时，否则跟随节点默认），通过 `executePath` 从目标节点执行（不写 checkpoint，rollbackMode 跳过 exception/retry）；回退路径完成则返回 `INTERRUPTED` 对应 CANCELED；回退路径失败或超时则记录诊断 `WORKFLOW_ROLLBACK_FAILED` 后返回 `INTERRUPTED` 对应 CANCELED。cancel 信号检测、无 rollback 节点、rollback 开始与完成四个里程碑以 info 级 diagnostic log（`workflow.cancel_detected` / `workflow.cancel_no_rollback` / `workflow.cancel_rollback_started` / `workflow.cancel_rollback_completed`）记录，仅用于本地运行诊断。

## 契约形态

`ControlPolicy` 含可选 `cancel`（`Record<WorkflowSafeId, WorkflowBranchDef>`）与可选 `cancelTimeout`（整数，最小 1，未配置时不设额外超时）。`cancel` 与 `WorkflowNodeDef.next`、`WorkflowNodeDef.exception` 完全对称，复用 `WorkflowBranchDef`。`RuntimeConfig.controlPolicy` 类型指向新 `ControlPolicy`。废弃 `ControlPolicyStrategySchema`、`ControlPolicyEntrySchema` 及 `resume`/`modify`/`restart` 入口。

## DSL 形态

YAML recipe 的 `runtime.control_policy.cancel.rollback_cleanup.condition` 为空串（预留）；`runtime.control_policy.cancel_timeout` 为 30。flowGraph 含 start、diagnose、rollback_cleanup、end 节点。rollback_cleanup 是 cancel 触发后跳转的回退节点，沿其 `next` 执行到 end。loader 将 snake_case（control_policy、cancel_timeout）归一化为 camelCase（controlPolicy、cancelTimeout），cancel 解析为 Record of nodeId to BranchDef。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | cancel 策略只来自 recipe 静态声明；回退节点继承 agent/owner scope；condition 不求值（首版）；回退诊断不含敏感字段 | contract tests；scope 继承测试；redaction 测试 |
| 可靠性/恢复 | 回退有可选超时（cancelTimeout），防无限阻塞；回退失败不崩流程，记诊断后 INTERRUPTED；runtime 终态 CANCELED 不变 | cancel 回退测试；超时测试；回退失败测试 |
| 可维护性 | cancel 与 next/exception 同形同策，复用 WorkflowBranchDef/resolveWorkflowBranchTransition；节点失败回归 retry+exception，职责清晰 | lint:architecture；package boundary tests |
| 可测试性 | cancel 回退、默认终止、超时、condition 预留、scope 继承、回退节点失败不经过 exception 均有 deterministic 测试 | unit/contract/integration tests |
| 审计/可追溯性 | 回退节点 side effect 真实发生，executionId/nodeId 可追溯；回退 NODE_COMPLETED event timeline 可见；回退失败诊断 reasonCode 可观测；不记录 raw payload | observability contract tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 旧 ControlPolicy schema 废弃 | 1.1, 1.2 | contract tests；openspec validate |
| cancel 复用 WorkflowBranchDef | 1.1 | contract tests |
| cancelTimeout 字段（可选，无默认） | 1.1 | contract tests |
| 节点失败不再触发 controlPolicy | 2.1, 2.2 | engine unit tests |
| baseline Interrupt MODIFIED 允许回退节点 | 2.3 | contract tests；architecture tests |
| 外部 abort 加有 cancel 则执行回退 | 3.1, 3.2 | engine integration tests |
| 外部 abort 加无 cancel 则 INTERRUPTED | 3.3 | engine tests |
| 回退用独立子信号加 cancelTimeout | 3.2, 3.4 | 超时测试 |
| 回退失败仅诊断日志 | 3.5 | 诊断测试 |
| 回退节点失败不经过 exception/retry | 3.9, 3.10 | engine tests |
| 首版取第一个 entry | 3.6 | contract tests |
| 回退不写 checkpoint | 3.7 | checkpoint 测试 |
| 回退继承 scope | 3.8 | scope 测试 |
| 回退 NODE_COMPLETED event 可见 | 3.11 | engine tests |
| loader normalize | 4.1 | loader tests |
| OpenSpec 全量有效 | 5.1 | openspec validate --all --strict |

## 风险与取舍（Risks / Trade-offs）

- 回退失败不改终态（仍 CANCELED），用户无法从终态区分"取消成功"与"回退失败"。缓解：诊断日志加回退节点 NODE_FAILED event 可观测；未来可另起 change 改 runtime 终态。
- 独立子信号让回退在 cancel 后继续执行异步操作，可能与用户预期"立即取消"冲突。缓解：cancelTimeout 可选兜底（若配置则有界），回退是用户显式配置的补偿，语义合理。
- condition 预留但首版不求值（无入口传入 variables），多 entry 只取第一个。缓解：文档明确首版行为；未来 condition 支持入口传入后多 entry 生效。
- 废弃旧 controlPolicy 破坏既有 active change（refine-v2/persistence-recovery/execution-engine-v2）的规范。缓解：本 change 同步标注三个 change 的 ControlPolicy requirement 废弃。
- MODIFIED baseline Interrupt requirement 改变 abort 后行为。缓解：仅允许 cancel 回退节点启动，未配置 controlPolicy.cancel 时行为不变。

## 迁移计划（Migration Plan）

无数据迁移。controlPolicy 未归档、无 recipe 在用。步骤：废弃旧 schema 和引擎路径；新 schema 和 cancel 回退路径上线；节点失败回归 retry 加 exception（行为不变，无 exception 时直接 FAILED）；runtime cancel 终态不变（CANCELED），但提交时序改为等 agent.execute() 返回后提交（D10）。回滚策略：恢复旧 controlPolicy schema 和引擎路径；cancel 回退路径移除后，外部 cancel 回到直接 INTERRUPTED 行为；恢复 baseline Interrupt requirement 原文。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/workflow-contracts/spec.md`：新增重构后的 ControlPolicy 行为契约。
- `openspec/specs/workflow-execution-engine/spec.md`：MODIFIED Interrupt requirement（允许 cancel 回退节点）；新增 External Cancel Rollback Execution 和 Node Failure Decoupled 行为契约。
- 同步改写三个 active change 的 ControlPolicy requirement（标记被本 change 废弃）：refine-ts-workflow-recipe-v2-contracts、refine-ts-workflow-execution-engine-v2、add-ts-workflow-persistence-recovery。
- openspec/designs/architecture/workflow-contracts.md：补充 cancel 与 next/exception 同形同策的契约边界。
- openspec/designs/architecture/workflow-execution-and-routing.md：更新 Deferred 范围，把 cancel 回退从 deferred 移出（原列 rollback/degrade/saga 为首版不实现，本 change 引入 cancel 回退补偿）。
- openspec/designs/modules/agent-workflow.md：更新首版支持范围，把 cancel 回退从不支持移出。
### D10 cancel 对 executing run 的终态提交时序改为等 agent.execute() 返回后提交

当前 cancel() 对 executing run 立即调 commitCanceledRun 提交 CANCELED 终态，不等 agent.execute() 返回。cancel policy 引入回退补偿后，agent.execute() 的返回值（回退内容）有价值，立即提交终态的假设不再成立——回退内容到不了 terminal commit。

改动：cancel() 对 executing run 只 abort + 存 cancel 幂等键到 executionState，不调 commitCanceledRun。executeQueuedWork 等 agent.execute() 返回后，检查 canceling 状态，用 finishRun（不是 discardRun）提取回退 content，调 commitTerminal 提交 CANCELED 并传入 cancel 幂等键。排队中请求的 cancel 仍走 commitCanceledRun（无 executing run，agent.execute 没在跑）。

幂等性：executionState 新增 cancelIdempotencyKey 和 cancelIdempotencySemantic 字段。cancel() 存入这两个字段，executeQueuedWork 提交终态时使用它们作为 TerminalCommitOptions。重复 cancel 的幂等锚检查在 cancel() 入口命中（loadRunByIdempotencyAnchor），直接返回 accepted。cancel 与自然完成的 race 由 CAS 版本保证只有一个 terminal commit 成功。

内容保留：正常返回路径用 finishRun 提取 output.finalContent，有内容用回退内容，无内容 fallback 到 "Request canceled by user."。catch 路径同样用 finishRun 提取已有内容，fallback 到 safeErrorContent。commitExecutionTerminal 签名扩展为接受可选 TerminalCommitOptions，cancel 场景传入 cancel 幂等键。
- cancel 对 executing run 终态提交时序改为等 agent.execute() 返回后提交（D10），cancel 后 terminal event 出现延迟（最多 cancelTimeout 秒）。缓解：RequestControlAccepted 立即返回（spec 明确 accepted != terminal visible），cancelTimeout 有界；排队中请求的 cancel 仍立即提交。
### D11 cancel 期间 suppress 机制豁免 final 终态内容

D10 改了终态提交时序，等 agent.execute() 返回后用 finishRun 提取 content。但 runtime 的 shouldSuppress 机制在 cancel 期间（canceling===true）无差别压制所有非终态 timeline 事件，包括 default-agent 投影 workflow rollback 结果后 emit 的 LLM_CONTENT_DELTA{final:true} 事件。该事件携带完整的回退投影内容，被 suppress 后 output.content 始终为空，finishRun().finalContent 为空字符串，cancel 路径 fallback 到固定文案，回退内容丢失。

根因：shouldSuppress 用一个布尔值同时压制两类语义不同的事件——中间流式内容（partial model output，应压制）和终态内容（LLM_CONTENT_DELTA{final:true}，不应压制）。emitEvent 内部有 event 对象，但在 suppress 检查前就提前返回了。

改动：emitEvent 中 suppress 检查增加 fall-through 条件，对 LLM_CONTENT_DELTA 且 inlinePayload.final === true 的事件豁免，继续执行到 output.content 赋值和 timeline 推送。其他事件类型（NODE_STARTED、NODE_COMPLETED、TOOL_STRUCTURED_DELTA、中间 LLM_CONTENT_DELTA 等）仍被 suppress。

影响范围：仅 agent-runtime 的 agent-run-state-port.ts，一个 if 分支条件变更。default-agent 已有两处 emit final:true（正常终态 line 493 和 workflow 投影终态 line 1147），正常路径 canceling===false 不触发 suppress，不受影响。appendMessage 的 suppress 独立检查，不受影响。

安全性：final:true 在整个代码库中只出现在两个 emit 点，语义一致（终态完整内容）。该 flag 已被 persistence policy 信任用于区分内容类型（isValidLiveContentPayload 检查 payload 无 messageId/completed 且 content 为 string）。豁免后 final:true 事件走 LIVE_ONLY 路径推送给在线 stream 订阅者，output.content 被赋值供 finishRun 提取，不持久化到 timeline store（与正常路径行为一致）。
