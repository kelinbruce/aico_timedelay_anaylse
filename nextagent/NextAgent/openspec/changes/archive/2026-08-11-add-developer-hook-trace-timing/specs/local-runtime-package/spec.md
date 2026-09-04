# local-runtime-package Delta

## ADDED Requirements

### Requirement: 打包的 Agent 定义只有一个来源

local runtime package SHALL 只在 `agents/{agentId}/agent.yaml` 下暂存每个打包的 Agent 定义。package 启动 SHALL 通过已校验的系统配置和该 `agents/` 根加载 active Agent。打包流程和启动路径 MUST NOT 暂存或读取重复的 `config/default-agent.yaml`。

#### Scenario: 打包的 default Agent 启动时没有 config 副本
- **WHEN** 打包流程创建一个包含 `default-agent` 的 local runtime package
- **THEN** 该 package MUST 包含 `agents/default-agent/agent.yaml`
- **AND** 它 MUST NOT 包含 `config/default-agent.yaml`
- **AND** 启动 MUST 从打包的 `agents/` 根解析 active Agent。

#### Scenario: 配置的 active Agent 从其 Agent 根解析
- **WHEN** package 系统配置选择了一个 active Agent，且 `agents/{agentId}/agent.yaml` 存在
- **THEN** 启动 MUST 使用该 Agent 定义
- **AND** 它 MUST NOT 从 config 侧副本推断或覆盖被选择的 Agent。
