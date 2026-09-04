# Memory 抽取边界

## 状态（Status）

Accepted

## 背景与现状（Context）

自动学习会创建影响未来请求的持久事实。把它与 request 内联运行、默认使用 LLM 抽取或让它读取原始 history，会带来质量、隐私和延迟风险。

## 决策（Decision）

Memory 抽取是一个本地后端 dreaming 生命周期。它默认禁用、异步运行、只读取 owner/agent 范围的任务轨迹，并通过核心 memory gateway 写入。默认启用的策略是 `RULE_FIRST`；LLM 抽取是显式的，并使用共享的 `MEMORY_EXTRACTION` prompt assembly 边界。

抽取候选是内部证据对象。它们必须在写入之前通过按类别的质量和安全门禁。融合和置信度佐证通过核心 save 和 confidence 变更 API 完成，而不是通过 memory tool 或私有存储。

## 结果（Consequences）

系统在不阻塞 terminal commit、不扩张 context assembly 的情况下学习。代价是更慢的学习：一个事实可能只在下一个 dreaming 周期后才出现。该延迟是有意的；即时的用户导向写入使用 `add_memory`。
