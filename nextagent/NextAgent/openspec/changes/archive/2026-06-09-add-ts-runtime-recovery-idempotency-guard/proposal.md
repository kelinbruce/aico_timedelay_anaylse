## 背景与问题（Why）

NextAgent TS 后端已经通过 `stable ts-backend-architecture` 和 `stable ts-core-contracts` 确定：`agent-runtime` 是 request lifecycle、scheduler、checkpoint recovery boundary、terminal commit 和 canonical timeline 的 owner。后续本地恢复能力会在进程重启后扫描 durable `RequestRun`、checkpoint、message、timeline 和 terminal facts，重建 queued/executing run 的执行位置。

当前缺口是：当恢复点位于 Tool 调用边界时，系统可能无法仅凭内存判断外部 Tool 是否已经产生副作用。如果 runtime 在 facts 不完整或 Tool 非幂等的情况下直接重新调用 Tool，电信网络配置、诊断动作、客户系统调用或工单类 side effect 可能被重复执行，造成比恢复失败更严重的生产风险。

本 change 处理完整恢复流程中的一个安全子问题：runtime recovery 准备重新调用 pending Tool 前，必须基于 checkpoint、persisted messages、capability result、timeline、terminal facts 和 capability replay policy 做对账。只有明确可安全重放的 Tool 才能重新调用；不能证明安全时，run 必须进入明确 recovery failed / safe error，而不是长期停留在 `EXECUTING` 或被归类为用户 cancel。

## 变更范围（What Changes）

- 新增 runtime recovery idempotency guard 行为契约：当恢复到 `BEFORE_CAPABILITY_INVOKE` 且 pending Tool 缺少已持久化 capability result 时，runtime 必须在调用 capability 前判断是否允许重放。
- 明确 guard 的输入事实：checkpoint trigger、checkpoint `lastSequence`/`runVersion`/`activeContextVersion`、当前 run 的 assistant tool-use message、capability result messages、timeline/terminal facts、`RequestRun` agent/version 和 capability descriptor replay policy。
- 明确已持久化 capability result 的优先级：如果 pending Tool 对应 result message 已存在且通过 checkpoint/message 对账，runtime 必须复用 result，不得重新调用 Tool。
- 明确可重放条件：只有 capability descriptor 暴露的 `CapabilityReplayPolicy` 为 `IDEMPOTENT`，且 runtime 可以为同一 run/tool invocation 重建或取得稳定 `idempotencyKey` 时，runtime 才可重新调用 Tool；该 stable key 属于 capability invocation / checkpoint replay 边界，不自动复用 submit、cancel、retry 或 edit request-control command 的 key。
- 明确 descriptor 的 `CapabilityReplayPolicy` 必须通过 capability catalog 按 `capabilityId` 解析；`AgentCapabilityBinding` 只承载绑定关系，不承载 replay policy 等 capability 元数据。Runtime recovery guard 不直接感知或解释 `capabilityBindings`，而是通过 catalog 获取 descriptor 后读取 replay policy。
- 明确 recovered Tool replay 使用与普通 capability invocation 同源的 stable capability invocation key helper；core 和 runtime 必须共用该 helper，guard 不在本地硬编码一套平行 key 派生规则。
- 明确失败语义：非幂等 Tool、缺稳定 `idempotencyKey`、缺必要 checkpoint、`CAPABILITY_AFTER_RETURN` 但 result 缺失、message/timeline/terminal facts 不一致，必须 terminalize 为 recovery failed / safe error；不得调用 Tool，不得长期保留 running/executing 状态，不得归类为用户 cancel。
- 明确 recovery failed 的稳定错误码：unsafe replay、缺稳定 key、capability descriptor 不可用、recovery facts/result 不一致必须映射到可测试的 safe error code，且不得泄露 `idempotencyKey` 原文或 Tool 参数/结果。
- 明确本 change 不定义最终 `idempotencyKey` 格式、不新增用户可见 API、不新增 stream event、不实现完整 local runtime recovery；完整恢复扫描、claim/fencing、scheduler rebuild 和 context reconstruction 属于 `add-ts-local-runtime-recovery`。
- 明确幂等声明契约以 `CapabilityReplayPolicy = "NON_IDEMPOTENT" | "IDEMPOTENT"` 为准；本 change 不使用 `isIdempotent` 布尔字段，也不让 runtime guard 依赖另一套等价 enum 或复杂声明对象。

## Capability 影响（Capabilities）

### 新增 Capability

- `runtime-recovery-idempotency-guard`: 定义 runtime recovery 在 pending Tool 重放前的 facts 对账、replay policy 判断、稳定 idempotency key 要求、失败收敛和跨模块边界。

### 修改的 Capability

- `ts-core-contracts` / `agent-assembly`：本 change 不新增用户可见 API、runtime command、stream event、timeline event 或 gateway port；`AgentCapabilityBinding` 继续只表达 agent assembly 的绑定关系，不新增 replay policy 元数据。Capability replay policy 由 capability descriptor 暴露，并由 capability catalog 按 accepted run 的 agent assembly 与 `capabilityId` 解析后提供给 Runtime recovery guard。共享 RequestRun scope 和 recovery scan/claim/checkpoint 语义分别由 `add-ts-session-lane-scheduling`、`add-ts-local-runtime-recovery` 承载；本 change 不在 guard 内新增 `isIdempotent` 等并行契约或 gateway refinement。

## 影响范围（Impact）

- `agent-runtime`：在 local runtime recovery 接管 executing run 并准备恢复 pending Tool 前执行 guard；负责 result 复用、replay eligibility 判断、recovery failed terminalization、safe error 和 observability 输出。
- `agent-core`：可以保留防御性校验，但不得拥有 recovery state machine；不得绕过 runtime guard 直接重放 recovered pending Tool。
- `agent-capability` / capability provider：通过 descriptor 暴露 `CapabilityReplayPolicy`，执行请求接收 runtime 提供的稳定 `idempotencyKey`；不从 arguments、模型输出或客户端 metadata 推导 owner/idempotency 语义。
- `agent-app` / assembly compiler：只固化 agent assembly 的 capability binding 关系，不把 descriptor replay policy 投影进 binding；Runtime recovery guard 通过 capability catalog 取得 descriptor replay policy，且不得绕过 catalog 访问 provider-private descriptor state。
- `agent-platform-gateway-*`：提供 checkpoint、run、message、timeline、terminal facts 的逻辑读写；gateway 不决定 Tool 是否可重放。
- `agent-session` / message store：保存 assistant tool-use message 和 capability result messages，供 runtime 恢复时重建 `ToolCallState`。
- `agent-observability`：记录稳定错误码、run/capability/toolCall 关联和脱敏诊断；至少支持 `RECOVERY_UNSAFE_CAPABILITY_REPLAY`、`RECOVERY_IDEMPOTENCY_KEY_UNAVAILABLE`、`RECOVERY_CAPABILITY_DESCRIPTOR_UNAVAILABLE` 和 `RECOVERY_CAPABILITY_RESULT_INCONSISTENT`；不得记录 raw arguments、raw result、prompt、模型输出、credential、path 或 `idempotencyKey` 原文。
- 测试：新增 runtime recovery guard characterization/contract tests，覆盖非幂等 pending Tool 不执行、幂等 Tool 带稳定 key 可重放、已有 result 复用、facts 不一致失败、多 Tool 部分完成和 safe error 脱敏。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：

- `openspec/specs/runtime-recovery-idempotency-guard/spec.md`：新增 runtime recovery pending Tool replay guard 的行为契约、失败语义和可观测边界。

长期背景：

- `openspec/overview.md`：补充 runtime recovery idempotency guard 对电信网络 side-effect 安全、可靠恢复和可诊断性的意义。

设计视图：

- `openspec/designs/architecture/runtime-recovery.md`：补充 local runtime recovery 流程中 pending Tool replay guard 的位置，以及 guard 与完整恢复主流程的关系。
- `openspec/designs/architecture/request-run.md`：补充 executing run 恢复到 pending Tool 时的 safe-fail 不变量、terminal failed 语义和非用户 cancel 分类。
- `openspec/designs/architecture/core-contracts.md`：归档时提炼 `CapabilityReplayPolicy`、`CapabilityInvocationRequest.idempotencyKey`、checkpoint facts 与 runtime recovery guard 的调用语义；不新增 `isIdempotent` 并行契约。
- `openspec/designs/modules/agent-runtime.md`：补充 runtime 拥有 replay eligibility decision、result reuse 和 recovery failed terminalization 的模块职责。
- `openspec/designs/modules/agent-core.md`：补充 core 只能执行 runtime 分配的恢复路径，可做防御性校验但不拥有 recovery lifecycle。
- `openspec/designs/modules/agent-capability.md`：补充 capability descriptor 暴露 `CapabilityReplayPolicy`，provider 不决定 runtime recovery eligibility。
- `openspec/designs/adr/runtime-recovery-tool-replay-policy.md`：记录选择 `CapabilityReplayPolicy` 而不是 `isIdempotent` 布尔字段、选择 safe fail 而不是重复非幂等 Tool 的长期取舍。
- `openspec/designs/spec-to-design-map.md`：新增 `runtime-recovery-idempotency-guard` 到 architecture/domain/contracts/modules/ADR/验证入口的导航。

验证入口：

- Runtime recovery guard characterization tests。
- Capability replay policy contract tests。
- Assembly replay policy projection tests。
- Stable capability invocation key helper contract tests。
- SafeError/redaction tests。
- Stable recovery error code snapshot/contract tests。
- Cross-change review against `add-ts-local-runtime-recovery`、stable `ts-core-contracts`、stable checkpoint/timeline store contracts and `add-ts-session-lane-scheduling`。
- 目标语义一致性检查，覆盖 recoverable run 恢复入口、checkpoint/result 对账、pending Tool replay guard、`CapabilityReplayPolicy`、stable `idempotencyKey`、safe failure terminalization 和 redaction。
- `openspec validate add-ts-runtime-recovery-idempotency-guard --strict`。
