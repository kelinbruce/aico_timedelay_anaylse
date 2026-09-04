## Function

- **所属 Function**：`FN-4.6 分页查看大结果`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Model can read back externalized tool results via the workspace file path with bounded pages

The runtime SHALL realize the `large-content-readback` capability through the existing `read` tool without adding any new input parameter or new tool. Externalized tool results SHALL be persisted as a real file in the execution workspace at `tool-results/<refId>.txt` (under the readWrite `workspace/` root), and the model-visible `PERSISTED_PREVIEW` SHALL carry that `file_path`. When the model invokes `read` with that `file_path`, `workspaceFiles.readText` SHALL read it as a normal workspace file and return a bounded line page reusing the same optional `offset` / `limit`, `truncated`, and `nextOffset` semantics the `read` tool already uses for any workspace file. `offset` and `limit` MAY be omitted, in which case the read tool SHALL apply its existing defaults. If an omitted or too-large limit would require returning more content than the configured single-call text budget, the read tool SHALL fail with a safe paging-required error that tells the model the file is too large for one read and must be paged with explicit `offset` / `limit`; it SHALL NOT silently truncate the page as if it were complete. The capability SHALL NOT require the model to know blob ids, tenant/subject identifiers, or any non-workspace storage path.

**需求类别**：功能性需求

#### Scenario: Model retrieves a bounded page of a large tool result

- **WHEN** the model invokes `read` with `file_path` (`tool-results/<refId>.txt`) and explicit `offset` / `limit`
- **THEN** the runtime returns the corresponding bounded line page of the original content
- **AND** the response carries `truncated` and `nextOffset` indicating whether and where more content remains
- **AND** the response does not require the model to supply a blob id or tenant identifier

#### Scenario: Model pages forward through a large tool result

- **WHEN** the model invokes `read` with increasing `offset` (or the returned `nextOffset`) values
- **THEN** successive responses cover the original content in order without overlap or gaps
- **AND** the final page reports `truncated = false` with no `nextOffset`

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：外置 Capability 结果由既有 read Tool 按 workspace 相对路径和 `offset`/`limit` 返回有界行页，并通过 `truncated` 与 `nextOffset` 显式声明后续内容；本 spec 是该分页行为的唯一规范 owner。
- **依据 Requirements**：`Model can read back externalized tool results via the workspace file path with bounded pages`
