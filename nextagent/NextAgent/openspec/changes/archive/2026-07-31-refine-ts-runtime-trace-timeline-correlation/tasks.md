## 1. 实施准入与特征基线

- [x] 1.1 前置变更准入：确认当前任务通道和 OTLP trace 导出实现已进入实施基线；`add-ts-task-channel` 的 10.2 trace propagation 由本 change 承接且 batch/input owner 已冻结，`add-otlp-trace-export` 已按固定顺序先归档；确认 workflow 相关 active change 仍只与本 change 的新增 requirement 叠加且不存在其他未解决的同名 requirement 冲突，未满足时停止代码实施。
  来源：design“当前实现基线”“实施边界”。
  验证：运行 `openspec list --json`、`git status --short` 和目标提交范围的 `git diff --name-only`，预期依赖状态和重叠 requirement 可明确审查，并确认仅 `add-otlp-trace-export` 存在固定前置归档约束。

- [x] 1.2 Timeline append 特征测试：为普通 append、`RuntimeOwnedAgentRunStatePort` append、`LIVE_ONLY` 和持久化后 observation handoff 建立修改前通过的特征测试。
  来源：design“当前实现基线/Timeline 与持久化”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-runtime/tests`，预期新增特征测试在生产代码修改前通过。

- [x] 1.3 Terminal commit 特征测试：为 `commitTerminal` 的 `COMMITTED`、`ALREADY_COMMITTED`、未提交结果和异常建立修改前通过的特征测试。
  来源：design“TimelineSpanLifecyclePort 与 store 装饰器”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-runtime/tests packages/agent-platform-gateway-local/tests`，预期新增特征测试在生产代码修改前通过。

- [x] 1.4 延续语义特征测试：锁定 retry、edit/resubmit、pending resume、fork 和提交幂等的当前行为。
  来源：design“运行关联事实/taskEventId”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-runtime/tests packages/agent-session/tests`，预期新增特征测试在生产代码修改前通过。

- [x] 1.5 工作流特征测试：锁定节点 START/TERMINAL、重试、循环、并行汇聚、等待恢复和 runtime projection 的当前行为。
  来源：design“当前实现基线/执行与工作流”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-workflow/tests packages/agent-core/tests`，预期新增特征测试在生产代码修改前通过。

## 2. taskEventId 契约与 timeline 锚点

- [x] 2.1 taskEventId 失败测试：增加允许字符集合、1 个字符、32 个字符、空字符串、33 个字符、非允许字符、缺失值、trace 关闭时不映射、运行时上下文携带和 DTO 隔离测试，并确认目标行为在实现前失败。
  来源：Requirement“任务通道 MUST 接收受控 taskEventId”Scenarios“有效 eventId 被映射”“无效 eventId 没有持久化副作用”；Requirement“taskEventId MUST 遵循运行延续语义”。
  验证：运行 `npx vitest run --config vitest.config.release.ts tests/contract packages/agent-runtime/tests`，预期新增目标断言失败。

- [x] 2.2 taskEventId 公共标量：在 `agent-common` 增加 `TaskEventId`、pattern/长度上限常量和只接受 `[A-Za-z0-9_.: -]` 的纯校验函数，不引入 TypeBox 依赖；Task Channel 的 TypeBox schema 复用共享常量，并完成 public export。
  来源：design“运行关联事实/taskEventId”“已确认的契约范围”。
  验证：运行 `npm run build` 和 `npx vitest run --config vitest.config.release.ts tests/contract`，预期编译和标量边界测试通过。

- [x] 2.3 运行关联契约：在 `agent-contracts/runtime` 增加 `PropagationAttributes.taskEventId`，只加入 `SubmitRequestCommand` 和 `RequestContext`；不得加入 RequestRun、gateway Record、Web、stream、message、checkpoint、ActiveContext 或 capability/model DTO。
  来源：design“运行关联事实/taskEventId”“已确认的契约范围”。
  验证：运行 `npm run build`、`npm run test:contract` 和 `npm run lint:architecture`，预期公共契约和禁止泄漏断言通过。

- [x] 2.4 Timeline 锚点失败测试：覆盖 trace 启用时的 REQUEST_ACCEPTED 唯一锚点、按 runId 和 afterSequence=0 读取至多 9 条持久化接收前缀、零至八条前置 HOOK_INVOKED、查询失败、前置类型不符、前九条内缺失、非法 eventId、锚点后 event 不回退、trace 关闭时不读取锚点，以及 RequestRun/SQLite/ActiveContext 无新增字段，并确认目标行为在实现前失败。
  来源：Requirement“taskEventId MUST 投影为 timeline eventId 属性”Scenario“REQUEST_ACCEPTED 是唯一恢复锚点”；Requirement“taskEventId MUST 遵循运行延续语义”Scenario“锚点不可用时不猜测”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-runtime/tests packages/agent-platform-gateway-local/tests tests/architecture`，预期新增目标断言失败。

- [x] 2.5 延续语义失败测试：增加 retry/edit 从来源锚点继承、pending resume/运行重建从当前锚点恢复、锚点查询失败或缺失时无值继续、fork 不恢复、首次提交幂等冲突和持久化幂等语义不包含 taskEventId 原值测试，并确认目标行为在实现前失败。
  来源：Requirement“taskEventId MUST 遵循运行延续语义”全部 Scenarios。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-runtime/tests packages/agent-session/tests`，预期新增目标断言失败。

- [x] 2.6 锚点恢复与延续语义实现：trace 启用时复用既有 `RunTimelineEventStoreGateway.listEvents` 字段，按 owner/agent/session/run、afterSequence=0、limit=9 读取有界接收前缀，只允许零至八条 HOOK_INVOKED 位于第一个 REQUEST_ACCEPTED 前；在创建 retry/edit 新事实或重建 pending/recovery 上下文前恢复，查询失败、前置类型异常或锚点缺失时按无值继续且不扫描锚点后 event，fork 不调用恢复；trace 关闭时不恢复 taskEventId。首次提交缺少 taskEventId 或 trace 关闭时保持既有幂等语义；trace 启用且存在 taskEventId 时只把包含该值的规范化完整提交语义 SHA-256 摘要写入带版本前缀的幂等语义，禁止保存原值。
  来源：Requirement“taskEventId MUST 遵循运行延续语义”全部 Scenarios。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-runtime/tests packages/agent-session/tests`，预期新增及既有延续测试通过。

## 3. 任务通道与 timeline eventId 属性

- [x] 3.1 任务通道失败测试：为 JSON batch item 和 multipart 单项增加允许字符、有效长度、缺失、非法 `taskMessages[0].metadata.eventId`、其他 metadata 丢弃和 item 无副作用测试；覆盖一个 batch 中两个 eventId 独立、无效 item 不回滚有效 item、trace 关闭时有效输入不进入命令或幂等语义，以及 operation log 不包含 eventId 原值，并确认目标行为在实现前失败。
  来源：Requirement“任务通道 MUST 接收受控 taskEventId”全部 Scenarios。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-task/tests`，预期新增目标断言失败。

- [x] 3.2 任务通道映射：由 `agent-observability` infrastructure factory 返回 provider 初始化后的最终 `traceEnabled`，`agent-app` 把它作为不可变布尔策略注入 Task Channel；Task Channel 在每个 JSON batch item 或 multipart 单项创建 session 前，从已解析的唯一 task message 校验 `metadata.eventId`，仅在策略启用时把该 item 的值映射到 `SubmitRequestCommand.propagationAttributes.taskEventId`；保持最多 20 项、逐项幂等和部分失败语义，不导入 OTel 或自行解释 tracing config。
  来源：Requirement“任务通道 MUST 接收受控 taskEventId”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-task/tests`，预期 JSON、multipart、允许列表和无副作用测试通过。

- [x] 3.3 Timeline eventId 失败测试：覆盖请求、模型、能力、workflow 真实执行节点、terminal composite、业务伪造值、缺失值、trace 关闭时完全省略和顶层 eventId 隔离，并确认目标行为在实现前失败。
  来源：Requirement“taskEventId MUST 投影为 timeline eventId 属性”全部 Scenarios。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-runtime/tests packages/agent-app/tests`，预期新增目标断言失败。

- [x] 3.4 Timeline eventId 投影：trace 启用时先把 `RequestContext` 值写入 REQUEST_ACCEPTED 唯一锚点，再在 runtime 的所有后续 Record 构造路径中统一写入相同 `inlinePayload.attributes.eventId`，并覆盖 producer 的保留值；trace 关闭时不写入该属性。
  来源：Requirement“taskEventId MUST 投影为 timeline eventId 属性”；design“Timeline enrichment”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-runtime/tests packages/agent-app/tests`，预期普通 append、runtime-owned append 和 terminal composite 测试通过。

## 4. 执行关联契约与入站 W3C

- [x] 4.1 执行关联契约失败测试：增加 `ExecutionCorrelationRef` 唯一键、无 SDK/trace ID 字段、入站 scope、执行 ref scope 和 outbound headers 类型测试，并确认实现前失败。
  来源：Requirement“trace propagation 必须保持为 observability implementation concern”Scenario“业务执行只激活稳定引用”；design“ExecutionCorrelationRef”。
  验证：运行 `npx vitest run --config vitest.config.release.ts tests/contract tests/architecture/otel-observability-boundary.test.ts`，预期新增目标断言失败。

- [x] 4.2 执行关联契约：在 `agent-contracts/observability` 增加 `ExecutionCorrelationRef`、`W3CTraceCarrier` 和不含 start/end/snapshot 的 `ExecutionCorrelationPort`。
  来源：design“ExecutionCorrelationRef”“已确认的契约范围”。
  验证：运行 `npm run build`、`npm run test:contract` 和 `npm run lint:architecture`，预期类型消费和 OTel 依赖边界通过。

- [x] 4.3 入站 W3C 失败测试：覆盖 sampled=1、sampled=0、缺失、格式错误、全零、重复、超限和并发请求隔离，并确认实现前失败。
  来源：Requirement“入站 W3C 上下文 MUST 经过统一校验”全部 Scenarios。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-observability/tests packages/agent-channel-task/tests packages/agent-channel-web/tests`，预期新增目标断言失败。

- [x] 4.4 入站 W3C 实现：实现统一 carrier scope 和 W3C 校验；Task/Web 只解析自身传输外形，缺失或无效值由 request START 创建 root span。
  来源：Requirement“入站 W3C 上下文 MUST 经过统一校验”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-observability/tests packages/agent-channel-task/tests packages/agent-channel-web/tests packages/agent-app/tests`，预期有效、未采样、缺失、无效和并发隔离测试通过。

## 5. Timeline span lifecycle 与 store decorators

- [x] 5.1 Lifecycle 状态失败测试：覆盖 START 创建、重复 START、TERMINAL 结束、重复 TERMINAL、缺失 START、prepare 部分失败清理、START 写失败、TERMINAL 未提交、提交后回调失败和 request 清理，并确认实现前失败。
  来源：Requirement“timeline 权威执行 span MUST 由 timeline lifecycle 驱动”全部 Scenarios；design“生命周期状态”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-observability/tests`，预期新增目标断言失败。

- [x] 5.2 TimelineSpanLifecyclePort：实现 timeline 分类、稳定 ref、WORKFLOW_NODE、既有直接 MODEL 与 Tool Loop CAPABILITY 的 request 父级、MODEL/CAPABILITY 互不嵌套、registry、最小 tombstone 和 120 秒清理。
  来源：design“TimelineSpanLifecyclePort 与 store 装饰器”“Timeline 事件到权威执行 span 的映射”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-observability/tests`，预期状态、父级、重复和清理测试通过。

- [x] 5.3 Timeline decorator 失败测试：增加 append 前 enrichment、append 错误清理、producer trace 覆盖、LIVE_ONLY 不接入和物理 gateway 无 OTel 测试，并确认实现前失败。
  来源：Requirement“trace context 不得注入 runtime timeline 或 message payload”Scenarios“首次持久化已经包含 trace”“trace enrichment 失败不改变权威事实”；Requirement“Timeline enrichment MUST 覆盖全部持久化写路径”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-observability/tests packages/agent-runtime/tests tests/architecture`，预期新增目标断言失败。

- [x] 5.4 createTraceAwareTimelineStore：包装 `appendEvent`，在 inner store 前调用 failure-isolated prepare，并按成功或错误安全推进 lifecycle；任一 lifecycle 回调不得改变 inner store 的原结果或原错误，其他 gateway 语义保持透明。
  来源：design“TimelineSpanLifecyclePort 与 store 装饰器/位置与调用者”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-observability/tests packages/agent-runtime/tests`，预期 enrichment、错误和透明代理测试通过。

- [x] 5.5 Terminal decorator 失败测试：覆盖 terminal event 预处理、COMMITTED、ALREADY_COMMITTED、未提交结果、异常和与普通 store 共享 registry，并确认实现前失败。
  来源：Requirement“trace context 不得注入 runtime timeline 或 message payload”Scenario“终止复合提交使用同一 enrichment”；Requirement“Timeline enrichment MUST 覆盖全部持久化写路径”Scenario“普通追加与终止提交共享 registry”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-observability/tests packages/agent-runtime/tests packages/agent-platform-gateway-local/tests`，预期新增目标断言失败。

- [x] 5.6 createTraceAwareRequestRunStore：只包装 `commitTerminal`；`COMMITTED` 使用返回的持久化 event 安全推进 lifecycle，`ALREADY_COMMITTED` 只按稳定 ref 幂等清理本进程 entry，未提交或抛错时保持可重试；任一 lifecycle 回调不得改变 inner store 的原结果或原错误，其他方法完整透传。
  来源：design“TimelineSpanLifecyclePort 与 store 装饰器/位置与调用者”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-observability/tests packages/agent-runtime/tests packages/agent-platform-gateway-local/tests`，预期 terminal、幂等和事务特征测试通过。

- [x] 5.7 App 组装失败测试：验证每个应用实例只有一个 lifecycle/registry、两个 decorated store 被 runtime 消费、物理 gateway 保持原实例，并确认实现前失败。
  来源：Requirement“Timeline enrichment MUST 覆盖全部持久化写路径”；design“唯一实现路径与 owner”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests`，预期新增目标断言失败。

- [x] 5.8 App 组装实现：异步 observability preload 在唯一 operational writer 创建后初始化 tracer provider、唯一 registry、lifecycle 和 correlation port；所有正式可执行入口进入异步 product composition，local runtime package 不提前创建或注入第二套 provider/projector；model/gateway/capability adapter 接收该 port；gateway store 可用后装饰 timeline/request-run store；runtime/core/workflow、TraceProjector 和 Channel 继续复用同一实例，不得在后续 layer 重建。公开同步 factory 只在调用方显式注入已初始化 projector 时启用 trace。
  来源：design“唯一实现路径与 owner”“TimelineSpanLifecyclePort 与 store 装饰器”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests packages/agent-observability/tests`，预期唯一实例和全路径组装测试通过。

## 6. 执行引用激活与出站传播

- [x] 6.1 执行激活失败测试：覆盖 request、既有直接 model、Tool Loop capability 和并行 workflow node 的 ref 激活、作用域栈、MODEL/CAPABILITY 保持 request 父级、workflow 内部模型和 capability port 不合成 ref、嵌套恢复和查找失败降级，并确认实现前失败。
  来源：Requirement“trace propagation 必须保持为 observability implementation concern”Scenario“业务执行只激活稳定引用”；design“执行引用激活与下游传播”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-observability/tests packages/agent-runtime/tests packages/agent-core/tests packages/agent-workflow/tests`，预期新增目标断言失败。

- [x] 6.2 执行引用接入：为 `createRequestLifecycleCoordinator` 增加 OPTIONAL `ExecutionCorrelationPort` 组装依赖，端口存在时在当前唯一的 `agent.execute` 调用点激活 REQUEST ref，缺失时保持原直接调用；产品 composition 始终注入共享端口。`RunBoundModelInvocation`、tool loop 和本地 node boundary 在各自 START 持久化成功后只激活对应 ref；workflow handler 内部模型调用和 capability port 调用保持 node ref，不增加 model/capability wrapper。所有执行边界不得创建或结束 span，也不得新增第二个 Agent wrapper。
  来源：design“执行引用激活与下游传播”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-runtime/tests packages/agent-core/tests packages/agent-workflow/tests packages/agent-app/tests`，预期 request 调用点、嵌套、并行和生命周期特征测试通过。

- [x] 6.3 出站请求头失败测试：覆盖 workflow 内部模型与 capability port 复用节点、既有直接 MODEL/Tool Loop CAPABILITY、request fallback、大小写覆盖、无 ref、五个出站边界不创建物理 CLIENT/SERVER span，以及 trace 关闭时同时省略 W3C 和 `x-task-event-id`，并确认实现前失败。
  来源：Requirement“trace propagation 必须保持为 observability implementation concern”Scenarios“外部调用传播当前最窄权威执行 span”“出站适配器不创建物理传输 span”“exporter 不可用不关闭进程内关联”；Requirement“taskEventId MUST 通过 x-task-event-id 传播”全部 Scenarios。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-observability/tests packages/agent-model/tests packages/agent-capability/tests packages/agent-platform-gateway-remote/tests packages/agent-app/tests`，预期五个明确出站边界的新增目标断言失败。

- [x] 6.4 出站传播实现：由共享 provider 从当前最窄权威执行 span 生成 W3C 和 x-task-event-id，并在 `withNextAgentHeaders`、`createSandboxClipCommandRunner -> buildClipExecutionArgs -> clipParamsEnvelope`、`FetchSkillHubRemoteGatewayAdapter.headers()`、`createRobotRouterGuardrailProvider` 的 POST 请求和 `createHttpWorkflowRagClient.postJson` 五个明确边界接入；各 factory/options 由 `agent-app` 注入同一个 `ExecutionCorrelationPort`，不新增通用 REST/tool HTTP wrapper，不调用 `startSpan`，并保持 HTTP outgoing instrumentation 关闭。
  来源：design“执行引用激活与下游传播”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-observability/tests packages/agent-model/tests packages/agent-capability/tests packages/agent-platform-gateway-remote/tests packages/agent-app/tests`，预期请求头覆盖、CLIP params.header、五个出站边界和无泄漏测试通过。

## 7. 本地工作流真实节点执行

- [x] 7.1 Workflow contract 失败测试：覆盖 OPTIONAL 传输字段、本地必填、有界 nodeExecutionId、128 前驱上限和 remote 缺失兼容，并确认实现前失败。
  来源：Requirement“WorkflowExecutionEvent 本地执行关联”Scenarios“重试具有独立执行标识”“remote event 保持兼容”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-contracts/tests tests/contract`，预期新增目标断言失败。

- [x] 7.2 Workflow contract 实现：扩展 `WorkflowExecutionEvent` 接口与 schema，不修改 remote workflow 必填字段。
  来源：design“本地工作流执行关联”“已确认的契约范围”。
  验证：运行 `npm run build` 和 `npx vitest run --config vitest.config.release.ts packages/agent-contracts/tests tests/contract`，预期 schema 与兼容测试通过。

- [x] 7.3 节点执行标识失败测试：覆盖所有真实执行节点类型、重试、循环、条件、并行、等待恢复和子流程的唯一 executionId 与完整 lifecycle，并断言 START/END 脚手架省略执行关联字段且不伪造配对 event，确认目标行为在实现前失败。
  来源：Requirement“本地节点尝试关联生命周期”全部 Scenarios；Requirement“本地节点权威开始顺序”Scenarios“两节点 recipe 输出完整 lifecycle”“等待节点结束当前执行实例”“START 持久化失败不调用 handler”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-workflow/tests`，预期新增目标断言失败。

- [x] 7.4 本地节点 lifecycle 实现：每次真实执行节点尝试生成 nodeExecutionId，先等待 NODE_STARTED observer，再执行 handler，并保证恰好一个 TERMINAL；START/END 保持既有单边 event 且不生成执行标识。
  来源：Requirement“本地节点权威开始顺序”；design“本地工作流执行关联”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-workflow/tests`，预期全部节点、重试、等待和失败测试通过。

- [x] 7.5 前驱计算失败测试：覆盖顺序、条件、并行完成乱序、汇聚、重试、循环和子流程，并确认实现前失败。
  来源：Requirement“WorkflowExecutionEvent 本地执行关联”Scenarios“顺序节点携带实际前驱”“并行汇聚携带全部前驱”；Requirement“本地节点权威开始顺序”Scenario“并行完成顺序不改变直接前驱”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-workflow/tests`，预期新增目标断言失败。

- [x] 7.6 前驱计算实现：按实际执行状态传递直接前驱，并按 recipe 顺序确定并行汇聚列表，不使用完成时间推断。
  来源：design“本地工作流执行关联”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-workflow/tests`，预期顺序、分支、并行、重试、循环和子流程测试通过。

- [x] 7.7 Runtime projection 失败测试：覆盖所有真实执行节点 START/TERMINAL、nodeExecutionId/前驱透传、业务 nodeId/description、START 仅投影 CAPABILITY_STARTED、END 仅投影 CAPABILITY_COMPLETED、START/END 复用 request snapshot、节点 handler 内模型与 capability port 不生成额外 lifecycle 并传播 node span，以及 RECIPE/START/END 无独立 span，并确认实现前失败。
  来源：Requirement“本地节点权威开始顺序”Scenarios“两个真实执行节点输出完整 lifecycle”“节点 handler 在 START 持久化后执行”；Requirement“timeline 权威执行 trace MUST 保持受控 NextAgent 层级”Scenarios“两节点 recipe 的父级和顺序正确”“节点内模型调用不新增 lifecycle”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-core/tests`，预期新增目标断言失败。

- [x] 7.8 Workflow runtime projection：按既有单边事件投影 START/END 但不携带执行关联字段；统一投影 LLM、DISPLAY、AGENT、TOOL、SKILL、SUBFLOW、网关、交互和知识真实执行节点，并携带实际执行关联字段。
  来源：design“本地工作流执行关联”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-core/tests packages/agent-workflow/tests`，预期完整 lifecycle 和安全 payload 测试通过。

- [x] 7.9 previewSpanIds 失败测试：覆盖入口空列表、顺序、并行汇聚、结束前驱 tombstone、缺失、跨 trace、自引用、去重和 128 上限，并确认实现前失败。
  来源：Requirement“工作流前驱 MUST 投影为 previewSpanIds”全部 Scenarios。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-observability/tests packages/agent-core/tests`，预期新增目标断言失败。

- [x] 7.10 previewSpanIds 实现：在节点 START 时全量解析前驱，整体成功才写入列表，并让 START/TERMINAL 复用相同结果。
  来源：Requirement“工作流前驱 MUST 投影为 previewSpanIds”；design“本地工作流执行关联”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-observability/tests packages/agent-core/tests packages/agent-workflow/tests`，预期全部前驱和降级测试通过。

## 8. TraceProjector、Resource 与配置

- [x] 8.1 TraceProjector owner 集合失败测试：断言只有携带 `spanOwner="TIMELINE_LIFECYCLE"` 的 request/model/capability/workflow observation 被避让，START/END 标记后不产生独立 span；request diagnostic allowlist 全部继续投影，有 request context 时挂到 request、缺少时创建独立诊断 span；system/gateway 使用 request parent 和 INTERNAL SpanKind，缺少 parent 时不建 root，且所有辅助 span 不进入 active execution scope 或出站传播，并确认实现前失败。
  来源：Requirement“TraceProjector 必须只消费安全 observation 并映射到 OTel trace 语义”Scenarios“权威 lifecycle 不产生重复 span”“system 和 gateway span 挂在 request 下”“system 和 gateway 缺少 request context 不创建新 trace”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-observability/tests/trace-projector.test.ts packages/agent-observability/tests/trace-projector-negative.test.ts`，预期新增目标断言失败。

- [x] 8.2 TraceProjector 收敛：在内部 `ObservabilityObservationEvent` 增加 OPTIONAL `spanOwner="TIMELINE_LIFECYCLE"` 并由 timeline observation mapper 精确设置；删除对应 request/model 权威执行 span 私有 registry 和 lifecycle mutation；辅助观测 span 改用共享 request context，system/gateway 统一使用 INTERNAL SpanKind，不激活辅助 span，并保留未标记诊断 observation 的既有行为。
  来源：design“TraceProjector 职责收敛”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-observability/tests packages/agent-app/tests/otel-observability-adapter.test.ts`，预期唯一 owner、辅助 parent 和其他 surface 非回归通过。

- [x] 8.3 Span attributes 失败测试：覆盖 timeline 权威执行 span eventId、nodeId/description、安全 outcome、observation_type/SpanKind、gateway/system 辅助观测 span 为 INTERNAL 且无 eventId、input/output 拒绝和业务 Resource 覆盖拒绝，并确认实现前失败。
  来源：Requirement“taskEventId MUST 作为 eventId span attribute”全部 Scenarios；Requirement“Span Resource MUST 由 tracer provider 统一设置”Scenario“节点 event 不覆盖 pod resource”；Requirement“每个 span 必须设置 observation_type 和 SpanKind”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-observability/tests`，预期新增目标断言失败。

- [x] 8.4 Resource 与 attribute 实现：provider 统一设置 Resource；lifecycle 使用 allowlist 动态 attributes 和 SpanKind，不注入 input/output；删除 `currentOtelSpanId()` public helper；辅助 span 统一使用 INTERNAL 并省略 eventId。
  来源：design“Resource 与 span attributes”；Removed Requirements“span 必须映射 safeSummary 和 outcome 供轨迹中心显示”“currentOtelSpanId() 必须安全获取当前 Span ID”的 Migration。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-observability/tests packages/agent-app/tests`，预期 Resource、allowlist 和高基数隔离测试通过。

- [x] 8.5 Trace 配置失败测试：覆盖 enabled 真/假/缺失、exporter 全有或全无、无 exporter 启用、exporter 初始化失败仍返回有效 traceEnabled、provider 初始化失败返回 false，以及 Task Channel 只按注入的最终值映射 eventId，并确认实现前失败。
  来源：Requirement“执行 trace MUST 与 OTLP exporter 独立启用”全部 Scenarios。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests packages/agent-observability/tests`，预期新增目标断言失败。

- [x] 8.6 Trace 配置实现：规范化 enabled，校验 exporter 三项一致性，在无 exporter 或 exporter 不可用时保留进程内 tracer，由 infrastructure factory 返回最终 traceEnabled，并由 `agent-app` 在 Task Channel composition 前完成注入。
  来源：design“配置、失败与回滚”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests packages/agent-observability/tests`，预期配置、组装和降级测试通过。

## 9. 集成、负向门禁与验收

- [x] 9.1 双节点 recipe 集成测试：从任务通道提交带 eventId 和入站 trace 的本地 recipe，断言请求、两个节点和终止 timeline；节点是 request 子级，workflow 内部模型与 capability port 不产生额外 lifecycle，preview、span eventId、下游 header 正确且不存在本地物理出站 SERVER span。
  来源：Requirement“timeline 权威执行 trace MUST 保持受控 NextAgent 层级”Scenarios“两节点 recipe 的父级和顺序正确”“节点内模型调用不新增 lifecycle”；Requirement“trace propagation 必须保持为 observability implementation concern”Scenario“出站适配器不创建物理传输 span”；Requirement“taskEventId MUST 投影为 timeline eventId 属性”Scenario“运行中的任务 timeline 可按 eventId 查询”。
  验证：运行 `npx vitest run --config vitest.config.release.ts tests/integration packages/agent-app/tests`，预期完整轨迹断言通过。

- [x] 9.2 异步任务集成测试：验证 HTTP accepted 后 request span 保持 ACTIVE，后台节点和终止 event 使用同一 trace，并在 terminal commit 后结束。
  来源：Requirement“入站 W3C 上下文 MUST 经过统一校验”Scenario“异步执行超过 HTTP 响应”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-task/tests packages/agent-runtime/tests packages/agent-app/tests`，预期异步生命周期测试通过。

- [x] 9.3 Batch 与并发隔离集成测试：同一上游 trace 下用一个 task batch 创建不同 eventId 的运行，并覆盖并发执行和并行节点，断言每个 item 的 registry、timeline、span、preview 和请求头互不串扰，单项失败不回滚成功项。
  来源：Requirement“taskEventId MUST 作为 eventId span attribute”Scenario“同一上游 trace 下的运行相互隔离”；Requirement“工作流前驱 MUST 投影为 previewSpanIds”Scenario“结束的并行前驱仍可解析”。
  验证：运行 `npx vitest run --config vitest.config.release.ts tests/integration packages/agent-workflow/tests packages/agent-observability/tests`，预期并发隔离测试通过。

- [x] 9.4 架构负向门禁：实际触发并拒绝业务包导入 OTel、物理 gateway 或出站 adapter 创建 span、启用 HTTP outgoing instrumentation、TraceProjector 修改 timeline 权威执行 span、公共 DTO 增加 trace 字段和 runtime 绕过 decorated stores。
  来源：Requirement“OTel adapters 必须通过既有 observation handoff 路径接入”Scenarios“权威执行 span 通过持久化装饰器接入”“物理 gateway 保持 OTel-free”；Requirement“trace propagation 必须保持为 observability implementation concern”。
  验证：运行 `npm run lint:architecture` 和 `npx vitest run --config vitest.config.architecture.ts tests/architecture`，预期每个非法 fixture 被拒绝且产品依赖图通过。

- [x] 9.5 后端完整门禁：运行全量 build、test、contract 和 architecture gate，修复本 change 引入的全部失败。
  来源：proposal“主要 owner 与影响”；design“质量属性与验证”。
  验证：运行 `npm run build`、`npm test`、`npm run test:contract` 和 `npm run lint:architecture`，预期全部通过。

- [x] 9.6 OpenSpec 门禁：核对 proposal、design、spec 和 tasks 的术语、owner、字段、唯一路径及非目标，并执行严格校验。
  来源：proposal、design 和全部增量 specs。
  验证：运行 `openspec validate --all --strict`，预期全部 change 和 stable specs 通过。
