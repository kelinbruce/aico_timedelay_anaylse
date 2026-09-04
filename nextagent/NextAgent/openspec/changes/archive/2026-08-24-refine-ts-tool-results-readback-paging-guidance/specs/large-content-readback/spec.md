## Function

- **所属 Function**：`FN-4.6 分页查看大结果`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Read tool is exempt from externalization to prevent readback loops

The `read` tool SHALL be exempt from the large-content externalization path: its output SHALL be a bounded page governed by optional `offset` / `limit` parameters and SHALL NOT be replaced by a `PERSISTED_PREVIEW` / `SPECIALIZED_REF` form even when a requested page would otherwise exceed the inline threshold. This exemption SHALL apply to all `read` outputs and SHALL prevent the read-readback-externalize-readback loop.

For `tool-results/<refId>.txt` readback specifically, the runtime SHALL enforce a dedicated single-call text budget of `65536` bytes or the configured `workspaceFiles.maxTextBytes`, whichever is smaller. When the requested default or explicit range would exceed that budget, `read` SHALL return a safe `PAGING_REQUIRED` result rather than inline the oversized page. The paging failure MUST include actionable safe details with the current byte budget, requested `offset`, requested `limit`, selected slice byte size, and a concrete `suggestedLimit` for retrying the same `offset`. If `limit=1` and the single requested line itself exceeds the budget, the runtime MAY return a bounded head with `truncated=true` so the model is not dead-locked.

**需求类别**：功能性需求

#### Scenario: Read output is never externalized

- **WHEN** a `read` page is assembled into model-visible context
- **THEN** the page is delivered inline as the model-visible content
- **AND** the page is not replaced by a `PERSISTED_PREVIEW` or `SPECIALIZED_REF` form
- **AND** no recursive externalization of the read result occurs

#### Scenario: Read enforces paging through optional parameters

- **WHEN** the model invokes `read`
- **THEN** omitted `offset` and `limit` are defaulted by the existing read schema
- **AND** provided `offset` and `limit` are honored as paging parameters (with `limit` bounded by policy)
- **AND** the returned page size is bounded

#### Scenario: Oversized single read tells the model to page

- **WHEN** the model invokes `read` for a file whose requested default or explicit range is too large for the configured single-call text budget
- **THEN** the runtime returns a safe paging-required error
- **AND** the error tells the model to retry with explicit `offset` and `limit`
- **AND** the response does not include an ambiguous silently truncated page

#### Scenario: Tool-results 回读使用 64 KiB 专用单次预算

- **WHEN** the model invokes `read` for `tool-results/<refId>.txt`
- **AND** the requested default or explicit range would exceed `65536` bytes
- **THEN** the runtime returns `error: "PAGING_REQUIRED"`
- **AND** it does not inline the oversized readback page into the tool result
- **AND** the safe failure details include a `suggestedLimit` that can be retried with the same `offset`

#### Scenario: 回读建议行数基于实际选中行

- **WHEN** the requested `limit` is larger than the remaining line count
- **AND** the selected slice exceeds the single-call text budget
- **THEN** the runtime MUST calculate retry guidance from the actual selected line count
- **AND** the suggested limit MUST be at least `1`

## Function 变更汇总

### 规格

- **规格项**：`tool-results` 回读单次文本预算
- **变更类型**：修改
- **原规格值**：受 configured single-call text budget 约束，未定义 `tool-results` 专用数值预算
- **目标规格值**：`tool-results/<refId>.txt` 回读使用 `65536` bytes 与 `workspaceFiles.maxTextBytes` 中较小者作为单次文本预算
- **依据 Requirements**：`Read tool is exempt from externalization to prevent readback loops`

### 结果

- **变更类型**：修改
- **目标内容**：oversized `tool-results` 回读返回 safe `PAGING_REQUIRED`，并携带可用同一 `offset` 重试的 `suggestedLimit`、字节预算和切片字节证据
- **依据 Requirements**：`Read tool is exempt from externalization to prevent readback loops`
