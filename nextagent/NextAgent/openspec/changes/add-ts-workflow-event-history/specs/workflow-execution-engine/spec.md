## MODIFIED Requirements

### Requirement: Event Emission

engine MUST 发出安全的 `WorkflowExecutionEvent`。workflow engine MUST 通过 observer 发出 WorkflowExecutionEvent，WorkflowRuntimeEventProjector MUST 将所有节点类型的 event 投影为 RunTimelineEvent 写入 runtime timeline store。投影内容 MUST 保留 workflow 原始语义字段，支持事后审计、诊断和节点级轨迹回放。

#### Scenario: Safe Event Emission

- **WHEN** 节点生命周期变更
- **THEN** engine MUST 发出对应 event
- **AND** event MUST NOT 包含 prompt、raw model output、raw capability result、secret 或 path

#### Scenario: Runtime-Safe Visible Delta Bridging

- **WHEN** 节点 handler 发出安全的可见文本或 thinking 增量
- **THEN** engine MUST 通过 `WorkflowExecutionObserver` 发出对应 `WorkflowExecutionEvent`

**全节点投影规则**：
- start_event -> NODE_STARTED MUST 投影为 CAPABILITY_STARTED（与 end_event 对称标记 workflow 执行起点），无 NODE_COMPLETED 事件（start_event 执行完直接流转下一节点），inlinePayload 只携带 workflowEventType/nodeId/nodeType（无 input/output）
- end_event -> NODE_COMPLETED MUST 投影为 CAPABILITY_COMPLETED（与其他节点一致），MUST NOT 投影为 REQUEST_COMPLETED
- capability 类节点（TOOL/SKILL/SUBFLOW）-> 投影为 CAPABILITY_STARTED/CAPABILITY_COMPLETED/CAPABILITY_RESULT_DELTA
- llm/display 类节点 -> 投影为 LLM_CONTENT_DELTA/LLM_THINKING_DELTA/CAPABILITY_RESULT_DELTA
- interaction 类节点（USER_CHECK）-> NODE_WAITING 投影为 USER_INPUT_REQUIRED，恢复后投影为 USER_INPUT_RECEIVED
- 其他节点类型（gateway/knowledge/restful/python/agent/guardrail/check）-> NODE_STARTED 投影为 CAPABILITY_STARTED，NODE_COMPLETED 投影为 CAPABILITY_COMPLETED，NODE_FAILED 投影为 CAPABILITY_COMPLETED（status=FAILED），NODE_SKIPPED 投影为 CAPABILITY_COMPLETED（status=DEGRADED）

**inlinePayload 保留字段**：
所有投影的 inlinePayload MUST 携带以下 workflow 专属字段：
- workflowEventType：原始 workflow event 类型（NODE_STARTED/NODE_COMPLETED/NODE_FAILED/NODE_SKIPPED/NODE_WAITING/NODE_OUTPUT_DELTA）
- nodeId：workflow 节点 ID
- nodeType：workflow 节点类型
- nodeDesc：node.description（当 show_title=false 时 MUST 省略）
- input：safe resolved inputs（来自 event.input，始终记录，不受 show_content 影响）
- output：节点 outputVariables（当 show_content=false 时 MUST 替换为隐藏标记）
- retryCount：重试次数
- diagnostic：诊断信息（若有）

**output_parser 显示控制**：
- show_title === false -> inlinePayload MUST NOT 含 nodeDesc，但 event MUST 仍写入
- show_content === false -> inlinePayload.output MUST 替换为隐藏标记，但 event MUST 仍写入
- 未定义 outputParser -> 默认 type=TEXT，output 正常记录

**安全限制**：
- inlinePayload MUST NOT 包含 prompt、raw model output、raw capability payload、secret、credential、local path 或 attachment content
- secret reference MUST 在投影前完成解析，secret 不得进入 inlinePayload
- input 中的 secret 明文 MUST 通过 redactSecretsFromValue 替换为 [REDACTED]

**失败与降级**：
- 投影失败（如 outputParser 解析异常）MUST catch + warn log，不阻塞 workflow 执行，event MUST 仍写入（用 fallback 值）
- timeline store 写入失败由 runtime emitEvent 已有错误处理覆盖
- MUST NOT 静默截断、静默丢弃或静默吞错

**复用约束**：
- MUST 复用 runtime RunTimelineEventStoreGateway，MUST NOT 新建 WorkflowEventStoreGateway 或 WorkflowEventRecord
- MUST NOT 扩展 RunTimelineEventRecord 专用字段
- MUST NOT 新增 TimelineEventType 枚举值
- MUST NOT 改变 WorkflowExecutionObserver 契约定义

#### Scenario: Gateway Node Event Projection

- **GIVEN** workflow 包含一个 exclusive-gateway 节点
- **WHEN** 该节点执行并完成
- **THEN** timeline store MUST 有一条 CAPABILITY_STARTED 记录，inlinePayload 含 workflowEventType: "NODE_STARTED" + nodeId + nodeType + nodeDesc + input
- **AND** timeline store MUST 有一条 CAPABILITY_COMPLETED 记录，inlinePayload 含 workflowEventType: "NODE_COMPLETED" + output

#### Scenario: End Event Projection

- **GIVEN** workflow 包含一个 end-event 节点
- **WHEN** 该节点执行完成
- **THEN** timeline store MUST 有一条 CAPABILITY_COMPLETED 记录
- **AND** inlinePayload 含 workflowEventType: "NODE_COMPLETED" + nodeType: "END"
- **AND** timeline store MUST NOT 有来自该节点的 REQUEST_COMPLETED 记录

#### Scenario: Start Event Projection

- **GIVEN** workflow 包含一个 start-event 节点
- **WHEN** 该节点执行发出 NODE_STARTED event
- **THEN** timeline store MUST 有一条 CAPABILITY_STARTED 记录
- **AND** inlinePayload MUST 含 workflowEventType: "NODE_STARTED" + nodeType: "START" + nodeId
- **AND** inlinePayload MUST NOT 含 input 或 output（start_event 无业务 input/output）
- **AND** timeline store MUST NOT 有该节点的 NODE_COMPLETED 记录

#### Scenario: User Check Pending Input Projection

- **GIVEN** workflow 包含一个 user-check 节点
- **WHEN** 该节点进入 NODE_WAITING 状态
- **THEN** timeline store MUST 有一条 USER_INPUT_REQUIRED 记录
- **AND** inlinePayload 含 workflowEventType: "NODE_WAITING" + nodeId + nodeDesc

#### Scenario: Show Content False Hides Output

- **GIVEN** 节点配置 outputParser show_content: false
- **WHEN** 节点执行完成
- **THEN** timeline store MUST 有 event 记录
- **AND** inlinePayload.output MUST 为隐藏标记
- **AND** inlinePayload.input MUST 仍记录

#### Scenario: Show Title False Hides NodeDesc

- **GIVEN** 节点配置 outputParser show_title: false
- **WHEN** 节点执行完成
- **THEN** timeline store MUST 有 event 记录
- **AND** inlinePayload MUST NOT 含 nodeDesc
- **AND** inlinePayload MUST 含 nodeId + nodeType

#### Scenario: Node Failed Projection

- **GIVEN** 节点执行失败
- **WHEN** engine 发出 NODE_FAILED event
- **THEN** timeline store MUST 有一条 CAPABILITY_COMPLETED（status=FAILED）记录
- **AND** inlinePayload 含 workflowEventType: "NODE_FAILED" + safeError + retryCount + diagnostic

#### Scenario: Projection Failure Does Not Block Execution

- **GIVEN** outputParser 字段解析异常
- **WHEN** projector 处理该节点 event
- **THEN** projector MUST catch 异常并 warn log
- **AND** event MUST 仍写入 timeline store（用 fallback 值）
- **AND** workflow 执行 MUST NOT 被阻塞

#### Scenario: No Output Parser Defaults To Text

- **GIVEN** 节点未定义 outputParser
- **WHEN** 节点执行完成
- **THEN** timeline store MUST 有 event 记录
- **AND** inlinePayload.output MUST 正常记录（不替换为隐藏标记）
- **AND** inlinePayload.nodeDesc MUST 正常记录

#### Scenario: Input Carries Safe Resolved Value

- **GIVEN** restful 节点配置 inputs 含引用上游变量的参数
- **WHEN** 节点执行发出 NODE_STARTED event
- **THEN** inlinePayload.input MUST 含变量解析后的实际值
- **AND** inlinePayload.input MUST NOT 含 secret 明文
- **AND** inlinePayload.input MUST NOT 受 show_content 影响