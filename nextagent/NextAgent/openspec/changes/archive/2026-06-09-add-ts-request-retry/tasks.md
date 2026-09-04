## 1. Contract 和 Characterization Tests

- [x] 1.1 添加 retry owner/latest/terminal committed characterization tests，覆盖 owner mismatch、`expectedLatestRequestId` 过期、target not found、历史 request retry 被拒绝、latest active run 被拒绝和 terminal-pending run 被拒绝。
  验证：运行 request retry runtime/contract 测试文件，断言返回 `REQUEST_RETRY_NOT_LATEST`、`REQUEST_RETRY_NOT_FOUND`、`REQUEST_RETRY_FORBIDDEN`、`REQUEST_RETRY_NOT_TERMINAL`、`REQUEST_RETRY_TERMINAL_PENDING`，且没有非法 RequestRun 或 message visibility mutation。
  来源：`Owner-Scoped Latest Request Retry Command`、`Retryable Request State Classification`；design D1、D2、D13。
- [x] 1.2 添加 retry attempt identity tests，覆盖 same root request、新 `runId`、`attempt` 递增、`retryOfRunId` 指向上一 attempt、连续 retry lineage 和 source AgentAssembly 复用。
  验证：运行 RequestRun/retry metadata tests 和 gateway persistence tests，断言 retry attempt 2/3 的 `requestId` 不变、`runId` 不同、`retryOfRunId` 在 `RequestRunRecord` 和读回 facts 中指向上一 attempt，并且 `agentId`、`agentVersion`、`agentAssemblyRef` 保持 source run 值。
  来源：`Retry Creates Same Request New Attempt`；design D3、D4。
- [x] 1.3 添加 retry scheduler acceptance tests，覆盖 retry 成功必须 durable created、queued/scheduler accepted 后才返回 `RequestAccepted`，且 `RequestAccepted` 不代表 terminal complete。
  验证：运行 retry scheduler characterization tests，断言 command response 包含 `sessionId`、`requestId`、`runId`、`attempt`，且 execution completion 仍由后续 terminal facts 表达。
  来源：`Retry Acceptance Queues New Attempt`；design D5、D6。
- [x] 1.4 添加 queue/scheduler failure tests，覆盖 run persistence、lane acquisition、scheduler acceptance 或 queue persistence 失败时，新 retry run terminalize 为 `RunStatus.FAILED`，旧结果不隐藏，不形成 accepted retry idempotency anchor。
  验证：运行 retry queue failure resilience tests，断言失败分支返回 `REQUEST_RETRY_QUEUE_UNAVAILABLE` 或安全 unavailable outcome，新 run 不悬挂，旧 attempt messages 仍在默认历史中可见。
  来源：`Retry Acceptance Queues New Attempt`；design D7。
- [x] 1.5 添加 retry visibility replacement tests，覆盖 schedule 成功后隐藏上一 attempt 的 assistant/capability messages、不隐藏 root USER message、重复 hide 幂等、旧结果可通过 includeHidden/attempt detail/audit 追溯。
  验证：运行 session message visibility tests 和 gateway visibility persistence tests，断言 `hideMessage` 持久化 `visible=false`、`RETRY_REPLACED`、new request context id、稳定 idempotency key/anchor，且 hidden metadata 首次写入后不被重复覆盖。
  来源：`Retry Replaces Default History Visibility`；design D8、D10。
- [x] 1.6 添加 retry active context exclusion tests，覆盖 retry 新 attempt 的模型上下文不包含上一 attempt 的 assistant/capability 输出。
  验证：运行 active context/context assembly tests，断言 retry context/model input 只包含 root user input 和允许的上下文项，不把 hidden flag 当作唯一模型上下文规则。
  来源：`Retry Model Context Excludes Replaced Attempt Output`；design D9。
- [x] 1.7 添加 retry idempotency tests，覆盖缺失/空 `idempotencyKey` 返回 `REQUEST_RETRY_IDEMPOTENCY_REQUIRED`、同 key 同 command semantic 通过 retry `RequestRun` acceptance anchor 重放返回原始 `RequestAccepted`、同 key 不同 command semantic 返回 `REQUEST_RETRY_IDEMPOTENCY_CONFLICT`、不同 key 在 active retry 上返回 not-terminal。
  验证：运行 duplicate retry/idempotency poisoning tests，断言缺失/空 key 不产生 run/queue/visibility side effect，accepted outcome 只从 queued/scheduler accepted 后的 retry RequestRun acceptance anchor 推导，失败前同 key 不产生 stale accepted no-op，且不新增独立 command outcome fact。
  来源：`Retry Idempotency And Latest After Retry`；design D11、D12。
- [x] 1.8 添加 source attachment revalidation tests，覆盖原 root USER message 有 attachment refs 时 retry accepted 前重新校验 agent+owner scope、`validationStatus=ACCEPTED`、`availabilityStatus=AVAILABLE` 和现有 `RequestAttachmentRecord` metadata；校验失败时不创建 retry run、不隐藏旧结果。
  验证：运行 attachment revalidation tests，断言 attachment lookup 使用可信 `tenantId`、`subjectId`、`agentId`，失败分支返回 `REQUEST_RETRY_ATTACHMENT_UNAVAILABLE` 或 agent/owner-scope safe error，且无 scheduler enqueue、RequestRun mutation 或 message visibility mutation。
  来源：`Retry Revalidates Source Attachments`；design D4A。

## 2. Runtime Retry Command Implementation

- [x] 2.1 在 Runtime command handling 中实现 retry target selection，使用 `identityContext.tenantId`、`identityContext.subjectId`、`sessionId` 和 `expectedLatestRequestId` 校验 latest terminal committed request。
  验证：运行 1.1 owner/latest/terminal tests。
  来源：`Owner-Scoped Latest Request Retry Command`、`Retryable Request State Classification`；design D1、D2。
- [x] 2.2 实现 retry run creation，保持 same root request，生成新 `runId`，递增 `attempt`，设置 `retryOfRunId` 指向上一 attempt，并复用 source `agentId`、`agentVersion`、`agentAssemblyRef`。
  验证：运行 1.2 retry attempt identity tests；code review 检查 `retryOfRunId` 进入 gateway `RequestRunRecord` / local persistence mapping，而不是只存在于 Runtime 内存对象。
  来源：`Retry Creates Same Request New Attempt`；design D3、D4。
- [x] 2.3 接入 Runtime scheduler queue path，确保 retry run durable created 并 queued/scheduler accepted 后才返回 `RequestAccepted`。
  验证：运行 1.3 retry scheduler acceptance tests。
  来源：`Retry Acceptance Queues New Attempt`；design D5、D6。
- [x] 2.4 实现 queue/scheduler failure handling，对已 durable 创建但未成功 queued/scheduled 的 retry run terminal commit 为 `RunStatus.FAILED`，并保留旧结果可见。
  验证：运行 1.4 queue/scheduler failure tests。
  来源：`Retry Acceptance Queues New Attempt`；design D7。
- [x] 2.5 实现 retry 后 latest attempt 更新，确保 accepted retry run 成为后续 cancel、retry、edit 和 ordinary submit replacement 的 latest target。
  验证：运行 latest-after-retry control tests，断言 retry queued/executing 时新 retry command 返回 `REQUEST_RETRY_NOT_TERMINAL`，cancel 命中 retry attempt。
  来源：`Retry Idempotency And Latest After Retry`；design D12。
- [x] 2.6 接入 source attachment refs 重新校验，确保 Runtime 在创建 retry run 前调用 attachment boundary 校验原 root USER message attachment refs。
  验证：运行 1.8 attachment revalidation tests；code review 检查 attachment revalidation 不做 owner-only lookup，不从 client metadata、模型输出或 capability arguments 推断 owner/agent scope。
  来源：`Retry Revalidates Source Attachments`；design D4A。

## 3. Session History、Context 和 Visibility

- [x] 3.1 实现 schedule 成功后的 retry visibility replacement，使用 `SessionMessageStoreGateway.hideMessage(HideMessageRequest)` 隐藏上一 attempt 的非 USER messages。
  验证：运行 1.5 visibility replacement tests；code review 检查 `hideMessage` 是幂等 durable visibility update，不通过删除、重写 message content 或 process-local hidden table 实现。
  来源：`Retry Replaces Default History Visibility`；design D8。
- [x] 3.2 实现 visibility recovery handoff，保证 `hideMessage` 暂不可用时保留 retry run、`retryOfRunId`、new request context id、root request id 和 hide idempotency key derivation，并记录 `REQUEST_RETRY_VISIBILITY_UNAVAILABLE` safe diagnostic。
  验证：运行 visibility recovery tests，断言 recovery 可重复补做 `hideMessage`，且不会删除 retry run 或旧 messages。
  来源：`Retry Replaces Default History Visibility`、`Request Retry Safe Errors`；design D10、D13。
- [x] 3.3 接入 active context/context assembly exclusion，确保 retry 模型上下文不包含上一 attempt 的 assistant/capability 输出。
  验证：运行 1.6 active context exclusion tests。
  来源：`Retry Model Context Excludes Replaced Attempt Output`；design D9。
- [x] 3.4 接入 Session/read model 的 hidden traceability，确保旧 attempt messages 默认历史隐藏但可通过 includeHidden、attempt detail 或 audit traceability view 读取。
  验证：运行 session history includeHidden/attempt detail tests。
  来源：`Retry Replaces Default History Visibility`；design Documentation Ownership。

## 4. Idempotency、SafeError 和 Boundary Integration

- [x] 4.1 实现 retry idempotency command handling，accepted outcome 只从 queued/scheduler accepted 后的 retry RequestRun acceptance anchor 推导；rejected decision 通过同一目标校验和 safe error 规则稳定重放；同 key 不同 command semantic 返回 safe conflict；不新增 retry command outcome store。
  验证：运行 1.7 retry idempotency tests。
  来源：`Retry Idempotency And Latest After Retry`；design D11。
- [x] 4.2 实现 retry SafeError mapping，覆盖 not latest、not found、forbidden、not terminal、terminal pending、attachment unavailable、queue unavailable、idempotency required、idempotency conflict 和 visibility unavailable。
  验证：运行 SafeError tests，断言 code/category/retryable/safeDetails 稳定，且不包含 raw provider/tool/model/storage/scheduler/attachment/hidden message/path/credential detail。
  来源：`Request Retry Safe Errors`；design D13。
- [x] 4.3 接入 Channel retry command，确保 Web/API 层向 Runtime 提供可信 identity 和 canonical idempotency 并调用 Runtime，成功时返回 `RequestAccepted`，失败时返回 retry-specific SafeError；本 change 不定义 public Web DTO 的 key 来源。
  验证：运行 channel command tests；code review 检查点：`agent-channel-web` 不引用 scheduler internals、terminal commit writer、SessionMessageStoreGateway 或 active context internals，Runtime 不从 client metadata、模型输出或 capability input 中回填 idempotency key。
  来源：`Owner-Scoped Latest Request Retry Command`；design D1、Documentation Ownership。
- [x] 4.4 接入 stream/status/history projection consumption，确保 retry accepted 不被投影为 terminal completion，terminal events 仍来自 Runtime terminal facts。
  验证：运行 stream/history projection tests。
  来源：`Retry Acceptance Queues New Attempt`、`Request Retry Cross-Capability Boundaries`；design D5、D6。

## 5. Verification 和 Boundary Checks

- [x] 5.1 运行 request retry 相关单元、contract、integration 和 resilience tests。
  验证：运行包含 request retry、runtime command、attachment revalidation、scheduler、session message visibility、active context、SafeError 和 stream/history projection 的测试集合。
  来源：proposal 影响范围；design Verification Map。
- [x] 5.2 运行 OpenSpec 严格校验。
  验证：`openspec validate add-ts-request-retry --strict`
  来源：proposal Baseline Promotion Plan；OpenSpec config tasks rule。
- [x] 5.3 做核心契约边界检查，确认本 change 未新增 `RunStatus`、`TimelineEventType`、`StreamEventType`、`RequestControlCommand` 字段或 retry 专属 gateway port，`retryLatest` 仍返回 `RequestAccepted`。
  验证：code review 检查点：diff 中无 core vocabulary/schema/port 新增；共享 RequestRun scope 基础来自 `add-ts-session-lane-scheduling`，retry 专属 `retryOfRunId`、`hideMessage` visibility metadata 和 source attachment revalidation refinements 由本 change 覆盖。
  来源：proposal 修改的 Capability；design Non-Goals、D1、风险与取舍。
- [x] 5.4 做目标语义一致性检查，确认 retry 流程覆盖 latest 校验、terminal committed 前置、same root retry run、`retryOfRunId`、scheduler success 后 retry RequestRun acceptance idempotency anchor、schedule 成功后 visibility replacement 和 queue failure terminalization；同时确认返回值按 core contracts 使用 `RequestAccepted`，不新增并行控制结果契约或 command outcome store。
  验证：code review 检查点：对照本 change 的 proposal/design/spec delta 与前置 runtime/core-contract changes，确认实现覆盖上述目标语义，并且未引入 private DTO、未绕过 scheduler/queue/visibility boundary。
  来源：design Context；proposal 影响范围；stable OpenSpec target-state rule。
- [x] 5.5 做 cross-change 对齐检查，确认本 change 复用 `add-ts-session-lane-scheduling` 的 queued/scheduler/terminal-pending 语义，复用 `add-ts-request-cancel` 的 request-control SafeError 风格，并与 stable `EditLatestRequestCommand` / future edit-resubmit capability 保持 retry/edit 边界分离。
  验证：code review 检查点：对照 session-lane/cancel active change，确认 retry 未实现 edit-resubmit、新 root USER message 或任意历史 request retry。
  来源：`Request Retry Cross-Capability Boundaries`；design D3、D6、D13。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/request-retry/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/architecture/runtime-boundaries.md`。
- 按需更新 `openspec/designs/architecture/request-run.md` 和 `openspec/designs/modules/agent-session.md`。
- 按需更新 `openspec/designs/architecture/core-contracts.md`。
- 按需更新 `openspec/designs/modules/agent-runtime.md`、`agent-session.md`、`agent-channel-web.md`、`agent-context-engine.md`。
- 按需新增或更新 `openspec/designs/adr/request-retry-replacement-attempt.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一 request retry 状态机、API schema、数据 owner 或接口语义。
