[返回 Roadmap V2](../nextagent-ts-change-roadmap-v2.md)

## P0 — 首版本地发布

首个可运行、可验证、可交付的本地 TS 后端版本。详细输入维护在 `docs/nextagent-ts-changes/`。本节只保留能力组索引、目标和详情链接。

### 请求控制

规格输入：
- `RequestControlCommand` 和 `EditLatestRequestCommand` 必须携带由可信 channel/auth boundary 注入的 `identityContext`。
- runtime 必须使用 `identityContext.tenantId` 和 `identityContext.subjectId` 校验 session、latest request、message 和 run 的 owner scope。
- 请求控制 command 字段名保持稳定语义：`sessionId`、`expectedLatestRequestId`、`action`、`editedInputText`、`attachmentIds`、`idempotencyKey`。
- 不新增 `OwnerScope` DTO，不用泛化 `owner`、`targetId`、`input` 或 `metadata` 替代已冻结字段。
- 客户端 payload、客户端 metadata、模型输出或 capability input 不得覆盖 command identity。

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-session-lane-scheduling`](../nextagent-ts-changes/add-ts-session-lane-scheduling.md) | complete | 支持同会话默认入队、latest-submit replacement、串行调度执行和 terminal-pending 保护；新 submit 替换同 lane 旧未完成请求但不绕过 scheduler/terminal commit。 | [详情](../nextagent-ts-changes/add-ts-session-lane-scheduling.md) |
| [`add-ts-request-cancel`](../nextagent-ts-changes/add-ts-request-cancel.md) | complete | 支持取消当前可操作请求，并产生一致 canceled 终态。 | [详情](../nextagent-ts-changes/add-ts-request-cancel.md) |
| [`add-ts-request-retry`](../nextagent-ts-changes/add-ts-request-retry.md) | complete | 支持对最近完成请求创建新的执行尝试，并保留旧结果可追溯。 | [详情](../nextagent-ts-changes/add-ts-request-retry.md) |

### Stream、状态和历史一致性

实现约束：
- `agent-channel-web` 必须作为 Web transport 的独立 Fastify 插件边界对外暴露；`agent-app` 只负责在 composition root 中 `register` 该插件，不得在 app 包内散落 Web route、stream route、transport error handler 或 transport hook 逻辑。
- Web transport 的可选协作能力必须继续通过独立 composition package 接入，例如 `agent-channel-web-auth-local`；`agent-channel-web` 不得反向依赖这些可选插件包。

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-web-sse-ws-transports`](../nextagent-ts-changes/add-ts-web-sse-ws-transports.md) | complete | 在最小内核 SSE stream 基础上补齐 WebSocket，并验证 SSE 和 WebSocket 保持同一请求生命周期和终态语义。 | [详情](../nextagent-ts-changes/add-ts-web-sse-ws-transports.md) |
| [`add-ts-run-status-visibility`](../nextagent-ts-changes/add-ts-run-status-visibility.md) | complete | 向用户暴露 canonical RunStatus 和 stream event projection；用户可见 stream event 使用 `REQUEST_ACCEPTED`、`LLM_*`、`CAPABILITY_*`、`DEGRADATION_NOTICE`、`REQUEST_COMPLETED/FAILED/CANCELED/SUPERSEDED`、`USER_INPUT_*` 等 canonical 名称，不使用 deprecated projection 名称。 | [详情](../nextagent-ts-changes/add-ts-run-status-visibility.md) |
| [`add-ts-stream-resume-replay`](../nextagent-ts-changes/add-ts-stream-resume-replay.md) | complete | 支持 stream resume request、gap outcome，并从 canonical timeline 重放已提交事件。 | [详情](../nextagent-ts-changes/add-ts-stream-resume-replay.md) |
| [`add-ts-stream-history-consistency`](../nextagent-ts-changes/add-ts-stream-history-consistency.md) | complete | 保证恢复后的 stream、历史读取和 request terminal result 一致。 | [详情](../nextagent-ts-changes/add-ts-stream-history-consistency.md) |
| [`refine-session-thinking-presentation-contract`](../nextagent-ts-changes/refine-session-thinking-presentation-contract.md) | complete | 复用 `LLM_THINKING_DELTA` 持久化单次模型调用的最后累计 thinking，交付 run-scoped event 查询与 child-owned fork snapshot。 | [详情](../nextagent-ts-changes/refine-session-thinking-presentation-contract.md) |
| [`establish-conversation-process-history-continuity`](../nextagent-ts-changes/establish-conversation-process-history-continuity.md) | complete | 消费 message/event 双查询完成 frontend history hydration、live/history 最终一致和 ProcessPanel disclosure lifecycle。 | [详情](../nextagent-ts-changes/establish-conversation-process-history-continuity.md) |

### Context Assembly

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-context-history-selection`](../nextagent-ts-changes/add-ts-context-history-selection.md) | complete | 支持无限轮次会话的上下文选择：当前 owner/session、当前输入和已启用 Markdown 附件上下文优先，近期完整 turn 与较早历史摘要共同参与上下文。 | [详情](../nextagent-ts-changes/add-ts-context-history-selection.md) |
| [`add-ts-context-prompt-shaping`](../nextagent-ts-changes/add-ts-context-prompt-shaping.md) | complete | 基于 Agent assembly、model profile、locale 和已装配 prompt template facts 组装模型输入、系统提示、locale metadata 和 capability disclosure；具体模板内容来自配置、实现默认值或 Agent `prompts/` 目录，不在 change 中固化，也不内嵌在 `AgentAssembly` 中。 | [详情](../nextagent-ts-changes/add-ts-context-prompt-shaping.md) |
| [`add-ts-prompt-template-assembly`](../nextagent-ts-changes/add-ts-prompt-template-assembly.md) | complete | 将 prompt template 提升为跨 purpose 的装配能力，支持 `SYSTEM_PROMPT`、`SUMMARY_GENERATION`、`MEMORY_EXTRACTION` 共享确定性模板选择、变量渲染、fallback、`modelOptions` 覆盖 handoff、失败 safe error 和安全观测；模板来源只分 `builtin`/`agent` 两层，builtin 定义在 context-engine 包内并初始化注册，`agent` 高于 `builtin`；模型候选从 `AgentAssembly.modelProfileIds` 投影，`DefaultContextEngine.resolveModelSelection` 内部先用 agent 显式 `match.model` 模板生成 template-compatible 模型清单供模型选择过滤，空集合不约束模型，最终 template 仍由 prompt assembler 使用必填 selected model 选择和渲染；本 change 删除旧 prompt shaping public contract 但不新增 prompt template DTO/port 到 `agent-contracts`。 | [详情](../nextagent-ts-changes/add-ts-prompt-template-assembly.md) |
| [`add-ts-context-budget-explainability`](../nextagent-ts-changes/add-ts-context-budget-explainability.md) | complete | 统一处理模型窗口预算，历史上下文最多使用 60% 预算，超预算或输出长度受限时必须记录并提示用户，不得静默截断；超预算时优先压缩较早历史并输出可诊断的选择、摘要和降级依据。 | [详情](../nextagent-ts-changes/add-ts-context-budget-explainability.md) |
| [`add-ts-context-compression`](../nextagent-ts-changes/add-ts-context-compression.md) | complete | 通过模型摘要压缩较早历史，支撑无限轮次会话并避免静默丢失关键事实。 | [详情](../nextagent-ts-changes/add-ts-context-compression.md) |
| [`add-ts-traceable-summary-generation`](../nextagent-ts-changes/add-ts-traceable-summary-generation.md) | complete | 生成会话历史压缩摘要并保留来源引用、生成时间、用途、owner scope 和历史检索关联；首版摘要归 session 持久化，长期记忆摘要归后续 memory changes。 | [详情](../nextagent-ts-changes/add-ts-traceable-summary-generation.md) |
| [`add-ts-large-content-references`](../nextagent-ts-changes/add-ts-large-content-references.md) | complete | 支持附件、大的工具调用结果和模型摘要按需引用或加载，而不是全部内联。 | [详情](../nextagent-ts-changes/add-ts-large-content-references.md) |
| [`add-large-tool-result-paged-readback`](../nextagent-ts-changes/add-large-tool-result-paged-readback.md) | complete | 超限工具结果 externalize 到 execution workspace 文件，模型经现有 `read` + `file_path` 分页读回尾部内容；`read` 豁免 externalize 防循环，owner-scope 经 workspace resolver 强制且失败不泄漏。 | [详情](../nextagent-ts-changes/add-large-tool-result-paged-readback.md) |

### System Reminder

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-system-reminder-v1`](../nextagent-ts-changes/add-ts-system-reminder-v1.md) | active | 建立系统级运行时上下文注入通道：SR 类型枚举（10 种）、wrap/smoosh/merge 管道、render 后处理集成、`max_turns_reached` 软终止改造、通知队列和 8 个 Producer；`agent-contracts/system-reminder` 作为独立 owning subpath。 | [详情](../nextagent-ts-changes/add-ts-system-reminder-v1.md) |
| [`add-ts-system-reminder-v2`](../nextagent-ts-changes/add-ts-system-reminder-v2.md) | active | 在 v1 管道基础上接入 20 种需要前置依赖的 SR 类型：Hook 投影 5 种、任务追踪 3 种、工具/Agent 管理 3 种、技能系统 2 种、记忆 2 种、大文件 1 种、MCP 2 种、多 Agent 2 种；不修改管道本身。 | [详情](../nextagent-ts-changes/add-ts-system-reminder-v2.md) |

### Model Invocation

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-model-invocation-contract`](../nextagent-ts-changes/add-ts-model-invocation-contract.md) | complete | 澄清稳定的 `ModelInvocationRequest`、`ModelInvocationService`、`ModelFinalResult` 和 `ModelStreamDelta` 行为语义，定义模型调用在请求生命周期中的触发位置、前置条件以及 `complete()` / `stream()` 共享的统一终态。 | [详情](../nextagent-ts-changes/add-ts-model-invocation-contract.md) |
| [`add-ts-model-stream-normalization`](../nextagent-ts-changes/add-ts-model-stream-normalization.md) | complete | 定义 provider-native stream 到 provider-neutral `ModelStreamDelta` / `ModelFinalResult` 的归一化规则，覆盖 delta vocabulary、tool-call fragment 拼接、finish signal 和 malformed chunk 收敛。 | [详情](../nextagent-ts-changes/add-ts-model-stream-normalization.md) |
| [`add-ts-provider-error-safe-mapping`](../nextagent-ts-changes/add-ts-provider-error-safe-mapping.md) | complete | 定义 provider/model failure 到 `AgentError` / `SafeError` 的安全映射规则，统一 sync、stream 和 normalization failure 的安全错误边界。 | [详情](../nextagent-ts-changes/add-ts-provider-error-safe-mapping.md) |
| [`add-ts-model-fallback-semantics`](../nextagent-ts-changes/add-ts-model-fallback-semantics.md) | complete | 澄清模型失败后的 fallback 边界：`agent-model` 不得隐式 cross-profile fallback，fallback 评估归 `agent-core` orchestration，且已有用户可见输出时不得 silent replay。 | [详情](../nextagent-ts-changes/add-ts-model-fallback-semantics.md) |
| [`refine-openai-compatible-model-adapter`](../nextagent-ts-changes/refine-openai-compatible-model-adapter.md) | active | 将全局模型目录与 provider 适配收归 `agent-model`，将 main/summary/memory/session/workflow 的初始/fallback 模型选择统一收归 Context Engine selection port，fallback 生命周期编排保留在 Core；单个 Gateway metadata 失败只使对应 profile `UNAVAILABLE`，不阻塞其他模型或整个应用 ready；`agent-app` 保留配置解析、校验、派生、证据生成和装配，production `NextAgentApp` 保留 immutable `systemConfig` 供可信 App Host 使用并删除重复的 `modelProfileRegistry` 与 `productModelProviderKind`，内部功能模块不得依赖完整配置，Context Engine 通过 app-private injection 获取 model query；调用请求只传 selected `modelId` 与 trusted scope，并以 `ai` 和 `@ai-sdk/openai-compatible` 标准路径完成 Chat Completions、thinking、tool call、stream、best-effort usage 与安全失败；在 `agent-contracts/gateway` 定义可复用的 optional `FetchGateway`，由 app composition 装配给当前模型 consumer，LOCAL 不要求实现且本 change 不迁移其他 REST client；推荐服务为 terminal/Web 的实际模型调用建立 private operation identity；timeline/工作台统一使用 `stepId/modelId`，observability 保留调用事实但不导出高基数模型 identity，model metrics 删除 `provider_kind` label；按 Function canonical spec 对触及 Requirements 做来源 `REMOVED` + 目标 `ADDED/MODIFIED` 原子收敛；同步 RESERVED model policy owner，但不开放扩展点。 | [详情](../nextagent-ts-changes/refine-openai-compatible-model-adapter.md) |

### Capability

规格输入：
- Capability descriptor 使用 `CapabilityProvider` 表达 provider 实例，字段为 `providerId`、`providerKind`、`providerType?`。
- `CapabilityKind`、`CapabilityProviderKind`、`CapabilityReplayPolicy` 和 `CapabilityInvocationStatus` 归 `agent-common`，供 runtime、app configuration、assembly、capability 和 recovery 边界共同复用；capability subpath 不重新定义等价 enum。
- `CapabilityProviderKind` 使用 `BUNDLED`、`LOCAL_DIRECTORY`、`SKILL_HUB`、`MCP_SERVER`、`AGENT_REGISTRY`、`CUSTOM`。
- `providerType` 仅在 `providerKind=CUSTOM` 时必填；CUSTOM provider 必须由 app composition 显式注册 adapter，未注册时不得进入可执行 catalog。
- `CapabilityProvider` 不包含 agentId、agentVersion、scope、优先级或绑定结果；这些由 Agent assembly、catalog governance 和 conflict resolution 表达。
- availability 类型命名为 `AvailabilityStatus`，只使用 `AVAILABLE`、`DISABLED`、`UNAVAILABLE`；只有 `AVAILABLE` 能进入模型可见 capability list 和执行路径。
- Capability descriptor 可选保留 `CapabilityCompatibility` 元数据；`CapabilityCompatibility` 内字段均为可选，缺省为 unrestricted。
- Capability descriptor 可选保留 `supportedLanguages?: RequestLanguage[]`；缺省表示不限制语言。
- 核心 `CapabilityDescriptor` 使用 `provider` 替代 `source`，不保留 `agentRef`/`entryRef`，不在核心 descriptor 中增加 output schema、permission 或 routingTags 字段。
- Capability descriptor 增加 `version?` 表达 capability 元数据或实现版本。
- Capability descriptor 增加 `metadata?: JsonObject`，仅用于 provider 自定义的非敏感扩展描述信息；runtime/core 不得依赖它决定可见性、授权、routing、availability 或 replay safety。
- `availabilityReason` 只能包含 safe reason code 或 safe summary，不得包含 raw path、secret、provider response 或敏感配置。
- `CapabilityInvocationRequest` 使用统一 capability 执行请求，字段为 `invocationId`、`capabilityId`、`toolCallId?`、`arguments`、`sessionId`、`requestId`、`runId`、`requestContextId`、`stepId`、`identityContext`、`agentId`、`agentVersion`、`timeoutMs`、`idempotencyKey?`。
- `CapabilityInvocationRequest` 不包含 `workspaceDir` 或 `recoveryReplay`；workspace/sandbox/provider 执行环境由 capability/provider 模块基于 `AgentAssembly.workspaceDir` 和 provider 配置解析，恢复重放资格由 runtime 在调用前判断。
- `CapabilityInvocationResult` 使用 `structuredPayload` 承载安全结构化结果，不使用 `safeOutput`；保留 `resultRef`、`generatedMessages`、`contextPatch`、`artifactRefs`、`error`、`fallbackTriggered`、`metadata`。
- `generatedMessages` 只允许 `USER` role，字段为 `role`、`content`、`meta`；inline Skill 可通过它把 Skill 内容或生成的 USER message 注入当前 request/run 后续模型上下文，`meta=true` 表示对用户隐藏但可进入模型上下文。
- `contextPatch` 字段为 `allowedTools?`、`modelName?`、`modelOptions?`；它只影响当前 request/run 后续模型步骤，不得永久修改 Agent assembly、session 配置、provider 配置或 catalog state。
- `contextPatch.allowedTools` 不得越权扩大当前 Agent 已授权能力；`modelName`、`modelOptions` 必须经过 model selection/governance 校验。
- `resultRef` 指向完整结果或外部内容引用，适用于结果过大、截断或不适合内联的场景；`artifactRefs` 指向由 artifact gateway 管理的文件、生成输出或 Agent 结果附件 metadata。用户输入附件通过 `attachmentIds` 和 `RequestAttachment` 管理，只有被显式转化为输出产物时才进入 artifact metadata。
- capability result 不包含 `durationMs`、`auditRef` 或 `resultMessageId`；这些由 runtime、wrapper、timeline、audit 或 gateway 层产生。
- `AgentAssembly` 是 runtime-facing 已解析装配结果，不是 `agent.yaml` 原始定义、Agent package manifest、provider/source 配置或 discovery 中间态。
- `AgentAssembly` 字段为 `agentId`、`agentVersion`、`displayName`、`description`、`workspaceDir`、`modelProfileIds`、`capabilityBindings`、`hooks`、`runtimeSettings`。
- `AgentCapabilityBinding` 字段为 `capabilityId`、`capabilityType`、`providerId`；`providerId` 对齐 capability provider identity，不使用旧 source vocabulary。
- `AgentRuntimeSettings` 字段为 `defaultLocale?`、`defaultModelProfileId?`、`maxToolIterations?`、`maxContextMessages?`、`requestTimeoutMs?`。
- `AgentAssembly` 不包含 `packageRef`、`promptTemplateIds`、raw prompt template refs、prompt binding/version summary、capabilityProviderRefs、routingHints、disabled capability bindings、deny rules、shadowing records、provider config、prompt contents、prompt file paths、full prompt template content、model profile details 或 Skill/SubAgent package contents；`AgentRuntimeSettings` 不包含 `defaultPromptTemplateId`。Lifecycle hook activation 由 `complete-ts-lifecycle-hook-capabilities` 定义为 `AgentAssembly.hooks`。
- `workspaceDir` 指向已解析、已校验的 Agent package/workspace 根目录，用于 capability/provider/sandbox 解析执行环境；不得进入模型上下文、stream、safe error、audit 明细或 provider metadata。
- `AgentAssemblyRegistry` 是 runtime-facing assembly lookup boundary，接口为 `active(agentId): AgentAssembly` 和 `require(agentId, agentVersion): AgentAssembly`。
- `active(agentId)` 只用于 request acceptance 阶段解析当前 active Agent version；runtime 必须把 resolved `agentId`、`agentVersion` 和 `agentAssemblyRef` 固化到 `RequestRun` 和 `RequestContext`。
- 已接受请求、恢复、context engine、core 和 capability routing 必须使用 `require(agentId, agentVersion)` 读取同一个 resolved assembly，不得重新按 active version 选择。
- registry 返回 runtime-ready `AgentAssembly`，不返回 `agent.yaml`、Agent package 原始定义或 manifest；首版 registry 由 app composition 启动期 eager compile 后以内存形式提供，不定义 persistent assembly store、lazy compilation、hot reload、gray release 或 same-version snapshot id。
- 缺失 assembly 必须作为明确 missing assembly/not found safe error 处理，不得 fallback 到默认 Agent；模块可以直接依赖 registry，也可以依赖由 registry 派生的 assembly-scoped wrapper，但不得自行解析 Agent package。

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-capability-core-governance`](../nextagent-ts-changes/add-ts-capability-core-governance.md) | complete | 建立统一 catalog、descriptor、provider identity、availability、discovery lifecycle 和 invocation boundary。 | [详情](../nextagent-ts-changes/add-ts-capability-core-governance.md) |
| [`add-ts-agent-package-assembly`](../nextagent-ts-changes/add-ts-agent-package-assembly.md) | complete | 支持以 `agents/{agentId}` 作为 Agent package root 装配 Agent：读取 `agent.yaml`、识别 `skills/`、`subagents/`、`prompts/`，形成 runtime-ready AgentAssembly；有效能力清单是 `agent.yaml` 显式绑定、Agent-scoped providers、内置/本地/SkillHub 等已启用 provider 经过统一治理后的合集。 | [详情](../nextagent-ts-changes/add-ts-agent-package-assembly.md) |
| [`add-ts-builtin-tool-framework`](../nextagent-ts-changes/add-ts-builtin-tool-framework.md) | complete | 定义 Tool 框架 SPI（`ToolDefinition`、`defineTool`、`ToolCatalog`、`BuiltinToolExecutor`），并完整承载首版内置 Tool 的注册、发现、启停和可用性暴露。 | [详情](../nextagent-ts-changes/add-ts-builtin-tool-framework.md) |
| [`add-ts-api-backed-tool-source`](../nextagent-ts-changes/add-ts-api-backed-tool-source.md) | complete | 支持外部 API 作为普通 Tool 的一种实现/来源接入，复用统一 Tool descriptor、input schema/result mapping、治理和 invocation 语义。 | [详情](../nextagent-ts-changes/add-ts-api-backed-tool-source.md) |
| [`add-ts-skill-manifest-contract`](../nextagent-ts-changes/add-ts-skill-manifest-contract.md) | complete | 支持遵循 Agent Skills `SKILL.md` 规范的 manifest 解析和校验；仅增加顶层 `context` 扩展和 `metadata.denied-tools`、`metadata.model` 两个受支持扩展；`context=fork` 只声明执行形态，隔离执行语义由 `add-ts-skill-fork-execution` 承载。 | [详情](../nextagent-ts-changes/add-ts-skill-manifest-contract.md) |
| [`add-ts-builtin-skill-source`](../nextagent-ts-changes/add-ts-builtin-skill-source.md) | complete | 支持内置 Skill 发现、校验和暴露；首个 TS 发布版本内置电信领域知识问答 Skill。 | [详情](../nextagent-ts-changes/add-ts-builtin-skill-source.md) |
| [`add-ts-local-skill-source`](../nextagent-ts-changes/add-ts-local-skill-source.md) | ready | 支持本地 Skill source 目录加载：source 目录下每个一级子目录是一个 Skill，Skill 内部格式遵循统一 Skill manifest contract。 | [详情](../nextagent-ts-changes/add-ts-local-skill-source.md) |
| [`add-ts-skillhub-source`](../nextagent-ts-changes/add-ts-skillhub-source.md) | ready | 支持 SkillHub 通过 remote gateway 进行显式 refresh、agent-scoped list/search、metadata fetch、package download；下载、校验、安装到 managed skills 目录并启用后才进入统一 catalog。 | [详情](../nextagent-ts-changes/add-ts-skillhub-source.md) |
| [`add-ts-skillhub-dynamic-discovery-registration`](../nextagent-ts-changes/add-ts-skillhub-dynamic-discovery-registration.md) | ready | 支持 SkillHub 候选 Skill 的动态发现、注册、注销和状态同步；把远端发现结果收敛为受治理的本地 registration，再交由安装/启用路径接入 catalog。 | [详情](../nextagent-ts-changes/add-ts-skillhub-dynamic-discovery-registration.md) |
| [`add-ts-skill-resource-access`](../nextagent-ts-changes/add-ts-skill-resource-access.md) | complete | 为授权 Skill resources 建立运行期安全访问路径：通过 execution file access policy 派生 `workspace/`、`.nextagent/`、`temp/` 三个物理 root，并让文件工具和 sandbox 只消费按需裁剪的 run workspace view。 | [详情](../nextagent-ts-changes/add-ts-skill-resource-access.md) |
| [`add-ts-invoked-agent-discovery`](../nextagent-ts-changes/add-ts-invoked-agent-discovery.md) | ready | 支持内置 Agent capability 和 `agents/{agentId}/subagents/` 两个来源进入统一 catalog；远端 AgentRegistry discovery 后置。 | [详情](../nextagent-ts-changes/add-ts-invoked-agent-discovery.md) |
| [`add-ts-capability-conflict-resolution`](../nextagent-ts-changes/add-ts-capability-conflict-resolution.md) | complete | 支持按作用域优先解析装配后的能力合集；同作用域冲突拒绝加载，不同作用域 shadowing 必须可解释，禁止静默覆盖。 | [详情](../nextagent-ts-changes/add-ts-capability-conflict-resolution.md) |
| [`add-ts-capability-invocation-audit`](../nextagent-ts-changes/add-ts-capability-invocation-audit.md) | complete | 补实 capability、hook、policy 调用审计，以及取消、超时、失败归一化和结果归档边界。 | [详情](../nextagent-ts-changes/add-ts-capability-invocation-audit.md) |
| [`add-ts-capability-idempotency-contract`](../nextagent-ts-changes/add-ts-capability-idempotency-contract.md) | complete | 定义 Tool 幂等声明契约；只有显式声明支持幂等的 Tool 才可在恢复或重试时使用稳定 `idempotencyKey` 重新调用。 | [详情](../nextagent-ts-changes/add-ts-capability-idempotency-contract.md) |

### Tool

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-skill-tool`](../nextagent-ts-changes/add-ts-skill-tool.md) | complete | 新增 `Skill` tool entry 作为到 governed Skill capability 的受控转接点。 | [详情](../nextagent-ts-changes/add-ts-skill-tool.md) |
| [`add-ts-skill-fork-execution`](../nextagent-ts-changes/add-ts-skill-fork-execution.md) | candidate | 补齐 Skill manifest `context=fork` 的执行形态：为 Skill 建立独立受控模型循环、隔离上下文、受限工具集和安全结果回流；默认 `inline` 行为不变。 | [详情](../nextagent-ts-changes/add-ts-skill-fork-execution.md) |
| [`add-ts-bash-tool`](../nextagent-ts-changes/add-ts-bash-tool.md) | complete | 新增 Bash tool executor handler，必须通过 sandbox gateway 执行。 | [详情](../nextagent-ts-changes/add-ts-bash-tool.md) |
| [`add-ts-python-tool`](../nextagent-ts-changes/add-ts-python-tool.md) | complete | 新增 Python tool executor handler，必须通过 sandbox gateway 执行。 | [详情](../nextagent-ts-changes/add-ts-python-tool.md) |
| [`add-ts-glob-tool`](../nextagent-ts-changes/add-ts-glob-tool.md) | complete | 新增 Glob tool 在 trusted workspace root 下搜索 workspace-relative 匹配文件（测试专用）。 | [详情](../nextagent-ts-changes/add-ts-glob-tool.md) |
| [`add-ts-write-tool`](../nextagent-ts-changes/add-ts-write-tool.md) | complete | 新增 Write tool 写入 trusted workspace root 下的 workspace-relative 文件。 | [详情](../nextagent-ts-changes/add-ts-write-tool.md) |
| [`add-ts-todo-tool`](../nextagent-ts-changes/add-ts-todo-tool.md) | candidate | 新增 canonical builtin `Todo` tool，支持智能体记录、更新和完成轻量级规划代办，用于复杂任务执行中的计划跟踪；不拥有后台 task lifecycle。 | [详情](../nextagent-ts-changes/add-ts-todo-tool.md) |

### Sandbox Execution

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-sandbox-deny-by-default-adapter`](../nextagent-ts-changes/add-ts-sandbox-deny-by-default-adapter.md) | complete | 提供默认拒绝或不可用的 sandbox adapter，使动态执行无法绕过 gateway 边界。 | [详情](../nextagent-ts-changes/add-ts-sandbox-deny-by-default-adapter.md) |
| [`add-ts-executable-tool-sandbox-runtime`](../nextagent-ts-changes/add-ts-executable-tool-sandbox-runtime.md) | complete | 支持 `bash`、`python`、模型生成代码等可执行类能力通过本地受限执行 sandbox 或远端 sandbox gateway 调用。 | [详情](../nextagent-ts-changes/add-ts-executable-tool-sandbox-runtime.md) |
| [`add-ts-cross-platform-executable-semantics`](../nextagent-ts-changes/add-ts-cross-platform-executable-semantics.md) | complete | 统一可执行类能力在 Windows 和 Linux 上的工作目录隔离、环境变量白名单、超时、stdout/stderr 大小限制、exit code 映射和失败解释。 | [详情](../nextagent-ts-changes/add-ts-cross-platform-executable-semantics.md) |

### Side-effect Idempotency

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-runtime-recovery-idempotency-guard`](../nextagent-ts-changes/add-ts-runtime-recovery-idempotency-guard.md) | complete | 在 runtime 恢复流程中基于 checkpoint trigger、timeline、capability result 和 terminal facts 对账；恢复点位于 Tool 调用前且需要重新调用时，必须检查 Tool 幂等声明，不支持幂等则返回 safe error 或 recovery failed。 | [详情](../nextagent-ts-changes/add-ts-runtime-recovery-idempotency-guard.md) |

### 本地状态 Gateway

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-local-session-store`](../nextagent-ts-changes/add-ts-local-session-store.md) | complete | 持久化 session、message、active context view、基础历史读取和当前 request/run 消息读取。 | [详情](../nextagent-ts-changes/add-ts-local-session-store.md) |
| [`add-ts-local-run-timeline-store`](../nextagent-ts-changes/add-ts-local-run-timeline-store.md) | complete | 通过 `RequestRunStoreGateway` 持久化 RequestRun、terminal result 和 timeline；RequestRun 版本更新和 claim/fencing 必须支持 CAS result，terminal commit 使用专用幂等结果。 | [详情](../nextagent-ts-changes/add-ts-local-run-timeline-store.md) |
| [`add-ts-local-checkpoint-store`](../nextagent-ts-changes/add-ts-local-checkpoint-store.md) | ready | 通过 `CheckpointStoreGateway` 将最小内核 no-op checkpoint 替换为真实本地 checkpoint 保存，并支持 idempotencyKey 写入、runVersion 冲突检测和按 sessionId/rootMessageId/runId 查询。 | [详情](../nextagent-ts-changes/add-ts-local-checkpoint-store.md) |
| [`add-ts-local-runtime-recovery`](../nextagent-ts-changes/add-ts-local-runtime-recovery.md) | complete | 支持本地重启后的 RequestRun 恢复；queued run 可重建调度项，executing run 按 checkpoint、message、timeline 和 terminal commit 状态恢复；无法安全恢复时显式失败且不得长期停留在 running/executing。 | [详情](../nextagent-ts-changes/add-ts-local-runtime-recovery.md) |
| [`refine-ts-runtime-recovery-execution-cursor`](../nextagent-ts-changes/refine-ts-runtime-recovery-execution-cursor.md) | ready | 收敛 runtime recovery 与 agent-core 执行边界：runtime 在进入 core 前完成各 lifecycle stage 的可恢复性判断、replay safety 和 resume context 构造；agent-core 只按 execution cursor 推进，不区分正常执行和 recovery。 | [详情](../nextagent-ts-changes/refine-ts-runtime-recovery-execution-cursor.md) |

### Observability 和 Audit

本节是能力组背景和准入约束。具体实施范围、最小闭环、接入矩阵和任务验收以 active OpenSpec change 的 proposal / design / spec / tasks 为准；当本节的大能力清单与 active change 的最小 stable inventory 不一致时，不得扩大当前 change 范围。

核心契约只冻结 `AuditEvent`、`AuditEventWriter` 和 `ErrorNormalizer`；不定义独立 `ExecutionTrace`、通用 `ObservabilityPort`、`MetricRecord`、`TraceId`、`SpanId` 或 OpenTelemetry SDK 类型。Observability 输出由 `agent-observability` 基于 event envelope / observability internal observation event 投影生成；trace/span context 和 diagnostic candidate 只作为实现层候选信息，不进入核心契约。审计事件使用 `attributes` 承载安全结构化字段，`safeSummary` 和 `attributes` 不得包含 raw prompt、thinking、model output、tool args/result、附件内容、secret、credential、未脱敏路径或未授权对象内容。

实现优先级：已有权威 event / fact 覆盖的 request lifecycle、terminal commit、pending input、context compact、hook/policy 等事实优先由 event subscriber 派生日志、审计、指标和 trace link；没有 event stream 但 public port 本身是权威边界的 model、capability、gateway、sandbox、checkpoint 等调用由 composition-time wrapper/decorator 生成 observability internal observation event；HTTP/SSE/WS、auth、transport 错误和 response boundary 使用 middleware/interceptor 且只记录 transport-safe facts；DB/Redis/HTTP client 可使用 auto-instrumentation。业务核心模块不得直接依赖 tracing、metrics、logging SDK/API 类型，不得散落 ad hoc operational log、manual span、manual metric 或显式日志 helper 调用。

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-agent-id-to-audit-event`](../nextagent-ts-changes/add-agent-id-to-audit-event.md) | complete | Contract refinement：在 `AuditEvent` 增加可选 `agentId` 字段，要求 run-bound audit 从 `RequestRun.agentId` 传递，补齐 agent scope 审计能力。 | [详情](../nextagent-ts-changes/add-agent-id-to-audit-event.md) |
| [`add-ts-structured-logging`](../nextagent-ts-changes/add-ts-structured-logging.md) | complete | 提供基于 event envelope 的结构化日志 projector、安全业务标识字段和脱敏日志边界。 | [详情](../nextagent-ts-changes/add-ts-structured-logging.md) |
| [`add-ts-operational-log-hardening`](../nextagent-ts-changes/add-ts-operational-log-hardening.md) | ready | 补齐电信级运行日志可维护性：用单个 `nextagent-operational.log.jsonl` 承载 runtime diagnostic 与 observation-derived entries，并通过 `surface`、producer 边界和 schema 区分输入事实；`agent-log` 统一输出归口，owner 边界负责采集，app/process 兜底只输出 bounded runtime diagnostic；catch/retry/fallback/degradation 路径必须留下安全 `warn/error` 诊断；structured log 使用投影准入避免重复 metric/health/audit/trace；提供日志级别、console/file sink 配置、rotation、默认至少 7 天保留、磁盘水位保护、写入/flush/cleanup 失败降级，以及关键运行路径问题定位字段；复用 redaction policy，不扩散业务模块 ad hoc log。 | [详情](../nextagent-ts-changes/add-ts-operational-log-hardening.md) |
| [`add-ts-trace-log-linking`](../nextagent-ts-changes/add-ts-trace-log-linking.md) | complete | 补实 request/run diagnostic context、event envelope snapshot 和日志/trace 关联。 | [详情](../nextagent-ts-changes/add-ts-trace-log-linking.md) |
| [`add-ts-metrics-health`](../nextagent-ts-changes/add-ts-metrics-health.md) | active | 提供核心 metrics、health check 和 readiness/liveness 边界。 | [详情](../nextagent-ts-changes/add-ts-metrics-health.md) |
| [`add-ts-audit-sink`](../nextagent-ts-changes/add-ts-audit-sink.md) | complete | 将最小内核 no-op audit sink 替换为真实 audit 记录边界。 | [详情](../nextagent-ts-changes/add-ts-audit-sink.md) |
| [`add-ts-redaction-policy`](../nextagent-ts-changes/add-ts-redaction-policy.md) | complete | 对 safe error、日志、trace、audit、metrics、stream diagnostic 和 health diagnostic 信息执行统一脱敏。 | [详情](../nextagent-ts-changes/add-ts-redaction-policy.md) |

### Session Title Management

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-session-title-generation`](../nextagent-ts-changes/add-ts-session-title-generation.md) | complete | 在首个用户请求完成后用确定性规则提取问题短语生成 4-40 字符 session title，持久化并支持历史列表展示；生成不得调用模型，不得覆盖用户手动标题。 | [详情](../nextagent-ts-changes/add-ts-session-title-generation.md) |
| [`add-ts-session-title-update`](../nextagent-ts-changes/add-ts-session-title-update.md) | complete | 支持 session owner 手动修改 4-40 字符 session title，持久化为 user title source 并更新历史列表展示；修改必须校验长度、空值、安全字符、敏感内容和 owner 权限，并记录 audit。 | [详情](../nextagent-ts-changes/add-ts-session-title-update.md) |

### Runtime Configuration

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-app-config-schema`](../nextagent-ts-changes/add-ts-app-config-schema.md) | complete | 定义 app composition 配置 schema、校验和 safe config error。 | [详情](../nextagent-ts-changes/add-ts-app-config-schema.md) |
| [`add-ts-model-provider-configuration`](../nextagent-ts-changes/add-ts-model-provider-configuration.md) | complete | 支持模型 provider 启停、选择和安全配置边界，并采用稳定的 `modelProfiles[]` 配置 baseline。 | [详情](../nextagent-ts-changes/add-ts-model-provider-configuration.md) |
| [`add-ts-capability-source-configuration`](../nextagent-ts-changes/add-ts-capability-source-configuration.md) | complete | 支持 capability provider 启停、位置/reference、managed install/cache dir、credential reference 和显式禁用 capability ids。 | [详情](../nextagent-ts-changes/add-ts-capability-source-configuration.md) |
| [`add-ts-secret-configuration-boundary`](../nextagent-ts-changes/add-ts-secret-configuration-boundary.md) | complete | 支持 env/file secret reference，并禁止 raw secret 泄漏到输出。 | [详情](../nextagent-ts-changes/add-ts-secret-configuration-boundary.md) |

### Local Runtime Packaging

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-local-runtime-package`](../nextagent-ts-changes/add-ts-local-runtime-package.md) | complete | 定义首版本地运行包的最小产物边界、目录职责、启动入口、配置样例、版本 manifest 和 release candidate evidence。 | [详情](../nextagent-ts-changes/add-ts-local-runtime-package.md) |

### Fullstack Packaging and UI Hosting

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-agent-web-multi-host-modes`](../nextagent-ts-changes/add-agent-web-multi-host-modes.md) | complete | 定义 `agent-web` 本地式、沉浸式和协作式三种宿主运行模式，共享业务核心、Prel/PIU 事件契约、多宿主构建产物和 dev/test 测试框架；正式 `index.html` 由沉浸式源入口构建产出，PIU 资产为 `piu/AIAgentPIU.js` 和 `piu/AIAgentPIU.css`。 | [详情](../nextagent-ts-changes/add-agent-web-multi-host-modes.md) |
| [`refine-ts-fullstack-packaging-boundary`](../nextagent-ts-changes/refine-ts-fullstack-packaging-boundary.md) | complete | 刷新 TS 后端架构基线，使同仓库 `frontend/agent-web` 前端模块、前端构建后 npm 包产物、`agent-app` 静态资源托管、可选前端依赖 profile 和同一 server 提供前后端服务成为受控目标态。 | [详情](../nextagent-ts-changes/refine-ts-fullstack-packaging-boundary.md) |

### Authentication / Local Auth

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-local-configured-auth`](../nextagent-ts-changes/add-ts-local-configured-auth.md) | ready | 支持 localhost-only local auth：本地单用户配置、login/logout、signed HttpOnly cookie、未认证 challenge、前端登录跳转输入，以及可信 `IdentityContext` 注入；local auth 通过独立 package 仅由 local 产品入口组装，remote/IAM 产物不得包含该包或其路由逻辑。 | [详情](../nextagent-ts-changes/add-ts-local-configured-auth.md) |

### Release Hardening

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`harden-ts-local-runtime-release`](../nextagent-ts-changes/harden-ts-local-runtime-release.md) | complete | 形成首个可运行、可验证、可交付的本地 TS 后端版本，覆盖启动命令、配置样例、测试门禁、health check 和 release scope。 | [详情](../nextagent-ts-changes/harden-ts-local-runtime-release.md) |
| [`add-ts-e2e-P0-product-journey-gate`](../nextagent-ts-changes/add-ts-e2e-P0-product-journey-gate.md) | complete | 使用真实 local product process、浏览器和 HTTP/SSE/WebSocket 验证首版主用户旅程，并产出 release smoke evidence。 | [归档](../../openspec/changes/archive/2026-06-12-add-ts-e2e-p0-product-journey-gate) |
| [`add-ts-e2e-P0-security-gate`](../nextagent-ts-changes/add-ts-e2e-P0-security-gate.md) | complete | 使用真实 process/network/filesystem/sink 验证认证、附件、sandbox、SafeError、日志和 audit 的安全边界。 | [归档](../../openspec/changes/archive/2026-06-12-add-ts-e2e-p0-security-gate) |
| [`add-ts-e2e-P0-resilience-gate`](../nextagent-ts-changes/add-ts-e2e-P0-resilience-gate.md) | complete | 使用真实断连、process restart 和 persistence 验证 stream replay、local recovery 与非幂等恢复保护。 | [归档](../../openspec/changes/archive/2026-06-12-add-ts-e2e-p0-resilience-gate) |
| [`add-ts-e2e-P0-release-package-gate`](../nextagent-ts-changes/add-ts-e2e-P0-release-package-gate.md) | complete | 从正式候选包验证配置 fail-closed、health/readiness、fullstack route precedence 和候选产物完整性。 | [归档](../../openspec/changes/archive/2026-06-12-add-ts-e2e-p0-release-package-gate) |
