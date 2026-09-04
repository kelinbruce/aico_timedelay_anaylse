# write-tool Specification

## Purpose
Defines the governed `write` builtin Tool for agent-scoped workspace text file creation and full overwrite. Uses the shared `workspaceFiles` dependency, enforces trusted directory authority, full-Read precondition, concurrent change detection, and atomic replacement with safe output.
## Requirements
### Requirement: Write Is A Governed Builtin Tool

The system SHALL define a lowercase `write` Tool through `defineTool`, register it explicitly in the owned builtin Tool list, and execute it only through the existing Tool catalog, `BuiltinToolExecutor`, capability invocation, and controlled `workspaceFiles` dependency boundaries.

Write SHALL declare replay policy `NON_IDEMPOTENT` and require only the controlled `workspaceFiles` dependency in the current release. It SHALL NOT receive `CapabilityInvocationRequest`, workspace root, host paths, or host filesystem APIs.

#### Scenario: Write is explicitly registered and available without approval

- **WHEN** the builtin Tool catalog is composed with `workspaceFiles` and without the future `approval` readiness dependency
- **THEN** the catalog MUST include an `AVAILABLE` `write` descriptor
- **AND** Write MUST be model-visible according to existing Agent binding governance
- **AND** the system MUST NOT fabricate approval evidence or create a private confirmation flow

### Requirement: Existing Files Require A Current Full Read

An existing target SHALL be writable only when the same `agentId + agentVersion + runId` has a complete Read snapshot for the normalized path. Only one Read beginning at offset zero and returning `truncated=false` SHALL establish that snapshot; partial reads SHALL NOT be combined into write authority.

Missing full Read state SHALL fail with `WRITE_REQUIRES_FULL_READ` and category `CONFLICT`. A successful Write SHALL update the same run-local full Read snapshot to the newly written content. Snapshots SHALL remain process-local and SHALL be discarded after the run, restart, or recovery.

#### Scenario: Existing file was not fully read

- **WHEN** Write targets an existing file without a current full Read snapshot
- **THEN** invocation MUST fail with `WRITE_REQUIRES_FULL_READ`
- **AND** no directory, temporary file, or target file side effect may occur

### Requirement: Write Detects Concurrent Target Changes

Write SHALL compare the target with its recorded state before entering the mutation section and again immediately before filesystem replacement. An existing file changed since Read, or a new target created before replacement, SHALL fail with `WRITE_TARGET_CHANGED` and category `CONFLICT`.

Conflict failures SHALL NOT retry automatically and SHALL require a new full Read before another Write attempt.

#### Scenario: Target changes before replacement

- **WHEN** the target state immediately before replacement differs from the state observed after validation
- **THEN** Write MUST fail with `WRITE_TARGET_CHANGED`
- **AND** it MUST preserve the current target unchanged

### Requirement: Write Temporarily Executes Without Runtime-Owned Approval

In the current release, every validated and authorized create or update SHALL execute without waiting for runtime-owned approval. The system SHALL represent this state directly by omitting `approval` from Write's required dependencies; it MUST NOT inject a fake readiness marker or claim that an approval occurred.

This change SHALL NOT define approval request/answer payloads, Tool suspension/resumption, UI behavior, or a private approval implementation. A later Capability Approval change MUST restore one operation-specific runtime-owned approval for every create and update before filesystem side effects.

The later approval path SHALL be capable of supplying complete old and new content for controlled confirmation. Complete content SHALL NOT enter ordinary stream events, logs, audit, trace, metrics, SafeError, or result metadata.

#### Scenario: Approval infrastructure is absent in the current release

- **WHEN** app composition cannot provide the governed approval readiness dependency
- **THEN** Write MUST remain available when `workspaceFiles` is available
- **AND** execution MUST still enforce all directory authority, full Read, conflict, file-type, encoding, capacity, atomicity, cancellation, and safe-output constraints

### Requirement: Write Accepts Only Supported Text Files

Write SHALL create new files as UTF-8 without BOM. For existing files it SHALL support and preserve UTF-8 without BOM, UTF-8 with BOM, UTF-16 LE with BOM, and UTF-16 BE with BOM. An existing no-BOM file that is not valid UTF-8 SHALL be rejected.

Write SHALL preserve the caller's line endings exactly and SHALL NOT normalize LF or CRLF. It SHALL reject binary or unknown encodings, directories, devices, sockets, FIFOs, symbolic links, junctions, reparse points, and existing targets whose hard-link count exceeds one.

#### Scenario: Linked or non-text target is rejected

- **WHEN** the target or an existing parent crosses a link boundary, or the target is not a supported regular text file
- **THEN** Write MUST fail safely before mutation
- **AND** it MUST NOT expose host path or file content

### Requirement: Write Uses Atomic Replacement

After the second target-state check, Write SHALL recursively create missing authorized parent directories using platform-default safe permissions, create a unique temporary file in the target directory, write and flush the complete encoded content, and atomically create or replace the target.

Write SHALL clean up temporary files created by the current invocation on pre-replacement failure or cancellation. If atomic replacement cannot be guaranteed, it SHALL fail without falling back to direct overwrite. It SHALL NOT chmod, clear read-only attributes, elevate privileges, or accept a mode parameter.

#### Scenario: Atomic replacement is unavailable

- **WHEN** the platform adapter cannot guarantee atomic target replacement
- **THEN** Write MUST fail safely
- **AND** the original target MUST remain unchanged
- **AND** the implementation MUST clean up its own temporary file

### Requirement: Write Results And Observability Are Safe

Successful results SHALL return only create/update type and normalized workspace-relative path. Existing tool-use/result persistence and `toolCallId` correlation SHALL provide traceability; Write SHALL NOT create a duplicate content evidence store.

Logs, audit, trace, metrics, SafeError, availability reasons, and result metadata MUST NOT contain file content, original content, diff, host absolute path, temporary name, workspace root, directory configuration, or file fingerprint.

#### Scenario: Write invocation is observed

- **WHEN** Write execution or unavailability is logged, traced, audited, or measured
- **THEN** observability MAY include stable invocation ids, capability id, create/update, status, duration bucket, and low-cardinality reason code
- **AND** it MUST NOT include file content or host filesystem details

### Requirement: Write file extension authorization

Write SHALL 在检查目标存在性、full-Read snapshot 或写入内容之前，使用当前 accepted Agent/version 的写入 extension policy 按 deny-first 顺序检查已规范化目标文件名。比较和无后缀语义 MUST 与 Read 相同。未授权目标 MUST 以 `CAPABILITY_PATH_REJECTED` 安全失败，不得创建、覆盖或读取文件，也不得泄漏目标是否存在。该 extension-policy failure MUST 作为可恢复 Tool observation 返回模型，MUST NOT 直接终止 Agentic loop 或把 request/run 提交为 terminal failure。

#### Scenario: Rejected extension does not terminate the Agentic loop
- **WHEN** 模型先调用 Write 写入未授权后缀，随后根据安全错误调用允许后缀
- **THEN** 首次调用 SHALL 返回 `CAPABILITY_PATH_REJECTED`，同一 request/run SHALL 继续下一轮并允许后续合法 Tool call 完成

#### Scenario: Rejected extension is projected to the corresponding Tool Calling result
- **WHEN** Write rejects a target through the workspace extension policy
- **THEN** the stream SHALL include a `CAPABILITY_RESULT_DELTA` correlated by the same `toolCallId`, containing the safe failure status, code, category, and non-sensitive extension-policy summary so the browser can attach the error to that Tool Calling result
- **AND** the result projection SHALL NOT expose the target path, configured extension lists, file existence, or file content

#### Scenario: Allowed extension can be created or overwritten
- **WHEN** 写入 allowlist 为 `[".json"]`、denylist 缺省且目标最终后缀为 `.json`（大小写任意）
- **THEN** Write SHALL 在满足既有目录、大小和 full-Read 约束后执行既有 create/update 行为

#### Scenario: Disallowed extension is rejected before snapshot check
- **WHEN** 写入 allowlist 为 `[".json"]` 且目标为现有 `workspace/config.yaml`
- **THEN** Write SHALL 返回 `CAPABILITY_PATH_REJECTED`，不得通过 `WRITE_REQUIRES_FULL_READ` 暴露文件存在性且不得改变文件

#### Scenario: Empty write extension list disables Write targets
- **WHEN** 写入 allowlist 显式为空数组
- **THEN** Write SHALL 拒绝所有文件目标，即使 `writeDirectories` 授权该目录

#### Scenario: Write denylist overrides allowlist
- **WHEN** `.json` 同时位于写入 allowlist 和 denylist，且目标为 `workspace/config.json`
- **THEN** Write SHALL 返回 `CAPABILITY_PATH_REJECTED` 且不得创建或改变文件
