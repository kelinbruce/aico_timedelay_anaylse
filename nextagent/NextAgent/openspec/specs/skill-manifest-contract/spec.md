## Purpose

Define `SKILL.md` as the authoritative Skill manifest input and the shared contract for deriving governed Skill `CapabilityDescriptor`, typed `SkillMetadata`, and safe manifest diagnostics across Skill sources.

## Function

- **所属 Function**：`FN-5.8 发现技能`
- **spec 角色**：主规格
## Requirements
### Requirement: Skill Manifest Uses SKILL.md As The Authoritative Input

The system MUST treat `SKILL.md` as the authoritative manifest input for a Skill. All Skill sources MUST use this contract to derive a governed Skill `CapabilityDescriptor`, typed `SkillMetadata`, and safe source diagnostics.

#### Scenario: Skill source consumes governed descriptor metadata

- **WHEN** a Skill source discovers a Skill candidate
- **THEN** it MUST use that Skill's `SKILL.md` as the authoritative manifest input
- **AND** it MUST expose a governed Skill `CapabilityDescriptor` with typed `SkillMetadata` and safe diagnostics to downstream capability governance

### Requirement: Skill Manifest Supports Standard And Supported Extension Frontmatter Fields

The system MUST support standard Skill manifest frontmatter fields compatible with Agent Skills `SKILL.md` usage and the explicitly supported extension frontmatter fields defined by this change:

- `name`
- `description`
- optional `license`
- optional `compatibility`
- optional `allowed-tools`
- optional `context`
- optional `agent`
- optional `user-invocable`
- optional `model-invocable`
- optional `model`
- optional `metadata`

The listed fields MUST be sufficient to describe a Skill before any source-specific execution concerns are applied.

The `name` field MUST be present and MUST be a non-empty string with 1-64 characters, lowercase alphanumeric characters and hyphens only, no leading or trailing hyphen, and no consecutive hyphens. When the Skill source knows the containing Skill directory or source candidate name, validated `name` MUST match that safe directory/candidate name or validation MUST reject the manifest. `description` MUST be present, MUST parse to a non-empty safe string with 1-1024 characters, MAY be expressed as a YAML literal or folded block scalar, and MUST describe what the Skill does and when to use it. `license`, when present, MUST be a string. `compatibility`, when present, MUST be a string with 1-500 characters. `allowed-tools`, when present, MUST be a space-separated string of tool names and parse into a string array; empty tool names MUST be ignored only when caused by repeated whitespace, and duplicate tool names MUST be deduplicated with first occurrence order preserved before producing descriptor metadata. `metadata`, when present, MUST be a mapping of string keys to safe string values, except that the source metadata keys `exclusiveWith`, `compatibleWith`, and `tags` MAY use a non-empty array of safe non-empty string values. These array values MUST be accepted in YAML block list form and YAML inline list form. `context`, when present, MUST be `inline` or `fork`. `agent`, when present, MUST parse as the canonical `AgentId` used by the existing Agent assembly contract and `AgentAssemblyRegistry` lookup; it MUST NOT be a display name, provider-qualified id, or `agentId + agentVersion` pair. `user-invocable` and `model-invocable`, when present, MUST be booleans. `model`, when present, MUST parse as a safe model string or JSON-compatible object containing only supported model declaration fields.

#### Scenario: Standard manifest fields are accepted

- **WHEN** the system validates a Skill manifest with standard fields and valid supported extensions
- **THEN** it MUST produce a governed Skill descriptor input
- **AND** the descriptor metadata MUST be usable by builtin, local, agent-scoped, and SkillHub source flows

#### Scenario: Official Agent Skills field shape is accepted with matching source name

- **WHEN** a Skill manifest provides required `name` and `description`, optional `compatibility`, optional string-to-string `metadata`, optional space-separated `allowed-tools`, and a safe source candidate name matching `name`
- **THEN** manifest validation MUST accept the official field shape
- **AND** repeated whitespace and duplicate tool names MUST normalize to first-occurrence tool constraint order

#### Scenario: Supported source metadata arrays are accepted

- **WHEN** a Skill manifest provides `metadata.exclusiveWith`, `metadata.compatibleWith`, or `metadata.tags` as a YAML block list or inline list of safe non-empty strings
- **THEN** manifest validation MUST accept the metadata field shape
- **AND** the array value MUST remain source metadata rather than become governed Skill descriptor behavior

#### Scenario: Invalid standard fields are rejected

- **WHEN** a Skill manifest omits `name`, omits `description`, provides an invalid `name`, provides a `name` that does not match the safe source candidate name when one is available, provides an empty or too long `description`, provides a `description` that cannot parse to a safe string, provides non-string `license` or `compatibility`, provides too long `compatibility`, provides non-string `allowed-tools`, provides non-string metadata keys, provides non-string metadata values for keys other than `exclusiveWith`, `compatibleWith`, or `tags`, provides non-array values for supported array metadata keys when they are not strings, provides empty arrays or array metadata containing non-string or empty elements, provides non-boolean `user-invocable`, provides non-boolean `model-invocable`, provides invalid `agent`, provides invalid `model`, or provides tool constraints with empty non-whitespace tool names
- **THEN** manifest validation MUST reject the manifest
- **AND** the Skill candidate MUST enter the source skip path with safe diagnostics

### Requirement: Skill Manifest Produces Typed Skill Capability Metadata

The manifest contract MUST produce typed `SkillMetadata` for `CapabilityDescriptor.metadata` when the descriptor `kind` is `SKILL`. `SkillMetadata` MUST be owned by `agent-contracts/capability` as the public metadata schema. Parser implementation details and parser-process frontmatter objects remain owned by `agent-capability`.

Accepted or degraded manifest validation MUST produce a Skill descriptor input and safe diagnostics. For Skill descriptors, the validated Skill `name` MUST map to `CapabilityDescriptor.capabilityId` and the model-visible display name. The validated Skill `description` MUST map to `CapabilityDescriptor.description`. If `metadata.version` is present, it MUST map to `CapabilityDescriptor.version` as a common Skill metadata key and MUST NOT require a `nextagent` prefix. The descriptor `metadata` MUST validate as `SkillMetadata` and include a discriminator, `context`, `userInvocable`, `modelInvocable`, optional `agent`, optional allowed tool constraints, optional denied tool constraints, optional `model`, optional `modelOptions`, optional safe source metadata, and optional safe extension metadata. The normalized metadata fields MUST preserve `context`, `agent`, `model`, `userInvocable`, and `modelInvocable` as the field names.

#### Scenario: Accepted manifest produces typed descriptor metadata

- **WHEN** a Skill manifest is accepted
- **THEN** downstream source and governance flows MUST receive a Skill `CapabilityDescriptor` input whose `metadata` validates as `SkillMetadata`
- **AND** the exchanged payload MUST remain limited to governed descriptor fields, typed metadata, and safe diagnostics

### Requirement: Skill Frontmatter Parser And Descriptor Mapper Are Reusable Capability Helpers

The `agent-capability` package MUST provide a reusable Skill frontmatter parser and a reusable Skill descriptor mapper for builtin, local, agent-scoped, and SkillHub source flows. These helpers MAY use implementation-owned parser records, but package boundaries MUST expose only `CapabilityDescriptor`, typed `SkillMetadata`, validation outcome, and `SkillManifestDiagnostic`.

The frontmatter parser MUST parse only the leading `SKILL.md` frontmatter block or an already extracted frontmatter source. It MUST NOT require the full markdown body as parser input. A source-specific file reader MAY read a bounded leading slice of `SKILL.md` to extract frontmatter, but raw body loading and body-to-context injection remain owned by later execution/context changes.

The descriptor mapper MUST accept validated Skill frontmatter facts and a `CapabilityProvider`, then produce a Skill `CapabilityDescriptor` with typed `SkillMetadata`. The mapper MUST derive `capabilityId`, display name, `description`, `version`, and Skill metadata by the mapping rules in this contract. Provider identity MUST come from the provided `CapabilityProvider`; source-private paths, provider-private entry refs, and raw markdown body content MUST NOT enter the descriptor. Official `license` and `compatibility` values are descriptive Skill source metadata in this change and MUST NOT be converted into `CapabilityDescriptor.compatibility` unless a later capability governance change defines a typed mapping.

#### Scenario: Parser consumes only the frontmatter boundary

- **WHEN** a Skill source parses a `SKILL.md`
- **THEN** the reusable parser MUST validate the leading frontmatter block without requiring the markdown body
- **AND** markdown body content MUST stay outside manifest validation outputs

#### Scenario: Mapper returns a Skill descriptor

- **WHEN** validated Skill frontmatter and a `CapabilityProvider` are passed to the reusable descriptor mapper
- **THEN** the mapper MUST produce a Skill `CapabilityDescriptor` whose `capabilityId`, model-visible display name, `description`, `version`, provider, compatibility, and `metadata` follow this contract
- **AND** the descriptor `metadata` MUST validate as `SkillMetadata`

### Requirement: CapabilityDescriptor Uses description Field

The capability contract MUST use `CapabilityDescriptor.description` for the model-visible safe capability description. `safeDescription` MUST NOT remain a public `CapabilityDescriptor` field. The `description` value MUST continue to satisfy the same safety restrictions: it MUST be bounded, sanitized, and free of secrets, raw paths, raw provider responses, credentials, user input, model input/output, and unsafe metadata.

#### Scenario: Descriptor exposes description

- **WHEN** a Tool, Skill, or Agent capability descriptor is exchanged across package boundaries
- **THEN** the descriptor MUST expose the capability description through `description`
- **AND** downstream context/model disclosure MUST use `description` when building model-visible capability metadata

### Requirement: Skill Capability Metadata Is Read Through A Typed Accessor

The system MUST provide a typed Skill metadata schema and accessor for `CapabilityDescriptor.metadata` when `CapabilityDescriptor.kind` is `SKILL`. The accessor MUST validate the descriptor kind and metadata discriminator before returning `SkillMetadata`.

The public schema/type for `SkillMetadata` is owned by `agent-contracts/capability`. The runtime validation/accessor implementation is owned by `agent-capability` and MUST be exposed through a public package export for downstream packages that need typed Skill metadata. Downstream packages MUST use the typed accessor or schema validation result instead of reading Skill-specific keys directly from `CapabilityDescriptor.metadata`.

`SkillMetadata` MUST include a stable discriminator such as `metadataKind: "nextagent.skill"`, `context`, `userInvocable`, `modelInvocable`, optional `agent`, optional `allowedTools`, optional `deniedTools`, optional `model`, optional `modelOptions`, and optional `sourceMetadata`. `sourceMetadata`, when present, MUST contain only safe source metadata string keys and string values.

#### Scenario: Skill descriptor metadata is parsed as SkillMetadata

- **WHEN** a downstream package receives a `CapabilityDescriptor` with `kind=SKILL`
- **THEN** it MUST obtain Skill-specific metadata through the typed Skill metadata accessor or schema validation result
- **AND** successful parsing MUST return `SkillMetadata`

#### Scenario: Non-Skill descriptor uses its own metadata contract

- **WHEN** a downstream package receives a `CapabilityDescriptor` with a kind other than `SKILL`
- **THEN** Skill metadata parsing MUST return a safe non-match result
- **AND** the descriptor's own kind-specific metadata contract remains responsible for typed parsing

### Requirement: Top-Level context Defines The Supported Context Extension

The Skill context extension MUST be expressed as the top-level `context` frontmatter field. The allowed values are:

- `inline`
- `fork`

If `context` is omitted, the default governed `context` fact MUST be `inline`. Fork execution, child-Agent execution, context inheritance, and result return semantics are owned by later execution changes.

#### Scenario: Missing context defaults to inline

- **WHEN** a valid Skill manifest omits `context`
- **THEN** the Skill metadata MUST use `inline` as the default `context`

#### Scenario: Invalid context is rejected

- **WHEN** a Skill manifest contains `context` with a value other than `inline` or `fork`
- **THEN** validation MUST reject the manifest
- **AND** the Skill candidate MUST enter the source skip path with safe diagnostics

### Requirement: Top-Level agent Defines Fork Agent Selection Hint

The `agent` extension MAY be expressed as a top-level Skill frontmatter field. When present, it MUST parse as the canonical `AgentId` used by the existing Agent assembly contract and `AgentAssemblyRegistry.active(agentId)` / `AgentAssemblyRegistry.require(agentId, agentVersion)` lookup boundary, and MUST parse into `SkillMetadata.agent`. It MUST NOT accept Agent display names, provider-qualified identifiers, source-local aliases, or values that include Agent version selection. Agent version and active-version resolution remain owned by Agent assembly and later execution governance.

`agent` is a fork execution hint. When `agent` is present and `context` is omitted, the normalized `context` MUST be `fork`. When `agent` is present and `context` is explicitly `inline`, manifest validation MUST reject the manifest. `agent` does not authorize cross-Agent execution by itself; Agent scope, capability binding, owner scope, availability, policy, invocation authorization, context inheritance, model selection, and fork execution remain governed by later execution changes and existing governance.

#### Scenario: agent implies fork context

- **WHEN** a valid Skill manifest declares top-level `agent` and omits `context`
- **THEN** the Skill metadata MUST use `fork` as the normalized `context`
- **AND** the Skill metadata MUST expose the canonical `AgentId` as `agent`

#### Scenario: agent conflicts with inline context

- **WHEN** a Skill manifest declares top-level `agent` and `context: inline`
- **THEN** manifest validation MUST reject the manifest
- **AND** the Skill candidate MUST enter the source skip path with safe diagnostics

### Requirement: Top-Level user-invocable Defines Explicit User Selection Eligibility

The `user-invocable` extension MAY be expressed as a top-level Skill frontmatter field. When present, it MUST be a boolean and MUST parse into the governed fact `userInvocable`. When omitted, `userInvocable` MUST default to `false`.

`userInvocable=true` MUST mean that the Skill may be considered for explicit user-specified execution after normal capability governance accepts it. Capability binding, owner-scope checks, Agent-scope checks, availability, policy, invocation authorization, and model selection remain required. Model/core orchestration eligibility remains governed by its own capability policy.

#### Scenario: Missing user-invocable defaults to false

- **WHEN** a valid Skill manifest omits `user-invocable`
- **THEN** the Skill metadata MUST use `false` as the default `userInvocable`

#### Scenario: Non-boolean user-invocable is rejected

- **WHEN** a Skill manifest contains `user-invocable` with a non-boolean value
- **THEN** validation MUST reject the manifest
- **AND** the Skill candidate MUST enter the source skip path with safe diagnostics

### Requirement: Top-Level model-invocable Defines Model-Orchestrated Invocation Eligibility

The `model-invocable` extension MAY be expressed as a top-level Skill frontmatter field. When present, it MUST be a boolean and MUST parse into `SkillMetadata.modelInvocable`. When omitted, `modelInvocable` MUST default to `true`.

`modelInvocable=true` means the Skill may be considered for model/core orchestrated invocation after normal capability governance accepts it. Capability binding, owner-scope checks, Agent-scope checks, availability, policy, invocation authorization, and model selection remain required. Explicit user-specified execution eligibility remains governed by `userInvocable`.

#### Scenario: Missing model-invocable defaults to true

- **WHEN** a valid Skill manifest omits `model-invocable`
- **THEN** the Skill metadata MUST use `true` as the default `modelInvocable`

#### Scenario: Non-boolean model-invocable is rejected

- **WHEN** a Skill manifest contains `model-invocable` with a non-boolean value
- **THEN** validation MUST reject the manifest
- **AND** the Skill candidate MUST enter the source skip path with safe diagnostics

### Requirement: allowed-tools And metadata.denied-tools Are Tool Constraint Facts

The `allowed-tools` field and `metadata.denied-tools` extension, when present, MUST parse into `SkillMetadata.allowedTools` and `SkillMetadata.deniedTools`. To preserve Agent Skills metadata compatibility, both values MUST use the Agent Skills compatible space-separated tool-name string format. These fields produce tool constraint metadata for capability governance. Tool execution rights remain determined by capability governance, Agent assembly, owner scope, and policy.

#### Scenario: Tool constraints feed authorization governance

- **WHEN** a Skill manifest declares `allowed-tools` or `metadata.denied-tools`
- **THEN** the system MUST expose those values as typed Skill tool constraint metadata
- **AND** capability governance and Agent assembly MUST still enforce availability, binding, owner scope, and policy checks

#### Scenario: Invalid tool constraint shape is rejected

- **WHEN** `allowed-tools` or parsed `metadata.denied-tools` has an invalid shape, contains non-string values, or contains empty tool names
- **THEN** manifest validation MUST reject the manifest

### Requirement: metadata.version Maps To Descriptor Version

The `metadata.version` field MAY be provided as a Skill metadata string. When present, it MUST be a non-empty safe version string and MUST map to `CapabilityDescriptor.version`. It MUST NOT be copied into `SkillMetadata.sourceMetadata`, because it has governed descriptor meaning.

#### Scenario: metadata.version becomes descriptor version

- **WHEN** a Skill manifest declares `metadata.version`
- **THEN** the Skill descriptor input MUST set `CapabilityDescriptor.version` to that value
- **AND** the normalized Skill metadata MUST remain focused on Skill-specific metadata rather than duplicating descriptor version

### Requirement: Model Declarations Are Governed Model Hints

The system MUST treat all supported Skill model declarations as governed model hint inputs rather than provider configuration.

The Skill manifest MAY provide a safe model preference or constraint fact through these supported inputs:

- top-level `model`
- `metadata.nextagent.model`
- `metadata.nextagent.modelOptions`
- compatibility alias `metadata.model`

To preserve top-level de facto compatibility, top-level `model` MAY be provided as a safe model string or a JSON-compatible object containing `model` and optional `modelOptions`. To preserve Agent Skills metadata compatibility while providing a NextAgent standard extension namespace, `metadata.nextagent.model` MUST be a safe model string and `metadata.nextagent.modelOptions` MUST be a safe JSON string object. The compatibility alias `metadata.model` MAY be a metadata string containing either a model string or a safe JSON string object with `model` and optional `modelOptions`.

After parsing, downstream consumers MUST see typed `SkillMetadata.model` and optional `SkillMetadata.modelOptions`. Model declarations MUST be safe model hints consisting of a model identifier and governed model options. Final model selection remains owned by model/context governance.

Model declarations MUST be non-authoritative. Final provider, model, credential, endpoint, provider option, runtime model configuration, and Agent default model profile decisions require model/profile governance validation.

Thinking depth or reasoning depth MUST be represented inside `modelOptions` according to the existing model option contract.

If more than one supported input declares `model`, the normalized model values MUST match or manifest validation MUST reject the manifest. If more than one supported input declares `modelOptions`, manifest validation MUST reject the manifest unless the parser can prove the normalized model options are identical.

#### Scenario: Unsafe model metadata is rejected

- **WHEN** a supported model declaration contains raw credential material or provider-private connection configuration
- **THEN** manifest validation MUST reject the manifest
- **AND** downstream outputs MUST contain only a safe diagnostic reason

#### Scenario: Invalid model metadata shape is rejected

- **WHEN** a supported model declaration has an invalid shape for a safe model string or safe object containing only supported `model` and `modelOptions` fields
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

### Requirement: Unknown metadata Does Not Carry Governed Meaning

Metadata fields outside this change's supported metadata set are source metadata. Safe, non-sensitive unknown metadata MAY be preserved as source metadata when its value is a string, or when its key is one of `exclusiveWith`, `compatibleWith`, or `tags` and its value is a non-empty array of safe non-empty strings. Unsafe, too-large, or otherwise unsafe source metadata MUST be omitted from Skill metadata and MUST emit a degraded safe diagnostic when the rest of the manifest remains valid. Non-string metadata keys, non-string metadata values for unsupported array keys, empty arrays, and invalid array elements are invalid official metadata shape and MUST reject the manifest.

Governed behavior MUST be derived from governed descriptor fields and typed Skill metadata. Capability governance, Agent assembly, model selection, routing, policy, sandbox, prompt rendering, prompt shaping, owner scope, secret resolution, provider configuration, tool constraints, and availability MUST consume governed descriptor fields and typed Skill metadata rather than unknown metadata.

#### Scenario: Unknown metadata is preserved as source metadata

- **WHEN** a Skill manifest contains unknown metadata keys
- **THEN** governed behavior MUST remain derived from governed descriptor fields and typed Skill metadata
- **AND** safe unknown string metadata MUST be preserved as source metadata
- **AND** safe array metadata MUST be preserved as source metadata only for `exclusiveWith`, `compatibleWith`, and `tags`
- **AND** unsafe or unparsable unknown metadata MUST be omitted from Skill metadata and reported with a degraded safe diagnostic

#### Scenario: Governing decisions consume descriptor metadata

- **WHEN** a Skill manifest contains unknown metadata keys
- **THEN** governing decision inputs MUST contain governed descriptor fields, typed Skill metadata, and safe diagnostics
- **AND** capability visibility, availability, invocation, routing, model selection, prompt shaping, sandbox behavior, owner scope, policy, and Agent assembly MUST be derived from governed descriptor fields and typed Skill metadata

### Requirement: Manifest Validation Outcome Is Explicit

The system MUST classify Skill manifest validation as accepted, rejected, or degraded. Accepted and degraded manifests MAY produce descriptor input for downstream governance. Rejected manifests produce `SkillManifestDiagnostic` for source readiness and skip the executable Skill capability path. Degraded manifests MUST emit `SkillManifestDiagnostic` for every omitted or unusable source metadata field.

The outcome rules MUST be deterministic:

- `accepted`: all required standard fields are valid; all supported extensions are valid; safe unknown metadata, if present, is preserved as `SkillMetadata.sourceMetadata`; no diagnostic is required.
- `degraded`: all required standard fields and all governed extensions are valid, descriptor input is valid, and only optional source metadata is omitted because it is unsafe, too large, or otherwise not safe to preserve; diagnostics are emitted for each omitted source metadata field.
- `rejected`: `SKILL.md` is missing; required `name` or `description` is missing or invalid; any standard field has an invalid official shape; any supported extension has an invalid shape or unsafe governed value; `agent` conflicts with `context: inline`; tool constraints are invalid; model declarations are unsafe or conflicting; or descriptor input cannot be produced.

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
- `SOURCE_METADATA_OMITTED`
- `DESCRIPTOR_MAPPING_FAILED`
- `SKILL_MD_UNSUPPORTED_ENCODING`

Implementations MAY add source-private internal details while producing diagnostics, but cross-package and user-visible manifest diagnostics MUST use these stable public reason codes.

#### Scenario: Rejected manifest enters source skip path

- **WHEN** manifest validation rejects a Skill manifest
- **THEN** the Skill candidate MUST be skipped from the executable capability catalog
- **AND** the system MUST expose a safe diagnostic reason code and sanitized message

#### Scenario: Rejected and degraded manifests use stable diagnostic reason codes

- **WHEN** manifest validation rejects or degrades a Skill manifest
- **THEN** every public diagnostic MUST use one of this change's stable `SkillManifestDiagnostic.reasonCode` values
- **AND** diagnostics MUST expose only severity, validation outcome, sanitized message, optional safe provider id, and optional safe skill name

### Requirement: Markdown Body Remains Authoring Content

The `SKILL.md` markdown body MAY be used by later Skill invocation or context disclosure changes as Skill authoring content. This manifest contract MUST derive descriptor input and typed Skill metadata from frontmatter and treat the body as authoring content for later execution/context changes.

Manifest validation MUST exchange frontmatter-derived descriptor input, typed Skill metadata, validation outcome, and safe diagnostics.

#### Scenario: Manifest validation emits frontmatter-derived descriptor input

- **WHEN** a Skill manifest includes markdown body content
- **THEN** manifest validation MUST emit only frontmatter-derived descriptor input, typed Skill metadata, validation outcome, and safe diagnostics
- **AND** later Skill invocation or context disclosure changes own any body loading semantics

### Requirement: Skill Metadata Extension Supports Nested Object Values

The system MUST support `extension` field in `SkillMetadata` to carry structured metadata values. The `extension` field MUST be optional. Each value MUST be a primitive (string, number, boolean, or null), a recursively nested Map (JsonObject), or a readonly array of safe strings; array elements MUST be strings that individually satisfy the string value safety rules (length <= 512, no unsafe value pattern), and arrays MUST NOT exceed 64 elements.

The `metadata.extension` key in SKILL.md frontmatter is a reserved wrapper key. Its value MUST be a JSON object whose entries form the extension map. The parser MUST flatten each entry into `SkillMetadata.extension.<name>` and MUST NOT produce `extension.extension.*` double nesting. Extension data MUST NOT be declared via `metadata.<非 extension 名>: {object}` direct form; such direct-form object values remain invalid official metadata shape per the `Unknown metadata Does Not Carry Governed Meaning` requirement and MUST reject the manifest.

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

Extension metadata MUST NOT be used for NextAgent internal governed behavior derivation. Capability governance, Agent assembly, routing, policy, sandbox, model selection, prompt shaping, owner scope, availability, and tool authorization MUST NOT consume `extension` values to derive behavior. The `extension` field exists solely for Skill authoring metadata preservation and MUST be ignored by all NextAgent internal governed behavior paths.

The `extension` field is optional. A Skill manifest without `extension` metadata MUST be accepted normally and MUST NOT emit any diagnostic for the missing extension field.

Upper-layer integration services MAY read extension metadata through `CapabilityDescriptor.metadata.extension`. The consumption rules of upper-layer services are defined by those services and are outside NextAgent scope.

#### Scenario: Missing extension is accepted without diagnostic

- **WHEN** a Skill manifest does not contain any extension metadata
- **THEN** manifest validation MUST accept the manifest
- **AND** `SkillMetadata.extension` MUST be absent or undefined
- **AND** no diagnostic MUST be emitted for the missing extension field

#### Scenario: Wrapper-form extension entries are accepted and flattened

- **WHEN** a Skill manifest declares `metadata.extension` as a JSON object whose entries satisfy all key and value safety rules
- **AND** entry values are primitives (string, number, boolean, null) or Maps (JsonObject)
- **THEN** manifest validation MUST accept the manifest
- **AND** each entry MUST be preserved in `SkillMetadata.extension.<name>` flattened from the wrapper
- **AND** `SkillMetadata.extension.extension` MUST NOT exist as a double-nested entry
- **AND** no diagnostic MUST be emitted for the extension field

#### Scenario: Array extension value with safe strings is accepted

- **WHEN** a `metadata.extension` entry value is a JSON array
- **AND** every array element is a string that does not exceed 512 characters and does not match the unsafe value pattern
- **AND** the array length does not exceed 64 elements
- **THEN** manifest validation MUST accept the manifest
- **AND** the array entry MUST be preserved in `SkillMetadata.extension.<name>`

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

#### Scenario: Non-object metadata.extension wrapper is rejected

- **WHEN** a Skill manifest declares `metadata.extension` with a non-object value (string, number, boolean, array, or null)
- **THEN** manifest validation MUST reject the manifest with reason code `INVALID_OFFICIAL_FIELD`
- **AND** the Skill candidate MUST enter the source skip path with safe diagnostics

#### Scenario: Direct-form object metadata outside the wrapper is rejected

- **WHEN** a Skill manifest declares `metadata.<非 extension 名>` with a nested object value instead of placing it under `metadata.extension`
- **THEN** manifest validation MUST reject the manifest with reason code `INVALID_OFFICIAL_FIELD`
- **AND** the Skill candidate MUST enter the source skip path with safe diagnostics

#### Scenario: Extension does not affect NextAgent internal governed behavior

- **WHEN** a Skill manifest contains valid extension metadata
- **THEN** NextAgent internal capability governance MUST NOT derive behavior from `SkillMetadata.extension`
- **AND** NextAgent internal Agent assembly MUST NOT derive behavior from `SkillMetadata.extension`
- **AND** NextAgent internal routing, policy, sandbox, model selection, prompt shaping MUST NOT consume `SkillMetadata.extension`

#### Scenario: Extension is accessible to upper-layer integration services through the typed accessor

- **WHEN** a Skill manifest contains valid extension metadata
- **THEN** the extension MUST be accessible through `readSkillMetadata(descriptor).extension` (that is, `CapabilityDescriptor.metadata.extension`)
- **AND** upper-layer integration services MAY read extension metadata for post-processing or other integration scenarios
- **AND** NextAgent MUST NOT expose `SkillMetadata.extension` through the Web skill catalog query, which is limited to safe `sourceMetadata`

### Requirement: Skill Manifest Diagnostic Includes Extension Reason Code

The public `SkillManifestDiagnostic` reason code set MUST include `EXTENSION_OMITTED` for this change.

When extension metadata is omitted because it is unsafe, too large, or otherwise not safe to preserve, the diagnostic MUST use reason code `EXTENSION_OMITTED`, severity `WARNING`, and outcome `degraded`. The message MUST explain that unsafe extension metadata was omitted and MUST NOT expose the unsafe key name or unsafe value content.

#### Scenario: Extension omission produces safe diagnostic

- **WHEN** extension metadata is omitted during manifest validation
- **THEN** a diagnostic MUST be emitted with reason code `EXTENSION_OMITTED`
- **AND** severity MUST be `WARNING`
- **AND** outcome MUST be `degraded`
- **AND** message MUST NOT expose unsafe key name or unsafe value content

### Requirement: Metadata Field Parsing Distinguishes String Source Metadata, Reserved Extension Wrapper, and Invalid Direct-Form Object

The manifest parser MUST distinguish the following metadata value categories:
1. Governed metadata fields: `version`, `denied-tools`, `nextagent.model`, `nextagent.modelOptions`, `model`. These MUST follow existing parsing rules.
2. String source metadata: metadata keys with string values MUST be preserved in `SkillMetadata.sourceMetadata`.
3. Supported array source metadata: keys `exclusiveWith`, `compatibleWith`, `tags` with non-empty array of safe strings MUST be preserved in `SkillMetadata.sourceMetadata`.
4. Reserved extension wrapper: the key `extension` MUST be treated as the reserved wrapper key. Its value MUST be a JSON object; each entry MUST be validated against extension safety rules and flattened into `SkillMetadata.extension.<name>`. A non-object `metadata.extension` value MUST reject the manifest with reason code `INVALID_OFFICIAL_FIELD`.
5. Invalid direct-form object: a metadata key other than `extension` with a nested object value MUST reject the manifest with reason code `INVALID_OFFICIAL_FIELD`, because extension data is only accepted under the `metadata.extension` wrapper and direct-form object metadata is invalid official metadata shape per the `Unknown metadata Does Not Carry Governed Meaning` requirement.

Metadata keys MUST NOT appear in both `sourceMetadata` and `extension`. If the same key appears in both categories due to parsing logic, the parser MUST reject the manifest with reason code `INVALID_OFFICIAL_FIELD`.

#### Scenario: String metadata preserved in sourceMetadata

- **WHEN** a metadata key has a string value and is not a governed metadata key
- **THEN** the key-value MUST be preserved in `SkillMetadata.sourceMetadata`

#### Scenario: Array metadata preserved in sourceMetadata for supported keys

- **WHEN** a metadata key is one of `exclusiveWith`, `compatibleWith`, `tags`
- **AND** the value is a non-empty array of safe non-empty strings
- **THEN** the key-value MUST be preserved in `SkillMetadata.sourceMetadata`

#### Scenario: Wrapper entry preserved in extension

- **WHEN** `metadata.extension.<name>` declares a value that satisfies extension safety rules
- **THEN** the entry MUST be preserved in `SkillMetadata.extension.<name>` flattened from the wrapper
- **AND** no `extension.extension.*` double-nested entry MUST be produced

### Requirement: Skill Manifest Tool Constraints SHALL Accept Canonical and Compatible List Forms

The Skill manifest parser SHALL keep `allowed-tools` as the canonical top-level tool allow-list field. The parser SHALL accept `allowed-tools` as either a whitespace-separated string or a YAML string list. The parser SHALL also accept top-level `tools` as a compatibility alias for `allowed-tools`.

When both `allowed-tools` and `tools` are declared with non-empty values, the parser SHALL reject the manifest with an invalid tool constraint diagnostic. The compatibility alias SHALL NOT create a new public Skill metadata field; accepted values SHALL map to the existing `allowedTools` Skill metadata.

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

The Skill manifest parser SHALL accept metadata `denied-tools` as either a whitespace-separated string or a YAML string list. Accepted values SHALL map to existing `deniedTools` Skill metadata.

#### Scenario: Denied tools list loads
- **WHEN** a Skill manifest declares `metadata.denied-tools` as a YAML list
- **THEN** manifest parsing SHALL accept the Skill.
- **AND** descriptor mapping SHALL expose the list through existing `deniedTools` Skill metadata.

### Requirement: Extension Key Whitelist For Api Header Params

The skill manifest parser SHALL whitelist the `api_header_params` extension key, allowing it to bypass the `unsafeKeyPattern` check that would otherwise reject keys containing `header`. This whitelist is a controlled exception to the uniform key safety policy. It applies only to the exact key name `api_header_params` and does not affect other keys.

#### Scenario: api_header_params key is accepted

- **WHEN** a skill manifest provides `metadata.extension.api_header_params` with a safe string value
- **THEN** the parser MUST accept the key without `EXTENSION_OMITTED` diagnostic
- **AND** the value MUST be preserved in `SkillMetadata.extension`

#### Scenario: Other header-containing keys are still rejected

- **WHEN** a skill manifest provides `metadata.extension.authorization_header` or similar header-containing keys
- **THEN** the parser MUST still apply `unsafeKeyPattern` and reject or omit the key
- **AND** the whitelist MUST NOT apply to keys other than `api_header_params`

### Requirement: Governed Behavior May Consume Specific Extension Keys

The orchestration layer (`agent-core` routing) MAY read `extension._naie_agentic_loop_flag` through `readSkillMetadata(descriptor).extension` to control execution path. This is a controlled exception to the "governed behavior does not consume extension" principle. The exception applies only to `_naie_agentic_loop_flag`. `_naie_pass_through_flag` is a reserved field not consumed by governed behavior. `api_header_params` and `api_request_params` MUST NOT be consumed by governed behavior directly; they MUST be read by the Skill tool from extension and passed in the tool result for the orchestration layer and API tool to consume.

#### Scenario: Orchestration layer reads agentic loop flag

- **WHEN** the orchestration layer needs to determine the execution path for a skill
- **THEN** it MAY read `readSkillMetadata(descriptor).extension._naie_agentic_loop_flag`
- **AND** if the value is `"false"`, it MUST trigger the non-agentic API call path

#### Scenario: api_header_params not consumed by governed behavior

- **WHEN** the orchestration layer processes a skill
- **THEN** it MUST NOT read `extension.api_header_params` directly
- **AND** `api_header_params` MUST be read by the Skill tool from extension and passed in the tool result (not read by governed behavior or the API tool directly from extension)

### Requirement: Skill Manifest Diagnostic Includes Unsupported Encoding Reason Code

The public `SkillManifestDiagnostic` reason code set MUST include `SKILL_MD_UNSUPPORTED_ENCODING` for this change.

When a `SKILL.md` is detected with an encoding that is not UTF-8 (with or without BOM), manifest validation MUST reject the manifest with a diagnostic whose `reasonCode` is `SKILL_MD_UNSUPPORTED_ENCODING`, `severity` is `ERROR`, and `outcome` is `rejected`. The message MUST state that the manifest must be UTF-8 text (BOM optional) and MUST NOT expose raw byte content, byte prefixes, the detected encoding name, raw paths, or file contents.

- **Owner Function**: Skill Manifest Contract
- **Function Change Type**: MODIFIED
- **Spec Role**: Incremental requirement
- **Requirement Category**: Correctness / Security

#### Scenario: Unsupported encoding produces a safe diagnostic

- **WHEN** a `SKILL.md` is encoded as UTF-16 LE, UTF-16 BE, GBK, or any encoding that cannot be decoded as UTF-8, or contains binary content such as NUL bytes
- **THEN** manifest validation MUST reject the manifest
- **AND** the diagnostic MUST use `reasonCode` `SKILL_MD_UNSUPPORTED_ENCODING`, `severity` `ERROR`, and `outcome` `rejected`
- **AND** the diagnostic message MUST NOT expose raw byte content, byte prefixes, the detected encoding name, or file contents

#### Scenario: Unsupported encoding is not mislabeled as missing

- **WHEN** a `SKILL.md` file exists and is readable but uses an unsupported encoding
- **THEN** the diagnostic `reasonCode` MUST be `SKILL_MD_UNSUPPORTED_ENCODING`
- **AND** the diagnostic `reasonCode` MUST NOT be `SKILL_MD_MISSING`

### Requirement: Skill Manifest Reader Validates Text Encoding Through Shared Decode

The Skill manifest reader MUST decode raw `SKILL.md` bytes through a single shared BOM-aware decode helper on both the discovery path and the invocation path. The discovery path (`parseMetadataViewFromFile`) and the invocation path (`loadCanonicalBodyViewFromFile`) MUST share the same decode helper, the same BOM-stripping behavior, the same encoding-acceptance policy, and the same frontmatter-boundary detection semantics.

The acceptance policy MUST be UTF-8 only. UTF-8 with or without a BOM MUST be accepted; a UTF-8 BOM MUST be stripped before parsing. UTF-16 LE, UTF-16 BE, GBK, and any encoding that cannot be decoded as UTF-8 (including binary content) MUST be rejected with `SKILL_MD_UNSUPPORTED_ENCODING`.

The reader MAY read the full file to validate encoding; a bounded leading slice cannot reveal a non-UTF-8 body. The parser MUST continue to consume only the leading frontmatter block and MUST NOT require the full markdown body as parser input. The frontmatter consistency token (hash) computed on the discovery path MUST equal the consistency token computed on the invocation path for the same file.

- **Owner Function**: Skill Manifest Contract
- **Function Change Type**: MODIFIED
- **Spec Role**: Incremental requirement
- **Requirement Category**: Correctness

#### Scenario: UTF-8 with BOM is accepted on both paths

- **WHEN** a `SKILL.md` begins with a UTF-8 BOM followed by valid UTF-8
- **THEN** discovery MUST accept the manifest with the BOM stripped
- **AND** invocation MUST load the canonical body with the BOM stripped
- **AND** the BOM MUST NOT appear in the descriptor description, the canonical body, or the frontmatter consistency token

#### Scenario: UTF-16 is rejected with an accurate reason code

- **WHEN** a `SKILL.md` is encoded as UTF-16 LE or UTF-16 BE
- **THEN** discovery MUST reject the manifest with `reasonCode` `SKILL_MD_UNSUPPORTED_ENCODING`
- **AND** the Skill MUST NOT enter the executable capability catalog
- **AND** invocation MUST NOT load the canonical body

#### Scenario: GBK is rejected with an accurate reason code

- **WHEN** a `SKILL.md` is encoded as GBK, whether the frontmatter is ASCII with a GBK body or the frontmatter itself contains GBK bytes
- **THEN** discovery MUST reject the manifest with `reasonCode` `SKILL_MD_UNSUPPORTED_ENCODING`
- **AND** the Skill MUST NOT enter the executable capability catalog

#### Scenario: Discovery and invocation share decode semantics

- **WHEN** the system loads a `SKILL.md` on the discovery path and on the invocation path
- **THEN** both paths MUST use the same shared decode helper and the same encoding-acceptance policy
- **AND** the frontmatter consistency token computed on the discovery path MUST equal the token computed on the invocation path for the same file
