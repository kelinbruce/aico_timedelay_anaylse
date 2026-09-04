# glob-tool Specification

## Purpose
Defines the governed `glob` builtin Tool for agent-scoped workspace filename pattern discovery. Uses the shared `workspaceFiles` dependency, enforces strict pattern/contract/authority/capacity boundaries, and owns read-only discovery without sandbox.
## Requirements
### Requirement: Glob Is An Explicit Governed Builtin Tool

The system SHALL provide a lowercase `glob` builtin Tool defined through `defineTool` and explicitly registered in the owned builtin Tool list. The Tool SHALL require the controlled `workspaceFiles` dependency and SHALL declare `IDEMPOTENT` replay policy.

The Tool SHALL NOT introduce an uppercase alias, implicit registration, a parallel invocation contract, a delivery-target contract, or a Glob-specific provider.

#### Scenario: Glob descriptor is projected through the existing framework

- **WHEN** the builtin Tool catalog is composed with `workspaceFiles`
- **THEN** it exposes the `glob` descriptor through the existing capability discovery path
- **AND** executable lookup remains provider-aware

#### Scenario: Missing dependency prevents execution

- **WHEN** the builtin Tool catalog is composed without `workspaceFiles`
- **THEN** `glob` is unavailable before invocation
- **AND** no filesystem search executes

#### Scenario: Existing builtin governance controls model visibility

- **WHEN** `glob` is registered as a builtin Tool
- **THEN** it follows the existing builtin default-enabled policy
- **AND** an explicit disabled Agent binding removes it from the request-visible capability view
- **AND** this change does not introduce a Glob-specific delivery or visibility policy

### Requirement: Glob Uses A Defined Portable Pattern Subset

Glob SHALL support `*`, `?`, `**`, character classes, negated character classes, and finite brace alternatives. `/` SHALL be the canonical pattern separator, and `\` SHALL normalize as a separator on all supported hosts.

Matching SHALL include hidden files and SHALL NOT read or apply `.gitignore`, `.ignore`, or other repository ignore files. Matching SHALL be case-insensitive on Windows and case-sensitive on Linux and macOS.

Each brace SHALL contain at most 32 alternatives, and the complete pattern SHALL expand to at most 256 combinations. Glob SHALL reject excess alternatives or combinations with `CAPABILITY_INPUT_INVALID`.

Glob SHALL reject malformed constructs, extglob, regular expressions, leading negation patterns, empty brace alternatives, brace ranges, NUL, control characters, absolute paths, UNC paths, device paths, drive-qualified paths, and any `..` segment before filesystem access.

#### Scenario: Recursive pattern matches beneath the selected path

- **WHEN** `pattern="**/*.log"` is evaluated under an authorized path
- **THEN** ordinary `.log` files within the traversal limits are returned
- **AND** returned names are relative to the trusted workspace

#### Scenario: Root-qualified Skill resource pattern uses the authorized Skill subtree

- **GIVEN** an accepted run has loaded a Skill and the system disclosed an authorized Skill resource root such as `.nextagent/skills/<skillProjectionKey>/<skillName>/`
- **WHEN** Glob is invoked with only a root-qualified pattern under that disclosed root, such as `.nextagent/skills/<skillProjectionKey>/<skillName>/scripts/*`
- **THEN** Glob SHALL search only the authorized Skill resource subtree
- **AND** it SHALL match the suffix pattern relative to that disclosed subtree
- **AND** it SHALL return normalized `.nextagent/skills/...` filenames without exposing host absolute paths
- **AND** it SHALL NOT broaden access to `.nextagent`, `.projection.json`, `.locks`, `.staging`, or another Skill resource subtree

#### Scenario: Unsupported or escaping pattern is rejected

- **WHEN** a pattern is malformed, unsupported, absolute, device-qualified, or contains a parent segment
- **THEN** Glob returns a safe validation or path-rejection error
- **AND** no directory traversal executes

### Requirement: Glob Uses The Shared Controlled Filesystem Boundary

Glob SHALL access filesystem discovery only through the existing Agent-scoped `workspaceFiles` dependency. The dependency SHALL own containment, authority, traversal, link checks, file-type checks, normalization, and capacity enforcement.

Glob SHALL NOT directly import host filesystem APIs, receive workspace root, execute a host command, invoke ripgrep, or route through the sandbox gateway.

`agent-capability` SHALL declare `picomatch` as a direct dependency and SHALL use it only to compile and match normalized relative paths. `picomatch`, `tinyglobby`, and other glob packages SHALL NOT own traversal or authority enforcement.

#### Scenario: Read Write And Glob share one authority boundary

- **WHEN** Read, Write, and Glob are composed for one Agent assembly/version
- **THEN** they use one `workspaceFiles` dependency
- **AND** they do not create parallel workspace roots or authorization rules

#### Scenario: Glob executes without sandbox

- **WHEN** Glob is invoked with an available `workspaceFiles` dependency
- **THEN** it performs controlled read-only discovery
- **AND** it does not require or call the sandbox dependency

### Requirement: Glob Does Not Cross Links Or Return Special Files

The search root SHALL exist, be authorized, and be a directory. Traversal SHALL NOT follow symlinks, junctions, or reparse points. Results SHALL contain only ordinary files that remain within the trusted workspace and effective Read authority.

Directories, devices, sockets, FIFOs, and other non-ordinary files SHALL NOT be returned. An unreadable root, inaccessible descendant directory, or traversal I/O failure SHALL fail safely without returning partial success.

An ordinary file deleted while being inspected SHALL be skipped and traversal SHALL continue. Symlinks, junctions, and reparse points SHALL be skipped without failing the invocation.

Glob SHALL NOT read file contents or modify files, directories, timestamps, permissions, or system state.

#### Scenario: Linked subtree is not traversed

- **WHEN** an authorized directory contains a symlink, junction, or reparse point to any location
- **THEN** Glob does not descend through that entry
- **AND** no target file is returned through the linked path

#### Scenario: Traversal failure does not produce partial success

- **WHEN** a required descendant cannot be safely inspected
- **THEN** Glob returns a safe failed result
- **AND** already discovered filenames are not returned as a successful partial result

### Requirement: Glob Traversal Is Bounded And Deterministic

Glob SHALL enforce fixed non-model-configurable hard limits:

- at most 10 directory edges below each search root;
- at most 500 returned filenames;
- at most 20000 inspected filesystem entries across the invocation.

Results SHALL be sorted by normalized workspace-relative path in stable lexical order. `truncated` SHALL be `true` when at least one matching result is omitted because of result, depth, or scan limits, and `false` otherwise.

The implementation SHALL keep traversal memory bounded and SHALL stop after the scan budget. For the same stable filesystem state and input, result order and truncation semantics SHALL be deterministic.

#### Scenario: Result limit is enforced

- **WHEN** more than 500 ordinary files match
- **THEN** exactly the first 500 paths in defined lexical order are returned
- **AND** `truncated=true`

#### Scenario: Depth or scan budget is enforced

- **WHEN** a possible matching subtree exceeds depth 10 or traversal reaches 20000 inspected entries
- **THEN** traversal stops at the applicable hard boundary
- **AND** `truncated=true`

### Requirement: Glob Honors Cancellation And Safe Observability

Glob SHALL receive and honor `AbortSignal`. Cancellation before or during traversal SHALL stop work and SHALL use existing capability/runtime cancellation semantics without returning partial success.

Logs, metrics, traces, audit fields, SafeError, and result metadata SHALL NOT contain pattern, input path, filenames, workspace root, host absolute paths, raw host exceptions, or directory configuration. Safe observability MAY contain stable invocation identifiers, capability id, status, duration bucket, result-count bucket, truncated flag, and low-cardinality reason code.

#### Scenario: Cancellation stops traversal

- **WHEN** the invocation signal is aborted before or during search
- **THEN** Glob stops traversal
- **AND** it does not return partial filenames as success

#### Scenario: Operational signals omit sensitive filesystem values

- **WHEN** Glob succeeds or fails
- **THEN** operational signals contain only allowed low-cardinality fields
- **AND** pattern, paths, filenames, authority configuration, and raw host errors are absent

### Requirement: Glob file extension filtering

Glob SHALL 使用当前 accepted Agent/version 的读取 extension policy 按 deny-first 顺序执行结果过滤。未授权后缀的文件 MUST NOT 出现在结果中；目录可作为遍历内部事实，但 MUST NOT 因名称后缀获得文件授权。过滤 MUST 在结果计数和返回上限计算之前完成，使未授权文件不消耗可见结果配额。

#### Scenario: Glob omits unauthorized extensions
- **WHEN** 读取 allowlist 为 `[".json"]`，匹配目录同时包含 `cell.json`、`secret.pem` 和 `README`
- **THEN** Glob SHALL 仅返回 `cell.json`

#### Scenario: Empty read extension list returns no files
- **WHEN** 读取 allowlist 为显式空数组
- **THEN** Glob SHALL 返回空文件结果且不得暴露目录中文件名

#### Scenario: Glob denylist overrides an allowed extension
- **WHEN** `.json` 同时位于读取 allowlist 和 denylist，匹配目录包含 `cell.json`
- **THEN** Glob SHALL 不返回 `cell.json`
