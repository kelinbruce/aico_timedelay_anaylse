## 背景和现状（Context）

`stable ts-backend-architecture` 已经规定 `agent-runtime` 拥有 request lifecycle、scheduler、same-session lane、checkpoint recovery boundary、terminal commit 和 canonical timeline publication。`stable ts-core-contracts` 已经冻结 `CheckpointTriggerReason`、`CapabilityReplayPolicy`、`CapabilityInvocationRequest.idempotencyKey`、`CheckpointPayload`、`RequestRun`、gateway recovery ports 和 `SafeError` 的核心契约。

`add-ts-local-runtime-recovery` 是完整恢复主流程：本地进程重启后，runtime 扫描 queued/executing/terminal-pending run，执行 claim/fencing，读取 checkpoint、message、timeline、terminal facts，重建 scheduler work item 或恢复执行点。本 change 不替代该主流程，而是在主流程恢复到 pending Tool 边界时提供一条硬安全门。

目标语义已经由 core contracts 和 recovery changes 固化：local runtime recovery 扫描 queued/executing/terminal pending run；checkpoint contract 在 Tool 外部调用前后记录可恢复边界，并基于 messages 校验恢复点；pending Tool replay guard 在 recovered flow 中拒绝非幂等 Tool 重放；capability descriptor 和 executor 默认 replay policy 为 `NON_IDEMPOTENT`。目标契约以 core contracts 的 `CapabilityReplayPolicy` 和 gateway `*Record` 边界为准，且 `RequestContext` 不保存 attempt/deadline/messageRefs。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 定义 runtime recovery 在 pending Tool 调用前的 replay guard。
- 定义 guard 基于 durable facts 对账，而不是基于内存状态或客户端输入。
- 定义已有 capability result 必须复用，不得重复调用 Tool。
- 定义仅 `CapabilityReplayPolicy=IDEMPOTENT` 且稳定 `idempotencyKey` 可用时允许重放。
- 定义 unsafe replay、facts 不一致或 key 不可用时进入 recovery failed / safe error，并收敛为 terminal failed。
- 定义多 Tool 批次逐个对账，任一 required pending Tool 不安全则整个 run 失败。
- 定义错误诊断脱敏边界。
- 明确 stable core/capability contracts 必须对齐 `CapabilityReplayPolicy`，不得让本 change 使用 `isIdempotent`。

**非目标：**

- 不实现完整 local runtime recovery；扫描、claim/fencing、scheduler rebuild、context reconstruction 属于 `add-ts-local-runtime-recovery`。
- 不新增 runtime command、Web API、stream event、timeline event type、gateway port 或 public user action。
- 不定义最终 `idempotencyKey` 字符串格式、有效期或 provider-specific key 规则；这些归 stable capability idempotency contract，本 change 只消费该语义。
- 不定义 DB schema、索引、文件布局或 remote gateway endpoint。
- 不改变普通 Agent loop 的首次 Tool 调用语义。
- 不支持在 facts 不完整时跳过 Tool 继续模型调用或 terminal commit。

## 设计决策（Decisions）

### D1: Guard 由 Runtime 拥有，挂在完整恢复主流程的 capability replay 前

选定方案：`add-ts-local-runtime-recovery` 接管 executing run 并重建执行点后，如果 `nextLifecycleStage=BEFORE_CAPABILITY_INVOKE`，Runtime 在调用 capability 前执行 replay guard。core/capability 可以保留防御性校验，但不能拥有 recovery decision 或绕过 runtime guard。

理由：runtime 是 request lifecycle、checkpoint recovery 和 terminal commit owner；gateway 只提供 durable facts，core/capability 只执行 runtime 分配的恢复路径。把 guard 放到 runtime 可以同时看到 run、checkpoint、message、timeline、terminal 和 lane 状态。

拒绝方案：让 capability provider 自己决定是否接受 recovered replay。拒绝原因是 provider 看不到完整 RequestRun/checkpoint/terminal facts，无法判断是否应该复用 result、失败收敛或释放 lane。

### D2: Replay 判断使用 `CapabilityReplayPolicy`，不使用 `isIdempotent`

选定方案：Capability descriptor 是 `CapabilityReplayPolicy` 的源头；`AgentCapabilityBinding` 只承载绑定关系，不承载 replay policy 等 capability 元数据。Runtime recovery guard 通过 capability catalog 按 accepted run 的 agent assembly 与 `capabilityId` 解析 descriptor，并从 descriptor 读取 replay policy。Runtime 不直接感知或解释 `capabilityBindings`，binding 解释属于 capability/catalog 模块。`IDEMPOTENT` 表示可在稳定 idempotency key 下恢复重放；`NON_IDEMPOTENT`、缺失 descriptor、缺失 policy 或不可判定均视为不可重放。实施前必须确认 stable core/capability contracts 中没有残留的 `isIdempotent` 表述作为 runtime guard 判断依据。

理由：stable core contracts 已经把 `CapabilityReplayPolicy` 定义为跨 runtime、capability 和 recovery 共享的 enum。布尔 `isIdempotent` 会引入并行契约，导致 runtime guard 到底读哪个字段不确定。Binding 只描述 agent 与 capability/provider 的绑定关系；descriptor 元数据由 capability catalog 统一发现和解析。让 runtime 通过 catalog 读取 descriptor policy，既避免 runtime 解释 binding，又避免把 capability 元数据复制进 assembly binding。

拒绝方案：本 change 内部兼容 `isIdempotent` 和 `CapabilityReplayPolicy` 两套字段。拒绝原因是它会把漂移固化到实现中，并让未来 capability contract 演进更难审查。

### D3: Stable idempotency key 由依赖 contract 提供，本 change 只消费

选定方案：guard 要求恢复重放时必须拿到同一 recovered Tool invocation 的稳定 `idempotencyKey`，并把该 key 放入 `CapabilityInvocationRequest.idempotencyKey`。普通 Tool 调用和 recovered Tool replay 必须共用 capability invocation stable key helper；本 change 不把字符串格式暴露为 recovery guard contract，只要求 helper 由同一 run/tool invocation identity 派生稳定 key。

理由：key 派生 owner 属于 capability invocation contract，guard 只需要一个安全前置条件。如果 runtime recovery 和 normal core tool loop 各自硬编码 key 字符串，会造成多个 change 同时定义相同契约。目标语义通过 `CapabilityReplayPolicy=IDEMPOTENT`、recovered tool invocation identity 和 stable `idempotencyKey` 共同阻止明显不安全的重放。`stable ts-core-contracts` 已经把 `CapabilityInvocationRequest.idempotencyKey`、checkpoint payload 和 recovery replay 判断绑定在一起：runtime 只有同时知道 Tool 可重放且同一外部操作可用同一 key 去重，才能证明重新调用不会扩大副作用。

边界说明：这里的 stable `idempotencyKey` 是 capability invocation / recovery checkpoint 边界的 key，不自动等同于 submit、cancel、retry 或 edit request-control command 的 `idempotencyKey`。Runtime 只有在 capability idempotency contract 已经为同一 Tool invocation 明确派生并持久化该 key 时，才可在 recovery replay 中使用；否则必须走 `RECOVERY_IDEMPOTENCY_KEY_UNAVAILABLE`。

拒绝方案：把某个具体实现的 `runId:invocationId` 固定为 TS key 格式。拒绝原因是 TS 应以 OpenSpec contract 为准；最终格式需要由 stable capability idempotency contract 或后续 contract refinement 统一定义和脱敏。

拒绝方案：直接复用原始用户 submit/cancel/retry/edit command 的 `idempotencyKey` 作为 Tool replay key。拒绝原因是 request-control key 只标识用户动作去重，不能证明某个外部 Tool side effect 的同一 invocation 重放安全。

### D4: Durable result 优先于 replay

选定方案：recovery 先从 persisted assistant tool-use message 和 capability result messages 重建 ToolCallState。已有 result 且通过 checkpoint/message/timeline 对账时，Runtime 复用 result，不进入 replay 调用。只有缺 result 的 pending Tool 才进入 replay guard。

理由：durable message/result 是恢复事实源。重复调用已经有结果的 Tool 会破坏 side-effect safety，也会让 result/history/timeline 出现重复事实。

拒绝方案：只要 checkpoint 在 Tool 前就重放 Tool。拒绝原因是 checkpoint 只表达恢复边界，不代表 result 未持久化；必须先对账 current messages 和 terminal facts。

### D5: Facts 不一致和 unsafe replay 都收敛为 recovery failed terminal

选定方案：缺 checkpoint、`CAPABILITY_AFTER_RETURN` 但缺 result、checkpoint sequence 不覆盖当前 messages、terminal facts 与 run 状态不一致且不能 reconcile、非幂等 pending Tool、缺稳定 key，均由 Runtime terminalize 为 recovery failed / safe error。该结果不是用户 cancel，不新增用户 stream event type。

边界说明：guard 负责输出 replay eligibility / unsafe replay decision 和稳定 safe error code；完整 local recovery 主流程负责把该 decision 消费到 terminal commit boundary、lane release gating 和 recoverable run 收敛。也就是说，本 change 不实现 recovery scanner、claim/fencing 或完整 terminal takeover，只定义 pending Tool replay 失败必须交给 Runtime 的 recovery failed terminal path。

理由：系统无法证明恢复安全时，重复执行 Tool 的风险高于显式失败。terminal failed 可以释放 same-session lane，read model 和运维诊断也能看到确定结果。

拒绝方案：保持 run 为 `EXECUTING` 等待人工处理。拒绝原因是它会阻塞同 session 后续请求，并让 recovery 重启后反复卡住。

### D6: Terminal pending/retrying 不走 Tool replay guard

选定方案：当 recovery 发现 terminal message/event 或 terminal commit state 为 pending/retrying 时，完整恢复主流程执行 terminal reconcile 或 terminal takeover；guard 只服务 pending Tool replay。

理由：terminal takeover 的问题是 terminal commit 幂等重试，不是 Tool side-effect 重放。把两者混在一个 guard 中会扩大职责边界。

拒绝方案：把所有 recovery unsafe case 都放入 Tool replay guard。拒绝原因是 queued rebuild、terminal takeover、before model replay 和 Tool replay 的事实源与失败语义不同。

### D7: 多 Tool 批次逐个对账，但 run 作为整体失败

选定方案：Runtime 对同一 assistant tool-use message 中的每个 Tool 独立重建状态。已完成的复用 result；pending 且缺 result 的逐个 guard。任一 required pending Tool 不满足 replay 条件，整个 run recovery failed。

理由：模型下一步需要完整工具批次结果。跳过某个 Tool 继续生成回答会制造缺失事实下的 terminal answer。

拒绝方案：只失败单个 Tool 并让模型继续。拒绝原因是当前 core contract 没有定义“恢复时局部工具失败继续”的可验证语义，也无法保证业务安全。

### D8: 诊断保留定位信息但必须脱敏

选定方案：日志、metric、trace、audit 和 safe error 可以记录稳定错误码、runId、capabilityId、toolCallId、recovery stage；不得记录 raw arguments、raw result、prompt、模型输出、credential、local path 或 `idempotencyKey` 原文。

理由：恢复失败需要运维可诊断，但电信场景下 Tool 参数和 result 可能包含网络拓扑、客户系统信息或凭据引用，必须按 safe error/redaction 边界处理。

拒绝方案：把 Tool 参数写入 error details 便于排障。拒绝原因是它会突破安全和审计边界。

### D9: Recovery failed 必须使用稳定错误码清单

选定方案：Runtime guard 拒绝重放或发现 facts 不一致时，safe error code MUST 从下列最小集合中选择：`RECOVERY_UNSAFE_CAPABILITY_REPLAY`、`RECOVERY_IDEMPOTENCY_KEY_UNAVAILABLE`、`RECOVERY_CAPABILITY_DESCRIPTOR_UNAVAILABLE`、`RECOVERY_CAPABILITY_RESULT_INCONSISTENT`。其中 `RECOVERY_UNSAFE_CAPABILITY_REPLAY` 覆盖 `NON_IDEMPOTENT` 或 policy 不可判定；`RECOVERY_IDEMPOTENCY_KEY_UNAVAILABLE` 覆盖 `IDEMPOTENT` 但同一 invocation 的 stable key 不可取得；`RECOVERY_CAPABILITY_DESCRIPTOR_UNAVAILABLE` 覆盖 catalog 无法解析 recovered Tool 对应 descriptor 或 replay policy 来源；`RECOVERY_CAPABILITY_RESULT_INCONSISTENT` 覆盖 checkpoint/message/result/timeline/terminal facts 缺失或互相矛盾，包含 `CAPABILITY_AFTER_RETURN` 但缺 result。

理由：如果只说“safe error”，后续 runtime、core、observability 和测试可能各自发明错误码，导致恢复失败无法稳定断言，也无法在运维侧区分“不能重放”“缺 key”“descriptor 不可用”和“事实不一致”。稳定错误码不新增用户 stream event 或 RuntimeCommand，只是把已确认的失败类别变成可测试、可审计的诊断契约。

拒绝方案：只保留一个通用 `RECOVERY_FAILED` 错误码。拒绝原因是它虽然简单，但会抹平关键恢复原因，导致架构评审和实现测试都无法验证 guard 是否真的按 replay policy、stable key 和 durable facts 分流。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | owner/identity 仍来自 runtime/channel 可信边界；guard 不读取客户端 metadata、模型输出或 Tool arguments 来决定 replay；诊断不泄露 raw arguments/result/key。 | SafeError/redaction tests；code review 检查 runtime guard 不消费不可信 replay flag。 |
| 性能/容量 | guard 只在 recovery pending Tool 边界运行；普通 Tool 调用不增加 replay 检查。恢复时读取当前 run 相关 checkpoint/messages/results/timeline facts，不做全局扫描。 | runtime recovery unit tests；code review 检查查询按 sessionId/requestId/runId 限定。 |
| 可靠性/恢复 | 非幂等或不可判定时 fail closed；已有 result 复用；unsafe recovery terminal failed；terminal pending/retrying 交给 terminal takeover。 | recovery guard characterization tests；terminal failed/lane release tests；cross-check with local runtime recovery。 |
| 可维护性 | guard 是 runtime 内聚决策；capability contract 只暴露 `CapabilityReplayPolicy` 和 idempotency key；不新增并行 `isIdempotent`。 | architecture/lint review；cross-change review against capability idempotency contract。 |
| 可测试性 | 通过 fake checkpoint/message/result/capability descriptor 构造 deterministic recovery cases；negative case 必须断言 capability 未被调用。 | Vitest/contract tests for guard matrix；negative tests for non-idempotent/missing-key cases。 |
| 审计/可追溯性 | recovery failed 使用稳定错误码和 terminal outcome，可通过 runId/toolCallId/capabilityId 定位；错误码区分 unsafe replay、缺 key、descriptor 不可用和 facts/result 不一致；不新增用户 stream event type。 | observability tests；terminal timeline/read model tests；safe detail snapshot tests。 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| Recovered pending Tool 调用前必须 guard | 1.1, 2.1 | runtime recovery guard tests，断言 capability executor 未在 guard 前调用 |
| 普通首次 Tool 调用不受 guard 影响 | 1.2, 2.1 | normal capability invocation regression tests |
| 已持久化 result 必须复用 | 1.3, 2.2 | existing-result recovery test，断言不重复调用 capability |
| `CAPABILITY_AFTER_RETURN` 但缺 result 必须 recovery failed | 1.4, 2.3 | inconsistent facts negative test |
| 只有 `IDEMPOTENT + stable idempotencyKey` 可 replay | 1.5, 2.4 | replay policy/key matrix tests |
| 非幂等、unknown descriptor、缺 key 不调用 Tool | 1.6, 2.4 | negative tests，断言 executor call count 为 0 |
| unsafe replay terminal failed，不是 cancel，不长期 executing | 1.7, 2.5 | terminalization/lane release tests |
| 多 Tool 批次逐个对账，任一 unsafe 则 run failed | 1.8, 2.6 | mixed tool batch recovery tests |
| 诊断脱敏，不记录 raw args/result/key | 1.9, 2.7 | safe error/redaction tests |
| recovery failed 使用稳定错误码清单 | 1.5, 1.6, 1.7, 1.9, 2.3, 2.4, 2.7 | stable error code snapshot/contract tests |
| 幂等契约对齐 `CapabilityReplayPolicy`，不用 `isIdempotent` | 3.1, 4.3 | OpenSpec cross-change review；rg 检查 stable core/capability contracts |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/runtime-recovery-idempotency-guard/spec.md` 主承载 replay guard、result reuse、safe fail、多 Tool 对账和诊断脱敏的可验证行为。
- 跨模块架构：`openspec/designs/architecture/runtime-recovery.md` 主承载完整 local recovery 流程中 guard 的位置，以及与 scheduler、checkpoint、terminal takeover 的关系。
- 领域模型/状态机：`openspec/designs/architecture/request-run.md` 主承载 recovery failed terminal state、非用户 cancel 分类和 lane release 不变量。
- API/SPI/event/schema：`openspec/designs/architecture/core-contracts.md` 主承载 `CapabilityReplayPolicy`、`CapabilityInvocationRequest.idempotencyKey`、checkpoint facts 和 gateway recovery request/record 语义。
- 模块职责：`openspec/designs/modules/agent-runtime.md`、`agent-core.md`、`agent-capability.md` 主承载 runtime/core/capability 的职责划分。
- ADR：`openspec/designs/adr/runtime-recovery-tool-replay-policy.md` 主承载选择 `CapabilityReplayPolicy` 和 fail-closed 的长期取舍。
- 导航：`openspec/designs/spec-to-design-map.md` 增加本 spec 到 architecture/domain/contracts/modules/ADR/验证入口的链接。

## 风险与取舍（Risks / Trade-offs）

- [capability idempotency contract 漂移] -> 实施前提出 contract refinement，统一使用 `CapabilityReplayPolicy`，不得保留 `isIdempotent` 作为 guard 判断依据。
- [过度失败导致可恢复请求变成 failed] -> 只在缺 result 且无法证明 Tool replay 安全时 fail closed；已有 result、terminal pending 和 before model replay 均不受该失败路径影响。
- [guard 不可用被误解为可继续重放] -> guard descriptor、stable key 或 policy 缺失时必须 fail closed，不能把 guard 不可用降级为允许 `NON_IDEMPOTENT` 或缺 key Tool replay。
- [RequestContext 字段边界被扩大] -> 以 OpenSpec core contracts 为准；设计中明确 `RequestContext` 不保存 messageRefs/attempt/deadline。
- [诊断不足影响排障] -> 保留稳定错误码、runId、capabilityId、toolCallId、stage，并把 unsafe replay、缺 stable key、descriptor 不可用、facts/result 不一致拆成可测试 code；同时禁止 raw arguments/result/key。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/runtime-recovery-idempotency-guard/spec.md`：提炼本 change 的 ADDED requirements。
- `openspec/overview.md`：提炼 side-effect recovery safety 对电信网络智能体的长期意义。
- `openspec/designs/architecture/runtime-recovery.md`：提炼 queued/executing/terminal recovery 主流程中 guard 的位置。
- `openspec/designs/architecture/request-run.md`：提炼 recovery failed terminal state、不归类为 cancel、lane release 不变量。
- `openspec/designs/architecture/core-contracts.md`：提炼 `CapabilityReplayPolicy`、stable `idempotencyKey` 和 checkpoint/message facts 对 replay guard 的调用语义。
- `openspec/designs/modules/agent-runtime.md`：提炼 runtime guard owner、result reuse 和 terminal failed 收敛职责。
- `openspec/designs/modules/agent-core.md`：提炼 core 防御性校验边界。
- `openspec/designs/modules/agent-capability.md`：提炼 capability descriptor replay policy 暴露职责。
- `openspec/designs/adr/runtime-recovery-tool-replay-policy.md`：记录 fail-closed 和 `CapabilityReplayPolicy` 取舍。
- `openspec/designs/spec-to-design-map.md`：增加本 spec 的长期导航。

## 待确认问题（Open Questions）

无。已确认：不用 `isIdempotent`，统一使用 `CapabilityReplayPolicy`；unsafe replay 必须 terminal failed / safe error。
