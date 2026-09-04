## ADDED Requirements

### Requirement: Write 是受治理的内建 Tool

系统 SHALL 通过 `defineTool` 定义一个小写的 `write` Tool，在自有内建 Tool 清单中显式注册它，并仅通过既有 Tool catalog、`BuiltinToolExecutor`、capability invocation 和受控 `workspaceFiles` 依赖边界执行它。

Write SHALL 声明 replay policy `NON_IDEMPOTENT`，并在当前版本中只要求受控的 `workspaceFiles` 依赖。它 SHALL NOT 接收 `CapabilityInvocationRequest`、workspace root、宿主路径或宿主文件系统 API。

#### Scenario: Write 被显式注册且无需 approval 即可用

- **WHEN** 内建 Tool catalog 在组合时带有 `workspaceFiles` 且不带未来的 `approval` readiness 依赖
- **THEN** catalog MUST 包含一个 `AVAILABLE` 的 `write` descriptor
- **AND** Write MUST 按既有 Agent binding 治理保持对 model 可见
- **AND** 系统 MUST NOT 伪造 approval 证据或创建私有确认流

### Requirement: Write 输入与输出有界

Write 输入 SHALL 恰好包含必填的 `file_path` 和 `content` 字符串字段。`file_path` SHALL 是 workspace 相对路径。`content` SHALL 非空，且其编码后的字节长度 SHALL NOT 超过 Agent 作用域的 `workspaceFiles.maxTextBytes`。

成功的业务输出 SHALL 恰好包含规范化的 `type="create"|"update"` 和规范化的 workspace 相对 `file_path`。它 SHALL NOT 包含 content、原始 content、diff、字节计数、宿主路径、临时路径或 `CapabilityInvocationResult` 信封。

#### Scenario: 空或超限 content 被拒绝

- **WHEN** `content` 为空或编码后超过 `maxTextBytes`
- **THEN** Write MUST 在产生文件系统副作用之前失败
- **AND** 失败信息 MUST NOT 包含 content 或宿主路径

### Requirement: Write 使用可信的 Agent 作用域目录授权

Write SHALL 只接受位于当前已接受 Agent 编译后的 `writeDirectories` 之内的目标。目录授权 SHALL 来自可信的 app composition，并 SHALL NOT 由 Tool 输入、model 输出、客户端 metadata 或 capability 参数提供或扩展。

`writeDirectories` SHALL 默认为空。每个配置的写目录 SHALL 同时可读。目录条目 SHALL 是规范化的 workspace 相对目录，其授权包含子代；`"."` SHALL 表示 workspace 根。绝对路径、父目录穿越、glob、symlink、junction、reparse-point 或逃出 workspace 的配置 SHALL 使受影响 Agent assembly 的编译失败。

#### Scenario: 目标位于已配置写目录之外

- **WHEN** `file_path` 解析后位于 workspace 之内但在所有已配置的 `writeDirectories` 之外
- **THEN** Write MUST 以安全的授权结果失败
- **AND** 它 MUST NOT 触碰文件系统目标

### Requirement: 已存在文件要求当前的完整 Read

一个已存在的目标仅当同一 `agentId + agentVersion + runId` 对规范化路径拥有完整 Read 快照时才 SHALL 可写。只有一次从 offset 零开始并返回 `truncated=false` 的 Read SHALL 建立该快照；部分读取 SHALL NOT 合并成写授权。

缺失完整 Read 状态时 SHALL 以 `WRITE_REQUIRES_FULL_READ` 和类别 `CONFLICT` 失败。一次成功的 Write SHALL 将同一 run 本地的完整 Read 快照更新为新写入的内容。快照 SHALL 保持进程本地，并 SHALL 在 run 结束、重启或恢复之后被丢弃。

#### Scenario: 已存在文件未被完整读取

- **WHEN** Write 的目标是一个缺少当前完整 Read 快照的已存在文件
- **THEN** 调用 MUST 以 `WRITE_REQUIRES_FULL_READ` 失败
- **AND** 不得发生任何目录、临时文件或目标文件副作用

### Requirement: Write 检测并发目标变更

Write SHALL 在进入变更区段之前将目标与其记录状态比较一次，并在文件系统替换之前立即再比较一次。自 Read 以来已变更的已存在文件，或在替换之前被新建的目标，SHALL 以 `WRITE_TARGET_CHANGED` 和类别 `CONFLICT` 失败。

冲突失败 SHALL NOT 自动重试，并 SHALL 要求在下一次 Write 尝试之前进行新的完整 Read。

#### Scenario: 目标在替换之前发生变更

- **WHEN** 替换之前瞬间的目标状态与校验后观察到的状态不同
- **THEN** Write MUST 以 `WRITE_TARGET_CHANGED` 失败
- **AND** 它 MUST 保持当前目标不变

### Requirement: Write 暂时在无 runtime 拥有的 approval 下执行

在当前版本中，每个已校验且已授权的 create 或 update SHALL 在不等待 runtime 拥有的 approval 的情况下执行。系统 SHALL 通过从 Write 的必需依赖中省略 `approval` 来直接表示这一状态；它 MUST NOT 注入伪造的 readiness 标记或声称发生过 approval。

本 change SHALL NOT 定义 approval 请求/应答 payload、Tool 挂起/恢复、UI 行为或私有 approval 实现。后续的 Capability Approval change MUST 在文件系统副作用之前为每个 create 和 update 恢复一个操作特定的 runtime 拥有的 approval。

后续 approval 路径 SHALL 能够为受控确认提供完整的旧内容和新内容。完整内容 SHALL NOT 进入普通 stream 事件、日志、audit、trace、metrics、SafeError 或结果 metadata。

#### Scenario: 当前版本缺少 approval 基础设施

- **WHEN** app composition 无法提供受治理的 approval readiness 依赖
- **THEN** 当 `workspaceFiles` 可用时 Write MUST 保持可用
- **AND** 执行仍 MUST 强制执行全部目录授权、完整 Read、冲突、文件类型、编码、容量、原子性、cancellation 和安全输出约束

### Requirement: Write 只接受受支持的文本文件

Write SHALL 将新文件创建为不带 BOM 的 UTF-8。对已存在文件，它 SHALL 支持并保留不带 BOM 的 UTF-8、带 BOM 的 UTF-8、带 BOM 的 UTF-16 LE 和带 BOM 的 UTF-16 BE。一个不带 BOM 且不是有效 UTF-8 的已存在文件 SHALL 被拒绝。

Write SHALL 精确保留调用方的行尾，并 SHALL NOT 规范化 LF 或 CRLF。它 SHALL 拒绝二进制或未知编码、目录、设备、socket、FIFO、symbolic link、junction、reparse point，以及硬链接数超过一的已存在目标。

#### Scenario: 链接或非文本目标被拒绝

- **WHEN** 目标或已存在的父目录跨越链接边界，或目标不是受支持的常规文本文件
- **THEN** Write MUST 在变更之前安全失败
- **AND** 它 MUST NOT 暴露宿主路径或文件内容

### Requirement: Write 使用原子替换

在第二次目标状态检查之后，Write SHALL 使用平台默认的安全权限递归创建缺失的已授权父目录，在目标目录中创建唯一的临时文件，写入并 flush 完整的编码内容，然后原子地创建或替换目标。

Write SHALL 在替换前失败或 cancellation 时清理当前调用创建的临时文件。如果无法保证原子替换，它 SHALL 直接失败而不回退到直接覆写。它 SHALL NOT chmod、清除只读属性、提升权限或接受 mode 参数。

#### Scenario: 原子替换不可用

- **WHEN** 平台 adapter 无法保证原子目标替换
- **THEN** Write MUST 安全失败
- **AND** 原目标 MUST 保持不变
- **AND** 实现 MUST 清理自己创建的临时文件

### Requirement: Write 结果与可观测性是安全的

成功结果 SHALL 只返回 create/update 类型和规范化的 workspace 相对路径。既有的 tool-use/result 持久化和 `toolCallId` 关联 SHALL 提供可追溯性；Write SHALL NOT 创建重复的内容证据存储。

日志、audit、trace、metrics、SafeError、可用性原因和结果 metadata MUST NOT 包含文件内容、原始内容、diff、宿主绝对路径、临时名称、workspace 根、目录配置或文件指纹。

#### Scenario: Write 调用被观测

- **WHEN** Write 的执行或不可用被记录日志、追踪、审计或度量
- **THEN** 可观测性 MAY 包含稳定的调用 id、capability id、create/update、status、duration bucket 和低基数 reason code
- **AND** 它 MUST NOT 包含文件内容或宿主文件系统细节
