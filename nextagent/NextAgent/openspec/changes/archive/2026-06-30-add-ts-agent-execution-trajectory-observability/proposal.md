## 背景与问题（Why）

当前 NextAgent 已经具备 request lifecycle、model invocation、capability invocation、terminal commit、runtime log、structured observability log 和 audit log 等多条诊断链路，能够回答“请求是否执行”“模型和工具是否运行”“终态是否提交”。但对于电信网络任务中的完整复盘需求，这些信号仍然是分散的：

- `nextagent-runtime.log` 更偏运行编排过程，能看到 queue、dispatch、tool call 和 terminal commit，但缺少统一的轨迹骨架和上下文/能力选择决策节点。
- `nextagent-observability.log` 已经承接 `ObservabilityObservationEvent`，但当前 coverage 更偏 request/model/capability/gateway 诊断，尚未形成“本轮如何组上下文、为何选择某个 capability、何时开始产生用户可见输出”的连续轨迹。
- `nextagent-audit.log` 保留的是可审计的 durable 事实，不适合作为完整 agent 轨迹复盘主视图。

电信网络运维和诊断任务需要的不只是执行成败，还需要回答：

- 这次任务如何组装上下文、是否发生压缩或退化。
- 模型之后如何选择 capability，是否进入 sandbox，执行结果如何反馈到后续轮次。
- 何时开始出现用户可见输出，以及最终如何收束到 terminal outcome。

在现有实现中，这些轨迹点部分存在于 runtime 私有日志、部分存在于 timeline、部分存在于 observation，但没有统一契约，因此无法稳定支持“完整复盘 agent 在一次任务里怎么思考、怎么选工具、怎么组上下文、怎么走到终态”的目标。

本 change 的必要性在于：在不记录 raw prompt、raw model output 或 chain-of-thought 的前提下，为 agent 执行过程定义一套安全、低基数、可复盘的轨迹事件模型，并把它接入现有 timeline / observation / logging 边界。

## 变更范围（What Changes）

- 新增一套面向复盘的 `agent-execution-trajectory` capability，定义首版 request 轨迹中的 context assembly、capability selection、sandbox execution 和 first visible model content 对齐的最小轨迹事件模型。
- 规定哪些轨迹点属于 runtime-owned canonical / live-only timeline facts，哪些只作为 observation-derived structured diagnostics，不新增第二套 event bus。
- 规定轨迹点只记录安全摘要、稳定 refs、低基数 reason code 和阶段结果；不得记录 raw prompt、raw model output、raw tool args/result、free text reasoning、provider raw payload、路径、credential 或 token。
- 规定 `nextagent-observability.log` 作为 agent 轨迹复盘主视图，`nextagent-runtime.log` 继续承载编排/运行诊断，`nextagent-audit.log` 仅保留审计事实，不把全部轨迹点写入 audit。
- 规定 HTTP / gateway、request lifecycle、context assembly、model invocation、capability selection、sandbox execution、first visible model content 和 terminal outcome 的关联必须优先使用 `sessionId`、`requestRunId`、`requestId`、`requestContextId` 和 `capabilityInvocationId`，不引入 trace SDK 字段作为业务主键。
- 规定新增轨迹信号不得改变 request lifecycle、stream projection、terminal commit、capability invocation、gateway response 或 health response；轨迹投影失败只产生 bounded degradation evidence。
- 规定本 change 不引入新的 memory/task trajectory durable store，不替代 `add-ts-task-trajectory` 的长期学习输入 read model。

## Capability 影响（Capabilities）

### 新增 Capability
- `agent-execution-trajectory`: 定义 agent 执行过程首版的安全轨迹骨架，包括 context assembly、capability selection、sandbox execution、first visible model content 对齐以及各日志 surface 的职责边界。

### 修改的 Capability
- `trace-log-linking`: 增加 agent execution trajectory 事件必须进入统一 `ObservabilityObservationEvent` stream 的输入规则和 source precedence。
- `structured-logging`: 扩充 LOG coverage inventory，使 `nextagent-observability.log` 成为 agent 轨迹复盘主视图，并声明新增 trajectory events 的 structured log 映射。
- `runtime-logging`: 收敛 runtime 直接日志与 observation-derived trajectory log 的职责分工，明确哪些运行诊断继续留在 runtime log，哪些应迁移为 trajectory observation。

## 影响范围（Impact）

- `agent-runtime`：补充或增强 runtime-owned trajectory facts 的发布点，但不得拥有 observability surface 选择权。
- `agent-core`：在 agent loop 和 capability selection 边界产出安全 trajectory input。
- `agent-context-engine`：补充 context assembly / budget / compaction 的安全 trajectory 摘要输入。
- `agent-capability` 与 sandbox 入口：补充 capability selection 和 sandbox execution 的安全 trajectory 摘要输入。
- `agent-observability`：扩充 `ObservabilityObservationEvent` coverage、structured log mapping、trajectory event vocabulary 和 redaction/assertion tests。
- `agent-app`：通过现有 composition-time listener / wrapper / projector host 接线新增轨迹点，不新增并行 observability bus。
- `agent-channel-web`：不拥有 request lifecycle 或轨迹真相；首版 first-visible-content 对齐由 model wrapper observation 承担，不新增 channel-owned trajectory fact。
- `nextagent-runtime.log`、`nextagent-observability.log`、`nextagent-audit.log` 的职责边界、日志密度和排障方法将受到影响。
- 验证面需要增加 characterization、contract、architecture 和 observability tests。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/agent-execution-trajectory/spec.md`：新增 agent execution trajectory 行为契约。
- `openspec/specs/trace-log-linking/spec.md`：补充 trajectory 事件进入 observation stream 的输入规则。
- `openspec/specs/structured-logging/spec.md`：补充 trajectory structured log coverage 和职责边界。
- `openspec/specs/runtime-logging/spec.md`：补充 runtime log 与 trajectory log 的分工。

长期背景：
- `openspec/overview.md`：补充“agent 执行轨迹可复盘”作为本地运维诊断和质量分析能力的长期背景。

设计视图：
- `openspec/designs/architecture/observability.md`：补充 agent trajectory、timeline、runtime log、structured log、audit 之间的跨模块流程和职责分工。
- `openspec/designs/architecture/runtime.md`：补充 runtime 发布 trajectory-owned live-only / canonical facts 的边界。
- `openspec/designs/modules/agent-observability.md`：补充 trajectory event vocabulary、projector 映射和 redaction owner。
- `openspec/designs/modules/agent-runtime.md`：补充 runtime 不拥有 surface 选择、只发布事实的边界。
- `openspec/designs/adr/agent-execution-trajectory-safe-diagnostics.md`：记录“不记录 raw CoT，只记录安全决策轨迹”的长期取舍。
- `openspec/designs/spec-to-design-map.md`：增加 `agent-execution-trajectory` 到相关 architecture/modules/ADR 的导航。

验证入口：
- characterization tests：request run tool-use / terminal path 的轨迹复盘。
- observability tests：trajectory structured log / audit boundary / degradation behavior。
- architecture tests：runtime/core 不引入第二套 trace/log event carrier，不泄漏 raw reasoning 或 tracing SDK 字段。
