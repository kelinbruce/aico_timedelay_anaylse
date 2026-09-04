<!--
本文件是 active change 的行为规格 delta，路径为 specs/e2e-ui-interaction/spec.md。
-->

## ADDED Requirements

### Requirement: User Input Reply

系统 SHALL 在前端呈现用户输入框，用户提交后显示模型回复，回复通过 SSE stream 实时渲染。

#### Scenario: 问答交互
- **WHEN** 用户在输入框输入问题并提交
- **THEN** 模型回复通过 SSE stream 逐字渲染显示

### Requirement: SSE Stream Consumption

系统 SHALL 在前端正确消费 SSE stream，包括 text delta、tool_call 渲染和 terminal 事件。

#### Scenario: SSE stream 消费
- **WHEN** 请求产生 SSE stream
- **THEN** 前端实时渲染 text delta，tool_call 以可展开卡片呈现，terminal 事件正确更新 UI 状态

### Requirement: Tool Call Render

系统 SHALL 将模型返回的 tool_call 以可视化方式呈现，包含工具名称、参数和执行结果。

#### Scenario: 工具调用展示
- **WHEN** 模型调用 bash 工具
- **THEN** 前端展示工具名称、命令内容和执行结果

### Requirement: Session Management UI

系统 SHALL 支持前端会话管理：创建新会话、切换会话、删除会话、重命名会话。

#### Scenario: 会话操作
- **WHEN** 用户创建、切换、重命名、删除会话
- **THEN** 各操作正确执行，会话列表实时更新

### Requirement: Auth Settings UI

系统 SHALL 支持前端认证设置：登录/登出、API Key 配置、模型选择。

#### Scenario: 认证设置操作
- **WHEN** 用户登录、配置 API Key、选择模型
- **THEN** 认证状态正确更新，后续请求使用新配置
