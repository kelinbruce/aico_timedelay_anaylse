# ask-user-question-trigger-policy Specification

## Purpose
TBD - 由归档 change refine-ask-user-question-trigger-policy 创建。归档后更新 Purpose。
## Requirements
### Requirement: 被调用的只读网络 explorer 不直接创建用户问题

NextAgent SHALL 让 `network-explorer` 保持为一个被调用的、只读的电信证据收集 Agent，不直接创建用户 pending 问题。`network-explorer` 发现的缺失信息 MUST 以有来源支撑的发现、限制或缺失数据缺口的形式返回，交由面向用户的 Agent 处理。

#### Scenario: network-explorer 不能看到 AskUserQuestion 作为可调用 tool
- **WHEN** 为 `network-explorer` 组装 model 上下文
- **THEN** `AskUserQuestion` MUST NOT 作为该 Agent 的可调用 tool 被暴露
- **AND** 这 MUST 通过 Agent capability 配置来实施，而不是为 `network-explorer` 添加 runtime 特例。

#### Scenario: default-agent 保持用户提问能力
- **WHEN** 为面向用户的 `default-agent` 组装 model 上下文
- **THEN** 当 canonical 内置 descriptor 可用时，`AskUserQuestion` MUST 保持为可调用 tool
- **AND** `default-agent` MAY 决定 `network-explorer` 返回的缺失数据缺口是否应成为一个面向用户的 `AskUserQuestion` pending input。

