## 1. Characterization 和 Contract Tests

- [x] 1.1 添加启动恢复 gating characterization tests，覆盖 recovery pass 完成前 scheduler 不 dispatch 新 work。
  验证：运行 runtime startup recovery test 文件，断言 recovery 未完成时 scheduler executor call count 为 0，完成后才允许 dispatch。
  来源：`Local Runtime Startup MUST Run A Bounded Recovery Pass`；design D1。
- [x] 1.2 添加 recoverable scan contract tests，覆盖 finite limit、`QUEUED`、`EXECUTING`、`terminalCommitState=PENDING|RETRYING` 和 terminal committed skip。
  验证：运行 gateway recovery contract tests，断言 `listRecoverableRuns` 使用有限 limit，并按可信 agent+owner scope 返回 recoverable facts，且不同状态进入对应 recovery branch。
  来源：`Recoverable Run Classification MUST Use Durable Facts`；design D1/D2。
- [x] 1.3 添加 queued rebuild tests，覆盖 durable `QUEUED` run 重建 scheduler work item，且不 inline 调用 Agent execution。
  验证：运行 scheduler rebuild tests，断言 work item 被 schedule，run 仍走 scheduler path，Agent executor 在 recovery scan 内未调用。
  来源：`Queued Recovery MUST Rebuild Scheduler Work From Durable Runs`；design D3。
- [x] 1.4 添加 executing claim/fencing tests，覆盖 claim accepted 后继续，claim version conflict/not found 时不重复执行、不直接失败。
  验证：运行 executing recovery claim tests，断言 claim rejected 分支 executor call count 为 0，并触发 reload/skip/safe diagnostic。
  来源：`Executing Recovery MUST Claim Before Continuing`；design D4。
- [x] 1.5 添加 RequestContext reconstruction tests，覆盖 checkpoint、current request messages、assistant tool-use metadata、capability result messages、activeContextVersion 和 flowVariables 恢复。
  验证：运行 context reconstruction tests，断言 `attempt`/`deadlineAt` 来自 `RequestRun`，不依赖 `RequestContext.messageRefs`。
  来源：`Executing Recovery MUST Reconstruct RequestContext From Checkpoint And Messages`；design D5。
- [x] 1.6 添加 pending Tool guard handoff tests，覆盖 `BEFORE_CAPABILITY_INVOKE` 缺 result 时调用 runtime recovery idempotency guard，非幂等或缺 key 时不调用 capability。
  验证：运行 pending Tool recovery tests，断言 guard reject 分支 capability executor call count 为 0，错误码来自 guard contract。
  来源：`Recovery MUST Continue Only Through Defined Lifecycle Stages`；`runtime-recovery-idempotency-guard`；design D6。
- [x] 1.7 添加 terminal takeover tests，覆盖 `terminalCommitState=PENDING|RETRYING` 的幂等重试和 duplicate message/event prevention。
  验证：运行 terminal takeover tests，断言 repeated takeover 不重复 assistant message、capability-result message、timeline event 或 terminal run fact。
  来源：`Terminal Recovery MUST Be Idempotent`；design D2/D8。
- [x] 1.8 添加 partial terminal reconcile tests，覆盖 terminal message/event 已持久化但 run 未稳定终态时 reconcile run state 并 release lane。
  验证：运行 partial terminal recovery tests，断言不重新写 terminal message/event，reconciled run 达到 terminal committed 后 lane release。
  来源：`Terminal Recovery MUST Be Idempotent`；design D2。
- [x] 1.9 添加 missing assembly negative tests，覆盖 `AgentAssemblyRegistry.require` 失败时 recovery failed，且不得 fallback 到 `active(agentId)`。
  验证：运行 missing assembly recovery tests；code review 检查 recovery path 中无 `active(agentId)` fallback。
  来源：`Recovery MUST Preserve Assembly And Owner Boundaries`；design D7。
- [x] 1.10 添加 recovery failed terminalization tests，覆盖 missing messages、missing checkpoint、checkpoint mismatch、terminal facts inconsistent 分支通过 terminal boundary 失败。
  验证：运行 recovery failed tests，断言 run 不长期 `EXECUTING`、不归类为 cancel、terminal commit pending 时 lane 仍 blocked。
  来源：`Unsafe Recovery MUST Terminalize As Recovery Failed`；design D8。
- [x] 1.11 添加 safe diagnostics/redaction tests，覆盖 recovery error code 稳定且不泄露 prompt、模型输出、raw Tool args/result、credential、local path、storage key、adapter query、raw idempotency key。
  验证：运行 SafeError/redaction tests，断言 diagnostics 只包含允许的 run/stage/capability/toolCall/code 字段。
  来源：`Recovery Diagnostics MUST Be Safe And Traceable`；design Quality Attributes。

## 2. Runtime 和 Gateway 实现

- [x] 2.1 在 Runtime 启动路径接入 local recovery orchestrator，并在 recovery pass 完成前 gate scheduler dispatch。
  验证：运行 1.1 startup recovery characterization tests。
  来源：`Local Runtime Startup MUST Run A Bounded Recovery Pass`；design D1。
- [x] 2.2 补齐 local gateway recoverable run scan、claim/fencing、checkpoint load 和 terminal commit result 的 contract 实现或 adapter 接入。
  验证：运行 1.2 gateway recovery contract tests；code review 检查 Runtime 不依赖 SQLite/Kysely/private query，所有 recovery facts 查询和返回都保留 `agentId`、owner scope 与 session/request/run 坐标。
  来源：proposal Impact；`Recoverable Run Classification MUST Use Durable Facts`；design D1/D4。
- [x] 2.3 实现 `QUEUED` run scheduler rebuild，包括 persisted assembly/message 校验、work item 重建和 normal scheduler path 接入。
  验证：运行 1.3 queued rebuild tests。
  来源：`Queued Recovery MUST Rebuild Scheduler Work From Durable Runs`；design D3。
- [x] 2.4 实现 `ACCEPTED` pre-queue repair characterization：若 durable window 存在则 repair/fail；若实现原子 accept-to-queued，则用测试证明不会恢复到 `ACCEPTED`。
  验证：运行 accepted pre-queue recovery tests，覆盖 repair/fail 或 no-window characterization。
  来源：`Queued Recovery MUST Rebuild Scheduler Work From Durable Runs` 的 accepted scenario；design D9。
- [x] 2.5 实现 `EXECUTING` recovery claim/fencing 和 claim conflict handling。
  验证：运行 1.4 executing claim/fencing tests。
  来源：`Executing Recovery MUST Claim Before Continuing`；design D4。
- [x] 2.6 实现 checkpoint/message/timeline/active context 对账和 `RequestContext` 重建。
  验证：运行 1.5 RequestContext reconstruction tests。
  来源：`Executing Recovery MUST Reconstruct RequestContext From Checkpoint And Messages`；design D5。
- [x] 2.7 实现 lifecycle stage continuation：`BEFORE_MODEL_INVOKE`、`BEFORE_CAPABILITY_INVOKE`、`BEFORE_TERMINAL_EVENT` 分别进入模型、Tool guard 和 terminal boundary。
  验证：运行 lifecycle stage recovery tests，覆盖三个 stage 的正向路径和 forbidden duplicate path。
  来源：`Recovery MUST Continue Only Through Defined Lifecycle Stages`；design D6。
- [x] 2.8 接入 runtime recovery idempotency guard，确保 pending Tool 缺 result 时只在 guard 通过后调用 capability。
  验证：运行 1.6 pending Tool guard handoff tests。
  来源：`Recovery MUST Continue Only Through Defined Lifecycle Stages`；`runtime-recovery-idempotency-guard`。
- [x] 2.9 实现 terminal pending/retrying takeover 和 partial terminal reconcile。
  验证：运行 1.7 terminal takeover tests 和 1.8 partial terminal reconcile tests。
  来源：`Terminal Recovery MUST Be Idempotent`；design D2/D8。
- [x] 2.10 实现 recovery failed terminalization 和 lane release gating。
  验证：运行 1.10 recovery failed terminalization tests。
  来源：`Unsafe Recovery MUST Terminalize As Recovery Failed`；design D8。
- [x] 2.11 实现 recovery safe error mapping 和 observability redaction。
  验证：运行 1.11 safe diagnostics/redaction tests。
  来源：`Recovery Diagnostics MUST Be Safe And Traceable`；proposal Impact。

## 3. Cross-Change 和目标语义一致性检查

- [x] 3.1 对照 `stable ts-backend-architecture`，确认 Runtime 是唯一 recovery owner，Channel/Session/Gateway/Core/Capability 没有复制 recovery state machine。
  验证：code review 检查模块依赖和职责边界；运行 `npm run lint:architecture`。
  来源：design Documentation Ownership；architecture Runtime ownership。
- [x] 3.2 对照 `stable ts-core-contracts`，确认实现只消费 `listRecoverableRuns`、`claimRun`、`commitTerminal`、checkpoint、`RequestContext` 和 `CapabilityReplayPolicy`，不新增并行 enum、private DTO 或 public API。
  验证：code review 检查 public exports/diff；运行 `npm run test:contract`；确认共享 RequestRun agent+owner scope 来自 `add-ts-session-lane-scheduling`，本 change 只补 recovery-specific scan/claim/checkpoint/terminal takeover 语义。
  来源：proposal 修改的 Capability；design D5/D6。
- [x] 3.3 对照 `openspec/changes`、`openspec/specs` 和 `openspec/designs`，确认本 change 与 session lane scheduling、runtime recovery idempotency guard、stable capability replay/checkpoint/timeline contracts 没有范围冲突。
  验证：运行 `rg -n "local-runtime-recovery|runtime-recovery-idempotency-guard|CapabilityReplayPolicy|listRecoverableRuns|claimRun|commitTerminal|loadCheckpoint|loadSessionLaneSnapshot|agentId" openspec/changes openspec/specs openspec/designs` 并做 cross-change review，确认本 change 不重定义 lane snapshot 或 pending Tool replay guard。
  来源：proposal Baseline Promotion Plan；design Verification Map。
- [x] 3.4 做目标语义一致性检查，确认 runtime recovery 覆盖 recoverable run scan、queued rebuild、executing claim/reconstruction、terminal takeover/reconcile、pending Tool guard handoff、recovery failed terminalization 和 redaction，并确认 `RequestContext` 仅保留 core contracts 定义的恢复坐标字段。
  验证：code review 检查本 change 的 proposal/design/spec delta 与前置 runtime/core-contract changes；确认目标实现不引入 `RequestContext.messageRefs`、`attempt`、`deadlineAt`。
  来源：design Context；design D5；stable OpenSpec target-state rule。

## 4. Verification 和收尾

- [x] 4.1 运行 local runtime recovery 相关 unit、contract、integration 和 resilience tests。
  验证：运行包含 startup recovery、queued rebuild、executing claim、context reconstruction、terminal takeover、Tool guard handoff、safe error redaction 的测试集合。
  来源：design Verification Map。
- [x] 4.2 运行常规验证命令。
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。
  来源：AGENTS.md 验证门禁；proposal 验证入口。
- [x] 4.3 运行 OpenSpec 严格校验。
  验证：`openspec validate add-ts-local-runtime-recovery --strict` 和 `openspec validate --all --strict`。
  来源：OpenSpec config；proposal 验证入口。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/local-runtime-recovery/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/architecture/runtime-recovery.md`。
- 按需更新 `openspec/designs/architecture/request-run.md`。
- 按需更新 `openspec/designs/architecture/core-contracts.md`。
- 按需更新 `openspec/designs/modules/agent-runtime.md`、`agent-platform-gateway-local.md`、`agent-session.md`。
- 按需新增或更新 `openspec/designs/adr/local-runtime-recovery-startup-gate.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一 recovery state machine、gateway owner、capability replay contract 或 terminal commit 语义。
