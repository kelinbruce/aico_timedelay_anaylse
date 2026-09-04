---
sources:
  - openspec/overview.md
  - openspec/designs/architecture/request-run.md
  - openspec/designs/architecture/stream-projection.md
  - openspec/designs/architecture/capability-invocation-and-failure-disposition.md
last-verified: 2026-09-01
---

# 数据流图谱：关键路径的可视化

→ 包职责与依赖方向详见 [architecture-map.md](architecture-map.md)
→ 请求处理中常犯错误详见 [anti-patterns.md](anti-patterns.md)
→ 配置与入口点详见 [config-and-entry-points.md](config-and-entry-points.md)

## 请求提交主路径

```
用户/Task Channel
     │
     │ submit (HTTP POST)
     ▼
agent-channel-web/task
     │ 1. schema validation (TypeBox/Ajv)
     │ 2. inject trusted identity (from auth or header)
     │ 3. resolve agentId (from trusted composition)
     │ 4. build SubmitRequestCommand
     ▼
agent-runtime
     │ 1. admission (validate agentId + owner scope)
     │ 2. create RequestRun (fix agentId, agentVersion, agentAssemblyRef)
     │ 3. same-session lane scheduling
     │ 4. publish REQUEST_ACCEPTED on timeline
     ▼
agent-core
     │ 1. route: ModelDrivenAgent or WorkflowDrivenAgent
     │ 2. if model-driven:
     │    a. request context engine → ContextAssembly
     │    b. call model → ModelFinalResult / stream deltas
     │    c. if tool calls → invoke capabilities → loop
     │    d. if pending input → suspend, wait for human
     │ 3. if workflow-driven:
     │    a. load recipe → execute node graph
     │    b. capability nodes → invoke via agent-capability
     │    c. interaction nodes → bridge pending input
     ▼
agent-context-engine
     │ 1. query policy → select messages
     │ 2. window selection → fit token budget
     │ 3. compaction (if needed)
     │ 4. render prompt template (SYSTEM_PROMPT + context)
     │ 5. return ContextAssembly → ModelInput
     ▼
agent-model
     │ 1. provider SDK call
     │ 2. stream normalization
     │ 3. tool-use normalization
     │ 4. safe error mapping
     │ 5. return ModelFinalResult or stream deltas
     ▼
agent-capability
     │ 1. discovery (find CapabilityDescriptor)
     │ 2. binding (check availability + scope)
     │ 3. authorization (risk policy evaluation)
     │ 4. invocation (execute tool/skill/agent/workflow)
     │ 5. result governance (safe output, 256K UTF-16 cap)
     ▼
agent-runtime (terminal commit)
     │ 1. write canonical timeline events
     │ 2. persist terminal assistant message
     │ 3. update session active context
     │ 4. commit (single authoritative path)
     ▼
agent-channel-web/task
     │ 1. project StreamEnvelope
     │ 2. deliver via SSE/WS/Callback
     ▼
用户/Task Channel
```

## 流式事件流

```
agent-model (stream delta)
     │ LLM_THINKING_DELTA / TOOL_CALL_DELTA / CONTENT_DELTA
     ▼
agent-core (collect + route)
     │ TOOL_STRUCTURED_DELTA → event snapshot (≤49K UTF-8 bytes per run+toolCallId)
     │ CONTENT_DELTA → pass through
     ▼
agent-runtime (timeline + stream projection)
     │ 1. publish TimelineEvent (authoritative)
     │ 2. project StreamEnvelope for channel
     ▼
agent-channel-web (SSE/WS)
     │ StreamEnvelope { type, payload, cursor }
     │ SSE: data: JSON\n\n
     │ WS: JSON message
     ▼
frontend/agent-web
     │ 1. parse StreamEnvelope
     │ 2. update Zustand store
     │ 3. render chat workspace
     │ 4. structured tool delta → specialized renderer
```

**关键边界**：
- `LLM_THINKING_DELTA` 只用于 live，单次模型调用最后一个非空累计 delta 以 `completed=true` 持久化
- `TOOL_STRUCTURED_DELTA` 是过渡 Event snapshot，不进入 Context、terminal 或 completion limitation
- Browser 对同一 run/tool 在 eligible Event snapshot 与 Message compatibility projection 中只选一个

## Capability 调用流

```
agent-core (tool call from model output)
     │ ToolCall { name, arguments }
     ▼
agent-capability
     │ 1. lookup CapabilityDescriptor by name
     │ 2. check binding (agent-scoped + owner-scoped availability)
     │ 3. evaluate risk policy
     │    ├─ ALLOW → proceed
     │    ├─ DENY → safe error to model
     │    ├─ REQUIRE_AUTHORIZATION → create PENDING_INPUT(AUTHORIZATION)
     │    ├─ DEGRADED → degraded execution
     │    └─ POLICY_FAILED → safe error to model
     │ 4. build CapabilityInvocationRequest
     │ 5. route to provider:
     │    ├─ BUNDLED tool → direct execution
     │    ├─ LOCAL_DIRECTORY skill → load + execute
     │    ├─ SKILL_HUB → acquire + execute
     │    ├─ MCP_SERVER → MCP protocol call
     │    ├─ AGENT_REGISTRY → subagent execution (child session/run)
     │    └─ CUSTOM → plugin provider
     │ 6. sandbox routing for Bash/Python/Write
     │    └─ agent-platform-gateway-local sandbox boundary
     ▼
CapabilityInvocationResult
     │ { content, safeError?, generatedMessages }
     ▼
agent-core → next model turn
```

## 会话生命周期

```
创建 Session
     │ POST /api/v1/sessions (implicit on first submit)
     │ 绑定 agentId from trusted composition
     ▼
提交请求
     │ POST /api/v1/sessions/:id/requests
     │ → RequestRun 创建 → 执行
     ▼
获取历史
     │ GET /api/v1/sessions/:id/messages
     │ → 按 owner scope + agent scope + cursor 分页
     ▼
流式订阅
     │ GET /api/v1/sessions/:id/stream (SSE)
     │ 或 WS /api/v1/ws
     ▼
删除会话
     │ DELETE /api/v1/sessions/:id
     │ → 物理删除 session + 从属事实（单事务）
     │ → 不隐式 cancel 非 terminal run
     │ → 无回收站/软删除
```

## 派生会话 (Fork) 流

```
source session (anchor message)
     │ 复制从开头到 anchor 的 canonical durable message prefix
     ▼
child session
     │ 1. 重写 message/session/request refs
     │ 2. 初始化 child active context v0
     │ 3. 记录 fork source metadata
     │ 4. display runs 的 timeline events → child-owned FORK_SNAPSHOT
     │
     │ 不复制: RequestRun、checkpoint、pending input、tool state、parent active context
```

## 长期记忆流

```
post-terminal (request 完成后)
     │ task trajectory 提取 (默认关闭 dreaming, aging)
     ▼
agent-memory
     │ 1. extraction → 提取记忆条目
     │ 2. 写入 gateway-local (long-term-memory.sqlite)
     │ 3. 不阻塞 terminal commit
     ▼
模型调用记忆工具
     │ get_memory_list / get_memory_detail / create_memory / delete_memory
     │ Context Assembly 不自动检索/注入长期记忆
     ▼
agent-memory → agent-capability → agent-core
     │ 模型需要在 prompt 中显式调用记忆工具
     ▼
get_memory_detail 结果
     │ 只包含 category-specific 结构化业务内容
     │ 不包含 retained source 或内部执行来源坐标
     │ source trace 写入 CapabilityInvocationResult.metadata.sourceTrace (模型不可见)
```

## IR Surface 机机交互流

```
外部系统 (NMS/编排)
     │ POST /api/v1/ir/sessions (create)
     │ POST /api/v1/ir/sessions/:id/requests (submit)
     │ x-tenant-id + x-subject-id (required headers)
     ▼
agent-channel-web (IR route)
     │ 1. header-based auth (trusted header mode)
     │ 2. 复用 ER 的 DTO、schema、stream envelope
     │ 3. runtime delegation
     │
     │ 只暴露 6 个端点:
     │   create session, submit request, SSE stream,
     │   cancel, retry, answer pending input
     │
     │ 不暴露: bootstrap, skills, frequent-questions,
     │   conversation, favorites, shares, WebSocket, multipart upload
```
