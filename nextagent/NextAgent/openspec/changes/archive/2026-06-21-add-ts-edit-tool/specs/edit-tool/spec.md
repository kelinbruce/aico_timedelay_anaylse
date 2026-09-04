## ADDED Requirements

### Requirement: Edit 是受治理的内置 Tool

系统 SHALL 通过 `defineTool` 定义一个 PascalCase 的 `Edit` Tool，在自有 builtin Tool 列表中显式注册它，并且只通过既有 Tool catalog、`BuiltinToolExecutor`、capability invocation 和受控的 `workspaceFiles` 依赖边界执行它。

Edit SHALL 声明 replay policy `NON_IDEMPOTENT`，并且只要求受控的 `workspaceFiles` 依赖。它 SHALL NOT 接收 `CapabilityInvocationRequest`、workspace root、host 路径或 host 文件系统 API。

#### Scenario: Edit 被显式注册并可用

- **WHEN** builtin Tool catalog 以 `workspaceFiles` 组合完成
- **THEN** catalog MUST 包含一个 `AVAILABLE` 的 `Edit` descriptor
- **AND** Edit MUST 按既有 Agent binding governance 对模型可见
- **AND** descriptor MUST 使用 PascalCase 的 `Edit` 作为 canonical capabilityId

#### Scenario: Edit schema 使用 file_path 而非 path 别名

- **WHEN** Edit Tool descriptor 被列出
- **THEN** `inputSchema` MUST 要求 `file_path`（而非 `path`、`filePath` 或 `absolutePath`）
- **AND** `inputSchema.required` MUST 包含 `["file_path", "old_string", "new_string"]`
- **AND** `inputSchema.properties.old_string` MUST 具有 `minLength: 1`

### Requirement: Edit 输入与输出有界

Edit 输入 SHALL 恰好包含必填的 `file_path`、`old_string`、`new_string` 字符串字段和可选的 `replace_all` 布尔字段。`file_path` SHALL 是 workspace 相对路径。`old_string` SHALL 非空。`new_string` SHALL NOT 等于 `old_string`。编辑后的文件内容编码后 SHALL NOT 超过 Agent 作用域的 `workspaceFiles.maxTextBytes`。

成功的业务输出 SHALL 恰好包含规范化的 `type="update"`（Edit 不能创建新文件）、规范化的 workspace 相对 `file_path`、`old_string`、`new_string`、`replaced_count`（整数 >= 1）和 `replace_all`。它 SHALL NOT 包含完整文件内容、原始内容、diff、字节计数、host 路径、临时路径或 `CapabilityInvocationResult` envelope。

#### Scenario: 非法 Edit 输入被拒绝

- **WHEN** `file_path` 缺失或为空
- **OR** `old_string` 缺失或为空
- **OR** `new_string` 等于 `old_string`
- **OR** 编码后的编辑内容将超过 `workspaceFiles.maxTextBytes`
- **THEN** Edit MUST 以 `CAPABILITY_INPUT_INVALID` 失败
- **AND** 该失败 MUST NOT 包含文件内容或 host 路径

### Requirement: Edit 使用基于快照的新鲜度防护

Edit SHALL 要求目标文件具有完整的 Read 快照，该快照由同一 `agentId + agentVersion + runId` 内先前的一次完整 Read（`offset=0`、`truncated=false`）建立。缺失完整 Read 状态 SHALL 以 `EDIT_REQUIRES_FULL_READ` 和 category `CONFLICT` 失败。

Edit SHALL 检测 Read 快照与当前磁盘状态之间的目标变化。Edit SHALL 在进入变更区段之前将目标与其记录的状态比较一次，并在文件系统替换前立即再次比较。目标发生变化 SHALL 以 `EDIT_TARGET_CHANGED` 和 category `CONFLICT` 失败。Edit 成功后，快照 SHALL 更新为新内容。

#### Scenario: Edit 要求先前的完整 Read

- **WHEN** Edit 的目标是一个现有文件且没有当前的完整 Read 快照
- **THEN** 调用 MUST 以 `EDIT_REQUIRES_FULL_READ` 失败
- **AND** 不得发生任何文件系统副作用

#### Scenario: Edit 检测到过期快照

- **WHEN** 执行了一次完整 Read
- **AND** 在 Edit 之前文件被外部修改
- **THEN** Edit MUST 以 `EDIT_TARGET_CHANGED` 失败
- **AND** 原文件 MUST 保持不变

#### Scenario: Edit 在替换前检测到目标变化

- **WHEN** 替换前一刻的目标状态与快照校验后观察到的状态不同
- **THEN** Edit MUST 以 `EDIT_TARGET_CHANGED` 失败
- **AND** 当前目标 MUST 保持不变

#### Scenario: Edit 成功后更新快照

- **WHEN** 执行了一次完整 Read
- **AND** Edit 成功修改了文件
- **THEN** 快照 MUST 更新为编辑后的内容
- **AND** 后续无需重新 Read 的 Write MUST 能基于更新后的快照成功

### Requirement: Edit 支持精确字符串替换语义

Edit SHALL 在现有文件内容中查找 `old_string` 的所有精确匹配。当 `replace_all` 为 false（默认）时，MUST 恰好存在一次匹配；零次匹配 SHALL 以 `EDIT_STRING_NOT_FOUND` 失败；多次匹配 SHALL 以 `EDIT_STRING_NOT_UNIQUE` 失败。当 `replace_all` 为 true 时，所有匹配 SHALL 被替换；零次匹配 SHALL 以 `EDIT_STRING_NOT_FOUND` 失败。

#### Scenario: 唯一的 old_string 成功替换

- **WHEN** `old_string` 在文件中恰好出现一次
- **AND** `replace_all` 为 false
- **THEN** 该唯一匹配 MUST 被替换为 `new_string`
- **AND** 结果 MUST 具有 `replaced_count: 1`

#### Scenario: replace_all 替换所有匹配

- **WHEN** `old_string` 在文件中出现多次
- **AND** `replace_all` 为 true
- **THEN** 所有匹配 MUST 被替换
- **AND** 结果 MUST 具有等于出现次数的 `replaced_count`

#### Scenario: 无 replace_all 时非唯一 old_string 失败

- **WHEN** `old_string` 在文件中出现多次
- **AND** `replace_all` 为 false
- **THEN** Edit MUST 以 `EDIT_STRING_NOT_UNIQUE` 失败
- **AND** 文件 MUST 保持不变

#### Scenario: old_string 未找到时失败

- **WHEN** `old_string` 未在文件中任何位置出现
- **THEN** Edit MUST 以 `EDIT_STRING_NOT_FOUND` 失败

### Requirement: Edit 保持文件编码

Edit SHALL 检测并保持现有文件的编码。支持的编码 SHALL 包括无 BOM 的 UTF-8、带 BOM 的 UTF-8、带 BOM 的 UTF-16 LE 和带 BOM 的 UTF-16 BE。输出文件 SHALL 使用与输入文件相同的编码写入。

#### Scenario: UTF-8 文件编码在 Edit 后保持不变

- **WHEN** 编辑一个 UTF-8（无 BOM）文件
- **THEN** 输出文件 MUST 编码为无 BOM 的 UTF-8
- **AND** 内容指纹 MUST 与预期的编辑后内容一致

### Requirement: Edit 拒绝授权写入目录之外的目标

Edit SHALL 只接受位于当前已接受 Agent 编译后的 `writeDirectories` 之内的目标。目录授权 SHALL 来自可信 app composition，且 SHALL NOT 由 Tool 输入提供或扩展。

#### Scenario: 目标位于配置的写入目录之外

- **WHEN** `file_path` 解析到 workspace 之内但在所有配置的 `writeDirectories` 之外
- **THEN** Edit MUST 以一个安全的授权结果失败
- **AND** 它 MUST NOT 触碰文件系统目标

### Requirement: Edit 目标必须存在

Edit SHALL 要求目标文件存在。SHALL NOT 允许通过 Edit 创建新文件（请使用 Write）。不存在的目标 SHALL 以 `EDIT_TARGET_MISSING` 失败。

#### Scenario: Edit 对不存在的文件失败

- **WHEN** `file_path` 指向一个不存在的文件
- **THEN** Edit MUST 以 `EDIT_TARGET_MISSING` 失败

### Requirement: Edit 使用原子替换

Edit SHALL 在内存中构造新的文件内容，将其写入目标目录中的一个唯一临时文件，刷新完整的编码内容，并通过平台 rename 原子地替换目标。它 SHALL 在替换前失败或 cancellation 时清理临时文件。

#### Scenario: 原子替换在失败时保持原文件不变

- **WHEN** Edit 在写入临时文件之后、rename 之前遇到任何错误
- **THEN** 原目标 MUST 保持不变
- **AND** 实现 MUST 清理自己的临时文件

### Requirement: clearRun 清除 Edit 快照

Edit 和 Write 快照 SHALL 限定在一个 run 范围内，并在调用 `clearRun` 时一起清除。`clearRun` 之后，Edit SHALL 要求一次新的完整 Read。

#### Scenario: clearRun 使 Edit 授权失效

- **WHEN** 存在完整 Read 快照
- **AND** 对该 run 调用了 `clearRun`
- **THEN** 后续 Edit MUST 以 `EDIT_REQUIRES_FULL_READ` 失败

### Requirement: Edit 结果与可观测性是安全的

成功结果 SHALL 只返回 type、规范化的 workspace 相对路径、`old_string`、`new_string`、`replaced_count` 和 `replace_all`。既有 tool-use/result 持久化和 `toolCallId` 关联 SHALL 提供可追溯性。

日志、audit、trace、metrics、SafeError、可用性原因和结果元数据 MUST NOT 包含完整文件内容、旧内容、新内容、diff、host 绝对路径、临时名称、workspace root、目录配置或文件指纹。

#### Scenario: Edit 失败不泄漏内容

- **WHEN** Edit 执行因任何原因失败
- **THEN** 错误输出 MUST NOT 包含文件内容、`old_string` 或 `new_string`
