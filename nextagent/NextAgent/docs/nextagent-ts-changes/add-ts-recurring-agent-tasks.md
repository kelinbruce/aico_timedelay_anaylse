# add-ts-recurring-agent-tasks

[返回 roadmap-v2](../nextagent-ts-change-roadmap-v2.md)

状态：candidate

处置：re-scope required；不再作为 UCD A5/B19 的实施输入

## 当前基线变化

`add-ts-cron-tools` 的 implementation tasks 已完成、代码已入主干，但 active change 尚待 archive；当前提供：

- owner/Agent/session-scoped durable Cron task gateway；
- LOCAL scheduler 与 REMOTE callback/trigger 接入；
- occurrence 通过标准 runtime request/run 提交；
- create/list/delete Cron tool 与 safe result projection；
- 既有重启、重复扫描、幂等和审计边界。

本卡原先提出由 `agent-runtime` 重新拥有 recurrence lifecycle、due claiming、overlap/misfire 和第二套管理契约，与上述基线形成 owner 重叠。该路线不得直接生成 OpenSpec 或实现。

## 后续拆分

- A5/C4/C9：使用 [`add-cron-task-management-surface`](add-cron-task-management-surface.md) 澄清现有 Cron facts 上的 management API、scope 和 UI。
- B19：使用 [`clarify-cron-result-session-navigation-policy`](clarify-cron-result-session-navigation-policy.md) 单独决定 occurrence 的 session/context/result navigation。
- 自然语言创建、从历史成功任务生成模板、pause/update/run-now 等能力只有在上述基础边界稳定且有独立用户价值时，分别创建 candidate change。

## 保留约束

- 模型不得无用户确认静默创建、修改或删除长期任务。
- 周期触发仍是普通 request/run，不创建 Cron-private terminal path。
- 不复制 raw prompt、raw tool result、credential、provider metadata、sandbox path 或未授权附件内容。
- 不建立第二套 scheduler、store、occurrence idempotency 或 runtime recurrence lifecycle。

## 并行边界

- candidate 状态不可认领或实施。
- 新候选必须基于 `add-ts-cron-tools` 做最小增量，并有单一主要 owner和独立验收结果。
