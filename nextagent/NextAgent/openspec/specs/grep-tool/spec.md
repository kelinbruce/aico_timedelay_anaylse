# grep-tool Specification

## Purpose
定义受治理 Grep 工具的可见性、搜索输入、结果限制和执行根边界，使模型只能在授权工作区内检索文本内容。
## Requirements
### Requirement: Grep Is An Explicit Governed Builtin Tool

The system SHALL provide a PascalCase `Grep` builtin Tool defined through `defineTool` and explicitly registered in the owned builtin Tool list. The Tool SHALL require the controlled `workspaceFiles` dependency and SHALL declare `IDEMPOTENT` replay policy.

The Tool SHALL NOT introduce a lowercase alias, implicit registration, a parallel invocation contract, a delivery-target contract, a Grep-specific provider, a host shell command, or a ripgrep wrapper.

#### Scenario: Grep descriptor is projected through the existing framework

- **WHEN** the builtin Tool catalog is composed with `workspaceFiles`
- **THEN** it exposes the `Grep` descriptor through the existing capability discovery path
- **AND** executable lookup remains provider-aware

#### Scenario: Missing dependency prevents execution

- **WHEN** the builtin Tool catalog is composed without `workspaceFiles`
- **THEN** `Grep` is unavailable before invocation
- **AND** no filesystem search executes

#### Scenario: Existing builtin governance controls model visibility

- **WHEN** `Grep` is registered as a builtin Tool
- **THEN** it follows the existing builtin default-enabled policy
- **AND** an explicit disabled Agent binding removes it from the request-visible capability view
- **AND** this change does not introduce a Grep-specific delivery or visibility policy

### Requirement: Grep Uses A Defined Regex And Glob Subset

Grep SHALL compile `pattern` via `new RegExp(pattern, "g" + (case_insensitive ? "i" : ""))` before any filesystem access. The regex SHALL match per line on UTF-16 code units. Grep SHALL reject pattern sources containing absolute paths, UNC paths, device paths, drive-qualified paths, any `..` segment, NUL, or control characters with `CAPABILITY_INPUT_INVALID`. Regex compilation errors SHALL also be rejected with `CAPABILITY_INPUT_INVALID` and SHALL NOT read any file.

When `glob_filter` is present, Grep SHALL apply the same portable subset enforced by the `glob` Tool: `*`, `?`, `**`, character classes, negated character classes, and finite brace alternatives. Each brace SHALL contain at most 32 alternatives, and the complete pattern SHALL expand to at most 256 combinations. Grep SHALL reject malformed constructs, extglob, regular expressions, leading negation patterns, empty brace alternatives, brace ranges, NUL, control characters, absolute paths, UNC paths, device paths, drive-qualified paths, and any `..` segment before filesystem access. `/` SHALL be the canonical pattern separator and `\` SHALL normalize as a separator on all supported hosts. Matching SHALL include hidden files and SHALL NOT read or apply `.gitignore`, `.ignore`, or other repository ignore files. Matching SHALL be case-insensitive on Windows and case-sensitive on Linux and macOS.

#### Scenario: Regex matches across many files under the selected path

- **WHEN** `pattern="alarmId=\\d+"` is evaluated under an authorized path
- **THEN** Grep compiles the regex, scans candidate files, and returns only those containing at least one match
- **AND** returned names are relative to the trusted workspace

#### Scenario: Invalid regex or escaping pattern is rejected

- **WHEN** `pattern` is not compilable, contains an absolute path, contains a parent segment, or contains a control character
- **THEN** Grep returns a safe validation error
- **AND** no file is read

#### Scenario: glob_filter narrows candidate files

- **WHEN** a model invokes `Grep` with `pattern` and `glob_filter="*.log"`
- **THEN** only ordinary files whose relative path matches the glob are scanned for content matches
- **AND** non-matching files are excluded from the result without I/O

### Requirement: Grep Uses The Shared Controlled Filesystem Boundary

Grep SHALL access filesystem content search only through the existing Agent-scoped `workspaceFiles` dependency. The dependency SHALL own containment, authority, traversal, link checks, file-type checks, binary detection, per-file read budget, regex compilation coordination, and result normalization.

Grep SHALL NOT directly import host filesystem APIs, receive workspace root, execute a host command, invoke ripgrep, spawn a child process, or route through the sandbox gateway. `agent-capability` SHALL use JavaScript built-in `RegExp` only for content matching; `picomatch` SHALL be reused for `glob_filter` validation and matching. No third-party ripgrep, ag, or shell wrapper SHALL be added.

#### Scenario: Read Write Glob And Grep share one authority boundary

- **WHEN** Read, Write, Glob, and Grep are composed for one Agent assembly/version
- **THEN** they use one `workspaceFiles` dependency
- **AND** they do not create parallel workspace roots or authorization rules

#### Scenario: Grep executes without sandbox or ripgrep

- **WHEN** Grep is invoked with an available `workspaceFiles` dependency
- **THEN** it performs controlled read-only content search
- **AND** it does not require or call the sandbox dependency
- **AND** it does not spawn a host process or invoke ripgrep

### Requirement: Grep Does Not Cross Links Or Return Special Or Binary Files

The search root SHALL exist, be authorized, and be a directory. Traversal SHALL NOT follow symlinks, junctions, or reparse points. Results SHALL contain only ordinary files that remain within the trusted workspace and effective Read authority.

Directories, devices, sockets, FIFOs, and other non-ordinary files SHALL NOT be opened. A file whose first 8 KiB scan window contains a NUL byte SHALL be treated as binary and skipped without producing matches. An unreadable root, inaccessible descendant directory, or traversal I/O failure SHALL fail safely without returning partial success.

An ordinary file deleted while being inspected SHALL be skipped and traversal SHALL continue. Symlinks, junctions, and reparse points SHALL be skipped without failing the invocation.

Grep SHALL NOT read directory entries, modify files, directories, timestamps, permissions, or system state.

#### Scenario: Linked subtree is not traversed

- **WHEN** an authorized directory contains a symlink, junction, or reparse point to any location
- **THEN** Grep does not descend through that entry
- **AND** no target file is opened through the linked path

#### Scenario: Binary file is skipped

- **WHEN** a candidate file's first 8 KiB contains a NUL byte
- **THEN** Grep does not produce a match for that file
- **AND** the file is reported only through low-cardinality counts

#### Scenario: Traversal failure does not produce partial success

- **WHEN** a required descendant cannot be safely inspected
- **THEN** Grep returns a safe failed result
- **AND** already discovered matches are not returned as a successful partial result

### Requirement: Grep Match Budgets Are Bounded And Deterministic

Grep SHALL enforce fixed non-model-configurable hard limits on top of any `max_results` the model supplies:

- at most 10 directory edges below each search root;
- at most 500 returned entries (`filenames` length in `files_with_matches` mode, `matches` length in `content` mode);
- at most 20000 inspected filesystem entries across the invocation;
- at most 512 KiB read per file;
- at most 32 MiB read across the invocation;
- at most 4096 UTF-16 code units per matched line.

`max_results` SHALL be clamped to the 1..500 range and SHALL be the cap on returned entries; the 500, 20000, 32 MiB, 512 KiB, and 4096 code unit limits SHALL still apply.

Results SHALL be sorted by `(file_path, line_number)` in stable lexical order, and `content` mode entries SHALL be flattened from that ordering. `truncated` SHALL be `true` when at least one match is omitted because of `max_results`, file read budget, depth limit, scan budget, total read budget, or per-line cap, and `false` otherwise.

The implementation SHALL keep traversal memory bounded and SHALL stop after the scan budget. For the same stable filesystem state and input, result order and truncation semantics SHALL be deterministic.

#### Scenario: Result limit is enforced

- **WHEN** more than `max_results` ordinary files match in `files_with_matches` mode, or more than `max_results` lines match in `content` mode
- **THEN** exactly the first `max_results` entries in defined lexical order are returned
- **AND** `truncated=true`

#### Scenario: Depth or scan budget is enforced

- **WHEN** a possible matching subtree exceeds depth 10 or traversal reaches 20000 inspected entries
- **THEN** traversal stops at the applicable hard boundary
- **AND** `truncated=true`

#### Scenario: Total read budget is enforced

- **WHEN** cumulative file reads reach 32 MiB before all matches are returned
- **THEN** Grep stops reading further files
- **AND** `truncated=true`

### Requirement: Grep Honors Cancellation And Safe Observability

Grep SHALL receive and honor `AbortSignal`. Cancellation before or during traversal SHALL stop work and SHALL use existing capability/runtime cancellation semantics without returning partial success.

Logs, metrics, traces, audit fields, SafeError, and result metadata SHALL NOT contain pattern, glob filter, input path, matched or unmatched file contents, filenames beyond the returned `file_path` keys, workspace root, host absolute paths, raw host exceptions, or directory configuration. Safe observability MAY contain stable invocation identifiers, capability id, status, duration bucket, result-count bucket, `truncated`, `output_mode`, and low-cardinality reason code.

#### Scenario: Cancellation stops traversal

- **WHEN** the invocation signal is aborted before or during search
- **THEN** Grep stops traversal
- **AND** it does not return partial matches as success

#### Scenario: Operational signals omit sensitive filesystem values

- **WHEN** Grep succeeds or fails
- **THEN** operational signals contain only allowed low-cardinality fields
- **AND** pattern, glob filter, paths, file contents, authority configuration, and raw host errors are absent

### Requirement: Grep file extension filtering

Grep SHALL 在打开或扫描候选文件之前，使用当前 accepted Agent/version 的读取 extension policy 按 deny-first 顺序过滤候选文件。未授权后缀文件 MUST NOT 被读取、计入扫描字节预算或产生匹配结果。

#### Scenario: Grep does not scan unauthorized extensions
- **WHEN** 读取 allowlist 为 `[".log"]`，相同搜索文本同时存在于 `alarm.log` 和 `credential.pem`
- **THEN** Grep SHALL 仅返回 `alarm.log` 中的匹配且不得读取 `credential.pem`

#### Scenario: Missing read extension policy preserves existing scan
- **WHEN** 读取 allowlist 和 denylist 均缺省且目录授权允许候选文件
- **THEN** Grep SHALL 保持现有不按后缀过滤的扫描行为

#### Scenario: Grep denylist excludes a file without allowlist
- **WHEN** 读取 denylist 为 `[".pem"]`、allowlist 缺省，匹配文本存在于 `alarm.log` 和 `credential.pem`
- **THEN** Grep SHALL 扫描并返回 `alarm.log` 的匹配，但不得读取或返回 `credential.pem`
