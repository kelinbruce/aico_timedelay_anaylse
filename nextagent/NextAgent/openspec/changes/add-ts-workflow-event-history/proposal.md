> **状态：PAUSED（治理门禁）**
>
> `persist-ts-refresh-stable-completed-turns` 完成并以普通流程归档前，本 change 禁止实施或归档。其后必须先基于新的 stable `workflow-event-history` 重写 proposal、design、specs 与 tasks，删除 lifecycle input/output/nodeDesc、内部 `CAPABILITY_RESULT_DELTA` 和 output-parser 控制 Event body 等冲突语义，并重新通过 `$nextagent-skill-review`，才可恢复实施。

## Why

当前 workflow 执行过程中，只有 capability 类（TOOL/SKILL/SUBFLOW）和 llm/display 类节点的 event 被投影到 runtime timeline store。gateway/knowledge/interaction/restful/python/agent/guardrail 等节点的 event 被 WorkflowRuntimeEventProjector 静默丢弃（project() 返回 []），导致事后审计、诊断和节点级轨迹回放无法看到完整执行链路。

同时，已投影的 event 丢失了 workflow 原始语义信息：nodeId/nodeType/executionId 融入 toolCallId/stepId 前缀，workflowEventType 被转为 canonical TimelineEventType 后原始值不可查，retryCount/diagnostic 也被丢弃。且当前 event 不携带 input 字段，无法记录节点的实际输入值，调用链回溯无法知道"这个节点用了什么参数"。

本 change 补全所有节点类型的 event 投影（start_event 投影为 CAPABILITY_STARTED 与 end_event 对称），在 WorkflowExecutionEvent 中新增 input 字段记录 safe resolved inputs（secret 已 redact），并在 inlinePayload 中保留 workflow 原始语义字段，使 durable history 记录完整可追溯的节点级执行轨迹。

## What Changes

- **扩展** WorkflowExecutionEvent（MODIFIED workflow-contracts）：新增可选 input 字段，携带 safe resolved inputs（变量引用已解析、secret 明文已 redact）
- **修改** WorkflowRuntimeEventProjector（MODIFIED workflow-execution-engine）：
  - 补全非 capability/llm 节点的通用投影分支（gateway/knowledge/interaction/restful/python/agent/guardrail/check）
  - 所有投影的 inlinePayload 统一补充 workflow 专属字段：workflowEventType/nodeId/nodeType/nodeDesc/input/output/retryCount/diagnostic
  - start_event NODE_STARTED 投影为 CAPABILITY_STARTED（与 end_event 对称标记执行起点，无 input/output）
  - end_event 与其他节点一致投影为 CAPABILITY_COMPLETED，不投影为 REQUEST_COMPLETED（请求终态由 runtime terminal commit 负责）
- **修改** engine executeNode（MODIFIED workflow-execution-engine）：在 handler 调用前统一 resolveNodeValue + resolveSecrets + redactSecretsFromValue，把 safe resolved inputs 放入 NODE_STARTED event 的 input 字段
- **明确** output_parser 显示控制与 event 投影的关系：
  - show_title === false -> inlinePayload 不含 nodeDesc，但 event 仍写入
  - show_content === false -> inlinePayload.output 替换为隐藏标记，但 event 仍写入
  - 未定义 outputParser -> 默认 type=TEXT，output 正常记录
- **复用** runtime RunTimelineEventStoreGateway（Path B），不新建 WorkflowEventStoreGateway，不扩展 RunTimelineEventRecord 专用字段，不新增 TimelineEventType 枚举值

## Non-Goals

- 不改变 WorkflowExecutionObserver 契约定义（由 engine-contracts owner）
- 不新建 WorkflowEventStoreGateway 或 WorkflowEventRecord 并行持久化实体
- 不扩展 RunTimelineEventRecord 专用字段，不新增 TimelineEventType 枚举值
- 不统一 handler 的 resolve 逻辑（各 handler 仍各自 resolve，engine 层 resolve 仅用于 event 携带 input；统一 resolve 消除重复属独立重构 change）
- 不实现 workflow event 实时 stream projection（由 execution-engine observer + channel 投影 owner）
- 不实现 event 回放驱动 re-execution（本 change 只提供 history query，不驱动执行）
- 不实现 distributed 跨实例 event 归并（由 add-ts-workflow-distributed-execution 承接）

## Capabilities

### 修改的 Capability

- workflow-contracts：WorkflowExecutionEvent 新增可选 input 字段
- workflow-execution-engine：WorkflowRuntimeEventProjector 补全节点覆盖 + 保留 workflow 原始语义字段；engine executeNode 统一 resolve 用于 event input；Event Emission requirement 明确全节点投影和 output_parser 显示控制语义
