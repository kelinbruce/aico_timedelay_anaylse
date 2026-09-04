## MODIFIED Requirements

### Requirement: Planning Tool Calling 模式恰好暴露一个规划工具族

app configuration SHALL 支持 `nextAgent.system.planning-tool-calling-mode`，取值为 `todo-write` 和 `task-tools`。若省略，系统 SHALL 默认为 `todo-write` 以保持既有行为。

该模式 SHALL 在可信 app configuration 期间解析，并被转发给内建 Tool catalog。该模式 SHALL 只影响 model 可见的内建规划 Tool 族。它 SHALL NOT 从配置创建 Tool、改变 provider 身份、替换 Tool schema 或改变 Tool 执行语义。

在 `todo-write` 模式下，内建 Tool catalog SHALL 在 TodoWrite 本来可用时暴露 `TodoWrite`，并 SHALL 抑制与 `Task*` 系列匹配的内建 Tool capability id。在 `task-tools` 模式下，内建 Tool catalog SHALL 抑制 `TodoWrite`，并 SHALL 在那些 Tool 已注册且本来可用时暴露内建 `Task*` Tool descriptor。

#### Scenario: TodoWrite 模式抑制 Task 系列工具

- **WHEN** app configuration 省略 `nextAgent.system.planning-tool-calling-mode` 或将其设置为 `todo-write`
- **AND** 内建 Tool 列表包含 `TodoWrite` 和一个或多个 `Task*` Tool
- **THEN** model 可见的内建 Tool descriptor MUST 包含 `TodoWrite`
- **AND** MUST NOT 包含 `Task*` Tool。

#### Scenario: Task 系列模式抑制 TodoWrite

- **WHEN** app configuration 把 `nextAgent.system.planning-tool-calling-mode` 设置为 `task-tools`
- **AND** 内建 Tool 列表包含 `TodoWrite` 和一个或多个 `Task*` Tool
- **THEN** model 可见的内建 Tool descriptor MUST NOT 包含 `TodoWrite`
- **AND** 在 `Task*` Tool 的常规依赖和配置检查通过时 MUST 包含这些 Tool。

#### Scenario: App composition 转发规划工具模式

- **WHEN** app 从一个 ready 的 system config 组装 capability 子系统
- **THEN** 它 MUST 把规范化的 planning Tool Calling 模式传递给内建 Tool catalog
- **AND** model invocation 的 Tool 投影 MUST 反映该 app 实例所选的族。

### Requirement: Tool 依赖是可选且受控的

Tool framework SHALL 定义可选的受控 Tool 依赖。支持的依赖名 SHALL 包括 `sandbox`、`workspaceFiles`、`skillSources`、`approval` 和 `todoState`。Tool MAY 在 metadata 中声明必需的依赖名。catalog SHALL 在一个 Tool 变为可执行之前校验其必需依赖。

Tool 实现 MUST NOT 通过 Tool 输入或 `CapabilityInvocationRequest` 接收 workspace root、宿主绝对路径、sandbox 内部实现、gateway-local 私有实现、宿主进程 API、runtime 私有 state 对象、channel 私有 state 对象或 model 提供的 scope 身份。

面向 Tool 的 sandbox 依赖 SHALL 只暴露窄的 `runShell` 和 `runPython` 操作。面向 Tool 的 `workspaceFiles` 依赖 SHALL 暴露受治理的 read、write、glob 和 run cleanup 操作。面向 Tool 的 `skillSources` 依赖 SHALL 暴露受治理的 Skill 资源访问。保留的 `approval` 依赖 SHALL 只在存在完整的 runtime 拥有的审批集成时提供 readiness 证据。面向 Tool 的 `todoState` 依赖 SHALL 只暴露 `TodoWrite` 所需的 scoped todo read/replace/clear 操作；它 MUST NOT 暴露 runtime lifecycle 变更、terminal commit、checkpoint 变更、Web channel 投影内部实现或持久化任务调度。

Tool metadata SHALL NOT 作为 capability 特定可观测投影语义的 owner。Tool metadata MAY 暴露面向 model 的 descriptor 事实、schema、依赖要求、replay policy 和 disclosure policy。内建 Tool 的低基数诊断 SHALL 由 runtime、gateway 或 observability owner 从安全结果形态和可信执行事实推导。

#### Scenario: 必需依赖必须可用

- **WHEN** Tool metadata 声明了一个必需依赖
- **AND** capability 子系统未提供该依赖
- **THEN** 该 Tool MUST NOT 变为可执行
- **AND** catalog MUST 暴露一个带安全可用性原因的 unavailable descriptor。

#### Scenario: Workspace root 不暴露给 Tool

- **WHEN** 一个 Tool 需要 workspace 文件访问
- **THEN** 它 MUST 使用受控的 `workspaceFiles` 依赖
- **AND** 它 MUST NOT 从 request 参数、客户端 metadata、model 输出或 capability invocation payload 接收或推导 workspace root。

#### Scenario: Sandbox 依赖在框架中只是接口

- **WHEN** 该框架暴露 `sandbox` 依赖
- **THEN** 它只暴露面向 Tool 的 `runShell` 和 `runPython` 接口
- **AND** 它不实现 sandbox 执行
- **AND** 它不要求 `agent-capability` import gateway contract。

#### Scenario: TodoWrite 使用 scoped todo state 依赖

- **WHEN** `TodoWrite` Tool 需要读取或替换一个 todo 列表
- **THEN** 它 MUST 使用受控的 `todoState` 依赖
- **AND** 它 MUST 把可信的 `ToolExecutionContext` 事实传递给该依赖
- **AND** 它 MUST NOT 从 model 输入接收 todo scope、session id、agent id、owner id、runtime lifecycle 对象、channel 投影对象或持久化实现。

#### Scenario: Tool metadata 不拥有可观测投影

- **WHEN** 一个内建 Tool 需要低基数诊断
- **THEN** runtime、gateway 或 observability owner MUST 从安全结果形态和可信执行事实推导这些诊断
- **AND** Tool metadata MUST NOT 定义 Tool 特定的 observability projector。
