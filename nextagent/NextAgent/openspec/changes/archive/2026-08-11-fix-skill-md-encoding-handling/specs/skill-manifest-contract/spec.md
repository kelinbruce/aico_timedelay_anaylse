# Skill Manifest Encoding Handling

## ADDED Requirements

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

## Function 变更汇总

- ADDED `Skill Manifest Diagnostic Includes Unsupported Encoding Reason Code`: 新增 `SKILL_MD_UNSUPPORTED_ENCODING` reason code，编码不支持时 MUST 以该码拒绝，不得误标为 `SKILL_MD_MISSING`。
- ADDED `Skill Manifest Reader Validates Text Encoding Through Shared Decode`: discovery 与 invocation 共用同一 BOM 感知 decode 助手，UTF-8（含 BOM，剥离）接受，UTF-16/GBK/二进制以 `SKILL_MD_UNSUPPORTED_ENCODING` 拒绝，frontmatter 一致性 token 在两路径一致。
