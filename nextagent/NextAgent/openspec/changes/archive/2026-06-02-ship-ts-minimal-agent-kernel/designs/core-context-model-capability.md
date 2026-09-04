# Core、Context、Model、Capability 设计

## 范围

本分册定义 Agent core 的最小 model-driven loop、Context Engine 的最小 render、Model provider 调用边界、通用 capability invocation shape 和当前产品启用的 `read` capability。目标是让一次问答和一次 read tool loop 按本分册列出的 port、message、tool-call state、schema 和 failure 规则成立，同时不把 core loop 写成 read 专用实现。

## Agent Core

`agent-core` 实现 `Agent` port：

```ts
execute(
  run: RequestRun,
  context: RequestContext,
  timeline: RunTimelineEventPort,
  messages: RunMessagePort,
  signal: AbortSignal
): Promise<void>
```

唯一执行路径：

1. 通过架构授权的 assembly 读取边界读取固定 assembly；该边界必须使用 `run.agentId` 和 `run.agentVersion`，不得重新选择 active assembly。
2. 调用 Context Engine 生成 `ContextAssembly` 和 `RenderedModelInput`。
3. 将 `RenderedModelInput` 转换为 `ModelInvocationRequest`。
4. 调用 `ModelInvocationService.stream(...)` 获取模型 delta 和 final result。
5. 将 model content delta 转为 timeline event。
6. 如果 final result 包含 tool calls，按 accepted assembly 的 enabled capability descriptors 解析 capability id/name；当前产品只会披露 `read`，未启用、不可解析或 schema validation 失败的 tool call 必须 safe rejected。
7. 通过 `RunMessagePort.appendMessage(run, context, SessionMessageDraft)` 追加 assistant tool-use message，设置当前 tool batch state，并通过 `CapabilityInvocationPort` 调用目标 capability；每个 invocation 使用稳定 `toolCallId`。当前产品中同一模型响应的多个 read calls 按出现顺序串行执行。
8. 通过同一个 `RunMessagePort.appendMessage(...)` 追加 capability result message；runtime 负责用 trusted run/context 补齐 owner、agent、session、request、run 和 timestamp 坐标，并调用 gateway composite write 一次性写入 message、更新 session `updatedAt` 和追加 active context item；随后 core 重新 render follow-up model input。
9. 模型最终产生 assistant 内容后，通过 timeline 发布最终 agent message fact。
10. resolve `Promise<void>`，由 runtime 执行 terminal lifecycle event。

Agent core 不直接写 terminal `RequestRun`，不直接消费 gateway persistence contract，不直接访问 Fastify request，不调用 provider SDK，不绕过 capability boundary 执行任何工具，也不 hardcode 文件读取。一个 request 最多执行 `maxToolRounds=3`，每轮最多 `maxToolCallsPerRound=5`；命中上限时发布 `DEGRADATION_NOTICE` 并以 safe `REQUEST_FAILED` 结束。

## Context Engine

`agent-context-engine` 的最小职责是可运行的 Context Engine 策略，而不是字符串拼接 demo：

- 只接受形如 `ContextAssemblyRequest` 的位置/意图输入：`sessionId`、`requestId`、`requestContextId`、`agentId`、`agentVersion`、`runId`、`stepId`、`locale`、`purpose`。
- 拒绝或不定义 `rootMessageId`、`historyRefs`、`attachmentRefs`、`capabilityDisclosureRefs`、`currentMessage`、`agentAssembly`、`budget` 这类由 Context Engine 自己选择或治理的输入字段；当前 root user message id 使用核心契约已有的 `requestId` 表达，不新增同义字段。
- 读取 active context view 作为模型可见消息顺序。
- 读取当前 request user message 和必要历史 message content。
- 注入 locale、owner metadata、Agent assembly 相关 prompt/profile refs 和默认 prompt profile/system prompt。
- 注入 request locale/language hint，并在默认 system prompt section 中要求保留电信术语原文。
- 披露 enabled capability metadata；当前产品 assembly 只启用 `read`。
- 执行真实最小 window/budget guard：只选择 active context/current request/必要 history 的受限窗口，超出硬上限时不得静默截断模型可见内容，必须产生可诊断 degradation 或 safe failure。
- 产出 `ContextAssembly`，再 render 为 `RenderedModelInput`；`RenderedModelInput` 不包含完整 `ContextAssembly`。

`RequestContext` 不提供 message refs。Context Engine 不从全量 session history 自行扫描模型上下文；它依赖 active context view 和 session/domain query。模型可见消息写入后必须通过 session/runtime 领域层追加 active context item；follow-up model render 必须从更新后的 active context view 读取。

完整 budget explainability、compression、memory retrieval、复杂 prompt profile governance、完整 glossary、语言检测和双语评测集不进入本 change，并由既有 context follow-up changes 承接；本 change 仍必须实现可运行的默认 prompt/profile 和基础 window/budget guard。

## Model Invocation

`agent-model` 只暴露 `ModelInvocationService`：

- `complete(request, signal): Promise<ModelFinalResult>`
- `stream(request, signal): AsyncIterable<ModelStreamDelta | ModelFinalResult>`

`ModelInvocationRequest` 必须由 core 扁平化，包含：

- `requestId`。
- `stepId`。
- provider kind。
- model name。
- base URL。
- credential reference。
- `timeoutMs`。
- `ChatMessage[]`。
- tools。
- `temperature`、`maxTokens`、`topP` 和 `thinking`。
- provider options。

`agent-model` 的真实 provider path 固定为最小 OpenAI adapter，并负责：

- 从共享 model profile 接收 `providerKind=OPENAI`、model name、base URL、credential ref、timeout 和 options。
- 在 provider adapter 内通过安全 credential resolver 解析 credential ref 到 adapter-private credential。
- 构造 provider-native request。
- 将 provider stream chunk 归一化为 `ModelStreamDelta`。
- 按稳定 `toolCallId` 聚合 multi-chunk tool-use arguments 为结构化 `ModelToolCall`。
- 将 provider error 映射为 SafeError。

OpenAI-specific env 只能在 app/config adapter 中映射为共享 model profile，不得穿透到 core/runtime/model request。OpenAI 不支持 thinking 输出时不得伪造 `LLM_THINKING_DELTA`。Provider SDK、AI SDK、native chunk、native error、raw credential 和 runtime timeline sink 都不得出现在 public contract 或 core package 中。OpenAI timeout 且无 fallback 时归一化为 safe timeout error，并由 runtime/core 发布 `DEGRADATION_NOTICE` 后 `REQUEST_FAILED`。

Deterministic/test provider 只能用于 unit、contract 和 characterization tests 的 test composition。最小端到端发布验收必须使用产品 composition、OpenAI adapter 和真实 OpenAI endpoint；fake HTTP server 只能作为 OpenAI adapter unit test endpoint fixture，不得替代产品路径 E2E。

## Capability Invocation 和 Read Capability

`agent-capability` 提供通用 capability catalog/invocation 规格，本 change 的产品 assembly 只启用最小内置 `read` capability：

- descriptor kind 为 `TOOL`。
- descriptor 必须可被 Agent core 按 capability id/name 解析并进入 model tool metadata。
- input schema 使用 canonical argument names：必填 `file_path`，可选 `offset`、`limit`。
- invocation 通过 `CapabilityInvocationPort` 接收 `CapabilityInvocationRequest` 和 `AbortSignal`；request 字段固定为 `invocationId`、`capabilityId`、`toolCallId?`、`arguments`、`sessionId`、`requestId`、`runId`、`requestContextId`、`stepId`、`identityContext`、`agentId`、`agentVersion`、`timeoutMs`、`idempotencyKey?`，不得包含 `workspaceDir` 或 `recoveryReplay`。
- output 返回 safe structured payload 或 safe failure。

路径规则：

1. `file_path` 只接受 workspace-relative 单文件路径，以 Agent assembly `workspaceDir` 解析；产品行为不接受绝对路径。
2. 绝对路径、normalize 后路径逃逸、目录路径和 glob pattern 必须 safe rejection。
3. `offset`/`limit` 是 line-based slice；`offset` 默认 0，表示 0-based 起始行；`limit` 默认 2000，表示最大行数。
4. `offset`/`limit` 必须是整数，`offset >= 0` 且 `1 <= limit <= 2000`；非法值必须在 capability input schema validation 阶段失败，不做静默 fallback。
5. successful payload 固定包含 `file_path`、`offset`、`limit`、`content`、`truncated` 和可选 `nextOffset`，并受 line-based `offset`、`limit` 和最大输出大小约束。
6. successful payload 中的 `file_path` 只能是 normalized workspace-relative path，不得暴露宿主机绝对路径。
7. 超限返回 bounded slice，结构化 payload 显式包含 `truncated=true` 和 `nextOffset`。
8. 权限/安全拒绝、timeout 或 abort 直接导致 `CAPABILITY_COMPLETED` safe failure、`DEGRADATION_NOTICE` 和 request `REQUEST_FAILED`。
9. 缺失文件或普通 IO failure 可以作为 safe tool result 交给模型继续生成答复。
10. failure payload 不包含未脱敏宿主路径、raw stack 或文件内容。

最小内核不实现 `write`、`edit`、`bash`、business API、memory tools、Skill tools 或 remote Agent capability。这些 capability 不进入产品可见 catalog；如果模型或测试绕过 metadata 提交未启用 capability/tool call，Agent core 必须按 unavailable safe outcome 处理。read schema 不兼容 `path`、`filePath` 或其它 alias，避免模型 tool-use 参数歧义。

## Tool Loop State

模型产生 tool call 时，Agent core 创建并保存 assistant tool-use message，并在 `RequestContext` 中写入：

- `currentToolBatchMessageId`。
- 每个 tool call 的 `ToolCallState`：`toolCallId`、`capabilityId`、structured arguments、status。

同一次 request 主流程中需要重建 current-run tool state 或继续 follow-up model render 时，通过 `listCurrentRequestMessages(ListCurrentRequestMessagesRecordQuery)` 按 `tenantId`、`subjectId`、`sessionId`、`requestId` 和 `runId` 读取同一 request/run 的 assistant tool-use message 和 capability result message，再由 session/runtime 领域层映射回 tool batch state。这里的 state reconstruction 只覆盖同进程、同 request/run 主流程；进程重启恢复、checkpoint lookup、`claimRun`/`listRecoverableRuns` 调度、tool replay 和多实例 takeover 不进入本 change。

Capability result 必须持久化为 visible `role=CAPABILITY_RESULT` 的 `SessionMessage`，普通 conversation history 默认不返回，`includeCapabilityResults=true` 时可返回。Capability 返回的 `contextPatch`、动态修改 allowed tools、model name 或 model options 在本 change 不生效，必须忽略或 safe reject。

## Deferred

- output continuation；本 change 只要求超限时 degradation + safe failed terminal，read bounded slice 除外。
- 完整 glossary、语言检测和双语评测集。
- 多 capability source、复杂 governance 和 parallel tool scheduling。
- Skill execution。
- memory tools。
- model input/output raw debug logging。
- process restart recovery、checkpoint lookup、`claimRun`/`listRecoverableRuns` scheduling、tool replay 和 multi-instance takeover。
