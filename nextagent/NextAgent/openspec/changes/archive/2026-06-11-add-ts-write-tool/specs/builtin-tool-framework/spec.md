## ADDED Requirements

### Requirement: Workspace 文件依赖支持受治理的 Read 与 Write 状态

受控的 `workspaceFiles` Tool 依赖 SHALL 拥有内建文件 Tool 所需的 Read 与 Write 文件系统操作。它 SHALL 接受可信的 Tool 执行上下文，并 SHALL NOT 向 Tool 实现暴露 workspace root、宿主绝对路径、文件系统实现对象或原始宿主 API。

该依赖 SHALL 维护按已接受的 Agent identity/version 和 request run 划定作用域的进程本地完整 Read 快照。它 SHALL 在一次成功的受治理 Write 之后更新快照，并 SHALL NOT 在 run 完成、重启或恢复之间持久化或复用快照。

该依赖 SHALL NOT 拥有 request lifecycle。App composition SHALL 使用既有的 runtime terminal observation 来触发 run 作用域的快照清理，而不得创建平行的 scheduler、terminal event 或 persistence model。

#### Scenario: Read 与 Write 共用一个受控依赖

- **WHEN** 内建 Read 和 Write Tool 访问 workspace 文件
- **THEN** 二者 MUST 使用同一个 `workspaceFiles` 依赖边界
- **AND** 任何 Tool 都不得直接 import 或调用宿主文件系统 API

### Requirement: Tool 依赖可要求 Approval 就绪

Tool 框架 SHALL 将 `approval` 识别为一个受控的 readiness 依赖名。在本 change 中，该依赖 SHALL 不提供面向 Tool 的确认协议，并 SHALL NOT 授权 Tool 实现创建私有 pending 状态。

当 app composition 未提供来自完整 runtime 拥有的 approval 集成的就绪证据时，要求 `approval` 的 Tool SHALL 处于不可用状态。

#### Scenario: 保留的 approval 依赖缺失

- **WHEN** 一个已注册的 Tool 要求 `approval`
- **AND** 没有完整的 approval 集成提供该依赖
- **THEN** descriptor MUST 为 `UNAVAILABLE`
- **AND** Tool 可执行体 MUST NOT 运行
