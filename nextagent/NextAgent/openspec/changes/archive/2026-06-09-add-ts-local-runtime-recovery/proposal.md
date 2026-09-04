## 背景与问题（Why）

NextAgent TS 后端已经通过 `stable ts-backend-architecture` 和 `stable ts-core-contracts` 确定：`agent-runtime` 拥有 request lifecycle、scheduler、same-session lane、checkpoint、terminal commit 和 canonical timeline；Gateway 只提供 agent+owner-scoped durable facts，不解释恢复决策。

前置 changes 已经把 submit 入队、same-session lane scheduling、request cancel/retry、capability replay policy 和 pending Tool replay guard 分别拆开。现在剩下的缺口是：本地单实例进程重启后，进程内 scheduler queue、active execution handle 和 lane 内存状态会丢失，但 durable `RequestRun`、checkpoint、message、timeline 和 terminal commit facts 仍然存在。如果 runtime 不在启动时恢复这些事实，queued run 会永远不执行，executing run 会长期停留在 `EXECUTING`，terminal pending run 可能无法完成提交，后续同会话请求也会被错误阻塞或乱序执行。

本 change 处理完整的本地 runtime recovery 主流程：进程重启后，Runtime 在 scheduler dispatch 前扫描可恢复 run，重建 queued work item，按 checkpoint 和持久化消息恢复 executing run，优先接管 terminal pending/retrying 或 partial terminal facts；无法证明安全恢复时，必须显式 terminalize 为 recovery failed / safe error，而不是盲目重放 Tool、fallback 到最新 Agent 版本、长期保留 active 状态或归类为用户 cancel。

## 变更范围（What Changes）

- 新增 local runtime recovery 行为契约：本地单实例 runtime 启动后必须执行一次 bounded recovery pass，并在完成前阻止 scheduler dispatch 新 work。
- 定义 recoverable facts：Runtime 通过 gateway contract 扫描 durable `RequestRun`，覆盖 `QUEUED`、`EXECUTING` 和 `terminalCommitState=PENDING|RETRYING` 的 run；已 terminal committed 的 run 直接跳过。
- 定义 `QUEUED` 恢复：Runtime 校验 agent+owner-scoped facts、消息、assembly 和 lane 状态后，只重建 scheduler work item；真正执行仍由 scheduler 后续 claim/dispatch。
- 定义 `EXECUTING` 恢复：Runtime 先处理 terminal facts，再通过 claim/fencing 接管；接管成功后按 checkpoint、persisted messages、timeline sequence、active context version、flowVariables 和 run version 重建 `RequestContext`。
- 定义恢复执行点：`BEFORE_MODEL_INVOKE` 可重新发起模型调用；`BEFORE_CAPABILITY_INVOKE` 必须先复用已持久化 result 或调用 `add-ts-runtime-recovery-idempotency-guard`；`BEFORE_TERMINAL_EVENT` 进入 terminal commit takeover/retry。
- 定义 terminal 恢复：terminal commit pending/retrying 必须幂等 takeover；若 terminal message/event 已持久化但 `RequestRun` 未稳定终态，Runtime 必须 reconcile run terminal，不得重复写 message/event。
- 定义 accepted-before-queued 边界：如果实现中存在持久化 `ACCEPTED` 且尚未 queued 的短暂窗口，Runtime 必须把它作为 pre-queue repair 修复到 queued 或 terminal failed；如果实现保证 accept->queued 原子写入，则 `ACCEPTED` recovery 是 non-goal 且必须通过实现说明固定。
- 定义 assembly 冻结：恢复已接受请求时必须使用 `AgentAssemblyRegistry.require(run.agentId, run.agentVersion)`，不得调用 `active(agentId)` fallback 到当前 active version。
- 定义失败收敛：缺 assembly、缺必要 checkpoint、缺 current request messages、checkpoint/messages/timeline/terminal facts 不一致、claim 冲突后无法继续、Tool replay guard 拒绝等情况，必须进入 recovery failed / safe error，并走 terminal commit 边界。
- 定义本地边界：本 change 只做 local single-instance restart recovery，不实现 PaaS 多实例 shared state、lock/lease、worker registry、non-sticky routing、后台轮询恢复或远端 gateway endpoint。
- 定义跨模块边界：Runtime 拥有恢复流程；Gateway 提供 facts/CAS/terminal commit；Session/Context/Capability/Core 只按各自 contract 提供消息、active context、capability replay policy 和执行能力，不拥有 recovery state machine。

## Capability 影响（Capabilities）

### 新增 Capability

- `local-runtime-recovery`: 定义本地单实例 runtime 重启后的 recoverable run 扫描、queued scheduler rebuild、executing checkpoint/message/timeline 恢复、terminal takeover/reconcile、claim/fencing、安全失败、错误码和跨模块边界。

### 修改的 Capability

- `ts-core-contracts` / `agent-contracts/gateway`：本 change 不新增 public command、Web API、stream event、timeline event、RunStatus 或 gateway port；但承接 local recovery 专属的 recoverable scan、claim/fencing、checkpoint load 和 terminal takeover 调用语义。共享 RequestRun agent+owner scope 基础由 `add-ts-session-lane-scheduling` 承载，pending Tool replay policy 由 `add-ts-runtime-recovery-idempotency-guard` 承载，本 change 不重复定义这两类基础。

## 影响范围（Impact）

- `agent-runtime`：新增启动恢复 orchestrator、recoverable run scan、scheduler rebuild、executing claim/takeover、RequestContext reconstruction、terminal reconcile/takeover、safe failure terminalization 和恢复期 dispatch gating。
- `agent-platform-gateway-local`：实现或补齐 agent+owner-scoped recoverable run list、claim/fencing、checkpoint load、terminal commit idempotency 和 current request facts 查询所需的 local adapter 行为；不把 SQLite/Kysely schema 泄漏给 Runtime。
- `agent-session` / message store：提供 current request/run messages、assistant tool-use metadata、capability result messages、hidden/default history facts，供 Runtime 恢复对账；不决定恢复是否合法。
- `agent-context-engine` / active context store：提供 active context version/view 事实；只有继续模型执行时才作为上下文选择 authority，terminal reconcile/takeover 不依赖 active context。
- `agent-capability` / `agent-core`：执行 Runtime 恢复后分配的路径；pending Tool replay safety 继续由 `runtime-recovery-idempotency-guard` 和 `CapabilityReplayPolicy` 约束。
- `agent-observability`：输出稳定、脱敏的 recovery diagnostic，包含 run/stage/error code 等定位信息，不泄露 prompt、模型输出、raw Tool arguments/result、credential、local path、storage key 或 raw idempotency key。
- 测试：新增 runtime recovery characterization/contract tests，覆盖 startup gating、queued rebuild、executing claim、checkpoint/message mismatch、missing assembly、pending Tool guard handoff、terminal takeover、partial terminal reconcile、same-lane ordering、bounded batch 和 safe error redaction。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：

- `openspec/specs/local-runtime-recovery/spec.md`：新增本地 runtime recovery 的 recoverable facts、queued rebuild、executing recovery、terminal takeover、安全失败和诊断边界。

长期背景：

- `openspec/overview.md`：补充本地单实例重启恢复对电信网络长任务可靠性、终态一致性和运维可诊断性的意义。

设计视图：

- `openspec/designs/architecture/runtime-recovery.md`：补充本地启动恢复流程、scheduler dispatch gating、Gateway facts 边界、local/PaaS 分层和质量属性。
- `openspec/designs/architecture/request-run.md`：补充 recoverable run、queued rebuild、executing takeover、terminal pending、recovery failed terminal outcome 和 lane release 不变量。
- `openspec/designs/architecture/core-contracts.md`：提炼 recovery 对 `listRecoverableRuns`、`claimRun`、`commitTerminal`、checkpoint、RequestContext 和 capability replay policy 的调用语义；不新增并行 enum。
- `openspec/designs/modules/agent-runtime.md`：补充 Runtime recovery owner、scheduler rebuild、claim/takeover、terminal reconcile 和 safe failure 职责。
- `openspec/designs/modules/agent-platform-gateway-local.md`：补充 local gateway 只提供 durable facts、CAS result 和 terminal commit idempotency 的职责。
- `openspec/designs/modules/agent-session.md`：补充 current request/run messages 和 history facts 供 recovery 消费的职责。
- `openspec/designs/adr/local-runtime-recovery-startup-gate.md`：记录选择本地启动 bounded recovery pass，而不是后台持续轮询、PaaS lock/lease 或一律 fail/cancel active run 的取舍。
- `openspec/designs/spec-to-design-map.md`：新增 `local-runtime-recovery` 到 architecture/domain/contracts/modules/ADR/验证入口的导航。

验证入口：

- `local-runtime-recovery` spec scenarios。
- Runtime startup recovery characterization tests。
- Gateway local recovery contract tests for recoverable list、claim/fencing、checkpoint load and terminal commit result。
- Scheduler rebuild and same-lane ordering tests。
- Terminal takeover/reconcile and duplicate-message/event prevention tests。
- Pending Tool guard handoff tests against `runtime-recovery-idempotency-guard`。
- SafeError/redaction tests and stable recovery error code tests。
- 目标语义一致性检查，覆盖 recoverable run scan、queued rebuild、executing claim/reconstruction、terminal takeover/reconcile、pending Tool guard handoff、recovery failed terminalization 和 redaction。
- `openspec validate add-ts-local-runtime-recovery --strict`。
