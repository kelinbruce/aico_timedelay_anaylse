## 1. Contract Alignment 和 Characterization Tests

- [x] 1.1 对齐 stable core/capability contracts，确认 runtime recovery guard 只依赖 `CapabilityReplayPolicy = NON_IDEMPOTENT | IDEMPOTENT`，不依赖 `isIdempotent` 或 `IdempotencyDeclaration`。
  验证：运行 `rg -n "isIdempotent|IdempotencyDeclaration|CapabilityReplayPolicy" openspec/specs openspec/designs openspec/changes/add-ts-runtime-recovery-idempotency-guard packages/agent-common packages/agent-contracts packages/agent-capability packages/agent-app`，确认 `isIdempotent` / `IdempotencyDeclaration` 只作为拒绝方案或非目标出现，不作为字段、接口或 runtime guard 判断依据；运行 `openspec validate add-ts-runtime-recovery-idempotency-guard --strict`。
  来源：design D2；proposal 修改的 Capability；`Only IDEMPOTENT Capability Replay With Stable Key MAY Proceed`。
- [x] 1.2 添加 recovered pending Tool replay guard characterization tests，覆盖 recovered `BEFORE_CAPABILITY_INVOKE` 缺 result 时必须先检查 replay policy 和 stable idempotency key。
  验证：运行 runtime recovery guard 测试文件，断言 capability executor 在 guard 通过前未被调用。
  来源：`Runtime Recovery MUST Gate Pending Tool Replay`；design D1。
- [x] 1.3 添加普通首次 Tool 调用 regression tests，确认非 recovery 的普通 Agent loop 不因本 guard 增加 replay eligibility 前置条件。
  验证：运行 normal capability invocation / agent loop tests，断言普通 Tool 调用仍按既有 capability invocation contract 执行。
  来源：`Runtime Recovery MUST Gate Pending Tool Replay` 的 normal invocation scenario；design Non-Goals。
- [x] 1.4 添加 persisted capability result reuse tests，覆盖 recovered Tool 已有 result 时复用 result 且不重复调用 capability。
  验证：运行 recovery result reuse tests，断言 reconstructed ToolCallState 已完成、capability executor call count 为 0。
  来源：`Persisted Capability Result MUST Be Reused During Recovery`；design D4。
- [x] 1.5 添加 inconsistent facts negative tests，覆盖 `CAPABILITY_AFTER_RETURN` checkpoint 但缺 result、checkpoint sequence 不覆盖 message、run/message identity mismatch 时进入 recovery failed。
  验证：运行 recovery inconsistency tests，断言返回 `RECOVERY_CAPABILITY_RESULT_INCONSISTENT` safe error，且 capability executor call count 为 0。
  来源：`Persisted Capability Result MUST Be Reused During Recovery`；`Unsafe Recovery MUST Terminalize As Recovery Failed`；design D5。
- [x] 1.6 添加 replay policy/key matrix tests，覆盖 `IDEMPOTENT + stable idempotencyKey` 可重放，`NON_IDEMPOTENT`、缺 descriptor、缺 replay policy、缺 stable key 均不可重放，并确认 request-control command 的 submit/cancel/retry/edit `idempotencyKey` 不会被自动当作 capability replay key 使用。
  验证：运行 replay guard matrix tests，断言 only-idempotent-with-key 分支调用 capability；`NON_IDEMPOTENT` 或 policy 不可判定返回 `RECOVERY_UNSAFE_CAPABILITY_REPLAY`，缺 descriptor 返回 `RECOVERY_CAPABILITY_DESCRIPTOR_UNAVAILABLE`，缺 stable key 返回 `RECOVERY_IDEMPOTENCY_KEY_UNAVAILABLE`，且失败分支 executor call count 均为 0。
  来源：`Only IDEMPOTENT Capability Replay With Stable Key MAY Proceed`；`Unsafe Recovery MUST Terminalize As Recovery Failed`；design D2/D3/D9。
- [x] 1.7 添加 unsafe replay decision handoff tests，确认 guard 拒绝重放后输出稳定 recovery failed decision/safe error，并由 local runtime recovery terminal path 将 run 收敛为 failed，不归类为用户 cancel，不长期停留在 `EXECUTING`。
  验证：运行 terminalization/lane release tests，断言 guard decision code 稳定，`RunStatus=FAILED` 和 terminal commit facts 由 recovery terminal path 持久化，same-session lane 不被该 run 持续阻塞。
  来源：`Unsafe Recovery MUST Terminalize As Recovery Failed`；design D5/D9。
- [x] 1.8 添加 multi-Tool batch recovery tests，覆盖同一 assistant tool-use message 中部分 result 已存在、部分 pending 需要 guard，以及任一 unsafe pending Tool 导致整个 run recovery failed。
  验证：运行 mixed tool batch recovery tests，断言已完成 Tool result 被复用，unsafe pending Tool 不被调用，run 不继续模型调用或 terminal commit success。
  来源：`Multi-Tool Recovery MUST Reconcile Each Tool Independently`；design D7。
- [x] 1.9 添加 recovery guard redaction tests，确认 safe error/log/trace/audit details 不包含 raw arguments、raw result、prompt、模型输出、credential、local path 或 `idempotencyKey` 原文。
  验证：运行 SafeError/redaction tests，断言 details 只包含 `RECOVERY_UNSAFE_CAPABILITY_REPLAY`、`RECOVERY_IDEMPOTENCY_KEY_UNAVAILABLE`、`RECOVERY_CAPABILITY_DESCRIPTOR_UNAVAILABLE`、`RECOVERY_CAPABILITY_RESULT_INCONSISTENT`、runId、capabilityId、toolCallId、stage 等允许字段。
  来源：`Unsafe Recovery MUST Terminalize As Recovery Failed`；design D8/D9。

## 2. Runtime Guard Implementation

- [x] 2.1 在 runtime recovery pending Tool 恢复路径接入 guard，确保 `nextLifecycleStage=BEFORE_CAPABILITY_INVOKE` 且缺 result 时先执行 replay eligibility decision。
  验证：运行 1.2 recovered pending Tool replay guard tests。
  来源：`Runtime Recovery MUST Gate Pending Tool Replay`；design D1。
- [x] 2.2 实现 recovered Tool result 对账和复用逻辑，按 sessionId/requestId/runId、assistant tool-use metadata、capability result message、checkpoint `lastSequence`/`triggerReason` 和 timeline facts 重建 ToolCallState。
  验证：运行 1.4 result reuse tests；code review 检查查询限定当前 run facts，不做跨 owner/global 扫描。
  来源：`Persisted Capability Result MUST Be Reused During Recovery`；design D4。
- [x] 2.3 实现 recovery facts inconsistency safe-fail 分支，覆盖 after-return 缺 result、缺必要 checkpoint、checkpoint/message identity mismatch 和 sequence 不覆盖。
  验证：运行 1.5 inconsistent facts negative tests，确认使用 `RECOVERY_CAPABILITY_RESULT_INCONSISTENT`。
  来源：`Persisted Capability Result MUST Be Reused During Recovery`；`Unsafe Recovery MUST Terminalize As Recovery Failed`；design D5/D9。
- [x] 2.4 实现 replay policy 和 stable idempotency key 检查，`IDEMPOTENT + stable key` 才构造带 `idempotencyKey` 的 capability invocation request。
  验证：运行 1.6 replay policy/key matrix tests；code review 检查 runtime 不读取 `isIdempotent`，并确认 unsafe replay、descriptor unavailable、missing key 使用对应稳定错误码。
  来源：`Only IDEMPOTENT Capability Replay With Stable Key MAY Proceed`；design D2/D3/D9。
- [x] 2.5 实现 unsafe replay recovery failed decision handoff，确保 guard 输出稳定 safe error decision，并交给 local runtime recovery terminal path 通过 runtime terminal boundary 持久化 failed outcome 和释放 same-session lane 的后续执行条件。
  验证：运行 1.7 terminalization/lane release tests。
  来源：`Unsafe Recovery MUST Terminalize As Recovery Failed`；design D5。
- [x] 2.6 实现 multi-Tool batch 独立对账，已完成 result 复用，pending Tool 逐个 guard，任一 unsafe pending Tool 使整个 run failed。
  验证：运行 1.8 mixed tool batch recovery tests。
  来源：`Multi-Tool Recovery MUST Reconcile Each Tool Independently`；design D7。
- [x] 2.7 接入 recovery guard 的 safe error 和 observability 输出，使用稳定错误码并执行 redaction。
  验证：运行 1.9 redaction tests；code review 检查日志、metric、trace、audit 和 safeDetails 不包含 raw arguments/result/key，且错误码只来自本 change 定义的 recovery guard code 清单。
  来源：`Unsafe Recovery MUST Terminalize As Recovery Failed`；design D8/D9。

## 3. Cross-Change 和目标语义一致性检查

- [x] 3.1 对照 `add-ts-local-runtime-recovery`，确认本 change 只接入 pending Tool replay guard 和 unsafe decision handoff，不实现 queued rebuild、claim/fencing、terminal takeover 或完整 context reconstruction。
  验证：code review 检查点：本 change 的实现只消费 local runtime recovery 提供的恢复入口和 facts，并把 unsafe replay decision 交还 recovery terminal path，不新增并行 recovery scanner/state machine。
  来源：proposal 变更范围；design Goals / Non-Goals；design D1/D6。
- [x] 3.2 对照 stable checkpoint/timeline store contracts，确认 guard 使用 checkpoint/timeline/message/terminal facts 的 contract 字段，不引入 concrete DB/file/query library 依赖。
  验证：code review 检查点：runtime 只依赖 public gateway/runtime/session contracts；无 private adapter import。
  来源：proposal 影响范围；design D4/D5。
- [x] 3.3 对照 `stable ts-minimal-agent-kernel` 和相关 runtime lifecycle changes，确认 guard 不新增 RuntimeCommand、RunStatus、TimelineEventType、StreamEventType 或用户可见 stream event。
  验证：code review 检查点：diff 中无上述 public vocabulary/schema 新增；若 guard 需要这些 public vocabulary 才能表达语义，回到本批 active changes 的 Runtime recovery / core contract 边界重新收敛，而不是在 guard 中新增平行 contract。
  来源：proposal 变更范围；design Non-Goals。
- [x] 3.4 做目标语义一致性检查，确认 runtime guard 语义覆盖 recoverable run 恢复入口、checkpoint/result 对账、pending Tool replay guard、descriptor replay policy、stable `idempotencyKey`、safe failure terminalization 和 redaction，同时不复制与 core contracts 不一致的 RequestContext 字段。
  验证：code review 检查点：对照本 change 的 proposal/design/spec delta 与前置 recovery/capability contracts，确认 runtime guard 使用 `CapabilityReplayPolicy` 和 stable `idempotencyKey`，且 stable key 要求来自 core contracts。
  来源：design Context；design D1/D2/D3/D4/D5/D9；stable OpenSpec target-state rule。

## 4. Verification 和收尾

- [x] 4.1 运行 runtime recovery guard 相关单元、contract、integration 和 resilience tests。
  验证：运行包含 recovery guard、capability replay policy、checkpoint/result reconstruction、terminalization、redaction 的测试集合。
  来源：proposal 影响范围；design Verification Map。
- [x] 4.2 运行 OpenSpec 严格校验。
  验证：`openspec validate add-ts-runtime-recovery-idempotency-guard --strict` 和 `openspec validate --all --strict`。
  来源：OpenSpec config；proposal 验证入口。
- [x] 4.3 做 cross-change 文档一致性检查，确认 `add-ts-runtime-recovery-idempotency-guard`、`add-ts-local-runtime-recovery`、stable `ts-core-contracts` 和 stable `ts-backend-architecture` 在 `CapabilityReplayPolicy`、stable `idempotencyKey`、recovery failed 语义上没有冲突。
  验证：运行 `rg -n "isIdempotent|IdempotencyDeclaration|CapabilityReplayPolicy|RECOVERY_UNSAFE_CAPABILITY_REPLAY|RECOVERY_IDEMPOTENCY_KEY_UNAVAILABLE|RECOVERY_CAPABILITY_DESCRIPTOR_UNAVAILABLE|RECOVERY_CAPABILITY_RESULT_INCONSISTENT|idempotencyKey" openspec/changes/add-ts-runtime-recovery-idempotency-guard openspec/changes/add-ts-local-runtime-recovery openspec/specs openspec/designs` 并 code review 结果；`isIdempotent` / `IdempotencyDeclaration` 只允许作为拒绝方案或非目标出现。
  来源：proposal 修改的 Capability；design Risks / Trade-offs。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/runtime-recovery-idempotency-guard/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/architecture/runtime-recovery.md`。
- 按需更新 `openspec/designs/architecture/request-run.md`。
- 按需更新 `openspec/designs/architecture/core-contracts.md`。
- 按需更新 `openspec/designs/modules/agent-runtime.md`、`agent-core.md`、`agent-capability.md`。
- 按需新增或更新 `openspec/designs/adr/runtime-recovery-tool-replay-policy.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一 recovery state machine、capability replay contract、gateway owner 或接口语义。
