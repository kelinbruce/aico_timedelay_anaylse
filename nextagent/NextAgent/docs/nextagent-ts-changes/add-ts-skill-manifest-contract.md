# add-ts-skill-manifest-contract

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Capability

状态：active
类型：实施 change
主要 owner：`agent-capability`
依赖：`add-ts-capability-core-governance`

目标：
- 支持遵循 Agent Skills `SKILL.md` 规范的 manifest 解析和校验；仅增加顶层 `context`、`agent`、`user-invocable`、`model-invocable`、`model` 扩展和 `metadata.denied-tools`、`metadata.nextagent.model`、`metadata.nextagent.modelOptions` 三个受支持 metadata 扩展；`metadata.model` 作为受控旧字段映射到 `metadata.nextagent.model`。

能力组共享输入：

整理状态：已整理为能力组级输入

能力组目标：
- 以统一 capability 语义支持 Tool、Skill 和 Agent capability 的发现、启停、冲突处理、调用和审计。
- 公共 capability kind 使用 `TOOL`、`SKILL`、`AGENT`。
- Capability descriptor 使用 `CapabilityProvider` 表达 provider 实例，字段为 `providerId`、`providerKind`、`providerType?`。
- `CapabilityProviderKind` 使用 `BUNDLED`、`LOCAL_DIRECTORY`、`SKILL_HUB`、`MCP_SERVER`、`AGENT_REGISTRY`、`CUSTOM`。
- `providerType` 仅在 `providerKind=CUSTOM` 时必填；CUSTOM provider 由 app composition 显式注册 adapter 后进入可执行 catalog。
- `CapabilityProvider` 表达 provider 实例身份；agentId、agentVersion、scope、优先级和绑定结果由 Agent assembly、catalog governance 和 conflict resolution 表达。
- availability 类型命名为 `AvailabilityStatus`，只使用 `AVAILABLE`、`DISABLED`、`UNAVAILABLE`；只有 `AVAILABLE` 能进入模型可见 capability list 和执行路径。
- Capability descriptor 可选保留 `CapabilityCompatibility` 元数据；`CapabilityCompatibility` 内字段均为可选，缺省为 unrestricted。
- Capability descriptor 可选保留 `supportedLanguages?: RequestLanguage[]`；缺省表示不限制语言。
- 核心 `CapabilityDescriptor` 使用 `provider` 替代 `source`；Agent/package entry 关联、output schema、permission 和 routingTags 由对应 owner contract 表达。
- `CapabilityDescriptor` 使用 `description` 表达模型可见安全描述；不保留 `safeDescription` public 字段。
- Capability descriptor 增加 `version?` 表达 capability 元数据或实现版本。
- Capability descriptor 增加 `metadata?: JsonObject`，仅用于 provider 自定义的非敏感扩展描述信息；可见性、授权、routing、availability 和 replay safety 由 governed descriptor fields 与 governance contract 决定。
- `availabilityReason` 使用 safe reason code 或 safe diagnostic message。

共享规格输入：
- 最小内核只需要内置 `read` 工具。
- TS 首个发布版本内置工具清单为 `read`、`write`、`glob`、`bash`、`python`、`skill`、`question`、`todo`、`task`。
- API-backed Tool 是普通 Tool 的一种实现/来源，复用统一 capability 类型和描述体系。
- API-backed Tool 必须复用统一 Tool descriptor、input schema、structuredPayload/resultRef/artifactRefs、治理、权限、审计、取消、超时和 invocation 语义。
- HTTP/API 调用细节属于 Tool provider/source 的内部配置或 adapter 实现，跨 capability public contract 继续使用统一 Tool/Capability contract。
- `CapabilityInvocationRequest` 使用统一 capability 执行请求，字段为 `invocationId`、`capabilityId`、`toolCallId?`、`arguments`、`sessionId`、`requestId`、`runId`、`requestContextId`、`stepId`、`identityContext`、`agentId`、`agentVersion`、`timeoutMs`、`idempotencyKey?`。
- `CapabilityInvocationRequest` 使用统一执行坐标；workspace/sandbox/provider 执行环境由 capability/provider 模块解析，恢复重放资格由 runtime 在调用前判断。
- `CapabilityInvocationResult` 使用 `structuredPayload` 承载安全结构化结果；保留 `resultRef`、`generatedMessages`、`contextPatch`、`artifactRefs`、`error`、`fallbackTriggered`、`metadata`。
- `generatedMessages` 只允许 `USER` role，字段为 `role`、`content`、`meta`；inline Skill 可通过它把 Skill 内容或生成的 USER message 注入当前 request/run 后续模型上下文，`meta=true` 表示对用户隐藏但可进入模型上下文。
- `contextPatch` 字段为 `allowedTools?`、`modelName?`、`modelOptions?`；它只影响当前 request/run 后续模型步骤，Agent assembly、session 配置、provider 配置和 catalog state 仍由各自 owner 管理。
- `contextPatch.allowedTools` 在当前 Agent 已授权能力集合内收敛；`modelName`、`modelOptions` 必须经过 model selection/governance 校验。
- `resultRef` 指向完整结果或外部内容引用，适用于结果过大、截断或不适合内联的场景；`artifactRefs` 指向由 artifact gateway 管理的文件、生成输出或 Agent 结果附件 metadata。用户输入附件通过 `attachmentIds` 和 `RequestAttachment` 管理，只有被显式转化为输出产物时才进入 artifact metadata。
- `durationMs`、`auditRef` 和 `resultMessageId` 由 runtime、wrapper、timeline、audit 或 gateway 层产生。
- Tool 通过显式幂等声明支持恢复或重试流程使用稳定 operationId/idempotencyKey 重新调用。
- 首批 audit event 覆盖 request、model、capability、hook、policy、attachment、routing、terminal 和 safe error。
- Skill manifest 必须遵循 Agent Skills `SKILL.md` 规范：标准 frontmatter 字段为 `name`、`description`、`license`、`compatibility`、`metadata`、`allowed-tools`。
- `name` 和 `description` 是 required；`name` 遵守官方 1-64、lowercase alphanumeric/hyphen、无首尾 hyphen、无连续 hyphen 规则；`description` 遵守官方 1-1024 字符规则。
- 当 source 能提供 safe Skill directory/candidate name 时，`name` 必须与该 safe candidate name 一致。
- `compatibility` 是 optional string，1-500 characters；`metadata` 是 optional string-to-string map；`allowed-tools` 是 optional space-separated tool-name string。
- Skill manifest 增加顶层扩展字段 `context`，取值为 `inline` 或 `fork`，默认为 `inline`；规范化后的字段名为 `context`。
- Skill manifest 增加顶层扩展字段 `agent`，取值必须校验为现有 Agent assembly contract 使用的 canonical `AgentId`；该字段表达 fork 模式执行 Agent hint，不是 display name、provider-qualified id 或带版本 selector，缺省 `context` 时归一为 `fork`，与 `context:inline` 同时出现时 rejected。
- Skill manifest 增加顶层扩展字段 `user-invocable`，取值为 boolean，默认为 `false`；该字段表达是否允许用户显式指定执行该 Skill，capability binding、owner scope、Agent scope、availability、policy 和 invocation authorization 仍然生效。
- Skill manifest 增加顶层扩展字段 `model-invocable`，取值为 boolean，默认为 `true`；该字段表达模型/编排路径是否可将该 Skill 纳入候选，capability binding、owner scope、Agent scope、availability、policy 和 invocation authorization 仍然生效。
- `metadata` 扩展 value 按字符串处理，受支持扩展可以把字符串解析为安全结构；首版本支持通用 `version`，只处理 `denied-tools`、`nextagent.model`、`nextagent.modelOptions` 三个标准扩展，并把 `model` 作为受控旧字段映射到 `nextagent.model`。
- `denied-tools` 的 value 格式与规范中的 `allowed-tools` 一致，使用 space-separated tool-name string。
- 顶层 `model` 可为模型名字符串，也可为 JSON-compatible object，结构包含 `model` 和可选 `modelOptions`。
- `metadata.nextagent.model` 是模型名字符串；`metadata.nextagent.modelOptions` 是 JSON 字符串对象；受控旧字段 `metadata.model` 可为模型名字符串，也可为 JSON 字符串，JSON 结构包含 `model` 和可选 `modelOptions`。
- 多个模型声明来源必须归一后一致；冲突的 `model` 或 `modelOptions` 进入 rejected validation outcome。思考深度或 reasoning depth 通过现有 `modelOptions` 表达。
- 标准字段、`context`、`agent`、`user-invocable`、`model-invocable` 和 `model` 是本 change 支持的顶层字段；`metadata.version` 映射为 `CapabilityDescriptor.version`，不使用 `nextagent` 前缀；`license`、`compatibility` 和其他 string source metadata 可以保留为 `SkillMetadata.sourceMetadata`，unsafe source metadata 进入 degraded diagnostic 路径。
- Skill `name` 映射为 `CapabilityDescriptor.capabilityId` 和模型可见调用名；frontmatter `description` 映射为 `CapabilityDescriptor.description`；provider-qualified identity 保留在 `CapabilityDescriptor.provider`、Agent binding、catalog governance 和 diagnostic 中，不作为模型可见 Skill 调用名。
- Agent-visible capability set 中同一个 Skill `capabilityId` 最多只能有一个 available descriptor；同名冲突必须在 model disclosure 和 invocation 前通过治理完成 resolved、shadowed、skipped 或 diagnostic。
- `SkillFrontmatter` 是 `agent-capability` parser 内部过程数据；跨模块 public contract 使用 `CapabilityDescriptor` 和 `CapabilityDescriptor.metadata` 中的 typed `SkillMetadata`。
- `agent-contracts/capability` 承载 `SkillMetadata` schema/type；`agent-capability` 承载 parser、frontmatter validation、descriptor metadata mapping，以及 `CapabilityDescriptor.metadata` -> `SkillMetadata` typed accessor/validator。
- `agent-contracts/capability` 承载 `CapabilityDescriptor.description` refinement、`SkillMetadata` schema/type、`SkillManifestDiagnostic` schema/type；rejected/degraded manifest 通过 stable reason code、severity、validation outcome 和 sanitized message 暴露安全诊断，不暴露 raw manifest、raw path、credential、provider response、user input 或 model input/output。
- `SkillManifestDiagnostic.reasonCode` 使用稳定 public code 集：`SKILL_MD_MISSING`、`INVALID_NAME`、`NAME_MISMATCH`、`INVALID_DESCRIPTION`、`INVALID_OFFICIAL_FIELD`、`INVALID_CONTEXT`、`INVALID_AGENT`、`AGENT_REQUIRES_FORK_CONTEXT`、`INVALID_INVOCABILITY`、`INVALID_TOOL_CONSTRAINTS`、`UNSAFE_MODEL_DECLARATION`、`CONFLICTING_MODEL_DECLARATION`、`SOURCE_METADATA_OMITTED`、`DESCRIPTOR_MAPPING_FAILED`。
- Reusable parser 只消费 leading frontmatter block 或 extracted frontmatter source，以及 source 可提供的 safe candidate name，不要求完整 markdown body；reusable mapper 消费 validated frontmatter facts + `CapabilityProvider`，产出 Skill `CapabilityDescriptor` + typed `SkillMetadata`。
- 本地 Skill source 是一个目录，目录下每一个一级子目录是一个 Skill。provider 路径配置和启停由 capability provider configuration 承载。
- SkillHub list/search 请求必须携带 agent id 和 agent version，用于返回与当前 Agent 版本匹配的 Skill 候选。
- SkillHub 认证使用配置中的 credential reference；日志、stream 和 safe error 使用安全诊断信息。
- SkillHub 首批支持显式 refresh 触发远端同步；复杂 TTL 自动刷新和签名验证由后续 change 承载。
- capability 冲突优先级从高到低为：用户显式指定或 Agent package 显式绑定的 capability、Agent-scoped source、内置 source、本地全局 source、SkillHub/远端 source。
- 同一作用域内同名 capability 默认拒绝加载并产生 diagnostic；不同作用域同名允许共存，但 catalog 必须记录 shadowing/override 解释。

并行边界：
- `add-ts-capability-core-governance` 是该能力组的前置 change。
- 各 provider/source change 复用统一 catalog、discovery 和 invocation 语义。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、相邻 owner 边界、验收要点和并行边界。
- 本 change 的 frozen contract refinement 范围固定为 `CapabilityDescriptor.description`、`SkillMetadata`、`SkillManifestDiagnostic` 及其 runtime schemas，进入实施前需要完成群内确认；其他 frozen contract 修改必须另提 refinement change。
