# 变更文档语义审查记录

## 审查信息

- Change：`refine-ts-runtime-trace-timeline-correlation`
- 日期：2026-07-30
- 合并基线：`origin/main@84d309953`
- 审查范围：proposal、design、delta specs、tasks、相关长期规格、active change、架构文档和当前代码调用路径
- 实施范围：OpenSpec change、生产代码、测试代码和架构门禁；长期基线仍留待归档前同步
- 结论：`PASS`

当前文档和实现共同落实唯一实现路径、明确 owner、完整失败语义和可重复验证任务，不保留相互竞争的实现路线。已确认的契约 refinement 与代码、测试和架构门禁一致。

## 发现与修正结论

| 发现 | 风险 | 修正结论 |
|---|---|---|
| 仅装饰 `RunTimelineEventStoreGateway.appendEvent` 会漏掉终止复合提交 | request span 无法使用终止 event 的权威提交结果结束 | 增加 `createTraceAwareRequestRunStore`，只装饰 `commitTerminal`，并与 timeline decorator 共享 lifecycle/registry |
| `ALREADY_COMMITTED` 不返回本次持久化 event | 把新 prepared snapshot 当成已持久化事实会伪造关联 | `COMMITTED` 才使用返回 event 推进；`ALREADY_COMMITTED` 只按稳定 ref 幂等清理本进程 entry |
| lifecycle 回调可能在写入前或写入成功后抛错 | 观测故障可能阻断权威 timeline，或把已经成功的持久化结果改成异常 | 所有 lifecycle 方法改为 failure-isolated `*Safely`；prepare 部分失败清理新 span，提交后失败保持 inner store 原结果 |
| 继续由 `TraceProjector` 创建或修改 request/model/capability span 会产生双 owner | 同一 lifecycle 重复 span、父级冲突、状态竞争 | timeline 权威执行 span 的创建、attributes、status、结束全部归 timeline lifecycle；内部 `spanOwner` 精确标记已拥有 observation，`TraceProjector` 只对标记项避让 |
| 按整个 request/model/capability boundary 屏蔽 TraceProjector | `REQUEST_REJECTED` 等没有 timeline owner 的既有诊断会消失 | 只屏蔽 `spanOwner="TIMELINE_LIFECYCLE"`；请求拒绝类 observation 保持既有投影，acceptance 前拒绝继续使用独立诊断 span |
| 工作流静态 `nodeId` 不能区分重试、循环和并行实例 | registry 串扰，前驱无法精确关联 | 每次本地节点尝试生成 `nodeExecutionId`，复用 `WorkflowSafeIdSchema`；直接前驱使用 `predecessorNodeExecutionIds` |
| Workflow 内部 model/capability wrapper 会把节点与内部调用重复建模 | 节点内部调用额外产生近似重复的 timeline event/span，且不同 handler 的调用形态不一致 | 不保留 workflow model/capability lifecycle wrapper；node 是 request 子级，节点内部模型和 capability 调用保持 node ref 并直接传播 node span；既有直接 MODEL 与 Tool Loop CAPABILITY 保持 request 子级 |
| 把 START/END 脚手架当作完整节点 lifecycle | 与当前 START 单边开始、END 单边完成语义冲突，并会产生虚假节点 span | START/END 保持既有单边 timeline event，省略执行关联字段，不创建独立 span；trace 启用时复用 request span snapshot，并由 timeline owner 标记阻止 TraceProjector 重复建 span |
| `add-otlp-trace-export` 原先仍是 active change，且定义三层 TraceProjector | 两个 change 的目标态冲突，归档顺序错误可能恢复旧规则 | 前置 change 已于 2026-07-27 归档；本 change 的 `otel-trace-export` delta 继续覆盖层级、配置、SpanKind 和 attribute 规则，固定前置顺序已经满足 |
| 旧 `safeSummary -> input.value`、`outcome -> output.value` 和 `currentOtelSpanId()` 与最新范围冲突 | 形成第二个 attribute owner，并诱导业务代码直接读取 OTel context | 在 `otel-trace-export` delta 中明确移除；本 change 不实现 input/output，执行只使用 `ExecutionCorrelationRef` |
| 对 AgentMemory 行为直接使用规范关键词会越过本仓 owner | NextAgent change 无法独立验收外部服务内部实现 | 只要求已持久化 timeline 通过既有 AgentMemory timeline 查询接口可读取，不定义同步、老化、分表或新查询接口 |
| taskEventId 同时写入 RequestRun/RequestRunRecord 和 timeline | 形成两个持久化来源，并引入不需要查询或索引的 SQLite 列 | 删除 RequestRun、RequestRunRecord、SQLite 和数据库 ActiveContext 存储；`REQUEST_ACCEPTED.inlinePayload.attributes.eventId` 成为唯一权威恢复锚点 |
| retry/edit/resume 在不读取 RequestRun 字段时仍需恢复 taskEventId | 若扫描任意 timeline event，会产生来源优先级和篡改歧义 | 复用既有 timeline query，只读取目标 run 的有界接收前缀；仅允许前置 HOOK_INVOKED，并禁止扫描锚点后 event |
| 把 REQUEST_ACCEPTED 假定为 run 的第一条 RUNTIME event | `BEFORE_REQUEST_ACCEPT` hook 会先持久化 HOOK_INVOKED，启用 hook 时 `limit=1` 必然无法恢复 | 利用当前每阶段最多 8 个 hook 的 assembly 不变量，固定读取前 9 条 event；前置类型异常或 9 条内无锚点时按无值降级 |
| 原查询草案使用 `recordOrigin` | 当前 `RunTimelineEventRecordQuery` 没有该字段，引入后会扩大 gateway contract | 删除 `recordOrigin`；只复用已有 owner/agent/session/run/afterSequence/limit 字段 |
| 文档把 batch create 写成未来能力 | 当前已支持最多 20 项 batch 和逐项部分失败，输入路径也不是顶层 metadata | 使用 `tasks[i].taskMessages[0].metadata.eventId`；定义一个上游 trace 对多个独立 run/eventId，并保持 item 隔离 |
| eventId 需要直接写入 HTTP Header | 不受控字符会让合法输入在出站传播时被 Node HTTP 拒绝 | 最终规则为 1 至 32 个字符，只允许 ASCII 字母、数字、连字符、下划线、空格、点和冒号；不需要额外编码 |
| trace 关闭仍传播 eventId | eventId 会跨越互不关联的 trace，形成独立于 trace 的第二套关联机制 | trace 关闭时只校验输入，不映射、绑定、恢复、持久化或传播 eventId，也不加入幂等语义 |
| Task Channel 自行判断 tracing config | channel 会越过 transport owner 并依赖 observability 实现状态 | `agent-observability` 返回 provider 初始化后的最终 traceEnabled，`agent-app` 在 Task Channel composition 前注入不可变布尔策略；channel 不导入 OTel 或解释 exporter 配置 |
| 提交幂等语义若直接加入 taskEventId | 现有 `idempotency_semantic` 位于 request_runs 表，会形成隐藏的原值持久化 | taskEventId 存在时只保存包含它的规范化提交语义 SHA-256 版本化摘要；摘要只用于冲突判断，禁止用于恢复或传播 |
| 辅助观测 span 集合不明确 | 后续实现可能扩大 TraceProjector owner 或遗漏现有诊断 | design 固定未被 timeline 拥有的 request diagnostic、system allowlist、`LANE_DRAIN_`/`RECOVERY_SCAN_` 前缀和五类 sandbox gateway operation；扩展必须另行修改 OpenSpec |
| “执行边界不得 startSpan”可能被误解为 timeline wrapper 也不得创建 span | 实施者可能改成 projector 延迟建 span，导致持久化 event 无法获得生成时 snapshot | 明确只有业务执行边界不得创建或结束 span；START 进入持久化 wrapper、尚未写库时由 `TimelineSpanLifecyclePort.prepareSafely` 创建，TERMINAL 持久化成功后结束 |
| 当前 request 路径没有现成 Agent decorator | 实施阶段可能在新 Agent wrapper、runtime 回调或业务 Agent 内散弹选择 | 固定由 `createRequestLifecycleCoordinator` 接收 OPTIONAL `ExecutionCorrelationPort`，在唯一 `agent.execute` 调用点激活 REQUEST ref；缺失时保持原调用，不新增第二个 Agent wrapper，不修改 Agent contract |
| request diagnostic 与 system/gateway 缺少 parent 的场景措辞重叠 | request rejection 可能被错误跳过，或 system/gateway 错误创建 root trace | 将“缺少 request context 不创建新 trace”限定为 system/gateway；request diagnostic allowlist 保留独立诊断 span 例外 |
| “已有 REST/工具 HTTP wrapper”没有对应当前代码对象 | 实施范围不可枚举，且 remote gateway 修改未进入验证命令 | 收窄为 OpenRouter、CLIP、SkillHub HTTP v1、RobotRouter 和本地工作流使用的远端 RAG 检索五个明确注入点；验证增加 `agent-platform-gateway-remote/tests` 和 `agent-app/tests` |
| 现有 `TraceProjector` 把 `gateway_call` 辅助 span 标为 SERVER | sandbox/CLIP 内部诊断被误表示为入站服务处理；容易误以为该 span 应传播给下游 | gateway/system 辅助 span 统一使用 INTERNAL，且不进入 active execution scope 或传播；五个出站 adapter 只注入当前权威执行 span，不创建物理 CLIENT/SERVER span，下游拥有自身 SERVER span |
| workflow model lifecycle 会新增 timeline event 并需要生成独立 executionId | 超出本 change 只补齐真实 workflow 节点 lifecycle 的范围，也会改变工作流模型调用的轨迹粒度 | 删除 workflow model lifecycle wrapper；真实模型请求保持原业务标识，调用期间继续使用当前 WORKFLOW_NODE ref，不新增 MODEL event/span |
| Task Channel 外层 TypeBox schema 直接校验 eventId | 一个非法 item 会在进入逐项处理前拒绝整个 batch | 外层 schema 只接受 metadata 的 JSON 形状；共享 `TaskEventId` 规则在逐项解析时校验，同步和异步 batch 分别捕获单项解析错误并继续其他 item |
| RobotRouter 和远端 RAG 只支持在 adapter factory 手工注入关联端口 | 单元测试可以传播，但产品 gateway provider 组装路径拿不到 `agent-app` 创建的共享实例 | 在 `GatewayProviderCreateInput` 增加 OPTIONAL 组装依赖，`agent-app` 创建 provider bindings 时传入共享端口；provider 只转交给物理 adapter，不改变 gateway 业务 port 或 Record |
| 合并最新 B305 后部分测试夹具仍使用旧接口形状 | TypeScript build 和架构门禁失败，无法区分产品回归与测试基线漂移 | 仅同步测试夹具：补齐 Web、Memory、Identity、品牌类型和流式模型返回，更新下载路径源码断言；不修改 B305 产品行为 |
| B305 stream resource limits 与本 change 同时修改 runtime coordinator 和 Web request route | 错误解决交叉修改可能丢失订阅容量保护、入站 W3C 绑定或 taskEventId 恢复 | 保留 subscriber/replay/idle-timeout 限制和最新 runId/conversation limit；同时保留执行引用激活、timeline 锚点恢复和 Web 入站 carrier，合并不改变 span lifecycle owner |
| B305 新增 stream 测试夹具缺少当前 `RequestRunRecord.agentAssemblyRef` | TypeScript build 失败，但不代表 stream 或 trace 产品行为冲突 | 仅为 `makeRunRecord` 补齐与测试 assembly 一致的 `agent-stream-hw:v1`，并显式标注 `RequestRunRecord` 返回类型 |
| CLIP header 合并只在存在可信值时覆盖同名字段 | 当前没有 active execution ref 时，模型提供的伪造 `traceparent`、`tracestate` 或 `x-task-event-id` 可能进入下游 | CLIP 参数边界始终先按大小写剥离三个保留 header，再注入当前 registry 返回的可信值；增加无可信上下文的负向测试 |
| 合并当前 `main` 后两条特征测试仍断言已被其他 change 删除或封装的内部行为 | 全量测试把主干目标态漂移误报为本 change 的产品回归 | 仅同步测试目标态：Skill execution-scope authority 不再断言已删除的 run reauthorizer；recipe lazy-load 负向测试断言公开的安全拒绝结果，不穿透内部校验码；不修改对应产品行为 |
| 当前 `main` 已启用新的 Function-first OpenSpec 模板，而本 change 已在该规则合入前完成设计并进入实施 | 为套用新模板重排既有 active change 会扩大本次合并范围并制造无行为收益的 Requirement 迁移 | 按 `openspec/config.yaml` 对既有 active change 的兼容规则保留原 artifact 结构；本次只更新实现事实、验证证据和已确认契约措辞，不重写 Requirement 归属，归档时再按长期基线刷新计划收敛 |
| 最新 `main` 的 Cron 显式目标变更把目标感知路由作为第二组同路径 handler 插入 Web channel | Fastify 在组装阶段以 `FST_ERR_DUPLICATED_ROUTE` 拒绝启动，导致契约测试集中失败 | 保留原有按 route whitelist 分组且支持 `AbortSignal` 的唯一 Cron 路由组，把 `target` 字段增量合并到 create/update handler，并删除重复注册块；该修正不改变 trace 行为 |

## 已确认的契约范围

| 契约范围 | 本 change 的确定目标 |
|---|---|
| `agent-contracts/runtime` | `PropagationAttributes.taskEventId` 只进入 `SubmitRequestCommand` 和 `RequestContext` |
| `agent-contracts/gateway` | 不增加 Record 字段或新接口；复用 `RunTimelineEventStoreGateway.listEvents` |
| `agent-contracts/observability` | 新增无 trace ID、无 SDK 类型的 `ExecutionCorrelationRef` 与 `ExecutionCorrelationPort`；`agent-runtime` 只在唯一 `agent.execute` 调用点消费该窄端口，不修改 Agent contract |
| `agent-contracts/core` | `WorkflowExecutionEvent` 增加 OPTIONAL `nodeExecutionId` 和 `predecessorNodeExecutionIds`；本地真实执行节点强制生成，START/END 脚手架省略 |

以上目标已经在方案讨论中确认，并已由对应 contract、实现、测试和架构门禁落实。

## 约束一致性

| 约束 | 审查结果 |
|---|---|
| canonical timeline owner | `agent-runtime` 继续拥有 event 语义、sequence、分类和 terminal truth；observability 只修改保留 enrichment 命名空间 |
| OTel owner | SDK、provider、registry、lifecycle、传播和 projector 都归 `agent-observability`；factory 返回最终 traceEnabled，由 `agent-app` 组装并注入 channel |
| gateway boundary | 不增加 gateway 业务 port、Record 或 SQLite schema；仅在 provider create input 增加 OPTIONAL 组装依赖；物理 gateway 不导入 OTel；普通 append 和 terminal composite 都经过组装期 decorator |
| 公共契约 | taskEventId 只进入 SubmitRequestCommand/RequestContext；不进入 RequestRun、gateway Record 或公共 DTO；`ExecutionCorrelationRef` 不包含 SDK 类型 |
| Owner/Agent Scope | enrichment 不修改 owner scope、agent scope 或任何可信标识 |
| 安全 | task event 长度为 1 至 32，字符集限于 ASCII 字母、数字、连字符、下划线、空格、点和冒号；系统请求头覆盖不可信同名值；不注入 input/output、prompt、工具参数或结果 |
| 并发 | 每个 run 使用自身 REQUEST_ACCEPTED 锚点；registry key 包含 requestRunId、kind、executionId；并行 workflow node 使用不同 nodeExecutionId |
| 性能/容量 | registry 生命周期受 request terminal 和 120 秒清理约束；关闭后只保留最小 tombstone；ACTIVE request 的前驱不按 LRU 提前删除 |
| 可靠性 | enrichment/exporter 失败非阻塞；权威 timeline 写失败保持原错误；terminal 未提交不结束 span |
| 最小内核 | 不在 runtime、workflow、model、capability 或 gateway 中加入 OTel；执行边界只激活稳定引用；出站 adapter 不创建 span |

## OpenSpec 完整性

| Artifact | 结果 |
|---|---|
| proposal | 问题、目标、非目标、breaking refinement、Capability 影响和归档前基线更新完整 |
| design | 当前代码基线、唯一调用路径、owner、状态转换、数据来源、失败、回滚、依赖顺序和质量属性完整 |
| specs | 1 个新增 Capability、5 个现有 Capability 增量；与相关 active change 重叠的 workflow 语义使用独立 ADDED requirement，其他 MODIFIED 名称与对应基线或前置 change 一致并完整重述目标态 |
| tasks | 53 个任务，其中前置变更准入已完成，其余按失败测试、实现、集成和门禁拆分；每项包含来源和可重复验证命令 |
| roadmap | 当前 roadmap 无本 change 的重复条目；本 change 不修改 roadmap |

## 需重点审核的确定方案

以下内容不是遗留实现选择，文档已给出确定目标；请在开始代码实施前重点确认：

1. 每个创建 item 的 `taskMessages[0].metadata.eventId` 存在时长度为 1 至 32，只允许 ASCII 字母、数字、连字符、下划线、空格、点和冒号；batch item 独立校验。
2. trace 启用时，`REQUEST_ACCEPTED.inlinePayload.attributes.eventId` 是 taskEventId 的唯一权威恢复锚点；RequestRun、RequestRunRecord、checkpoint、message、数据库 ActiveContext、SQLite 和持久化幂等语义不保存该原值。trace 关闭时不使用 eventId。
3. `ExecutionCorrelationPort` 放在 `agent-contracts/observability`，只暴露入站 carrier scope、执行 ref scope 和 outbound headers，不暴露 lifecycle 或 snapshot；`createRequestLifecycleCoordinator` 通过 OPTIONAL 组装依赖接收该端口，并只在唯一 `agent.execute` 调用点激活 REQUEST ref，缺失时保持原直接调用。
4. workflow 真实执行 node 的 `nextagent.observation_type` 为 `workflow_node`，SpanKind 为 INTERNAL；workflow 节点内部模型和 capability port 调用不生成额外 event/span并直接传播 node span；既有直接 MODEL 与 Tool Loop capability 是 request 的 CLIENT 子 span。START/END 不创建独立 span，只复用 request snapshot。
5. request 终止后全部最小 tombstone 保留 120 秒，沿用当前 TraceProjector 的 120 秒时间窗口；request ACTIVE 期间不得按 LRU 提前删除工作流前驱。
6. `safeSummary` 的 `input.value`、`output.value` 映射和 `currentOtelSpanId()` public helper 在本 change 实施时删除。
7. `TraceProjector` 只对带内部 `spanOwner="TIMELINE_LIFECYCLE"` 的 observation 避让；request diagnostic allowlist 未被 timeline 拥有，有 request context 时挂在 request 下，缺少时创建独立诊断 span；system/gateway 缺少 request context 时跳过。
8. `agent-observability` factory 返回最终 traceEnabled，`agent-app` 在 Task Channel composition 前注入；provider 初始化失败时 eventId 不进入执行。
9. `add-ts-task-channel` task 10.2 由本 change 提供实现和验证证据，但其其他延期任务不阻塞本 change；workflow active change 通过独立新增 requirement 叠加；`add-otlp-trace-export` 的固定前置归档要求已经满足。
10. gateway/system 辅助观测 span 统一使用 INTERNAL，不进入 execution registry 或 active scope；OpenRouter、CLIP、SkillHub、RobotRouter 和远端 RAG 只传播当前权威执行 span，不创建本地物理出站 span，SERVER span 由真正接收入站请求的服务创建。

## 验证记录

- `npm run build`：通过；包含 TypeScript project references、builtin Skill assets 和 agent-dev-workbench Vite build。
- `npm test`：130 个测试文件、1214 个测试通过。
- `npm run test:contract`：40 个测试文件、338 个测试通过。
- `npm run lint:architecture`：1167 个模块、5341 条依赖无 dependency-cruiser 违规，41 个测试文件、251 个架构测试通过。
- NetAgent 外部依赖接口定向门禁：1 个测试文件、9 个测试通过；`GatewayProviderCreateInput.executionCorrelation` 已作为 OPTIONAL 组装依赖纳入 contract shape 检查。
- trace、workflow、Task Channel 和远端传播定向回归：129 个测试通过。
- `openspec validate --all --strict`：268 项通过，0 项失败。
- `git diff --check`：通过；仅显示工作区既有的 LF/CRLF 转换提示。
- 前端 `frontend/agent-web` 未修改；本 change 没有浏览器 UI、宿主模式或 E2E 行为变化，因此未运行该 package 的独立 build/test/e2e。

## 实施后语义检视

- 检视范围：本 change artifacts、直接触达的 contracts、runtime/core/workflow/observability/channel/model/capability/gateway/app 实现，以及对应 unit、contract 和 architecture tests。
- Findings：timeline wrapper 与 terminal composite 共用 lifecycle；执行边界只激活稳定 ref；workflow 内层 executionId 不覆盖业务调用标识；Task Channel batch 保持逐项失败；五个出站 adapter 只传播当前权威 span；无未解决 P0、P1、P2 或 P3 问题。
- Frozen core contract：`PASS`。新增 `PropagationAttributes`、`ExecutionCorrelationPort` 和 workflow OPTIONAL 字段均由 change 明确 refinement，未把 SDK 类型或 trace ID 写入业务 DTO。
- Architecture boundary：`PASS`。OTel SDK 仍只在 `agent-observability`；需要传播的实现包只依赖 `agent-contracts/observability`；物理 gateway 和出站 adapter 不创建 span。
- Minimal kernel non-regression：`PASS`。全量 unit、contract 和 build 通过；业务 model/capability 标识保持不变。
- Security：`PASS`。eventId 使用共享 allowlist；不可信 trace/event headers 被覆盖；input/output、prompt、工具参数和结果不进入 span attributes。
- OpenSpec consistency：`PASS`。proposal、design、delta specs、tasks 和实现指向同一条 timeline lifecycle 路径；长期基线留待 archive sync。
- Validation：`PASS`。后端完整门禁、OpenSpec strict 和 diff check 均已通过。
- 总结：`PASS`，当前实现已满足提交、推送和 PR 审核条件。
