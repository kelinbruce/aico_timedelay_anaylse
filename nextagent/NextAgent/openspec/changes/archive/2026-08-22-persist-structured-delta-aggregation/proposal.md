## Why

`TOOL_STRUCTURED_DELTA` 的实时展示与历史还原目前不能稳定保持同一结果：非流式增量可能只存在于实时流，流式增量又可能以碎片形式进入历史。聚合持久化已经进入生产代码，但最新故障审计还发现三项必须在归档前闭合的问题：

1. 不同会话的 run 可以并发执行，而 `toolCallId` 只在 run 内关联 Tool 调用；如果两个并发 run 使用相同 `toolCallId`，当前共享聚合状态会串组，造成一方内容被另一方写入或提前清除。
2. 聚合结果可能超过共享 timeline gateway 的单记录容量。main 已在写入前将记录限制为 49,000 UTF-8 bytes，但 active change 仍声称可以绕过限制原样写入，规格与代码不一致。
3. 当前超限处理可能改变结构化 `content` 的 JSON 类型，且历史投影未公开已有的 `truncated=true`，使用者无法区分完整历史与有界预览。
4. stable Message-first 契约仍要求 ordinary structured history 只从 `CAPABILITY_RESULT` Message 恢复，而当前聚合实现会另写 structured presentation Event；conversation 与 event history 合并时又没有唯一来源选择，直接归档会形成规格冲突和重复呈现风险。

本 change 需要把既有聚合能力收敛为一个可归档的事实：同一 Tool 调用的结构化增量按 `(runId, toolCallId)` 隔离聚合，通过本地或远端同一 gateway contract 有界持久化；发生内容截断时保持可解析结构并明确告知读取方。

## 术语

- **Capability 语义结果**：由 `CAPABILITY_RESULT` Message 持有、供 Context/Model 消费的 ordinary Capability durable body。
- **structured presentation（结构化呈现）**：由受治理 producer 经 canonical shape validation、安全过滤和 structured-delta 识别后形成，只供 Channel/UI live/history 使用的 `TOOL_STRUCTURED_DELTA` 投影。长期 durable owner 仍遵循 Message-first。
- **过渡 presentation snapshot**：在 canonical Message 尚不能分别承载语义结果与结构化呈现期间，为保证刷新恢复而暂存在有界 `TOOL_STRUCTURED_DELTA` Event 中的 UI-only 快照；它不是模型语义结果 owner，并具有明确退出条件。
- **Message-derived compatibility presentation**：仅在 legacy history 缺少可信 persisted structured presentation Event 时，由既有 `CAPABILITY_RESULT` Message 临时恢复的非 durable 兼容投影。

## 目标

- 对所有经过可信识别的非 Workflow structured presentation `TOOL_STRUCTURED_DELTA` 聚合并持久化，使非流式和流式呈现都可从历史读取。
- 对超长 Workflow `NODE_COMPLETED` structured product 仍形成可恢复的有界历史预览，而不是退化为仅实时事件。
- 两个不同 run 即使使用相同 `toolCallId`，其聚合、显式 flush、run 终止兜底 flush 和状态清理也必须互不影响。
- 聚合期间的待处理组、事件数量和内容字节必须有固定上限；达到上限时通过既有 timeline 写入路径分批提交，不允许无界驻留。
- 每条交给 timeline gateway 的 `inlinePayload` 经 `JSON.stringify` 后必须不超过 49,000 UTF-8 bytes；正常 flush 与 run 终止兜底 flush 使用同一规则。
- 超限预览必须保留 `content` 的结构类别；PIU 保留对象和 `data` 数组，STREAM_DSL 保留 `{type:"dsl", content:string}`，其他对象、数组和字符串保持各自 JSON 类型。
- 发生内容截断时持久化 `truncated=true`，并在 SSE、WebSocket 和 history 使用的统一结构化增量投影中保留该事实。
- 容量处理不得产生 `DEGRADATION_NOTICE`、新的 request-level terminal fact 或 annotation，也不得自行改变 request terminal status；真实 timeline append 失败继续按既有失败语义传播。
- 普通 Capability 的模型语义结果继续只由 `CAPABILITY_RESULT` Message 持有；当前有界 `TOOL_STRUCTURED_DELTA` Event 只承载过渡 presentation snapshot。两种投影不得互相作为模型事实或在 history 中重复呈现；未来 canonical Message 能承载独立 presentation snapshot 后 MUST 删除 Event body 过渡例外，而无需改变 Channel/UI 的 structured presentation 行为。

## 非目标

- 不修改 Tool 的实时增量发射、结构化识别、安全过滤和前端累积渲染算法。
- 不修改 Workflow `NODE_OUTPUT_DELTA` fragment 的实时发射、累积算法或 `LIVE_ONLY` 分类，也不把 Workflow product 纳入非 Workflow accumulator。
- 不修改 `RunTimelineEventStoreGateway`、`RunTimelineEventRecord`、数据库表或远端 provider 协议。
- 不引入第二套 store、provider-specific 容量配置、`contentRef` 外置或新的 limitation/degradation 类型。
- 不把 timeline append 变为 best-effort，也不捕获并忽略真实存储故障。
- 不处理模型错误码映射、retryable 治理或前端 CTA/action gating。
- 不处理 Issue #823 的 terminal composite/terminal Assistant Message 所有权；terminal answer 继续遵循 Message-first。
- 不提前定义方案二的 `semanticResult`、`presentationResult`、delivery receipt、ANSWER/DETAIL 披露策略、adapter registry 或模型可见性字段。

## 变更范围

- 继续由 runtime-owned 聚合层接管非 Workflow product 的结构化增量持久化，并保持 live subscriber 只接收原始实时增量。
- Workflow `NODE_COMPLETED` product 保持既有持久化分类；容量内结果保持原样，超限结果在 settled live 与刷新后的 history 中使用同一有界 completed product。
- 将聚合状态的身份键收敛为 `(runId, toolCallId)`，所有 flush 和清理操作显式携带 run 坐标。
- 在聚合层增加固定的 run/group 容量预算和到界分批提交；在 gateway 调用前执行统一的 UTF-8 字节归一化。
- 在既有结构化增量 stream/history payload 中投影 `truncated`，不增加新事件或新公共对象；该事实约束 presentation 的完整性，不指定长期 durable carrier。
- history 合并时，对 process-history eligible 的非 `ANSWER` structured presentation，存在同一 `(runId, toolCallId)` 的可信持久化 Event 就使用该 Event；仅在没有该 Event 的 legacy 数据中从 `CAPABILITY_RESULT` Message 恢复兼容呈现。ordinary `ANSWER` 继续遵循既有 Message-derived answer projection，不从 persisted Event 恢复；任一路径都不得同时显示两份正文。

## Function 影响（OpenSpec Capabilities）

### 修改的 Function

- `FN-1.1 查看会话消息流`，canonical spec `ts-web-sse-ws-transports`
  - 变化边界：普通生命周期 Event 继续只引用唯一 Message 正文；当前可信 structured presentation Event 是封闭、有界且有退出条件的过渡 UI 快照，不进入模型上下文或请求终态，也不改变 Message-first 长期 owner。
  - 系统质量属性：无新增；保持既有可靠性/恢复边界。

- `FN-1.2 断线后从上次位置继续`，canonical spec `ts-stream-history-consistency`
  - 变化边界：history 对同一 Tool 调用的非 `ANSWER` process presentation 优先使用 durable Event，并只在该 Event 缺失的 legacy 数据中使用 Message-derived 兼容投影；ordinary `ANSWER` 保持 Message-derived；两种来源不得重复呈现。
  - 系统质量属性：无新增；保持既有可靠性/恢复边界。

- `FN-5.16 识别和投射结构化工具增量`，canonical spec `tool-structured-delta`
  - 变化边界：非 Workflow 结构化增量按 `(runId, toolCallId)` 隔离聚合；聚合状态有界；Workflow `NODE_COMPLETED` product 与其他结构化历史记录共享有界归一化；容量预览保持结构并向 stream/history 投影 `truncated`；显式与兜底 flush 互不串 run。
  - 系统质量属性：性能/容量、可靠性/恢复、安全。

- `FN-8.1 持久化运行数据`，canonical spec `gateway-store-provider-ownership`
  - 变化边界：所有聚合记录及 Workflow `NODE_COMPLETED` structured product 在调用统一 timeline gateway contract 前满足 49,000 UTF-8 byte 单记录硬上限；本地和远端 adapter 接收同形记录；真实 append 失败继续显式传播。
  - 系统质量属性：性能/容量、可靠性/恢复。

## 影响

- Agent 开发者无需修改 Tool 或配置；历史可能收到多条有界聚合批次，读取方继续按现有结构化增量顺序处理。
- Web stream/history payload 在确有内容丢失时新增保留已有持久化事实 `truncated=true`；无截断时字段缺省。
- `CAPABILITY_RESULT` Message 仍是模型语义结果的唯一 durable body；`TOOL_STRUCTURED_DELTA` Event 当前只承载经过可信识别的过渡 presentation snapshot，不得被 Context、Agent Loop、terminal 或 limitation 消费。方案二以后把最终 presentation snapshot 收编到同一 Message 时，Event 必须恢复为无 ordinary body。
- 超长 Workflow completed product 的 settled live 内容会与 durable history 一样采用有界预览；此前已发送的 `NODE_OUTPUT_DELTA` fragment 不被截断或重复发布。
- 该字段是既有开放 JSON payload 上向后兼容的可选公共事实；读取方可以忽略未知字段，既有事件类型和请求结果不变。
- 原 change 已在 `AgentRunStatePort` 新增 `flushStructuredDeltaPersistence(...)` 公共方法。为避免把过渡存储机制冻结为 Core/Runtime contract，本轮计划在 Message 写入成功后由 Runtime 私有触发 flush，并删除该方法；该 `agent-contracts` 删除必须在生产修改前完成群内确认。
- 除删除未归档 change 引入的 `AgentRunStatePort.flushStructuredDeltaPersistence(...)` 外，不修改其他 `agent-contracts` 字段、方法或 owner；不新增 replacement port。
- local 与 remote composition 继续通过同一 `RunTimelineEventStoreGateway` binding；仓内不声明 repo 外 remote adapter 的实现细节，只验证 gateway 调用前的公共记录不变量。
- 不新增系统配置、数据库迁移或部署参数。
