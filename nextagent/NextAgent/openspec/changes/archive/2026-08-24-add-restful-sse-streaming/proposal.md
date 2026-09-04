## 背景与问题（Why）

RESTFUL 节点当前支持三种执行模式：同步调用、长轮询（`is_long_api`）和批处理（`batchInputDataItem`）。这三种模式都是"请求-等待-响应"范式，无法处理 SSE（Server-Sent Events）流式 API。

电信网络运维场景中，监控事件推送、告警实时流、配置变更通知等能力天然以 SSE 流式方式工作。这些 API 的特征是：
- 连接建立后持续推送事件，直到服务端关闭或客户端断开
- 每个事件是独立的结构化数据
- 最终会返回一个完成标记（completion），携带原因和事件计数

当前 RESTFUL 节点无法调用这类 API。若要集成，只能在 workflow 外部自行处理 SSE 连接和事件解析，绕过 capability 治理和 runtime 事件上报机制，导致：
- 流式事件无法通过 runtime 事件系统实时展示
- 完整结果无法持久化用于历史回放
- 下游节点无法读取聚合后的结果

## 变更范围（What Changes）

- **修改** RESTFUL 节点 handler，新增 `stream_type: "sse"` 执行模式：
  - 当 `stream_type === "sse"` 时，通过 capability 层的 CLIP `subscribe` 原语发起 SSE 流式调用
  - 流式中间事件通过 `NODE_OUTPUT_DELTA` 事件实时上报，投影为 `TOOL_STRUCTURED_DELTA`（LIVE_ONLY）
  - 调用完成后，CLIP 层自动聚合为 `{ events, completion }` 完整结果
  - 聚合结果作为 `api_response` 输出变量传递给下游节点
  - 聚合结果通过 `CAPABILITY_RESULT_DELTA`（LIVE_ONLY）实时投递，并经 `TOOL_STRUCTURED_DELTA`（PERSISTED）持久化

- **修改** RESTFUL 节点的 DSL 配置，新增 `stream_type` 输入字段：
  - `stream_type: "sse"` 启用 SSE 流式模式
  - 与 `batchInputDataItem`（批处理）和 `is_long_api`（长轮询）互斥
  - 未设置或为空时，保持现有行为不变

- **修改** workflow runtime event projector，将 RESTFUL 节点纳入 capability-like 节点投影：
  - RESTFUL 节点的 `NODE_STARTED` → `CAPABILITY_STARTED`（携带 `capabilityId: api_name`）
  - RESTFUL 节点的 `NODE_COMPLETED` → `CAPABILITY_RESULT_DELTA`（LIVE_ONLY，实时投递聚合结果）+ `CAPABILITY_COMPLETED`（PERSISTED，body-free 状态元数据）
  - RESTFUL 节点的 `NODE_OUTPUT_DELTA` → `TOOL_STRUCTURED_DELTA`（LIVE_ONLY/PERSISTED）
  - 此变更同时改善非 SSE 模式下 RESTFUL 节点的事件投影一致性

## Capability 影响（Capabilities）

### 新增 Capability

- 无

### 修改的 Capability

- `workflow-restful-node`：新增 SSE 流式执行路径，复用现有 CLIP `subscribe` 原语
- `workflow-runtime-event-projector`：RESTFUL 节点加入 capability-like 投影

## 非目标（Non-Goals）

- 不修改 CLIP 层代码（capability 层的 subscribe 机制已完整）
- 不引入新的节点类型（SSE 流式是 RESTFUL 节点的执行模式，不是独立节点）
- 不支持 SSE 连接的重连/恢复逻辑（由 CLIP 层和 runtime timeout 处理）
- 不支持自定义 SSE 事件类型过滤（由 CLIP capability 注册时定义）
- 不修改 DSL schema 定义（`stream_type` 作为普通 input 字段，无需 schema 升级）
- 不支持 WebSocket 传输（MAY 扩展，但不在本次范围内）

## 影响范围（Impact）

- `agent-workflow/src/nodes/capability-nodes.ts`：新增 `executeRestfulSSE()` 函数和路由逻辑
- `agent-core/src/agent/workflow-runtime-event-projector.ts`：`isCapabilityLikeWorkflowNode` 和 `workflowCapabilityIdentity` 函数修改
- `agent-workflow/tests/workflow-capability-nodes.test.ts`：新增 SSE 流式测试用例
- `agent-core/tests/workflow-runtime-event-projector.test.ts`：更新 RESTFUL 投影断言

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/designs/modules/agent-workflow.md`：补充 RESTFUL 节点 SSE 执行模式描述
- `openspec/designs/modules/agent-core.md`：补充 projector 的 capability-like 节点扩展说明

## 验证入口（Validation）

- SSE 节点成功调用 CLIP subscribe capability，逐帧接收流式事件
- 流式事件通过 runtime 事件系统实时上报（TOOL_STRUCTURED_DELTA LIVE_ONLY）
- 调用完成后，聚合结果作为 `api_response` 传递给下游节点
- 聚合结果通过 `CAPABILITY_COMPLETED` 持久化
- `stream_type` 与 `batchInputDataItem` / `is_long_api` 互斥，冲突时报错
- 非 SSE 模式下的 RESTFUL 节点行为保持不变
