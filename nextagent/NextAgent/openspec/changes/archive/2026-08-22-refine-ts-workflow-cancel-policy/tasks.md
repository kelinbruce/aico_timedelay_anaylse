# Tasks

## 1. 契约重构（agent-contracts/core）

- [x] 1.1 废弃旧 ControlPolicy schema：移除 ControlPolicyStrategySchema、ControlPolicyEntrySchema；移除 resume/modify/restart 入口和 strategy 枚举。重构 ControlPolicySchema 为只含 cancel（Record of WorkflowSafeId to WorkflowBranchDef）与 cancelTimeout（Optional Integer，最小 1）。 -> 验证: contract tests 断言新 schema 形态、additionalProperties false、旧字段被拒
- [x] 1.2 确认 RuntimeConfigSchema.controlPolicy 类型指向新 ControlPolicy；移除 ControlPolicyStrategy/ControlPolicyEntry 类型导出。 -> 验证: build 通过，无残留引用

## 2. 引擎改造（agent-workflow/engine）

- [x] 2.1 移除 applyControlPolicy 方法、skipControlPolicy 参数、executePath 中"节点失败触发 controlPolicy"分支（259-306 行）。节点失败回归 retry + exception + FAILED。 -> 验证: engine unit test 断言节点失败不再检索 controlPolicy
- [x] 2.2 确认节点失败无 exception 时直接 terminalState FAILED（现有逻辑不变）。 -> 验证: engine test 复现节点失败 → FAILED，无 controlPolicy 介入
- [x] 2.3 新增 applyCancelPolicy 方法：检测 signal.aborted 时检索 controlPolicy.cancel；无 cancel 则返回 INTERRUPTED；有 cancel 则解析首个 entry 为回退目标。 -> 验证: engine test 断言 abort + 无 cancel -> INTERRUPTED
- [x] 2.3a MODIFIED baseline Interrupt requirement：executePath 在 abort 后不再无条件停止启动节点，改为允许 cancel 回退节点启动（独立子信号）。未配置 cancel 时行为不变。 -> 验证: contract test 断言 MODIFIED 后的 Interrupt 行为；architecture test 确认不破坏 ts-backend-architecture 异步边界
- [x] 2.4 cancel 回退执行：创建独立子 AbortController（若配置 cancelTimeout 则设该超时，未配置则不设额外超时），用子 signal 调 executePath 从目标节点执行到 END/TERMINAL。回退路径不写 checkpoint。 -> 验证: engine test 断言回退节点被执行、用独立信号、不写 checkpoint
- [x] 2.5 回退完成返回 INTERRUPTED；回退失败/超时用 try/catch 记录一行 structured log（reasonCode WORKFLOW_ROLLBACK_FAILED）后返回 INTERRUPTED。 -> 验证: engine test 断言回退失败 -> 诊断 + INTERRUPTED
- [x] 2.5a 回退路径节点失败不经过 exception 分支或 retry（D9）：executePath 在 rollbackMode 下失败直接抛错由外层 try/catch 捕获，不走 resolveErrorTransition 或 retry。 -> 验证: engine test 断言回退节点失败时不走 exception/retry
- [x] 2.6 在所有 abort 检测点（节点间循环顶部、节点执行后、节点内 abort 捕获）接入 applyCancelPolicy。 -> 验证: engine test 覆盖三种 abort 触发点

## 3. 测试（agent-workflow/tests）

- [x] 3.1 废弃 workflow-control-policy.test.ts（节点失败场景），新建 workflow-cancel-policy.test.ts。同时改造 workflow-execution-engine.test.ts 中 3 个旧 controlPolicy 用例（1153-1250 行：controlPolicy:{ } / cancel:{strategy:"STOP"} / cancel:{strategy:"ROLLBACK_THEN_STOP",rollbackNode:"start"}），改为新 cancel Record 形态或移除。 -> 验证: 旧测试移除/改造，新测试存在
- [x] 3.2 正常：外部 abort + 配 cancel + rollback 节点 → 回退节点执行 → INTERRUPTED。 -> 验证: test pass
- [x] 3.3 默认：外部 abort + 未配 cancel → 直接 INTERRUPTED（兼容）。 -> 验证: test pass
- [x] 3.4 超时：配置 cancelTimeout 后回退执行超该值 → 子信号 abort → INTERRUPTED。 -> 验证: test pass
- [x] 3.5 回退失败：回退节点抛错 → WORKFLOW_ROLLBACK_FAILED + INTERRUPTED，不递归。 -> 验证: test pass
- [x] 3.6 condition 预留：多 entry + condition 非空 → 取第一个 entry，不求值（无入口传入 variables）。 -> 验证: test pass
- [x] 3.7 回退不写 checkpoint。 -> 验证: test pass
- [x] 3.8 回退继承 agent/owner scope。 -> 验证: test pass
- [x] 3.9 节点失败回归：节点失败 + 无 exception -> FAILED（确认废弃后节点失败行为没坏）。 -> 验证: test pass
- [x] 3.10 回退节点 retry 耗尽：回退路径中节点 retry 耗尽 -> 视为回退失败 -> WORKFLOW_ROLLBACK_FAILED + INTERRUPTED，不走 exception。 -> 验证: test pass
- [x] 3.11 回退 events 可见：回退节点正常执行 -> NODE_COMPLETED event 正常发出，timeline 可见，outputVariables 合并到 result。 -> 验证: test pass
- [x] 3.13 WORKFLOW_ROLLBACK_FAILED 诊断边界：回退失败时 reasonCode 仅存在于 structured log，不作为独立 timeline event、SafeError 字段或 Web API response。 -> 验证: test pass

- [x] 3.12 characterization test：废弃旧 controlPolicy 后，无 cancel 配置时 abort 行为与废弃前一致（INTERRUPTED）；节点失败路径（retry -> exception -> FAILED）未受影响；有 cancel 配置时 abort -> 回退 -> INTERRUPTED。确保旧行为没被破坏。 -> 验证: characterization test pass

## 4. Loader 改造（agent-workflow/workflow-recipe-loader）

- [x] 4.1 重写 controlPolicy normalize：cancel 解析为 Record of nodeId to BranchDef（含 condition）；cancel_timeout/cancelTimeout 归一化；废弃 strategy/rollbackNode/resume/modify/restart 解析。旧字段传入时 MUST 报错，不做兼容。新字段（cancel Record + cancelTimeout）MUST 做 runtime schema validation 校验类型。 -> 验证: loader test 断言 snake/camelCase 归一化、旧字段传入报错、新字段类型校验


## 4. Loader 改造（agent-workflow/workflow-recipe-loader）

- [x] 4.2 loader negative test：旧字段（strategy/rollbackNode/resume/modify/restart）传入时 MUST 报错；cancelTimeout 非正整数时 MUST 报错；cancel 非 Record 时 MUST 报错。 -> 验证: loader test 断言报错

## 6. Runtime cancel terminal commit timing (agent-runtime/lifecycle/submit.ts)

- [x] 6.1 ExecutingRunState add cancelIdempotencyKey and cancelIdempotencySemantic optional fields. -> verify: build pass
- [x] 6.2 cancel() for executing run: abort + store idempotency key to executionState, do NOT call commitCanceledRun; queued requests still call commitCanceledRun. -> verify: unit test asserting executing run cancel does not pre-commit
- [x] 6.3 executeQueuedWork normal return path: when canceling use finishRun (not discardRun) to extract content, call commitTerminal with CANCELED and cancel idempotency key. Content with rollback content if available, fallback to 'Request canceled by user.'. -> verify: unit test asserting rollback content enters terminal commit
- [x] 6.4 executeQueuedWork catch path: when canceling use finishRun + commitTerminal(CANCELED, cancel idempotency key). -> verify: unit test asserting catch path preserves content
- [x] 6.5 commitExecutionTerminal signature extended to accept optional TerminalCommitOptions, cancel scenario passes cancel idempotency key. -> verify: build pass
- [x] 6.6 characterization test: cancel executing run then agent.execute normal return -> CANCELED with rollback content; cancel executing run then agent.execute throws -> CANCELED with fallback content; non-cancel scenarios unchanged. -> verify: characterization test pass

## 5. OpenSpec 验证

- [x] 5.1 openspec validate --all --strict 通过。 -> 验证: 命令退出码 0
- [x] 5.2 同步改写三个 active change 的 ControlPolicy requirement（标记被本 change 废弃）：refine-ts-workflow-recipe-v2-contracts（spec ControlPolicy requirement）、refine-ts-workflow-execution-engine-v2（spec ControlPolicy Resolution requirement）、add-ts-workflow-persistence-recovery（spec ControlPolicy Rollback Execution requirement）。 -> 验证: openspec validate 通过
## 7. Cancel 终态内容 suppress 豁免（agent-runtime/lifecycle）

- [x] 7.1 emitEvent 中 suppress 检查增加 fall-through：对 LLM_CONTENT_DELTA 且 inlinePayload.final === true 豁免，其他事件类型继续 suppress。 -> verify: unit test 断言 final:true 事件不被 suppress、output.content 被赋值、onLiveTimelineEvent 被调用
- [x] 7.2 中间流式 delta（final 不为 true）在 suppress 期间仍被压制。 -> verify: unit test 断言 onLiveTimelineEvent 未调用、output.content 保持空
- [x] 7.3 非 LLM_CONTENT_DELTA 事件在 suppress 期间仍被压制。 -> verify: unit test 断言 onLiveTimelineEvent 和 onTimelineAppend 均未调用
- [x] 7.4 正常路径（shouldSuppress 为 false）行为不变。 -> verify: unit test 断言所有事件正常处理
- [x] 7.5 terminal message size limit 对豁免的 final 内容同样生效。 -> verify: unit test 断言超长内容触发 TERMINAL_MESSAGE_LIMIT_EXCEEDED
