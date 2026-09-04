> **状态：PAUSED（治理门禁）**
>
> `persist-ts-refresh-stable-completed-turns` 完成并以普通流程归档前，本 change 禁止实施或归档。其后必须先基于新的 stable `workflow-event-history` 重写本设计及关联 artifacts，删除与稳定 Workflow process body owner、inner projector、Message/context boundary 和 history recovery 冲突的语义，并重新通过 `$nextagent-skill-review`，才可恢复实施。

## 设计目标

补全 workflow event 到 runtime timeline 的完整投影，使所有节点类型的执行轨迹都进入 durable history，支持事后审计、诊断和节点级轨迹回放。投影内容只保留 safe delta vocabulary，不含 prompt/raw model output/secret/path。event 携带 safe resolved inputs（变量引用已解析、secret 明文已 redact），使调用链回溯可知道"每个节点实际用了什么参数、产出了什么结果"。

## 黑盒效果

workflow 执行时，每个节点的 STARTED/COMPLETED/FAILED/SKIPPED/WAITING 事件都产生一条 RunTimelineEvent 写入 runtime timeline store。event 记录 nodeId、nodeDesc、input（safe resolved）、output。是否向页面发送可见数据由 output_parser 的 show_title/show_content 控制，但无论是否可见，event 都会写入 durable history。

## 触发机制

- 由 workflow engine 节点状态变更触发，通过 observer.emitEvent(workflowEvent) 发出
- default-agent observer 回调调用 workflowEventProjector.project(event) 转换
- 转换后的 RunTimelineEvent 通过 runState.emitEvent() 写入 timeline store
- 同步调用，在节点状态变更时即时触发
- 位于 request run 生命周期内，与节点执行同步

## 输入与前置条件

- WorkflowExecutionEvent（本 change 扩展）：executionId/nodeId/nodeType/eventType/input（新增，safe resolved）/output/safeError/retryCount/startedAt/completedAt/visibleDelta
- RecipeDefinition（projector 构造时传入）：用于读取 node.description / node.presentation.outputParser
- 前置依赖：persistence-recovery 已落地（checkpoint 机制已复用 runtime timeline store）

## 输出与副作用

- 产物：RunTimelineEventRecord（已有契约），持久化到 SQLite timeline store
- 每个节点状态变更产出 1-2 条 timeline event（capability 类 NODE_COMPLETED 产出 CAPABILITY_RESULT_DELTA + CAPABILITY_COMPLETED 两条）
- inlinePayload 携带 workflow 专属字段，可通过 RunTimelineEventRecordQuery 按 owner scope + agentId 查询
- 不产出新的 stream event type，不改变 channel-web stream 投影行为

## 核心判断逻辑

1. **start_event** -> NODE_STARTED 投影为 CAPABILITY_STARTED，与 end_event 对称标记 workflow 执行起点。start_event 无 input/output，inlinePayload 只携带 workflowEventType/nodeId/nodeType/startedAt。无 NODE_COMPLETED 事件（start_event 执行完直接流转下一节点，engine 不对其发 NODE_COMPLETED）。
2. **end_event** -> NODE_COMPLETED 投影为 CAPABILITY_COMPLETED（与其他节点一致），inlinePayload 携带 workflowEventType: "NODE_COMPLETED" + nodeId/nodeType/nodeDesc。请求终态由 runtime terminal commit 的 REQUEST_COMPLETED 体现，不在此投影。
3. **capability 类节点**（TOOL/SKILL/SUBFLOW）-> 保持现有 capability 投影，inlinePayload 补充 workflow 专属字段
4. **llm/display 类节点** -> 保持现有 text 投影，inlinePayload 补充 workflow 专属字段
5. **interaction 类节点**（USER_CHECK）-> NODE_WAITING 投影为 USER_INPUT_REQUIRED，恢复后投影为 USER_INPUT_RECEIVED
6. **其他节点类型**（gateway/knowledge/restful/python/agent/guardrail/check）-> 通用投影：
   - NODE_STARTED -> CAPABILITY_STARTED
   - NODE_COMPLETED -> CAPABILITY_COMPLETED（status=SUCCEEDED）
   - NODE_FAILED -> CAPABILITY_COMPLETED（status=FAILED）
   - NODE_SKIPPED -> CAPABILITY_COMPLETED（status=DEGRADED）
   - NODE_WAITING -> USER_INPUT_REQUIRED
7. **所有投影的 inlinePayload 统一补充**：
   - workflowEventType：原始值（NODE_STARTED/NODE_COMPLETED/NODE_FAILED/NODE_SKIPPED/NODE_WAITING/NODE_OUTPUT_DELTA）
   - nodeId：workflow 节点 ID
   - nodeType：workflow 节点类型
   - nodeDesc：node.description（show_title=false 时省略）
   - input：safe resolved inputs（变量引用已解析、secret 明文已 redact；始终记录，不受 show_content 影响）
   - output：节点 outputVariables（show_content=false 时替换为隐藏标记）
   - retryCount：重试次数
   - diagnostic：诊断信息（reasonCode，若有）
8. **output_parser 显示控制**：
   - 解析 node.presentation.outputParser 或 node.outputParser（snake_case 兼容）
   - show_title === false -> inlinePayload 不含 nodeDesc
   - show_content === false -> inlinePayload.output 替换为隐藏标记
   - 未定义 outputParser -> 默认 type=TEXT，output 正常记录
9. **safe 投影**：input/output 中不含 prompt/raw model output/secret/path

## 状态/产物契约

- 产物：RunTimelineEventRecord，持久化到 SQLite timeline store
- 生命周期：与 request run 绑定，随 run 生命周期持久化
- 消费方：事后审计查询、诊断面板、恢复路径（MAY 消费，不 MUST）
- 可追溯性：每个 event 与 executionId/nodeId/runId/sessionId/agentId 绑定
- 与原始事实的关系：inlinePayload.workflowEventType 保留 workflow 原始 event 类型，inlinePayload.nodeId/nodeType 保留节点身份，inlinePayload.input/output 保留节点实际输入输出
- 安全限制：inlinePayload 不含 prompt/raw model output/raw capability payload/secret/credential/local path/attachment content/高基数字段

## 流程接入

- 上游：workflow-execution-engine（owner WorkflowExecutionEvent 的发出和 observer）
- 下游：runtime RunTimelineEventStoreGateway（owner durable 持久化 + 查询）
- 本 change 只 owner event 的投影规则和字段保留，不改变 engine 和 store 的契约
- channel-web stream 投影不受影响：copySafeFields 只取已知字段，新增的 workflow 专属字段被忽略

## 失败与降级

- 投影失败（如 outputParser 解析异常）-> catch + warn log，不阻塞 workflow 执行，event 仍写入（用 fallback 值）
- timeline store 写入失败 -> 由 runtime emitEvent 已有错误处理覆盖
- outputParser 字段缺失 -> 默认全部记录（type=TEXT）
- 不得静默截断、静默丢弃或静默吞错

## 设计决策

### D1 复用 runtime timeline store（Path B）

workflow event 是 request run 内的观测事实，durable history 复用 runtime RunTimelineEventStoreGateway，不引入 WorkflowEventStoreGateway 并行实体。遵循 persistence-recovery 的同形同策略先例（执行态复用 runtime checkpoint）。

### D2 不新增 TimelineEventType 枚举值

TimelineEventType 的核心消费方是 stream projection（驱动页面行为）。workflow 节点的页面行为已通过 CAPABILITY_STARTED/CAPABILITY_COMPLETED/LLM_CONTENT_DELTA/USER_INPUT_REQUIRED 等已有 type 覆盖。审计查询通过 inlinePayload.workflowEventType 筛选 workflow 专属事件，不需要 type 级别区分。

### D3 inlinePayload 补充 workflow 专属字段

在所有投影的 inlinePayload 中补充 workflowEventType/nodeId/nodeType/nodeDesc/input/output/retryCount/diagnostic。channel-web stream 投影的 copySafeFields 只取已知字段，新增字段被忽略，不影响页面行为。审计查询可通过这些字段重建节点级执行轨迹。

### D4 output_parser 显示控制不影响 event 写入

show_title/show_content 控制的是页面可见性，不是 history 记录。无论是否可见，event 都写入 durable history。show_title=false 时 inlinePayload 省略 nodeDesc（但 nodeId/nodeType 仍记录），show_content=false 时 inlinePayload.output 替换为隐藏标记（但 input 仍记录，因为 input 是执行上下文不是展示内容）。

### D5 start_event 投影为 CAPABILITY_STARTED

start_event 是 workflow 执行的时序起点，与 end_event（执行终点）对称。timeline 是 canonical 执行事实，应记录"workflow 何时启动"这个锚点，使审计回溯链有头有尾。start_event 无 input/output，投影成本极低（仅 1 条 NODE_STARTED -> CAPABILITY_STARTED），无 NODE_COMPLETED 事件。resume 场景下，start_event 记录可确认"workflow 是否已进入执行"，避免靠推断定位。

### D6 end_event 不投影为 REQUEST_COMPLETED

end_event 的 NODE_COMPLETED 标识 workflow 图执行完毕，但请求终态（REQUEST_COMPLETED）由 runtime terminal commit 负责。两者不是同一时刻：workflow 完成后 runtime 还要做 terminal commit。投影为 REQUEST_COMPLETED 会导致 timeline store 中出现两条 REQUEST_COMPLETED（一条来自 workflow projector，一条来自 runtime terminal commit），可能造成 channel-web stream 投影重复关闭。end_event 与其他节点一致投影为 CAPABILITY_COMPLETED，inlinePayload 的 nodeType=END + workflowEventType=NODE_COMPLETED 足以在审计查询中区分"workflow 执行完毕"这个语义点。

### D7 input 携带 safe resolved 值

调用链回溯需要"节点实际用了什么参数"。原始配置 node.inputs 含变量引用占位符（如 device_id_list），回溯时不知道变量实际解析成了什么值。本 change 在 WorkflowExecutionEvent 新增 input 字段，engine 在 handler 调用前统一 resolveNodeValue + resolveSecrets + redactSecretsFromValue，把 safe resolved inputs 放入 NODE_STARTED event。input 始终记录，不受 show_content 影响，因为 input 是执行上下文不是展示内容。

### D8 engine 层 resolve 仅用于 event，不统一 handler resolve

engine 层在 emitNodeStarted 前统一 resolve + redact，把 safe input 放入 event。各 handler 仍各自 resolve（当前行为不变），engine 层 resolve 的结果不传入 handler。这样改动范围最小（只改 engine + 契约，不改 handler 接口）。统一 resolve 消除重复属独立重构 change。

## 验收样例

### 正常路径

- gateway 节点 NODE_STARTED -> timeline store 有一条 CAPABILITY_STARTED 记录，inlinePayload 含 workflowEventType: "NODE_STARTED" + nodeId + nodeType + nodeDesc + input（safe resolved）
- restful 节点 NODE_COMPLETED -> timeline store 有一条 CAPABILITY_COMPLETED 记录，inlinePayload 含 output
- end_event NODE_COMPLETED -> timeline store 有一条 CAPABILITY_COMPLETED 记录，inlinePayload 含 nodeType: "END"
- user-check 节点 NODE_WAITING -> timeline store 有一条 USER_INPUT_REQUIRED 记录

### 边界路径

- show_content=false -> event 写入 history，inlinePayload.output 为隐藏标记，inlinePayload.input 仍记录
- show_title=false -> event 写入 history，inlinePayload 不含 nodeDesc，但含 nodeId/nodeType
- 未定义 outputParser -> 默认 TEXT 类型，output 正常记录
- start_event -> timeline store 有一条 CAPABILITY_STARTED 记录，inlinePayload 含 nodeType: "START" + workflowEventType: "NODE_STARTED"，无 input/output

### 失败/降级路径

- 节点 NODE_FAILED -> timeline store 有一条 CAPABILITY_COMPLETED（status=FAILED）记录，inlinePayload 含 safeError/retryCount/diagnostic
- 投影异常 -> warn log + fallback 值，event 仍写入
