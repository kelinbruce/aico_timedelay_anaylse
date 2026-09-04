## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-7.5 采集指标` | 补齐模型与对话性能分布、排队、并发和异常计数，并修正模型调用的终态唯一计数 | `agent-runtime-metrics` | `FN-7.5 采集指标` |

## `FN-7.5 采集指标`

### 目标与规范依据

本设计满足 proposal 中“从同一安全指标输出直接获得模型、对话、容量与异常统计”的黑盒目标，并保持 canonical observation stream、低基数标签、non-blocking projection 和 local/remote 同义输出边界。

#### 本 Function 的目标 Requirements

canonical spec：`agent-runtime-metrics`

- `MODIFIED`：`Metric inventory 必须声明来源、标签和增强需求`
- `ADDED`：`模型性能指标必须按终态调用提供次数、分布和生成速率`
- `ADDED`：`对话指标必须覆盖终态次数、首字、总耗时、排队、并发和 token 分布`
- `ADDED`：`异常指标必须使用唯一权威终态分类`
- `ADDED`：`非秒数直方图必须使用量纲匹配的固定聚合`

设计约束如下：不新增 `TimelineEventType`，不修改 `agent-contracts`，runtime 不接触 metric name、label 或 OTel 类型；新增执行态事实只通过 app-composed narrow typed observation 进入既有 `ObservabilityProjectorHost`。

### 当前实现

- `TimelineObservationMapper` 已按 run 保存 `REQUEST_ACCEPTED` 时间，按 model invocation 保存开始与首个可见内容状态，并从 canonical timeline 产生 request、model、capability observations。
- `MetricsProjector` 当前把所有非 stream 的 `model_invocation` observation 都映射为 `model_invocation_total`。因此 `MODEL_INVOCATION_STARTED` 与同一调用的 terminal observation 会分别计数。
- model terminal observation 已携带 present `usage`、`durationMs` 和 `firstContentLatencyMs`，但 registry 只将 usage 写入累计 counter；没有单次 token histogram 或 output token rate。
- terminal request observation已携带 accepted-to-terminal `durationMs`；`REQUEST_FIRST_CONTENT_DELIVERED` 已提供 accepted-to-first canonical visible content 时延。当前没有 request 级 usage 聚合。
- `request_phase_duration_seconds` 虽允许 `queued` 与 `executing` label，但当前只在 accepted 写 `0`，在 terminal 把 request 总耗时写成 `terminal_commit`；没有权威 queue exit 样本。
- runtime 以 `executingRuns` 作为当前执行态集合，以 `startAcceptedRun` 固化 `QUEUED -> EXECUTING`，但没有向 observation stream 发布执行态转换；并发数只存在于 runtime 私有状态。
- model、capability 和 gateway observation 已具有低基数 `outcome=timeout`；model failure observation 已保留 canonical safe reason code，可识别 `MODEL_RATE_LIMITED`。terminal request observation目前只保留 terminal status，未保留已有 terminal payload 的 safe code/category。
- `MetricDescriptor` 只允许 unit `1|s|{token}`；metrics SDK 对全部 histogram 无差别应用 seconds boundaries，虽已启用 `recordMinMax=true`，但无法正确承载 token count、token rate 和 concurrency 的量纲。
- 现有 metrics unit tests 覆盖 registry 校验、dedup、基本 request/model samples 和 seconds buckets，但没有断言 started 不增加 model invocation，也没有目标 token、queue、concurrency 和异常场景。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 模型调用按 terminal invocation 恰好计一次 | started 与 terminal 都进入通用 model 分支 | 需要将 invocation/duration/usage/rate 映射限定为 terminal model observation |
| 模型 token 平均/最大/总数与生成速率 | 只有 token counter，未消费 `firstContentLatencyMs` | 需要新增 token histogram 和确定性 rate sample |
| 对话 token 分布 | terminal request 不携带 run 内完整 usage 汇总 | 需要在 timeline mapper 的同步 canonical 输入侧形成按 token type 完整性受控的 run aggregate |
| 排队时间与并发采样 | runtime 持有权威执行态，但 observation stream 不可见 | 需要一个不含 metrics taxonomy 的 execution-state transition handoff |
| 异常终止、timeout、flow control | request failed 可推导，timeout 与 rate limit 尚未投影为目标 counters | 需要按 terminal observation 和 canonical safe code 产生唯一 samples |
| 非秒数 histogram 固定聚合 | 所有 histogram 使用 seconds boundaries，unit 不支持 `{token}/s` | descriptor 需要拥有每个 histogram 的 boundaries 与扩展 unit |
| 文档与代码一致 | developer metrics 清单仍描述已删除的 Web metrics 和 local log sink | 实施完成后需要按代码事实更新开发者清单 |

### 修改方案

#### 1. Descriptor 与 instrument 聚合保持单一来源

扩展现有 `MetricDescriptor`，允许 unit `{token}/s`，并为每个 histogram 声明只读 `boundaries`。descriptor factory 在构造 histogram 时必须提供非空、严格递增、有限且非负的 boundaries；counter 不携带 boundaries。保留 `SECONDS_HISTOGRAM_BOUNDARIES`，新增 token count、token rate 和 concurrency 三组冻结常量。

`createMetricsInfrastructure` 继续只遍历 `METRIC_DESCRIPTORS` 创建 views，但 histogram aggregation 改为读取各 descriptor 的 boundaries；`recordMinMax=true` 保持不变。不得建立第二张 bucket policy 表。现有 seconds histogram 继续引用同一个 seconds 常量，HTTP official instrumentation 继续使用其 own advice，不进入该 inventory。

新增 descriptor 及低基数标签如下：

| Metric | unit | labels | acquisition |
|---|---|---|---|
| `model_token_count` | `{token}` | `token_type=input|output`, model `outcome` | terminal model observation |
| `model_output_token_rate` | `{token}/s` | model `outcome` | terminal model observation |
| `request_token_count` | `{token}` | `token_type=input|output`, request terminal `status` | terminal request aggregate |
| `request_active_concurrency` | `1` | none | execution-state typed observation |
| `request_abnormal_termination_total` | `1` | none | failed request terminal |
| `operation_timeout_total` | `1` | `boundary=request|model|capability|gateway` | corresponding authoritative terminal |
| `model_flow_control_total` | `1` | none | model terminal safe code |

#### 2. Model terminal 投影一次完成

`metricSamplesForObservation` 先处理 model stream timing operations，再只允许 terminal model operations 进入 invocation 分支。terminal 判断采用封闭 operation predicate：`MODEL_INVOCATION_COMPLETED` 以及 mapper 已归一化的 model failure operation；`MODEL_INVOCATION_STARTED` 明确返回空样本。

同一个 terminal observation 一次生成 invocation counter、present duration、present usage counter、present token histogram、可计算的 output token rate、timeout counter 和 rate-limit counter。全部样本继续使用现有 `withMetricIdentity`，同一 timeline fact 下按 metric name 与 labels 分别去重。速率先校验三个输入为有限非负数，再要求 `durationMs > firstContentLatencyMs`；不满足时只省略 rate，不改变其他 samples 或业务结果。

#### 3. Request usage 在 canonical mapper 输入侧聚合

`TimelineObservationMapper` 增加私有 `RequestUsageAccumulator`，trusted source 是 mapper 同步收到的 canonical timeline records，owner 是 `agent-observability`：

| 字段 | 类型 | 初始值 | 约束与映射 |
|---|---|---|---|
| `terminalModelCount` | non-negative safe integer | `0` | 每个 `MODEL_INVOCATION_COMPLETED|FAILED` 增加一次 |
| `inputTokens` | non-negative safe integer | `0` | 仅累加 present `usage.inputTokens`，加法溢出则令 `inputComplete=false` |
| `outputTokens` | non-negative safe integer | `0` | 仅累加 present `usage.outputTokens`，加法溢出则令 `outputComplete=false` |
| `inputComplete` | boolean | `true` | 任一 terminal model 缺失或非法 input usage 后固定为 `false` |
| `outputComplete` | boolean | `true` | 任一 terminal model 缺失或非法 output usage 后固定为 `false` |
| `terminalEventIds` | `Set<string>` | empty | 以 canonical `timelineEventId` 去重；重复 terminal model record 不重复计数或累加 |

`REQUEST_ACCEPTED` 创建或重置 accumulator。首次出现的 model terminal event 更新 accumulator；相同 `timelineEventId` 的重复 record、started 和 stream events 不更新。request terminal 在清理状态前，只把 `terminalModelCount>0` 且对应 `*Complete=true` 的 token sum 放入 terminal observation 的 `usage`。terminal 后删除 accumulator。缺少 accepted state 的 replay 不创建 request usage，以避免把局部 replay 误报为完整对话统计。

Metrics projector 在 terminal request 分支从该 `usage` 生成 `request_token_count`，不另建第二套 usage accumulator。这样即使 projector queue 内多个 observations 异步处理，request aggregate 仍由 mapper 在 canonical 顺序上一次闭合；若 terminal observation 被 host 丢弃，request samples整体不产生，不会产生部分 token 总数。

#### 4. Runtime execution-state 使用窄 typed handoff

在 `agent-runtime` 现有 lifecycle 目录内定义 implementation package public type `RunExecutionStateTransition` 和可选 listener；它不是 `agent-contracts` contract。数据只包含 trusted identity/Agent/run refs、`transition=ENTERED|LEFT`、`occurredAt`、optional `queueDurationMs` 和状态转换完成后的 `activeCount`：

| 字段 | 类型与约束 | trusted source |
|---|---|---|
| owner/run refs | 既有 branded ids，required | accepted command identity 与固化 `RequestRun` |
| `transition` | `ENTERED|LEFT`，required | runtime 执行态集合变更方向 |
| `occurredAt` | `EpochMillis`，required | runtime injected clock；ENTERED/LEFT 均使用集合转换完成时刻 |
| `queueDurationMs` | finite non-negative number，ENTERED normal path optional | `max(0, ENTERED.occurredAt - run.createdAt)`；recovery/resume 没有完整 accepted 边界时省略 |
| `activeCount` | non-negative safe integer，required | 当前 app runtime 实例的 `executingRuns.size` after mutation |

runtime 用两个私有 helper 作为 `executingRuns.set/delete` 的唯一写入口。helper 在集合实际发生变化后同步通知 listeners；重复 set/delete 不通知。listener failure 被逐个捕获，不回滚 runtime state，也不改变 scheduler。normal `QUEUED -> EXECUTING` 传 queue duration；recovery/resume 只传 transition 与 active count。现有所有进入、pending-input 暂停、取消、恢复、终态和 recovery cleanup 路径统一改走这两个 helper。

`agent-app` composition 注入一个 listener，调用 `agent-observability` 的 typed adapter，将 transition 映射为：

- `ENTERED` → `boundary=request_lifecycle, operation=REQUEST_EXECUTION_STARTED, outcome=success`；present queue duration 放入 `durationMs`。
- `LEFT` → `boundary=request_lifecycle, operation=REQUEST_EXECUTION_ENDED, outcome=success`。
- `activeCount` 作为允许的 non-negative numeric diagnostic candidate；owner scope 与 stable refs 来自 trusted transition，禁止进入 labels。

Metrics projector 对 `REQUEST_EXECUTION_STARTED` 的 present duration 记录 `request_phase_duration_seconds{phase=queued,status=success}`，并对 ENTERED/LEFT 均记录 `request_active_concurrency`。该方案复用统一 host，runtime 不 import `agent-observability`，也不新增 durable timeline event。

#### 5. 异常分类只消费权威终态

- request terminal status 为 `FAILED` 时增加 `request_abnormal_termination_total`。mapper 同时从既有 terminal inline payload 安全读取 canonical safe code/category 并放入 safe reason/candidate；terminal observation outcome 继续保持 `failure`，不改变 LOG/TRACE 等其他 surface 的既有语义。metrics projector 仅在 category 为 `TIMEOUT` 或 code 为 `PENDING_INPUT_TIMEOUT` 时增加 `operation_timeout_total{boundary=request}`。
- model、capability、gateway terminal observation 的 outcome 为 timeout 时，各自增加一个 `operation_timeout_total`，boundary 取其 descriptor allowlist 值。started、stream timing、free-text 和上层转述不进入该 predicate。
- terminal model observation 的 `safeReasonCode === MODEL_RATE_LIMITED` 时增加 `model_flow_control_total`。该判断与 request 是否 fallback 成功解耦。

request timeout 分类只在 metrics projector 消费 canonical safe code/category 时成立，不修改 observation outcome、`RunStatus`、timeline record、stream projection、SafeError 或其他 surface。

#### 6. 保留与明确不修改的边界

- 保留 `ObservabilityProjectorHost`、single descriptor inventory、16,384-key projector dedup、OTel MeterProvider/reader/exporter 和 local history schema。
- 不修改 public Web API、SSE/WebSocket schema、frozen core vocabulary、scheduler capacity、retry/fallback 或 terminal commit。
- 不把 request/run/session/tenant/subject/agent/model/provider identity 加入 metric labels。
- developer metrics 文档只同步最终 inventory、聚合查询方式与 canonical acquisition semantics，不成为规范来源。

#### 备选方案（Alternatives Considered）

- 用 `PLANNING_STARTED` 推断 queue exit：无需 runtime handoff，但会把执行前 hook/context 工作算入排队，且 pre-planning terminal 无法区分“未执行”与“执行失败”，不满足确定测量边界，因此不采用。
- 新增 durable `TimelineEventType` 表达 execution transition：可重放，但会扩大 frozen core、persistence 与 stream contract，而这些事实只服务实时容量指标；规范明确禁止为采集该指标新增 timeline type，因此不采用。
- 在 frontend 上报浏览器 paint：能够测量设备端体验，但需要新增 public telemetry API、可信度与采样治理，超出本 change 已冻结的 canonical stream 首字边界，因此不采用。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 性能/容量 | `非秒数直方图必须使用量纲匹配的固定聚合` | descriptor-owned 固定桶；transition listener 同步工作只构造 bounded object 并投递 non-blocking host | unit/boundary/min-max 一致；高并发下不改变 scheduler |
| 安全 | 无新增黑盒质量目标；沿用 stable label/redaction Requirements | typed transition 的 refs 只作 stable refs，labels 只取固定枚举；usage 只含 counts | 禁止高基数 label、prompt/content/path/credential 泄漏 |
| 可靠性/恢复 | 无新增黑盒质量目标；沿用 stable metrics non-blocking Requirements | listener/projector/exporter 失败不改变 execution transition、terminal 或 recovery；recovery 缺 queue 起点时省略 queue sample | listener throw、registry unavailable、缺失字段的业务非回归 |
| 可测试性 | 无新增黑盒质量目标 | injected clock、typed transition listener、in-memory registry 与 deterministic descriptor constants | normal/boundary/negative scenarios 可重复断言 |

## 验证策略（Verification Strategy）

- unit 层验证 descriptor units/boundaries、terminal-only model mapping、rate 公式、request usage completeness、异常 predicates、queue/concurrency samples 和 dedup；断言输出 metric contract，不锁定无关私有控制流。
- runtime characterization 层覆盖 normal dispatch、pending-input/terminal leave、recovery/resume 和 listener throw，证明每次真实执行态集合转换恰好通知一次且 scheduler/terminal truth 不受影响。
- app integration 层验证 runtime typed transition 经 composition 进入同一个 projector host，并与 timeline-derived request/model samples共同输出；禁止 runtime 直接依赖 metric taxonomy。
- exporter/SDK contract 层验证每个 histogram 从 descriptor 使用正确 unit、boundaries 与 `recordMinMax`，local/remote composition 不改变聚合语义。
- architecture 层触发并断言 `agent-contracts` 无 metric/runtime transition 类型、业务 package 无 OTel 或 metric name import、未新增 `TimelineEventType`、labels 不含高基数字段。
- negative cases 覆盖 started model 不计数、缺 usage/invalid interval 不补样本、partial request usage 不汇总、pre-execution terminal 不伪造 queue、重复 transition 不采样、free-text timeout 不分类、listener/registry failure non-blocking。
- 全量 build、unit、contract、architecture 与 strict OpenSpec gate 用于证明最小内核和既有 observability 行为无回归。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/agent-runtime-metrics/spec.md`：合并本 change 的 MODIFIED/ADDED Requirements，并移除 inventory 中已被 official HTTP requirement 废止的 legacy Web rows。
- `openspec/designs/functions/D7-可观测与审计/D7.2-追踪与指标/FN-7.5-采集指标.md`：刷新描述、处理过程、结果与关键运行指标规格。
- `openspec/designs/features/D7-可观测与审计/D7.2-追踪与指标/F-7.4-运行指标.md`：刷新容量/性能与异常分类的用户可依赖质量保证。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/observability-boundaries.md`：补充 execution-state narrow typed handoff、request usage aggregate 与 descriptor-owned multi-unit histogram 边界。
- `openspec/designs/modules/agent-observability.md`：补充 terminal-only model projection、request aggregate、异常分类和多量纲 descriptor。
- `openspec/designs/modules/agent-runtime.md`：补充 metrics-agnostic execution-state transition listener 边界。
- ADR：无；本 change 沿用既有 unified observation 与 descriptor-owned registry 决策。
- `openspec/designs/spec-to-design-map.md`：更新 `agent-runtime-metrics` 的设计落点与验证入口。

## 风险与取舍（Risks / Trade-offs）

- 并发平均值是按执行态转换采样的算术平均值，不反映状态持续时间；通过 metric 语义和开发者文档明确该口径，避免被解释为时间加权平均。
- request usage 要求每个 terminal model invocation 对目标 token type 完整，可能在 provider usage 缺失时减少样本数量；这是避免把部分和误报为真实总数的有意取舍，model-level present usage 仍保留。
- 新增 histogram 会增加固定 instrument 与 time-series 数量；所有新增 labels 均为无标签或封闭低基数值，沿用每 instrument cardinality 200 上限。
- runtime helper 收敛现有 `executingRuns` 写入口会触达多条 lifecycle path；以 characterization tests 覆盖真实集合转换和重复操作，禁止借机改变调度或恢复语义。

## 待确认问题（Open Questions）

无。
