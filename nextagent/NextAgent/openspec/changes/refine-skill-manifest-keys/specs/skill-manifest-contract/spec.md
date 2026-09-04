# skill-manifest-contract Delta Specification

## Function

- **所属 Function**：`FN-5.8 发现技能`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Skill Manifest Diagnostic Reason Code Set Covers Removed Model Conflict Path

The public `SkillManifestDiagnostic` reason code set MUST keep `CONFLICTING_MODEL_DECLARATION` reserved for a future multi-input model declaration conflict path. Because this change reduces model declarations to a single `model` input (top-level model name string) and a single `modelOptions` input (`metadata.modelOptions`), current manifest validation MUST NOT emit `CONFLICTING_MODEL_DECLARATION`; manifest validation rejections in the model declaration path MUST use `UNSAFE_MODEL_DECLARATION` or `INVALID_OFFICIAL_FIELD`.

**需求类别**：功能性需求

#### Scenario: 冲突 reason code 保留但当前不可触发

- **WHEN** 一个 Skill manifest 声明任意受支持的 model 声明组合
- **THEN** manifest validation MUST NOT 产生 `CONFLICTING_MODEL_DECLARATION` reason code
- **AND** 模型声明路径的拒绝诊断 MUST 仅使用 `UNSAFE_MODEL_DECLARATION` 或 `INVALID_OFFICIAL_FIELD`

## MODIFIED Requirements

### Requirement: Model Declarations Are Governed Model Hints

The system MUST treat all supported Skill model declarations as governed model hint inputs rather than provider configuration.

The Skill manifest MAY provide a safe model preference or constraint fact through these supported inputs:

- top-level `model`
- `metadata.modelOptions`

Top-level `model` MUST be a safe model name string only; a JSON object value or any non-string value MUST be rejected. `metadata.modelOptions` MUST be a safe JSON string object parsed through the governed model inference option contract and MUST NOT carry a `model` identifier.

`metadata.nextagent.model` and `metadata.nextagent.modelOptions` MUST NOT be treated as governed model declaration inputs. The metadata key `model` MUST NOT be treated as a model declaration alias; when present with a safe string value it MUST be preserved as string source metadata without governed model meaning.

After parsing, downstream consumers MUST see typed `SkillMetadata.model` and optional `SkillMetadata.modelOptions`. Model declarations MUST be safe model hints consisting of a model identifier and governed model options. Final model selection remains owned by model/context governance.

Model declarations MUST be non-authoritative. Final provider, model, credential, endpoint, provider option, runtime model configuration, and Agent default model profile decisions require model/profile governance validation.

Thinking depth or reasoning depth MUST be represented inside `modelOptions` according to the existing model option contract.

Because the `model` identifier can only be declared through top-level `model` and inference options only through `metadata.modelOptions`, conflicting model declarations MUST NOT occur; a manifest that previously relied on removed inputs or the removed top-level JSON object form MUST be rejected or migrated rather than silently reinterpreted.

**需求类别**：功能性需求

#### Scenario: 顶层 model 字符串仍是受治理 model hint

- **WHEN** 一个合法 Skill manifest 声明顶层 `model` 为安全模型名字符串
- **THEN** manifest validation MUST 接受该 manifest
- **AND** 归一后的 Skill metadata MUST 设置 `SkillMetadata.model` 为该模型名

#### Scenario: 顶层 model JSON 对象形态被拒绝

- **WHEN** 一个 Skill manifest 声明顶层 `model` 为 JSON 对象字符串或 YAML 对象
- **THEN** manifest validation MUST 拒绝该 manifest
- **AND** 诊断 MUST 使用 `UNSAFE_MODEL_DECLARATION` reason code

#### Scenario: metadata.modelOptions 声明受治理推理参数

- **WHEN** 一个合法 Skill manifest 声明 `metadata.modelOptions` 为可解析的安全 JSON 字符串对象
- **THEN** manifest validation MUST 接受该 manifest
- **AND** 归一后的 Skill metadata MUST 设置 `SkillMetadata.modelOptions` 为解析后的对象

#### Scenario: metadata.modelOptions 携带 model 标识符被拒绝

- **WHEN** `metadata.modelOptions` 解析后的 JSON 对象包含 `model` 键
- **THEN** manifest validation MUST 拒绝该 manifest
- **AND** 诊断 MUST 使用 `UNSAFE_MODEL_DECLARATION` reason code

#### Scenario: 移除的 nextagent 声明键不再获得治理语义

- **WHEN** 一个 Skill manifest 声明 `metadata.nextagent.model` 或 `metadata.nextagent.modelOptions`
- **THEN** manifest validation MUST 接受该 manifest
- **AND** 这些键 MUST NOT 贡献 `SkillMetadata.model` 或 `SkillMetadata.modelOptions`
- **AND** 安全字符串值 MUST 作为 string source metadata 保存进 `SkillMetadata.sourceMetadata`

#### Scenario: metadata.model 回归 source metadata

- **WHEN** 一个合法 Skill manifest 声明 `metadata.model` 为安全字符串
- **THEN** manifest validation MUST 接受该 manifest
- **AND** 该键值 MUST 作为 string source metadata 保存进 `SkillMetadata.sourceMetadata`
- **AND** 归一后的 Skill metadata MUST NOT 因此设置 `SkillMetadata.model` 或 `SkillMetadata.modelOptions`

#### Scenario: 模型名与推理参数归一为单一 model hint

- **WHEN** 一个合法 Skill manifest 同时声明顶层 `model` 模型名字符串和 `metadata.modelOptions`
- **THEN** manifest validation MUST 接受该 manifest
- **AND** 归一后的 Skill metadata MUST 同时包含 `SkillMetadata.model` 和 `SkillMetadata.modelOptions`

#### Scenario: Unsafe model metadata is rejected

- **WHEN** a supported model declaration contains raw credential material or provider-private connection configuration
- **THEN** manifest validation MUST reject the manifest
- **AND** downstream outputs MUST contain only a safe diagnostic reason

#### Scenario: Invalid model metadata shape is rejected

- **WHEN** a supported model declaration has an invalid shape for a safe model name string or a safe JSON string object of governed model options
- **THEN** manifest validation MUST reject the manifest
- **AND** downstream governance decisions MUST receive only the rejected validation outcome and safe diagnostics

#### Scenario: Model metadata remains a hint until governance accepts it

- **WHEN** a Skill manifest declares a supported model input
- **THEN** the system MUST expose it as safe Skill model metadata
- **AND** model/profile governance MUST validate any final provider, model, profile, option, or runtime model configuration decision before use
- **AND** Agent assembly model profiles and runtime settings remain the authoritative source until governance accepts a request/run-level model decision

#### Scenario: Top-level model and NextAgent metadata normalize to the same Skill metadata

- **WHEN** one Skill declares top-level `model` and another equivalent Skill declares `metadata.nextagent.model` with optional `metadata.nextagent.modelOptions`
- **THEN** both manifests MUST normalize to the same `SkillMetadata.model` and optional `SkillMetadata.modelOptions` shape
- **AND** downstream consumers MUST receive the same typed Skill metadata for both input forms

#### Scenario: Conflicting model declarations are rejected

- **WHEN** a Skill manifest declares conflicting `model` or `modelOptions` values through multiple supported model inputs
- **THEN** manifest validation MUST reject the manifest
- **AND** the Skill candidate MUST enter the source skip path with safe diagnostics

### Requirement: allowed-tools And disallowed-tools Are Tool Constraint Facts

The top-level `allowed-tools` and `disallowed-tools` fields, when present, MUST parse into `SkillMetadata.allowedTools` and `SkillMetadata.deniedTools`. Both values MUST use the same configuration form: a whitespace-separated tool-name string or a non-empty string array (YAML block list or inline list), parsed through the same tool constraint rules (tool name pattern, empty-name handling, first-occurrence deduplication). These fields produce tool constraint metadata for capability governance. Tool execution rights remain determined by capability governance, Agent assembly, owner scope, and policy.

The metadata key `denied-tools` MUST NOT be treated as a governed tool constraint input; when present with a safe string value it MUST be preserved as string source metadata without governed meaning, per the `Unknown metadata Does Not Carry Governed Meaning` requirement.

**需求类别**：功能性需求

#### Scenario: Tool constraints feed authorization governance

- **WHEN** a Skill manifest declares `allowed-tools` or `disallowed-tools`
- **THEN** the system MUST expose those values as typed Skill tool constraint metadata
- **AND** capability governance and Agent assembly MUST still enforce availability, binding, owner scope, and policy checks

#### Scenario: disallowed-tools 使用与 allowed-tools 一致的配置形态

- **WHEN** 一个 Skill manifest 声明顶层 `disallowed-tools` 为空格分隔字符串或字符串数组
- **THEN** manifest validation MUST 接受该 manifest
- **AND** 解析规则（工具名 pattern、空名处理、首现去重）MUST 与 `allowed-tools` 完全一致
- **AND** 归一后的 Skill metadata MUST 设置 `SkillMetadata.deniedTools`

#### Scenario: Invalid tool constraint shape is rejected

- **WHEN** `allowed-tools` or `disallowed-tools` has an invalid shape, contains non-string values, or contains empty tool names
- **THEN** manifest validation MUST reject the manifest

#### Scenario: 移除的 metadata.denied-tools 键不再获得治理语义

- **WHEN** 一个 Skill manifest 声明 `metadata.denied-tools`
- **THEN** manifest validation MUST 接受该 manifest
- **AND** 该键 MUST NOT 贡献 `SkillMetadata.deniedTools`
- **AND** 安全字符串值 MUST 作为 string source metadata 保存进 `SkillMetadata.sourceMetadata`

### Requirement: Skill Manifest Supports Standard And Supported Extension Frontmatter Fields

The system MUST support standard Skill manifest frontmatter fields compatible with Agent Skills `SKILL.md` usage and the explicitly supported extension frontmatter fields defined by this change:

- `name`
- `description`
- optional `license`
- optional `compatibility`
- optional `allowed-tools`
- optional `disallowed-tools`
- optional `context`
- optional `agent`
- optional `user-invocable`
- optional `model-invocable`
- optional `model`
- optional `metadata`

The listed fields MUST be sufficient to describe a Skill before any source-specific execution concerns are applied. Manifest parsing MUST load only this governed field set: a top-level key outside this set MUST be ignored without rejection, without governed meaning, and without being preserved into Skill metadata, so that manifests carrying additional authoring or ecosystem fields remain loadable.

The `name` field MUST be present and MUST be a non-empty string with 1-64 characters, lowercase alphanumeric characters and hyphens only, no leading or trailing hyphen, and no consecutive hyphens. When the Skill source knows the containing Skill directory or source candidate name, validated `name` MUST match that safe directory/candidate name or validation MUST reject the manifest. `description` MUST be present, MUST parse to a non-empty safe string, MAY be expressed as a YAML literal or folded block scalar, and MUST describe what the Skill does and when to use it. The description length limit MUST be script-dependent: when the description contains Han-script (Chinese) characters the limit is 1024 characters; when the description contains no Han-script characters the limit is 4096 characters. `license`, when present, MUST be a string. `compatibility`, when present, MUST be a string with 1-500 characters. `allowed-tools` and `disallowed-tools`, when present, MUST each be a space-separated string of tool names or a non-empty string array, parse into a string array through the same tool constraint rules, and deduplicate tool names with first occurrence order preserved. `metadata`, when present, MUST be a mapping of string keys to safe string values, except that the source metadata keys `exclusiveWith`, `compatibleWith`, and `tags` MAY use a non-empty array of safe non-empty string values. These array values MUST be accepted in YAML block list form and YAML inline list form. `context`, when present, MUST be `inline` or `fork`. `agent`, when present, MUST parse as the canonical `AgentId` used by the existing Agent assembly contract and `AgentAssemblyRegistry` lookup; it MUST NOT be a display name, provider-qualified id, or `agentId + agentVersion` pair. `user-invocable` and `model-invocable`, when present, MUST be booleans. `model`, when present, MUST parse as a safe model name string.

**需求类别**：功能性需求

#### Scenario: Standard manifest fields are accepted

- **WHEN** the system validates a Skill manifest with standard fields and valid supported extensions
- **THEN** it MUST produce a governed Skill descriptor input
- **AND** the descriptor metadata MUST be usable by builtin, local, agent-scoped, and SkillHub source flows

#### Scenario: 未知顶层字段被忽略而不拒绝

- **WHEN** 一个 Skill manifest 在受治理顶层字段之外声明了额外顶层键（如生态或编写工具生成的字段）
- **THEN** manifest validation MUST 接受该 manifest
- **AND** 额外顶层键 MUST NOT 获得任何治理语义
- **AND** 额外顶层键 MUST NOT 被保存进 Skill metadata 或 sourceMetadata

#### Scenario: disallowed-tools 顶层键被接受

- **WHEN** a Skill manifest provides top-level `disallowed-tools` as a whitespace-separated string or string array of valid tool names
- **THEN** manifest validation MUST accept the field shape
- **AND** the value MUST map to `SkillMetadata.deniedTools`

#### Scenario: description 长度上限按文种区分

- **WHEN** 一个 Skill manifest 的 `description` 不含 Han script（中文）字符且长度不超过 4096 字符
- **THEN** manifest validation MUST 按纯英文上限接受该 description
- **WHEN** 一个 Skill manifest 的 `description` 含任意 Han script 字符（含中英混排）且长度超过 1024 字符
- **THEN** manifest validation MUST 拒绝该 manifest 并使用 `INVALID_DESCRIPTION` reason code

#### Scenario: Invalid standard fields are rejected

- **WHEN** a Skill manifest omits `name`, omits `description`, provides an invalid `name`, provides a `name` that does not match the safe source candidate name when one is available, provides an empty or too long `description`, provides a `description` that cannot parse to a safe string, provides non-string `license` or `compatibility`, provides too long `compatibility`, provides non-string `allowed-tools` or `disallowed-tools`, provides non-string metadata keys, provides non-string metadata values for keys other than `exclusiveWith`, `compatibleWith`, or `tags`, provides non-array values for supported array metadata keys when they are not strings, provides empty arrays or array metadata containing non-string or empty elements, provides non-boolean `user-invocable`, provides non-boolean `model-invocable`, provides invalid `agent`, provides invalid `model`, or provides tool constraints with empty non-whitespace tool names
- **THEN** manifest validation MUST reject the manifest
- **AND** the Skill candidate MUST enter the source skip path with safe diagnostics

#### Scenario: Official Agent Skills field shape is accepted with matching source name

- **WHEN** a Skill manifest provides required `name` and `description`, optional `compatibility`, optional string-to-string `metadata`, optional space-separated `allowed-tools`, and a safe source candidate name matching `name`
- **THEN** manifest validation MUST accept the official field shape
- **AND** repeated whitespace and duplicate tool names MUST normalize to first-occurrence tool constraint order

#### Scenario: Supported source metadata arrays are accepted

- **WHEN** a Skill manifest provides `metadata.exclusiveWith`, `metadata.compatibleWith`, or `metadata.tags` as a YAML block list or inline list of safe non-empty strings
- **THEN** manifest validation MUST accept the metadata field shape
- **AND** the array value MUST remain source metadata rather than become governed Skill descriptor behavior

### Requirement: Unknown metadata Does Not Carry Governed Meaning

Metadata fields outside this change's supported metadata set are source metadata. Safe, non-sensitive unknown metadata MAY be preserved as source metadata when its value is a string, or when its key is one of `exclusiveWith`, `compatibleWith`, or `tags` and its value is a non-empty array of safe non-empty strings. Unsafe, too-large, reserved-handle, direct-form object, unsupported-array-key, or otherwise unsupported source metadata MUST be silently omitted from Skill metadata without emitting a diagnostic and without rejecting the manifest, because unknown metadata carries no governed meaning and an omitted value cannot change governed behavior.

Governed behavior MUST be derived from governed descriptor fields and typed Skill metadata. Capability governance, Agent assembly, model selection, routing, policy, sandbox, prompt rendering, prompt shaping, owner scope, secret resolution, provider configuration, tool constraints, and availability MUST consume governed descriptor fields and typed Skill metadata rather than unknown metadata.

#### Scenario: Unknown metadata is preserved as source metadata

- **WHEN** a Skill manifest contains unknown metadata keys
- **THEN** governed behavior MUST remain derived from governed descriptor fields and typed Skill metadata
- **AND** safe unknown string metadata MUST be preserved as source metadata
- **AND** safe array metadata MUST be preserved as source metadata only for `exclusiveWith`, `compatibleWith`, and `tags`
- **AND** unsafe or unsupported unknown metadata MUST be silently omitted from Skill metadata without a diagnostic

#### Scenario: Governing decisions consume descriptor metadata

- **WHEN** a Skill manifest contains unknown metadata keys
- **THEN** governing decision inputs MUST contain governed descriptor fields and typed Skill metadata
- **AND** capability visibility, availability, invocation, routing, model selection, prompt shaping, sandbox behavior, owner scope, policy, and Agent assembly MUST be derived from governed descriptor fields and typed Skill metadata

### Requirement: Skill Manifest Diagnostic Includes Extension Reason Code

The public `SkillManifestDiagnostic` reason code set MUST keep `EXTENSION_OMITTED` reserved in the contract. Because this change makes unsafe extension metadata omission silent, current manifest validation MUST NOT emit `EXTENSION_OMITTED`; unsafe extension keys and values are silently dropped from `SkillMetadata.extension` while safe sibling entries are preserved.

**需求类别**：功能性需求

#### Scenario: 不安全 extension 条目被静默忽略

- **WHEN** 一个 Skill manifest 的 `metadata.extension` 中包含不安全键或值
- **THEN** manifest validation MUST 接受该 manifest（除非命中其他拒绝规则）
- **AND** 不安全条目 MUST NOT 出现在 `SkillMetadata.extension` 中，安全条目 MUST 保留
- **AND** manifest validation MUST NOT 产生 `EXTENSION_OMITTED` 诊断

#### Scenario: Extension omission produces safe diagnostic

- **WHEN** extension metadata is omitted during manifest validation
- **THEN** a diagnostic MUST be emitted with reason code `EXTENSION_OMITTED`
- **AND** severity MUST be `WARNING`
- **AND** outcome MUST be `degraded`
- **AND** message MUST NOT expose unsafe key name or unsafe value content

### Requirement: Manifest Validation Outcome Is Explicit

The system MUST classify Skill manifest validation as accepted or rejected. Accepted manifests produce descriptor input for downstream governance. Rejected manifests produce `SkillManifestDiagnostic` for source readiness and skip the executable Skill capability path. Because this change makes unknown/unsafe source metadata and extension omission silent, the `degraded` outcome MUST NOT be produced by the manifest parsing path and `SOURCE_METADATA_OMITTED` MUST NOT be emitted.

The outcome rules MUST be deterministic:

- `accepted`: all required standard fields are valid; all supported extensions are valid; safe unknown metadata, if present, is preserved as `SkillMetadata.sourceMetadata`; unsafe or unsupported metadata entries are silently omitted; no diagnostic is required.
- `rejected`: `SKILL.md` is missing; required `name` or `description` is missing or invalid; any standard field has an invalid official shape; any supported extension has an invalid governed shape (including a non-object `metadata.extension` wrapper); `agent` conflicts with `context: inline`; tool constraints are invalid; model declarations are unsafe; or descriptor input cannot be produced.

`SkillManifestDiagnostic` MUST be the public safe diagnostic contract for manifest validation. It MUST contain a stable reason code, severity (`INFO`, `WARNING`, or `ERROR`), validation outcome, sanitized message, and MAY include safe `providerId` and safe `skillName` when those values are available. It MUST NOT contain raw manifest content, raw markdown body, raw path, endpoint, credential, provider response, user input, model input/output, or unsafe metadata.

The public `SkillManifestDiagnostic` reason code set for this change MUST include:

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
- `EXTENSION_OMITTED`
- `SOURCE_METADATA_OMITTED`
- `DESCRIPTOR_MAPPING_FAILED`
- `SKILL_MD_UNSUPPORTED_ENCODING`

`EXTENSION_OMITTED` and `SOURCE_METADATA_OMITTED` MUST remain in the public reason code set for contract stability, but current manifest validation MUST NOT emit them: unknown/unsafe metadata omission is silent.

Implementations MAY add source-private internal details while producing diagnostics, but cross-package and user-visible manifest diagnostics MUST use these stable public reason codes.

**需求类别**：功能性需求

#### Scenario: Rejected manifest enters source skip path

- **WHEN** manifest validation rejects a Skill manifest
- **THEN** the Skill candidate MUST be skipped from the executable capability catalog

#### Scenario: Rejected and degraded manifests use stable diagnostic reason codes

- **WHEN** manifest validation rejects or degrades a Skill manifest
- **THEN** every public diagnostic MUST use one of this change's stable `SkillManifestDiagnostic.reasonCode` values
- **AND** diagnostics MUST expose only severity, validation outcome, sanitized message, optional safe provider id, and optional safe skill name

### Requirement: Metadata Field Parsing Distinguishes String Source Metadata, Reserved Extension Wrapper, and Invalid Direct-Form Object

The manifest parser MUST distinguish the following metadata value categories:
1. Governed metadata fields: `version`, `modelOptions`. These MUST follow existing parsing rules.
2. String source metadata: metadata keys with safe string values MUST be preserved in `SkillMetadata.sourceMetadata`, including the key `model`.
3. Supported array source metadata: keys `exclusiveWith`, `compatibleWith`, `tags` with non-empty array of safe strings MUST be preserved in `SkillMetadata.sourceMetadata`.
4. Reserved extension wrapper: the key `extension` MUST be treated as the reserved wrapper key. Its value MUST be a JSON object; each entry MUST be validated against extension safety rules and flattened into `SkillMetadata.extension.<name>`. A non-object `metadata.extension` value MUST reject the manifest with reason code `INVALID_OFFICIAL_FIELD`.
5. Silently omitted metadata: reserved handles (`sourceIdentity`, `frontmatterHash`), unsafe keys or values, direct-form object values outside the `extension` wrapper, unsupported array keys, and unsupported value shapes MUST be silently omitted from Skill metadata without emitting a diagnostic and without rejecting the manifest. Unknown metadata carries no governed meaning, so an omitted value cannot change governed behavior.

Metadata keys MUST NOT appear in both `sourceMetadata` and `extension`. If the same key appears in both categories due to parsing logic, the parser MUST reject the manifest with reason code `INVALID_OFFICIAL_FIELD`.

#### Scenario: String metadata preserved in sourceMetadata

- **WHEN** a metadata key has a string value and is not a governed metadata key
- **THEN** the key-value MUST be preserved in `SkillMetadata.sourceMetadata`

#### Scenario: metadata.model treated as string source metadata

- **WHEN** the metadata key `model` has a safe string value
- **THEN** the key-value MUST be preserved in `SkillMetadata.sourceMetadata`
- **AND** it MUST NOT contribute to `SkillMetadata.model` or `SkillMetadata.modelOptions`

#### Scenario: 不安全或不受支持的 metadata 值被静默忽略

- **WHEN** 一个 Skill manifest 的 metadata 中声明了不安全键/值（命中 unsafe key/value pattern）、保留句柄（`sourceIdentity`、`frontmatterHash`）、`extension` wrapper 之外的直填对象、不受支持键上的数组值或不受支持的值形态
- **THEN** manifest validation MUST 接受该 manifest（除非命中其他拒绝规则）
- **AND** 这些条目 MUST NOT 出现在 `SkillMetadata.sourceMetadata` 或 `SkillMetadata.extension` 中
- **AND** 该 manifest MUST NOT 因此产生 `SOURCE_METADATA_OMITTED` 或 `EXTENSION_OMITTED` 诊断

#### Scenario: Array metadata preserved in sourceMetadata for supported keys

- **WHEN** a metadata key is one of `exclusiveWith`, `compatibleWith`, `tags`
- **AND** the value is a non-empty array of safe non-empty strings
- **THEN** the key-value MUST be preserved in `SkillMetadata.sourceMetadata`

#### Scenario: Wrapper entry preserved in extension

- **WHEN** `metadata.extension.<name>` declares a value that satisfies extension safety rules
- **THEN** the entry MUST be preserved in `SkillMetadata.extension.<name>` flattened from the wrapper
- **AND** no `extension.extension.*` double-nested entry MUST be produced

### Requirement: Skill Metadata Extension Supports Nested Object Values

The system MUST support `extension` field in `SkillMetadata` to carry structured metadata values. The `extension` field MUST be optional. Each value MUST be a primitive (string, number, boolean, or null), a recursively nested Map (JsonObject), or a readonly array of safe strings; array elements MUST be strings that individually satisfy the string value safety rules (length <= 512, no unsafe value pattern), and arrays MUST NOT exceed 64 elements.

The `metadata.extension` key in SKILL.md frontmatter is a reserved wrapper key. Its value MUST be a JSON object whose entries form the extension map. The parser MUST flatten each entry into `SkillMetadata.extension.<name>` and MUST NOT produce `extension.extension.*` double nesting. A direct-form object value on a metadata key other than `extension` MUST be silently omitted from Skill metadata without a diagnostic; extension data is only accepted under the `metadata.extension` wrapper.

Extension key names MUST be valid:
- Key length MUST be 1-128 characters.
- Key MUST NOT match unsafe key pattern (containing `api_key`, `authorization`, `base_url`, `credential`, `endpoint`, `headers`, `password`, `secret`, `token`, or `url`).
- Reserved keys `sourceIdentity`, `frontmatterHash`, `metadataKind` MUST NOT be used as extension keys.

Extension values MUST be safe:
- Value MAY be a primitive (string, number, boolean, or null), a Map (JsonObject), or a readonly array of safe strings (max 64 elements).
- Value nesting depth MUST NOT exceed 3 levels.
- Map (JsonObject) entries MUST satisfy the same key safety rules; nested values MAY be primitives or Maps and MUST NOT be arrays. Arrays are only allowed as top-level extension values, not inside nested Maps.
- String values MUST NOT exceed 512 characters and MUST NOT contain unsafe value pattern (matching `https?://`, `sk-[A-Za-z0-9]`, or containing `api_key`, `authorization`, `credential`, `password`, `secret`, `token`).
- Value MUST NOT contain unsafe value pattern at any nesting level.
- All nested keys MUST satisfy the same key safety rules.
- Total extension object size MUST NOT exceed 32KB when serialized to JSON.

Entries violating key or value safety rules MUST be silently omitted from `SkillMetadata.extension` without a diagnostic while safe sibling entries are preserved.

Extension metadata MUST NOT be used for NextAgent internal governed behavior derivation. Capability governance, Agent assembly, routing, policy, sandbox, model selection, prompt shaping, owner scope, availability, and tool authorization MUST NOT consume `extension` values to derive behavior. The `extension` field exists solely for Skill authoring metadata preservation and MUST be ignored by all NextAgent internal governed behavior paths.

The `extension` field is optional. A Skill manifest without `extension` metadata MUST be accepted normally and MUST NOT emit any diagnostic for the missing extension field.

Upper-layer integration services MAY read extension metadata through `CapabilityDescriptor.metadata.extension`. The consumption rules of upper-layer services are defined by those services and are outside NextAgent scope.

**需求类别**：功能性需求

#### Scenario: Missing extension is accepted without diagnostic

- **WHEN** a Skill manifest does not contain any extension metadata
- **THEN** manifest validation MUST accept the manifest

#### Scenario: Wrapper-form extension entries are accepted and flattened

- **WHEN** a Skill manifest declares `metadata.extension` as a JSON object whose entries satisfy all key and value safety rules
- **THEN** manifest validation MUST accept the manifest
- **AND** each entry MUST be flattened into `SkillMetadata.extension.<name>` without double nesting

#### Scenario: Array extension value with safe strings is accepted

- **WHEN** a `metadata.extension` entry value is a JSON array of safe strings within the element and size limits
- **THEN** manifest validation MUST accept the manifest
- **AND** the array entry MUST be preserved in `SkillMetadata.extension.<name>`

#### Scenario: Array extension value with unsafe elements is silently omitted

- **WHEN** a `metadata.extension` entry value is a JSON array
- **AND** one or more array elements are non-strings, exceed 512 characters, match the unsafe value pattern, or the array exceeds 64 elements
- **THEN** manifest validation MUST accept the manifest
- **AND** the array entry MUST be omitted from `SkillMetadata.extension`
- **AND** manifest validation MUST NOT emit an `EXTENSION_OMITTED` diagnostic

#### Scenario: Unsafe extension key is silently omitted

- **WHEN** a `metadata.extension` entry key matches unsafe key pattern or is a reserved key
- **THEN** manifest validation MUST accept the manifest
- **AND** the unsafe extension MUST be omitted from `SkillMetadata.extension`
- **AND** manifest validation MUST NOT emit an `EXTENSION_OMITTED` diagnostic

#### Scenario: Unsafe extension value is silently omitted

- **WHEN** a `metadata.extension` entry value contains unsafe patterns or exceeds depth/size limits
- **THEN** manifest validation MUST accept the manifest
- **AND** the unsafe extension MUST be omitted from `SkillMetadata.extension`
- **AND** manifest validation MUST NOT emit an `EXTENSION_OMITTED` diagnostic

#### Scenario: Non-object metadata.extension wrapper is rejected

- **WHEN** a Skill manifest declares `metadata.extension` with a non-object value (string, number, boolean, array, or null)
- **THEN** manifest validation MUST reject the manifest with reason code `INVALID_OFFICIAL_FIELD`
- **AND** the Skill candidate MUST enter the source skip path with safe diagnostics

#### Scenario: Direct-form object metadata outside the wrapper is silently omitted

- **WHEN** a Skill manifest declares `metadata.<非 extension 名>` with a nested object value instead of placing it under `metadata.extension`
- **THEN** manifest validation MUST accept the manifest
- **AND** the entry MUST be omitted from Skill metadata without a diagnostic

#### Scenario: Extension does not affect NextAgent internal governed behavior

- **WHEN** a Skill manifest contains valid extension metadata
- **THEN** NextAgent internal capability governance MUST NOT derive behavior from `SkillMetadata.extension`
- **AND** NextAgent internal Agent assembly MUST NOT derive behavior from `SkillMetadata.extension`
- **AND** NextAgent internal routing, policy, sandbox, model selection, prompt shaping MUST NOT consume `SkillMetadata.extension`

#### Scenario: Extension is accessible to upper-layer integration services through the typed accessor

- **WHEN** a Skill manifest contains valid extension metadata
- **THEN** the extension MUST be accessible through `readSkillMetadata(descriptor).extension` (that is, `CapabilityDescriptor.metadata.extension`)

#### Scenario: Array extension value with unsafe elements is omitted with degraded diagnostic

- **WHEN** a `metadata.extension` entry value is a JSON array
- **AND** one or more array elements are non-strings, exceed 512 characters, match the unsafe value pattern, or the array exceeds 64 elements
- **THEN** manifest validation MUST degrade the manifest
- **AND** the array entry MUST be omitted from `SkillMetadata.extension`
- **AND** a diagnostic with reason code `EXTENSION_OMITTED` MUST be emitted

#### Scenario: Unsafe extension key is omitted with degraded diagnostic

- **WHEN** a `metadata.extension` entry key matches unsafe key pattern or is a reserved key
- **THEN** manifest validation MUST degrade the manifest
- **AND** the unsafe extension MUST be omitted from `SkillMetadata.extension`
- **AND** a diagnostic with reason code `EXTENSION_OMITTED` MUST be emitted

#### Scenario: Unsafe extension value is omitted with degraded diagnostic

- **WHEN** a `metadata.extension` entry value contains unsafe patterns or exceeds depth/size limits
- **THEN** manifest validation MUST degrade the manifest
- **AND** the unsafe extension MUST be omitted from `SkillMetadata.extension`
- **AND** a diagnostic with reason code `EXTENSION_OMITTED` MUST be emitted

#### Scenario: Direct-form object metadata outside the wrapper is rejected

- **WHEN** a Skill manifest declares `metadata.<非 extension 名>` with a nested object value instead of placing it under `metadata.extension`
- **THEN** manifest validation MUST reject the manifest with reason code `INVALID_OFFICIAL_FIELD`
- **AND** the Skill candidate MUST enter the source skip path with safe diagnostics

### Requirement: Skill Manifest Tool Constraints SHALL Accept Canonical and Compatible List Forms

The Skill manifest parser SHALL keep `allowed-tools` as the canonical top-level tool allow-list field. The parser SHALL accept `allowed-tools` as either a whitespace-separated string or a YAML string list. The parser SHALL also accept top-level `tools` as a compatibility alias for `allowed-tools`.

When both `allowed-tools` and `tools` are declared with non-empty values, the parser SHALL reject the manifest with an invalid tool constraint diagnostic. The compatibility alias SHALL NOT create a new public Skill metadata field; accepted values SHALL map to the existing `allowedTools` Skill metadata.

**需求类别**：功能性需求

#### Scenario: Canonical YAML array tool constraints load
- **WHEN** a Skill manifest declares `allowed-tools` as a YAML list containing `Bash`, `Read`, and `Agent`
- **THEN** manifest parsing SHALL accept the Skill.
- **AND** descriptor mapping SHALL expose `allowedTools: ["Bash", "Read", "Agent"]` through existing Skill metadata.

#### Scenario: Compatible tools alias maps to allowed tools
- **WHEN** a Skill manifest declares `tools` as a YAML list containing `Bash`, `Read`, and `Agent`
- **THEN** manifest parsing SHALL accept the Skill.
- **AND** descriptor mapping SHALL expose the list through existing `allowedTools` Skill metadata.

#### Scenario: Conflicting canonical and alias fields are rejected
- **WHEN** a Skill manifest declares non-empty `allowed-tools`
- **AND** declares non-empty `tools`
- **THEN** manifest parsing SHALL reject the Skill as an invalid tool constraint.

### Requirement: Skill Manifest Denied Tool Constraints SHALL Accept List Forms

The Skill manifest parser SHALL accept top-level `disallowed-tools` as either a whitespace-separated string or a YAML string list, using the same parsing rules as `allowed-tools`. Accepted values SHALL map to existing `deniedTools` Skill metadata. The metadata key `denied-tools` is no longer a supported input and MUST be preserved only as string source metadata without governed meaning.

**需求类别**：功能性需求

#### Scenario: Denied tools list loads
- **WHEN** a Skill manifest declares top-level `disallowed-tools` as a YAML list
- **THEN** manifest parsing SHALL accept the Skill.
- **AND** descriptor mapping SHALL expose the list through existing `deniedTools` Skill metadata.
