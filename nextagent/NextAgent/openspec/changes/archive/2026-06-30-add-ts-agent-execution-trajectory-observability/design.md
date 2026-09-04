## 背景和现状（Context）

当前 NextAgent 已具备三类与轨迹相关的事实面：

- `agent-runtime` 及 `nextagent-runtime.log` 提供 queue、dispatch、model execute、tool call、terminal commit 等运行编排诊断。
- `agent-observability` 通过 `ObservabilityObservationEvent -> ObservabilityProjectorHost -> StructuredLogProjector/AuditProjector/MetricsProjector/TraceProjector` 提供 request/model/capability/gateway 等统一观测面。
- `agent-channel-web` 通过 stream projection 将 timeline event 投影为用户可见 SSE/WebSocket 事件。

这些信号可以解释“请求是否跑完”，但不能稳定解释“agent 如何推进任务”。当前缺口集中在四段：

1. 缺少 turn 级骨架，导致多轮 request 复盘只能靠时间戳和零散 stepId。
2. 缺少 context assembly 决策轨迹，无法说明为何压缩、为何继续、为何退化。
3. 缺少 capability selection 与 sandbox execution 的显式区分，执行结果存在但决策时刻缺失。
4. 缺少 user-visible output 与内部执行之间的统一对齐点。

同时仓库约束禁止记录 raw prompt、raw model output、stream delta、raw tool args/result、free-text reasoning 和 tracing SDK 字段，因此“怎么思考”的复盘不能依赖原始 CoT，只能依赖安全的代理性决策轨迹。

相关方包括：

- Runtime/Core owner：发布 request 内部阶段事实，但不拥有 observability surface 选择。
- Context Engine owner：提供 context 决策摘要。
- Capability/Sandbox owner：提供 capability selection 和受限执行阶段摘要。
- Observability owner：统一 event vocabulary、structured log projection 和 redaction。
- Channel owner：继续只负责 transport 和 stream projection，不拥有轨迹真相。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 在现有 timeline / observation / logging 边界上补齐可复盘的 agent 执行轨迹骨架。
- 为一次 request 定义最小统一复盘序列：turn、context assembly、capability selection、sandbox execution、visible output、terminal。
- 让 `nextagent-observability.log` 成为 agent 轨迹复盘主视图，同时保持 `nextagent-runtime.log` 的运行编排职责不变。
- 保持所有新增轨迹点 non-blocking，失败时只产生 bounded degradation evidence。
- 严格禁止 raw prompt、raw model output、raw tool args/result、path、secret、credential、trace SDK 字段泄漏到轨迹日志。

**非目标：**

- 不新增第二套 trace / log / audit event carrier。
- 不把全部 trajectory event 持久化进 audit。
- 不引入 memory/learning 领域的 `TaskTrajectoryRecord` 或修改 `add-ts-task-trajectory` 的 durable store。
- 不记录原始 CoT、自由文本思维或 provider-side reasoning。
- 不调整 gateway 实现、transport 语义或 terminal commit owner。

## 设计决策（Decisions）

### 决策 1：采用“统一轨迹模型 + 分层事实来源”，不引入新总线

选定路径：首版 `agent-execution-trajectory` 统一定义以下已落地轨迹点：

- `CONTEXT_ASSEMBLY_COMPLETED`
- `CAPABILITY_SELECTED`
- `SANDBOX_EXECUTION_COMPLETED`
- `MODEL_STREAM_FIRST_VISIBLE_CONTENT`

这些轨迹点全部进入现有 `ObservabilityObservationEvent` stream；LOG/AUDIT/METRIC/TRACE surface 都只消费这条统一 stream，不引入第二套 carrier。

放弃路径：
- 不新增独立 `TrajectoryEvent` bus。
- 不让 runtime log、audit log 或 OTel exporter 单独持有 trajectory 专有输入。
- 不把 replay 能力建立在 raw runtime debug logs 上。

### 决策 2：turn 与 visible-output 对齐点优先使用 runtime-owned live-only / canonical timeline facts

选定路径：

- 首版不引入独立 `AGENT_TURN_STARTED` / `AGENT_TURN_COMPLETED` runtime fact；request 级 replay 先使用 `requestRunId`、`requestContextId` 和 `capabilityInvocationId` 串起主路径。
- 可见输出起点首版使用 model wrapper 发出的 `MODEL_STREAM_FIRST_VISIBLE_CONTENT` observation；其 owner 在 model invocation wrapper 边界，而不是新增独立 stream timeline fact。
- 已由 timeline 拥有的 trajectory fact 进入 observation 时，优先走 `timelineObservationMapper`，避免 wrapper 重复发射。

放弃路径：
- 不由 `StructuredLogProjector` 自己根据已有 log 推断 turn。
- 不由 metrics 或 trace surface 反向推导 visible output start。

### 决策 3：context assembly、capability selection、sandbox execution 使用安全摘要 observation，不强制新增 durable timeline

选定路径：

- `CONTEXT_ASSEMBLY_COMPLETED` 由 `agent-context-engine` 在完成 budget/compression 决策后，通过 approved diagnostic producer 发出 observation。
- `CAPABILITY_SELECTED` 由 `agent-core` 在已选中 descriptor、尚未进入执行器前发出 observation。
- `SANDBOX_EXECUTION_COMPLETED` 由 sandbox owner 在受控执行返回后发出 observation。

这些轨迹点首版不要求都进入 durable timeline；只要保证它们通过 observation stream 进入 structured trajectory log 即可。后续若某个点被证明需要成为 canonical runtime fact，必须由其 owner change 升格。

放弃路径：
- 不为了 coverage 强行把所有轨迹点都持久化成 timeline event。
- 不在 observability 层凭运行日志文本解析出这些轨迹点。

### 决策 4：统一稳定关联键，禁止 trace SDK 字段作为业务主键

选定路径：所有 trajectory 点的主关联键统一使用：

- `sessionId`
- `requestRunId`
- `requestId`
- `requestContextId`
- `capabilityInvocationId`

首版不新增 `turnIndex`；`stepId` 也不升级为稳定 trajectory public ref。`traceparent`、`traceId`、`spanId` 仍然只可作为后续 trace surface 的补充诊断，不可成为 trajectory replay 主关联键。

放弃路径：
- 不新增 `TraceDiagnosticRecord`
- 不在 contracts/runtime/core/gateway 中暴露 trace SDK 类型

### 决策 5：`nextagent-observability.log` 作为复盘主视图，`nextagent-runtime.log` 只保留编排诊断

选定路径：

- `nextagent-observability.log` 承接完整 trajectory structured logs，成为人工复盘主视图。
- `nextagent-runtime.log` 保留 queue/dispatch/model execute/tool call/terminal commit/risk policy/context budget 等运行编排诊断，但不承担完整 trajectory replay 真相。
- `nextagent-audit.log` 只继续记录 durable audit facts；turn/context assembly/capability selection/sandbox execution/visible output 这些轨迹点默认不全部进入 audit。

放弃路径：
- 不把 runtime log 继续扩成完整复盘日志。
- 不把所有 trajectory 点都写入 audit，避免 durable 审计面膨胀。

### 决策 6：安全“思考轨迹”只记录代理性决策，不记录原始思维

选定路径：trajectory 点只允许记录安全、低基数的决策摘要，例如：

- `selectionReasonCode`
- `budgetDecision`
- `compressionMode`
- `degradationModeCount`
- `omittedContextTypesCount`
- `commandKind`
- `outcome`
- `reasonCode`

不得记录：

- raw prompt
- raw model output
- raw tool args/result
- free-text reasoning
- attachment content
- provider raw payload
- path
- credential/token/secret

这条规则由 `agent-observability` redaction/assertion 统一执行。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | trajectory 只记录稳定 refs 和低基数决策摘要；禁止 raw prompt、raw output、free-text reasoning、path、credential、token、trace SDK 字段泄漏。 | redaction/observability tests；architecture tests |
| 性能/容量 | 不引入第二套 bus；尽量复用现有 timeline listener 和 observation host；durable timeline 只覆盖必要事实，其余走 live-only observation，避免日志和持久化同时膨胀。 | characterization tests；log density assertions |
| 可靠性/恢复 | 所有 trajectory 发射和投影均 non-blocking；投影失败只产出 degradation evidence，不影响 request lifecycle、terminal commit 和 stream projection。 | resilience/integration tests |
| 可维护性 | runtime/core/context/capability/sandbox 各自产生自己拥有的事实；observability 只负责统一 vocabulary 和 projection，不反向推断业务真相。 | architecture tests；code review 检查点 |
| 可测试性 | 每类 trajectory 点都有明确 owner 和可观察输出；可通过 timeline listener、structured log transport fake、runtime log transport fake 做 deterministic tests。 | unit/integration/characterization tests |
| 审计/可追溯性 | 复盘主视图在 `nextagent-observability.log`；audit 仅保留 durable 审计事实；trajectory replay 优先使用稳定业务 ids，不依赖 trace SDK。 | observability replay tests；audit boundary tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| turn 级轨迹骨架必须可复盘 | 1.1, 3.1 | characterization tests for multi-turn request |
| context assembly 只输出安全摘要 | 1.2, 3.2 | observability/redaction tests |
| capability selection 与 sandbox execution 必须分离可见 | 1.3, 3.1 | integration tests with tool/sandbox path |
| visible output 起点必须与内部执行对齐 | 1.4, 3.1 | stream/history consistency characterization tests |
| trajectory 失败不得影响主路径 | 2.3, 3.3 | degradation/resilience tests |
| runtime log 与 trajectory log 保持职责分离 | 2.2, 3.4 | log contract tests + code review |
| 禁止第二套 event carrier 与 trace SDK 泄漏 | 2.4, 3.4 | architecture tests |

## 文档承载决策（Documentation Ownership）

- 行为契约：
  - `openspec/specs/agent-execution-trajectory/spec.md`
  - `openspec/specs/trace-log-linking/spec.md`
  - `openspec/specs/structured-logging/spec.md`
  - `openspec/specs/runtime-logging/spec.md`
- 架构和跨模块设计：
  - `openspec/designs/architecture/observability.md`
  - `openspec/designs/architecture/runtime.md`
- 模块设计：
  - `openspec/designs/modules/agent-observability.md`
  - `openspec/designs/modules/agent-runtime.md`
  - `openspec/designs/modules/agent-core.md`
  - `openspec/designs/modules/agent-context-engine.md`
- ADR：
  - `openspec/designs/adr/agent-execution-trajectory-safe-diagnostics.md`
- 导航：
  - `openspec/designs/spec-to-design-map.md`

同一 trajectory event vocabulary 的主承载是 `agent-execution-trajectory` spec；具体模块如何发布这些事件的 owner 边界由 architecture/modules 文档承载，避免在多个 spec 中重复定义字段语义。

## 风险与取舍（Risks / Trade-offs）

- [trajectory 点过多导致日志膨胀] -> 只新增最小 replay skeleton；优先 observation、最小 durable；继续过滤低价值 metric mirror。
- [runtime 与 observability 边界再次混杂] -> 明确 runtime 只产出事实，observability 只做 vocabulary/projection。
- [为了解释“思考”而越界记录 CoT] -> 只允许安全代理性决策字段，禁止 free-text reasoning。
- [所有轨迹点都做 durable timeline 导致 owner 扩张] -> 首版只把必要 replay 骨架做 runtime-owned 事实，其余保留 live-only observation。
- [channel 反向拥有轨迹真相] -> visible output 对齐点允许由 channel/runtime 边界提供，但 owner 不迁移给 `agent-channel-web`。

## 迁移计划（Migration Plan）

无数据迁移。该 change 只新增 trajectory 行为契约和对应实现挂点。启用后：

- 新请求开始产生新的 trajectory structured logs。
- 旧日志文件不回补。
- 若局部轨迹点尚未实现，必须在 active change 中作为 gap 显式列出，不能由日志文本拼接替代。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/agent-execution-trajectory/spec.md`：新增稳定 trajectory contract。
- `openspec/specs/trace-log-linking/spec.md`：同步 trajectory input 进入 shared observation stream 的规则。
- `openspec/specs/structured-logging/spec.md`：同步 trajectory structured log coverage。
- `openspec/specs/runtime-logging/spec.md`：同步 runtime log 与 trajectory log 的职责分离。
- `openspec/overview.md`：补充 agent trajectory replay 的长期背景。
- `openspec/designs/architecture/observability.md`：沉淀 trajectory / timeline / runtime log / audit 的跨模块流程。
- `openspec/designs/architecture/runtime.md`：沉淀 runtime 发布 trajectory fact 的 owner 边界。
- `openspec/designs/modules/agent-observability.md`：沉淀 trajectory projection 和 redaction owner。
- `openspec/designs/modules/agent-runtime.md`、`agent-core.md`、`agent-context-engine.md`：沉淀各自产生 trajectory 输入的边界。
- `openspec/designs/adr/agent-execution-trajectory-safe-diagnostics.md`：记录不用 raw CoT、只用安全决策摘要的长期取舍。
- `openspec/designs/spec-to-design-map.md`：新增导航。

## 待确认问题（Open Questions）

1. `AGENT_TURN_*` 与稳定 turn ref 不在首版实现内；若未来确需 turn-based public skeleton，必须由 owning change 再定义唯一 owner 和 fact source。
2. 可见输出起点首版收敛为 `MODEL_STREAM_FIRST_VISIBLE_CONTENT` model wrapper observation，不新增独立 `STREAM_VISIBLE_OUTPUT_STARTED` runtime/channel vocabulary。
