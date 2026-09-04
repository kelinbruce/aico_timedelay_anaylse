# clarify-cron-result-session-navigation-policy

规划入口：[UCD 能力差距交付里程碑](../roadmap/ucd-capability-delivery.md)
所属分组：UCD-P3

状态：clarify
类型：architecture/product decision input
主要 owner：待 runtime/session/Cron ownership 决策
认领人：不可认领
依赖：既有 Cron occurrence 提交与 session-bound request lifecycle

当前状态：
- Cron occurrence 通过 runtime 提交普通 request/run，并绑定创建任务时的 session。
- 该现状由 `add-ts-cron-tools` active change 与当前代码承载，会把结果写入原会话；该 change implementation tasks 已完成但尚未 archive。
- UCD 目标把 Cron 视为后台执行并要求输出不进入原会话 active context；这是待与当前 OpenSpec/代码协调的产品设计约束，不是当前已生效的权威契约。
- 用户仍需要从任务管理面查看结果；符合该约束的目标路线会产生不同的 context、导航和恢复语义。

目标：
- 为 B19 固定唯一 occurrence 结果归属和用户导航策略，避免 context 污染、不可追溯结果或第二套 terminal path。

进入 `ready` 前必须确认：
- 首版优先在以下满足 UCD 隔离目标的路线中选一条：每次 occurrence 使用受控派生 session、每个 schedule 使用受控执行 session，或写独立结果日志。
- 若产品决定保留当前“继续写原 session”，必须显式解释 active-context 影响，并先通过相应 architecture/spec refinement；不得静默把 UCD 目标或当前代码任一方当成已裁决结论。
- 结果是否参与后续模型 context，session title/list/search/share/fork 如何处理。
- schedule、occurrence、requestId/runId 和用户可见结果之间的 durable relation。
- 重复触发、重试、misfire/recovery、删除 schedule 后历史结果的可见性。

实现约束：
- execution 仍走标准 request/run 和 terminal commit，不创建 Cron-private execution lifecycle。
- Owner Scope、Agent Scope 和 occurrence idempotency 必须贯穿所选路线。
- 不与管理 UI 卡混写未确认的结果跳转链接。

并行边界：
- clarify 状态不可实施。
- policy 固定后，contract/runtime change 必须先于结果导航 UI。
