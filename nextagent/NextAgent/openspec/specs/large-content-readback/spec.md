# large-content-readback Specification

## Purpose
TBD - created by archiving change add-large-tool-result-paged-readback. Update Purpose after archive.
## Requirements
### Requirement: Model can read back externalized tool results via the workspace file path with bounded pages

The runtime SHALL realize the `large-content-readback` capability through the existing `read` tool without adding any new input parameter or new tool. Externalized tool results SHALL be persisted as a real file in the execution workspace at `tool-results/<refId>.txt` (under the readWrite `workspace/` root), and the model-visible `PERSISTED_PREVIEW` SHALL carry that `file_path`. When the model invokes `read` with that `file_path`, `workspaceFiles.readText` SHALL read it as a normal workspace file and return a bounded line page reusing the same optional `offset` / `limit`, `truncated`, and `nextOffset` semantics the `read` tool already uses for any workspace file. `offset` and `limit` MAY be omitted, in which case the read tool SHALL apply its existing defaults. If an omitted or too-large limit would require returning more content than the configured single-call text budget, the read tool SHALL fail with a safe paging-required error that tells the model the file is too large for one read and must be paged with explicit `offset` / `limit`; it SHALL NOT silently truncate the page as if it were complete. The capability SHALL NOT require the model to know blob ids, tenant/subject identifiers, or any non-workspace storage path.

#### Scenario: Model retrieves a bounded page of a large tool result

- **WHEN** the model invokes `read` with `file_path` (`tool-results/<refId>.txt`) and explicit `offset` / `limit`
- **THEN** the runtime returns the corresponding bounded line page of the original content
- **AND** the response carries `truncated` and `nextOffset` indicating whether and where more content remains
- **AND** the response does not require the model to supply a blob id or tenant identifier

#### Scenario: Model pages forward through a large tool result

- **WHEN** the model invokes `read` with increasing `offset` (or the returned `nextOffset`) values
- **THEN** successive responses cover the original content in order without overlap or gaps
- **AND** the final page reports `truncated = false` with no `nextOffset`

### Requirement: Readback is owner-scoped via the execution workspace

Readback SHALL enforce owner scope through the execution workspace resolver, which scopes the workspace root by `tenantId` / `subjectId` / `sessionId`. A `file_path` whose underlying file does not exist in the requesting owner scope's workspace SHALL NOT return content; the runtime SHALL surface the `read` tool's `error: "FILE_UNAVAILABLE"` form and SHALL NOT leak the original content, the owning identity, or any cross-scope file content through the failure path. Paged reads through the readback capability SHALL proceed only on the authorized `read` tool path.

#### Scenario: Cross-scope readback is rejected without leakage

- **WHEN** the model invokes `read` with a `file_path` whose file does not exist in the requesting owner scope's workspace
- **THEN** the runtime returns `error: "FILE_UNAVAILABLE"`
- **AND** the original content, owning identity, and any cross-scope file content are not exposed

#### Scenario: Missing or unreadable file degrades safely

- **WHEN** the workspace file is missing, removed, or unreadable
- **THEN** `read` returns `error: "FILE_UNAVAILABLE"`
- **AND** the failure path does not expose any partial original content

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

### Requirement: Out-of-range readback returns an empty page rather than an error

Readback SHALL NOT raise an error when `offset` is at or beyond the end of the available content. Instead it SHALL return an empty page (`content` empty, `truncated = false`, no `nextOffset`) so the model can detect the end of content. A missing or unreadable file is the only failure condition and is handled as `error: "FILE_UNAVAILABLE"`, not as a paging error.

#### Scenario: Offset beyond end returns empty page

- **WHEN** the model invokes `read` with a `file_path` and `offset` at or beyond the content length
- **THEN** the runtime returns an empty page
- **AND** the response reports `truncated = false` with no `nextOffset`
- **AND** no error is raised for the end-of-content condition
