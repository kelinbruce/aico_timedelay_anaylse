# 任务轨迹学习输入

## 状态（Status）

Accepted

## 背景与现状（Context）

自动长期记忆抽取需要稳定、安全的输入。原始 message history 混合了用户表达、模型叙述、tool 细节、隐藏替换状态和最终事实；直接使用它会在 memory 抽取内部重复 context/session 选择规则。

## 决策（Decision）

系统将 `TaskTrajectoryRecord` 持久化为 terminal commit 后的读取模型。它捕获安全的任务目标、约束、观察、动作、结果状态、证据级别和来源引用。它从已提交的公开 gateway 事实异步构建，是 memory 抽取的输入层。

Runtime 只发布已持久化的 terminal timeline 事实；`agent-memory` 拥有本地轨迹构建和追赶。任务轨迹是历史投影，不被后续相似轨迹重写。跨 session 佐证发生在长期记忆 record 中，而不是通过编辑旧轨迹结果。

## 结果（Consequences）

抽取获得一个有界、可审计的输入表面，不再需要解析原始 session history。代价是多出一个持久读取模型和 worker。这是合理的，因为它保护了原始内容边界，并把 request 事实与学习输入分离。
