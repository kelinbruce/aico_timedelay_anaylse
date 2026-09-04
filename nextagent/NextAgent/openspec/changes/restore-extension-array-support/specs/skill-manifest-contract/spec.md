## MODIFIED Requirements

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

