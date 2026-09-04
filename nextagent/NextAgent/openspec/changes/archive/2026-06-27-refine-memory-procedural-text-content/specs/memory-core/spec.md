# memory-core Delta

## MODIFIED Requirements

### Requirement: Long-term memory core contract

The system SHALL define stable long-term memory gateway contracts for category-specific memory content. `MemoryContentByCategory` is a discriminated union keyed by `content.category`, and it MUST match the top-level `LongTermMemoryRecord.category` / `SaveLongTermMemoryRequest.category`.

- `FACTUAL` requires `subject` and `claim` and MAY include safe summarized `evidence[]` and `qualifiers[]`.
- `CONCEPTUAL` requires `concept` and `definition` and MAY include `aliases[]` and `relatedConcepts[]`.
- `PROCEDURAL` requires `procedureName` and non-empty `procedureText`.
- `USER_CHARACTERISTICS` requires non-empty `traits[]` and non-empty `purpose[]` from `PERSONALIZATION | TROUBLESHOOTING | WORKFLOW_ADAPTATION | GENERAL`.

`PROCEDURAL` core content MUST NOT require `steps[]` for persistence. A storage implementation MUST store the `PROCEDURAL` payload in the existing category-specific JSON content field and MUST NOT add dedicated SQLite columns for procedural text.

#### Scenario: Valid procedural text memory is saved

- **WHEN** `saveLongTermMemory(category="PROCEDURAL", content={ category: "PROCEDURAL", procedureName: "切换失败排查流程", procedureText: "先确认链路质量，再核对邻区配置，最后复测切换成功率。" })` is invoked
- **THEN** the gateway MUST save the memory as ACTIVE
- **AND** the retained `content_json` MUST contain `procedureName` and `procedureText`
- **AND** the `long_term_memory` table schema MUST NOT require a dedicated steps or procedure text column.

#### Scenario: Procedural text is required

- **WHEN** `saveLongTermMemory(category="PROCEDURAL", content={ category: "PROCEDURAL", procedureName: "BGP check" })` is invoked
- **THEN** the gateway MUST reject the write as invalid.
