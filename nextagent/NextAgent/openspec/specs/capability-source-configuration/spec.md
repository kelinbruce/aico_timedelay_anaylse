# capability-source-configuration Specification

## Purpose

Define the startup-only capability provider user configuration contract: the `nextAgent.system.capability-providers` user-facing configuration path, the user field shape, the closed `type` set, the deterministic startup-time mapping from user entries to `CapabilityProviderConfig`, the safe-diagnostic accumulation rules for invalid entries, and the single two-field `ResolvedCapabilityProviders` output consumed at the app composition boundary. The contract is owned by `agent-contracts/capability` together with the rest of capability configuration vocabulary; this specification only adds user-facing configuration, validation, and resolution rules, and reuses the `CapabilityProviderConfig` shape defined in `capability-catalog/spec.md`. Downstream `agent-capability` converts accepted provider configs into config-driven provider contributions during subsystem assembly; raw user configuration never becomes the framework/reserved provider registry.

## Function

- **所属 Function**：`FN-5.1 管理能力目录`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: Capability provider configuration is loaded and resolved during startup

The system SHALL load and validate `nextAgent.system.capability-providers` user configuration during startup, resolve it into a single `ResolvedCapabilityProviders` value, and consume that resolved value at the app composition boundary. Downstream capability assembly SHALL consume the resolved `CapabilityProviderConfig[]` as config-driven provider contribution input and MUST NOT reparse the raw user configuration.

#### Scenario: Startup produces a resolved capability provider snapshot

- **WHEN** the system starts and reaches ready
- **THEN** user capability provider configuration has been loaded, validated, and resolved into a single `ResolvedCapabilityProviders`
- **AND** downstream capability assembly consumes `ResolvedCapabilityProviders.providers` as config-driven provider contribution input rather than raw user configuration

#### Scenario: Request traffic does not trigger user configuration revalidation

- **WHEN** a user submits a request, resumes a stream, reads history, or sends a runtime control command
- **THEN** the system does not re-run capability provider user configuration validation inside that request lifecycle

### Requirement: User configuration uses intuitive short field names

The user-facing configuration path `nextAgent.system.capability-providers` SHALL hold a flat array of provider entries. The `providers` intermediate object wrapper that previously wrapped the array is removed — the array is the value of the path directly. Each entry in that array SHALL use the following field names:

- `id` (required, non-empty, unique within the providers list)
- `type` (required, must be in the closed kebab-case kind set)
- `url` (required for `mcp-server` and `agent-registry`)
- `credential` (optional for `mcp-server` and `agent-registry`; must use `env:` or `file:` SecretReference grammar)
- `gatewayId` (required for `skill-hub`)
- `installDir` (required for `skill-hub`)
- `adapter` (required for `custom`)
- `config` (optional, JSON object passed through to `custom` providers)

`id` MUST be non-empty and unique within the active provider list. User configuration entry appearing in the providers list SHALL be treated as enabled — there is no `enabled` field. Unknown fields SHALL be rejected by schema validation.

User configuration ids MUST NOT use framework/reserved provider identities owned by startup contributions, including `builtin-tools`, `builtin-skills`, `builtin-agents`, `local-skills-system`, `local-skills-agent-owned`, `local-agents`, `local-subagents`, and `memory-tools`. The resolver SHALL reject such entries with safe diagnostics before they reach `agent-capability` provider contribution assembly.

`skill-hub` provider entries MUST NOT accept `url`, `credential`, endpoint, credential reference, token, tenant/subject private data, raw remote payload or provider-private loading key. Concrete SkillHub service access facts belong to the selected remote gateway adapter or deployment overlay.

#### Scenario: Unknown field is rejected at the schema boundary

- **WHEN** a provider entry includes a field outside the user-facing schema (for example, `providerKind`, `providerType`, `locationRef`, `enabled`, `disabledCapabilityIds`, `customOptions`)
- **THEN** startup MUST reject the configuration before the resolver runs

#### Scenario: Reserved provider id is rejected at the user config boundary

- **WHEN** a user provider entry declares `id="builtin-tools"` or another framework/reserved provider id
- **THEN** the resolver MUST reject that entry with a safe diagnostic
- **AND** `ResolvedCapabilityProviders.providers` MUST NOT contain a config that could override or spoof the reserved provider contribution

#### Scenario: Skill-hub rejects direct service access fields

- **WHEN** a `skill-hub` provider entry includes `url`, `credential`, endpoint, token, tenant/subject private data, raw remote payload or provider-private loading key
- **THEN** startup MUST reject the provider entry at the configuration boundary
- **AND** the diagnostic MUST be safe and MUST NOT echo the raw rejected service access value

### Requirement: Provider type is a closed kebab-case set

`type` MUST be one of:

- `mcp-server`
- `agent-registry`
- `skill-hub`
- `custom`

`local-directory`, `BUNDLED`, `builtin`, or any other value MUST be rejected with `UNSUPPORTED_PROVIDER_TYPE`. `agent-capability` internally creates builtin and reserved local providers; user configuration MUST NOT attempt to control builtin providers, system local Skill sources, Agent-owned local Skill sources, local Agent discovery, or local subagent discovery.

#### Scenario: Unsupported provider type is configured

- **WHEN** a provider entry uses a `type` outside the closed kebab-case set
- **THEN** startup MUST reject that provider entry with `UNSUPPORTED_PROVIDER_TYPE` and surface it as a safe diagnostic
- **AND** the system MUST NOT silently drop the entry

#### Scenario: Builtin-style type values are rejected

- **WHEN** a provider entry uses `type=bundled` or any other non-closed-set value
- **THEN** startup MUST reject that provider entry with `UNSUPPORTED_PROVIDER_TYPE`
- **AND** builtin providers remain controlled exclusively by `agent-capability`

### Requirement: User configuration maps to the internal CapabilityProviderConfig shape

The resolver SHALL transform each user entry into a `CapabilityProviderConfig` from `capability-catalog/spec.md` as follows:

| user `type` | `provider.providerId` | `provider.providerKind` | `provider.providerType` | `discoveryMode` | `options` mapping |
|-------------|----------------------|----------------------|----------------------|-----------------|-------------------|
| `mcp-server` | from `id` | `MCP_SERVER` | - | `SEARCH` | `options.endpoint` = `url`<br>`options.credentialRef` = `credential` (if present) |
| `agent-registry` | from `id` | `AGENT_REGISTRY` | - | `EAGER` | `options.registryRef` = `url`<br>`options.credentialRef` = `credential` (if present) |
| `skill-hub` | from `id` | `SKILL_HUB` | - | `SEARCH` | `options.gatewayId` = `gatewayId`<br>`options.managedInstallRef` = absolute path resolved from `installDir` |
| `custom` | from `id` | `CUSTOM` | required from `adapter` | `EAGER` | `options.customOptions` = `config` (if present) |

> **Transformation rules**:
> 1. `provider.providerId` is copied directly from user `id`
> 2. `provider.providerKind` is derived from user `type` (kebab → SCREAMING_SNAKE)
> 3. `provider.providerType` is required for `CUSTOM` and copied from user `adapter`; omitted for other kinds
> 4. `discoveryMode` is derived from the `providerKind` (no user override)
> 5. `options` fields are mapped based on `providerKind` as shown above
> 6. `installDir` MUST be resolved to an absolute path at startup
> 7. Resolved providers MUST NOT be mutated by request-time code

#### Scenario: User `local-directory` entry is rejected as reserved local source control

- **WHEN** the user configuration contains `{ id: "local-a", type: "local-directory", path: "./capabilities/a" }`
- **THEN** the resolver emits `UNSUPPORTED_PROVIDER_TYPE`
- **AND** `ResolvedCapabilityProviders.providers` does not include that entry
- **AND** the diagnostic does not echo the raw `path`

#### Scenario: User `custom` entry preserves `providerType` and `customOptions`

- **WHEN** the user configuration contains `{ id: "custom-a", type: "custom", adapter: "vendor-a", config: { mode: "test" } }` and `vendor-a` is registered
- **THEN** the resolved provider has `provider.providerType="vendor-a"`, `discoveryMode="EAGER"`, and `options.customOptions={ mode: "test" }`

#### Scenario: Skill-hub maps to gateway-backed provider options

- **WHEN** the user configuration contains `{ id: "hub-a", type: "skill-hub", gatewayId: "skillhub-main", installDir: "./skillhub-managed" }`
- **THEN** the resolved provider has `provider.providerKind="SKILL_HUB"` and `discoveryMode="SEARCH"`
- **AND** `options.gatewayId` is `"skillhub-main"`
- **AND** `options.managedInstallRef` is resolved from `installDir` relative to the configured workspace root
- **AND** the resolved provider options MUST NOT contain `endpoint`, `credentialRef`, concrete URL, token or service-specific wire facts

### Requirement: Custom providers require explicit adapter registration

当 `type=custom` 时，provider entry MUST 包含非空 `adapter`。该 provider 可以贡献 executable descriptor 之前，app composition 边界 MUST 已显式注册匹配的 custom adapter。对于 adapter 未注册的 custom entry，resolver MUST 产生 `CUSTOM_ADAPTER_UNREGISTERED`，并且 MUST NOT 把该 provider 加入 `ResolvedCapabilityProviders.providers`。

模型目录或模型 provider 的装配 MUST NOT 被解释为 custom Capability adapter registration。

**需求类别**：功能性需求

#### Scenario: Custom provider 缺少 adapter

- **WHEN** custom provider entry 未提供 `adapter`
- **THEN** resolver MUST 为该 entry 产生 `MISSING_REQUIRED_FIELD`
- **AND** 该 entry MUST NOT 出现在 `ResolvedCapabilityProviders.providers`

#### Scenario: Custom provider adapter 未注册

- **WHEN** custom provider entry 提供了 `adapter`，但没有匹配的 app-level adapter registration
- **THEN** resolver MUST 产生 `CUSTOM_ADAPTER_UNREGISTERED`
- **AND** 该 entry MUST NOT 出现在 `ResolvedCapabilityProviders.providers`

#### Scenario: 模型 provider 已装配

- **WHEN** 模型目录已装配 compatible 或 Gateway provider
- **THEN** 该事实不自动注册同名 custom Capability adapter

### Requirement: Provider references and credentials are validated during startup

Active provider entries MUST validate their configured references during startup. `mcp-server` and `agent-registry` MUST validate configured `url` and optional `credential`. `skill-hub` MUST validate configured `gatewayId` and `installDir`, and MUST NOT validate or require a direct service URL or credential. Required active references MUST NOT be deferred to the first request.

The resolver MUST consume app-provided predicates for credential, URL, install-directory path normalization, and provider adapter registration. SkillHub `installDir` path normalization MUST use the configured workspace root so remote Skill managed content is placed under the runtime workspace area; this MUST NOT change how `mcp-server` or `agent-registry` `file:` credential references are resolved. Concrete SkillHub URL and credential validation belongs to the selected remote gateway adapter or deployment overlay, not to the user-facing capability provider resolver.

#### Scenario: Active credential reference is invalid

- **WHEN** an active provider requires a credential reference that is missing, malformed, or not resolvable
- **THEN** the resolver MUST emit `INVALID_CREDENTIAL_REFERENCE`
- **AND** the system MUST NOT expose raw secret content, unresolved file content, or adapter-native exception text

#### Scenario: Active URL reference is invalid

- **WHEN** an active provider's `url` is missing, malformed, or rejected by the app's `isUrlResolvable` predicate
- **THEN** the resolver MUST emit `INVALID_URL`

#### Scenario: Active skill-hub gateway reference is missing

- **WHEN** an active `skill-hub` provider omits `gatewayId` or uses a blank value
- **THEN** the resolver MUST emit `MISSING_REQUIRED_FIELD`
- **AND** `ResolvedCapabilityProviders.providers` MUST NOT contain that provider

#### Scenario: Active skill-hub install directory is missing

- **WHEN** an active `skill-hub` provider's `installDir` is missing or blank
- **THEN** the resolver MUST emit `MISSING_REQUIRED_FIELD`
- **AND** `ResolvedCapabilityProviders.providers` MUST NOT contain that provider

### Requirement: Empty or partially invalid user config never blocks startup

The resolver MUST return `ResolvedCapabilityProviders` for any input — including `undefined`, an empty `[]`, and inputs where every entry is invalid. The system MUST NOT throw at the resolver boundary. Builtin providers created by `agent-capability` are always present regardless of user configuration.

#### Scenario: User config is absent

- **WHEN** `nextAgent.system.capability-providers` is absent or the array is empty
- **THEN** the resolver returns `{ providers: [], diagnostics: [] }`
- **AND** the system continues startup with builtin providers only

#### Scenario: Every user entry is invalid

- **WHEN** every entry in the user providers list fails validation
- **THEN** the resolver returns an empty `providers` array and a non-empty `diagnostics` array
- **AND** the resolver MUST NOT throw
- **AND** the system continues startup with builtin providers only

### Requirement: Validation follows deterministic rule order

The resolver MUST apply rules in the following order for each user entry:

1. validate `id` is a non-empty string
2. validate `id` is unique within the providers list
3. validate `type` is in the closed kebab-case kind set
4. validate type-specific required fields
5. validate `url` / `installDir` / `adapter` shape
6. validate `credential` SecretReference grammar
7. consult app-provided predicates (`isUrlResolvable`, `isCredentialReferenceResolvable`, `isProviderAdapterRegistered`) and normalize `installDir` when applicable
8. map the entry to a `CapabilityProviderConfig` and append to `providers`

Invalid entries MUST accumulate as diagnostics in input order; the resolver MUST NOT abort on the first failure.

#### Scenario: Multiple validation errors accumulate in input order

- **WHEN** the user configuration contains three invalid entries (missing `adapter`, invalid URL, missing `installDir`)
- **THEN** `ResolvedCapabilityProviders.diagnostics` contains three diagnostic records, in the same order as the user entries
- **AND** `ResolvedCapabilityProviders.providers` is empty
- **AND** the resolver does not throw

### Requirement: Resolver output has a single 2-field shape

Successful resolver output SHALL be a single `ResolvedCapabilityProviders` containing:

- `providers`: the validated `CapabilityProviderConfig[]` ready to be consumed by `agent-capability`
- `diagnostics`: safe, read-only diagnostic records containing `reasonCode` / `severity` / `message` / optional `providerId`

The output MUST NOT include a `readinessState`, `frozenAt`, `disabled` list, `disabledCapabilityIdsByProviderId` map, or any other parallel frozen artifact.

#### Scenario: Resolver output shape is exactly 2 fields

- **WHEN** the resolver returns successfully
- **THEN** the returned object exposes exactly the keys `providers` and `diagnostics`
- **AND** downstream consumers SHALL derive `providerIds` from `providers`
- **AND** downstream consumers SHALL derive failed entries from `diagnostics`

### Requirement: Capability provider configuration flow integrates with downstream composition boundaries

The capability provider configuration flow SHALL connect startup to:

- capability contribution assembly (`agent-capability` consumes `ResolvedCapabilityProviders.providers` and converts accepted configs into config-driven provider contributions)
- Agent assembly capability binding resolution
- readiness and health diagnostics (consumes `ResolvedCapabilityProviders.diagnostics`)

No downstream module MAY create a competing app-level provider configuration state machine or a request-time fallback path that bypasses the startup resolver result.

#### Scenario: Agent assembly consumes the resolved providers, not raw user configuration

- **WHEN** Agent assembly resolves enabled capability bindings for an Agent
- **THEN** it MUST consume downstream capability provider facts, discovery, or catalog results derived from config-driven provider contributions assembled from `ResolvedCapabilityProviders.providers`
- **AND** it MUST NOT interpret raw user provider configuration directly

### Requirement: Capability provider diagnostics stay safe and non-business

Capability provider validation artifacts are startup artifacts, not request lifecycle facts. They MUST NOT become canonical runtime timeline facts, request history, checkpoint payloads, pending input records, memory records, or user-visible conversation content.

#### Scenario: Provider diagnostics remain operator-facing only

- **WHEN** the system surfaces capability provider diagnostics through readiness, health, or startup evidence
- **THEN** those diagnostics MUST remain operator-facing safe diagnostics
- **AND** they MUST NOT be appended as user-visible chat messages or request terminal messages
- **AND** diagnostic messages MUST NOT echo `path`, `url`, `credential`, or `config` values supplied by the user

### Requirement: CapabilityDescriptor 提供统一本地化展示事实

`CapabilityDescriptor` MUST 保留既有 required、非 `null` 的 stable `displayName`，并 MUST 支持 optional、非 `null` 的 `locales`。`locales` 存在时 MUST 具有以下公共结构：

```ts
interface LocalizedCapabilityContent {
  readonly displayName: string;
}

interface CapabilityLocales {
  readonly language: Readonly<Record<string, LocalizedCapabilityContent>>;
}
```

**需求类别**：功能性需求

`locales.language` MUST 是包含至少一个 own entry 的 locale tag 到展示内容只读 map。locale tag MUST 包含 2 至 35 个 ASCII 字符并匹配 `^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$`。每个 `displayName` MUST 是 trim 后 1 至 256 个 Unicode code point、且不含 Unicode control character 的纯文本字符串。公共 runtime schema MUST 拒绝 `null`、数组、unknown content field、非法 tag、空 map、空白名称、超长名称或包含 control character 的名称；系统 MUST NOT 通过静默删除非法字段接受 descriptor。

本 change 的完整产品验收 locale MUST 是 `zh-CN` 和 `en-US`。公共结构 MUST 接受满足相同 grammar 的其他 locale tag，并 MUST NOT 把支持语言限制为固定枚举；其他 locale 被 schema 接受 MUST NOT 被解释为对应语言的完整产品资源已经交付。

`locales` MUST NOT 参与 Capability identity、availability、binding、conflict resolution、Provider priority、搜索匹配、Skill acquisition、model visibility、input/output schema、invocation routing、权限或审计。Stable `displayName` MUST 保留其既有消费者语义。Catalog MUST 先按既有规则选择 winner，再保留 winner 自身的 `displayName/locales`；系统 MUST NOT 在 candidates 之间合并、补充或覆盖名称。

Tool authoring MUST 把 optional stable `displayName` 和 optional `locales` 投影到 Tool descriptor，并 MUST 在 stable `displayName` 缺失时使用 canonical Tool `name`。Agent package MUST 把 `AgentAssembly.displayName/locales` 投影到 Agent descriptor。Workflow Recipe MUST 把 `RecipeDefinition.displayName/locales` 投影到 Workflow descriptor。Skill Provider MUST 把既有 `metadata.zh-name`、`metadata.en-name` 分别投影到 `zh-CN`、`en-US`，并 MUST 继续使用 Skill `name` 作为 stable `displayName`。Provider 未提供 `locales` 时 MUST 省略该字段，且 MUST NOT 降低 Capability 可用性。

#### Scenario: Provider 提供中英文展示名称

- **WHEN** 任一 Provider 产生同时包含合法 `zh-CN`、`en-US` 名称的 descriptor
- **THEN** 公共 runtime schema MUST 接受该 descriptor
- **AND** Catalog winner MUST 保留 stable `displayName` 和 winner 自身的两种名称

#### Scenario: Provider 不提供本地化名称

- **WHEN** Provider 产生不含 `locales` 且满足全部既有约束的 descriptor
- **THEN** 公共 runtime schema MUST 接受该 descriptor
- **AND** Capability 的目录可见性、搜索、执行、权限和审计结果 MUST 保持既有语义

#### Scenario: 合法其他 locale 保持开放

- **WHEN** Provider 产生包含合法 `fr-FR` 名称的 descriptor
- **THEN** 公共 runtime schema MUST 接受并保留该名称
- **AND** 系统 MUST NOT 据此声称法语产品资源已经完整交付

#### Scenario: 非法展示事实被拒绝

- **WHEN** descriptor 的 `locales.language` 为空、包含非法 locale tag、unknown content field 或非法 `displayName`
- **THEN** 公共 runtime schema MUST 拒绝完整 descriptor
- **AND** 非法名称 MUST NOT 进入 Catalog 或 presentation resource query

#### Scenario: Catalog 只保留治理胜出者名称

- **GIVEN** 同一 Capability identity 的两个 candidates 提供不同合法名称
- **WHEN** Catalog 选择并返回唯一 winner
- **THEN** winner MUST 只包含自身的 `displayName/locales`
- **AND** loser 的任一名称 MUST NOT 进入 winner

#### Scenario: Tool stable displayName 保留现有消费者语义

- **GIVEN** Tool authoring 同时提供 canonical `name` 和不同的 stable `displayName`
- **WHEN** Provider 产生 Tool descriptor
- **THEN** Tool identity 和模型调用名称 MUST 使用 canonical `name`
- **AND** 既有读取 descriptor stable `displayName` 的目录或搜索结果 MUST 使用该 stable `displayName`

### Requirement: Capability current view 只读取当前受治理事实

系统 MUST 提供可取消的 `CapabilityDiscovery.listCurrent` current-read contract 和 `CapabilityCurrentViewPort`。`listCurrent` MUST 是 SEARCH Provider 的 optional operation；criteria MUST 只包含 trusted Owner Scope、required Session Scope、Agent identity/version/assembly reference，MUST NOT 包含 locale、搜索文本、requested identity、model-invocable filter 或客户端 metadata。

**需求类别**：功能性需求

`CapabilityCurrentViewPort` MUST 在同一 current Agent Assembly 下组合 EAGER Provider 的已加载 descriptors 与 SEARCH Provider 的 current-read descriptors，并 MUST 复用既有 Agent binding、disabled、availability、Provider priority 和 conflict resolution。结果 MUST 包含当前 scope 下全部 available winners，MUST NOT 按 model visibility 排除 wrapper target，MUST NOT 包含 loser 或 unavailable candidate，MUST NOT 创建第二个 Catalog、第二套 conflict resolver 或名称 registry。

EAGER Provider 的 current facts MUST 来自既有启动期已验证 descriptor 集合。SEARCH Provider 的 `listCurrent` MUST 只读取当前本地、已生成或已安装的 descriptor facts。SkillHub current-read MUST 只读取 installed index 和已安装 manifest。`listCurrent` MUST NOT 调用 Provider `search`，MUST NOT 访问远端 candidate service，MUST NOT 同步、下载、安装、更新索引、读取 Skill 正文、创建或删除文件、修改 workspace 或产生其他业务副作用。

`listCurrent` MUST 返回完整通过 descriptor schema 校验的 `CapabilityDescriptor` 数组。Current source 对能够明确归属于单个资源的缺失、读取、解析、descriptor schema 校验或一致性失败 MUST 跳过该资源；失败资源 MUST NOT 形成 descriptor 或进入 Catalog。Source MUST 为被跳过资源记录不含清单正文、credential、token 或内部路径的安全、有界 operational diagnostic。

其他合法 descriptors MUST 继续返回并按既有 governance 形成 winners。Catalog MUST NOT 为被跳过资源保留或抑制 conflict group；若高优先级同名资源未形成合法 descriptor，合法低优先级资源 MUST 继续按既有 binding、availability、Provider priority 与 conflict resolution 参与治理。

未配置的 optional source、locator 明确返回 `not-found`，或 optional Skill root 读取明确返回 `ENOENT`，MUST 表示该 source 当前完整为空，MUST NOT 被误报为读取失败。任一当前 scope 下应参与治理的 SEARCH Provider 未实现 `listCurrent`，已经配置并参与 current-read 的 source/root/index/registry/locator operation 除上述 `ENOENT` 外整体不可读、返回 invalid 或抛错，Provider 整体超时或取消，返回非法 descriptor 数组，或者 EAGER current facts 不完整时，`CapabilityCurrentViewPort` MUST 使本次完整读取失败。系统 MUST NOT 把上述 source-level failure 转换为空成功或部分成功。

#### Scenario: current view 返回当前 winners

- **GIVEN** 当前 Session Agent Scope 包含 EAGER Tool、local Skill、installed SkillHub Skill、Agent 和 Workflow candidates
- **WHEN** 调用方请求 Capability current view
- **THEN** 结果 MUST 返回当前 available winners
- **AND** 结果 MUST 使用与现有 Catalog 相同的 binding、availability、priority 和 conflict verdict

#### Scenario: presentation read 不触发远端 Skill 获取

- **WHEN** SkillHub 远端存在尚未安装的 Skill，且调用方请求 Capability current view
- **THEN** current view MUST NOT 查询、下载或安装该远端 Skill
- **AND** 该 Skill MUST NOT 在安装完成前进入 current view

#### Scenario: runtime-generated 新 identity 可被当前读取发现

- **GIVEN** 当前 Session Scope 已发布一个新的 runtime-generated Skill descriptor
- **WHEN** 后续 current view 读取该 Session Scope
- **THEN** 结果 MUST 可以包含该 Skill winner
- **AND** 系统 MUST NOT 要求生成临时语言文件或重启 Web channel

#### Scenario: 单个非法 current 资源不影响其他合法资源

- **GIVEN** 一个参与治理的 SEARCH Provider 包含 manifest schema 校验失败的 Skill `invalid-skill`
- **AND** 当前 scope 还包含其他合法资源
- **WHEN** 调用方请求 Capability current view
- **THEN** `invalid-skill` MUST 不形成 descriptor且不进入结果
- **AND** 其他合法资源 MUST 继续返回按既有规则确定的 winners
- **AND** source MUST 记录该资源失败的安全、有界 operational diagnostic

#### Scenario: 非法高优先级资源不抑制合法低优先级资源

- **GIVEN** 一个高优先级资源与一个低优先级合法资源使用相同 `capabilityId`
- **AND** 高优先级资源在 current-read 中读取、解析、schema 校验或一致性校验失败，因而未形成 descriptor
- **WHEN** 调用方请求 Capability current view
- **THEN** Catalog MUST 只治理已形成的合法 descriptors
- **AND** 低优先级合法资源 MUST 按既有规则成为 winner

#### Scenario: 单个 SkillHub installed manifest 异常不影响其他已安装 Skill

- **GIVEN** installed index 整体可读，且其中一个 Skill manifest 缺失、非法或与安装时 hash 不一致
- **AND** 同一 index 中还包含其他合法已安装 Skill
- **WHEN** 调用方请求 Capability current view
- **THEN** 异常 Skill MUST 被跳过
- **AND** 其他合法已安装 Skill MUST 继续参与既有 Catalog governance

#### Scenario: current source 不完整时整体失败

- **WHEN** 当前 scope 下任一应参与的 SEARCH Provider 缺少 `listCurrent`，或者已经配置并参与 current-read 的 source/root/index/registry/locator operation 除 optional Skill root `ENOENT` 外整体不可读、返回 invalid、抛错、超时、取消，Provider 返回非法 descriptor 数组或 EAGER current facts 不完整
- **THEN** 本次 `CapabilityCurrentViewPort` 调用 MUST 失败
- **AND** 调用方 MUST NOT 获得部分 winner 或空成功结果

### Requirement: Session Capability 展示资源查询返回安全 current projection

系统 MUST 提供 `GET /api/v1/sessions/:sessionId/capability-presentation-resources`。该接口 MUST 使用 Web channel 形成的 trusted `IdentityContext` 和 path `sessionId` 校验 Owner Scope，并 MUST 从已校验 Session 取得 trusted `agentId`。HTTP 请求 MUST 拒绝 body 以及 query 中的 locale、agentId、Provider selector 或其他未知字段；header 或 metadata 中的 Agent 候选 MUST NOT 覆盖 Session-bound Agent Scope。

**需求类别**：功能性需求

内部 `CapabilityPresentationResourceQueryRequest` MUST 包含 trusted `identityContext`、`sessionId` 和从 Session 得到的 trusted `agentId`。Query MUST 使用该 Agent 的 current active assembly 调用 `CapabilityCurrentViewPort`。每个 `CapabilityPresentationResource` MUST 只包含 `capabilityKind`、`capabilityId`、stable `displayName` 和 optional `locales`；响应 MUST NOT 包含 description、input/output schema、metadata、Provider identity/config、binding、治理证据、credential、token、文件路径、执行参数、执行结果、原始错误或 audit fact。

结果 MUST 按 `capabilityKind + capabilityId` 的确定顺序返回，并 MUST 在同一响应中返回每个合法 winner 的全部合法语言资源。接口 MUST NOT 静默截断合法 winners。Current view、Assembly 或 Session dependency 整体不可用、超时、取消或返回非法结果时，接口 MUST 返回不包含内部细节的 safe failure，MUST NOT 返回空成功列表或 source-level failure 发生后的部分 projection。查询 MUST NOT 写入 Gateway、数据库、timeline、history、stream event、Runtime Bootstrap 或浏览器语言文件。

#### Scenario: 已授权 Session 取得安全展示资源

- **GIVEN** 当前 Session 的 Agent Scope 包含 Builtin Tool、扩展 Tool、Agent、Skill 和 Workflow winners
- **WHEN** Session owner 请求 Capability presentation resources
- **THEN** 响应 MUST 按确定顺序包含这些 winners 的 identity、stable `displayName` 和 optional `locales`
- **AND** 响应 MUST NOT 包含非展示字段、loser 或 unavailable candidate

#### Scenario: 客户端不能覆盖可信范围

- **WHEN** 客户端尝试通过 query 或 body 指定其他 Owner、Agent、Provider 或未知字段
- **THEN** Web input boundary MUST 拒绝不属于公共 contract 的输入
- **AND WHEN** header 或 metadata 中存在其他 Agent 候选
- **THEN** 查询 MUST 继续只使用已校验 Session 的 `agentId`
- **AND** 响应 MUST NOT 暴露其他 Owner Scope、Agent Scope 或 candidate 的名称

#### Scenario: 展示资源依赖失败

- **WHEN** Session、Assembly 或 Capability current view 不可用、超时、取消或返回非法结果
- **THEN** 接口 MUST 返回 safe failure
- **AND** 响应 MUST NOT 包含空成功列表、部分 projection、Provider 原始错误或内部路径

#### Scenario: 展示资源隔离单资源异常

- **GIVEN** current source 已跳过一个未能形成 descriptor 的异常资源，并成功返回其他合法 descriptors
- **WHEN** Session owner 请求 Capability presentation resources
- **THEN** 接口 MUST 成功返回其他合法 winners
- **AND** 响应 MUST NOT 包含异常资源、source diagnostic、Provider identity 或内部错误
