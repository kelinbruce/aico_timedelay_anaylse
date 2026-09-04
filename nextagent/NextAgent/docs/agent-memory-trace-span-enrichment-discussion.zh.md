# AgentMemory trace/span 注入与轨迹查询方案

最后更新：2026-07-29

## 1. 背景

当前 NextAgent 已有统一 observability 链路：

```text
RunTimelineEvent / wrapper observation
  -> ObservabilityObservationEvent
  -> ObservabilityProjectorHost
  -> StructuredLog / Audit / Metrics / TraceProjector
```

`TraceProjector` 当前已经可以根据 `ObservabilityObservationEvent` 创建 OpenTelemetry span，并把安全的低基数字段映射为 span attribute。但该 span 是 observation projection 的派生产物，通常晚于 timeline event 持久化，不能稳定作为 timeline event 写入时的 trace/span 来源。

本方案要求各请求入口接收或初始化标准 W3C trace context；任务通道还可从请求体 `metadata.eventId` 接收业务任务事件标识，并映射为内部运行关联字段 `taskEventId`。NextAgent 内部继续生成和传播标准 span，把标准 trace/span 以及由 `taskEventId` 投影得到的 `eventId` attribute 一起写入 AgentMemory timeline event，使外部产品可通过记忆服务查询运行轨迹。

外部产品还存在独立轨迹服务，用于收集 NextAgent 之外的调用链并保留一年轨迹。AgentMemory 作为基础服务继续执行原有的两个月 session 老化，但老化时不再直接删除 timeline event，而是在同一数据库事务内将其 payload 压缩后迁移到独立压缩表，再从原表删除；session 其余数据仍按原有策略删除。压缩表中的 timeline event 保留到原始 `created_time` 满一年后删除。产品查询聚合层直接查询轨迹服务和 AgentMemory，并将外部调用链与 Agent timeline 合并为完整轨迹，两个服务之间不复制或同步 Agent timeline 数据。

## 2. 目标

- 支持外部产品通过 W3C Trace Context 传入 trace/span。
- 支持任务通道通过 `metadata.eventId` 传入单一业务任务事件标识，映射为内部 `taskEventId`，并在 timeline 与 OTel span 的 attributes 中统一保存为 `eventId`。
- NextAgent 由 timeline lifecycle 在权威 START event 持久化边界创建 span，在真实执行边界只激活稳定引用，并将对应 trace context 传递给下游服务。
- timeline event 写入 AgentMemory 时携带标准 trace/span 诊断索引和业务轨迹 attribute。
- workflow 节点 span 保持标准 OTel 父子关系，同时通过 `previewSpanIds` 表达实际控制流前驱，使串行、分支、并行汇聚、循环和 subflow 轨迹可重建。
- AgentMemory 提供统一轨迹查询接口，内部同时查询原表和压缩表，支持通过 `traceId`、`spanId`、`condition`、`startTime`、`endTime` 过滤 event 轨迹；调用方不感知表结构。
- AgentMemory 在原有两个月 session 老化时，将 timeline event 压缩后从原表原子迁移到同库压缩表，在 event 的原始 `created_time` 满一年后从压缩表删除。
- 产品查询聚合层并行查询轨迹服务和 AgentMemory，直接完成跨服务图重建和完整性标记。
- 保持 timeline event 作为 runtime durable fact 的主事实地位；标准 trace/span 与业务轨迹字段只作为诊断索引和查询条件。

## 3. 非目标

- 不把 OpenTelemetry span 作为 runtime、gateway 或 memory 的业务主键。
- 不把 `taskEventId` 或投影后的 `eventId` attribute 当作 W3C trace id 或 OpenTelemetry span id 使用。
- 不要求 trace/span 缺失时阻塞 request lifecycle、timeline 持久化或 terminal commit。
- 不通过 trace/span 回写或改写已提交的业务状态。
- 不为了前台展示修改标准 `parentSpanId`，不把 workflow 前驱关系伪装成 OTel 父子关系。
- AgentMemory 不主动调用、不识别也不依赖产品轨迹服务；跨服务查询和轨迹合并由产品侧组件负责。
- 首版不讨论产品 hook 通过 `bindDiagnosticContext` 追加产品定制诊断字段。


## 4. 当前实现基础

当前 `TraceProjector` 的语义是：

```text
ObservabilityObservationEvent
  -> traceSpanNameFor(event)
  -> tracer.startSpan(...)
  -> span.setStatus(...)
  -> span.addEvent("observability.authoritative_fact", ...)
  -> span.end(...)
```

这意味着当前 span 创建发生在 observation projection 阶段，通常晚于 timeline event 持久化。它适合生成 trace 输出，但不能直接作为当前 timeline event append 的同步输入。

因此主链路 trace/span 注入不再依赖 `TraceProjector` 异步补 span，而是由 timeline store observability decorator 根据权威 lifecycle event 同步管理 span：

```text
REQUEST_ACCEPTED append
  -> timeline store decorator 创建 request span
  -> 注入 request span snapshot
  -> append 成功后发布 request execution ref

真实 workflow 节点 / 既有直接 MODEL / Tool Loop CAPABILITY START append
  -> timeline store decorator 创建对应 span
  -> 注入 span snapshot
  -> append 成功后发布 execution ref

对应 TERMINAL append
  -> timeline store decorator取回同一个 span
  -> 注入 span snapshot
  -> append 成功后结束该 span

request terminal composite commit
  -> trace-aware request-run store 使用同一 lifecycle
  -> commit 成功后结束 request span
```

`TraceProjector` 可以继续用于 structured observation 的辅助 trace 投影，但不作为 timeline event trace/span 注入的唯一来源。

模块职责：

- `agent-observability` 提供 timeline store decorator、request-run store decorator、span lifecycle manager、execution registry 和 trace context 注入/提取能力。
- `agent-app` 作为 composition root 装配上述 wrapper 与 OpenTelemetry tracer。
- `agent-contracts/observability` 只提供无 OTel SDK 类型的 `W3CTraceCarrier`、`ExecutionCorrelationRef` 和 `ExecutionCorrelationPort`；消费方不依赖 `agent-observability` 实现包。
- Web/Task Channel 只调用 `withIncomingCarrier` 绑定入口载体；runtime/core/workflow 只调用 `withExecutionRef` 绑定当前执行引用；model/capability/remote gateway adapter 只调用 `outboundHeaders` 获取可信传播头。
- 除 observability owner 外，业务 package 不直接依赖 OpenTelemetry SDK，不直接创建、结束或激活 OTel span。
- `RunTimelineEventStoreGateway` 的 observability decorator 负责在 append 前后管理 request、workflow node、既有直接 MODEL 和 Tool Loop CAPABILITY span，并向 timeline event 注入当前 trace/span 诊断字段；真实 gateway 仍只负责持久化。
- “激活 `ExecutionCorrelationRef`”只表示把当前业务执行引用绑定到进程内异步作用域，不调用 OTel `context.with`、`startSpan` 或 `span.end`。节点 handler 内部调用模型或 `CapabilityInvocationPort` 时不合成额外 MODEL/CAPABILITY lifecycle，模型、REST、CLIP、RAG 或远端工具直接传播当前节点 span。

当前已存在或可依赖的轨迹事实主要包括：

```text
REQUEST_ACCEPTED
PLANNING_STARTED
CAPABILITY_STARTED
CAPABILITY_COMPLETED
DEGRADATION_NOTICE
REQUEST_COMPLETED
REQUEST_FAILED
REQUEST_CANCELED
REQUEST_SUPERSEDED
```


## 5. 总体流程

```text
External Product
  -> NextAgent Web/API 入口接收 traceparent/tracestate
  -> REQUEST_ACCEPTED append 前由 timeline store decorator 创建并注入 request span
  -> Runtime 在 agent.execute 边界激活 REQUEST ref
  -> 真实 workflow 节点 START/TERMINAL 由 timeline store decorator 管理 WORKFLOW_NODE span
  -> Workflow 在节点 handler 边界激活 WORKFLOW_NODE ref
  -> 节点内模型调用不新增 MODEL event/span，物理出站 adapter 按当前 ref 传播节点 span
  -> Tool Loop CAPABILITY lifecycle 生成 request 的直接子 span
  -> workflow handler 直接调用 capability port 时不增加 event/span，出站传播当前节点 span
  -> terminal composite commit 注入并在提交成功后结束 request span
  -> AgentMemory 保存 timeline event
  -> 已接入的物理出站 adapter 通过 outboundHeaders 继续传播 W3C trace context
  -> timeline event / wrapper observation 进入 ObservabilityProjectorHost
  -> TraceProjector 可继续生成辅助观测 span
  -> AgentMemory runtime trace query 按 trace/span/condition/time 查询轨迹
  -> AgentMemory 在两个月 session 老化时将 timeline event 压缩并原子迁移到同库压缩表
  -> AgentMemory runtime trace query 同时查询原表和压缩表
  -> AgentMemory 在 timeline event 的原始 created_time 满一年后从压缩表删除该 event
  -> 产品查询聚合层并行查询产品轨迹服务和 AgentMemory
  -> 按 parentSpanId + previewSpanIds 重建完整轨迹
```

## 6. 外部 trace/span 传入

外部产品调用 NextAgent 时，使用 W3C Trace Context：

```http
traceparent: 00-<traceId>-<spanId>-<flags>
tracestate: ...
```

任务通道可以在请求体中携带 `metadata.eventId`。其他请求通道只负责按自身 contract 解析 W3C 载体；没有上游 W3C 载体时，统一执行关联能力自行初始化根 span。

入口层职责：

1. 校验 `traceparent` / `tracestate` 格式。
2. 任务通道从请求体 `metadata.eventId` 提取业务标识，校验为 1 至 32 个允许字符，并映射为内部 `taskEventId`；其他 `metadata` 不进入运行时。
3. 建立 request 级 W3C trace context；若外部未传 `traceparent`，由 NextAgent 创建新的 root request span。
4. 将 W3C trace context 和业务轨迹 attributes 绑定到 observability implementation-owned context。
5. 不允许客户端请求体覆盖 owner scope、agent scope 或 runtime durable ids。

W3C trace context 用于标准调用链父子关系和下游传播；`taskEventId` 是运行时关联字段，进入 timeline 和 OTel span 的 attributes 时固定投影为 `eventId`，用于业务轨迹归并、跨服务过滤和产品展示。业务侧不需要传入业务 span id，也不要求该业务标识与 W3C span id 对齐。二者都不作为 session、request run、timeline event 或 memory query 的主事实。

## 7. 内部 span 生成节点

timeline event 是 AgentMemory 持久化的权威事实，span 是用于还原调用链和展示执行阶段的诊断轨迹。权威执行 span 必须由 timeline lifecycle 驱动，执行代码只激活已经创建的稳定引用。

需要生成的权威执行 span：

| span 阶段 | 说明 |
| --- | --- |
| request span | `REQUEST_ACCEPTED` 首次成功持久化时创建，覆盖一次 request run 的总生命周期。 |
| workflow node span | 每个本地真实执行节点实例对应一个 INTERNAL span，是 request span 的直接子级；START/END 脚手架不创建独立 span。 |
| model span | 既有直接模型调用对应 MODEL lifecycle 和 CLIENT span，直接挂在 request 下；workflow 节点内部模型调用不新增 MODEL event/span。 |
| capability span | 普通 Tool Loop 发出的 capability lifecycle 对应 CLIENT span，直接挂在 request 下。工作流 handler 直接调用 `CapabilityInvocationPort` 不创建该层 span。 |

`TraceProjector` 仍可为没有 timeline 权威 lifecycle 的 request diagnostic、system 和 gateway observation 创建辅助 INTERNAL span。这些 span 不进入 execution registry，也不作为执行代码的 active scope。NextAgent 不为每次物理出站调用创建额外 CLIENT 或 SERVER span；出站 adapter 传播当前权威执行 span，真正接收入站请求的下游服务自行创建 SERVER span。

以下说明 span 生命周期与 timeline event 持久化之间的关系：

```text
REQUEST_ACCEPTED
  timeline store decorator 创建 request span
  REQUEST_ACCEPTED event 记录 request span

真实 workflow 节点 CAPABILITY_STARTED / CAPABILITY_COMPLETED
  timeline store decorator 根据 nodeExecutionId 创建或取回 WORKFLOW_NODE span
  两个 event 记录同一个节点 span

既有直接 MODEL_STARTED / MODEL_COMPLETED / MODEL_FAILED
  timeline store decorator 根据 model executionId 创建或取回 MODEL span
  parent 固定为 request span

Tool Loop CAPABILITY_STARTED / CAPABILITY_COMPLETED
  timeline store decorator 根据 toolCallId 创建或取回 CAPABILITY span
  parent 固定为 request span

REQUEST_COMPLETED / REQUEST_FAILED / REQUEST_CANCELED / REQUEST_SUPERSEDED
  terminal event 记录 request span
  terminal composite commit 成功后结束 request span
```



### 7.1 span 上下关系

span 父子关系：

```text
external upstream span
  -> request span  span = 10  parent = 0
       -> workflow node A  parent=10 span=101
       -> workflow node B  parent=10 span=102 preview=101
       -> Tool Loop capability  parent=10
       -> direct model invocation  parent=10
```

关系说明：

- 外部请求携带 `traceparent` 时，request span 的 parent 为外部传入的 upstream span。
- 外部请求未携带 `traceparent` 时，request span 是当前 trace 的 root span。
- request span 由 timeline store decorator 在 `REQUEST_ACCEPTED` append 前创建，该 event 记录 request span。
- 本地 workflow 真实执行节点都是 request 的直接子 span；`previewSpanIds` 只表达控制流前驱，不改变 OTel parent。
- 既有直接 MODEL span 直接挂在 request 下；workflow 节点内部模型调用保持当前节点 scope，不新增 MODEL event/span。
- Tool Loop CAPABILITY span 直接挂在 request 下。MODEL 与 CAPABILITY 不因代码调用嵌套互相成为父级。
- workflow handler 内部调用模型或 capability port 时保持当前节点 scope；模型、REST、CLIP、RAG 或远端工具出站传播节点 span，不生成额外 MODEL/CAPABILITY event/span。
- terminal event 使用 request span；request span 在 terminal composite commit 成功后结束。

### 7.2 workflow 实际执行关系

标准 OTel `parentSpanId` 表达调用包含关系，不表达 workflow 控制流。当前 workflow 中的多个真实节点 span 都是 request span 的直接子 span，因此两个顺序执行的节点在 OTel 树中仍然是 sibling spans。前台若只使用 `parentSpanId`，只能看到它们共同挂在 request 下，无法还原 workflow 的先后、分支和汇聚关系。

本方案在 `trace` 中增加可选 `previewSpanIds`：

```json
{
  "trace": {
    "traceId": "7bba9f33312b3dbb8b2c2c62bb7abe2d",
    "spanId": "4444444444444444",
    "parentSpanId": "1111111111111111",
    "previewSpanIds": [
      "2222222222222222",
      "3333333333333333"
    ]
  },
  "attributes": {
    "eventId": "0123456789abcdef0123456789abcdef"
  }
}
```

字段语义：

- `parentSpanId` 继续表示标准 OTel 上游 span，不因 workflow 展示需要而改写。
- `previewSpanIds` 表示当前 workflow 节点本次实际执行的直接控制流前驱，可以包含零个、一个或多个 span id。
- 非 workflow span 不写 `previewSpanIds`；workflow 入口节点写空数组 `[]`。字段缺失表示不适用或关系未采集，空数组表示已确认没有 workflow 前驱。
- 串行 `A -> B` 中，B 的 `previewSpanIds=[A.spanId]`。
- 分支 `A -> B | C` 中，B 和 C 分别记录实际分支入口的前驱 span。
- 并行汇聚 `B + C -> D` 中，D 的 `previewSpanIds=[B.spanId,C.spanId]`；不得只选择最后完成的一个分支。
- 循环、重试和 subflow 必须按实际执行实例建立关系，不得只按静态 `nodeId` 关联；同一节点的不同循环迭代必须能够对应不同 span。
- `previewSpanIds` 中的 span 必须属于同一个 `traceId`，数组必须去重并设置有界最大数量。

workflow 前驱关系只能由 workflow execution owner 根据实际 transition 产生，不能由 trace wrapper 根据 timeline event 到达顺序猜测。NextAgent workflow 支持并行 fork/join，分支完成先后受运行耗时影响，事件到达顺序不等于控制流依赖。实现可以在内部使用唯一 node execution correlation 表达循环、重试和 subflow 实例，再由 observability wrapper 将前驱 execution correlation 解析为 `previewSpanIds`；该内部 correlation 不要求暴露给产品查询接口。

前台展示时同时使用两类边：

```text
标准调用边：parentSpanId -> spanId
workflow 控制流边：previewSpanIds[*] -> spanId
```

workflow 控制流本质上可能是 DAG，而不是严格的树。前台若只能显示树，可以在产品查询投影层选择一个 `displayParentSpanId`，但该字段只能用于展示，不得覆盖或替代真实 `parentSpanId` 和 `previewSpanIds`。

## 8. 下游 trace context 传播

NextAgent 不创建通用 HTTP wrapper，也不为物理出站请求额外创建 CLIENT span。当前由以下实际发送请求的 adapter 在发送前调用共享 `ExecutionCorrelationPort.outboundHeaders`：

| 出站边界 | 传播方式 |
| --- | --- |
| OpenRouter model provider | provider 使用的 fetch wrapper 在物理模型请求前注入当前执行 trace context。 |
| CLIP | sandbox CLIP command runner 获取可信 header，`buildClipExecutionArgs` 将其写入 `params.header`；用户提供的同名保留 header 先被剥离。 |
| SkillHub remote gateway | HTTP 请求发送前注入当前执行 trace context。 |
| RobotRouter guardrail gateway | 各物理 POST 请求发送前注入当前执行 trace context。 |
| 本地 workflow 的 remote RAG client | RAG HTTP 请求发送前注入当前执行 trace context。 |

AgentMemory 持久化调用、task callback、remote workflow execution、部署控制和其他未接入的 HTTP 请求不因本方案自动获得传播能力；后续新增物理出站 adapter 时，必须显式接入同一关联端口并补充规格与测试。

HTTP header 形态：

```http
traceparent: 00-<w3c-trace-id>-<current-w3c-span-id>-<flags>
tracestate: ...
x-task-event-id: <task event id>
```

任务通道请求体中的 `metadata.eventId` 映射为内部 `taskEventId` 后，通过 `x-task-event-id` 向下游传播；它在 timeline 和 OTel span 的 attributes 中仍使用 `eventId` 键。CLIP 已将上述可信 header 写入 `clipc` 的 `--params` / `--request` 协议中的 `params.header`，由 `clipc` 转成实际下游 HTTP header。

`outboundHeaders` 总是先按大小写不敏感方式移除调用方提供的 `traceparent`、`tracestate` 和 `x-task-event-id`。trace 关闭、没有执行作用域或 registry 中找不到有效 span 时，不注入替代值，业务调用继续执行；找到有效 active entry 时，才注入 registry 生成的可信值。业务 package 不直接依赖 OpenTelemetry SDK，不直接构造 tracer、span、exporter 或 propagator。

## 9. timeline event 注入策略

timeline event 写入 AgentMemory 前，由 `RunTimelineEventStoreGateway` wrapper 尝试注入 trace/span 诊断索引。

示例 payload：

```json
{
  "trace": {
    "traceId": "7bba9f33312b3dbb8b2c2c62bb7abe2d",
    "spanId": "0123456789abcdef",
    "parentSpanId": "0011223344556677",
    "previewSpanIds": ["8899aabbccddeeff"],
    "traceparent": "00-7bba9f33312b3dbb8b2c2c62bb7abe2d-0123456789abcdef-01"
  },
  "attributes": {
    "eventId": "0123456789abcdef0123456789abcdef"
  }
}
```

注入原则：

- `REQUEST_ACCEPTED` 在 gateway append 前创建并写入 request span。
- 带 `nodeExecutionId` 的真实 workflow 节点 `CAPABILITY_STARTED` 在 append 前创建 WORKFLOW_NODE span；对应 `CAPABILITY_COMPLETED` 根据同一执行标识找回 span，并在 append 成功后结束。
- 既有直接 MODEL START/TERMINAL 使用同一 model executionId，并以 request span 为 parent。
- Tool Loop `CAPABILITY_STARTED` / `CAPABILITY_COMPLETED` 使用同一 `toolCallId`，CAPABILITY span 的 parent 固定为 request span。
- workflow handler 内部调用模型或 capability port 不生成额外 lifecycle；出站调用传播当前 active 节点 span。
- terminal event 写入当前 request span；request span 由共享 lifecycle 在 terminal composite commit 成功后结束。
- 找到可用 span 时，写入 `traceId`、`spanId`、`parentSpanId` 和可选 `traceparent`。
- workflow execution owner 提供有效的实际前驱 correlation 时，写入解析后的 `previewSpanIds`；非 workflow event 不写该字段。
- `previewSpanIds` 解析失败、部分前驱 span 缺失或关系数量超过上限时，只能产生安全降级证据，不得根据事件时间或完成顺序猜测关系。
- 找到可信 `taskEventId` 时，写入 `attributes["eventId"]`，并同步设置到当前 OpenTelemetry span 的 `eventId` attribute。
- 找不到 span 时，不写 trace 字段，不阻塞 append。
- 找不到业务轨迹字段时，不写业务 attribute，不阻塞 append。
- trace/span 字段不得覆盖 event 原有业务 payload。
- 标准 trace/span 与业务轨迹 attribute 只作为 AgentMemory 查询索引，不参与恢复、幂等、CAS、owner scope 或 agent scope 判定。

## 10. timeline decorator span 生命周期

主链路不采用“TraceProjector 异步生成 span 后增强后续 event”的方案。权威执行 span 生命周期由 observability 提供的 timeline store decorator 和 request-run store decorator 共同管理。

span 生命周期与执行激活是两个相互解耦的动作：

- timeline lifecycle 根据权威 START/TERMINAL event 创建、查找和结束 span，并维护 `ExecutionCorrelationRef -> SpanContext` registry。
- 执行代码调用 `withExecutionRef(ref, operation)` 时，只把 ref 压入 `AsyncLocalStorage` 作用域栈；它不创建 span、不结束 span、不修改 parent，也不把对应 OTel span 设置为 SDK current span。
- 物理出站 adapter 调用 `outboundHeaders` 时，从作用域栈内层向外查找第一个仍为 ACTIVE 的 registry entry。因此 workflow node ref 可覆盖 request ref；内层 ref miss 或已关闭时可回退到仍然 ACTIVE 的外层 request ref。
- operation 完成或抛错后，异步作用域自动恢复之前的 ref；执行失败本身不由 `withExecutionRef` 结束 span，span 仍以权威 TERMINAL event 或 request terminal commit 为准。

request span 生命周期：

```text
external trace context
  -> REQUEST_ACCEPTED append before hook 创建 request span
  -> append 成功后发布 REQUEST execution ref
  -> agent.execute 边界激活 REQUEST ref
  -> terminal event append 注入 request span
  -> terminal composite commit 成功后结束 request span
```

workflow node / 既有直接 MODEL / Tool Loop CAPABILITY span 生命周期：

```text
START append before hook
  -> 根据 event 分类和 executionId 派生稳定 ref
  -> 选择并冻结 parent
  -> 创建 span 并注入 START event
  -> append AgentMemory timeline event
  -> append 成功后发布 execution ref

执行边界
  -> withExecutionRef 只把已发布的 execution ref 绑定到异步作用域
  -> 下游 adapter 从共享 registry 获取 outbound headers

TERMINAL append
  -> 根据同一 executionId 取回 active span
  -> 注入 trace/span 到 TERMINAL event
  -> append AgentMemory timeline event
  -> append 成功后结束 span
```

parent 选择规则固定为：WORKFLOW_NODE → request；既有直接 MODEL → request；Tool Loop CAPABILITY → request。工作流内部模型和 capability port 调用没有单独 START/TERMINAL，因此保持调用时 active 的节点 ref。

该模型仍然是 best-effort。tracer 不可用、registry miss、correlation 缺失或注入失败时，timeline event 仍必须正常持久化。

## 11. NextAgent 内部关联模型

本章只定义 NextAgent 运行时内部用于选择当前传播上下文和关联 workflow 实际执行关系的模型。这里的“激活引用”不是激活 OTel span，而是激活一个可以查询 registry 的稳定业务坐标。span lifecycle 与 snapshot 不进入业务 contract；跨执行边界只传递稳定、无 SDK 类型的引用：

```ts
interface ExecutionCorrelationRef {
  readonly requestRunId: RequestRunId;
  readonly kind: "REQUEST" | "WORKFLOW_NODE" | "MODEL" | "CAPABILITY";
  readonly executionId: string;
}
```

使用原则：

- timeline lifecycle 根据权威 START event 建立 registry entry；只有 START append 成功后，后续真实执行才会使用该 ref。对应 TERMINAL append 成功后按相同 ref 结束 span。
- request 执行、workflow node、既有直接 MODEL wrapper 和 Tool Loop capability boundary 只调用 `withExecutionRef`，不创建或结束 span；workflow 内部模型调用不增加 MODEL wrapper。
- REQUEST ref 包围 `agent.execute`；WORKFLOW_NODE、MODEL 或 CAPABILITY ref 在对应真实执行期间作为更内层作用域存在。`outboundHeaders` 选择最内层仍为 ACTIVE 的 entry。
- registry key 同时包含 `requestRunId`、`kind` 和 `executionId`，并行节点通过不同 `nodeExecutionId` 相互隔离。
- workflow 节点保存零到多个直接前驱 `nodeExecutionId`；START 注入时由 registry 解析为 `previewSpanIds`，不得按时间猜测。
- `TraceProjector` 不负责权威执行 span 生命周期，只为未被 timeline 拥有的 observation 生成辅助 span。
- registry miss、无有效 span 或 trace 关闭时，关联端口执行 no-op/安全降级，不能阻塞节点执行、模型/能力调用或 timeline 持久化。

正式运行入口统一使用异步 application composition。composition 先创建 operational writer，再由 observability preload 根据最终配置初始化 tracer provider、`TraceProjector`、registry、lifecycle 和 correlation port，之后才组装 Task Channel：

- `observability.tracing.enabled=true` 且未配置 exporter 时，创建不导出的真实 provider，timeline trace、W3C 传播和 `eventId` 关联仍然启用。
- exporter 凭据解析或 exporter 初始化失败时，记录不含引用和值的安全原因，并降级为不导出的 provider；最终 `traceEnabled` 仍为 `true`。
- provider 初始化失败时，最终 `traceEnabled=false`，应用继续启动；Task Channel 不映射 `eventId`，timeline 与下游请求也不产生 trace 关联。
- 外部显式注入的 `traceProjector` 仍可作为 composition override；未注入时由统一 preload 创建。local runtime package 不再提前创建第二套 provider/projector。

典型 workflow 节点调用链：

```text
REQUEST_ACCEPTED append
  -> 创建 REQUEST span，并登记 REQUEST ref
  -> withExecutionRef(REQUEST)

节点 CAPABILITY_STARTED append
  -> 创建 WORKFLOW_NODE span，并登记 WORKFLOW_NODE ref
  -> withExecutionRef(WORKFLOW_NODE)
       -> 节点内部模型、CLIP、REST、RAG 或远端工具调用
       -> outboundHeaders 选择 WORKFLOW_NODE entry
       -> 传播 WORKFLOW_NODE traceparent 和可选 x-task-event-id

节点 CAPABILITY_COMPLETED append
  -> 使用同一 WORKFLOW_NODE ref 注入 snapshot
  -> append 成功后结束 WORKFLOW_NODE span
```

`ExecutionCorrelationRef` 和 workflow execution correlation 都是 NextAgent 内部运行时模型，不属于 AgentMemory 对外查询接口，也不要求作为查询 DTO 返回。

## 12. AgentMemory 运行轨迹查询接口

AgentMemory 对外只暴露已经持久化的 timeline event 查询投影，不暴露 NextAgent 内部 correlation envelope、span registry 或 span 生命周期状态。调用方只发起一次轨迹查询请求；AgentMemory 在服务内部同时查询原表和压缩表并返回统一结果，不提供表选择参数，也不要求调用方按数据年龄分别查询。

输入参数：

| 字段          | 必填 | 类型与约束                                                      | 说明                                                                                                               |
| ------------- | ---- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `tenantId`    | 否   | string，长度 1～64                                              | 按租户精确过滤；不传时不使用该条件。                                                                               |
| `userId`      | 否   | string，长度 1～64                                              | 按用户精确过滤；对内映射为 subject scope；不传时不使用该条件。                                                     |
| `agentId`     | 否   | string，长度 1～64                                              | 按 Agent 精确过滤；不传时不使用该条件。                                                                            |
| `traceId`     | 否   | string，W3C trace id，32 位 hex                                 | 按 trace id 查询；`traceId` 与 `condition` 至少传一个。                                                             |
| `spanId`      | 否   | string，W3C span id，16 位 hex                                 | 按 span id 进一步收敛查询结果。                                                                                     |
| `condition`   | 否   | object，首版使用 `eventId`，value 长度为 1～32，字符规则与任务通道一致 | 按业务 attribute 精确匹配；`traceId` 与 `condition` 至少传一个。 |
| `startTime`   | 否   | int64，`minimum: 0`，EpochMillis                               | 查询起始时间，返回 `createTime >= startTime` 的轨迹项。                                                             |
| `endTime`     | 否   | int64，`minimum: 0`，EpochMillis；若传入，需不早于 `startTime` | 查询结束时间，返回 `createTime <= endTime` 的轨迹项。                                                               |
| `limit`       | 否   | integer，`minimum: 1`，`maximum: 500`，`default: 100`          | 最大返回条数；服务端必须设置默认值和最大上限，避免无界查询。                                                        |

输出参数：

| 字段                                                    | 说明                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------- |
| `traceId`                                             | 本次查询命中的 trace id。                                                          |
| `events`                                              | 轨迹分组列表。每个元素表示同一个 span 下的一组 timeline event。                                 |
| `events[].trace`                                      | 当前分组关联的 span 信息。                                                           |
| `events[].trace.traceId`                              | 当前分组命中的 trace id。                                                          |
| `events[].trace.spanId`                               | 当前分组命中的 span id。                                                           |
| `events[].trace.parentSpanId`                         | 当前 span 的上游 span id。                                                       |
| `events[].trace.previewSpanIds`                       | 当前 workflow span 的实际直接前驱 span id 列表。非 workflow span 可缺失；workflow 入口节点为空数组。 |
| `events[].attributes`                                 | 当前分组关联的业务轨迹 attributes；首版只包含 `eventId`。                                    |
| `events[].timelineEvents`                             | 同一个 span 下的 timeline event 查询投影列表，按 `sequence` 优先、`createTime` 次优排序。       |
| `events[].timelineEvents[].eventId`                   | timeline event id。                                                         |
| `events[].timelineEvents[].tenantId`                  | 租户标识。                                                                      |
| `events[].timelineEvents[].userId`                    | 用户标识。                                                                      |
| `events[].timelineEvents[].agentId`                   | Agent 标识。                                                                  |
| `events[].timelineEvents[].type`                      | timeline event type。                                                       |
| `events[].timelineEvents[].createTime`                | event 创建时间。                                                                |
| `events[].timelineEvents[].updateTime`                | event 更新时间。                                                                |
| `events[].timelineEvents[].inlinePayload`             | 仅 `CAPABILITY_STARTED` / `CAPABILITY_COMPLETED` 返回。                        |
| `events[].timelineEvents[].inlinePayload.nodeId`      | 业务定义的 workflow 节点标识。                                                       |
| `events[].timelineEvents[].inlinePayload.description` | 业务定义的 workflow 节点描述，面向外部产品展示。                                              |

workflow 业务在生成 timeline event 时自行编写并控制 `nodeId` 和 `description`，AgentMemory 不生成、不推断也不修正这两个值，只按安全查询投影保存和返回。

请求示例：

```http
POST /rest/naie/memory/runtime-traces
Content-Type: application/json
```

```json
{
  "condition": {
    "eventId": "0123456789abcdef0123456789abcdef"
  },
  "traceId": "7bba9f33312b3dbb8b2c2c62bb7abe2d",
  "startTime": 1776684899000,
  "endTime": 1776684999000,
  "limit": 100
}
```

OpenAPI 文件：[runtime-traces.openapi.yaml](runtime-traces.openapi.yaml)

响应示例：

```json
{
  "traceId": "7bba9f33312b3dbb8b2c2c62bb7abe2d",
  "events": [
    {
      "trace": {
        "traceId": "7bba9f33312b3dbb8b2c2c62bb7abe2d",
        "spanId": "1111111111111111"
      },
      "attributes": {
        "eventId": "0123456789abcdef0123456789abcdef"
      },
      "timelineEvents": [
        {
          "eventId": "evt_001",
          "tenantId": "tenant_001",
          "userId": "user_001",
          "agentId": "agent_001",
          "type": "REQUEST_ACCEPTED",
          "createTime": 1776684899000,
          "updateTime": 1776684899000
        },
        {
          "eventId": "evt_030",
          "tenantId": "tenant_001",
          "userId": "user_001",
          "agentId": "agent_001",
          "type": "REQUEST_COMPLETED",
          "createTime": 1776684920000,
          "updateTime": 1776684920000
        }
      ]
    },
    {
      "trace": {
        "traceId": "7bba9f33312b3dbb8b2c2c62bb7abe2d",
        "spanId": "2222222222222222",
        "parentSpanId": "1111111111111111",
        "previewSpanIds": []
      },
      "attributes": {
        "eventId": "0123456789abcdef0123456789abcdef"
      },
      "timelineEvents": [
        {
          "eventId": "evt_010",
          "tenantId": "tenant_001",
          "userId": "user_001",
          "agentId": "agent_001",
          "type": "CAPABILITY_STARTED",
          "createTime": 1776684900000,
          "updateTime": 1776684900000,
          "inlinePayload": {
            "nodeId": "query-alarm",
            "description": "Query active alarms."
          }
        },
        {
          "eventId": "evt_020",
          "tenantId": "tenant_001",
          "userId": "user_001",
          "agentId": "agent_001",
          "type": "CAPABILITY_COMPLETED",
          "createTime": 1776684905000,
          "updateTime": 1776684905000,
          "inlinePayload": {
            "nodeId": "query-alarm",
            "description": "Query active alarms."
          }
        }
      ]
    },
    {
      "trace": {
        "traceId": "7bba9f33312b3dbb8b2c2c62bb7abe2d",
        "spanId": "3333333333333333",
        "parentSpanId": "1111111111111111",
        "previewSpanIds": [
          "2222222222222222"
        ]
      },
      "attributes": {
        "eventId": "0123456789abcdef0123456789abcdef"
      },
      "timelineEvents": [
        {
          "eventId": "evt_021",
          "tenantId": "tenant_001",
          "userId": "user_001",
          "agentId": "agent_001",
          "type": "CAPABILITY_STARTED",
          "createTime": 1776684906000,
          "updateTime": 1776684906000,
          "inlinePayload": {
            "nodeId": "analyze-alarm",
            "description": "Analyze alarm root cause."
          }
        },
        {
          "eventId": "evt_029",
          "tenantId": "tenant_001",
          "userId": "user_001",
          "agentId": "agent_001",
          "type": "CAPABILITY_COMPLETED",
          "createTime": 1776684912000,
          "updateTime": 1776684912000,
          "inlinePayload": {
            "nodeId": "analyze-alarm",
            "description": "Analyze alarm root cause."
          }
        }
      ]
    }
  ]
}
```

查询接口返回的是已经保存到 AgentMemory 的 timeline event。服务端会先按 `condition`、`traceId`、时间范围等条件找到匹配的 event，再把属于同一个标准 `spanId` 的 event 放到同一个 `events[]` 元素中。每个分组里的 `trace` 字段表示这个分组对应的标准 span，`attributes.eventId` 表示由任务通道 `metadata.eventId` 经内部 `taskEventId` 投影并保存的业务关联值。它与 `timelineEvents[].eventId` 表示的 timeline event 自身标识不同。

产品展示轨迹时，使用 `traceId`、`spanId`、`parentSpanId` 还原标准调用父子关系，使用 `previewSpanIds` 还原 workflow 实际控制流。业务字段只用于过滤和归并，不用于判断调用父子或 workflow 前驱关系。如果同一组 `condition` 查到多个 `traceId`，说明这些 event 分布在多条标准调用链中，服务端必须按 `traceId` 分区重建，不得创建跨 trace 的父子边或前驱边。`inlinePayload` 只在 `CAPABILITY_STARTED` / `CAPABILITY_COMPLETED` 中返回业务提供的 `nodeId` 和 `description`；`nodeId` 只用于识别和展示 workflow 节点，不替代 `spanId`，也不用于推导节点之间的调用或控制流关系。

### 12.1 轨迹图重建规则

AgentMemory 对原表和压缩表的查询结果进行统一合并后，按照以下顺序形成轨迹查询响应；产品查询聚合层可使用相同关系规则，将 AgentMemory 响应与产品轨迹服务结果继续合并：

1. 先按 `traceId` 分区；同一查询命中的多个 trace 分别重建。
2. 在每个 trace 内按 `spanId` 分组，将同一个 span 下的 `CAPABILITY_STARTED`、`CAPABILITY_COMPLETED` 等 timeline event 按 `sequence` 优先、`createTime` 次优排序。
3. 使用 `parentSpanId -> spanId` 建立标准调用树；`parentSpanId` 不在当前查询窗口时保留 unresolved parent，不把当前 span 错判为 root。
4. 使用 `previewSpanIds[*] -> spanId` 叠加 workflow 控制流图；前驱不在当前查询窗口或已超出保留期时保留 unresolved predecessor。
5. 相同 `spanId` 的多条 timeline event 若携带冲突的 `parentSpanId` 或 `previewSpanIds`，以 AgentMemory 首次已提交事实为准，并返回有界降级状态，不静默选择最新值。
6. 对重复边去重，对 self-loop、跨 trace 前驱和非法 span id 拒绝建边；检测到循环时标记轨迹降级，避免前台无限遍历。workflow 定义可以有循环，但以每次实际执行实例 span 构建的运行图不应通过复用同一 span 形成环。
7. `inlinePayload.nodeId` 只作为 workflow 节点业务标识；循环、重试或 subflow 中同一个 `nodeId` 可以对应多个实际执行 span，图重建不得按 `nodeId` 合并这些 span。

查询响应应说明完整性，而不是把运行中或缺失父节点的图伪装成完整轨迹。建议至少区分：

| 状态 | 说明 |
| --- | --- |
| `LIVE_PARTIAL` | 请求仍在运行，节点和边可能继续增加。 |
| `FINAL` | Agent 请求已终态，AgentMemory 中已提交的节点和边不再增加。 |
| `HISTORICAL` | AgentMemory 返回压缩表中两个月老化后、保留期一年内的 timeline event。 |
| `DEGRADED` | 某个数据源不可用或轨迹关系校验失败。 |

## 13. AgentMemory 两阶段老化与跨服务轨迹查询

### 13.1 数据职责和依赖方向

AgentMemory 与产品轨迹服务分别保留各自拥有的轨迹事实：

- AgentMemory 保存 Agent timeline event。两个月内的完整 timeline 位于原表；session 触发原有两个月老化后，timeline event 被压缩并原子迁移到同库压缩表；压缩表中的 timeline event 保留到原始 `created_time` 满一年。
- 产品轨迹服务保存 NextAgent 之外的外部调用链。
- 两个服务之间不复制或同步 Agent timeline。AgentMemory 不配置产品轨迹服务地址，也不调用产品轨迹服务。
- 产品查询聚合层负责并行查询产品轨迹服务和 AgentMemory，并合并两个服务的响应；它不直接访问 AgentMemory 原表或压缩表。

```text
NextAgent -> AgentMemory
              |- 0～2 个月：原表保存完整 timeline event
              |- session 两个月老化：压缩并原子迁移到同库压缩表，删除其余 session 数据
              |- runtime trace query：同时查询原表和压缩表
              `- 原始 created_time 满一年：从压缩表删除 timeline event

外部系统调用链 -> 产品轨迹服务

前台 -> 产品 Trajectory Query Aggregator
          |- 产品轨迹服务：外部调用链
          `- AgentMemory 统一查询接口：服务内部合并原表和压缩表，返回一年内 Agent timeline
                 -> 按 trace/span 和 workflow 前驱关系合并
```

### 13.2 两阶段老化

AgentMemory 继续使用原有 session 两个月老化能力，但调整 timeline event 的处理方式。

第一阶段由 session 老化任务触发：

1. session 达到原有两个月老化条件时，对该 session 的 timeline event 启动同库迁移事务。
2. 从原表读取待迁移的 timeline event；除 `inlinePayload` 压缩外，其余字段保持不变，原始 `created_time` 不得因迁移而改变。
3. `inlinePayload` 按白名单压缩，删除 node 输入、输出和其他轨迹查询不需要的冗余内容，仅保留业务提供的 `nodeId` 和 `description`。
4. 将压缩后的 timeline event 写入同一数据库中的独立压缩表；压缩表使用与原表一致的 event 业务唯一键，禁止同一 event 重复迁移。
5. 确认压缩表写入成功后，在同一事务内从原表删除对应 timeline event。
6. session 的其余数据继续按原有老化逻辑删除；timeline 迁移或压缩失败时，整个老化事务回滚，不得删除原表数据。

timeline payload 压缩必须是确定且幂等的操作；重复执行后结果保持一致。对外部查询而言，每个已提交 event 只能位于原表或压缩表之一，不得出现已提交后同时缺失或重复可见。

第二阶段由 timeline 清理任务执行：

1. 以 timeline event 不可变的 `created_time` 计算一年保留期，不使用 payload 压缩产生的更新时间重新计算保留期。
2. 从压缩表删除原始 `created_time` 已超过一年保留期的 timeline event。
3. 清理按有界批次执行，避免大批量删除影响在线轨迹查询。

### 13.3 AgentMemory 统一查询与跨服务轨迹合并

产品查询聚合层对请求时间范围并行查询产品轨迹服务和 AgentMemory，但只向 AgentMemory 发起一次统一轨迹查询请求：

1. 查询产品轨迹服务，取得 NextAgent 之外的外部调用链。
2. 使用 `POST /rest/naie/memory/runtime-traces` 向 AgentMemory 发起一次查询。产品查询聚合层和其他业务调用方不得直接访问原表或压缩表，也不得按时间范围拆成两次分表查询。
3. AgentMemory 在同一个数据库查询快照中，通过 `UNION ALL` 或等价方式同时查询保存两个月内完整 timeline 的原表和保存两个月至一年压缩 timeline 的压缩表。
4. AgentMemory 将同一请求的查询条件同时应用到原表和压缩表；两表结果合并后统一排序和应用 `limit`，不得分别截断后再拼接。
5. AgentMemory 合并两表 event 后，再按 `traceId`、`spanId` 分组形成统一接口响应。调用方无需感知 event 来自原表还是压缩表。
6. 产品查询聚合层按 `traceId` 分区，使用 `parentSpanId -> spanId` 合并标准调用父子关系。
7. 产品查询聚合层使用 `previewSpanIds[*] -> spanId` 叠加 workflow 实际控制流关系。
8. `attributes.eventId` 只用于过滤和关联候选轨迹，不用于生成父子边或 workflow 前驱边。
9. 对仍在运行的 request，AgentMemory 的统一查询会从原表返回已经提交的 timeline event，产品侧无需等待同步即可持续查询新增节点和边。
10. 任一数据源不可用或关系校验失败时返回 `DEGRADED`；仍在运行时返回 `LIVE_PARTIAL`；Agent 请求终态时返回 `FINAL`；AgentMemory 返回压缩表中的 timeline 时返回 `HISTORICAL`。

产品聚合层只合并查询结果，不改变两个数据源中的原始事实。

## 14. 安全与可靠性约束

- trace/span 缺失不得影响业务结果。
- trace/span 注入失败只能产生 bounded degradation evidence。
- `previewSpanIds` 缺失或解析失败不得影响 workflow 执行、timeline append、terminal commit 或产品主业务结果。
- 不得根据 timeline event 到达时间、完成时间或数组位置猜测 workflow 前驱关系。
- 不允许记录 raw prompt、raw model output、raw tool args/result、path、credential、token、attachment content。
- `traceId`、`spanId` 不进入 metrics label，不进入业务主键。
- `previewSpanIds` 不作为业务主键、幂等键、owner scope、agent scope、恢复或状态推进依据。
- 查询必须同时校验 owner scope 和 agent scope。
- AgentMemory 轨迹查询接口不得暴露原表、压缩表或数据年龄选择参数；分表查询与结果合并由 AgentMemory 服务内部完成。
- 查询接口只返回 trace/span 字段和 timeline event 查询投影；`inlinePayload` 仅在 capability start/complete 事件中返回业务提供的 `nodeId` 和 `description`。
