# NextAgent Roadmap 分阶段计划

本目录承载 `docs/nextagent-ts-change-roadmap-v2.md` 中按路标版本拆分后的详细计划，便于按阶段跟踪进展。总入口继续保留全局规则、长期架构决策、准入规则、并行开发矩阵和一致性检查。

| 阶段 | 详细计划 |
|---|---|
| UCD 能力差距交付 | [ucd-capability-delivery.md](./ucd-capability-delivery.md) |
| Alpha E2E 回归 Gate | [alpha-e2e-regression-gate.md](./alpha-e2e-regression-gate.md) |
| P0 — 首版本地发布 | [p0-local-release.md](./p0-local-release.md) |
| P1 — 业务自定义/扩展机制 | [p1-business-extension.md](./p1-business-extension.md) |
| P2 — 正式版 | [p2-formal-release.md](./p2-formal-release.md) |
| P3 — Workflow 执行范式 | [p3-workflow-execution.md](./p3-workflow-execution.md) |
| P4 — 完成整体能力出口 | [p4-capability-exit.md](./p4-capability-exit.md) |
| P5 — 分布式与并行执行 | [p5-distributed-parallel.md](./p5-distributed-parallel.md) |
| 待规划模块 | [backlog.md](./backlog.md) |

跟踪规则：

1. 新增或调整路标版本时，先更新总入口的版本索引，再更新本目录对应分文件。
2. 每个分文件只维护该阶段的详细计划，跨阶段依赖继续在总入口的并行开发矩阵中统一表达。
3. 尚未归属具体版本、但后续可能排序进入 P0-P5 的能力统一放入 [待规划模块](./backlog.md)。
4. 单个 change 的详细输入仍维护在 `docs/nextagent-ts-changes/<change-id>.md`，本目录只做阶段跟踪索引。
5. UCD 里程碑是跨 P0-P5 的产品交付视图，只负责把设计差距映射到已有或新增 change；它不改变各版本的 release scope。
