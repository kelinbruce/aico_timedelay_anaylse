<!--
本文件是 active change 的行为规格 delta，路径为 specs/skill-manifest-contract/spec.md。
归档后，仍然成立的行为契约会同步到 openspec/specs/skill-manifest-contract/spec.md。
-->

## MODIFIED Requirements

### Requirement: Skill Manifest Produces Typed Skill Capability Metadata

The manifest contract MUST produce typed `SkillMetadata` for `CapabilityDescriptor.metadata` when the descriptor `kind` is `SKILL`. `SkillMetadata` MUST be owned by `agent-contracts/capability` as the public metadata schema. Parser implementation details and parser-process frontmatter objects remain owned by `agent-capability`.

Accepted or degraded manifest validation MUST produce a Skill descriptor input and safe diagnostics. For Skill descriptors, the validated Skill `name` MUST map to `CapabilityDescriptor.capabilityId` and the model-visible display name. The validated Skill `description` MUST map to `CapabilityDescriptor.description`. If `metadata.version` is present, it MUST map to `CapabilityDescriptor.version` as a common Skill metadata key and MUST NOT require a `nextagent` prefix. The descriptor `metadata` MUST validate as `SkillMetadata` and include a discriminator, `context`, `userInvocable`, `modelInvocable`, optional `agent`, optional allowed tool constraints, optional denied tool constraints, optional `model`, optional `modelOptions`, optional safe source metadata, and optional safe extension metadata. The normalized metadata fields MUST preserve `context`, `agent`, `model`, `userInvocable`, and `modelInvocable` as the field names.

#### Scenario: Accepted manifest produces typed descriptor metadata

- **WHEN** a Skill manifest is accepted
- **THEN** downstream source and governance flows MUST receive a Skill `CapabilityDescriptor` input whose `metadata` validates as `SkillMetadata`
- **AND** the exchanged payload MUST remain limited to governed descriptor fields, typed metadata, and safe diagnostics

## ADDED Requirements

### Requirement: Skill Metadata Extension Supports Nested Object Values

The system MUST support `extension` field in `SkillMetadata` to carry structured metadata values. The `extension` field MUST be optional. Each value MUST be a primitive (string, number, boolean, or null) or a recursively nested Map (JsonObject); array values MUST NOT be part of the public schema and MUST be omitted with an `EXTENSION_OMITTED` diagnostic when encountered by the manifest parser.

The `metadata.extension` key in SKILL.md frontmatter is a reserved wrapper key. Its value MUST be a JSON object whose entries form the extension map. The parser MUST flatten each entry into `SkillMetadata.extension.<name>` and MUST NOT produce `extension.extension.*` double nesting. Extension data MUST NOT be declared via `metadata.<非 extension 名>: {object}` direct form; such direct-form object values remain invalid official metadata shape per the `Unknown metadata Does Not Carry Governed Meaning` requirement and MUST reject the manifest.

Extension key names MUST be valid:
- Key length MUST be 1-128 characters.
- Key MUST NOT match unsafe key pattern (containing `api_key`, `authorization`, `base_url`, `credential`, `endpoint`, `headers`, `password`, `secret`, `token`, or `url`).
- Reserved keys `sourceIdentity`, `frontmatterHash`, `metadataKind` MUST NOT be used as extension keys.

Extension values MUST be safe:
- Value MAY be a primitive (string, number, boolean, or null) or a Map (JsonObject); array values MUST NOT be supported.
- Value nesting depth MUST NOT exceed 3 levels.
- Map (JsonObject) entries MUST satisfy the same key safety rules; nested values MAY be primitives or Maps and MUST NOT be arrays.
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

#### Scenario: Array extension value is omitted with degraded diagnostic

- **WHEN** a `metadata.extension` entry value is a JSON array
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
