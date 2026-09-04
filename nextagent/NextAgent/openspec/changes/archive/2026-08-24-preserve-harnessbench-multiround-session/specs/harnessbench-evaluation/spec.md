## Function

- **所属 Function**：`FN-10.13 HarnessBench 评测`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 多轮任务保持会话连续且跨任务隔离

当固定 HarnessBench task 以同一个上游 session id 提交多个顺序轮次时，评测系统 MUST 让全部轮次使用同一个 NextAgent 候选持久化边界和同一个 NextAgent session，并 MUST 让后续轮次通过公开 request 与 stream 行为观察前序轮次已经持久化的会话事实。不同上游 session id、不同 task 或不同评测 run MUST NOT 共享候选持久化边界、NextAgent session 或映射状态。HarnessBench 输入 workspace 由上游 task 生命周期拥有，不属于本 Requirement 的隔离 owner。每轮完成后系统 MUST 有界停止本轮 local runtime；停止进程 MUST NOT 删除仍供同 task 后续轮次使用的持久化边界。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复
**适用范围**：该 Function

#### Scenario: 同一 session 的第二轮观察第一轮会话事实
- **WHEN** 一个多轮 task 的第一轮通过真实 NextAgent session 持久化会话事实，第二轮使用相同 HarnessBench session id 提交新 request
- **THEN** 第二轮使用与第一轮相同的 NextAgent session
- **AND** 第二轮可通过产品既有 context/history 路径观察第一轮已经持久化的会话事实

#### Scenario: 不同 session 保持隔离
- **WHEN** 两个 HarnessBench task 或两个不同上游 session id 分别执行
- **THEN** 它们使用不同的候选持久化边界和 NextAgent session
- **AND** 任一执行均不能观察另一执行的 NextAgent session、候选持久化事实或映射状态

#### Scenario: 首轮执行初始化会话
- **WHEN** 一个合法上游 session id 尚无已完成初始化的复用状态
- **THEN** 系统初始化隔离候选持久化边界并通过公开 API 创建恰好一个 NextAgent session
- **AND** 仅在初始化完整成功后使该状态可供后续轮次复用

#### Scenario: 非法复用状态安全失败
- **WHEN** 上游 session id 对应的复用状态无法通过版本、session identity 或 containment 校验
- **THEN** 系统 MUST 拒绝使用该状态并形成安全 task failure
- **AND** MUST NOT 读取边界外路径、复用其他 session 或以部分状态继续执行

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：多轮 task 首轮初始化隔离候选和 NextAgent session，后续同 session 轮次复用该持久化边界与 session；每轮有界停止 runtime，不同 session、task 和 run 始终隔离，非法复用状态安全失败。
- **依据 Requirements**：`多轮任务保持会话连续且跨任务隔离`

### 规格

- **规格项**：多轮会话连续性
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：同一 HarnessBench session id 的全部顺序轮次复用同一 NextAgent 候选持久化边界和 session；不同 session id、task 或 run 不共享状态
- **依据 Requirements**：`多轮任务保持会话连续且跨任务隔离`
