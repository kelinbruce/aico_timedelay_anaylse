# add-ts-capability-conflict-resolution

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Capability

状态：active
类型：实施 change
主要 owner：`agent-capability`
依赖：`add-ts-capability-core-governance`、`add-ts-agent-package-assembly`

目标：
- 支持按作用域优先解析装配后的能力合集；同作用域冲突拒绝加载，不同作用域 shadowing 必须可解释，禁止静默覆盖。

能力组共享输入：

整理状态：已整理为能力组级输入

能力组目标：
- 以统一 capability 语义支持 Tool、Skill 和 Agent capability 的发现、启停、冲突处理、调用和审计。
- 公共 capability kind 使用 `TOOL`、`SKILL`、`AGENT`。
- Capability descriptor 使用 `CapabilityProvider` 表达 provider 实例，字段为 `providerId`、`providerKind`、`providerType?`。
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

共享规格输入：
- 最小内核只需要内置 `read` 工具。
- TS 首个发布版本内置工具清单为 `read`、`write`、`glob`、`bash`、`python`、`skill`、`question`、`todo`、`task`。
- API-backed Tool 是普通 Tool 的一种实现/来源，不形成新的 capability 类型，也不使用独立描述体系。
- API-backed Tool 必须复用统一 Tool descriptor、input schema、structuredPayload/resultRef/artifactRefs、治理、权限、审计、取消、超时和 invocation 语义。
- HTTP/API 调用细节属于 Tool provider/source 的内部配置或 adapter 实现，不泄漏为跨 capability 的独立 public contract。
- `CapabilityInvocationRequest` 使用统一 capability 执行请求，字段为 `invocationId`、`capabilityId`、`toolCallId?`、`arguments`、`sessionId`、`requestId`、`runId`、`requestContextId`、`stepId`、`identityContext`、`agentId`、`agentVersion`、`timeoutMs`、`idempotencyKey?`。
- `CapabilityInvocationRequest` 不包含 `workspaceDir` 或 `recoveryReplay`；workspace/sandbox/provider 执行环境由 capability/provider 模块解析，恢复重放资格由 runtime 在调用前判断。
- `CapabilityInvocationResult` 使用 `structuredPayload` 承载安全结构化结果，不使用 `safeOutput`；保留 `resultRef`、`generatedMessages`、`contextPatch`、`artifactRefs`、`error`、`fallbackTriggered`、`metadata`。
- `generatedMessages` 只允许 `USER` role，字段为 `role`、`content`、`meta`；inline Skill 可通过它把 Skill 内容或生成的 USER message 注入当前 request/run 后续模型上下文，`meta=true` 表示对用户隐藏但可进入模型上下文。
- `contextPatch` 字段为 `allowedTools?`、`modelName?`、`modelOptions?`；它只影响当前 request/run 后续模型步骤，不得永久修改 Agent assembly、session 配置、provider 配置或 catalog state。
- `contextPatch.allowedTools` 不得越权扩大当前 Agent 已授权能力；`modelName`、`modelOptions` 必须经过 model selection/governance 校验。
- `resultRef` 指向完整结果或外部内容引用，适用于结果过大、截断或不适合内联的场景；`artifactRefs` 指向由 artifact gateway 管理的文件、生成输出或 Agent 结果附件 metadata。用户输入附件通过 `attachmentIds` 和 `RequestAttachment` 管理，只有被显式转化为输出产物时才进入 artifact metadata。
- capability result 不包含 `durationMs`、`auditRef` 或 `resultMessageId`；这些由 runtime、wrapper、timeline、audit 或 gateway 层产生。
- Tool 默认不支持幂等，必须显式声明支持幂等后，恢复或重试流程才可用稳定 operationId/idempotencyKey 重新调用该 Tool。
- 首批 audit event 覆盖 request、model、capability、hook、policy、attachment、routing、terminal 和 safe error。
- Skill manifest 必须遵循 Agent Skills `SKILL.md` 规范：标准 frontmatter 字段为 `name`、`description`、`license`、`compatibility`、`metadata`、`allowed-tools`。
- Skill manifest 只增加一个顶层扩展字段 `context`，取值为 `inline` 或 `fork`，默认为 `inline`。
- `metadata` 扩展 value 按字符串处理，允许 JSON 字符串；首版本只处理 `denied-tools` 和 `model` 两个扩展。
- `denied-tools` 的 value 格式与规范中的 `allowed-tools` 一致。
- `model` 可为模型名字符串，也可为 JSON 字符串，JSON 结构包含 `modelName` 和 `modelOptions`。
- 除标准字段和 `context` 外不支持其他顶层扩展；`metadata` 中其他扩展字段只解析保留，不驱动行为。
- 本地 Skill source 是一个目录，目录下每一个一级子目录是一个 Skill。provider 路径配置和启停由 capability provider configuration 承载。
- SkillHub list/search 请求必须携带 agent id 和 agent version，用于返回与当前 Agent 版本匹配的 Skill 候选。
- SkillHub 认证使用配置中的 credential reference，raw token 不得进入日志、stream 或 safe error。
- SkillHub 首批不做复杂 TTL 自动刷新，只支持显式 refresh 触发远端同步；签名验证后置。
- capability 冲突优先级从高到低为：用户显式指定或 Agent package 显式绑定的 capability、Agent-scoped source、内置 source、本地全局 source、SkillHub/远端 source。
- 同一作用域内同名 capability 默认拒绝加载并产生 diagnostic；不同作用域同名允许共存，但 catalog 必须记录 shadowing/override 解释。

并行边界：
- `add-ts-capability-core-governance` 是该能力组的前置 change。
- 各 provider/source change 不得创建第二套 catalog、discovery 或 invocation 语义。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
