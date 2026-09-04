# Agent Dev Workbench 字段来源映射

本映射是 task 3.1 的实现检查点。它防止在某个字段已经可以从
owner 事实读取或计算时
添加 workbench 专用事实。

## Request / Run Owner

| Workbench 字段 | 来源 | 是否新增 payload？ | 说明 |
|---|---|---:|---|
| `runId`, `sessionId`, `requestId` | `RequestRunRecord` | No | 稳定的 run 坐标。 |
| `agentId`, `agentVersion`, `agentAssemblyRef` | `RequestRunRecord` | No | Agent scope 在 acceptance 时固化。 |
| `attempt`, `status`, `terminalCommitState` | `RequestRunRecord` | No | 图状态由 run 状态加 terminal 事件派生。 |
| `createdAt`, `updatedAt` | `RequestRunRecord` | No | 请求节点时序使用这些值。 |
| `agentAssemblyHash`, `agentAssemblySnapshotRef` | Runtime owner 可选 payload | Deferred | 仅当 `agentAssemblyRef` 无法按历史解析时才允许。 |

## Timeline Owner

| Workbench 字段 | 来源 | 是否新增 payload？ | 说明 |
|---|---|---:|---|
| `eventId`, `sequence`, `type`, `requestContextId`, `createdAt` | `RunTimelineEventRecord` 顶层字段 | No | 节点 id、排序、引用和事件时间戳来自顶层字段。 |
| `startedAt`, `endedAt`, `durationMs` | 事件时间戳和事件对 | No | 存在 start/end 事件时计算；否则标记为 partial。 |
| Sequence 边 | Timeline `sequence` | No | 不持久化流程图边。 |
| Terminal 结果 | Terminal 事件类型和 `RequestRunRecord.status` | No | v1 不需要额外 terminal payload。 |

## Session / Message Owner

| Workbench 字段 | 来源 | 是否新增 payload？ | 说明 |
|---|---|---:|---|
| 会话消息 role/content/content type | `SessionMessageRecord` | No | Workbench 可以展示已持久化的本地开发消息。 |
| Tool 调用参数 | 已持久化的 `ASSISTANT_TOOL_USE` 消息内容，按 `toolCallId` 关联 | No | 只为被选中的 capability 节点展示原始参数。 |
| Tool 调用结果 | 已持久化的 `CAPABILITY_RESULT` 消息内容，按 `toolCallId` 关联 | No | 只为被选中的 capability 节点展示原始结果。 |
| Bash 命令预览 | 已持久化的 `ASSISTANT_TOOL_USE` 消息参数，按 Bash 节点的 `toolCallId` 关联 | No | 只做查询时有界的单行预览；完整命令保留在 action detail 中，不复制进 timeline/日志事实。 |
| Subagent 目标和委托 prompt | 已持久化的 `ASSISTANT_TOOL_USE` 消息参数，按 subagent 节点的 `toolCallId` 关联 | No | 只为被选中的 `AGENT` capability 调用展示。 |
| Subagent 结果 | 已持久化的 `CAPABILITY_RESULT` 消息 payload，按 subagent 节点的 `toolCallId` 关联 | No | 既有已授权本地事实；无重复 payload。 |
| 子 Session/Run 引用 | `sessions.idempotency_key` 加父 scope 列，再查子 `RequestRunRecord.parentRunId/parentRequestId` | No | 使用 canonical capability 调用幂等 key 精确查询；不做时间性回退。 |
| Terminal 可见内容大小 | `SessionMessageRecord` | No | 需要时从已授权持久化消息计算。 |
| 被选中消息引用 | `ContextAssembly.selectedMessageRefs` 生产上下文事实 | 条件性业务事实 | 仅当 context owner 出于生产诊断/审计独立需要实际选择时才持久化；绝不只为 workbench 启用。 |

## Context / Prompt Owner

| Workbench 字段 | 来源 | 是否新增 payload？ | 说明 |
|---|---|---:|---|
| `promptTemplateRef`, `promptTemplateVersion` | Context/prompt owner 生产事实 | 条件性业务事实 | 只保留稳定引用；仅在 owner 独立需要时持久化；不含渲染后的 prompt。 |
| Prompt 模板定义 | 既有 `PromptTemplateRegistry.templatesFor(agentId, agentVersion)`，精确匹配 `promptTemplateRef` | No | 仅当前本地 registry 证据；无法解析精确 ref 时不可用。 |
| Prompt 被选中消息内容 | 既有已持久化消息，按 `selectedMessageRefs` 排序 | No | 仅已授权本地事实；缺失引用保持显式，不触发回退扫描。 |
| Prompt 近似性局限 | Workbench 查询时固定原因码加缺失引用证据 | No | 绝不宣称是 provider 最终请求；不做 renderer/context/model 重放。 |
| 实际模型披露 id | 最终 `ModelInvocationRequest.tools[].capabilityId` | 正式调用事实 | 作为 `MODEL_INVOCATION_STARTED.disclosedCapabilityIds` 持久化一次；查询时与 run 绑定的精确 catalog/assembly 联结；不持久化平行的 `visibleCapabilityIds` 或 `renderedToolNames` 别名。 |
| 实际模型消息数 | 最终 `ModelInvocationRequest.messages.length` | 正式调用事实 | 持久化有界的 `modelMessageCount`；不持久化消息或原始内容。 |
| 预算/压缩/降级证据 | Context owner 安全 payload 或既有 `CONTEXT_COMPACTED` 事实 | 条件性 | 优先使用既有压缩事实；否则新增有界的原因/计数证据。 |
| 完整编译 Agent 配置 | `AgentAssemblyRegistry.require(agentId, agentVersion)` 加精确持久化 `agentAssemblyRef` 相等性 | No | 只包含 assembly 契约字段；不匹配/registry 缺失时不可用，绝不回退到 active/当前配置。 |
| Agent/subagent 清单与父 scope | App 组合的当前 `AgentAssembly[]` resolver 加 SQLite session 计数 | No | 包含零 session 的父 scope 子代理和仅可调用（`userInvocable=false`，`BOUND`）subagent；父 scope 只在已编译时展示；仅持久化的 agent id 是历史条目。 |

## Model Owner

| Workbench 字段 | 来源 | 是否新增 payload？ | 说明 |
|---|---|---:|---|
| `stepId`, `modelProfileId`, `providerKind`, `modelName` | 由 runtime 边界映射的 run 绑定模型调用请求/结果 | Yes，正式业务事实 | 为每个 RequestRun 模型尝试产生，独立于 workbench composition。 |
| `modelOptionSummary`, `providerOptionKeys`, `timeoutMs`, `toolCount` | `MODEL_INVOCATION_STARTED` 安全 payload | Yes | 只有有界的值/key；无 provider 选项值、base URL 或 credential 引用。 |
| `usage`, `finishReason`, `toolCallCount` | `MODEL_INVOCATION_COMPLETED` 安全 payload | Yes | 只有用量/计数/原因。 |
| `safeErrorCode`, `safeErrorCategory` | `MODEL_INVOCATION_FAILED` 安全 payload | Yes | 不包含 provider 原始错误或 safe error 消息。 |
| `durationMs`, 状态 | 事件类型和 start/end 事件时间 | No | 除非某个 owner 已拥有语义时长，否则不写重复时长。 |

## Capability Owner

| Workbench 字段 | 来源 | 是否新增 payload？ | 说明 |
|---|---|---:|---|
| `capabilityId`, `toolCallId`, 状态/safe error | 既有的 capability timeline payload（在存在时） | 不重复 | 不重新添加 capability owner 已发出的字段。 |
| Capability kind/provider/version/tool 名称 | run 绑定的精确 CapabilityCatalog/AgentAssembly 加持久化 tool-use 消息 | No | 缺失历史 catalog 证据时保持 partial/不可用；不在每个事件中重复 descriptor 事实。 |
| `stepId` | Capability owner timeline 事实 | Yes | 把调用关联到其模型轮次，而不复制参数或结果。 |
| Tool 批执行 mode/ordinal/size | Capability owner timeline 事实 | 多调用批次时为 Yes | 实际执行 mode 只有在 preparation 和 request-local 串行化策略之后才可知；生产并发诊断需要它。 |
| Tool 参数/结果/效果摘要 | 已持久化的 `ASSISTANT_TOOL_USE` / `CAPABILITY_RESULT` 消息和既有生命周期事实 | No | 按 `toolCallId` 关联；缺失事实保持 partial/不可用。 |
| Capability gateway 细节 | v1 无正式事实 | No | 无投机性的公开摘要契约；除非较旧的持久化事件已携带兼容的安全证据，否则展示为不可用。 |

## Policy / Scheduler / Hook Owners

| Workbench 字段 | 来源 | 是否新增 payload？ | 说明 |
|---|---|---:|---|
| Policy 结果/原因 | 既有 `POLICY_APPLIED` payload | 不重复 | 既有字段仍是事实来源。 |
| `policyId`, `policyVersion`, `policyDomain`, `policyPoint` | Policy owner 安全 payload | 条件性 | 仅当 policy owner 拥有稳定的 id/version 事实时才新增。 |
| `laneKind`, `queueDepthBucket`, `schedulerDecisionCode` | Scheduler/runtime owner 安全 payload | 条件性 | 如果队列等待可以从 request 和 planning 时间计算，则不新增。 |
| Hook id/stage/状态/效果 | 既有 hook 事实 | v1 为 No | 无 workbench 专用 hook payload。 |

## Log Evidence

| Workbench 字段 | 来源 | 是否新增 payload？ | 说明 |
|---|---|---:|---|
| 安全日志摘录 | 既有 runtime 诊断 / 结构化安全日志 | No | 只做有界只读摘录。 |
| 日志引用 | 查询引用：run/request/session/context/capability id | No | 文件路径和偏移不是业务标识符。 |
| 图节点 | 已持久化事实和安全 payload | 不来自日志 | 日志绝不构造图事实。 |

## Explicit Gaps

- `ModelInvocationRequest` 中原本没有 `modelProfileId`；实现把它作为可选的 model-owner 安全字段添加，并从选定的 `ModelInfo` 传播它。
- Context/prompt/capability/policy 的增强 schema 尚未完成；后续 task 必须实现 owner 侧 schema 或把相应详情标记为 `partial` / `unavailable`。
- 没有 run 级 context/model/capability 投影 payload 的历史 run 必须保持 `partial`、`unavailable` 或 `current-view`；不得把当前 registry 值当作历史事实呈现。
