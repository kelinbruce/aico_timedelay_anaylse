# add-cron-task-management-surface

规划入口：[UCD 能力差距交付里程碑](../roadmap/ucd-capability-delivery.md)
所属分组：UCD-P3

状态：clarify
类型：candidate management vertical
主要 owner：待 Cron management application boundary 确认
协作 owner：`agent-capability`、`agent-channel-web`、`frontend/agent-web`
认领人：不可认领
依赖：`add-ts-cron-tools` implementation tasks 已完成、代码已入主干；active change archive pending

当前状态：
- `add-ts-cron-tools` 已在主干提供 durable Cron gateway、LOCAL/REMOTE scheduler、标准 runtime submission 和 create/list/delete tool，但 OpenSpec change 尚未 archive；本卡不能把它引用为 stable spec。
- Cron tool 的 list scope 当前绑定 owner、Agent 和 session；frontend 尚无专用 Cron safe-result presentation 或 agent-level 管理面。
- 旧 `add-ts-recurring-agent-tasks` 提议的第二套 runtime-owned recurrence lifecycle 不再作为增量实现路径。

目标：
- 在既有 Cron facts 上提供安全、可审计的用户管理入口和结果呈现，不重建 scheduler、occurrence 或 request lifecycle。

进入 `ready` 前必须确认：
- 管理查询是 session-scoped 还是 agent-scoped；跨 session 查询必须有明确 owner/Agent Scope contract。
- 首版支持的操作集合：list/get/delete，以及是否需要 pause/resume/update/run-now；不得在实现阶段临时选择。
- management application service 的 owner、Web API DTO、分页/排序、状态和 safe prompt preview。
- C4 Cron safeResult presentation 与 A5 sidebar/modal 管理面是否拆成两个独立 implementation change。
- C9 `nextRunAt` 的 canonical source、时区和过期/错过触发呈现。

实现约束：
- scheduler 和 occurrence claiming 继续由现有 Cron backend 拥有；runtime 只执行标准 request/run。
- `agent-channel-web` 只投影管理 API，frontend 只拥有 UI/view state，gateway 不判断用户业务权限。
- 不通过 Cron tool list 的 session scope 偷渡 agent-level 查询。

非目标：
- 不实现新的 recurrence store、通用平台 scheduler、任务市场或 workflow engine。
- 不在本卡决定 occurrence 结果的 session/context 归属；该问题由独立 policy clarify 承接。

并行边界：
- clarify 状态不可实施。
- owner 与 API scope 决定后，应拆成 backend management contract 和 frontend surface 两个顺序 change，除非设计能证明单 owner vertical。
