# add-ts-runtime-multi-instance-consistency

规划入口：[P5 — 分布式与并行执行](../roadmap/p5-distributed-parallel.md)

状态：blocked
类型：contract refinement + implementation change
主要 owner：`agent-runtime`
依赖：`refine-ts-agent-gateway-state-store-boundary` 归档；如新增或调整 `agent-contracts` public Record、port、enum 或 export，必须先完成群内确认

目标：
- 在多个健康 NextAgent 实例共同服务时，无论请求到达哪个实例，用户提交、取消、重试和已有请求抢占都保持与单实例相同的可观察语义。
- 同一 Session 任意时刻最多有一个活动任务，不同 Session 可以由不同实例并行处理。
- 长任务不会因固定超时失去执行权；已经失去执行权的实例不能再提交 checkpoint、timeline 或 terminal result。

规格输入：
- 新请求抢占继续沿用已有语义：它表达对前一请求的补充，Runtime 在当前不可中断操作安全结束后尽快切换；本 change 只保证该语义跨实例不退化。
- 任务执行权、same-session lane、取消/抢占意图和 lifecycle 状态必须以所有实例可查询的持久化事实为准，进程内状态只能作为可重建投影。
- 执行权必须可续期并携带单调 fencing identity；过期或被替换的执行者提交副作用时必须得到确定性冲突，不得覆盖新 owner 的事实。
- 请求重复提交、取消重复投递、重试竞争和抢占竞争必须产生单一、可审计的规范结果。

契约输入：
- 在 StateStore capability-specific ports 中补齐 RequestRun、session lane ownership、执行租约、控制意图及必要查询；不得把控制算法放入 Gateway。
- Runtime 负责生成和解释 claim、renew、release、cancel、preempt 和 retry command，StateStore 只原子持久化、CAS 和返回冲突结果。
- 同一次 acceptance、lane claim 和初始 timeline 写入若共同决定请求是否可执行，必须使用单一 composite write 和事务边界。
- 所有运行事实继续同时携带可信 Agent Scope 和 Owner Scope；不得信任客户端传入的 owner、agent 或 instance identity。

实现约束：
- shared state、lease/fencing 和正常操作 HA 必须在同一 change 完成；只交付其中一项会形成无法安全使用的半成品。
- Runtime scheduler 从 StateStore 恢复待处理任务和控制意图，但业务决策仍留在 `agent-runtime`，gateway-local 不反推任务语义。
- LOCAL 验证使用同节点、共享文件系统和同一 SQLite 文件的两个独立进程；该路径用于低成本验证，不承诺生产级 LOCAL HA。
- REMOTE 验证只针对外部 StateStore conformance fixture；当前仓库不实现远端持久化服务。
- 测试必须显式把请求发送到不同实例，不依赖或引入真实负载均衡器。

非目标：
- 不实现实例崩溃后的自动任务重放或故障接管。
- 不迁移进程内 `LIVE_ONLY` stream delta、subscriber 或 token 级实时流。
- 不实现负载均衡、Session affinity 配置、集群编排或 REMOTE StateStore 服务。
- 不改变现有抢占产品语义、重试业务规则或 Agent Core 路由语义。

验收要点：
- 两个实例同时收到同一 Session 的请求时，系统只产生一个活动执行；不同 Session 能在两个实例并行推进。
- 请求由实例 A 执行时，经实例 B 发起的取消、重试或新请求抢占能够形成唯一持久化控制意图，并由当前 owner 在安全边界执行。
- 运行时间超过初始租约窗口的任务持续续期且不被第二实例重复执行。
- 旧 owner 在租约过期或被替换后提交 checkpoint、timeline 或 terminal result 时得到 version/fencing conflict，规范事实不被污染。
- 重复命令和并发竞争测试能够证明幂等、同会话单活动任务以及 Agent Scope/Owner Scope 隔离。

并行边界：
- 本 change 独占 runtime request lifecycle、same-session lane、scheduler ownership 和相关 StateStore write contract。
- 可与不修改 runtime lifecycle 或 gateway persistence contract 的独立 UI、模型 adapter、Capability change 并行。
- Session reconnect 和故障接管 change 只消费本 change 的稳定事实与控制边界，不得并行争夺同一 runtime 主流程。
