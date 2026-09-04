# add-ts-parallel-result-aggregation

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：扩展候选 / Bounded parallel execution

状态：candidate
类型：扩展候选 change
主要 owner：待定
依赖：进入实施前重新审查

目标：
- 不纳入首版本地 release。首版可以支持多个 session/run 并发处理，但单个 run 内部保持受控串行推进；Agent 层并行 DAG、并行预算、结果聚合、并行取消/恢复一致性和并行可观测聚合均后置。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
