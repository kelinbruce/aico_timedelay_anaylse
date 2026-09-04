> 本次对账按 source review checkpoint 更新状态：已勾选项以 `packages/agent-capability/src/builtins/grep/`、`packages/agent-capability/src/builtins/workspace-files/workspace-file-port.ts`、`packages/agent-capability/tests/grep-capability.test.ts`、`tests/architecture/builtin-tool-framework.test.ts`、`tests/e2e/*grep*` 与 `tests/agent-kernel/capability-governance.test.ts` 的静态证据为准；执行类门禁保留未勾选。

## 1. Tool Contract And Catalog

- [x] 1.1 Define PascalCase `Grep` strict input/output schemas, `IDEMPOTENT` metadata, and `workspaceFiles` dependency through `defineTool`
- [x] 1.2 Register `Grep` explicitly in the owned builtin Tool list and verify no lowercase alias, shell, ripgrep, sandbox, or parallel invocation contract is introduced
- [x] 1.3 Verify existing builtin default enablement, explicit Agent binding disablement, provider governance, and dependency readiness

## 2. Shared Workspace File Content Search

- [x] 2.1 Extend `WorkspaceFilePort` with one narrow cancellable content-search operation accepting Grep business input and trusted Tool execution context
- [x] 2.2 Reuse compiled Agent-scoped effective Read authority; when `path` is absent search normalized `readDirectories ∪ writeDirectories`, with whole-workspace compatibility when `readDirectories` is absent
- [x] 2.3 Keep workspace root, host paths, filesystem objects, file contents, and directory authority out of Tool input, output, errors, metadata, and observability
- [x] 2.4 Verify Read, Write, Glob, and Grep share one Agent assembly/version-scoped dependency without a second filesystem path

## 3. Pattern And Path Validation

- [x] 3.1 Implement ECMAScript regex compilation via `new RegExp`, fix flags to `g` plus `case_insensitive`, and reject illegal pattern syntax before any filesystem access
- [x] 3.2 Reuse the Glob portable subset and hard limits for `glob_filter` (32 alternatives per brace, 256 total combinations, hidden files, ignore-file non-application, case semantics, separator normalization)
- [x] 3.3 Validate default/explicit search path against trusted workspace containment and effective Read authority
- [x] 3.4 Reject absolute, UNC, device, drive-qualified, parent-segment, NUL, and control-character inputs in `path` and `glob_filter` before filesystem access

## 4. Bounded Read-Only Content Traversal

- [x] 4.1 Implement ordinary-file content scan without invoking shell, ripgrep, sandbox, or host processes, and without modifying state
- [x] 4.2 Do not follow symlink, junction, or reparse-point entries; skip directories, special files, and binary files (NUL byte in first 8 KiB window)
- [x] 4.3 Enforce per-file 512 KiB read budget, per-line 4096 code unit cap, 500 result budget, 20000 inspected-entry budget, and 32 MiB total read budget
- [x] 4.4 Return `files_with_matches` or `content` results in stable lexical `(file_path, line_number)` order and set `truncated` exactly for omitted matches
- [x] 4.5 Honor cancellation; fail on root/descendant traversal I/O errors without partial success, but skip concurrently deleted ordinary files and linked entries

## 5. Safe Failure And Observability

- [x] 5.1 Map invalid input, rejected path, invalid regex, unavailable dependency, inaccessible directory, cancellation, and traversal failure to existing safe capability semantics
- [x] 5.2 Ensure pattern, paths, glob_filter, file content lines, filenames, workspace root, directory authority, and raw host exceptions never enter logs, metrics, traces, audit, SafeError, or result metadata
- [x] 5.3 Emit only stable identifiers, capability id, status, duration/result-count buckets, truncated flag, and low-cardinality reason code

## 6. Verification

- [x] 6.1 Add unit tests for descriptor metadata, strict schemas, regex compilation, glob_filter validation, `output_mode` selection, hidden files, ignore behavior, separator normalization, output shape, and stable ordering
- [x] 6.2 Add table-driven security tests for Read authority, traversal, absolute/UNC/device paths, parent segments, links, reparse points, binary files, and special files
- [x] 6.3 Add capacity and integration tests for per-file read budget, line cap, result budget, scan budget, total read budget, deterministic truncation, cancellation, entry races, inaccessible descendants, and no partial success
- [x] 6.4 Add contract/architecture tests for explicit registration, builtin default enablement, Agent binding disablement, dependency unavailability, one shared filesystem boundary, and no direct filesystem/process/sandbox/ripgrep access
- [x] 6.5 Run `npm run build`, `npm test`, `npm run test:contract`, `npm run lint:architecture`, and `openspec validate --all --strict`
  - Evidence: `openspec validate --all --strict` passed; `npm run build` passed; `npm test` passed (153 files passed, 1185 tests passed, 44 skipped); `npm run test:contract` passed (49/49); `npm run lint:architecture` passed
- [x] 6.6 Run the repository `nextagent-code-review` semantic review before push and resolve all blocking findings
  - Evidence: reviewed the authored diff against frozen contracts, architecture boundaries, minimal-kernel non-regression, security, OpenSpec consistency, and clean-code expectations; no P0/P1 findings identified in the Grep change itself
  - Verdict: `PASS WITH FOLLOW-UP` because repository-level unrelated build/test failures still block a clean push signal
