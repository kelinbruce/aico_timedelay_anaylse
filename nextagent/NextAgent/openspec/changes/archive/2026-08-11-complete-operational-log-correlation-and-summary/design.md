## 设计范围

| Function | 目标变化 | Delta spec | 设计章节 |
|---|---|---|---|
| `FN-7.1 输出结构化日志` | 补齐 operational log 的可信 trace 关联、request terminal 汇总、error/message 身份和 deployment/package identity | `specs/runtime-logging/spec.md` | `FN-7.1 输出结构化日志` |

本 change 严格依赖 `refine-local-runtime-diagnostic-visibility`。前置 change 先完成 Tool/Model 原始输入输出、`rawExceptionData` 和精确字段分类；本 change 不重述其 Requirement，不与其并行归档。`udsGateway.call.start`、`udsGateway.call.complete` 的频率、level、采样和抑制不在设计范围。

本 change 同时是对 `observability-boundaries.md` 既有 trace/log linking 规则的窄范围 architecture refinement：稳定 business refs 继续是跨 surface 主关联键，trace identifier 仍不进入 observation shape、public contract 或普通 projector；仅允许 trusted timeline span snapshot 通过进程内 sidecar 到达 LOG projector 和 local runtime writer。该 refinement 不改变 runtime timeline truth、trace owner 或 public contract。

## FN-7.1 输出结构化日志

### 目标与规范依据

本 Function 使本地运维人员可以从现有 operational physical destination 串联复杂请求、读取可信 terminal 汇总、定位错误分类并识别实际部署和 package owner，同时保持 observation-derived 与 local runtime diagnostic 的信任边界。

本 Function 的唯一 canonical spec 是 `openspec/specs/runtime-logging/spec.md`。本 change 新增以下目标 Requirements：

- `ADDED`：`Operational entry 使用可信执行关联坐标`
- `ADDED`：`Request terminal entry 提供可验证汇总`
- `ADDED`：`Error 和 structured event 使用单一诊断身份`
- `ADDED`：`Operational entry 使用真实 deployment 和 package identity`

### 当前实现

- `TimelineSpanLifecycle` 已在 timeline persistence 前移除 caller `trace`，并把可信 OTel span snapshot 写入私有 `inlinePayload.trace`；request、Model 和 Capability span 的 start/terminal 已形成稳定配对。
- `createTimelineObservationMapper()` 把 timeline record 映射为 `ObservabilityObservationEvent`，`ObservabilityProjectorHost` 在入队前执行统一 sanitization，`StructuredLogProjector` 再写入 observation logger。当前 sanitized observation 和 `StructuredLogEntry` 都不携带 trace 坐标。
- direct runtime logger 由 `agent-common` 提供结构 contract、`agent-app` 绑定 provider、`agent-log` 写 physical entry。当前 writer 会净化 caller 字段，但没有 execution-bound correlation context。
- timeline mapper 已维护 request/model 时序状态并读取 Model usage；structured log projector 当前逐事件无状态投影，terminal 只输出 event、safe reason 和单次 observation 已有字段。
- `agent-log` 已区分 `runtime_diagnostic`、`observation_derived` 和独立 Fastify native access writer；稳定 event 仍会生成 `msg`，error entry 不保证低基数诊断分类。
- `agent-app` 的 observability composition 仍把 `1.0.0` 作为缺失或非法 service version 的 fallback。local/remote runtime package 已能从 validated manifest 生成 candidate-aware version。
- 部分 product logger 把 adapter 或 composition role 写入 `component`，没有统一的 package-owner architecture gate。

### GAP 分析

- 可信 trace snapshot 存在于 timeline 私有 payload，但在进入 physical log 前丢失；直接把它加入 `ObservabilityObservationEvent` 会把高基数执行标识扩散到 audit、metric 和其它 projector，违反既有边界。
- direct payload/error log 与 timeline span 同处 execution boundary，但 writer 无法读取该 boundary 的可信 span context，只能接受 caller 字段；信任方向错误。
- terminal projection 没有 per-run accumulator，无法区分“真实为零”和“投影未观察到来源”，也无法对重复 timeline event 去重。
- structured event 的 `event` 与 Pino `msg` 重复表达身份；无分类 error 只能依靠 message 猜测。
- composition fallback 掩盖 deployment metadata 缟失，非 package component 使跨包检索和版本定位不稳定。

### 修改方案

#### 1. 可信 correlation sidecar

唯一实施路径是在既有执行和投影路径上增加只在进程内可见的 correlation sidecar，不修改 public contract：

1. `agent-common` 的 runtime logging 边界增加只读 `RuntimeLogCorrelation` 和 `AsyncLocalStorage` helper。字段只允许有效 `traceId`、`spanId`；helper 不接受任意附加字段。
2. `TimelineSpanLifecycle.withExecutionRef()` 在找到可信 active/closed span entry 后，以该 snapshot 包裹既有 operation。Runtime request owner 把 queued execution、terminal commit 与 caught execution exception 放入现有 request execution ref；Model/Tool owner把 payload capture、caught exception 和对应 terminal event emission 放入各自现有 execution ref，不新增第二套 wrapper。`agent-log` 的 runtime-diagnostic bound logger 在每次 write 时读取 sidecar、忽略 caller 提交的 trace 字段，并把 sidecar 中的值写入最终 entry。
3. timeline observation 路径不修改 `ObservabilityObservationEvent`。`agent-observability` 提供内部 correlation registry，以 observation object identity 关联从可信 `inlinePayload.trace` 验证得到的 `traceId`、`spanId`；timeline mapper 在创建 lifecycle observation 时完成绑定。
4. `ObservabilityProjectorHost` sanitization 后把 correlation binding 转移到 sanitized object。只有 `StructuredLogProjector` 读取它并写入 `StructuredLogEntry`；audit、metric、trace projector 接口和输入 shape 不变。
5. `agent-log.getObservationLogger()` 只信任经校验的 projector trace 字段；普通 `getLogger()` 始终忽略 caller trace 并只使用当前 runtime correlation sidecar。

该路径复用现有 timeline span owner、projector host 和 physical writer，不引入第二套 trace registry、public DTO 或 `agent-contracts` 变更。Tracing 关闭或 sidecar 不存在时直接省略字段。

#### 2. Request terminal accumulator

`StructuredLogProjector` 按 `runId` 维护有界 `RequestLogSummaryAccumulator`，因为它是唯一知道“哪些 observation 实际到达 LOG surface”的 owner。每个 run 只保存：是否观察 accepted、已开始/已终止 Model invocation key、已处理 timeline event id、三个 usage 可选累加值、usage completeness、唯一 Capability invocation id 集合和 queue-drop marker。

- `REQUEST_ACCEPTED` 创建或重置 accumulator。
- Model started 记录 invocation key；Model completed/failed 以 `timelineEventId` 去重并闭合 started。成功 completed 只有三个 usage 字段均为非负 safe integer 时才保持 usage complete；缺字段或无对应 started 时标记 partial。失败 Model terminal 闭合 invocation，但不伪造 usage。
- `CAPABILITY_STARTED` 仅在存在唯一 `capabilityInvocationId` 时加入集合；重复 id 不增加计数。
- host queue overflow 时调用 projector 的内部 `onObservationDropped(event)` hook；LOG projector 对可识别 run 设置 drop marker。该 hook 不改变其它 projector contract outcome。
- terminal 到达时先计算 `status`、已知 usage、`toolCallCount` 和 `summaryStatus`，再写 entry 并清除 run state。没有 accepted、存在未闭合 Model、usage 不完整、queue drop 或重复/无坐标事件导致统计不可证明时为 `PARTIAL`。
- accumulator 只服务日志 projection，不回写 timeline/runtime/persistence。terminal 后立即释放；对永不 terminal 的 run 使用既有 projector lifecycle close 清理，不新增持久化。

`StructuredLogEntry` 增加 `traceId`、`spanId`、`status`、`summaryStatus` 和 `toolCallCount` 的内部字段；它不是 public Web contract。Terminal raw exception 内容继续只由 correlated runtime diagnostic 承载。

#### 3. Error 分类与单一 message

`agent-log` 在字段净化和 entry budget 前执行以下固定规则：

- 对 `error` level entry，如果 `safeReasonCode`、`safeErrorCode`、`errorCode`、`recoveryCode` 均不存在或未通过既有低基数 validator，注入 `safeReasonCode=UNCLASSIFIED_RUNTIME_ERROR`。
- 对存在可信 stable `event` 的 runtime/observation entry，丢弃 caller `msg`、`message` 和 Pino message argument，不再自动生成 `msg`。
- `getServerAccessLogger()` 保持独立 native projection；它没有 operational event，继续输出批准的 native `msg`、`reqId` 和 req/res shape。
- 前置 change 定义的 `rawExceptionData` 保持原样；兜底 safe reason 不删除或替代它。

#### 4. Deployment 和 package identity

- `createAppOperationalLogWriter()` 改为要求显式、有效的 `serviceVersion`，删除 `NEXTAGENT_PRODUCT_VERSION` 和 fallback normalizer。
- packaged local/remote entrypoint 继续使用 validated manifest 的 `createRuntimePackageServiceVersion()`；非 packaged app entrypoint 从 `@nextagent/agent-app` 当前 package metadata 读取 version 后显式注入。测试 composition 使用显式 bounded fixture version。
- metrics 和 OTel resource 复用同一个已验证 serviceVersion，避免 log/trace deployment identity 分叉。
- 触达的 product logger 静态 binding 改为 owning package 短名，原 adapter/composition 名移入 `source`。
- architecture test 扫描 `packages/*/src` 的 direct runtime static `getLogger` 和 `createRuntimeLogger` binding，要求 `component` 与所在 `@nextagent/agent-*` package 短名一致；由 app 代为注入的 observation writer binding、动态 binding 和 test source 不纳入该静态规则。

#### 5. Surface 边界

不新增 surface 或分类器。Canonical lifecycle 仍只能通过 `ObservabilityProjectorHost` 进入 `observation_derived`；Model/Tool 原始 payload、execution exception 和技术诊断仍只能通过 direct runtime logger 进入 `runtime_diagnostic`。验收测试同时断言 local special fields、raw exception 和 trace sidecar 不进入 Web、stream、audit、metric 或 observation event shape。

#### 质量属性影响

| 质量属性 | 规范依据 | 局部机制 | 验证关注点 |
|---|---|---|---|
| 审计/可追溯性 | `Operational entry 使用可信执行关联坐标`、`Operational entry 使用真实 deployment 和 package identity` | trusted sidecar、真实 version、package component | 同 trace/span 配对、caller spoof 拒绝、log/OTel version 一致、component gate |
| 可靠性/恢复 | `Request terminal entry 提供可验证汇总` | projector-owned accumulator、去重、drop/缺失转 `PARTIAL` | 完整、缺失、重复、queue overflow、terminal cleanup |
| 可维护性 | `Error 和 structured event 使用单一诊断身份` | error fallback code、event/native access 分路 | error 分类必有、event 无 msg、native access 保留 msg |

### 验证策略

- `agent-observability` unit：可信 trace sidecar 仅进入 LOG projector；同 boundary span 配对；terminal accumulator 的完整、缺失、重复和 queue overflow 路径。
- `agent-log` unit：runtime caller trace spoof 被忽略、ALS trace 被注入、observation trusted trace 被验证、error fallback code、stable event 无 msg、Fastify native access 保留 msg。
- `agent-app` composition/contract：缺失非法 version 失败；local/remote candidate version 与 OTel/log identity 一致；复杂 Model→Tool→Model→terminal 日志闭环。
- architecture：product component 与 package owner 一致；`ObservabilityObservationEvent`、public DTO、Web/stream/audit/metric 不出现 local trace/payload 扩散。
- 变更聚焦验证后运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` 和 `openspec validate --all --strict`。

## 长期基线刷新计划

归档前必须同步：

- `openspec/specs/runtime-logging/spec.md`
- `openspec/designs/functions/D7-可观测与审计/D7.1-日志与审计/FN-7.1-输出结构化日志.md`
- `openspec/designs/features/D7-可观测与审计/D7.1-日志与审计/F-7.1-结构化日志.md`
- `openspec/designs/architecture/observability.md`
- `openspec/designs/architecture/observability-boundaries.md`
- `openspec/designs/modules/agent-observability.md`
- `openspec/designs/modules/agent-log.md`
- `openspec/designs/modules/agent-app.md`
- `openspec/designs/spec-to-design-map.md`

不新增 ADR：本 change 是既有 timeline trace owner、projector host、runtime logger 和 deployment composition 的最小增量闭合，不引入新的长期可替换架构决策。

## 风险与约束

- Correlation sidecar 必须只接受 timeline span lifecycle 或当前 execution scope 的可信 snapshot；任何 caller 字段透传都会重新引入 spoof 风险。
- Stateful projector 必须在 terminal/close 后释放 per-run state；不得形成无界长期缓存。
- `PARTIAL` 是诊断完整性，不是 request business status；不得影响 terminal truth 或客户端结果。
- 删除 stable event 的 `msg` 可能影响依赖全文检索的本地脚本；该消费方式改用 `event` 和结构字段，不提供兼容 alias。
- serviceVersion validation 发生在 writer 创建前；失败不得退回静默占位值。

## 开放问题

无。`udsGateway` 降噪、远端日志服务、evidence store 和 artifact 类型投影均为明确非目标。
