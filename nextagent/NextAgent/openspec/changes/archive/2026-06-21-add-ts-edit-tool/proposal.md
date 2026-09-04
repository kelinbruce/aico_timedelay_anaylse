## 背景与问题（Why）

NextAgent 需要一个受治理的内置 `Edit` Tool，用于对已有文本文件进行精确字符串替换。Edit 是 Write 的互补能力：Write 负责整个文件的新建和完整重写，Edit 负责增量修改，避免模型因小幅改动而必须重写整个文件，减少 token 消耗和并发冲突风险。

原始 TonyClaw 实现中包含 `FileEditTool`，提供了 `old_string` / `new_string` / `replace_all` 的编辑语义和 `file_path` 的 workspace-relative 路径模型。当前 NextAgent 已有 Read / Write Tool 以及 `workspaceFiles` 受控 dependency，但缺少受治理的 Edit 能力。

## 变更范围（What Changes）

- **新增** PascalCase `Edit` Builtin Tool，通过 `defineTool` 和 owned builtin Tool list 显式注册。
- **扩展** `WorkspaceFilePort` 接口，在 `writeText` 和 `globFiles` 之间增加 `editText` 方法。
- **复用** Read-before-Write 的完整 Read 快照机制，Edit 要求同一 `agentId + agentVersion + runId` 对目标文件有完整 Read 快照。
- **新增** 编辑语义：`old_string` 唯一匹配或 `replace_all` 全局替换；不匹配、不唯一且未指定 `replace_all` 时安全失败。
- **新增** 并发写入防护：Edit 在修改前校验快照未过期（与 Write 共用 `EDIT_TARGET_CHANGED`）。
- **新增** 编码保持：Edit 必须保持文件的原有编码（UTF-8/UTF-8 BOM/UTF-16 LE/UTF-16 BE）。
- **新增** 原子替换：通过临时文件 + rename 保证文件内容的原子性。
- **不新增** approval dependency；Edit 仅依赖 `workspaceFiles`。

## Capability 影响（Capabilities）

### 新增 Capability

- `edit-tool`：受治理的 workspace 文本文件精确字符串替换能力。

### 修改的 Capability

- `builtin-tool-framework`：扩展 `WorkspaceFilePort` 接口，增加 `editText` 操作。
- `workspace-files`：新增 `editText` 实现，包括字符串匹配、替换、快照校验和原子写入。

## 非目标（Non-Goals）

- 不实现正则替换、sed 风格表达式、多行模糊匹配或 AI 辅助 diff。
- 不实现 append、prepend、行号编辑或 range 编辑。
- 不实现 content DLP/secret 扫描或内容修改前后审计日志。
- 不允许 Edit 创建新文件（必须已有文件经过完整 Read 后方可编辑）。
- 不允许 `old_string` 为空或与 `new_string` 相同。
