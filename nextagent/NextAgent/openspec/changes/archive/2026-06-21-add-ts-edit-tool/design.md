## 设计决策（Design Decisions）

### D1: Builtin Tool 形态

Edit 的 capability id 为 PascalCase `Edit`（与 Read / Write 保持一致）。它通过 `defineTool` 定义并显式加入 owned builtin Tool list，复用现有 `ToolCatalog`、`BuiltinToolExecutor`、`CapabilityInvocationPort` 和 `CapabilityInvocationResult`。

Tool 实现只接收校验后的业务 input 和受控 dependencies，不接收 `CapabilityInvocationRequest`，也不直接返回 capability result envelope。

### D2: 输入和输出

模型可见输入：

```yaml
file_path: string    # workspace-relative 文件路径
old_string: string   # 要替换的精确文本，非空
new_string: string   # 替换后的文本，可为空字符串
replace_all: boolean # 可选，默认 false。为 true 时替换所有出现的 old_string
```

成功业务输出：

```yaml
file_path: string      # 规范化 workspace-relative 路径
type: update               # Edit 永远返回 update，不能 create
old_string: string
new_string: string
replaced_count: integer # >= 1
replace_all: boolean
```

Edit 不在结果中返回完整新文件内容、旧内容、diff、字节数或宿主路径。完整调用参数继续由现有 tool-use message 持久化，并通过 `toolCallId` 与结果关联。

### D3: 编辑语义

`old_string` 必须是文件中精确出现的文本。行号前缀来自 Read Tool 的标准输出格式，模型在传递 `old_string` 时需保留 Read 输出中的精确缩进。

- `replace_all=false`：`old_string` 在文件中必须唯一出现一次，否则失败（`EDIT_STRING_NOT_UNIQUE`）。
- `replace_all=true`：替换文件中所有出现的 `old_string`。必须至少有一处匹配。
- `old_string` 在文件中未找到时失败（`EDIT_STRING_NOT_FOUND`）。
- `old_string` 与 `new_string` 相同时失败（`CAPABILITY_INPUT_INVALID`）。

### D4: Read-before-Edit 快照复用

Edit 复用 Write 的完整 Read 快照机制：

- 文件必须已经通过 Read 建立了完整快照（`offset=0` 且 `truncated=false`），否则失败（`EDIT_REQUIRES_FULL_READ`）。
- Edit 前校验快照未过期，若文件在 Read 后已被修改则失败（`EDIT_TARGET_CHANGED`）。
- 快照按 `agentId + agentVersion + runId + normalized path` 隔离。
- Edit 成功后更新当前 run 的快照为编辑后的内容。
- 快照通过 `clearRun` 清理，不持久化到磁盘。
- 快照与 Write 共享，即 Read→Write 后快照已更新为写入内容。

### D5: 路径和文件类型

Edit 的路径安全约束与 Write 一致：

- `file_path` 必须位于已授权 `writeDirectories` 内。
- 目标必须是已存在的普通文本文件（与 Write 不同，Edit 不能创建新文件）。
- 目标不可为目录、device、socket、FIFO、symbolic link、junction 或 reparse point。
- 绝对路径、UNC、device path、`..`、glob 或 workspace 逃逸在产生文件副作用前拒绝。

### D6: 文本编码和容量

Edit 保持文件的原有编码：

- 与 Write 相同，支持 UTF-8 without BOM、UTF-8 with BOM、UTF-16 LE with BOM、UTF-16 BE with BOM。
- 使用 `fingerprint`（内容 + mtime + mode 哈希）检测 Read 快照是否过期，确保文件未被外部修改。
- `new_string` 按原调用编码写入，保持文件原有换行约定（不自动规范化 LF/CRLF）。
- 替换后的完整内容按原文件编码计算字节数，必须不超过 Agent-scoped `workspaceFiles.maxTextBytes`。

### D7: 原子替换

Edit 使用与 Write 相同的原子替换策略：

1. 解析目标文件路径并校验安全性。
2. 加载已有文件内容和编码。
3. 校验完整 Read 快照存在且未过期。
4. 查找所有 `old_string` 匹配位置。
5. 按语义校验匹配唯一性。
6. 构造替换后新内容。
7. 校验替换后编码内容不超过 `workspaceFiles.maxTextBytes`。
8. 获取目标写锁后再次加载目标并与步骤 3 观察到的状态比较；若已变化则以 `EDIT_TARGET_CHANGED` 失败。
9. 使用原有编码将新内容写入临时文件。
10. 通过平台原子 rename 替换目标文件。
11. 清理临时文件。

替换完成后按调用方的成功语义更新快照。

### D8: 快照生命周期

`WorkspaceFilePort` 内部维护进程内快照 Map。Edit 和 Write 共享同一快照 store：

- Read（完整，offset=0, truncated=false） → 建立快照。
- Write 成功 → 更新快照为写入内容。
- Edit 成功 → 更新快照为编辑后内容。
- Write/Edit 冲突失败 → 快照不变（调用方必须重新 Read）。
- `clearRun(runId)` → 清除该 run 的所有快照。

`agent-app` 在 runtime terminal observation 触发时调用 `clearRun`，`workspaceFiles` 不拥有 request lifecycle。

### D9: Replay、结果和可观测性

Edit replay policy 为 `NON_IDEMPOTENT`。runtime recovery 不得自动重放；timeout 或结果丢失后不得假定操作已完成，后续尝试必须重新完整 Read。

日志、audit、trace、metric、SafeError 和 result metadata 不得包含：

- 完整文件内容、`old_string` 或 `new_string`；
- 宿主绝对路径或临时文件名；
- workspace root；
- 高基数目录配置或 fingerprint。

安全观测只允许稳定 invocation/toolCall 标识、capability id、status、duration bucket 和低基数 reason code。

## 验证映射（Verification Map）

| 验证点 | 验证入口 |
|---|---|
| input/output schema、显式 catalog 注册、NON_IDEMPOTENT | unit/contract tests |
| `Edit` PascalCase capabilityId 和 `Edit` schema 字段命名 | capability integration tests |
| old_string 唯一匹配、全局替换、未找到、不唯一错误 | table-driven unit tests |
| Read-before-Edit 快照、stale edit、替换前二次检测、过期检测 | contract/integration tests |
| 替换后容量上限 `workspaceFiles.maxTextBytes` | boundary tests |
| 编码保持（UTF-8/UTF-8 BOM/UTF-16 LE/UTF-16 BE） | filesystem integration tests |
| 并发写入防护和快照更新 | security integration tests |
| 路径安全（目录外拒绝、symlink/junction/硬件链接/特殊文件） | security integration tests |
| required input 字段校验 | boundary tests |
| 无直接 node:fs、内容/宿主路径不进入安全边界 | architecture tests |
| OpenSpec 一致性 | `openspec validate --all --strict` |
