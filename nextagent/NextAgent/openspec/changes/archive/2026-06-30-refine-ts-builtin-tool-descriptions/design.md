# Design: refine-ts-builtin-tool-descriptions

## 1. 统一描述模板与去重原则

所有内置 Tool 的模型可见 `description` SHALL 覆盖以下信息。复杂工具优先使用显式分段；当等价 prose 形态更贴近实现且不损失语义覆盖时，也可以采用单段或弱分段表达：

1. **一句话总结**：工具做什么。
2. **适用场景**：触发场景；如适用，提示并行调用。
3. **避免误用时的路由指引**：说明什么时候应转到其他工具。
4. **关键行为**：非显而易见的行为——失败模式、输出格式解读、跨工具差异、schema 未声明的默认值。

描述只描述已实现的行为，不承诺 schema 或实现未表达的能力。描述不枚举 allowlist 具体命令（allowlist 由配置和 spec 拥有），不暴露 host 路径、credential 或内部实现细节。

### description 与 inputSchema 去重原则

模型同时看到工具 `description` 和 `inputSchema`（含字段 `description`）。`outputSchema` 不发给模型（`renderTools` 只渲染 `description` + `inputSchema`）。因此：

- **inputSchema 字段语义**（字段是什么、约束值）MUST 只在 schema 字段 `description` 和 `maxLength`/`maxItems`/`default` 等约束中表达，description 不复述。
- **outputSchema 解读**（返回什么字段、各状态含义）MUST 在 description 的 Key behaviors 中表达，因为模型看不到 outputSchema。
- **行为语义**（失败模式、reason code、跨工具差异、路由指引）MUST 在 description 中表达，schema 无法承载。
- **schema 未声明的 default** 优先补到 schema `default` 字段；补完后 description 不再复述该默认值。

## 2. 各 Tool 最终描述文案

以下文案反映当前实现中已经采用的目标文案。`AskUserQuestion` 和 `Skill` 描述不变。

### Bash

```
Run one bounded local diagnostic command through the sandbox boundary.

When to use:
- Run a governed allowlist diagnostic command to inspect workspace or system state.

When NOT to use:
- For workspace content search, use Grep (not grep/Select-String).
- For file lookup by name, use Glob (not find/Get-ChildItem -Recurse).
- To read a single file, use Read (not cat/Get-Content).

Key behaviors:
- `command` is tokenized and submitted through the sandbox gateway; executable authority is owned by the composed sandbox policy.
- Submit the executable and its arguments directly. Shell built-ins, chaining, or interpreter modes may be rejected by the sandbox policy.
- When a Skill exposes a .nextagent/skills/... resource root, reference files under that root directly, for example `python .nextagent/skills/.../scripts/rag_query.py`.
- When passing natural-language queries to Python scripts, prefer explicit flags such as `--query "..."` and close every quoted argument.
- Timed-out commands return a safe timeout result.
- stdout and stderr are each capped at 100 KB; exceeding the cap is silently truncated.
- A non-zero exit code returns a degraded structured result with the captured stdout/stderr/exitCode so later model steps can react safely.
```

### Read

Read 的 `readText` 实现返回纯文本 `content`（行以 `\n` 拼接），**不添加行号前缀**。这与部分业界工具的 `<n>: <content>` 格式不同。描述 MUST 反映真实输出格式。

```
Read a bounded slice from one authorized workspace-relative text file.

When to use:
- Read a workspace-relative text file by path.
- Page large files using `offset` and `limit`.

When NOT to use:
- To find files by name pattern, use Glob.
- To find content across files, use Grep.
- When unsure of the path, use Glob first.
- Never call Read on `.`, `workspace`, or any directory path; use Glob to enumerate files first.

Key behaviors:
- Returns plain text `content` (lines joined by newlines), with `file_path`, `offset`, `limit`, and `truncated`.
- `truncated=true` with `nextOffset` indicates more lines remain; call Read again with the next offset.
- `error: "FILE_UNAVAILABLE"` indicates the path does not exist, is not a file, or is not authorized.
- Only a full read (offset=0, no truncation) establishes the snapshot required by Write and Edit.
```

### Edit

Edit 的 `editText` 实现硬性要求完整 Read 快照（`EDIT_REQUIRES_FULL_READ`），且 old_string 不唯一时抛 `EDIT_STRING_NOT_UNIQUE`。

```
Performs exact string replacements in an existing file.

Usage:
- You must use your Read tool at least once in the conversation before editing. The tool fails with EDIT_REQUIRES_FULL_READ if the file has not been fully read.
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears in the content.
- ALWAYS prefer editing existing files. NEVER write new files unless explicitly required.
- Use the smallest old_string that is clearly unique; 2-4 adjacent lines is usually enough context.
- The edit fails with EDIT_STRING_NOT_FOUND if old_string is not found, or EDIT_STRING_NOT_UNIQUE if old_string is found multiple times. Provide more surrounding context to make it unique, or set replace_all to true to replace every occurrence.
- Use replace_all to rename a string across the whole file (e.g., renaming a variable).
```

### Glob

```
Find authorized workspace files by a bounded glob pattern.

When to use:
- Find files by name pattern (e.g., `**/*.ts`, `src/**/*.json`).
- Call Glob in parallel with multiple patterns to locate several file kinds at once.

When NOT to use:
- To search file contents, use Grep.
- To read a known path, use Read.

Key behaviors:
- Returns up to 500 workspace-relative filenames; `truncated=true` indicates more matches exist.
```

### Grep

Grep 的 `grepFiles` 实现中 `output_mode` 省略时默认 `files_with_matches`；schema 已补 `default: "files_with_matches"`，description 不再复述默认值。

```
Search authorized workspace text files with a bounded ECMAScript regex pattern.

When to use:
- Find files containing a pattern (e.g., `function\s+\w+`, `log.*Error`).
- Prefer Grep over Bash (grep/Select-String) for workspace content search.

When NOT to use:
- To find files by name, use Glob.
- To read code within 2-3 known files, use Read.

Key behaviors:
- Set `output_mode` to `content` to include matching lines with `file_path`, `line_number`, and `line`.
- `truncated=true` indicates more matches exist beyond the cap.
```

### Write

Write 的 `writeText` 实现硬性要求完整 Read 快照（`WRITE_REQUIRES_FULL_READ`），文件变更后抛 `WRITE_TARGET_CHANGED`。

```
Create or completely rewrite one authorized workspace-relative text file.

When to use:
- Create a new file with full content.
- Completely replace an existing file's content.

When NOT to use:
- For small targeted changes to an existing file, use Edit.
- Do not proactively create documentation files unless explicitly requested.

Key behaviors:
- This overwrites the existing file at `file_path` if one exists.
- If overwriting an existing file, you MUST first Read the entire file (offset=0, no limit); the tool fails with WRITE_REQUIRES_FULL_READ otherwise. If the file changed since your last full Read, the tool fails with WRITE_TARGET_CHANGED.
- Returns `type: "create"` for a new file or `type: "update"` for an overwritten file.
```

### Agent

```
Delegate an isolated sub-task to another governed Agent capability and wait for its safe terminal result text. Use Agent when another Agent should handle a self-contained analysis or execution prompt with fresh isolated context. Do not use Agent to create a persistent work item that must be listed, queried later by status, read by incremental output, updated, or stopped; use the Task tools for managed Task lifecycle. Do not use Agent to read a specific file path, find files by name, or grep code when Read, Glob, or Grep already fit directly. The delegated Agent starts with no parent conversation context, cannot invoke itself, and returns a bounded safe result that you must summarize back to the user.
```

### Python

Python 的 `executePython` 实现中非零退出码返回正常结果（非 degraded），与 Bash 不同。

```
Execute one isolated Python code snippet through the sandbox boundary.

When to use:
- Run a bounded Python snippet for computation, data transformation, or diagnostics.
- Prefer Python over Bash when you need Python libraries or structured data handling.

When NOT to use:
- For a single shell command, use Bash.
- To read workspace files, use Read.

Key behaviors:
- stdout and stderr are each capped at 100 KB; exceeding the cap is silently truncated.
- Unlike Bash, a non-zero `exit_code` is returned as a normal result, not a degraded error.
- `timed_out: true` indicates the snippet exceeded the timeout.
```

### Rag

Rag schema 已补 `topK` 的 `default: 5`，description 不再复述默认值。

```
Retrieve bounded knowledge chunks from the current Agent's governed knowledge sources.

When to use:
- Retrieve governed knowledge (e.g., standards, runbooks, product specs) indexed for the current Agent.
- Prefer Rag over Grep when the answer lives in indexed knowledge rather than workspace files.

When NOT to use:
- To search workspace files, use Grep.
- To read a known file, use Read.

Key behaviors:
- Omit `indexes` to search the Agent's configured default logical indexes; pass `indexes` only when the user specified one or more index names.
- If omitted-index retrieval reports `INDEX_NOT_FOUND`, `INDEX_NOT_READY`, `NO_INDEX`, `PROVIDER_UNAVAILABLE` or `TIMEOUT`, ask the user to specify an available index name.
- `status`: `OK` returns results; `NO_INDEX`, `UNAVAILABLE`, `DEGRADED`, `FAILED`, `TIMEOUT`, `CANCELED` return `diagnostics.reason` with an empty `results` array.
- Each result includes `content`, `source`, optional `provenance`, `score`, and `rankHint`.
```

### Skill

描述不变。仅补 schema 字段 `description`：
- `name`：`"Exact name of an available Skill listed in the system prompt."`
- `args`：`"Task-specific JSON object data; do not pass raw CLI strings, paths, timeouts, or execution-governance fields."`

### AskUserQuestion

不变。

## 3. Schema 字段 description 与 default 补齐

### 3.1 字段 description

| Tool | 文件 | 缺失字段 | 补充 description |
|---|---|---|---|
| Agent | `agent-schemas.ts` | `agentId` | `"Available governed Agent capability id, not a display name."` |
| Agent | `agent-schemas.ts` | `prompt` | `"Complete, self-contained task description for the sub-agent; it does not inherit parent conversation context."` |
| Rag | `rag-schemas.ts` | `query` | `"Natural-language or keyword retrieval query."` |
| Rag | `rag-schemas.ts` | `indexes` | `"Optional knowledge index names to search; omit to search the Agent default indexes."` |
| Rag | `rag-schemas.ts` | `topK` | `"Maximum number of chunks to return."` |
| Skill | `skill-tool.ts` | `name` | `"Exact name of an available Skill listed in the system prompt."` |
| Skill | `skill-tool.ts` | `args` | `"Task-specific JSON object data; do not pass raw CLI strings, paths, timeouts, or execution-governance fields."` |

### 3.2 Schema default 补齐

| Tool | 文件 | 字段 | 补充 | 原因 |
|---|---|---|---|---|
| Grep | `grep-schemas.ts` | `output_mode` | `"default": "files_with_matches"` | 实现默认 `files_with_matches`，schema 未声明 default；补后模型从 schema 即可看到默认值，description 无需复述 |
| Rag | `rag-schemas.ts` | `topK` | `"default": 5` | 实现默认 5，schema 未声明 default；补后 description 无需复述 |

## 4. 不做的事

- 不改变任何 Tool 的 input/output schema 字段名、类型、required、`maxLength`/`maxItems`/`minimum`/`maximum` 约束。
- 不改变任何 Tool 的执行语义、依赖、provider identity、replay policy。
- 不新增 Tool、不新增字段。
- 不把描述拆到 `.txt` 文件（保持现有 inline TS 风格）。
- 不在描述中枚举 Bash allowlist 具体命令（allowlist 由配置和 spec 拥有，可变）。
- 不在描述中暴露 host 路径、credential 或内部实现路径。
- 不给 outputSchema 字段补 description（`renderTools` 不渲染 outputSchema，模型看不到）。

## 5. 取舍

- **为什么不在 spec delta 中钉死每个工具的完整描述文案**：描述文案是模型可见的 UX 文本，不是行为契约；行为契约（如 read-before-write 硬性失败）已在各 Tool spec 中定义。spec delta 只要求描述遵循统一模板并包含必要路由提示；完整文案钉在 design.md。
- **为什么 Agent 允许使用等价 prose 而非显式四段模板**：当前 Agent 文案额外承担了与 Task tools 的边界澄清；单段 prose 更紧凑，且已覆盖适用场景、避免误用和关键行为。统一的是语义覆盖，不是强制每个 Tool 使用相同排版。
- **为什么 Read 描述不提行号前缀**：NextAgent 的 `readText` 返回纯文本 `content`，不添加 `<n>: <content>` 前缀。描述模型可见输出 MUST 与实现一致。
- **为什么 Bash/Python 的输出上限与早期草案不同**：设计最终以当前实现为准。对于模型可见描述，优先保证和真实黑盒行为一致，而不是维持早期草案中的预算数字或失败形态。
- **为什么 description 与 inputSchema 去重**：`renderTools` 同时把 `description` 和 `inputSchema`（含字段 `description`）发给模型。纯复述字段语义和约束值浪费 token 且增加维护负担。行为语义和输出格式解读（outputSchema 不发给模型）仍 MUST 留在 description。
- **为什么补 schema `default` 而非在 description 里写默认值**：`default` 是 schema 标准字段，provider 会保真传递；description 里的默认值是自然语言，模型可能忽略。补到 schema 后 description 可删除对应复述，减少不一致风险。
- **为什么不给 outputSchema 补字段 description**：`renderTools`（`model-input-renderer.ts:134-147`）只渲染 `description` + `inputSchema`，不渲染 `outputSchema`。outputSchema 字段 description 模型看不到，只用于 `BuiltinToolExecutor` 输出校验，开发者可通过读 schema 代码理解。输出格式解读放在工具 description 的 Key behaviors 中。
