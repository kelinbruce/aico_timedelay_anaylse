## 背景和现状（Context）

Owner 10 负责 Skill / Agent package 来源边界，Owner 9 负责 capability catalog、descriptor 和 invocation 语义。Skill manifest contract 位于两者之间：它定义 `SKILL.md` 如何产生稳定 Skill descriptor metadata，但不决定这些 metadata 如何被执行。

当前 TS 路线图已经冻结两条约束：

- Skill manifest 必须兼容 Agent Skills `SKILL.md` 规范。
- TS 首版只允许少量受支持扩展，避免每个 source 自行解释 manifest metadata。

本 design 固定目标态 manifest contract，使 builtin/local/agent-scoped/SkillHub source 后续都能复用同一解析和校验结果。

跨模块可见的 Skill capability metadata 归属 `agent-contracts/capability` capability contract surface。`agent-capability` 拥有 parser implementation、source adapter reuse helper、`SKILL.md` frontmatter validation 和 descriptor metadata mapping 实现；各 Skill source 复用同一 `CapabilityDescriptor.metadata` typed Skill metadata shape。

## 当前代码基线和唯一实施路径（Current Baseline / Minimal Delta）

### 当前代码基线

- `packages/agent-contracts/src/capability/index.ts` 已定义 `CapabilityDescriptor`、`CapabilityProvider`、`CapabilityInvocationRequest`、`CapabilityInvocationResult` 和 catalog ports；当前 descriptor 字段仍为 `safeDescription`，并已有 `version?`、`metadata?`、`inputSchema?`。
- `packages/agent-capability/src/builtins/read/descriptor.ts` 已提供内置 `read` Tool descriptor，使用 `capabilityId="read"`、`displayName="read"` 和 `safeDescription`。
- `packages/agent-context-engine/src/assembly/assemble-context.ts` 已把 `visibleCapabilities` 投影为模型 tool metadata，当前读取 `capability.safeDescription` 作为模型可见 `description`。
- `packages/agent-capability/src/catalog/catalog.ts` 已按 `capabilityId` 构建可见 capability view，并在同一 `capabilityId` 多候选时交给 conflict resolver；Skill `name -> capabilityId` 复用这条 catalog 语义。
- 当前没有 Skill frontmatter parser、Skill descriptor mapper、`SkillMetadata` public schema/type、`SkillManifestDiagnostic` public schema/type 或 `CapabilityDescriptor.metadata -> SkillMetadata` typed accessor。

### 唯一实施路径

1. 在 `agent-contracts/capability` 中把 `CapabilityDescriptor.safeDescription` contract refinement 为 `description`，同步 context/model disclosure、内置 read descriptor 和相关 contract tests；不保留双字段兼容层。
2. 在 `agent-contracts/capability` 中新增 `SkillMetadata` 和 `SkillManifestDiagnostic` public schema/type；`SkillFrontmatter`、parser validation records、filesystem input 和 source scan state 保持在 `agent-capability` implementation boundary。
3. 在 `agent-capability` 中新增 reusable frontmatter parser helper。该 helper 只接收 leading frontmatter block 或 already extracted frontmatter source，以及 source 提供的 safe candidate name（当 source 能提供时），按官方 Agent Skills frontmatter 规则校验 `name`、`description`、`license`、`compatibility`、`metadata`、`allowed-tools`，并按本 change 校验 `context`、`agent`、`user-invocable`、`model-invocable`、`model`。
4. 在 `agent-capability` 中新增 reusable descriptor mapper helper。该 helper 接收 validated frontmatter facts 和 `CapabilityProvider`，产出 Skill `CapabilityDescriptor`、typed `SkillMetadata`、validation outcome 和 `SkillManifestDiagnostic[]`；source-private path、provider-private entry ref 和 raw markdown body 不进入输出。
5. 在 `agent-capability` 中新增 `CapabilityDescriptor.metadata -> SkillMetadata` typed accessor/validator，后续 source、governance、assembly、context 和 execution changes 通过 accessor/schema validation 读取 Skill-specific metadata。
6. builtin/local/agent-scoped/SkillHub source changes 只能复用同一 parser/mapper/accessor，不得再定义 source-private manifest public DTO 或第二套 mapping policy。

## 与已接受基线的一致性审视（Consistency Review）

### 已继承的基线

- `establish-ts-backend-architecture`：Owner 10 只负责 source 和 package 事实来源，不拥有 capability invocation、Agent routing 或 memory 策略。
- `establish-ts-core-contracts`：`CapabilityKind`、`CapabilityProviderKind`、`CapabilityReplayPolicy` 和 `CapabilityDescriptor` 所需系统级 vocabulary 来自冻结契约，manifest contract 不重新定义等价 enum。
- `add-ts-capability-core-governance`：manifest mapping result 是 descriptor 和 availability 的输入，统一 catalog、availability、conflict resolution 和 invocation boundary 继续生效。
- `add-ts-agent-package-assembly`：Agent assembly 消费已治理 source/capability descriptor，不在 assembly 阶段重新解析 `SKILL.md`。

### 需要显式收敛的边界

Roadmap 明确支持顶层 `context` 扩展和 `metadata.denied-tools`、`metadata.model` 两个受支持扩展。旧任务描述只保留 `metadata.context`，与 roadmap 不一致。根据本 change 评审后的目标口径，TS 首版还支持顶层 `user-invocable` 扩展，用于表达用户是否可显式指定该 Skill 执行；支持顶层 `agent` 扩展，用于 fork 模式下声明执行 Agent hint；这些字段不替代 capability binding、owner scope、Agent scope 或 invocation authorization。模型声明同时支持事实标准顶层 `model` 和 NextAgent namespaced metadata 扩展。

本 change 选定口径为：

- `context`、`agent`、`user-invocable` 和 `model` 是顶层受支持扩展字段；
- `model-invocable` 是顶层受支持扩展字段；
- `metadata.version` 是受支持的通用 Skill metadata key，映射为 `CapabilityDescriptor.version`；
- `metadata.denied-tools`、`metadata.nextagent.model`、`metadata.nextagent.modelOptions` 是受支持 metadata 扩展；
- `metadata.model` 是保留的兼容别名，只能解析为同一组 `SkillMetadata.model` / `SkillMetadata.modelOptions`；
- 其他 source metadata 可以安全保留或进入 safe diagnostic 路径；capability 可见性、权限、模型选择和 routing 由 governed descriptor fields 和 typed Skill metadata 驱动。

### 需要群内确认的 public contract refinement

本 change 会修改已冻结的 `agent-contracts/capability` public contract surface，进入实施前需要完成群内确认。确认范围固定为：

- `CapabilityDescriptor.safeDescription` refinement 为 `CapabilityDescriptor.description`；安全描述约束保持不变，不保留双字段兼容层。
- 新增 `SkillMetadata` public schema/type，用作 `CapabilityDescriptor(kind=SKILL).metadata` 的 typed metadata contract。
- 新增 `SkillManifestDiagnostic` public schema/type 和稳定 reason code 集，用于 manifest accepted/rejected/degraded 的安全诊断。

`SkillFrontmatter`、parser validation records、filesystem input、source scan state、source-private loading keys、Skill body loading、catalog registration、invocation lifecycle、descriptor storage 和 provider-private configuration 不进入 `agent-contracts`。

## 目标和相邻能力归属（Goals / Adjacent Ownership）

### 目标

- 定义 `SKILL.md` 作为 Skill manifest 权威输入。
- 定义标准 frontmatter 字段、正文边界和受支持扩展。
- 定义 manifest validation outcome、safe diagnostics 和 source 消费规则。
- 定义 `SKILL.md` frontmatter 到 `CapabilityDescriptor` 和 typed `SkillMetadata` 的映射边界。
- 定义 `SkillMetadata` 的 public ownership：跨模块暴露时归 `agent-contracts/capability`，frontmatter/parser intermediates 归 `agent-capability`。
- 防止 source 私自解释未知字段、权限字段或模型字段。

### 相邻能力归属

- Skill discovery source 的扫描、安装和启停流程归 source discovery changes。
- Skill invocation、inline/fork runtime 执行、tool loop 和 sandbox 行为归 execution/sandbox changes。
- SkillHub 远端协议归 SkillHub source changes。
- Agent routing、prompt rendering 和 model provider 调用语义归对应 core/context/model changes。

## 设计决策（Decisions）

### D1: `SKILL.md` 是唯一权威 manifest 输入

每个 Skill source 暴露 Skill 时，必须以该 Skill 根目录下的 `SKILL.md` 作为权威 manifest 输入。Source 可以提供来源身份、trust、availability 或 installation facts；manifest 字段语义由本 contract 统一解释。

### D2: Frontmatter process data 与 descriptor metadata 分离

`SkillFrontmatter` 是 parser 内部过程数据，用于表达从 `SKILL.md` frontmatter 读取到的原始字段和扩展字段。跨模块下游消费 `CapabilityDescriptor`、typed `SkillMetadata` 和 safe diagnostics；raw markdown、raw frontmatter、source-private path 和 provider-private metadata 保持在 source/parser 私有边界内。

### D3: 标准字段保持兼容，受支持扩展必须显式

Manifest contract 支持以下字段类别：

- 标准描述字段：`name`、`description`、`license`、`compatibility`。
- 工具约束字段：`allowed-tools`。
- 受支持顶层扩展：`context`、`agent`、`user-invocable`、`model-invocable`、`model`。
- 受支持通用 metadata：`metadata.version`。
- 受支持 metadata 扩展：`metadata.denied-tools`、`metadata.nextagent.model`、`metadata.nextagent.modelOptions`。
- 兼容 metadata 别名：`metadata.model`。

`metadata` 可以保留非敏感自描述信息。未声明支持的 metadata 字段进入 source metadata 或 safe diagnostic 路径。

官方兼容规则固定为：

- `name` required，1-64 characters，只允许 lowercase alphanumeric 和 hyphen，不允许开头/结尾 hyphen，不允许连续 hyphen。
- 当 source 能提供 safe Skill directory/candidate name 时，`name` 必须与该 safe candidate name 一致。
- `description` required，1-1024 characters。
- `compatibility` 是 optional string，1-500 characters。
- `metadata` 是 optional string-to-string map。
- `allowed-tools` 是 optional space-separated string；解析后进入 tool-name array，重复项按首次出现顺序去重。

### D3a: Skill `name` is the model-visible capability id

For Skill descriptors, the validated Skill `name` maps to `CapabilityDescriptor.capabilityId` and the model-visible display name. The validated Skill `description` maps to `CapabilityDescriptor.description`. `metadata.version`, when present, maps to `CapabilityDescriptor.version`.

Provider identity remains in `CapabilityDescriptor.provider`, Agent capability bindings, catalog governance, conflict resolution, and diagnostics. Provider-qualified ids are not model-visible Skill invocation names. Before model disclosure and invocation, catalog governance must ensure the Agent-visible set contains at most one available Skill descriptor for each Skill `capabilityId`; ambiguous duplicates are resolved, shadowed, skipped, or diagnosed before they reach the model.

### D3b: `description` replaces `safeDescription` in CapabilityDescriptor

This change is the second target-state flow that materially consumes `CapabilityDescriptor`, so it refines the core descriptor contract before more capability kinds depend on the old field name. `CapabilityDescriptor.description` is the public field for model-visible safe capability description. `safeDescription` is not retained as a public descriptor field.

The safety rule does not weaken: descriptor `description` must be bounded, sanitized, and free of secrets, raw paths, raw provider responses, credentials, user input, model input/output, and unsafe metadata. Context/model disclosure consumes `description`.

### D3c: Parser and mapper are reusable `agent-capability` helpers

`agent-capability` owns two reusable helpers for Skill sources:

- a frontmatter parser that consumes only the leading `SKILL.md` frontmatter block or an already extracted frontmatter source;
- a descriptor mapper that consumes validated Skill frontmatter facts and a `CapabilityProvider`, then produces a Skill `CapabilityDescriptor` with typed `SkillMetadata`.

The parser must not require the full markdown body as input. A source-specific file reader may read a bounded leading slice of `SKILL.md` to extract frontmatter. Raw body loading, body-to-context injection, and execution semantics remain in later Skill invocation/context changes.

The mapper derives `capabilityId`, model-visible display name, `description`, `version`, and `SkillMetadata` from the validated frontmatter. Provider identity comes from the provided `CapabilityProvider`; source-private paths, provider-private entry refs, and raw markdown body content do not enter the descriptor. Official `license` and `compatibility` are descriptive Skill source metadata in this change and are not converted into `CapabilityDescriptor.compatibility` unless a later capability governance change defines a typed mapping.

### D4: `context` 只表达 Skill 上下文模式声明

`context` 取值只允许：

- `inline`
- `fork`

缺省为 `inline`。该字段表达 Skill authoring hint 和后续执行策略输入；fork runtime、子 Agent 执行、上下文继承和结果回传语义归后续执行 changes。

`SkillMetadata` MUST preserve the field name `context` for this normalized value, so later inline/fork execution changes have one stable metadata key to consume.

### D4c: `agent` only declares fork Agent selection hint

`agent` is an optional top-level extension. It declares a canonical Agent selection hint for later fork execution changes and parses into `SkillMetadata.agent`.

The accepted value is the existing canonical `AgentId` used by Agent assembly and `AgentAssemblyRegistry.active(agentId)` / `AgentAssemblyRegistry.require(agentId, agentVersion)`. It is not an Agent display name, provider-qualified identifier, source-local alias, or `agentId + agentVersion` pair. Agent version selection and active-version resolution remain owned by Agent assembly and later fork execution governance.

When `agent` is present and `context` is omitted, normalized `context` becomes `fork`. When `agent` is present and `context=inline`, manifest validation rejects the manifest. `agent` never authorizes cross-Agent execution by itself; Agent scope, capability binding, owner scope, availability, policy, invocation authorization, context inheritance, model selection and fork execution remain governed by later execution changes and existing governance.

### D4a: `user-invocable` only gates explicit user selection eligibility

`user-invocable` is an optional top-level extension. When present, it MUST be a boolean and parse into the governed fact `userInvocable`. When omitted, it defaults to `false`.

`userInvocable=true` means the Skill may be exposed as eligible for explicit user-specified execution after normal capability governance accepts it. Capability binding, owner-scope checks, Agent-scope checks, availability, policy, invocation authorization, and model selection remain required. Model/core orchestration eligibility remains governed by its own capability policy.

### D4b: `model-invocable` gates model-orchestrated invocation eligibility

`model-invocable` is an optional top-level extension. When present, it MUST be a boolean and parse into `SkillMetadata.modelInvocable`. When omitted, it defaults to `true`.

`modelInvocable=true` means the Skill may be considered for model/core orchestrated invocation after normal capability governance accepts it. Capability binding, owner-scope checks, Agent-scope checks, availability, policy, invocation authorization, and model selection remain required. Explicit user-specified execution eligibility remains governed by `userInvocable`.

### D5: Tool constraints 是治理输入，不是执行授权

`allowed-tools` 和 `metadata.denied-tools` 使用 Agent Skills compatible space-separated tool-name string 格式，并产生 `SkillMetadata.allowedTools` / `SkillMetadata.deniedTools`。Capability governance、risk policy 和 Agent assembly 继续校验可用性、owner scope、policy 和 binding。Agent 已授权工具集合仍由 capability governance 决定。

### D6: `model` declarations are governed selection hints

Skill 可以通过以下受支持输入声明模型约束或 hint，并归一到 `SkillMetadata.model` / `SkillMetadata.modelOptions`：

- top-level `model`，用于兼容事实标准 Skill frontmatter；
- `metadata.nextagent.model`，用于 NextAgent namespaced metadata 标准扩展；
- `metadata.nextagent.modelOptions`，用于 NextAgent namespaced metadata 标准扩展；
- `metadata.model`，作为旧兼容别名保留。

这些输入可以声明 Skill 偏好的模型约束或 hint。模型声明的安全形态是模型标识和受治理的 `modelOptions`；最终模型选择仍由 context/model selection 和 governance 处理。

模型声明是非权威输入。最终 provider、model、credential、endpoint、provider option、runtime model configuration 和 Agent 默认 model profile 决策必须经过 model/profile governance 校验。

`SkillMetadata` MUST name the normalized model preference `model`. The top-level `model` MAY be a safe model string or a JSON-compatible object with `{ "model": string, "modelOptions": object }`. `metadata.nextagent.model` MUST be a safe model string. `metadata.nextagent.modelOptions` MUST be a safe JSON string object. The compatibility alias `metadata.model` MAY be a safe model string or a safe JSON string object with `model` and `modelOptions`.

If more than one input source declares `model`, the values MUST match or validation MUST reject the manifest. If more than one input source declares `modelOptions`, validation MUST reject the manifest unless the parser can prove the objects are identical after normalization. Thinking depth or reasoning depth MUST be expressed inside `modelOptions` according to the existing model option contract.

### D7: Validation outcome 必须明确

Manifest validation 必须输出明确 outcome：

- accepted：descriptor input 和 typed `SkillMetadata` 可进入 source 输出。
- rejected：必填字段缺失、类型非法、扩展取值非法或包含不安全内容。
- degraded：只有 optional source metadata 无法安全保留，但 descriptor input 和 typed `SkillMetadata` 仍然有效。

Accepted 和 degraded manifest 可向 source 输出 descriptor input 和 typed `SkillMetadata`。Rejected manifest 进入 source skip 路径并产生 safe diagnostic。Degraded manifest 必须为每个被忽略或不可消费的 source metadata 字段留下 safe diagnostic。

| 输入状态 | outcome | descriptor input | diagnostic | 规则 |
|---|---|---|---|---|
| required standard fields valid，supported extensions valid，unknown metadata absent 或可安全保留 | accepted | present | optional empty | unknown metadata 作为 `SkillMetadata.sourceMetadata` 保留，不产生治理效果。 |
| required standard fields valid，supported extensions valid，仅 optional source metadata 因过大、疑似敏感或不可安全保留被省略 | degraded | present | required | 每个被省略 source metadata 字段产生 `SkillManifestDiagnostic`。 |
| 缺失 `SKILL.md`、缺失或非法 `name`/`description`、`name` 与 safe source candidate name 不一致、官方字段 shape 非法、supported extension 非法、不安全 governed value、`agent` 与 `context:inline` 冲突、tool constraint 非法、model 声明冲突、无法生成 descriptor input | rejected | absent | required | candidate 进入 source skip 路径。 |

`SkillManifestDiagnostic.reasonCode` 使用稳定 public code 集：

- `SKILL_MD_MISSING`
- `INVALID_NAME`
- `NAME_MISMATCH`
- `INVALID_DESCRIPTION`
- `INVALID_OFFICIAL_FIELD`
- `INVALID_CONTEXT`
- `INVALID_AGENT`
- `AGENT_REQUIRES_FORK_CONTEXT`
- `INVALID_INVOCABILITY`
- `INVALID_TOOL_CONSTRAINTS`
- `UNSAFE_MODEL_DECLARATION`
- `CONFLICTING_MODEL_DECLARATION`
- `SOURCE_METADATA_OMITTED`
- `DESCRIPTOR_MAPPING_FAILED`

Source-private details 可以用于生成 sanitized message，但跨 package、readiness、audit、structured log 或用户可见诊断必须使用上述 reason code。

### D8: SkillMetadata is the downstream metadata contract

The parser output is descriptor input with typed `SkillMetadata`. Cross-module consumers receive `CapabilityDescriptor`, typed Skill metadata, and safe diagnostics. The public `SkillMetadata` schema/type is owned by `agent-contracts/capability`; parser internals and process data remain implementation-owned by `agent-capability`.

`SkillMetadata` includes a stable discriminator such as `metadataKind: "nextagent.skill"`, `context`, `userInvocable`, `modelInvocable`, optional `agent`, optional `allowedTools`, optional `deniedTools`, optional `model`, optional `modelOptions`, and optional `sourceMetadata`. `sourceMetadata` contains only safe string keys and string values. `name`, `description`, and `metadata.version` are mapped to descriptor fields. `license` and `compatibility` remain descriptive source metadata unless a later capability governance change defines a typed compatibility mapping.

`agent-capability` exposes a public typed accessor/validator that converts `CapabilityDescriptor.metadata` to `SkillMetadata` when `CapabilityDescriptor.kind=SKILL`. Downstream packages consume Skill-specific metadata through this accessor or the public schema validation result.

### D9: Supported metadata extensions parse to typed metadata

`metadata.denied-tools`, `metadata.nextagent.model`, `metadata.nextagent.modelOptions`, and the `metadata.model` compatibility alias preserve Agent Skills metadata compatibility at the input boundary. `metadata.denied-tools` uses the same space-separated tool-name string format as `allowed-tools` and is parsed into `SkillMetadata.deniedTools`. Supported model inputs are parsed into `SkillMetadata.model` and optional `SkillMetadata.modelOptions`.

Invalid JSON, unsupported value shapes, empty tool names, non-string tool names, raw credentials, endpoints, base URLs, provider SDK options, credential references, or provider-private configuration reject the manifest.

### D10: Unknown metadata and markdown body have one safe path

Unknown metadata remains source metadata. Safe string-valued unknown metadata may be preserved as `SkillMetadata.sourceMetadata`; unsafe, too large, or otherwise unsafe-to-preserve unknown metadata is omitted from descriptor metadata and recorded as a degraded safe diagnostic. Non-string metadata keys or values are invalid official frontmatter and reject the manifest. Capability governance, Agent assembly, model selection, routing, policy, sandbox, prompt rendering, availability, and owner-scope decisions consume governed descriptor fields and typed Skill metadata.

The markdown body is authoring content. Manifest validation derives descriptor input and typed `SkillMetadata` from frontmatter. Skill invocation and context injection changes own body loading and model-context injection semantics.

## 主流程（Main Flow）

1. Skill source 定位候选 Skill 的 `SKILL.md`。
2. Source 读取 bounded leading frontmatter block；markdown body 仅作为后续 authoring content 边界。
3. Reusable parser 解析并校验 frontmatter 标准字段和受支持扩展。
4. Reusable mapper 基于 validated frontmatter facts 和 `CapabilityProvider` 生成 Skill descriptor input、typed `SkillMetadata`、validation outcome 和 `SkillManifestDiagnostic[]`，其中 Skill `name` 作为 descriptor `capabilityId`，frontmatter `description` 作为 descriptor `description`，`metadata.version` 作为 descriptor `version`，`agent` 作为 fork Agent selection hint。
5. Skill source 将 accepted descriptor input 交给 capability governance。
6. Capability governance 决定 descriptor、availability、conflict 和 invocation eligibility。

## 状态与产物契约（Artifacts And Lifecycle）

### SkillMetadata

- 语义：从 `SKILL.md` 解析并校验后，进入 `CapabilityDescriptor.metadata` 的 Skill typed metadata。
- ownership：public schema/type 归 `agent-contracts/capability`；parser、mapping 和 typed accessor implementation 归 `agent-capability`。
- 生命周期：随 source discovery / refresh 生成；被 catalog governance 消费。
- 消费方：builtin/local/agent-scoped/SkillHub source、capability governance、Agent assembly、context disclosure，以及需要 Skill metadata 的后续 execution changes。
- 安全限制：只包含已校验的 Skill metadata 字段和安全的 source metadata。

### SkillManifestDiagnostic

- 语义：manifest accepted/rejected/degraded 的 safe reason。
- ownership：public schema/type 归 `agent-contracts/capability`；diagnostic 生成实现归 `agent-capability`。
- 生命周期：随 discovery/refresh 生成；可进入 readiness、audit 或 structured log 的安全诊断摘要。
- 字段：stable reason code（使用 D7 定义的 public code 集）、severity (`INFO` / `WARNING` / `ERROR`)、validation outcome、sanitized message，可选 safe `providerId` 和 safe `skillName`。
- 安全限制：不得包含 raw manifest content、raw markdown body、raw path、endpoint、credential、provider response、user input、model input/output 或 unsafe metadata。

## 失败与降级（Failure And Degradation）

- 缺失 `SKILL.md`：candidate 进入 source skip 路径并产生 safe diagnostic。
- 必填字段缺失或类型非法：manifest rejected。
- `name` 或 `description` 不满足官方长度/格式约束：manifest rejected。
- `name` 与 safe source candidate name 不一致：manifest rejected。
- `compatibility`、`metadata` 或 `allowed-tools` 不满足官方 shape：manifest rejected。
- `context` 取值非法：manifest rejected。
- `agent` 不能解析为 canonical `AgentId`，或 `agent` 与 `context:inline` 同时出现：manifest rejected。
- `user-invocable` 不是 boolean：manifest rejected。
- `allowed-tools` 或 `metadata.denied-tools` 格式非法：manifest rejected。
- `model` / `metadata.nextagent.model` / `metadata.nextagent.modelOptions` / `metadata.model` 含 raw credential 或 provider-private config：manifest rejected。
- 多个模型声明来源冲突：manifest rejected。
- 未支持 metadata 字段：进入 safe source metadata 或 degraded diagnostic 路径；治理决策继续消费 governed descriptor fields 和 typed `SkillMetadata`。

## 验证映射（Verification Map）

- manifest contract scenarios：标准 `SKILL.md` accepted、缺失必填字段 rejected、非法扩展 rejected。
- official compatibility scenarios：`name`、`description`、`compatibility`、`metadata`、`allowed-tools` 按官方 Agent Skills shape 校验。
- descriptor mapping scenarios：Skill `name` 映射为 `CapabilityDescriptor.capabilityId` 和模型可见调用名；`metadata.version` 映射为 `CapabilityDescriptor.version`。
- parser / mapper scenarios：parser 只消费 leading frontmatter block；mapper 从 validated frontmatter facts + `CapabilityProvider` 产出 Skill `CapabilityDescriptor` 和 typed `SkillMetadata`。
- descriptor contract refinement scenarios：`CapabilityDescriptor.description` 替代 `safeDescription`，context/model disclosure 使用 `description`。
- tool constraint scenarios：`allowed-tools` / `metadata.denied-tools` 映射为 `SkillMetadata.allowedTools` / `SkillMetadata.deniedTools` 并作为治理输入。
- agent metadata scenarios：top-level `agent` 按 canonical `AgentId` 校验并归一为 `SkillMetadata.agent`，缺省 context 时将 context 归一为 `fork`，与 `context:inline` 冲突时 rejected。
- diagnostic reason scenarios：manifest rejected/degraded 输出稳定 public reason code，readiness、audit、structured log 或用户可见诊断不得使用 source-private code。
- model metadata scenarios：顶层 `model`、`metadata.nextagent.model`、`metadata.nextagent.modelOptions` 和兼容别名 `metadata.model` 使用安全模型 hint 形态。
- model governance scenarios：模型声明作为 hint，最终模型、profile、provider option 或 runtime model configuration 由 governance 接受后生效。
- source metadata scenarios：capability、routing、model selection、prompt shaping、sandbox、owner scope、policy 和 Agent assembly 消费 governed descriptor fields 和 typed `SkillMetadata`。
- source reuse scenarios：builtin/local/agent-scoped/SkillHub source 复用同一 parser/mapping helper 和 `SkillMetadata` schema。
- strict validation：`openspec validate add-ts-skill-manifest-contract --strict`。

## 开放问题（Open Questions）

无。当前 change 的目标口径固定为“兼容 `SKILL.md` + 受支持扩展 + typed `SkillMetadata` descriptor mapping”。
