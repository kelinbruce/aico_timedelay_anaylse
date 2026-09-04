## ADDED Requirements

### Requirement: 已授权 Skill 投影提供一个有界的 Python 模块根

`WorkspaceFilePort` MUST 把先前为同一可信 Agent scope 和 run 授权的每个已提交 Skill 投影，仅作为既有的内部 sandbox filesystem 事实暴露。本地 sandbox MUST 只为 Python 模块模式从这些事实派生一个 Python 模块根。任何组件都 MUST NOT 通过 descriptor、生成的 Skill 消息、model 可见的 workspace 路径、Web 响应、audit 细节或 safe error 发布物理根。

投影授权集合 MUST 保持为该事实的唯一来源。`WorkspaceFilePort` MUST 保留全部已授权根而不做选择；本地 sandbox MUST 对空的或多根的集合拒绝模块模式。任何组件都 MUST NOT 依据插入顺序、字典序、模块名或 source 文件系统布局选择。

#### Scenario: 投影授权以 run 为 scope

- **WHEN** 一个 Skill 资源投影为某个 run 被提交并授权
- **THEN** 只有该 run 的 sandbox filesystem 准备 MAY 把该投影当作 Python 模块根消费
- **AND** 另一个 run、Agent scope 或 owner scope MUST NOT 消费它

#### Scenario: 多个投影根无法被隐式选择

- **WHEN** 当前 run 有多于一个已授权 Skill 投影
- **AND** Python 模块模式需要一个 import 根
- **THEN** 本地 sandbox MUST 以显式的安全失败拒绝模块模式
- **AND** 它 MUST NOT 隐式选择某一个投影
