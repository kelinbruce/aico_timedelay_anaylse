## 背景和现状（Context）

核心契约已经定义 `RequestRun.status`、canonical timeline、`StreamEnvelope` 和用户可见 `StreamEventType`。最小内核后续会产生请求 accepted、规划、模型输出、能力调用、pending input、降级和终态提交等事实，但这些事实还没有被明确接入用户可见状态。

相关方包括 runtime 团队、Web channel 团队、controller/capability 团队、frontend 团队和 observability/ops 团队。约束是：runtime 是 request lifecycle 的唯一 owner；Web channel 只能投影；降级不是 `RunStatus`；pending input 的可见 payload 必须安全；SSE 和 WebSocket 必须看到同一套 `StreamEnvelope` 语义。

当前规格缺口：本 change 是 TS 后端起始阶段的目标规格，当前尚未形成稳定的 `ts-run-status-visibility` 基线。实施时必须以 active OpenSpec 中已冻结的核心契约为目标，不从临时实现反推新的状态或事件名称。

## 当前代码基线和最小 Delta

当前分支的 runtime 主链路已经不是旧的同步阻塞 submit 模型：`submit` 已能创建 `QUEUED` run、发布 `REQUEST_ACCEPTED`、进入 scheduler dispatch，并通过 runtime terminal commit 写入终态事实。Web channel 目前仍存在 route-local stream projection 逻辑，尚未形成可被 SSE、WebSocket 和 status visibility 共同复用的 projection service。

本 change 的最小增量是：

- 保留 runtime 作为 `RequestRun.status`、canonical timeline 和 terminal commit 的唯一事实 owner。
- 将 route-local projection 收敛为共享 projection service，统一 `RunTimelineEvent` / `RequestRun.status` 到 `StreamEnvelope` / 用户可见 status 的映射。
- 将 payload allowlist、redaction、deprecated event 拒绝和 projection failure 处理集中在 projection service。
- 让后续 `add-ts-web-sse-ws-transports` 只消费该 projection service，不再复制 vocabulary map 或 redaction 判断。

验证入口是 projection contract tests、Web channel integration tests 和 architecture boundary tests：必须证明 stream close、client disconnect、transport success、empty output 或 adapter cache 不能合成 terminal event。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 让用户和前端能通过 stream/status 看到 canonical run lifecycle 和关键执行阶段。
- 让每个用户可见状态和事件都可追溯到 `RequestRun` 或 `RunTimelineEvent`，并保留 `timelineEventRef`。
- 统一正常路径、边界路径、失败/降级路径的状态展示和 safe error；audit 摘要和 metric 作为后续 observability consumer 使用本 change 的 safe projection outcome。
- 禁止 deprecated projection 名称进入用户可见 stream。
- 保持实现简单：只做 projection，不新增第二套状态机、状态表或 transport-specific vocabulary。

**非目标：**

- 不修改 `RunStatus`、`TimelineEventType` 或 `StreamEventType` 已冻结 vocabulary。
- 不实现 stream resume/replay 的完整 transport 语义；本 change 只保证投影事实和 sequence 语义可被消费。
- 不实现完整 Web UI 展示组件。
- 不引入新的后台调度器、轮询 job 或状态聚合存储。
- 不把 audit sink、metrics sink、redaction policy 或 pending input timeout 的完整能力纳入本 change；只定义本投影必须调用的安全边界和输出语义。

## 设计决策（Decisions）

### 1. 唯一实现策略：runtime fact 到共享 projection

选择：runtime 推进 `RequestRun.status` 并发布 canonical timeline；用户可见通道消费 run 与 timeline facts，通过共享 projection 生成 `StreamEnvelope` 和用户可见 status。SSE、WebSocket 和用户可见状态读取共用同一投影规则和同一 vocabulary map。

理由：这样每个用户可见状态只有一个事实来源，且可以用 contract test 穷举输入到输出。放弃让前端、transport adapter 或 Agent/core 按阶段自行拼状态的方案，因为它会产生第二套生命周期。

### 2. 状态触发机制按生命周期 fact 接入

触发点按请求生命周期顺序处理：

1. request admission 成功时，runtime 创建 durable `RequestRun` 并发布 `REQUEST_ACCEPTED`；`REQUEST_ACCEPTED` 表示请求已被受理，不强制要求 `RequestRun.status=ACCEPTED`。
2. admission 后若进入同 session lane 队列，runtime 可将 durable `RequestRun.status` 设置为 `QUEUED`；用户可见 status 必须暴露当前 canonical status，stream 仅在有对应 timeline fact 时输出，不发明未定义 event。
3. 规划开始时，runtime 设置 `PLANNING` 并发布 `PLANNING_STARTED`；用户可见 stream 只在需要展示时投影为允许的 event 或状态字段，不新增 `PLANNING_STARTED` stream event。
4. 模型生成和能力调用发生时，core/capability 通过 runtime-owned publisher 写入 timeline，channel 投影为 `LLM_*` 或 `CAPABILITY_*`。当 context compaction、hook 或 policy owning change 已提交 canonical timeline fact 时，本 change 只消费该 fact：`CONTEXT_COMPACTED` 可投影，`HOOK_DECISION_APPLIED` 和 `POLICY_APPLIED` 保持 timeline-only，不进入首版用户可见 stream。
5. 降级发生时，runtime 或被授权的执行边界发布 `DEGRADATION_NOTICE`；`RequestRun.status` 保持当前生命周期状态。
6. 当 pending input owning boundary 发布 `USER_INPUT_*` timeline fact 时，projection 只暴露安全 payload；本 change 不实现 pending input 创建、回答、超时或取消的生产路径。
7. terminal commit 完成后，runtime 已发布的 `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED` 或 `REQUEST_SUPERSEDED` fact 被 channel 投影为对应 terminal stream event；本 change 不实现 cancel 或 supersede 的生产路径。

同步/异步边界：run status transition 属于 runtime 主流程的受控同步状态推进或受控异步推进；stream/status projection 是异步观察和输出，不反向驱动 runtime。

### 3. 输入与前置条件是最小事实集

projection 输入固定为：可信 `IdentityContext`、`sessionId`、`rootMessageId`、可选 `requestRunId`、`RequestRun.status`、`RunTimelineEvent`、timeline sequence、`SafeError`、redaction boundary、owner-scope 校验结果、pending input 安全摘要和 clock。

前置条件：

- caller 已通过可信 channel/auth boundary 注入 identity。
- runtime/gateway 能按 owner scope 读取 session、run 和 timeline。
- event type 必须属于已冻结 canonical vocabulary。
- timeline event 必须带 `sessionId`、`runId`、`rootMessageId`、`requestContextId`、`sequence` 和 `eventId`。
- pending input 可见 payload 只能来自 runtime-owned pending input object，不接受客户端或模型自报字段。

### 4. 输出与副作用明确分层

输出分三类：

- 用户可见输出：`StreamEnvelope`、canonical run status visibility、前端可展示提示和 safe failure payload。
- 可观测输出：safe projection outcome，可被后续 observability sink 转化为 projection latency、terminal projection failure、redaction failure、runtime unavailable、degradation notice 和 pending input visibility metric。
- 审计/诊断输出：只包含 tenant/session/run/message/event ids、canonical status/event type、safe reason/error、projection outcome 和时间，不包含 raw prompt、raw model output、tool args/result、secret 或 local path。

投影结果不得反写为 `RequestRun`、timeline、checkpoint 或 pending input 原始事实。`StreamEnvelope.timelineEventRef` 是追溯引用，不是事实替代品。

### 5. 核心判断逻辑固定为规则顺序

projection service 按以下顺序判断：

1. 校验 identity 对 session/run/timeline 的 owner scope；失败返回 safe authorization error，并记录拒绝诊断。
2. 校验 run status 和 timeline event type 属于 canonical vocabulary；失败按 internal contract violation 处理，不输出未知用户事件。
3. 判断 terminal status 与 terminal timeline event 是否一致；不一致时输出 safe failure/degradation 诊断，不伪造 completed。
4. 对 timeline payload 执行 event-specific projection 和 redaction；redaction 失败时不输出原始 payload。
5. 对 pending input event 只保留 `id`、`sessionId`、`kind`、`questions`、`timeoutAt` 或 id/kind/status/safe summary。
6. 对 degradation event 输出 `DEGRADATION_NOTICE`，但不改变 `RunStatus`。
7. 对 deprecated projection 名称直接拒绝，并记录 contract test 可发现的 violation。
8. 生成 `StreamEnvelope`，设置新 stream `eventId`、来源 `timelineEventRef`、canonical `eventType`、sequence、transport hints 和 `EpochMillis`。

### 6. KISS 审视和业务边界

黑盒效果：同一次 run 在用户可见 status 和 stream projection 中看到的状态一致，且事件名称稳定、安全、可追溯。

业务边界：本 change 只负责“看见状态”，不负责“决定下一步执行什么”。执行推进仍由 runtime/core/capability 主流程负责，历史重放和 transport 连接管理由相邻 change 负责。

核心业务实现逻辑：把 canonical fact 映射成用户可见 DTO。该逻辑是纯投影、无副作用写事实、可穷举测试，满足 KISS。没有引入新的状态存储、调度机制、复杂策略引擎或二次聚合模型。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 所有投影先做 owner-scope 校验；safe error 和 redaction 后才能跨 stream/status/log/audit 输出；pending input 不暴露 identity、idempotency key、raw answer 或 model-formatted answer。 | Security tests 覆盖 owner mismatch、pending input payload、safe error、secret/raw content 禁止输出。 |
| 性能/容量 | projection 是按 event 的无状态映射，不新增持久化聚合表；stream 按 runtime timeline sequence 处理可见事件，避免全量扫描。 | Contract/unit tests 覆盖单 event projection；integration benchmark 可统计 projection latency 和 active stream delivery。 |
| 可靠性/恢复 | timeline read failure、projection failure、terminal projection failure 和 runtime unavailable 在投影层显式输出 safe diagnostic 或 safe error，不静默吞错。 | Resilience tests 覆盖读取失败、terminal projection failure、redaction failure 和 runtime unavailable 的投影行为。 |
| 可维护性 | vocabulary map 集中在 projection service；runtime 保持事实 owner，channel 保持投影 owner；不让 transport adapter 复制判断。 | Architecture tests 检查 channel 不创建 runtime lifecycle，contract tests 穷举 vocabulary。 |
| 可测试性 | projection 函数以 run/timeline/pending input safe summary 为输入，可用固定 fixtures 覆盖正常、边界、失败路径。 | Unit/contract tests、integration tests、characterization tests。 |
| 审计/可追溯性 | 每个 stream event 保留 `timelineEventRef`；safe diagnostic 使用业务 ids、status/event type、safe reason/error 和 projection outcome 关联原始事实。 | 投影测试断言 terminal/degradation/projection failure 不泄露原始内容；正式日志、audit 和 metric 由 observability owning change 验证。 |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ts-run-status-visibility/spec.md` 主承载用户可见 run status 与 stream projection 的可验证行为。
- 跨模块架构：`openspec/designs/architecture/request-status-visibility.md` 主承载 runtime fact 到 channel projection 的流程接入，以及 audit/observability consumer 的输入边界。
- 领域模型/状态机：`openspec/designs/architecture/request-run.md` 主承载 `RunStatus` 生命周期、terminal visibility、pending input 投影和降级非状态规则。
- API/SPI/event/schema：`openspec/designs/architecture/stream-projection.md` 主承载 `StreamEnvelope`、event payload、safe error 和 deprecated event 禁用语义。
- 边界职责：runtime boundary 与 Web channel boundary 分别主承载事实发布职责和投影职责。
- ADR：如归档时需要保留长期取舍，`openspec/designs/adr/<next-id>-canonical-run-status-visibility.md` 主承载“用户可见状态只从 runtime canonical facts 派生”的长期决策。
- 导航：`openspec/designs/spec-to-design-map.md` 主承载 spec 到设计和验证入口的导航。

## 风险与取舍（Risks / Trade-offs）

- [风险] `PLANNING_STARTED` 是 timeline event 但不是首批用户可见 `StreamEventType`。-> 缓解方式：用户可见 status 暴露 `PLANNING`，stream 只输出已冻结的用户可见 event；需要 stream 展示规划开始时必须提出 contract refinement。
- [风险] terminal status 已更新但 terminal event 投影失败。-> 缓解方式：记录 terminal projection failure metric/log，stream 返回 safe diagnostic，不伪造或重复终态。
- [风险] Web channel 为了 UI 便利复制状态判断。-> 缓解方式：集中 projection service，architecture tests 禁止 transport adapter 私有 lifecycle。
- [风险] pending input payload 容易携带敏感答案。-> 缓解方式：event-specific allowlist，只投影安全摘要字段。

## 发布计划（Release Plan）

不需要既有数据转换。发布步骤是先落地 contract/projection tests，再实现本 change 范围内已有 runtime fact 的 channel projection。pending input、cancel/supersede、policy/context compaction 和 observability/audit sink 由 owning change 接入。若发现投影逻辑导致用户可见状态错误，回滚 channel projection 调用即可；runtime canonical facts 不因本 change 的投影失败而回滚或重写。

## 归档前基线提升计划（Baseline Promotion Plan）

- `openspec/specs/ts-run-status-visibility/spec.md`：提升用户可见状态、stream projection、失败降级、安全输出和验收样例。
- `openspec/overview.md`：提升用户可见状态是长任务体验和电信级可追溯性的基础。
- `openspec/designs/architecture/request-status-visibility.md`：提升 runtime fact 到 channel projection 的跨模块流程和质量属性。
- `openspec/designs/architecture/request-run.md`：提升 status 语义、terminal visibility、degradation 非状态规则和 pending input 投影生命周期。
- `openspec/designs/architecture/stream-projection.md`：提升 event/payload/safe error 调用语义。
- runtime boundary 设计视图：提升 runtime 状态推进与 timeline 发布职责。
- Web channel boundary 设计视图：提升 Web channel 投影职责和非职责。
- `openspec/designs/adr/<next-id>-canonical-run-status-visibility.md`：如归档时需要保留长期取舍，提升 canonical status visibility 决策。
- `openspec/designs/spec-to-design-map.md`：提升导航和验证入口。

## 待确认问题（Open Questions）

无。
