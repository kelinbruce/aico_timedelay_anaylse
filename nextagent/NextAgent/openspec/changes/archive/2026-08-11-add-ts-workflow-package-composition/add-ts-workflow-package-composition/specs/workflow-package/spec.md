## ADDED Requirements

### Requirement: Package Structure and Exports

TS 后端 MUST 创建 `packages/agent-workflow/` 作为独立 workspace package。

#### Scenario: Public Exports Accessibility
- **WHEN** import `@nextagent/agent-workflow`
- **THEN** 调用方 MUST 能访问 `createWorkflowExecutionService`

### Requirement: Composition Wiring

`agent-app` 启动时 MUST 创建并注入 `WorkflowExecutionService`。

#### Scenario: Successful Composition
- **WHEN** 所有依赖可用
- **THEN** workflow service MUST 被成功创建并注入

#### Scenario: Wiring Failure
- **WHEN** factory 或 wiring 失败
- **THEN** 启动 MUST 失败

### Requirement: Local Recipe Loading

`agent-app` 启动期 MUST 从本地文件加载 recipe 索引，将静态 Recipe 资源发布为当前 Agent Scope 下的 `WORKFLOW` capability descriptor，并为 workflow execution wiring 提供 recipe definition source。

#### Scenario: Successful Recipe Load
- **WHEN** recipe 文件合法
- **THEN** recipe MUST 被解析、校验并作为 `WORKFLOW` capability 发布

#### Scenario: Invalid Recipe Skip
- **WHEN** 单个 recipe 文件非法
- **THEN** 该 recipe MUST 被跳过
- **AND** 启动 MUST 继续

### Requirement: Recipe Path Ownership

recipe 路径 MUST 默认为工程打包根目录（与 skills 根路径一致）下的 `recipes/` 与 `agents/{agentId}/recipes/`，且 MUST 只允许 workspace 内相对路径。

#### Scenario: Default Recipe Paths
- **WHEN** `agent-app` 启动装配 workflow recipe
- **THEN** 系统 MUST 扫描工程打包根目录下的 `recipes/`
- **AND** MUST 扫描 `agents/{agentId}/recipes/`

#### Scenario: Unsafe Trusted Root Rejection
- **WHEN** 默认 recipe 根目录解析到工程打包根目录之外
- **THEN** 启动 MUST 失败
