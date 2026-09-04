# refine-ts-runtime-recovery-execution-cursor

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Runtime Recovery Refinement

状态：ready
类型：架构边界 refinement / 实施 change
主要 owner：`agent-runtime`、`agent-core`
依赖：`add-ts-local-runtime-recovery`、`add-ts-runtime-recovery-idempotency-guard`、`add-ts-lifecycle-hook-execution`、`complete-ts-lifecycle-hook-capabilities`

目标：
- Runtime recovery MUST 在进入 Agent core 前完成恢复决策，包括 recoverability、checkpoint/message/timeline/terminal fact 对账、capability replay safety、已有 capability result 复用和 terminal takeover/reconcile。
- Agent core MUST 只按照合法 execution context / execution cursor 执行，不得区分正常执行和 recovery 执行。
- 支持各 lifecycle boundary 的安全恢复：`BEFORE_MODEL_INVOKE`、`AFTER_MODEL_RESULT`、`BEFORE_CAPABILITY_INVOKE`、`AFTER_CAPABILITY_RESULT`、`BEFORE_TERMINAL_EVENT`；条件不满足时必须 fail closed。
- 恢复路径和正常路径 MUST 使用同一套 core execution step 语义；不得在 core/tool-loop 中散落 recovery-only 分支。

规格输入：
- Runtime recovery MUST 产出明确的 resume decision，例如 `REBUILD_QUEUE`、`RESUME_MODEL`、`RESUME_AFTER_MODEL`、`RESUME_CAPABILITY`、`RESUME_AFTER_CAPABILITY`、`TAKEOVER_TERMINAL`、`FAIL_CLOSED`。
- Runtime recovery MUST 将 checkpoint trigger、persisted assistant message、capability result message、timeline event、terminal facts 映射为合法 `RequestContext.nextLifecycleStage` 和必要 execution payload。
- 当 model result 已形成 durable assistant/tool-use fact 时，Runtime MUST 构造可继续执行的 after-model context；若缺少必要事实，MUST fail closed。
- 当 capability 已返回且 durable result 存在时，Runtime MUST 构造可继续执行的 after-capability context；MUST NOT 重新调用 capability。
- 当 capability 需要 replay 时，Runtime MUST 在进入 core 前校验 descriptor replay policy 和 stable idempotency key；非幂等、unknown policy、缺 key、缺 descriptor 或 facts 不一致 MUST fail closed。
- Agent core MUST NOT 使用 `isRecovered*`、`recoveryReplay`、`persistAssistantToolUse=false` 这类 recovery-only 分支来改变执行语义。
- Agent core MAY 根据 `nextLifecycleStage` dispatch 到统一 execution step，但该 dispatch MUST 同时服务正常执行和恢复执行。
- `AFTER_MODEL_RESULT` 和 `AFTER_CAPABILITY_RESULT` MUST 成为一等恢复边界；不能只隐式折叠到 before-stage，除非 design 明确证明黑盒行为等价且 core 不感知 recovery。
- Terminal recovery MUST 仍由 runtime / terminal commit boundary 拥有，不得把 terminal takeover 交给 agent-core。
- Unsafe recovery MUST terminalize as failed / recovery failed，不得伪装为 cancel、success 或 supersede。

契约输入：
- 复用既有 `LifecycleStage`、`RequestContext.nextLifecycleStage`、`ToolCallState`、`CheckpointTriggerReason`、`CapabilityReplayPolicy`、`CapabilityInvocationStatus`。
- 如需新增内部 `RecoveryDecision` / `ExecutionResumePlan`，优先放在 `agent-runtime` 私有实现；只有跨 package 必须消费时才提升到 `agent-contracts/runtime`。
- 不新增 `recoveryReplay` 到 `CapabilityInvocationRequest`。
- 不让 gateway record 拥有恢复业务语义；gateway 只提供 durable facts 和 CAS/claim/terminal commit primitives。

实现约束：
- `agent-runtime` 是 recovery decision owner。
- `agent-core` 不读取 checkpoint store、message store、timeline store 或 gateway record。
- `agent-core` 不判断 capability replay 是否安全。
- `agent-core` 不通过 recovery-specific flag 改写 tool/message persistence 行为。
- 正常执行时也应通过同一 execution cursor / execution step 更新逻辑推进，避免恢复路径成为第二套 executor。
- 改动必须保持 existing local runtime recovery 黑盒行为不回退。

非目标：
- 不实现多实例 lease、heartbeat、worker registry、non-sticky routing 或 PaaS takeover。
- 不新增远端 gateway recovery。
- 不改变 capability invocation public shape。
- 不扩大 lifecycle hook 能力范围。
- 不引入 workflow engine recovery。
- 不重写整个 agent-core；只收敛 recovery/core 边界和 execution cursor 推进方式。

验收要点：
- Characterization tests 覆盖当前 `local-runtime-recovery`、`runtime-recovery-guard`、tool-loop recovery、resilience E2E 行为不回退。
- 新增恢复阶段测试：before model invoke 可恢复；after model result 可恢复；before capability invoke 可恢复；after capability result 可恢复并复用 durable result；before terminal event / terminal pending 可恢复；非幂等 capability replay 在 runtime recovery decision 阶段 fail closed。
- Negative tests 覆盖缺 checkpoint、缺 messages、缺 descriptor、缺 stable key、facts mismatch、terminal partial facts inconsistent。
- Architecture tests 禁止 agent-core 引入 recovery store/gateway 依赖，禁止 core/tool-loop 出现 recovery-only execution branch 或 `recoveryReplay` 字段。
- Contract tests 确认 `CapabilityInvocationRequest` 不新增 recovery-specific input。
- `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict` 通过；targeted resilience/recovery tests 通过。

并行边界：
- 不得让 `agent-channel-web` 参与 recovery decision。
- 不得让 `agent-core` 依赖 gateway/local store、checkpoint store、timeline store 或 persistence record。
- 不得让 `agent-capability` 判断 runtime recovery policy；它只执行 capability invocation contract。
- 不得修改多实例 runtime 后置规划。
