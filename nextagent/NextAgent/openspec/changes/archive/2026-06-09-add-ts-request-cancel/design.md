## 背景和现状（Context）

`stable ts-backend-architecture` 已经规定慢边界必须是 async contract，并接收 Runtime-owned cancellation context；`agent-runtime` 拥有 request submit、cancel、retry、edit、scheduling、same-session lane、latest-request handling、terminal commit 和 canonical timeline publication。`stable ts-core-contracts` 已经冻结 `RequestControlCommand`、`RuntimeCommandPort.cancel`、`RunStatus.CANCELED`、`TimelineEventType.REQUEST_CANCELED`、terminal commit result、SafeError、Agent Scope、Owner Scope 和 `AbortSignal` 调用边界。

`add-ts-session-lane-scheduling` 已经确定 submit 会先产生 durable queued run，再由 Runtime scheduler 串行 dispatch 同一 agent+owner-scoped session lane。request cancel 必须建立在这层之上：取消 queued run 时，不能只删除 scheduler pending item；取消 executing run 时，不能只向模型或工具发信号；用户可见 canceled terminal 也不能早于 terminal durable commit。

目标语义参考：Runtime cancel 先处理 queued work，再执行 latest-request cancel；cancel 校验 latest、拒绝 terminal run、调用 execution handle cancel、创建 `REQUEST_CANCELED` event，并通过 terminal commit 提交 `RunStatus.CANCELED`。Terminal commit 只在 committed 或 idempotent noop 后释放 lane，pending terminal 不释放 lane。

本 change 用于固化 request cancel 的状态矩阵、queued/executing 两条路径、terminal-pending、late output、idempotency、SafeError 和跨 owner 边界。本 change 不修改已冻结 core contracts；它使用现有 command、status、event、gateway terminal commit 和 lane scheduling 输入。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 定义 user cancel 只能通过 `RuntimeCommandPort.cancel(RequestControlCommand)` 进入 Runtime。
- 定义 agent+owner-scoped latest target selection：`tenantId + subjectId + agentId + sessionId + expectedLatestRequestId`。
- 定义 cancelable 状态矩阵：`ACCEPTED`、`QUEUED`、`EXECUTING` 可取消；terminal 和 terminal-pending 不启动第二个 cancel terminal。
- 定义 queued cancel：校正 scheduler pending item，并通过 terminal commit 写 `CANCELED`。
- 定义 executing cancel：触发 Runtime-owned cancellation context，并通过 terminal commit 写 `CANCELED`。
- 定义 `RequestControlAccepted` 与用户可见 `REQUEST_CANCELED` 的边界：前者是控制命令接受，后者必须来自 committed terminal fact。
- 定义 cancel idempotency、single terminal outcome、late output suppression 和 safe errors。
- 定义 request cancel 与 supersession、pending input、invoked capability、stream replay、recovery 的接口边界。

**非目标：**

- 不新增 `RunStatus`、`TimelineEventType`、`StreamEventType` 或 `RequestControlCommand` 字段；跨重启 cancel accepted 重放复用 `add-ts-session-lane-scheduling` / core-contracts 定义的 RequestRun terminal commit idempotency anchor，不新增独立 command outcome fact。
- 不实现 retry/edit-resubmit 用户语义。
- 不实现完整 local runtime recovery、multi-instance lock/lease/shared state 或 non-sticky routing。
- 不定义 stream replay cursor/gap outcome 或 transport-specific reconnect 行为。
- 不定义 pending input 完整对象模型。
- 不定义 invoked agent 结果聚合、parallel DAG 取消聚合或子 Agent 隔离细节。
- 不定义本地数据库 schema、索引或文件布局。

## 设计决策（Decisions）

### D1: Cancel 使用既有 Runtime command contract

选定方案：Web/API cancel 只构造 `RequestControlCommand` 并调用 `RuntimeCommandPort.cancel`。Runtime 继续使用 `identityContext`、`sessionId`、`expectedLatestRequestId`、`action` 和非空 canonical `idempotencyKey`；本 change 不新增 `CancelRequestCommand`、`targetRunId` 或泛化 owner DTO。

Action alias 边界：public Web/channel 入口可接收 `CANCEL_LATEST` 和 `CANCEL`。Channel 必须在调用 Runtime 前执行归一化：`CANCEL_LATEST -> CANCEL`，`CANCEL -> CANCEL`。Runtime command boundary 只消费 canonical `CANCEL`，不得把 `CANCEL_LATEST` 作为 Runtime 内部 action 或 terminal fact 语义。

理由：核心契约已经冻结 control command 字段和 agent+owner scope 语义，Agent Scope 由可信 app/session/run 决定而不是客户端字段。复用现有 command 可以保持 cancel/retry/edit 的 target selection 一致，并避免 Channel 或客户端绕过 Runtime latest policy。

拒绝方案：新增按 `runId` 任意取消的 API。拒绝原因是它会允许历史 run 被客户端直接选择，绕过 latest-request 语义和 agent+owner-scoped lane policy。

边界说明：本 change 只要求 Runtime command boundary 接收到 canonical `idempotencyKey`，不定义 public Web DTO 是否要求客户端传 key，也不定义 Channel 的生成策略。Runtime 不从 client metadata、模型输出或 capability input 中推断或补齐 key；缺失或空 key 在 Runtime 内是 validation failure，不能产生 lifecycle side effect。

### D2: Target selection 只允许 latest cancelable request

选定方案：Runtime 通过 agent+owner-scoped lane facts 判断 `expectedLatestRequestId` 是否等于当前 latest request。只有 latest request 可取消；历史 run cancel 不进入本 change。

理由：`add-ts-request-cancel` one-pager 的目标是取消当前可操作请求。按 latest request 校验可避免客户端绕过 latest-request 语义直接取消任意历史 run。

### D3: `ACCEPTED` 归入 queued cancel path

选定方案：如果 TS 实现中保留短暂 `ACCEPTED` 状态，Runtime cancel 将其视为 pre-execution queued fact，并走 queued cancel path。实现应尽快将 accepted run 持久化为 `QUEUED`，避免长时间裸 `ACCEPTED`。

理由：submit accepted 后但 scheduler 尚未 dispatch 的请求仍是用户可操作请求。如果该瞬间不可取消，会形成用户点击取消却被拒绝的状态缝隙。

### D4: Queued cancel 必须写 terminal fact

选定方案：queued cancel 同时执行两件事：取消、移除或校正 scheduler pending work item；通过 Runtime terminal commit 写 `RunStatus.CANCELED` 和 `REQUEST_CANCELED`。scheduler queue 删除不是业务事实。

理由：durable RequestRun 是权威生命周期账本。只删除 pending item 会让 history、stream replay、recovery 和 audit 无法解释该请求为什么消失。

### D5: Executing cancel 先发 Runtime-owned cancellation context，再提交 canceled terminal

选定方案：Runtime 对 executing run 调用 execution handle 或 abort controller，向 Agent/Model/Capability/Gateway 传播 cancellation context，然后由 Runtime 尝试 terminal commit `CANCELED`。Runtime 不等待所有下游物理停止后才提交 canceled terminal。

理由：很多 provider 或 external tool 只能协作式取消，物理停止存在延迟。用户取消的可见收尾必须由 Runtime terminal commit 驱动，而不是被慢边界拖住。先调用 `executionHandle.cancel()`，再写 `REQUEST_CANCELED` terminal。

拒绝方案：等待所有模型/tool 完全返回后再 terminal commit。拒绝原因是取消响应会被慢外部依赖卡住，且无法保护同会话 lane 的后续工作。

拒绝方案：只写 `CANCELED`，不传播 cancellation context。拒绝原因是旧执行链路会继续消耗资源并产生 late output。

### D6: `RequestControlAccepted` 不等于用户可见 canceled terminal

选定方案：`RequestControlAccepted` 表示 Runtime 接受并处理了控制命令。`REQUEST_CANCELED` stream event、visible history 和 lane release 只来自 committed 或 idempotent already-committed terminal result。如果原始 cancel command 已被接受，但 canceled terminal commit 进入 pending/retrying，Runtime 必须在目标 `RequestRun` 的 terminal commit metadata 中保留该 command 的 `idempotencyKey` 和 command semantic，并从该 terminal commit anchor 推导重复 command 的 accepted/idempotent outcome；这只说明取消控制命令已经进入 Runtime terminal boundary，不说明用户可见 terminal 已经提交。

理由：架构契约要求 client-visible terminal stream events 和 visible history 只能在 runtime terminal durable-write boundary 成功后出现。Runtime terminal commit boundary / `RequestRunStoreGateway.commitTerminal` 只在 committed/idempotent noop 后 release lane。

### D7: Terminal pending 阻塞 visibility 和 lane release

选定方案：cancel terminal commit 返回 pending/retrying 时，Runtime 不投影 committed `REQUEST_CANCELED`，不释放 lane，也不启动同 lane 后续 terminal-writing work。后续由 terminal retry/recovery 完成边界。若同一 `idempotencyKey` 重试原始 cancel command，Runtime 从目标 run 的 terminal commit metadata 返回原始或等价 accepted pending outcome；若不同 `idempotencyKey` 对同一个 terminal-pending run 再发起 cancel，Runtime 返回 `REQUEST_CANCEL_TERMINAL_PENDING` safe conflict，且不得启动第二个 cancel terminal transition。

理由：terminal pending 已经进入 terminal boundary，但未达到可见稳定结果；提前显示 canceled 或释放 lane 都会破坏 history/stream 一致性。

### D8: Late output suppression 在 Runtime terminal gate 执行

选定方案：Runtime 在 terminal commit 后拒绝或 drop 旧 execution chain 的 model final、model deltas、capability result 或 Agent terminal attempt。保留的诊断只能作为非 terminal、安全脱敏的内部/audit 事实，不能进入 visible assistant final。

理由：Agent 不得发布 request terminal lifecycle event；Runtime 是唯一 terminal owner。晚到输出如果能改写状态，会造成 canceled 和 completed 双事实。

### D9: Cancel idempotency 绑定到目标 run terminal commit metadata

选定方案：Runtime 对同一 `idempotencyKey` 和同一 cancel command semantic 的 cancel 不写独立 command outcome store，也不保存 `RuntimeControlCommandOutcomeRecord`。当 cancel terminal attempt 开始后，Runtime 必须把该 `idempotencyKey` 和 semantic 作为目标 `RequestRun` 的 terminal commit metadata；同 key 同 semantic 重试通过 `RequestRunStoreGateway.loadRunByIdempotencyKey(anchor=TERMINAL_COMMIT)` 找回目标 run，并返回原始或等价 accepted pending/committed outcome。相同 key但不同 cancel command semantic 返回 `REQUEST_CANCEL_IDEMPOTENCY_CONFLICT`，不进入状态机。对不同 key 的 repeated cancel 在已 terminal 或 terminal-pending 后返回 conflict/already terminal/terminal-pending。与 completed/failed/superseded race 时，terminal commit CAS/version/fencing 决定唯一终态。

Cancel command semantic 至少包含可信 `identityContext.tenantId`、`identityContext.subjectId`、`sessionId`、`expectedLatestRequestId`、归一化后的 `action=CANCEL` 和 `idempotencyKey`。该 semantic 只来自 Runtime command 字段，不读取 client metadata、隐藏 body 字段、模型输出或 capability input。同一 public cancel 语义分别以 `CANCEL_LATEST` 和 `CANCEL` 到达 Web/channel 时，归一化后属于同一 cancel command semantic；相同 `idempotencyKey` 不得因此被判为 `REQUEST_CANCEL_IDEMPOTENCY_CONFLICT`。

理由：control command idempotency 解决用户连点或网络重试，terminal commit fencing 解决真正的并发终态竞争。二者职责不同，不能互相替代。把 cancel idempotency 绑定到目标 run terminal commit metadata，可以让 terminal、history、recovery、replay 的事实源保持在 RequestRun/terminal commit 上；独立 command response store 只是 derived outcome，会制造第二事实源。

### D10: Cancel 和 supersession 分开建模

选定方案：用户主动 cancel 写 `CANCELED`/`REQUEST_CANCELED`；latest-submit replacement、edit-resubmit replacement 等替换语义写 `SUPERSEDED`/`REQUEST_SUPERSEDED`。如果两种 terminal attempt race，同样由 terminal commit 决定唯一结果。

理由：用户意图不同，history 和后续 retry/edit/feedback 语义不同。`add-ts-session-lane-scheduling` 已经确认 replacement 使用 `SUPERSEDED`。

### D11: Pending input 只做 root cancel 接入，不拥有完整对象模型

选定方案：root request cancel 成功后，正在等待该 run 的 pending input 必须无法恢复 canceled run，late answer 返回 safe conflict/canceled outcome。pending input record schema、投影、回答和恢复仍由 pending-input capability 定义。

理由：request cancel 必须阻断旧 run 继续执行；但 pending input 是独立业务对象，不应被 cancel change 吞掉。

### D12: SafeError code 使用 cancel-specific stable code

选定方案：Runtime cancel 至少使用以下稳定 safe code：`REQUEST_CANCEL_IDEMPOTENCY_REQUIRED`、`REQUEST_CANCEL_IDEMPOTENCY_CONFLICT`、`REQUEST_CANCEL_NOT_LATEST`、`REQUEST_CANCEL_ALREADY_TERMINAL`、`REQUEST_CANCEL_TERMINAL_PENDING`、`REQUEST_CANCEL_NOT_FOUND`、`REQUEST_CANCEL_FORBIDDEN`、`REQUEST_CANCEL_COMMIT_UNAVAILABLE`。category 分别归入 `VALIDATION`、`CONFLICT`、`NOT_FOUND`、`AUTHORIZATION`、`UNAVAILABLE` 或 `INTERNAL`。

理由：Channel/Web 和 observability 需要稳定错误码做 Web command response、stream diagnostics、日志和审计。错误内容不得泄漏 hidden agent/owner-scope resource。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | Cancel target selection 必须使用可信 `identityContext.tenantId`、`identityContext.subjectId`、trusted `agentId`、`sessionId` 和 `expectedLatestRequestId`；agent/owner mismatch 不泄漏目标是否存在；SafeError 不含 raw provider/tool/model/storage detail。 | agent+owner-scope negative tests；SafeError contract tests；redaction code review。 |
| 性能/容量 | Cancel 不等待所有下游物理停止，只等待 Runtime terminal boundary；queued cancel 直接校正 scheduler pending item；executing cancel 使用 cooperative signal，减少继续消耗。 | runtime cancel latency characterization；scheduler pending cancellation tests；load smoke with cancel. |
| 可靠性/恢复 | Terminal commit 是 canceled 可见性和 lane release 边界；pending terminal 不释放 lane；terminal CAS/fencing 保证单终态；late output 不能改写 committed terminal。 | terminal commit tests；double/concurrent cancel tests；pending terminal tests；late output tests。 |
| 可维护性 | Runtime 独占 cancel lifecycle；Channel/Gateway/Session/Agent/Model/Capability 各守边界；本 change 不新增核心 command 或 event vocabulary。 | architecture boundary tests；module dependency checks；code review of ownership boundaries。 |
| 可测试性 | 状态矩阵、queued/executing paths、terminal result、late output 和 safe errors 都可用 fake gateway/scheduler/execution handle deterministic 验证。 | unit tests with fake gateway and handles；contract tests；integration tests with local gateway。 |
| 审计/可追溯性 | Canceled request 保留 durable run、terminal event、terminal commit idempotency metadata 和 safe reason；queued cancel 不让请求消失；late output 只作为安全诊断处理。 | timeline/history tests；audit/log assertions；trace/log redaction checks。 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| Cancel 只通过 Runtime command 并校验 agent+owner/latest | T1, T4, T9 | runtime command tests；agent+owner-scope negative tests |
| `ACCEPTED`/`QUEUED`/`EXECUTING` 状态矩阵 | T2, T4, T5 | runtime cancel state tests |
| Queued cancel 写 terminal fact，不只删 scheduler item | T4, T10 | scheduler + terminal commit integration tests |
| Executing cancel 传播 cancellation context | T5, T8 | fake execution handle and AbortSignal tests |
| `REQUEST_CANCELED` 只在 terminal commit 后可见 | T6, T11 | stream/history visibility tests |
| Pending terminal 不释放 lane | T6, T10 | terminal-pending lane tests |
| Idempotency 和 single terminal outcome | T7 | duplicate/concurrent cancel tests |
| Late output suppression | T8 | late model/capability output tests |
| SafeError code 和 redaction | T9 | SafeError tests；redaction review |
| Cross-capability boundaries | T12 | pending input/capability boundary tests or review |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/request-cancel/spec.md` 主承载 cancelable 状态矩阵、queued/executing cancel path、terminal visibility、idempotency、late output 和 SafeError 行为。
- 跨模块架构：`openspec/designs/architecture/runtime-boundaries.md` 主承载 cancel command 到 terminal commit 的 Runtime-owned flow，以及 Channel/Session/Gateway/Agent 非职责。
- 领域模型/状态机：`openspec/designs/architecture/request-run.md` 主承载 `CANCELED` terminal state、terminal-pending、single terminal outcome 和 late output 不变量。
- API/SPI/event/schema：`openspec/designs/architecture/core-contracts.md` 主承载 `RuntimeCommandPort.cancel` 调用语义、terminal commit result consumption、accepted/visible terminal 边界和 SafeError 分支。
- 模块职责：`openspec/designs/modules/agent-runtime.md` 主承载 Runtime cancel coordinator；`agent-channel-web`、`agent-core`、`agent-model`、`agent-capability`、`agent-platform-gateway-*` 模块文档主承载各自消费/非职责。
- ADR：`openspec/designs/adr/request-cancel-terminal-boundary.md` 主承载“command accepted 不等于 terminal visible”的长期取舍。
- 导航：`openspec/designs/spec-to-design-map.md` 主承载 `request-cancel` 到设计和测试入口的导航。

## 风险与取舍（Risks / Trade-offs）

- [风险] `RequestControlAccepted` 被 UI 误解为已经可见 canceled terminal。-> spec/design 明确 command acceptance 与 terminal visibility 分离，Channel/Web 只能投影 committed terminal facts。
- [风险] External provider 不及时停止。-> Runtime 不等待物理停止才 terminalize，但 late output gate 必须拒绝后续可见 terminal/final answer。
- [风险] Terminal commit pending 后用户继续提交请求导致等待。-> terminal pending 阻塞 same-lane terminal-writing dispatch，保护 history/stream 一致性。
- [风险] Cancel 与 supersession race 导致语义争议。-> terminal commit first-winner 规则保证唯一终态，失败方返回 conflict/already committed。
- [风险] 后续策略调整被误用为回写历史。-> 已提交的 cancel terminal fact 是 canonical timeline/history 事实，后续禁用、调整或替换 cancel 策略只能影响新命令，不得删除或改写已提交终态。
- [风险] Pending input、child agent、parallel branch 范围膨胀。-> 本 change 只定义 root cancel 接入和 cancellation context；对象模型和聚合细节留给 dedicated changes。
- [风险] cancel 所需共享 scope 与基础契约不一致。-> 本批修复口径下，cancel 不新增 cancel 专属 gateway port 或 public vocabulary；如果 cancel 需要的 RequestRun scope 或 idempotency anchor 表达不一致，应回到 `add-ts-session-lane-scheduling` 的共享 RequestRun scope 基础中修正，而不是在 cancel change 内暗改核心契约或新增平行 contract。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/request-cancel/spec.md`：提升 request cancel 可验证行为契约。
- `openspec/overview.md`：提升 request cancel 对长任务用户控制和可靠收尾的长期背景。
- `openspec/designs/architecture/runtime-boundaries.md`：提升 Runtime-owned cancel flow、terminal visibility boundary 和跨模块非职责。
- `openspec/designs/architecture/request-run.md`：提升 cancelable 状态矩阵、`CANCELED` terminal、terminal-pending 和 late output 不变量。
- `openspec/designs/architecture/core-contracts.md`：提升 `RuntimeCommandPort.cancel` 调用语义、accepted/visible terminal 边界和 SafeError 分支。
- `openspec/designs/architecture/core-contracts.md`：提升 cancel terminal commit 使用既有 terminal result 的持久化语义。
- `openspec/designs/modules/agent-runtime.md`：提升 Runtime cancel coordinator 职责。
- `openspec/designs/modules/agent-channel-web.md`：提升 Web cancel command/projection 非职责。
- `openspec/designs/modules/agent-core.md`、`openspec/designs/modules/agent-model.md`、`openspec/designs/modules/agent-capability.md`：提升 cancellation context consumer 职责。
- `openspec/designs/adr/request-cancel-terminal-boundary.md`：提升 command accepted 与 terminal visible 分离的 ADR。
- `openspec/designs/spec-to-design-map.md`：提升导航和验证入口。

## 待确认问题（Open Questions）

无。当前设计复用已冻结 core contracts，并消费 `add-ts-session-lane-scheduling` 提供的 RequestRun agent+owner scope 与 terminal commit idempotency anchor lookup 基础；cancel 本身只承接用户主动取消的状态矩阵、终态、idempotency 和 SafeError。
