## 背景与问题

NextAgent 已经把请求、模型、能力、工作流、系统和网关行为转换为安全 observation，并由 `TraceProjector` 在 observation 消费阶段生成 OTel span。该生成时点晚于 timeline 持久化，因此同一条 timeline event 无法保存由它派生出的 `traceId` 和 `spanId`，执行中的下游调用也无法稳定传播对应 span。当前 `TraceProjector` 还会把请求、模型和能力的开始、完成 observation 分别投影成多个 span，不能表示真实生命周期。

前台运行轨迹需要同时查询外部轨迹服务和 AgentMemory，并通过 timeline 中的 trace/span 关联还原实时及历史轨迹。NextAgent 必须在 timeline 首次持久化前确定 span，在开始事件持久化后让对应执行范围可以引用该 span，并在终止事件持久化后结束 span。span 的创建和上报不得散落在请求、模型、能力和工作流业务代码中。

任务通道还需要接收业务任务事件标识，并在 trace 启用时把它保存到 timeline、OTel span 及下游请求头。该标识只来自任务通道创建项的 `taskMessages[0].metadata.eventId`，内部统一称为 `taskEventId`；写入 timeline 和 OTel span 时属性键保持为 `eventId`，向下游传播时请求头固定为 `x-task-event-id`。trace 关闭时该标识不进入运行上下文和后续关联。

本地工作流已经存在节点事件和并行分支，但同一静态节点的重试、循环或并行执行缺少独立执行标识，汇聚节点也缺少全部直接前驱。前台运行轨迹要求工作流真实执行节点 span 都是请求 span 的直接子级，并通过 `previewSpanIds` 表达控制流前后关系，而不是伪造 OTel 多级父子关系。

### 术语

- `taskEventId`：任务通道把已校验的 `taskMessages[0].metadata.eventId` 映射为运行时关联事实后的内部名称。
- `ExecutionCorrelationRef`：进程内执行范围使用的稳定引用，由 `requestRunId`、`kind` 和 `executionId` 组成，不包含 OTel SDK 类型。
- timeline 权威执行 span：由持久化 timeline 生命周期事件驱动创建和结束的请求、模型、能力或本地工作流真实执行节点 span。
- 辅助观测 span：`TraceProjector` 根据未被 timeline lifecycle 拥有的请求拒绝、system 或 gateway observation 生成的诊断 span；它不拥有 timeline 生命周期。
- `previewSpanIds`：本地工作流节点的零个或多个直接控制流前驱 span 标识；它不改变标准 `parentSpanId`。

## 目标

- 任务通道逐项校验 `taskMessages[0].metadata.eventId`；trace 启用时在执行期映射为 `taskEventId`，并以 `REQUEST_ACCEPTED.inlinePayload.attributes.eventId` 作为唯一权威恢复锚点；重试和编辑重提从来源锚点继承，分叉后的新执行不恢复该值。trace 关闭时不映射或恢复。
- trace 启用时，所有适用的持久化 timeline event 在 `inlinePayload.attributes.eventId` 中保存可信 `taskEventId`；timeline 权威执行 span 使用同名 `eventId` 属性；下游请求使用 `x-task-event-id`。trace 关闭时不绑定、不保存或传播 `taskEventId`。
- trace 启用时，以 timeline START 和终止事件作为权威 span 生命周期边界，在首次持久化前生成关联，在持久化成功后推进 span 状态。
- 通过 `RunTimelineEventStoreGateway.appendEvent` 和 `RequestRunStoreGateway.commitTerminal` 的组装期装饰器覆盖普通追加和终止复合提交，不在物理 SQLite gateway 中加入 OTel 逻辑。
- 请求、直接模型、直接能力和本地工作流节点使用稳定 `ExecutionCorrelationRef` 关联；执行代码只激活该引用，不创建、结束或保存 OTel span。
- NextAgent timeline 权威执行 span 使用受控层级：工作流真实执行节点、既有直接 MODEL span 和普通 Tool Loop 产生的 CAPABILITY span 都是 request span 的直接子级。工作流 handler 内部调用模型或 `CapabilityInvocationPort` 不新增 MODEL/CAPABILITY timeline lifecycle 或 span，模型、REST、CLIP、RAG 和远端工具出站直接传播当前节点 span。
- `RECIPE` 能力和工作流 START/END 脚手架节点不创建独立 timeline 权威执行 span，只保留真实执行节点 span；RECIPE 自身 timeline 事件关联到请求 span。
- 本地工作流为每次实际节点尝试生成唯一 `nodeExecutionId`，保存全部直接前驱执行标识，并把它们确定地转换为 `previewSpanIds`。
- 下游 OpenRouter、CLIP、SkillHub HTTP v1、RobotRouter guardrail 和本地工作流使用的远端 RAG 检索调用，只使用当前 `ExecutionCorrelationRef` 对应的权威执行 span 生成 W3C Trace Context，不为物理 HTTP/CLIP 传输额外创建本地 span；接收请求的下游服务负责创建自身 SERVER span。
- `TraceProjector` 只避让已经由 timeline lifecycle 拥有的执行 observation；它继续处理没有 timeline span owner 的 request diagnostic、system 和 gateway observation。有 request context 时辅助观测 span 是 request span 的直接 INTERNAL 子级，且不成为出站传播父级；request diagnostic 缺少 request context 时生成不进入权威 registry 的独立诊断 span，system/gateway 缺少 request context 时跳过。
- span Resource 继续由 `agent-observability` 的 tracer provider 统一配置；timeline 事件只提供受控的动态 span attributes。

## 非目标

- 不修改 AgentMemory 的查询接口、两阶段老化、原表与压缩表统一查询或一年清理逻辑。
- 不在 NextAgent 中实现轨迹服务与 AgentMemory 的同步或查询合并。
- 不实现远程工作流节点 span。
- 不实现进程崩溃后恢复未结束的 span。
- 不修改任务通道既有的最多 20 项 batch、逐项幂等和部分失败语义。
- 不把工作流节点输入、输出、模型内容、工具参数或工具结果写入 span attributes。
- 不把任意代码调用栈投影成无界 span 树；允许的 NextAgent 权威执行层级固定为 request → workflow node、request → MODEL 或 request → CAPABILITY。
- 不修改消息、stream、Web 查询 DTO 或 AgentMemory Web API。

## 变更范围

- **BREAKING**：修改 `trace-log-linking` 的既有禁止规则，允许由组装期 trace-aware timeline 装饰器在首次持久化前写入 `RunTimelineEvent.inlinePayload.trace`；业务生产者仍不得写入或覆盖该保留命名空间。
- 任务通道从每个创建项唯一 task message 的 `metadata` 中读取 OPTIONAL `eventId`，字段存在时要求长度为 1 至 32 个字符，且只允许 ASCII 字母、数字、连字符、下划线、空格、点和冒号；trace 启用时映射为内部 `taskEventId`，trace 关闭时只校验而不映射；其他 metadata 成员不进入运行时。JSON batch 逐项校验并保持部分失败；multipart 创建仍表示一个任务项。
- `SubmitRequestCommand` 和 `RequestContext` 在执行期携带 OPTIONAL `taskEventId`；`RequestRun`、`RequestRunRecord`、SQLite 和数据库 ActiveContext 不保存该值。
- trace 启用时，retry、edit/resubmit、pending input resume 和运行上下文重建通过既有 timeline query 按 `runId` 读取最多 9 条接收前缀 event，只允许前置 `HOOK_INVOKED`，并从第一个 `REQUEST_ACCEPTED` 恢复该值；不得从锚点后的 lifecycle event 推断。trace 关闭时不执行恢复。
- `agent-contracts/observability` 增加不含 trace/span 标识和 SDK 类型的 `ExecutionCorrelationRef`，以及只接受受控 W3C 载体的窄执行关联端口；该端口只负责入站载体绑定、执行引用激活和下游请求头生成，不负责 span 生命周期。
- `agent-observability` 增加共享 span registry、`TimelineSpanLifecyclePort`、`createTraceAwareTimelineStore` 和 `createTraceAwareRequestRunStore`；两类 store 装饰器共享同一个生命周期实例。
- trace 启用时，`agent-runtime` 在构造 timeline Record 时写入可信 `attributes.eventId`，但不创建 span、不生成 trace ID，也不导入 OTel API；trace 关闭时省略该属性。
- `agent-runtime` 在唯一的 `agent.execute` 调用点激活 REQUEST ref；现有模型包装边界、Tool Loop 能力执行边界和本地工作流节点处理器范围只激活各自 `ExecutionCorrelationRef`，均不创建或结束 span。工作流节点内部的 `CapabilityInvocationPort` 不增加包装层或执行引用。
- 本地工作流事件增加 `nodeExecutionId` 和 `predecessorNodeExecutionIds`，运行时投影把它们带入节点 lifecycle timeline。
- `TraceProjector` 根据 observation 是否已由 timeline lifecycle 拥有进行精确避让；已经拥有的请求、模型、能力和工作流真实执行节点 observation 只能由 timeline 生命周期路径创建 span，未拥有的既有诊断 observation 继续按辅助观测规则处理。
- trace 启用时，下游传输包装器注入 `traceparent`、可选 `tracestate` 和 `x-task-event-id`，系统值覆盖大小写不敏感的同名业务请求头；trace 关闭时三者均不注入。
- trace 配置把进程内关联与 OTLP exporter 解耦；未配置 exporter 时仍可生成 timeline trace 关联和下游 W3C 载体。

## Capability 影响

### 新增 Capability

- `task-event-trace-correlation`：定义任务通道业务事件标识的输入、持久化、继承、清除、span attribute 和下游请求头行为。

### 修改的 Capability

- `trace-log-linking`：允许受控 timeline trace enrichment，并定义 timeline 驱动的权威执行 span、执行引用激活和 W3C 传播。
- `otel-observability-adapter`：划分 timeline 权威执行 span 与辅助观测 span，禁止重复创建。
- `otel-trace-export`：把既有 TraceProjector 推衍层级调整为 timeline lifecycle 受控权威执行层级，统一辅助观测 SpanKind，解耦进程内 trace 与 exporter，并移除直接 span ID 和 input/output 映射入口。
- `workflow-contracts`：增加真实节点执行标识和直接前驱列表。
- `workflow-execution-engine`：保证每次本地节点执行具有完整开始/终止 lifecycle 和确定的前驱关系。

## 主要 owner 与影响

- 主要 owner：`agent-observability`，拥有 OTel、span registry、timeline span 生命周期、trace-aware store 装饰器、传播和 `TraceProjector`。
- 权威 timeline owner：`agent-runtime`，继续拥有事件语义、sequence、持久化分类、终止复合提交及可信 `taskEventId` 属性投影。
- 必要接入：
  - `agent-app` 的异步 observability preload 在唯一 operational writer 创建后初始化 trace infrastructure，并把最终有效的 `traceEnabled` 注入 Task Channel composition。
  - local runtime package 只向异步 product composition 交接已校验配置、credential resolver 和唯一 operational writer，不提前创建或注入第二套 trace provider/projector。
  - `agent-channel-task` 始终校验 `taskMessages[0].metadata.eventId`，仅在注入策略启用时映射，保持 batch item 隔离且不依赖 OTel。
  - `agent-channel-task`、`agent-channel-web` 和内部提交入口绑定可选入站 W3C 载体。
  - `agent-core` 与 `agent-workflow` 在既有执行包装边界激活 `ExecutionCorrelationRef`。
  - `agent-app` 创建唯一生命周期实例并装饰 timeline store、request-run store、执行边界和下游传输。
  - `agent-platform-gateway-local` 不增加字段、列或查询接口；既有 timeline query 继续按 `runId` 返回持久化 event。

## 归档前更新基线

- 新增 `openspec/specs/task-event-trace-correlation/spec.md`。
- 更新 `openspec/specs/trace-log-linking/spec.md`、`openspec/specs/otel-observability-adapter/spec.md`、`openspec/specs/otel-trace-export/spec.md`、`openspec/specs/workflow-contracts/spec.md` 和 `openspec/specs/workflow-execution-engine/spec.md`。
- 更新 `openspec/designs/architecture/observability.md`、`openspec/designs/architecture/observability-boundaries.md` 和 `openspec/designs/architecture/workflow-execution-and-routing.md`。
- 更新受影响的 `agent-observability`、`agent-runtime`、`agent-workflow`、`agent-channel-task` 和 `agent-app` 模块设计；不存在的模块文档不为本变更新建空文档。
- 更新 `openspec/designs/spec-to-design-map.md`。
- `openspec/overview.md`、ADR、features 和 functions 无新增长期文档。

长期基线更新由归档前流程执行，不作为实施阶段任务。
