## 0. Scope lock

- [x] 0.1 本 change 只实现 pending input core lifecycle 和 answer command boundary：runtime internal handoff、explicit `AgentExecutionOutcome.PENDING_INPUT` pause、checkpoint-before-visible、Web answer ingress、answer CAS/idempotency、resume、same-session active pending guard、owning-run cancel linkage 和 safe projection。
  验证：diff review 确认没有 type-specific QUESTION/CONFIRMATION/AUTHORIZATION/HUMAN_HANDOFF value validation、timeout loop、new RunStatus、new lifecycle stage、new checkpoint trigger、除 runtime-owned minimal `producerRef` 之外的 pending record producer/tool-call fields、standalone cancel-pending API 或 capability-private wait/resume state
  来源：proposal 架构约束
- [x] 0.2 实施顺序固定为 contract guard -> pending intent internal handoff -> checkpoint/pending/event publication -> `AgentExecutionOutcome.PENDING_INPUT` pause -> Web answer route/schema -> answer resolve/resume materialization -> lane/cancel guard -> projection/boundary tests。
  验证：tasks/checklist review；runtime 是唯一 lifecycle owner，channel 只调用 `RuntimeCommandPort.answerPendingInput`
  来源：`Runtime-owned pending input lifecycle`

## 1. Contract and state guards

- [x] 1.1 确认本 change 只消费 `refine-ts-pending-input-contracts`，不新增 `RunStatus`、`PendingInputStatus`、`TimelineEventType` 或 pending-input subpath。
  验证：contract tests；`rg "WAITING_FOR_USER|RunStatus.*PENDING" packages openspec/changes/add-ts-human-pending-input-core`
  来源：`Runtime-owned pending input lifecycle`
- [x] 1.2 为 runtime pending lifecycle 定义 safe error codes：not found、not pending、idempotency required/conflict、active pending conflict、checkpoint unavailable、resume unavailable、canceled、already resolved。
  验证：runtime command tests 断言 SafeError code/category/retryable
  来源：`Pending answer resumes original run`
- [x] 1.3 复用 `refine-ts-pending-input-contracts` 定义的 `PendingInputIntent` contract DTO，并实现同一 refinement 定义的 Capability invocation producer 唯一 runtime-owned pending intent 入口 `AgentRunStatePort.requestPendingInput(run, context, intent): Promise<PendingInputRequest>`；不得新增 `PendingInputIntent` 替代对象、generic `PolicyPort`、public create-pending command、`CapabilityInvocationRuntimeContext.requestPendingInput(...)` facade 或 capability-private wait/resume API。
  验证：contract/source tests 断言 `PendingInputIntent` 仍只在 `agent-contracts/runtime` 定义；`AgentRunStatePort.requestPendingInput` 接收 accepted `RequestRun`、trusted `RequestContext` 和 `PendingInputIntent`，返回 safe `PendingInputRequest`
  来源：`Pending intent enters runtime-owned internal handoff`
- [x] 1.4 消费 `refine-ts-pending-input-contracts` 定义的 `AgentExecutionOutcome`，并将 `Agent.execute(...)` 实现从 `Promise<void>` 改为 `Promise<AgentExecutionOutcome>`；只允许 `COMPLETED` 和 `PENDING_INPUT` 两种 core-to-runtime control outcome。
  验证：contract tests 断言 `AgentExecutionOutcome` 只表达 completed/pending input，不新增 `RunStatus`、`LifecycleStage` 或 thrown control signal contract；integration/source tests 断言 `requestPendingInput(...)` 成功后 Agent/core 立即返回 `PENDING_INPUT`，不继续执行后续 tool call 或 append 普通 capability result
  来源：`Pending input pauses Agent execution without terminal commit`

## 2. Pending creation

- [x] 2.1 定义 runtime-owned pending intent internal handoff：Hook producer 入口只消费 `HookResult{ decision: "PEND", pendingInputIntent }`；Capability invocation producer 入口只消费 `AgentRunStatePort.requestPendingInput(run, context, intent)`；Model、standalone policy logic 和 runtime-internal step 不作为首版独立 producer；受保护 capability 调用前确认/授权只能经 `BEFORE_CAPABILITY_INVOKE` Hook producer 进入 pending。
  验证：architecture test；runtime integration test 断言 capability handler 不阻塞等待 answer，且 producer-local validation 不绕过 runtime 对 accepted run、trusted context、owner scope、agent scope、intent kind/shape、timeout bounds、checkpoint 可用性和 active pending conflict 的最终 acceptance validation；source review 确认 channel/capability/gateway 不直接创建 pending lifecycle，且本 change 不新增 `PolicyPort` 或 `CapabilityInvocationRuntimeContext.requestPendingInput(...)`
  来源：`Pending intent enters runtime-owned internal handoff`
- [x] 2.1a 增加 pending kind selection boundary tests/review check：`CONFIRMATION`/`AUTHORIZATION` kind 必须由 trusted Agent/core lifecycle hook 或 capability guard 在 runtime handoff 前选择，并在涉及 protected operation risk 时基于 resolved capability descriptor 和 explicit risk/governance policy；runtime 不从 model text、client payload、channel metadata、gateway record 或 tool arguments 推断确认/授权语义。
  验证：architecture/source review check；runtime handoff tests 断言 runtime 只做 final acceptance/lifecycle ownership，不新增 generic policy port、risk engine、guard registry 或 capability runtime context facade
  来源：`Pending input kind is selected by trusted producer boundary`
- [x] 2.2 在 runtime pending intent 处理路径中先保存 checkpoint，再持久化 `PendingInput`，最后发布 `USER_INPUT_REQUIRED`。
  验证：runtime integration test 断言 checkpoint failure 时没有 visible pending event；source review 确认复用既有 checkpoint trigger/recovery stage；contract/runtime tests 断言 Hook producer 写入 `producerRef.kind="LIFECYCLE_HOOK"`，Capability invocation producer 写入 `{ kind: "CAPABILITY_INVOCATION", capabilityId, toolCallId }`，且该坐标不来自 model/client/channel/capability args/gateway
  来源：`Pending input is visible only after recoverable checkpoint`
- [x] 2.3 对同一 run 已存在 `PENDING` pending input 的第二个 intent 返回 safe conflict，不创建第二条 active pending。
  验证：runtime conflict test
  来源：`One active pending input per run`
- [x] 2.4 runtime 收到 `AgentExecutionOutcome.PENDING_INPUT` 后必须停止当前 dispatch，不 terminal commit、不进入 failure path、不释放 same-session lane，并保留 active pending guard。
  验证：runtime/core integration tests 覆盖 `Agent.execute(...)` 返回 pending outcome 后没有 `REQUEST_COMPLETED` / `REQUEST_FAILED` terminal facts；negative test 覆盖同一 run 已有 accepted active pending fact 时，post-handoff error path 不覆盖成 failed/completed terminal
  来源：`Pending input pauses Agent execution without terminal commit`

## 2.5 Web answer ingress

- [x] 2.5.1 在 `agent-channel-web` 新增 pending input answer route/schema；Web answer payload 只承载 `sessionId`、`pendingInputId` 和 ordered `answers`，channel/auth boundary 注入 trusted `identityContext` 和 canonical command `idempotencyKey` 后只调用 `RuntimeCommandPort.answerPendingInput`。
  验证：web route/schema tests 覆盖合法提交、禁止 client-supplied identity/idempotency/answer schema/timeout behavior，以及 route 不直接访问 pending store
  来源：`Web answer ingress delegates to runtime`

## 3. Answer handling

- [x] 3.1 补齐 `answerPendingInput` 的 owner+agent+session 校验、公共 answer envelope 校验、gateway resolve idempotency + CAS resolve、`USER_INPUT_RECEIVED` 发布和 raw answer 安全投影；kind-specific answer value validation 由 question/confirmation/authorization/handoff changes 消费同一入口。
  验证：runtime command/integration tests；stream projection tests
  来源：`Valid answer resolves pending and resumes`
- [x] 3.2 覆盖 late answer、cross-owner answer、cross-agent answer、terminal/canceled/timed-out owning run answer 的 negative cases。
  验证：runtime negative tests
  来源：`Late answer is rejected`
- [x] 3.3 实现 answer command idempotency：重复相同 key+semantic 返回等价 accepted outcome，不同 semantic 重用 key 返回 safe conflict。
  验证：idempotency tests
  来源：`Answer command idempotency replays equivalent outcome`
- [x] 3.4 覆盖刷新/换设备语义：新设备用新 command key 回答仍受 pending status CAS 保护；已 resolved pending 不会二次恢复原 run。
  验证：cross-device answer integration test
  来源：`Different command after pending already resolved does not double-resume`

## 4. Resume

- [x] 4.1 answer 被 resolve 为 `RECEIVED` 后，runtime 使用 pending record 的 checkpoint/run/context 坐标恢复原 run 的下一段执行；恢复复用既有 `RequestContext.nextLifecycleStage`，不新增 pending-specific lifecycle stage。
  验证：runtime resume integration test；source review 确认没有新增 `AFTER_PENDING_INPUT` 或等价 lifecycle stage
  来源：`Pending answer resumes original run`
- [x] 4.2 恢复失败时不得丢失 received answer fact，必须产生 safe failure 或可恢复状态。
  验证：recovery characterization test
  来源：design answer accept/resume
- [x] 4.3 Capability invocation producer 的 resolved answer 必须按 durable `producerRef.toolCallId` materialize 为原 producer tool call 的一条 safe `CAPABILITY_RESULT` message，并继续剩余 tool calls 或下一轮 model；不得重新 invoke producer capability；若当前 tool batch 中存在多个 producer tool call，只 materialize `producerRef.toolCallId` 指向的原 producer tool call。
  验证：runtime/core resume integration test 覆盖 AskUserQuestion-like producer：answer 后不重复创建 pending、不重复调用 producer capability、生成一次 capability result；multi-producer batch test 覆盖先恢复当前 pending 的 `producerRef.toolCallId`，后续 producer tool call 只能在继续执行到它时再进入 pending 并写入自己的 `producerRef`
  来源：`Capability producer answer materializes a capability result once`
- [x] 4.4 Hook producer 的 resolved answer 只恢复原 lifecycle gate，不 materialize capability result；受保护 capability pre-confirmation/pre-authorization 恢复后仍在副作用开始前。
  验证：runtime hook pending integration test 覆盖 `BEFORE_CAPABILITY_INVOKE` hook pend/resume，不产生 capability result message；assert pending fact uses `producerRef.kind="LIFECYCLE_HOOK"`
  来源：`Hook producer answer resumes lifecycle gate without capability result`
- [x] 4.5 恢复定位必须消费 `refine-ts-pending-input-contracts` 定义的 runtime-owned minimal `producerRef`；runtime/core 不得从 first unresolved tool call、string alias、descriptor metadata、model text、client answer 或 capability args 猜测 producer 坐标。
  验证：contract/source tests 断言除 `producerRef` 外 pending record 无其它 producer/tool-call 字段；negative recovery tests 覆盖 missing/wrong-kind/mismatched-capability/already-resulted/out-of-context `producerRef` 时不重新 invoke producer capability、不猜测其它 unresolved tool call；hook resume test 覆盖 `producerRef.kind="LIFECYCLE_HOOK"` 时不生成 capability result
  来源：`Capability producer answer materializes a capability result once`

## 5. Lane and cancel behavior

- [x] 5.1 在 submit path 增加 active pending guard；同 owner+agent+session 有 active pending 时返回 safe conflict 和 safe pending ref/summary，不创建新 run。
  验证：cross-device submit integration test
  来源：`Cross-device submit during active pending is rejected`
- [x] 5.2 owning run cancel 时将 active pending resolve 为 `CANCELED` 并发布 `USER_INPUT_CANCELED`，late answer 返回 conflict。
  验证：cancel/pending integration test
  来源：`Owning run cancel cancels pending input`

## 6. Boundary validation

- [x] 6.1 更新 stream/history projection，确保 `USER_INPUT_REQUIRED` 只暴露 safe `PendingInputRequest`，terminal pending events 不暴露 raw answer。
  验证：channel projection tests
  来源：`Runtime-owned pending input lifecycle`
- [x] 6.2 增加 architecture tests，断言 channel 不直接写 pending store、capability 不创建私有 lifecycle、gateway 不返回 lifecycle decisions。
  验证：`npm run lint:architecture`
  来源：design D1、D3、D4
- [x] 6.3 运行完整验证。
  验证：`openspec validate add-ts-human-pending-input-core --strict`、`npm run build`、`npm test`、`npm run lint:architecture`
  来源：本 change 全部 requirements

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，按 proposal/design 的 Baseline Promotion Plan 更新长期基线。
