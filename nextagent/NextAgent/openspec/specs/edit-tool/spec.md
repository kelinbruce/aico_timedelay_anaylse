# edit-tool Specification

## Purpose
Define the governed builtin `Edit` Tool for exact-string, snapshot-guarded file updates inside authorized workspace write directories.
## Requirements
### Requirement: Edit Is A Governed Builtin Tool

The system SHALL define a PascalCase `Edit` Tool through `defineTool`, register it explicitly in the owned builtin Tool list, and execute it only through the existing Tool catalog, `BuiltinToolExecutor`, capability invocation, and controlled `workspaceFiles` dependency boundaries.

Edit SHALL declare replay policy `NON_IDEMPOTENT` and require only the controlled `workspaceFiles` dependency. It SHALL NOT receive `CapabilityInvocationRequest`, workspace root, host paths, or host filesystem APIs.

#### Scenario: Edit is explicitly registered and available

- **WHEN** the builtin Tool catalog is composed with `workspaceFiles`
- **THEN** the catalog MUST include an `AVAILABLE` `Edit` descriptor
- **AND** Edit MUST be model-visible according to existing Agent binding governance
- **AND** the descriptor MUST use PascalCase `Edit` as the canonical capabilityId

#### Scenario: Edit schema uses file_path not path alias

- **WHEN** the Edit Tool descriptor is listed
- **THEN** `inputSchema` MUST require `file_path` (not `path`, `filePath`, or `absolutePath`)
- **AND** `inputSchema.required` MUST contain `["file_path", "old_string", "new_string"]`
- **AND** `inputSchema.properties.old_string` MUST have `minLength: 1`

### Requirement: Edit Uses Snapshot-Based Freshness Guard

Edit SHALL require a complete Read snapshot for the target file, established by a prior full Read (`offset=0`, `truncated=false`) in the same `agentId + agentVersion + runId`. Missing full Read state SHALL fail with `EDIT_REQUIRES_FULL_READ` and category `CONFLICT`.

Edit SHALL detect target changes between the Read snapshot and the current on-disk state. Edit SHALL compare the target with its recorded state before entering the mutation section and again immediately before filesystem replacement. A changed target SHALL fail with `EDIT_TARGET_CHANGED` and category `CONFLICT`. After a successful Edit, the snapshot SHALL be updated to the new content.

#### Scenario: Edit requires prior full Read

- **WHEN** Edit targets an existing file without a current full Read snapshot
- **THEN** invocation MUST fail with `EDIT_REQUIRES_FULL_READ`
- **AND** no filesystem side effect may occur

#### Scenario: Edit detects stale snapshot

- **WHEN** a full Read is performed
- **AND** the file is modified externally before Edit
- **THEN** Edit MUST fail with `EDIT_TARGET_CHANGED`
- **AND** the original file MUST remain unchanged

#### Scenario: Edit detects target changes before replacement

- **WHEN** the target state immediately before replacement differs from the state observed after snapshot validation
- **THEN** Edit MUST fail with `EDIT_TARGET_CHANGED`
- **AND** the current target MUST remain unchanged

#### Scenario: Edit updates snapshot on success

- **WHEN** a full Read is performed
- **AND** Edit successfully modifies the file
- **THEN** the snapshot MUST be updated to the edited content
- **AND** a subsequent Write without re-Read MUST succeed against the updated snapshot

### Requirement: Edit Supports Exact String Replacement Semantics

Edit SHALL find all exact occurrences of `old_string` in the existing file content. When `replace_all` is false (default), exactly one occurrence MUST exist; zero occurrences SHALL fail with `EDIT_STRING_NOT_FOUND`; multiple occurrences SHALL fail with `EDIT_STRING_NOT_UNIQUE`. When `replace_all` is true, all occurrences SHALL be replaced; zero occurrences SHALL fail with `EDIT_STRING_NOT_FOUND`.

#### Scenario: Unique old_string replaced successfully

- **WHEN** `old_string` appears exactly once in the file
- **AND** `replace_all` is false
- **THEN** that single occurrence MUST be replaced with `new_string`
- **AND** result MUST have `replaced_count: 1`

#### Scenario: replace_all replaces all occurrences

- **WHEN** `old_string` appears multiple times in the file
- **AND** `replace_all` is true
- **THEN** ALL occurrences MUST be replaced
- **AND** result MUST have `replaced_count` equal to the number of occurrences

#### Scenario: Non-unique old_string without replace_all fails

- **WHEN** `old_string` appears multiple times in the file
- **AND** `replace_all` is false
- **THEN** Edit MUST fail with `EDIT_STRING_NOT_UNIQUE`
- **AND** the file MUST remain unchanged

#### Scenario: old_string not found fails

- **WHEN** `old_string` does not appear anywhere in the file
- **THEN** Edit MUST fail with `EDIT_STRING_NOT_FOUND`

### Requirement: Edit Preserves File Encoding

Edit SHALL detect and preserve the encoding of the existing file. Supported encodings SHALL include UTF-8 without BOM, UTF-8 with BOM, UTF-16 LE with BOM, and UTF-16 BE with BOM. The output file SHALL be written using the same encoding as the input file.

#### Scenario: UTF-8 file encoding is preserved after Edit

- **WHEN** a UTF-8 (without BOM) file is edited
- **THEN** the output file MUST be encoded as UTF-8 without BOM
- **AND** the content fingerprint MUST match the expected edited content

### Requirement: Edit Targets Must Exist

Edit SHALL require the target file to exist. Creating new files SHALL NOT be allowed through Edit (use Write for that). A non-existent target SHALL fail with `EDIT_TARGET_MISSING`.

#### Scenario: Edit fails for non-existent file

- **WHEN** `file_path` refers to a file that does not exist
- **THEN** Edit MUST fail with `EDIT_TARGET_MISSING`

### Requirement: Edit Uses Atomic Replacement

Edit SHALL construct the new file content in memory, write it to a unique temporary file in the target directory, flush the complete encoded content, and atomically replace the target via platform rename. It SHALL clean up temporary files on pre-replacement failure or cancellation.

#### Scenario: Atomic replacement preserves original on failure

- **WHEN** Edit encounters any error after writing the temp file but before rename
- **THEN** the original target MUST remain unchanged
- **AND** the implementation MUST clean up its own temporary file

### Requirement: Edit Snapshot Is Cleared By clearRun

Edit and Write snapshots SHALL be scoped to a run and cleared together when `clearRun` is called. After `clearRun`, Edit SHALL require a new full Read.

#### Scenario: clearRun invalidates Edit authority

- **WHEN** a full Read snapshot exists
- **AND** `clearRun` is called for that run
- **THEN** a subsequent Edit MUST fail with `EDIT_REQUIRES_FULL_READ`

### Requirement: Edit Results And Observability Are Safe

Successful results SHALL return only type, normalized workspace-relative path, `old_string`, `new_string`, `replaced_count`, and `replace_all`. Existing tool-use/result persistence and `toolCallId` correlation SHALL provide traceability.

Logs, audit, trace, metrics, SafeError, availability reasons, and result metadata MUST NOT contain full file content, old content, new content, diff, host absolute path, temporary name, workspace root, directory configuration, or file fingerprint.

#### Scenario: Edit failure does not leak content

- **WHEN** Edit execution fails for any reason
- **THEN** the error output MUST NOT contain the file content, `old_string`, or `new_string`

### Requirement: Edit file extension authorization

Edit SHALL 在检查目标存在性、full-Read snapshot、字符串匹配或读取内容之前，使用当前 accepted Agent/version 的写入 extension policy 按 deny-first 顺序检查已规范化目标文件名。比较和无后缀语义 MUST 与 Read 相同。未授权目标 MUST 以 `CAPABILITY_PATH_REJECTED` 安全失败，不得读取或修改文件，也不得泄漏目标是否存在或字符串是否匹配。该 extension-policy failure MUST 作为可恢复 Tool observation 返回模型，MUST NOT 直接终止 Agentic loop 或把 request/run 提交为 terminal failure。

#### Scenario: Rejected extension can be corrected in the same loop
- **WHEN** 模型先调用 Edit 编辑未授权后缀，随后根据安全错误选择允许的文件操作
- **THEN** 首次调用 SHALL 返回 `CAPABILITY_PATH_REJECTED`，同一 request/run SHALL 保持可执行并继续处理后续 Tool call

#### Scenario: Rejected extension is projected to the corresponding Tool Calling result
- **WHEN** Edit rejects a target through the workspace extension policy
- **THEN** the stream SHALL include a `CAPABILITY_RESULT_DELTA` correlated by the same `toolCallId`, containing the safe failure status, code, category, and non-sensitive extension-policy summary so the browser can attach the error to that Tool Calling result
- **AND** the result projection SHALL NOT expose the target path, configured extension lists, file existence, matched text, or file content

#### Scenario: Allowed extension can be edited
- **WHEN** 写入 allowlist 为 `[".yaml"]` 且目标最终后缀为 `.yaml`
- **THEN** Edit SHALL 在满足既有目录、full-Read、唯一匹配和大小约束后执行替换

#### Scenario: Disallowed extension is rejected before edit preconditions
- **WHEN** 写入 allowlist 为 `[".yaml"]` 且目标为 `workspace/script.sh`
- **THEN** Edit SHALL 返回 `CAPABILITY_PATH_REJECTED`，不得通过 snapshot 或字符串匹配错误泄漏目标事实且不得改变文件

#### Scenario: Edit requires independent read and write authorization
- **WHEN** 写入 allowlist 允许 `.yaml`，但读取 allowlist 不允许 `.yaml`
- **THEN** Read SHALL 无法为 `workspace/config.yaml` 建立 full-Read snapshot，Edit SHALL 保持既有 `EDIT_REQUIRES_FULL_READ` 前置条件且不得修改文件

#### Scenario: Edit denylist overrides allowlist
- **WHEN** `.yaml` 同时位于写入 allowlist 和 denylist，且已存在历史 snapshot
- **THEN** Edit SHALL 返回 `CAPABILITY_PATH_REJECTED` 且不得读取或修改目标
