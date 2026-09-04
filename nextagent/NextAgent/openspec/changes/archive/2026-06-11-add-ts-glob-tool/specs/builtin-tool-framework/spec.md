## ADDED Requirements

### Requirement: Workspace File 依赖支持受治理的 Discovery

受控的 `workspaceFiles` Tool 依赖 SHALL 暴露 builtin Glob Tool 所需的窄 discovery 操作。该操作 SHALL 接收已校验的 Glob 业务输入、可信 Tool 执行 context 和 `AbortSignal`。

该依赖 SHALL 拥有 Agent-scoped 的 Read 权限、可信的 workspace 包含关系、目录遍历、link 与文件类型检查、归一化的 workspace 相对输出和硬性容量上限。它 SHALL NOT 向 Tool 实现暴露 workspace root、宿主绝对路径、文件系统实现对象、raw 宿主 API 或 sandbox 执行。

Read、Write 和 Glob SHALL 使用同一 Agent assembly/version-scoped 的 `workspaceFiles` 依赖。本 change SHALL NOT 引入 Glob 专用的 filesystem port、gateway、权限模型或生命周期 owner。

#### Scenario: Glob 使用共享的受控依赖

- **WHEN** builtin Glob Tool 执行文件 discovery
- **THEN** 它调用 `workspaceFiles` 的 discovery 操作
- **AND** 它不直接调用宿主 filesystem 或进程 API

#### Scenario: Discovery 保持 Agent-scoped 权限

- **WHEN** app composition 为已受理的 Agent assembly/version 创建 `workspaceFiles`
- **THEN** Glob discovery 使用该 assembly 的有效 Read 权限
- **AND** 模型输入不能替换 workspace root 或目录权限
