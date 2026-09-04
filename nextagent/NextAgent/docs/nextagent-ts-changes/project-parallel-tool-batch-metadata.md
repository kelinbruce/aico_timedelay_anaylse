# project-parallel-tool-batch-metadata

规划入口：[UCD 能力差距交付里程碑](../roadmap/ucd-capability-delivery.md)
所属分组：UCD-P3

状态：clarify
类型：candidate contract refinement
主要 owner：待 canonical timeline/Web projection owner 确认
协作 owner：`agent-runtime`、`agent-channel-common`、`agent-channel-web`、`frontend/agent-web`
认领人：不可认领
依赖：既有 readonly tool fanout/timeline 与 process history continuity

当前状态：
- backend timeline 可表达并行 tool batch 的执行关系，但 Web stream/history presentation 没有稳定同形的 batch mode、ordinal、size 投影。
- frontend 不得根据时间重叠或相邻事件猜测并行。

目标：
- 为用户可见 process presentation 提供安全、可重放的 parallel batch metadata，使 live/history 能明确标识同一并行批次。

进入 `ready` 前必须确认：
- canonical source 是 runtime timeline 还是已有 capability batch fact。
- public 字段最小集合、batch identity 生命周期、ordinal/size 约束和串行 batch 的缺省表示。
- SSE/WS、history replay、retry/recovery 和 partial batch failure 的同形语义。
- contract refinement 与 frontend consumer 是否拆成两个顺序 change。

实现约束：
- frontend 不发明 batch id，不按 timestamp 猜测并行。
- 不修改 readonly fanout 执行策略、same-session lane 或 terminal commit。
- public DTO/event 变化必须先完成 contract review 和群内确认。

并行边界：
- clarify 状态不可实施。
- 不并入纯 frontend process activity change。
