# memory-tools Delta

## MODIFIED Requirements

### Requirement: Memory add tool writes explicit user memory only

The `add_memory` tool SHALL add a new ACTIVE long-term memory only when the current user explicitly asks the model to remember it. The tool MUST inject trusted owner and agent scope from the capability execution context and MUST NOT accept tenant, subject or agent scope from model input.

For `FACTUAL` content use `subject` and `claim`. For `CONCEPTUAL` content use `concept` and `definition`. For `PROCEDURAL` content use `procedureName` and `procedureText`. For `USER_CHARACTERISTICS` content use `traits` and `purpose`, or a short string normalized to a general user characteristic. The tool MUST NOT use memory writes for temporary session context, public/general knowledge, large raw code/log/table content, inferred observations, or possible duplicates/conflicts.

`content` MUST be normalized before writing to the gateway. The gateway write MUST receive only core-defined category-specific content. `PROCEDURAL` tool input MAY be a structured object, a JSON-string object, or a non-empty procedural text string. When `category="PROCEDURAL"` and the input is text, the tool MUST preserve that text as `procedureText`; it MAY use `briefIndex` as `procedureName` when no explicit `procedureName` is available.

#### Scenario: Procedural text input is normalized

- **WHEN** the model calls `add_memory(category="PROCEDURAL", briefIndex="切换失败排查流程", content="先确认链路质量，再核对邻区配置，最后复测切换成功率。")`
- **THEN** the tool MUST call `saveLongTermMemory` with content `{ category: "PROCEDURAL", procedureName: "切换失败排查流程", procedureText: "先确认链路质量，再核对邻区配置，最后复测切换成功率。" }`
- **AND** it MUST NOT require `steps[]`.

#### Scenario: Procedural JSON-string input is normalized

- **WHEN** the model calls `add_memory(category="PROCEDURAL", content="{\"procedureName\":\"切换失败排查流程\",\"procedureText\":\"先确认链路质量。\"}")`
- **THEN** the tool MUST parse the JSON object safely
- **AND** it MUST call `saveLongTermMemory` with normalized procedural text content.
