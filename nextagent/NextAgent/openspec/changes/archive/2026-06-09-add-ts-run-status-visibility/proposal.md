## 背景与问题（Why）

NextAgent 面向电信网络智能体的长任务问答、能力调用、用户补充输入和失败降级场景。用户和前端需要稳定地知道一次请求已经被接受、正在排队、正在规划、正在执行、是否需要用户输入，以及最终是完成、失败、取消还是被新请求替代。当前核心契约已经冻结 canonical `RunStatus`、`TimelineEventType` 和 `StreamEventType` vocabulary，但还缺少把这些事实作为用户可见状态投影的实施 change。

本 change 的第一性原理是：`RequestRun` 状态和 canonical timeline 是唯一执行事实，用户可见状态只是 runtime 事实的安全投影。用户可见输出可以承载 canonical status、`StreamEnvelope` 和前端提示，但不得创建第二套生命周期、不得发明 deprecated event 名称、不得把降级误写成 `RunStatus`。

现在处理的必要性在于：如果用户可见状态由前端、SSE、WebSocket 或某个 adapter 各自推断，长任务在断连、重放、能力调用、pending input、取消和失败路径上会出现互相矛盾的结果。电信诊断任务通常需要可追溯、可审计和可恢复的执行链路，状态可见性必须从一开始就绑定 canonical runtime 事实，而不是后续用 UI 规则补丁修正。

## 变更范围（What Changes）

- 新增 run status visibility 行为契约，要求用户可见状态从 `RequestRun.status`、canonical timeline 和 terminal event/status 投影，不从 transport-private state、前端缓存或模型输出推断。
- 明确触发机制：本 change 只消费已经由 owning runtime/core/capability/pending-input/request-control 边界提交的 canonical `RequestRun.status` 或 `RunTimelineEvent`。请求被 runtime 接受、模型输出、能力调用、降级和已存在终态事实可以在本 change 内接入投影；pending input、cancel、supersede、policy 和 context compaction 的事实生产路径由各自 owning change 定义，本 change 只保证这些 fact 一旦存在就可被安全投影或按 timeline-only 规则过滤。
- 明确输入与前置条件：投影需要可信 identity、`sessionId`、`rootMessageId`、`requestRunId`、当前 `RequestRun.status`、timeline sequence、`RunTimelineEvent`、safe error normalizer、redaction policy、owner-scope 校验结果和 runtime/gateway 读取能力。pending input 投影还需要 runtime-owned `PendingInput` 安全摘要。
- 明确输出与副作用：输出 canonical `StreamEnvelope`、用户可见 status、用户可见提示和 safe diagnostic；不得把投影结果反写为执行事实。结构化日志、audit 摘要和 metric sink 的完整实现由 observability owning change 定义；本 change 只保证投影失败不会静默截断、吞错或伪造终态。
- 明确 canonical 名称：用户可见 stream event 使用 `REQUEST_ACCEPTED`、`LLM_THINKING_DELTA`、`LLM_CONTENT_DELTA`、`CAPABILITY_STARTED`、`CAPABILITY_RESULT_DELTA`、`CAPABILITY_COMPLETED`、`DEGRADATION_NOTICE`、`REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED`、`REQUEST_SUPERSEDED`、`USER_INPUT_*`、`ATTACHMENT_*` 和 `CONTEXT_COMPACTED`；不得使用 `STREAM_STARTED`、`THINKING_SUMMARY`、`CONTENT_DELTA`、`CAPABILITY_PROGRESS`、`CAPABILITY_FINISHED`、`CAPABILITY_DISCOVERED` 等 deprecated projection 名称；`HOOK_DECISION_APPLIED` 和 `POLICY_APPLIED` 保持 timeline-only。
- 明确状态/产物契约：`RunStatus` 是 run 生命周期状态；`StreamEnvelope` 是用户可见 wire DTO；`timelineEventRef` 保持对原始 timeline fact 的可追溯引用；pending input payload 只暴露安全字段；diagnostic/log/metric 是可观测产物，不替代 runtime 事实。
- 明确流程接入：上游是已提交的 runtime lifecycle、timeline publisher 和 terminal facts；下游是 Web channel stream projection、前端状态展示、audit event 和 observability metric consumer。pending input、request-control、stream replay/history 和 observability sink 的完整语义由相邻 change 定义，本 change 只保证 projection 输出可被后续消费。
- 明确失败与降级：runtime unavailable、timeline read failure、projection failure、owner-scope mismatch、serialization failure、redaction failure、pending input ref missing 或 terminal projection failure 都必须输出 safe error、safe diagnostic 或安全失败提示；不得静默丢弃事件、静默吞错或把未知状态显示为 completed。完整 structured log/metric 采集由 observability owning change 定义。

BREAKING：无。当前 TS 后端尚未形成稳定的用户可见 run status projection 基线。

## 与当前基线和相邻 change 的边界

- 继承 `ts-core-contracts` 已冻结的 `RunStatus`、`TimelineEventType`、`StreamEventType`、`StreamEnvelope` 和 `timelineEventRef` 语义，不新增或重命名核心 vocabulary。
- 继承 `add-ts-session-lane-scheduling`、`add-ts-request-cancel`、`add-ts-request-retry`、`add-ts-local-runtime-recovery` 和 `add-ts-runtime-recovery-idempotency-guard` 生产的 runtime/canonical timeline 事实；本 change 只定义这些事实一旦存在后如何安全投影。
- 和 `add-ts-web-sse-ws-transports` 的边界是：本 change owning projection vocabulary/status semantics；transport change owning SSE/WS delivery、subscription、replay anchor validation 和 equivalence。
- 不定义 pending input 生产路径、cancel/retry/supersede 执行路径、frontend UI 展示组件、observability sink implementation 或 runtime lifecycle transition。

## Capability 影响（Capabilities）

### 新增 Capability

- `ts-run-status-visibility`: 定义 canonical `RunStatus` 与 timeline event 如何安全投影为用户可见 stream/status、提示、审计摘要和可观测诊断。

### 修改的 Capability

- 无。该 change 消费已冻结核心契约，不修改既有 capability requirement。

## 影响范围（Impact）

- 实现策略：后续整体 TS 重写时采用“runtime canonical facts → shared projection → user-visible stream/status”的策略；不在本 change 约束具体代码目录、类名、框架或文件组织。
- API/事件：固化用户可见 stream/status vocabulary 和 payload 语义；不新增第二套 runtime lifecycle state machine，不修改 `RunStatus` 枚举定义。
- 配置：不允许用配置改变 canonical event 名称、terminal status 语义或 owner-scope 规则；仅可配置 projection timeout、buffer/backpressure 和诊断采样等 adapter 行为。
- 测试：需要 contract tests 覆盖 vocabulary、canonical status projection、pending input safe payload projection、安全脱敏、失败降级和 deprecated name 禁用；需要 integration/resilience tests 覆盖本 change 已接入的正常路径、边界路径和失败路径。
- 运维：本 change 产生 safe diagnostic 和后续 observability consumer 可用的 projection outcome；request status projection、terminal projection failure、degradation notice、pending input visibility、projection latency 和 dropped/failed delivery 的正式结构化日志与 metric 由 observability owning change 接入，且不得包含 raw prompt、raw model output、tool args/result、secret、local path 或未授权对象内容。

## 归档前基线提升计划（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-run-status-visibility/spec.md`：新增用户可见 run status 与 stream projection 行为基线。

长期背景：
- `openspec/overview.md`：补充用户可见状态必须来自 runtime canonical facts，是首版本地 release 长任务体验和可追溯性的基础。

设计视图：
- `openspec/designs/architecture/request-status-visibility.md`：提升 runtime lifecycle、timeline、Web channel、audit 和 observability 的跨模块接入流程。
- `openspec/designs/architecture/request-run.md`：补充 `RunStatus` 可见性语义、terminal visibility、pending input 状态投影和降级非状态规则。
- `openspec/designs/architecture/stream-projection.md`：提升 `StreamEnvelope`、event payload、safe error、deprecated event 禁用和 traceability 调用语义。
- runtime boundary 设计视图：补充 runtime 发布状态/timeline fact 的职责和非职责。
- Web channel boundary 设计视图：补充 Web channel 只投影、不拥有执行事实的状态可见性边界。
- `openspec/designs/adr/<next-id>-canonical-run-status-visibility.md`：如归档时需要保留长期取舍，使用下一个可用编号记录用户可见状态只从 runtime canonical facts 派生的决策。
- `openspec/designs/spec-to-design-map.md`：新增 `ts-run-status-visibility` 到 architecture/modules/ADR 的导航。

验证入口：
- Contract tests：RunStatus/StreamEventType vocabulary、deprecated event 禁用、status/timeline projection payload。
- Integration tests：请求 accepted 到 terminal 的用户可见 status 和 stream projection 一致。
- Resilience tests：timeline read failure、projection failure、redaction failure、runtime unavailable 和 terminal projection failure 在投影层可见且安全。
- Security tests：owner-scope mismatch、pending input payload 和 safe error 不泄露敏感内容；日志/metric 泄露防护由 observability owning change 继续验证。
