## 当前实现基线

本 change 的当前实施与合并基线为 `origin/main@84d309953`；该基线已包含 B305，后续实现以当前仓库中的任务通道、timeline、workflow、observability 代码和 active change 集合作为准。

### Timeline 与持久化

- `agent-runtime` 通过 `RunTimelineEventStoreGateway.appendEvent` 保存普通 timeline event。
- `RuntimeOwnedAgentRunStatePort` 也直接调用同一个 timeline store；`LIVE_ONLY` event 不进入该 store。
- 请求终止通过 `RequestRunStoreGateway.commitTerminal` 完成运行状态、消息和终止 timeline event 的复合事务，终止 event 不经过 `appendEvent`。
- `RunTimelineEvent.inlinePayload` 是开放的 `JsonObject`，目前没有受控 `trace` enrichment。
- `SubmitRequestCommand`、`RequestContext`、`RequestRun` 和 `RequestRunRecord` 没有 `taskEventId`。
- `RunTimelineEventStoreGateway.listEvents` 已支持按 Owner Scope、Agent Scope、sessionId 和 OPTIONAL runId 查询，无需新增 taskEventId 恢复接口。

### Observation 与 TraceProjector

- `agent-observability` 已有 `ObservabilityProjectorHost`、`TraceProjector`、OTel provider 和 OTLP exporter。
- `add-otlp-trace-export` 已归档到 `openspec/changes/archive/2026-07-27-add-otlp-trace-export` 并形成当前代码和长期规格基线；其三层 TraceProjector、完整 exporter 才启用 trace、`safeSummary` input/output 和 `currentOtelSpanId()` 规则会被本 change 的目标态替代。
- timeline 在持久化后被映射为 `ObservabilityObservationEvent`，`TraceProjector` 再调用 `startSpan`。
- 当前 `TraceProjector` 会为 request、model、capability、gateway 和部分 system observation 创建 span，并用进程内 map 推断 request/model/capability 父子关系。
- 当前 `REQUEST_ACCEPTED` span 创建后立即结束，只保留其 `SpanContext`；model lifecycle 另有开放 span，capability 和 request 终止 observation 仍生成原子 span。
- system/gateway observation 由现有组装期 wrapper 或 timeline observation mapper 产生；sandbox 的 `SANDBOX_EXECUTION_*` observation 来自 `createObservedSandboxGateway`。

### 执行与工作流

- `RunBoundModelInvocation` 在实际模型调用前后发出 `MODEL_INVOCATION_STARTED` 与终止 event。
- tool loop 在实际能力调用前后发出 `CAPABILITY_STARTED` 与 `CAPABILITY_COMPLETED`，使用 `toolCallId` 关联同一次调用。
- 本地工作流引擎会发出 `NODE_STARTED`、终止和增量 event，也支持 `Promise.allSettled` 驱动的并行分支。
- `WorkflowRuntimeEventProjector` 把部分节点 lifecycle 投影为 `CAPABILITY_STARTED` 和 `CAPABILITY_COMPLETED`，但当前 `WorkflowExecutionEvent` 没有区分重试、循环和并行实例的 `nodeExecutionId`，也没有直接前驱列表。
- 本地 recipe route 本身没有必须保留的独立 capability lifecycle；运行轨迹只呈现真实执行节点 span。

### 请求入口与下游

- 当前任务通道已支持最多 20 个 create item 的 JSON batch、逐项幂等和部分失败；multipart create 表示一个 item。
- 每个 item 只允许一个 task message；该 message 的 `metadata` 当前在输入投影后被路由丢弃。
- 请求通道没有统一绑定入站 W3C Trace Context 的实现。
- OpenRouter、CLIP、SkillHub、RobotRouter 和 RAG 在各自适配器内构造传输请求头；现有业务请求对象不携带执行 span。
- `agent-observability` 已采用普通 TypeScript decorator/factory 模式包装 runtime command、context engine 和 sandbox gateway，不存在框架级通用 wrapper。

## 目标设计

### 1. 唯一实现路径与 owner

本变更采用“timeline 持久化边界驱动 span 生命周期，执行包装边界只激活稳定引用”的唯一路径：

```text
请求入口
  -> 通道解析可选 W3C 载体
  -> ExecutionCorrelationPort.withIncomingCarrier(...)
  -> runtime 接收并生成 RequestRun
  -> runtime 构造 REQUEST_ACCEPTED Record
       attributes.eventId <- 可信 taskEventId
  -> createTraceAwareTimelineStore.appendEvent(...)
       TimelineSpanLifecyclePort.prepare
         -> 创建 request span
         -> 注册 ExecutionCorrelationRef
         -> 写入 inlinePayload.trace
       inner.appendEvent
       committed / failed
  -> 运行时异步执行
       runtime 的 agent.execute 调用点、model wrapper、Tool Loop capability boundary 与 node boundary 只 withExecutionRef(...)
       workflow handler 直接调用 capability port 时保持 node ref，不生成额外 lifecycle
       明确接入的下游 adapter 从该 ref 生成 traceparent / x-task-event-id
  -> 模型、Tool Loop 能力或节点 START/终止 event 重复相同流程
  -> createTraceAwareRequestRunStore.commitTerminal(...)
       prepare terminal event
       inner.commitTerminal
       COMMITTED/ALREADY_COMMITTED 后结束 request span
  -> 持久化后 observation
       TraceProjector 跳过 timeline 已拥有的权威执行 span
       TraceProjector 保留未被 timeline 拥有的辅助观测 span
```

职责固定如下：

| 关注点 | owner | 约束 |
|---|---|---|
| timeline 事件语义、顺序、持久化分类和终止事务 | `agent-runtime` | 不创建 span，不导入 OTel |
| `taskMessages[0].metadata.eventId` 校验 | `agent-channel-task` | 每个 batch item 只映射自身可信 `taskEventId` |
| `taskEventId` 执行期携带与 timeline `attributes.eventId` | `agent-runtime` | `REQUEST_ACCEPTED` 是唯一权威恢复锚点 |
| 入站 W3C 解析 | 各请求通道 | 只处理本通道传输外形 |
| W3C 语法校验、span registry、span 生命周期、传播 | `agent-observability` | OTel 类型不离开实现包 |
| trace-aware store 装饰器 | `agent-observability` | 包装 gateway port，不修改物理 gateway |
| 执行引用激活 | `agent-runtime` 的 `agent.execute` 调用点、既有 model wrapper、Tool Loop capability boundary 与本地 workflow node boundary | 只使用 `ExecutionCorrelationRef`，不调用 OTel；workflow handler 内部模型与 capability port 调用保持 node ref |
| 本地节点执行标识和前驱 | `agent-workflow` | 来自实际执行状态，不按完成时间推断 |
| 依赖注入 | `agent-app` | 每个应用实例只创建一个生命周期与 registry |
| Resource | `agent-observability` tracer provider | 不从 timeline 事件输入 |

主要 owner 为 `agent-observability`。`agent-runtime` 继续是 canonical timeline 唯一 owner；trace-aware decorator 只获得本 change 明确授权的保留命名空间 enrichment 权限。

### 2. 运行关联事实

#### 2.1 taskEventId

任务通道 JSON batch 请求：

```json
{
  "tasks": [
    {
      "taskMessages": [
        {
          "text": "分析告警",
          "metadata": {
            "eventId": "task-event-1"
          }
        }
      ],
      "idempotencyKey": "create-alarm-analysis-1"
    }
  ]
}
```

multipart 创建的 `taskMessages` 字段仍使用相同的单元素 JSON 数组结构。`taskMessages[0].metadata.eventId` 存在时长度必须为 1 至 32 个字符，且只允许 ASCII 字母、数字、连字符、下划线、空格、点和冒号，等价校验规则为 `^[A-Za-z0-9_.: -]{1,32}$`。任务通道必须在对应 item 的会话和运行创建前复用 `agent-common` 的 `TaskEventId` 纯校验函数。trace 启用时映射为：

```ts
interface PropagationAttributes {
  readonly taskEventId?: TaskEventId;
}
```

`TaskEventId` 是 runtime 与 observability 共享的有界标量，归 `agent-common`。`PropagationAttributes` 归 `agent-contracts/runtime`，作为 OPTIONAL 字段只进入 `SubmitRequestCommand` 和 `RequestContext`。`RequestRun`、`RequestRunRecord`、checkpoint、message、数据库 ActiveContext 和 SQLite row 均不增加该字段。

trace 关闭时，任务通道仍执行输入 schema 校验，但不得把该值映射到 `SubmitRequestCommand` 或 `RequestContext`，不得把它加入提交幂等语义，也不得写入 timeline、span attribute 或出站请求头。这样 trace 关闭路径不需要 eventId-only registry entry，也不会让同一个 eventId 跨越多个互不关联的 trace。

runtime 必须先把当前 `RequestContext` 中的值投影到 `REQUEST_ACCEPTED`：

```json
{
  "attributes": {
    "eventId": "task-event-1"
  }
}
```

业务事件生产者提供的 `attributes.eventId` 不可信。runtime 的值覆盖同名值；没有绑定时省略。该值不进入日志、指标或审计。

trace 启用时，`REQUEST_ACCEPTED.inlinePayload.attributes.eventId` 是 taskEventId 的唯一权威恢复锚点。请求 accepted 响应和后台执行只能在该 event 成功持久化后开始。当前进程继续从 `RequestContext` 携带该值；trace lifecycle 在处理 START event 时把可信 `eventId` 复制到对应 registry entry，供 timeline 权威执行 span attribute 和 `x-task-event-id` 使用。trace 关闭时不存在该锚点或 registry 值。

当前 `BEFORE_REQUEST_ACCEPT` 每阶段最多执行 8 个 hook，每次 hook 会在请求接收前形成一条 `HOOK_INVOKED`，因此 `REQUEST_ACCEPTED` 不保证是 run 的第一条 RUNTIME event。trace 启用且运行上下文需要重建时，runtime 使用既有 `RunTimelineEventStoreGateway.listEvents` 读取有界接收前缀；trace 关闭时不执行 taskEventId 恢复：

```ts
const acceptancePrefix = await timelineStore.listEvents({
  tenantId,
  subjectId,
  agentId,
  sessionId,
  runId,
  afterSequence: 0,
  limit: 9
});
```

前缀中只允许零至八条 `HOOK_INVOKED` 位于第一个 `REQUEST_ACCEPTED` 之前。只有该 `REQUEST_ACCEPTED.inlinePayload.attributes.eventId` 通过共享 `TaskEventId` 校验时才恢复。查询失败、前缀中出现其他前置类型、前九条内没有 `REQUEST_ACCEPTED` 或属性无效时，恢复结果固定为缺失，并输出不含原值的有界安全降级证据；不得扫描该锚点后的 lifecycle event、message、checkpoint、RequestRun、数据库 ActiveContext 或 AgentMemory 推断该值，也不得仅因 taskEventId 无法恢复而拒绝 retry、edit/resubmit、pending input resume 或运行上下文重建。

延续规则：

| 操作 | taskEventId |
|---|---|
| trace 启用的任务首次创建 | 来自当前 item 已校验的 `taskMessages[0].metadata.eventId` |
| trace 关闭的任务首次创建 | 缺失 |
| Web 或内部提交 | 缺失 |
| retry | 创建任何新运行事实前从来源 run 的有界接收前缀读取 `REQUEST_ACCEPTED` 锚点 |
| edit/resubmit | 创建任何新运行事实前从来源 run 的有界接收前缀读取 `REQUEST_ACCEPTED` 锚点 |
| pending input resume | 重建上下文时从当前 run 的有界接收前缀读取 `REQUEST_ACCEPTED` 锚点 |
| 运行恢复 | 重建上下文时从当前 run 的有界接收前缀读取 `REQUEST_ACCEPTED` 锚点；span 恢复仍不在范围内 |
| fork 后的新运行 | 不调用 taskEventId 恢复，保持缺失 |

trace 启用时，首次任务提交的幂等语义必须包含当前 item 已校验的 `taskEventId`，但不得把原值写入 `request_runs.idempotency_semantic`。唯一实现路径是：缺少 taskEventId 或 trace 关闭时保持既有提交幂等语义；trace 启用且存在 taskEventId 时，对包含该值的规范化完整提交语义计算 SHA-256，并只保存带版本前缀的固定长度摘要。该摘要只用于相等性冲突判断，不是 taskEventId、不得用于恢复或传播。同一个 item 的幂等键在 trace 启用时携带不同值属于提交语义冲突，不需要从 RequestRun 读取 taskEventId 原值。retry/edit 只在 trace 启用时于计算新运行语义和创建新运行事实前完成锚点读取。

当前任务通道支持最多 20 项的 JSON batch，每个 item 独立处理并拥有自己的幂等键。同一个 HTTP 请求只提供一组入站 W3C carrier，因此 trace 启用时一个有效上游 span 可以成为多个 task request span 的共同 parent；每个运行仍必须使用自己的 `taskEventId`、`REQUEST_ACCEPTED` 锚点、registry entry 和下游 `x-task-event-id`。trace 关闭时所有 item 都不绑定 eventId。一个 item 的 eventId 校验或运行失败不得污染或回滚其他 item。multipart 创建只表示一个 item，并遵守同一字段来源和校验规则。

#### 2.2 ExecutionCorrelationRef

`agent-contracts/observability` 增加不含 SDK 类型的稳定引用：

```ts
type ExecutionCorrelationKind =
  | "REQUEST"
  | "MODEL"
  | "CAPABILITY"
  | "WORKFLOW_NODE";

interface ExecutionCorrelationRef {
  readonly requestRunId: string;
  readonly kind: ExecutionCorrelationKind;
  readonly executionId: string;
}
```

唯一键为 `requestRunId + kind + executionId`：

| kind | executionId |
|---|---|
| `REQUEST` | `requestRunId` |
| `MODEL` | `stepId` |
| `CAPABILITY` | `toolCallId` |
| `WORKFLOW_NODE` | `nodeExecutionId` |

不得使用 timeline `eventId`、`taskEventId`、静态 `nodeId` 或 observation 到达顺序作为 registry key。

`ExecutionCorrelationPort` 只提供三类行为：

```ts
interface ExecutionCorrelationPort {
  withIncomingCarrier<T>(
    carrier: W3CTraceCarrier | undefined,
    operation: () => Promise<T>
  ): Promise<T>;

  withExecutionRef<T>(
    ref: ExecutionCorrelationRef,
    operation: () => Promise<T>
  ): Promise<T>;

  outboundHeaders(
    input?: Readonly<Record<string, string>>
  ): Readonly<Record<string, string>>;
}
```

该端口不提供 `startSpan`、`endSpan`、`snapshot` 或任意 OTel 对象。`withExecutionRef` 只把稳定引用绑定到进程内异步作用域；对应 span 必须已经由 START timeline event 创建。查不到引用时，操作继续执行，传播降级为 request 引用或无 trace。

request 引用激活采用唯一的最小增量路径：`createRequestLifecycleCoordinator` 的组装依赖增加 OPTIONAL `ExecutionCorrelationPort`，`agent-runtime` 在当前唯一的 `agent.execute(run, context, signal)` 调用点，以 `REQUEST` ref 包装该次调用；端口缺失时保持原直接调用行为。`agent-app` 在产品 composition 中始终注入与 timeline lifecycle 共享 registry 的同一个端口实例，trace 关闭由该端口内部降级。该路径不新增第二个 `Agent` wrapper、不修改 `Agent` contract，也不让 runtime 导入 OTel；runtime 只消费 `agent-contracts/observability` 的窄端口。

### 3. TimelineSpanLifecyclePort 与 store 装饰器

#### 3.1 位置与调用者

`TimelineSpanLifecyclePort` 是 `agent-observability` 的实现边界，不加入 runtime、gateway 或公共 Web contract。它由以下两个 decorator 调用：

- `createTraceAwareTimelineStore(inner, lifecycle)`：包装 `RunTimelineEventStoreGateway.appendEvent`。
- `createTraceAwareRequestRunStore(inner, lifecycle)`：完整透传其他 `RequestRunStoreGateway` 方法，只包装 `commitTerminal`。

两个 decorator 与 `TraceProjector` 必须共享同一个 registry。`agent-app` 先创建 lifecycle，再装饰 store，最后把装饰后的 store 注入 runtime。SQLite gateway 不感知 trace。

`agent-app` 的固定组装顺序为：

1. observability preload 根据配置初始化 tracer provider，并创建一个共享 registry、`TimelineSpanLifecyclePort` 和 `ExecutionCorrelationPort`。
2. product model preload 创建 OpenRouter adapter 时注入该 `ExecutionCorrelationPort`；外部直接注入的 `ModelInvocationService` 保持调用方自有实现，不由 NextAgent 改写。
3. gateway/capability composition 创建 CLIP、SkillHub、RobotRouter 和本地工作流远端 RAG adapter 时注入同一个端口。
4. gateway store 可用后，用同一个 lifecycle 装饰 timeline store 和 request-run store，再把装饰后的 store 与同一个 correlation port 注入 runtime/core/workflow。
5. `TraceProjector` 使用同一 registry，Task/Web Channel 使用同一 correlation port 绑定入站 carrier；不得在后续 layer 再创建 registry、lifecycle 或 port。

该顺序同时约束所有正式可执行入口：backend-only、local-configured-auth、with-frontend、local runtime package、remote runtime package、根进程入口和开发后端入口必须进入异步 product composition。local runtime package 可以在 preflight 中先创建唯一 operational writer，但不得自行初始化或注入 trace provider/projector；provider/projector 的唯一创建点仍是异步 observability preload。公开同步 factory 仅保留既有嵌入与测试兼容面，只有调用方已显式注入完成初始化的 `traceProjector` 时才启用 trace，不得成为正式可执行入口。

普通追加固定流程：

```ts
const prepared = lifecycle.prepareSafely(record);
try {
  const persisted = await inner.appendEvent(prepared.record, options);
  lifecycle.committedSafely(prepared, persisted);
  return persisted;
} catch (error) {
  lifecycle.failedSafely(prepared, error);
  throw error;
}
```

终止复合提交固定流程：

```ts
const prepared = lifecycle.prepareSafely(request.terminalEvent);
try {
  const result = await inner.commitTerminal({
    ...request,
    terminalEvent: prepared.record
  });

  if (result.status === "COMMITTED") {
    lifecycle.committedSafely(prepared, result.terminalEvent);
  } else if (result.status === "ALREADY_COMMITTED") {
    lifecycle.alreadyCommittedSafely(prepared.ref);
  } else {
    lifecycle.notCommittedSafely(prepared, result.status);
  }
  return result;
} catch (error) {
  lifecycle.failedSafely(prepared, error);
  throw error;
}
```

所有 `*Safely` 方法都必须 failure-isolated，不得把 OTel、registry、attribute、snapshot、清理或诊断输出异常传播给 store 调用者。`prepareSafely` 失败时返回不带 `trace` 的原 Record；如果失败发生在新 span 创建后，它必须先安全结束并移除该 entry。`committedSafely` 等提交后回调失败时，decorator 仍必须返回 inner store 的原成功结果。

`ALREADY_COMMITTED` 表示本次传入的 `prepared.record` 没有被持久化，因此不得把它交给 `committedSafely`，也不得把其中新生成的 snapshot 当成权威事实。`alreadyCommittedSafely` 只按稳定 ref 幂等关闭或清理本进程已有 ACTIVE entry；entry 已经是 CLOSED 或不存在时直接 no-op。只包装 `appendEvent` 不满足要求，因为终止 event 绕过该方法。

#### 3.2 生命周期状态

每个 `ExecutionCorrelationRef` 的进程内状态使用以下最小转换：

| 当前状态 | 输入 | 持久化结果 | 下一状态 | 行为 |
|---|---|---|---|---|
| 不存在 | START | 成功 | ACTIVE | 创建 span，保存 context，timeline 写入 snapshot |
| 不存在 | START | 失败 | 不存在 | span 标记错误并结束，移除 entry |
| ACTIVE | 重复 START | 成功 | ACTIVE | 复用首次 span，不创建第二个 span |
| ACTIVE | TERMINAL | 成功 | CLOSED | terminal 使用同一 snapshot，提交后结束 span |
| ACTIVE | TERMINAL | 未提交或抛错 | ACTIVE | 不结束 span，允许业务重试 |
| CLOSED | 重复 TERMINAL | 已提交 | CLOSED | 复用 tombstone，不重复结束 |
| ACTIVE | 重复 TERMINAL | 已提交 | CLOSED | 不接受本次 prepared snapshot，只幂等结束本进程已有 span |
| 不存在 | TERMINAL | 任意 | 不存在 | 不补建 span，省略 trace 并产生有界降级证据 |

请求终止成功后，所有子 entry 的 span 都必须已结束；残留 ACTIVE 子 span 以 `REQUEST_TERMINATED` 原因安全结束。为处理迟到的辅助 observation 和工作流前驱解析，CLOSED entry 只保留 `traceId`、`spanId`、`parentSpanId`、`traceparent`、可选 `tracestate`、`eventId` 和关闭时间，不保留 Span 对象。请求终止复合提交成功时开始计时，全部 tombstone 保留 120 秒后一次性删除；不得在请求仍为 ACTIVE 时按 LRU 提前删除已结束前驱。

进程崩溃后的 registry 恢复不在本 change 范围内。幂等重放在同一进程内复用 entry；新进程不得根据历史 timeline 重新创建已结束 span。

### 4. Timeline 事件到权威执行 span 的映射

#### 4.1 映射规则

| Timeline lifecycle | ref kind | START | TERMINAL | OTel 父级 | observation_type | SpanKind |
|---|---|---|---|---|---|---|
| 请求 | `REQUEST` | `REQUEST_ACCEPTED` | `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED`、`REQUEST_SUPERSEDED` | 有效入站 parent；否则 root | `request` | INTERNAL |
| 模型 | `MODEL` | 既有 `RunBoundModelInvocation` 产生的 `MODEL_INVOCATION_STARTED` | `MODEL_INVOCATION_COMPLETED`、`MODEL_INVOCATION_FAILED` | request span | `model` | CLIENT |
| 能力 | `CAPABILITY` | Tool Loop 产生的 `CAPABILITY_STARTED` | 匹配 `toolCallId` 的 `CAPABILITY_COMPLETED` | request span | `tool` | CLIENT |
| 本地真实执行节点 | `WORKFLOW_NODE` | 带 `nodeExecutionId` 且 `nodeType` 不是 START/END 的 `CAPABILITY_STARTED` | 匹配 `nodeExecutionId` 的 `CAPABILITY_COMPLETED` | request span | `workflow_node` | INTERNAL |
| START/END 脚手架 | 无独立 ref | START 只有 `CAPABILITY_STARTED`；END 无 START | END 只有 `CAPABILITY_COMPLETED`；START 无 TERMINAL | 复用 request span snapshot，不创建 span | 无新增 observation_type | 无新增 SpanKind |

本地 deterministic recipe route 不创建独立 RECIPE timeline 权威执行 span。START/END 脚手架节点只保留 timeline 中已有的 workflow 起止锚点，不分配 `WORKFLOW_NODE` 执行引用，也不创建或结束 span；trace 启用且 request span 可解析时，两类 event 复用 request span snapshot，使按 traceId 查询仍能返回 workflow 起止锚点。其他真实执行节点 lifecycle 按 `WORKFLOW_NODE` 创建 span；route 级别的请求事实继续关联 request span。节点 handler 内部调用模型或 `CapabilityInvocationPort` 不生成额外 MODEL/CAPABILITY lifecycle 或执行引用；模型、CLIP、REST、RAG 和远端工具等出站调用直接使用当前节点 span。

父级选择只在 START event 首次进入 timeline store decorator 时执行并冻结到 registry entry。既有直接 MODEL 和 Tool Loop CAPABILITY 始终以 request span 为父级，不根据普通代码调用栈或当前 WORKFLOW_NODE 作用域改变父级。工作流节点内部的模型与 capability port 调用保持节点执行引用，不新增权威执行层级。

#### 4.2 入站 W3C

各请求通道按自身协议提取 OPTIONAL `traceparent` 和 `tracestate`，再调用 `withIncomingCarrier`。W3C 语法校验由 `agent-observability` 完成。

- 有效 `traceparent` 无论 sampled flag 为 0 或 1，都作为 request span 的远程父级；是否记录和导出由 OTel sampler 决定。
- 缺失载体时，`REQUEST_ACCEPTED` 创建 root span。
- 无效、全零、重复或超限载体被忽略，request 创建 root span，并输出不回显原值的安全降级证据。
- 内部提交没有通道载体时同样创建 root span，不构造虚拟 channel。
- trace 关闭时不创建 span、不写 `inlinePayload.trace` 或 `inlinePayload.attributes.eventId`，不绑定或恢复 `taskEventId`，也不传播 W3C 或 `x-task-event-id`。

### 5. 执行引用激活与下游传播

span 创建与执行激活分离：

- `agent-runtime` 在唯一的 `agent.execute` 调用点，通过注入的 `ExecutionCorrelationPort.withExecutionRef` 激活 REQUEST ref。
- `RunBoundModelInvocation` 在 START event 持久化成功后、调用模型前激活 MODEL ref。
- tool loop 在 START event 持久化成功后、调用能力前激活 CAPABILITY ref。
- 本地工作流引擎在 NODE_STARTED 已被 observer 持久化后、调用节点 handler 前激活 WORKFLOW_NODE ref。

上述业务执行边界不得调用 OTel `startSpan` 或 `end()`。span 的创建和结束只能由 timeline store decorator 根据已有 START/TERMINAL timeline event 驱动：`REQUEST_ACCEPTED`、既有直接 MODEL、Tool Loop CAPABILITY 和 WORKFLOW_NODE START 第一次进入持久化 wrapper 且尚未写入数据库时，`TimelineSpanLifecyclePort.prepareSafely` 创建 span 和 snapshot。START 持久化成功后，对应执行边界才激活已经存在于共享 registry 中的 ref；TERMINAL 持久化成功后，lifecycle 才结束 span。工作流节点内部调用模型或 capability port 均不产生额外 lifecycle，不激活 MODEL/CAPABILITY ref，因此 `outboundHeaders` 继续解析当前节点 context；并行节点因 `nodeExecutionId` 不同而相互隔离。

`outboundHeaders` 固定执行：

1. 复制业务请求头。
2. 按大小写不敏感规则删除 `traceparent`、`tracestate` 和 `x-task-event-id`。
3. 从当前最窄 ExecutionCorrelationRef 查找 entry；没有当前 ref 时回退到当前 request ref。
4. trace 启用且 entry 有有效 context 时写入 `traceparent` 和可选 `tracestate`。
5. trace 已启用且 entry 有 `eventId` 时写入 `x-task-event-id`；trace 关闭或 entry 无值时保持删除状态。
6. 返回新对象，不修改调用者输入。

首版只接入当前代码中与本地 request/workflow 执行直接相关的五类明确出站边界：

| 出站边界 | 唯一注入点 | 本地传输 span |
|---|---|---|
| OpenRouter | `withNextAgentHeaders` 合并现有模型调用请求头后调用 `outboundHeaders` | 不创建 |
| CLIP | `createSandboxClipCommandRunner` 接收端口，在执行时生成系统请求头并传给 `buildClipExecutionArgs`；`clipParamsEnvelope` 将其写入 `params.header` 并覆盖同名业务值，不修改 capability DTO | 不创建 |
| SkillHub HTTP v1 | `FetchSkillHubRemoteGatewayAdapter.headers()` 合并 content-type 和凭据后调用 `outboundHeaders` | 不创建 |
| RobotRouter guardrail | `createRobotRouterGuardrailProvider` 的三个 POST 请求统一通过注入的 header provider 调用 `outboundHeaders` | 不创建 |
| 本地工作流使用的远端 RAG 检索 | `createHttpWorkflowRagClient` 的 `postJson` 在发送前调用 `outboundHeaders` | 不创建 |

这些 adapter 的 factory/options 必须接收同一个 `ExecutionCorrelationPort`，由 `agent-app` 显式注入；测试使用 fake port。对于在 gateway provider 创建阶段构造的 RobotRouter 和远端 RAG，`agent-app` 通过 OPTIONAL `GatewayProviderCreateInput.executionCorrelation` 传入同一端口，provider 只把它继续交给物理 adapter；该字段是组装依赖，不属于 gateway 业务数据、持久化 Record 或查询/写入 port。它们只注入当前权威执行 span 的 W3C context，不调用 `startSpan`，也不把辅助观测 span 设为 active context。现有 HTTP instrumentation 必须继续关闭 outgoing request instrumentation，避免自动补建物理 HTTP CLIENT span。NextAgent 不为下游创建 SERVER span；符合 W3C/OTel 的下游服务从载体提取 parent 后创建自己的 SERVER span。当前仓库没有独立的通用 REST/tool HTTP wrapper，因此本 change 不新增泛化 wrapper，也不覆盖 task callback、remote workflow execution、部署控制或其他不属于本地执行下游的 HTTP 请求。后续新增出站 adapter 时必须显式接入该端口并补充对应 OpenSpec 和测试。

### 6. 本地工作流执行关联

`WorkflowExecutionEvent` 增加：

```ts
readonly nodeExecutionId?: string;
readonly predecessorNodeExecutionIds?: readonly string[];
```

字段为 OPTIONAL 是为了不改变 remote workflow 传输；本地引擎发出的每个真实执行节点 lifecycle event 必须包含两者，START/END 脚手架 event 必须省略两者。`nodeExecutionId` 复用 `WorkflowSafeIdSchema`，长度为 1 至 128，只允许 `[A-Za-z0-9._:-]`，并使用随机标识保证每次尝试、循环迭代和子流程节点实例均不同。同一真实执行实例的 START、增量和 TERMINAL 复用同一值。

前驱规则：

| 场景 | predecessorNodeExecutionIds |
|---|---|
| 入口节点 | `[]` |
| 顺序节点 | 上一个实际完成并选择该边的节点实例 |
| 条件分支入口 | 实际选择分支的前驱实例 |
| 并行分支入口 | 分叉节点实例 |
| 并行汇聚 | 按 recipe 分支声明顺序排列的全部直接前驱实例 |
| 重试 | 失败尝试为下一尝试的直接前驱；后继节点只接最终尝试 |
| 循环 | 触发下一迭代的前一个实例 |
| 子流程 | 子流程入口关联 SUBFLOW 节点实例；父流程后继关联 SUBFLOW 实例 |

`WorkflowRuntimeEventProjector` 把 `nodeExecutionId` 和 `predecessorNodeExecutionIds` 带入真实执行节点的 lifecycle payload。LLM、DISPLAY、AGENT、TOOL、SKILL、SUBFLOW、网关、交互和知识节点都必须产生一个 START 和恰好一个 TERMINAL。既有 START 脚手架只投影 `NODE_STARTED -> CAPABILITY_STARTED`，既有 END 脚手架只投影 `NODE_COMPLETED -> CAPABILITY_COMPLETED`；二者不伪造配对事件，不携带执行关联字段，也不进入 span lifecycle。重试必须先发出当前尝试的 `NODE_FAILED`，再开始下一尝试。

Timeline span lifecycle 在节点 START 时把全部前驱 ref 解析为同一 trace 下的 span ID：

- 全部解析成功时，按输入顺序去重并写入 `previewSpanIds`。
- 入口节点写入空数组。
- 任一前驱缺失、跨 trace、等于当前 span 或总数超过 128 时，整体省略 `previewSpanIds`，不得写入部分结果或按时间推断。
- 已结束前驱的 tombstone 保留到 request 终止，保证并行汇聚可解析。

### 7. Timeline enrichment

Workflow 节点示例：

```json
{
  "nodeId": "query-alarm",
  "description": "查询当前活动告警",
  "nodeExecutionId": "node-exec-01",
  "predecessorNodeExecutionIds": [],
  "trace": {
    "traceId": "7bba9f33312b3dbb8b2c2c62bb7abe2d",
    "spanId": "2222222222222222",
    "parentSpanId": "1111111111111111",
    "previewSpanIds": [],
    "traceparent": "00-7bba9f33312b3dbb8b2c2c62bb7abe2d-2222222222222222-01"
  },
  "attributes": {
    "eventId": "task-event-1"
  }
}
```

`nodeId` 和 `description` 由业务投影编写。trace-aware decorator 不生成或修改它们。`inlinePayload.trace` 和 `inlinePayload.attributes` 是保留命名空间：

```text
runtimePayload =
  producerPayloadWithoutReservedNamespaces
  + runtimeGeneratedAttributes

persistedPayload =
  runtimePayload
  + lifecycleGeneratedTraceIfValid
```

`trace` 字段规则：

- `traceId`：32 位小写十六进制。
- `spanId`：16 位小写十六进制。
- `parentSpanId`：有标准父 span 时存在。
- `previewSpanIds`：只用于本地工作流节点。
- `traceparent`：从当前 span context 生成。
- `tracestate`：存在有效值时保存。

同一 lifecycle 的 START 和 TERMINAL 保存相同 `traceId`、`spanId`、`parentSpanId` 和 `previewSpanIds`。`LIVE_ONLY` event 继续不持久化，enrichment 不改变分类。

### 8. TraceProjector 职责收敛

span owner 使用互斥集合：

| Observation 类别 | 行为 |
|---|---|
| 已携带 timeline lifecycle owner 标记的 request/model/capability/workflow observation | 不创建、结束或修改 timeline 权威执行 span |
| request diagnostic allowlist 中没有 timeline span owner 的 observation | 有 request context 时挂到 request；缺少 request context 时创建不进入权威 registry 的独立诊断 span |
| system allowlist | request context 存在时创建辅助观测 span |
| gateway_call allowlist | request context 存在时创建辅助观测 span |

唯一识别路径是在 `agent-observability` 内部的 `ObservabilityObservationEvent` 增加 OPTIONAL 低基数字段 `spanOwner: "TIMELINE_LIFECYCLE"`。持久化 timeline 到 observation 的 mapper 对 REQUEST START/TERMINAL、MODEL lifecycle、直接 CAPABILITY lifecycle、带有效 `nodeExecutionId` 的真实工作流节点 lifecycle，以及已由 timeline 路径关联到 request span 的 START/END 脚手架 observation 设置该值；请求拒绝类 observation 不设置。该字段表示 span 投影决策归 timeline lifecycle 所有，并不表示每条 observation 都创建独立 span。该字段不进入 `agent-contracts`、timeline、日志、指标、审计或外部 DTO。

因此当前 `REQUEST_ACCEPTED`、request terminal、MODEL、直接 CAPABILITY 和真实工作流节点 span 的生成与修改逻辑必须从 `TraceProjector` 删除，但不得按整个 observation boundary 一刀切删除。`TraceProjector` 只对 `spanOwner="TIMELINE_LIFECYCLE"` 的 observation 避让；没有该标记且位于 request diagnostic allowlist 的 observation 必须继续投影。timeline 权威执行 span 的 attributes、event、status 和结束状态都由 timeline lifecycle 唯一负责。有 request context 的辅助观测 span 是 request span 的直接 INTERNAL 子级；request diagnostic 缺少 request context 时创建独立诊断 span。gateway 辅助 span 表示 NextAgent 内部诊断阶段，不表示入站服务处理，因此也必须使用 INTERNAL，不能使用 SERVER。独立诊断或其他辅助 span 不得注册为 request 权威 span、写入 timeline、参与 `previewSpanIds`、进入 active execution scope 或成为下游传播父级。

保留的 request diagnostic allowlist 固定包含当前已有且未被 timeline 拥有的 `REQUEST_REJECTED`、`TERMINAL_COMMITTED`、`TERMINAL_FAILED`、`REQUEST_CONTROL_REJECTED`、`PENDING_INPUT_REJECTED` 和 `POLICY_APPLIED`。system allowlist 固定为当前已有的 `HOOK_INVOKED`、`HOOK_COMPLETED`、`HOOK_FAILED`、`POLICY_EVALUATED`、`POLICY_ALLOWED`、`POLICY_DENIED`、`POLICY_FAILED`、`ATTACHMENT_ACCEPTED`、`ATTACHMENT_REJECTED`、`ROUTING_DECISION`、`SAFE_ERROR_EMITTED`、`APP_SHUTDOWN`、`MEMORY_CONFIG_EVALUATED`、`MEMORY_DESCRIPTION_OVERRIDE_EVALUATED`，以及 `LANE_DRAIN_`、`RECOVERY_SCAN_` 前缀 operation。gateway allowlist 固定为 `createObservedSandboxGateway` 产生的 `SANDBOX_EXECUTION_STARTED`、`SANDBOX_EXECUTION_COMPLETED`、`SANDBOX_EXECUTION_FAILED`、`SANDBOX_EXECUTION_DENIED` 和 `SANDBOX_EXECUTION_TIMED_OUT`。不在上述集合且未由 timeline lifecycle 拥有的 observation 不创建辅助 span；后续扩展 allowlist 必须先修改 OpenSpec。

system/gateway allowlist observation 查不到 request context 时必须跳过 span 创建并返回有界降级结果，不得创建新的 root trace。request diagnostic allowlist 是唯一例外：缺少 request context 时创建不进入权威 registry 的独立诊断 span。能够解析 request context 时，所有辅助 span 的 request parent context 都来自 timeline lifecycle registry，而不是 `TraceProjector` 私有 `rootSpanContexts`。

### 9. Resource 与 span attributes

OTel Resource 在 tracer provider 初始化时统一设置：

- `service.name`
- `service.version`
- `service.instance.id`
- deployment environment
- 可用时的 pod、namespace 和容器资源属性

Resource 来源是可信配置或资源检测器，不来自 timeline event、请求 metadata、模型或能力输入。远端 CLIP、模型或工具服务上报自身 Resource；NextAgent 不替下游填写 pod 信息。

每个 timeline 权威执行 span 只从安全 timeline lifecycle 投影动态 attributes：

- `eventId`
- `nodeId`
- `description`
- 稳定 execution kind
- outcome、safe reason code 和 duration

本 change 不注入 input/output。后续节点专属 attributes 必须通过独立 allowlist refinement 定义，不能由业务 payload 任意透传。

### 10. 配置、失败与回滚

`observability.tracing.enabled` 控制进程内 span、timeline trace 和 W3C 传播。OTLP endpoint 与凭据只控制 exporter：

| enabled | exporter 配置 | 行为 |
|---|---|---|
| `false` | 任意 | 不创建 span、不导出、不传播 W3C，不映射 eventId |
| `true` | 完整 | 创建、enrich、传播 eventId/W3C 并导出 |
| `true` | 全部缺失 | 创建、enrich 和传播 eventId/W3C，不导出 |
| `true` | 部分存在 | 配置校验失败，应用不启动 |
| 缺失 | 完整 | 保持已有自动启用行为 |
| 缺失 | 全部缺失 | 关闭 |

`agent-observability` infrastructure factory 必须在 provider 初始化后返回最终有效的 `traceEnabled`。显式关闭、默认关闭或 provider 初始化失败时该值为 `false`；进程内 provider 可用但 exporter 缺失或失败时该值仍为 `true`。`agent-app` 必须先完成该初始化，再把 `traceEnabled` 作为不可变布尔策略注入 Task Channel composition。Task Channel 只依赖该布尔策略执行“始终校验、仅启用时映射”，不得导入 OTel、读取 exporter 状态或自行解释 tracing config。

失败语义：

- lifecycle prepare 失败：保存未带 `trace` 的原业务 event，记录安全降级。
- span attribute 或 snapshot 失败：省略受影响字段，不改变业务 payload。
- lifecycle 的 prepare、committed、failed、notCommitted 和 alreadyCommitted 回调失败：全部在 decorator 内吸收，inner store 的原结果或原错误保持不变。
- timeline append 失败：按原 gateway 错误返回；新建 span 按状态表清理。
- terminal commit 未提交：不结束 request span，等待业务重试。
- exporter 不可用：不影响 span registry、timeline enrichment、下游传播或业务执行。
- execution ref 激活或 lookup 失败：业务调用继续；删除不可信 W3C 和 `x-task-event-id` 请求头；只有 trace 已启用且能够回退到可信 request entry 时才传播对应系统值。

回滚先设置 `enabled=false`。代码回滚保留历史 `inlinePayload.trace` 和 `inlinePayload.attributes.eventId`；旧读取方按开放 JSON 处理，不删除历史关联。

## 已确认的契约范围

本 change 涉及以下共享契约 refinement；当前方案已经在本次评审讨论中确认，不保留实现阶段选择：

| 契约 | 最终变更 |
|---|---|
| `agent-common` | 新增长度为 1 至 32 个字符且只允许 `[A-Za-z0-9_.: -]` 的 `TaskEventId` 标量、pattern/上限常量和纯校验函数；Task Channel 的 TypeBox schema 复用这些常量，不让 `agent-common` 依赖 TypeBox |
| `agent-contracts/runtime` | `PropagationAttributes.taskEventId` 只进入 `SubmitRequestCommand` 和 `RequestContext` |
| `agent-contracts/gateway` | 不增加 Record 字段或新接口；复用 `RunTimelineEventStoreGateway.listEvents` |
| `agent-contracts/observability` | 新增无 trace ID、无 SDK 类型的 `ExecutionCorrelationRef` 与 `ExecutionCorrelationPort` |
| `agent-contracts/core` | `WorkflowExecutionEvent` 增加 OPTIONAL `nodeExecutionId` 和 `predecessorNodeExecutionIds`；本地真实执行节点强制生成，START/END 脚手架省略 |
| `RunTimelineEvent.inlinePayload` | 允许受控 `trace` 和 `attributes` enrichment，不新增顶层 trace 字段 |
| capability/model DTO | 不增加 trace、span、taskEventId 或请求头字段 |
| Web/stream DTO | 不暴露 trace 或 taskEventId |

该 refinement 保留“OTel SDK 不进入业务包”和“runtime 拥有 canonical timeline”两项核心不变量，只改变保留命名空间的受控 enrichment 权限。

## 依赖与归档顺序

`add-ts-task-channel` 和 `add-otlp-trace-export` 是本 change 的代码基线。`add-ts-task-channel` 的 task 10.2 已明确把 traceparent 到 runtime/下游的传播交给独立 change，本 change 是该独立 refinement；两者不修改同一个 capability spec，因此不建立归档先后，但本 change 不得修改 task-channel 的 batch、callback、query 或 public response owner。

实施时必须把本 change 的 task-channel propagation 验证证据回填到 `add-ts-task-channel` task 10.2，但 task-channel change 的其他延期任务不阻塞本 change。`add-otlp-trace-export` 与本 change 修改同一个 `otel-trace-export` capability，原定“先归档 `add-otlp-trace-export`、再归档本 change”的固定顺序已经满足；本 change 的 delta 继续负责替换其三层层级、exporter 耦合、input/output 映射和直接 span ID helper。

`refine-agent-app-composition-pipeline` 保留的 product runner、failure scope 和 sync compatibility surface 继续有效；本 change 只细化 trace startup contribution 的唯一 owner：唯一 operational writer 仍可由 local package preflight 创建并交接，但 trace provider/projector 必须由异步 observability preload 创建。该细化不改变其他 preload 顺序、resource handoff 或 public factory signature。

`add-ts-workflow-event-history`、`refine-ts-workflow-visible-delta-limit`、`refine-ts-workflow-exception-failure-contract` 等 active change 会修改 `WorkflowExecutionEvent`、`Event Emission` 或 `Timeout and Retry`。本 change 不再修改这些同名 requirement，而以“WorkflowExecutionEvent 本地执行关联”“本地节点尝试关联生命周期”“本地节点权威开始顺序”三个新增 requirement 叠加约束；既有 input/output、visible delta、timeout/retry 和 exception 语义保持不变，因此不建立额外归档顺序。实施前若 active change 集合变化，必须再次检查 requirement 名称和目标语义是否重叠。

## 质量属性与验证

| 质量属性 | 设计结论 |
|---|---|
| 安全 | eventId 长度为 1 至 32 且只允许 ASCII 字母、数字、连字符、下划线、空格、点和冒号；系统请求头覆盖不可信输入；trace/attributes allowlist；Resource 来自可信配置；无原始输入输出 |
| 性能/容量 | registry entry 生命周期受 request terminal 和 120 秒清理约束；关闭后转为最小 tombstone；前驱上限 128；不增加 trace 专用数据库表 |
| 可靠性/恢复 | enrichment 和 exporter 失败不阻塞；terminal commit 保持事务语义；明确不恢复崩溃前 span |
| 可维护性 | 一个 lifecycle、两个 store decorator、一个 execution correlation port；物理 gateway 和业务 executor 不含 OTel |
| 可测试性 | fake tracer、fake lifecycle、确定 ref 和 fake headers provider 可分别验证 |
| 审计/可追溯性 | timeline 保存生成时关联；标准 parent 表示 request、节点及节点内执行归属；preview 表示工作流控制顺序；出站载体只来自权威执行 span |

验证层级：

- contract/schema test：eventId、运行持久化字段、ExecutionCorrelationRef、workflow execution 字段。
- characterization test：timeline 普通追加、LIVE_ONLY、terminal composite、retry/edit/fork、异步执行和工作流并行。
- unit test：lifecycle 状态表、节点内与节点外 parent 选择、重复 START/TERMINAL、前驱解析、header 覆盖、TraceProjector owner 集合与辅助 SpanKind。
- integration test：Task/Web 入站、无 exporter trace、CLIP/REST/RAG/模型传播、无本地出站传输 span、terminal commit。
- end-to-end test：双节点 recipe 的请求、两个节点和请求终止 timeline；父级、前驱、eventId 和下游请求头一致，并验证 workflow 内部模型与 capability port 调用均不产生额外 lifecycle。
- architecture negative test：业务包导入 OTel、物理 gateway 或出站 adapter 创建 span、启用 outgoing HTTP instrumentation、TraceProjector 修改 timeline 权威执行 span、业务 DTO 增加 trace 字段时失败。
- 文档门禁：`openspec validate --all --strict`。

## 实施边界

change 文档评审已经完成，当前进入实施阶段。实施只修改本 change 定义的生产代码、测试和任务状态；长期基线仍在归档前同步，外部 AgentMemory API 文档不属于本 change。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-7.4-追踪请求链路` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/otel-observability-adapter/spec.md`、`openspec/specs/otel-trace-export/spec.md`、`openspec/specs/task-event-trace-correlation/spec.md`、`openspec/specs/trace-log-linking/spec.md`、`openspec/specs/workflow-contracts/spec.md`、`openspec/specs/workflow-execution-engine/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
