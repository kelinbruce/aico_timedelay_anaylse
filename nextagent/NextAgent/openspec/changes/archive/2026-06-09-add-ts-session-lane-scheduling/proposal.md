## 背景与问题（Why）

NextAgent TS 后端已经在前置架构和核心契约中确定：`agent-runtime` 是 request lifecycle 的唯一 owner，必须负责 request submit、scheduling、same-session lane policy、latest-request handling、terminal commit 和 canonical timeline publication。

架构评审后，本 change 明确采用“submit 入队，scheduler 调度执行”的流程：用户消息提交后，Runtime 创建并持久化 `RequestRun`，将其置为 `QUEUED`，再交给 Runtime scheduler。same-session lane policy 的核心不是在 submit 前阻止创建 run，而是在 scheduler dispatch、request control 和 recovery 时，基于 agent+owner-scoped durable facts 判断哪些 queued run 可以开始执行、哪些 terminal-pending run 必须先收敛、哪些 latest/control 操作是合法的。

当前缺口是：

- 同一 `tenantId + subjectId + agentId + sessionId` lane 内可以存在 queued run 和 executing run，但缺少稳定契约描述 submit、queue、dispatch、terminal commit 的职责分层。
- 系统里会同时出现 durable `RequestRun.status=QUEUED`、Runtime scheduler pending queue 和 lane snapshot view；必须明确只有 durable RequestRun facts 是权威状态账本，scheduler queue 只是可重建的执行调度结构，snapshot 只是读取视图。
- Runtime 需要通过 public gateway contract 读取某个 agent+owner-scoped session lane 的 queued/executing/latest/terminal-pending facts；现有 `RequestRunStoreGateway` 只有按 `runId` 读取、按 status 全局扫描和 terminal commit 状态扫描，容易导致 Runtime 依赖进程内 queue、adapter-private query 或 Session/Channel 私有判断。
- terminal commit pending/retrying 时，下一个同 lane queued run 不能提前开始会写 terminal/history 的执行阶段，否则会破坏终态唯一性、stream/history 一致性和恢复语义。
- “submit 入队”和“latest-submit replacement”必须同时成立：新请求先成为 durable queued run，再由 Runtime 对同 lane 旧未完成请求执行 supersession；replacement 不得绕过 scheduler、terminal commit 或 agent+owner scope。

本 change 现在处理这些问题，是为了给后续 `add-ts-request-cancel`、`add-ts-request-retry`、future edit-resubmit capability 和 `add-ts-local-runtime-recovery` 提供统一的 queued scheduling、latest-request replacement 和 terminal-pending 判断基础。

## 变更范围（What Changes）

- 新增同会话 lane scheduling 行为契约：一条 lane 由 `tenantId + subjectId + agentId + sessionId` 标识。
- 定义普通 submit 流程：Runtime 校验 command 后创建 `RequestRun`，持久化为 `ACCEPTED`/`QUEUED`，并交给 Runtime scheduler；`RequestAccepted` 表示已受理并排队，不表示已经开始 Agent execution。
- 定义 RequestRun idempotency anchor 前置条件和查询边界：Runtime command boundary 必须收到非空 canonical `idempotencyKey`；同 key 同 command semantic 返回原始或等价 accepted outcome，同 key 不同 command semantic 返回 safe conflict；retry 使用新 retry `RequestRun` 的 acceptance anchor，cancel 使用目标 run 的 terminal commit anchor；不得新增独立 command outcome fact、store 或 `RuntimeControlCommandOutcomeRecord`；public Web DTO 的 key 来源留给 Channel/Web 边界定义。
- 定义 scheduler dispatch 规则：同一 agent+owner-scoped session lane 默认串行 dispatch；首版同一 lane 同时最多一个 `EXECUTING` run，不同 lane 可在全局容量限制内并发。
- 定义 queued facts：同一 lane 可以有 queued runs；queued 状态通过既有 `RunStatus=QUEUED` 表达，不新增 `RunStatus`、`TimelineEventType` 或 `StreamEventType`。
- 定义 queue authority：durable `RequestRun` facts 是排队、执行和 terminal-pending 判断的权威来源；scheduler pending queue 可由 durable facts 恢复或校正；`SessionLaneSnapshot` 是 read model，不是第二套队列。
- 定义 terminal-pending 保护：当同一 lane 存在 `terminalCommitState=PENDING|RETRYING` 的 run 时，新的 same-lane submit 可以入队为 `QUEUED`，但 scheduler 不得启动会写 terminal/history 的后续执行，直到旧 terminal commit 达到稳定结果。
- 新增核心契约 refinement：`RequestRunStoreGateway.loadSessionLaneSnapshot(query)`，用于 Runtime scheduler、control command 和 recovery 读取 agent+owner-scoped session lane durable facts。Gateway 只返回 gateway-owned facts/read model，不做 start、queue、supersede、reject 等调度决策。
- 明确 RequestRun gateway 主路径 scope 基础：scheduler、request control、retry、local recovery 共享的 run lookup、claim、terminal commit、acceptance idempotency anchor 和 terminal commit idempotency anchor lookup 必须携带可信 agent+owner scope；具体 cancel/retry/recovery 行为在各自 change 中定义，不重复定义基础 scope。
- 定义 latest-submit replacement policy：同一 agent+owner-scoped lane 的后续普通 submit 先 accepted/queued，再让 Runtime 将 older queued work terminal commit 为 `SUPERSEDED`，并向 older executing work 发出 supersession signal；新 run 必须等旧 run 到达安全边界并完成 terminal commit/lane release 后才可 dispatch。
- 明确不实现公平调度、复杂队列 UI、PaaS 多实例 lock/lease/shared state、完整 retry/edit/recovery/idempotency guard 或数据库 schema 细节。

## Capability 影响（Capabilities）

### 新增 Capability

- `session-lane-scheduling`: 定义同一 agent+owner-scoped session lane 内 request/run 的 queued scheduling、latest-submit replacement、默认串行 dispatch、terminal-pending 保护、queue authority、latest/control fact 读取和跨 session 并发边界。

### 修改的 Capability

- `ts-core-contracts`: 扩展 `RequestRunStoreGateway`，新增 agent+owner-scoped session lane snapshot 查询契约和 RequestRun idempotency anchor lookup，并固定 RequestRun 主路径 lookup、claim、terminal commit、acceptance idempotency anchor 和 terminal commit idempotency anchor 的 agent+owner-scoped gateway contract 基础，供 Runtime scheduler、control command 和 recovery 读取或推进 gateway-owned RequestRun facts。

## 影响范围（Impact）

- `agent-runtime`：新增 same-session queued scheduling、latest-submit replacement、scheduler dispatch 前 lane fact 判断、terminal-pending dispatch protection 和 SafeError 分支。
- `agent-runtime`：在 submit command handling 中消费 canonical `idempotencyKey`，处理同 key重放和同 key不同 command semantic 冲突；不决定 public Web DTO 的 key 来源。
- `agent-contracts/gateway`：新增 `SessionLaneSnapshotQuery`、`SessionLaneSnapshot`、`RequestRunStoreGateway.loadSessionLaneSnapshot` 和 `RequestRunStoreGateway.loadRunByIdempotencyKey`；补齐 RequestRun 主路径 lookup、claim、terminal commit、acceptance idempotency anchor 和 terminal commit idempotency anchor lookup 的可信 agent+owner scope 要求。
- `agent-platform-gateway-local`：实现 agent+owner-scoped lane snapshot 查询，不向 Runtime 泄漏本地数据库 schema 或 adapter-private query。
- `agent-channel-web`：继续只调用 Runtime command boundary；stream/status/history 只投影 Runtime 和 Session facts，不拥有 lane/latest/supersede 判断。
- `agent-session`：消费 Runtime terminal facts 并定义 history 语义；不决定 run 是否 queued、executing、blocked 或 superseded。
- 测试：新增 contract tests、runtime scheduler characterization tests、gateway agent+owner-scope tests、stream/history 一致性测试和 OpenSpec strict validation。

## 非目标（Non-Goals）

- 不实现完整 cancel hardening；用户主动 cancel 的完整状态矩阵、终态和 SafeError 由 `add-ts-request-cancel` 承接。
- 不实现 `add-ts-request-retry` 或 future edit-resubmit capability 的完整用户语义；retry lineage、source attachment 重新校验和 hidden-message visibility 由 retry change 承接。
- 不实现完整 local runtime recovery 或 pending Tool replay guard；recovery scan/claim/checkpoint 行为和 Tool replay safety 分别由 `add-ts-local-runtime-recovery`、`add-ts-runtime-recovery-idempotency-guard` 承接。
- 不把 `loadSessionLaneSnapshot` 定义为 scheduler queue、任务分发器或 queue manager。
- 不让 latest-submit replacement 绕过 scheduler、terminal commit、agent+owner scope 或 Runtime lifecycle ownership。
- 不新增 `RunStatus`、`TimelineEventType` 或 `StreamEventType`。
- 不实现公平调度、跨 session 全局容量策略、复杂队列 UI 或用户可管理队列。
- 不实现 PaaS 多实例 shared runtime state、lock/lease、worker registry 或 non-sticky request routing。
- 不定义具体数据库 schema、索引名称或本地文件布局。

## 归档前基线提升计划（Baseline Promotion Plan）

行为契约：

- `openspec/specs/session-lane-scheduling/spec.md`：新增同会话 queued scheduling、latest-submit replacement、默认串行 dispatch、queue authority、terminal-pending dispatch protection 和不同 session 并发契约。
- `openspec/specs/ts-core-contracts/spec.md`：提升 `RequestRunStoreGateway.loadSessionLaneSnapshot`、`RequestRunStoreGateway.loadRunByIdempotencyKey`、RequestRun 主路径 lookup/claim/terminal commit scope、acceptance idempotency anchor 和 terminal commit idempotency anchor lookup 的 agent+owner-scoped request/response 语义。

长期背景：

- `openspec/overview.md`：补充同会话请求入队、串行调度和 latest-request 语义对电信网络智能体连续操作体验的意义。

设计视图：

- `openspec/designs/architecture/runtime-boundaries.md`：补充 submit -> queued -> scheduler dispatch -> terminal commit 的 Runtime 边界和 Channel/Session/Gateway 非职责。
- `openspec/designs/architecture/request-run.md`：补充 queued run、executing run、terminal-pending run、replacement/supersession 和 terminal commit 不变量。
- `openspec/designs/architecture/core-contracts.md`：补充 session lane snapshot 查询契约。
- `openspec/designs/modules/agent-runtime.md`：补充 Runtime 消费 lane snapshot、scheduler dispatch 和 terminal-pending 保护的模块职责。
- `openspec/designs/modules/agent-platform-gateway-local.md`：补充本地 gateway 只返回 durable facts、不拥有调度状态机的职责。
- `openspec/designs/adr/session-lane-snapshot-query.md`：记录选择正式 agent+owner-scoped lane snapshot 查询，而不是 Runtime 私查数据库或依赖进程内 lane map 的取舍。
- `openspec/designs/spec-to-design-map.md`：新增 `session-lane-scheduling` 与 runtime/domain/contracts/modules/ADR 的导航关系。

验证入口：

- `session-lane-scheduling` spec scenarios。
- `ts-core-contracts` contract tests for `loadSessionLaneSnapshot`。
- Runtime scheduler characterization tests for submit queues run、latest-submit replacement、same-lane serial dispatch、different-lane concurrency、terminal-pending dispatch block and queue capacity/depth safe outcomes。
- Gateway agent+owner-scope tests for tenant/subject/agent/session filtering。
- Stream/history consistency tests for queued and terminal facts。
