## 背景与问题（Why）

NextAgent TS 后端已经通过 `stable ts-backend-architecture` 和 `stable ts-core-contracts` 确定：`agent-runtime` 是 request lifecycle 的唯一 owner，负责 request submit、cancel、retry、edit、scheduling、same-session lane、latest-request handling、terminal commit 和 canonical timeline publication。`add-ts-session-lane-scheduling` 进一步明确 submit 会先创建 durable queued run，再由 Runtime scheduler 按 agent+owner-scoped session lane 串行 dispatch，并用 terminal-pending 保护防止后续执行提前写入同一会话的 terminal/history facts。

当前缺口是：用户发起取消后，系统还缺少正式 OpenSpec change 来定义“当前可操作请求”如何被 Runtime 可靠取消。仅有 Web cancel command 或执行链路 `AbortSignal` 不足以保证正确性：排队中的 run 不能只从 scheduler pending queue 删除，执行中的 run 不能只向模型或工具发信号，用户可见 `REQUEST_CANCELED` 也不能早于 terminal durable commit。否则同一请求可能在 history 中消失、产生双终态、在取消后继续输出，或在 terminal commit pending 时错误释放 lane。

本 change 现在处理 request-level cancellation，是为了让用户主动取消具备可验证的端到端语义：Runtime 校验 agent+owner scope、latest request 和可取消状态后，对 queued run 或 executing run 执行一致的 cancellation path，最终通过 terminal commit 写入唯一 `CANCELED` terminal fact，并确保 stream/history/lane release/late output 与该事实一致。

## 变更范围（What Changes）

- 新增 request cancel 行为契约：用户主动取消当前 agent+owner-scoped session lane 的 latest 可操作请求时，Runtime 必须通过 `RuntimeCommandPort.cancel(command: RequestControlCommand)` 处理。
- 定义 cancel command idempotency 前置条件：Runtime command boundary 必须收到非空 canonical `idempotencyKey`；本 change 不定义 public Web DTO 的 key 来源，只定义 Runtime 对该 key 的校验、重放和冲突语义。
- 定义 cancel 目标选择：Runtime 使用可信 `identityContext.tenantId`、`identityContext.subjectId`、`sessionId` 和 `expectedLatestRequestId` 定位当前 latest request；不支持任意历史 run cancel。
- 定义可取消状态矩阵：`ACCEPTED`、`QUEUED` 和 `EXECUTING` run 可取消；`COMPLETED`、`FAILED`、`CANCELED`、`SUPERSEDED` run 不可取消；`terminalCommitState=PENDING|RETRYING` 的 run 不产生第二个 cancel terminal，只进入 pending terminal/recovery 处理。
- 定义 queued cancel path：Runtime 从 scheduler pending queue 中取消或校正对应 work item，并通过 terminal commit 将目标 run 写为 `RunStatus.CANCELED` 和 `TimelineEventType.REQUEST_CANCELED`。
- 定义 executing cancel path：Runtime 通过 runtime-owned execution handle、`AbortSignal` 或等价控制边界向 Agent/Model/Capability/Gateway 慢边界传播取消信号，并由 Runtime 写入 `CANCELED` terminal fact。
- 定义 terminal visibility boundary：`RequestControlAccepted` 只表示 Runtime 接受并处理 cancel command；原始 cancel 的 terminal commit 若进入 pending/retrying，必须把 cancel idempotency key 和 command semantic 固化为目标 `RequestRun` 的 terminal commit metadata，重复 cancel 从该 metadata 推导原始或等价 accepted outcome；client-visible `REQUEST_CANCELED` stream event、visible history 和 lane release 只能在 terminal durable commit 成功或幂等已提交后出现。
- 定义 late output 处理：cancel terminal commit 成功后，旧执行链路产生的 late model/capability/agent output 不得变成可见 final answer，不得覆盖 terminal state，也不得产生第二个 terminal lifecycle event。
- 定义 cancel idempotency 和并发安全：同一 `idempotencyKey` 与同一 command semantic 的重复 cancel 通过目标 `RequestRun` 的 terminal commit idempotency metadata 返回同一或等价结果，包括原始 cancel terminal commit pending 时的 accepted pending outcome；相同 key 不同 command semantic 返回 `REQUEST_CANCEL_IDEMPOTENCY_CONFLICT`；不同 key 对已 terminal 或 terminal-pending run 的再次 cancel 返回 safe conflict/already-terminal/terminal-pending 结果；cancel 与 completed/failed/superseded race 只能提交一个 terminal outcome。
- 定义 cancel action alias 边界：public Web/channel 入口可接收 `CANCEL_LATEST` 和 `CANCEL`，但在调用 Runtime 前必须归一化为 canonical `CANCEL`；Runtime command semantic 和 idempotency 判断只使用归一化后的 `CANCEL`。
- 定义 cancel 与 supersession 的区分：用户主动 cancel 使用 `CANCELED`；latest-submit replacement、edit-resubmit 或其他替换语义 terminalize 旧 run 时使用 `SUPERSEDED`。
- 定义跨 agent/owner 协作边界：Channel 只构造可信 command 和投影 Runtime terminal facts；Gateway 只提供 agent+owner-scoped durable facts 和 terminal commit；Agent/Core/Model/Capability 只消费 cancellation context 或返回 typed cancellation/timeout outcome，不拥有 request terminal lifecycle。
- 定义相关非目标：不实现 retry/edit-resubmit 语义、不实现完整 local runtime recovery、多实例 lock/lease、stream replay 机制、pending input 完整对象模型、子 Agent/parallel 分支聚合细节或数据库 schema。

## Capability 影响（Capabilities）

### 新增 Capability

- `request-cancel`: 定义 Runtime 取消当前 latest 可操作 request 的 agent+owner scope、状态矩阵、queued/executing cancel path、terminal commit、stream/history 可见性、late output、idempotency、SafeError 和跨模块边界。

### 修改的 Capability

- 无。当前 change 复用 `stable ts-core-contracts` 已冻结的 `RequestControlCommand`、`RuntimeCommandPort.cancel`、`RunStatus.CANCELED`、`TimelineEventType.REQUEST_CANCELED`、`TerminalCommitRecordResult`、`SafeError`，并消费 `add-ts-session-lane-scheduling` 固定的 agent+owner-scoped RequestRun gateway scope 与 terminal commit idempotency anchor lookup 基础；不新增 core vocabulary、command 字段或 cancel 专属 gateway port。

## 影响范围（Impact）

- `agent-runtime`：实现 request cancel 状态矩阵、agent+owner latest 校验、canonical `idempotencyKey` 校验、queued cancel、executing cancel、AbortSignal/ExecutionHandle propagation、terminal commit、late output suppression、通过 terminal commit metadata 恢复重复 accepted outcome、idempotency 和 safe conflict 分支。
- `agent-channel-web`：继续只接收 Web cancel command、兼容 public action `CANCEL_LATEST`/`CANCEL` 并归一化为 Runtime canonical `CANCEL`、向 Runtime command boundary 提供可信 identity 和 canonical idempotency、调用 Runtime command boundary，并投影 Runtime 已提交的 `REQUEST_CANCELED` fact；不决定 run 是否 canceled，也不在本 change 定义 public Web DTO key 来源。
- `agent-core` / Agent Loop：在 Runtime 提供的 `AbortSignal` 或 cancellation context 触发后停止继续推进模型/能力回合；不得发布 `REQUEST_CANCELED` terminal lifecycle event。
- `agent-model`、`agent-capability-*`、gateway/remote adapters：消费 `AbortSignal` 或返回 typed cancellation/timeout outcome；不可中断的边界必须向 Runtime 返回可归一化的结果，不得自行写 terminal。
- `agent-platform-gateway-*`：通过既有 RequestRun/timeline/terminal commit logical ports 保存 `CANCELED` terminal fact，保持 CAS/idempotent terminal result；不决定 cancelable 状态。
- `agent-session`：通过 Runtime terminal facts 解释 canceled run 在 history 中的可见性；不决定 request lifecycle。
- 测试：新增 Runtime cancel characterization tests、agent+owner-scope negative tests、terminal commit/idempotency/concurrency tests、late output tests、stream/history visibility tests，并运行 OpenSpec strict validation。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：

- `openspec/specs/request-cancel/spec.md`：新增 request cancel 的状态矩阵、queued/executing cancel path、terminal commit、late output、idempotency、SafeError 和跨模块边界。

长期背景：

- `openspec/overview.md`：补充用户主动取消对电信网络智能体长任务控制、可靠收尾和历史一致性的意义。

设计视图：

- `openspec/designs/architecture/runtime-boundaries.md`：补充 cancel command -> owner/latest validation -> queued/executing cancellation -> terminal commit -> stream/history/lane release 的 Runtime 边界。
- `openspec/designs/architecture/request-run.md`：补充 `CANCELED` terminal state、cancelable 状态矩阵、terminal-pending cancel 处理和 late output 不变量。
- `openspec/designs/architecture/core-contracts.md`：补充 `RuntimeCommandPort.cancel` 使用 `RequestControlCommand` 的调用语义、accepted/terminal-visible 边界和 SafeError 分支。
- `openspec/designs/architecture/core-contracts.md`：补充 cancel terminal commit 使用既有 terminal commit result 的持久化语义。
- `openspec/designs/modules/agent-runtime.md`：补充 Runtime cancel owner 职责、scheduler pending correction、execution handle cancellation 和 late output suppression。
- `openspec/designs/modules/agent-channel-web.md`：补充 Channel 只调用 Runtime cancel command 并投影 committed terminal facts 的职责。
- `openspec/designs/modules/agent-core.md`、`openspec/designs/modules/agent-model.md`、`openspec/designs/modules/agent-capability.md`：补充消费 cancellation context、不得写 request terminal lifecycle 的职责。
- `openspec/designs/adr/request-cancel-terminal-boundary.md`：记录选择“cancel accepted 可早于用户可见 terminal，但 `REQUEST_CANCELED` 必须等 durable terminal commit”的取舍。
- `openspec/designs/spec-to-design-map.md`：新增 `request-cancel` 到 architecture/domain/contracts/modules/ADR/验证入口的导航。

验证入口：

- `request-cancel` spec scenarios。
- Runtime characterization tests for queued cancel、executing cancel、accepted-state cancel、terminal-pending cancel rejection/defer、cancel vs completed/failed/superseded race、double cancel and idempotency。
- Owner-scope and latest-request negative tests。
- Terminal commit tests for committed/already-committed/version-conflict/not-found and pending behavior。
- Stream/history tests for `REQUEST_CANCELED` visible only after committed terminal fact。
- Late output suppression tests。
- `openspec validate add-ts-request-cancel --strict`。
