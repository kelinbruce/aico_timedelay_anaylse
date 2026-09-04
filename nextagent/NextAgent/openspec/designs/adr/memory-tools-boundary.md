# Memory Tool 边界

## 状态（Status）

Accepted

## 背景与现状（Context）

长期记忆只有在检索是有意、范围化且可审计时才能改进模型行为。把 memory 自动加入 context assembly 会使 memory 选择变成隐式的、更难解释，并能在没有模型可见动作或 capability 审计轨迹的情况下影响模型输出。

## 决策（Decision）

面向模型的长期记忆检索通过受治理的 tool 暴露：`search_memory`、`get_memory_detail` 和 `add_memory`。这些 tool 只有在 app composition、冻结的 memory 配置和当前 Agent assembly 三者一致 opt-in 时才可见。

Context assembly 不自动搜索或注入长期记忆。后台抽取和老化也不调用面向模型的 memory tool；它们直接消费 gateway port 或其拥有的生命周期 helper。

Memory tool schema 在能提升确定性调用成功率时可以容忍常见的模型输出噪声，但容忍止步于 tool provider 边界。`agent-memory` 在 gateway 写入之前规范化便利输入，忽略 `USER_CHARACTERISTICS` 之外不适用的搜索提示（如 `purpose`），并保持严格的核心 memory gateway contract 和可信 scope 注入。

## 结果（Consequences）

这保持第一版实现的简单和可审计：memory 使用表现为一次带 schema 校验、可信 scope 注入、timeout/cancel 处理和安全可观测性的 capability invocation。代价是模型必须自己选择何时检索 memory。如果未来需求需要自动 memory context，必须新增单独的 OpenSpec change 来定义查询策略、披露预算、审计证据、opt-out 行为和 negative test。
