## MODIFIED Requirements

### Requirement: Workspace 文件依赖支持 Edit 操作

受控的 `workspaceFiles` Tool 依赖 SHALL 与 Read 和 Write 文件系统操作一起拥有 Edit 操作。`WorkspaceFilePort` 接口 SHALL 暴露一个 `editText` 方法，该方法接收 Tool 输入、执行上下文和可选的 abort signal，并返回结构化输出。

该依赖 SHALL 为 Edit 授权复用 Read-before-Write 快照守卫。Edit SHALL 使用与 Write 相同的 `agentId + agentVersion + runId + normalized path` 快照存储。

该依赖 SHALL NOT 拥有 request lifecycle。App composition SHALL 使用既有的 runtime terminal observation 为 Write 和 Edit 触发 run 作用域的快照清理。

#### Scenario: Edit 与 Read 和 Write 使用同一个 workspaceFiles 依赖

- **WHEN** Read、Write 和 Edit Tool 访问 workspace 文件
- **THEN** 三者 MUST 使用同一个 `workspaceFiles` 依赖边界
- **AND** 任何 Tool 都不得直接 import 或调用宿主文件系统 API

#### Scenario: Edit 与 Write 共享快照存储

- **WHEN** 建立了一个完整 Read 快照
- **AND** Write 或 Edit 之一成功修改了该文件
- **THEN** 快照 MUST 被更新以反映新内容
- **AND** Write 和 Edit 都 MUST 看到更新后的快照
