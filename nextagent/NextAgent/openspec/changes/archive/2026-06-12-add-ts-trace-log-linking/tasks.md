## 1. 规格

- [x] 1.1 定义 `trace-log-linking` 作为 observability 主设计承载点：统一 `DiagnosticContext`、diagnostic snapshot、`ObservabilityObservationEvent`、runtime `RunTimelineEvent` listener、采集优先级和 projector fanout。
  验证：`openspec validate add-ts-trace-log-linking --strict`。

- [x] 1.2 明确 `DiagnosticContext` 不携带 `traceId`、`spanId` 或 `traceContext`；后续 trace change 如需 SpanContext，必须定义 observability implementation-owned carrier。
  验证：spec / design 均包含禁止 trace/span/context 进入 `DiagnosticContext`、timeline payload、message metadata 和 public DTO 的约束。

- [x] 1.3 明确 `ownerScope` 字段固定为 `tenantId`、`subjectId`、`agentId`、`agentVersion`；`source` 不属于 `ownerScope`。
  验证：spec / design 均包含 `ownerScope` 字段清单和可信来源约束。

- [x] 1.4 明确 `ObservabilityObservationEvent.durationMs` 是可选字段；只有 end event 或 wrapper 能准确测量时才填写。
  验证：spec / design 均说明 `durationMs` optional，并要求 model/capability end event 直接携带耗时。

- [x] 1.5 明确本 change 不新增 `TimelineEventType`，不定义 `TraceDiagnosticRecord`，不写 local trace JSONL，不定义 remote trace adapter。
  验证：spec / design 非范围和 trace 范围标记均包含这些排除项。

## 2. 设计

- [x] 2.1 明确对比当前代码与 `main` 后的 runtime 基线：当前实现大多数 core event 会持久化，但设计不能假设只监听 persisted event 足够；`timelineObservers` 不作为主设计依赖。
  验证：design 说明 `timelineObservers` 由 3045225 引入且属于清理范围，`onTimelineAppend` 只服务 runtime 内部 channel stream fanout，并要求 runtime `RunTimelineEvent` listener 同时覆盖 `persistence=PERSISTED` 与 runtime-owned policy 产生的 `persistence=LIVE_ONLY`。

- [x] 2.2 明确 runtime listener 约束：runtime 不 import observability，listener failure 不影响 append、terminal commit、stream projection、scheduler 或 recovery，listener 不修改 timeline payload 或 channel projection。
  验证：spec / design 均包含 runtime listener 与 channel projection 分离场景。

- [x] 2.3 明确 observation acquisition 优先级：runtime listener 提供的 `RunTimelineEvent` 优先，composition-time wrapper 兜底，entrypoint middleware 和 health evaluator 只处理各自安全事实。
  验证：design 的采集矩阵和 spec acquisition requirement 保持一致。

- [x] 2.4 明确所有 surface 都消费同一个 observation stream；LOG / AUDIT / METRIC / HEALTH / future TRACE 的 coverage 由 projector `covers()` / coverage policy 决定，不写入 event。
  验证：design 的 cross-surface projector 规则和 `ObservabilityProjectorHost` 流程一致。

- [x] 2.5 明确执行模式：业务路径同步 bounded mapping / validation / handoff，projector 和 sink 异步消费，失败只产生 bounded degradation，不阻塞业务。
  验证：spec scenarios 覆盖业务路径只做 handoff 和异步 projector failure 不影响 business outcome。

- [x] 2.6 明确从当前代码基线出发的唯一产品路径：runtime listener -> timeline mapper / wrapper mapper -> `ObservabilityProjectorHost.acceptObservation(event): void` -> host 内部 bounded queue / mailbox -> fixed projector set；替代 `timelineObservers` 外部 observer 注入、trace-linked timeline store 包装、直接 `project()` / `await traceLogProjector.project()` 和 per-surface 入口。
  验证：design `唯一产品路径` 章节、spec `产品路径只有一个 handoff 入口` scenario 和实现任务 3.3、3.4、3.8 保持一致。

## 3. 实现方案

- [x] 3.1 整改 `packages/agent-observability/src/linking/context.ts`：从 `ObservabilityContext` 删除 `traceId`、`spanId`、`traceContext`；`createRequestDiagnosticContext(identity)` 只初始化可信 owner identity 字段；`bindDiagnosticContext()` 只补稳定业务 refs 和 classified diagnostic candidates。
  验证：unit / type test 覆盖 trace/span/context 字段不存在，candidate 追加且不覆盖已有可信字段；`agent-contracts` 无相关导出。

- [x] 3.2 整改 timeline contracts：`RunTimelineEvent` 增加 runtime 补齐字段 `agentId`、`agentVersion`、`persistence?: "PERSISTED" | "LIVE_ONLY"`；`RunTimelineEventRecord` 增加 `agentVersion` 且只作为 persisted gateway DTO / PO mapping input，不承载 live-only event，不携带 `persistence`。
  验证：contract / type / gateway-local tests 覆盖 record 到 row 映射包含 `agentVersion`，live-only event 不创建 `RunTimelineEventRecord`。

- [x] 3.3 清理 runtime observer 产品路径：删除 `RequestLifecycleDependencies.timelineObservers` 与 `create-app.ts` 中对应注入；新增明确语义的 runtime-owned `RunTimelineEventListener` / `onRunTimelineEvent(event)` 机制，并由 `agent-app` composition 注册 observability listener；channel stream 订阅保持独立但通过同一 runtime event 机制获取补齐后的领域事件。
  验证：unit / source test 覆盖 listener failure 不影响 lifecycle；source test 断言 runtime 不 import `agent-observability`，channel projection 不依赖 observability listener；`persistence=LIVE_ONLY` event 进入 listener 但不创建 `RunTimelineEventRecord` / channel queue / audit durable truth。

- [x] 3.4 删除 trace-linked timeline payload enrichment：`agent-app` composition 移除 `createTraceLinkedTimelineStore()` 产品路径使用；删除 `timeline-wrapper.ts` 与 public export，不保留 trace-linked timeline compatibility shim；不得向 `RunTimelineEvent.inlinePayload` 写 `traceId` / `spanId`，不得包装 message store，不得返回 mutated event / record。
  验证：source / unit test 断言 `timeline-wrapper.ts` 与 public export 不存在，无 `inlinePayload.traceId`、`inlinePayload.spanId` 写入路径，message metadata 无 trace/span 注入，`create-app.ts` 不再包装 gateway timeline store。

- [x] 3.5 补强 invocation observation：新增 `ModelInvocationService` observability wrapper，为 model invocation outcome observation 写有限非负 `durationMs` 和可选 normalized `usage`；`CAPABILITY_COMPLETED` timeline event 写有限非负 `durationMs`。
  验证：unit / contract test 覆盖 model wrapper 成功、失败、timeout、canceled、缺失 context 非阻塞，以及 capability success、failed、denied、degraded；缺失 usage 不补 0、不估算；channel projection shape 不变。

- [x] 3.6 整改 `ObservabilityObservationEvent`：`durationMs?: number` 保持可选；增加 `usage?: ModelUsage`；`ownerScope` 固定为 `tenantId`、`subjectId`、`agentId`、`agentVersion` 且不含 `source`；`stableRefs` 只保存 owner-safe refs。
  验证：unit / type test 覆盖字段 shape、非法 usage、非法 duration、缺失 owner/time、raw payload 和 unknown usage key 拒绝。

- [x] 3.7 整改 timeline observation mapper：从补齐后的 `RunTimelineEvent` 读取 `persistence`、`agentId`、`agentVersion` 和 capability `durationMs`；model invocation 不再由 timeline mapper 作为主输入，改由 `ModelInvocationService` wrapper 生成 observation；不读取 stream delta 或 capability result raw payload。
  验证：unit test 覆盖 request、terminal、capability、degradation mapping 和 model timeline vocabulary 不进入 observation；source test 断言本 change 未新增 `TimelineEventType`。

- [x] 3.8 整改 `ObservabilityProjectorHost` 和 app handoff：新增唯一面向业务路径的同步接收接口 `acceptObservation(event): void`；host 内部拥有 bounded in-process queue / mailbox 并异步消费；invalid shape、缺失 owner/time、oversized event、dedup skip、handoff 背压或 enqueue failure 由 host 内部记录 bounded degradation evidence 或按 policy 丢弃；业务路径不得 await projector 或 surface sink，也不得消费 handoff status；host 对固定 projector set 记录 `emitted`、`skipped_not_covered`、`skipped_policy_denied`、`degraded`、`failed_closed`。
  验证：unit / source test 覆盖 mapper / wrapper 只调用 `acceptObservation()`，无 public handoff status 返回，projector reject、sink timeout、redaction failure、serialization failure、handoff 背压不影响业务 callback，也不阻止其它 projector；runtime / core / channel / gateway 不依赖 host 内部 queue / mailbox 或 handoff status。

- [x] 3.9 删除本 change 范围内的 `TraceDiagnosticRecord`、local trace JSONL 和 remote trace adapter 实现任务；如代码已有临时实现，改为后续 trace change 所属或 compatibility shim，并确保不作为当前主设计产物。
  验证：source / architecture test 断言 `agent-platform-gateway-local` 不新增 trace table / trace gateway，`agent-platform-gateway-remote` 不新增 trace storage/query/exporter，当前 change 不要求 local trace file sink。

- [x] 3.10 收紧 contracts 可观测暴露面：删除 `agent-contracts` observability subpath；`AuditEvent` / `AuditEventWriter` / `ErrorNormalizer` 移到 `agent-observability`，metrics、logging、redaction 和 projector host 类型继续不进入 `agent-contracts`。
  验证：source / contract test 断言 `packages/agent-contracts/src/observability/index.ts` 不存在，`package.json` 不导出 `./observability`，业务 package 不从 `agent-contracts` 导入 audit/log/metric/redaction/projector 类型。

## 4. 验证

- [x] 4.1 运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。
  验证：全部通过。

- [x] 4.2 运行 `openspec validate add-ts-trace-log-linking --strict` 和 `openspec validate --all --strict`。
  验证：`openspec validate add-ts-trace-log-linking --strict` 通过；`openspec validate --all --strict` 通过，43 items passed, 0 failed。

- [x] 4.3 push 前执行 `$nextagent-code-review`，重点检查 runtime `RunTimelineEvent` listener 边界、业务模块不感知 observability、runtime 不保留旧 `timelineObservers` 形态、`RunTimelineEventRecord` 只用于持久化、trace/span 不进入 contracts/timeline/message、ownerScope 字段和 source 分离。
  验证：2026-06-12 按 staged diff 执行模型语义 review；无阻断发现。已对照 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict` 通过结果。
  验证：review 无阻断问题。
