# add-ts-human-handoff

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)

所属分组：Human Pending Input

状态：ready
类型：实施 change
主要 owner：`agent-runtime`、`agent-channel-web`
依赖：`refine-ts-pending-input-contracts`、`add-ts-human-pending-input-core`、`add-ts-human-pending-input-timeout`

目标：

- 支持系统将当前 run 转入人工接管 pending，并允许人工终结或恢复原 run。

规格输入：

- `HUMAN_HANDOFF` 是系统控制行为；本 change 不定义 producer 或触发规则，进入 pending 前必须通过 pending input core 已冻结的 producer boundary 提交 validated `HUMAN_HANDOFF` pending intent。
- 模型不能直接指定人工接管。
- 首版必须提供后端/客户端可用的 handoff pending 状态，并复用 pending input answer command boundary 提交人工处理结果。
- handoff 使用 pending input core 的生命周期；pending 期间原 run 和 same-session lane 仍由 runtime pending core 阻塞，直到 answer、cancel、timeout 或 terminal outcome。
- 首版不建立长期人工工单、独立队列或人工工作台。
- 人工处理结果首版同时支持 `final_answer` 和 `resume_instruction`。
- `final_answer` 直接作为本 run 的终态回答。
- `resume_instruction` 作为人工补充信息恢复原 run。
- handoff 回答仍使用 `PendingInputAnswer.answers`。
- runtime 按 `HUMAN_HANDOFF` 类型解释为 final answer 或 resume instruction。

契约输入：

- `PendingInputKind.HUMAN_HANDOFF`
- `PendingInputAnswer`
- request/run terminal result

实现约束：

- 不建设复杂人工工作台。
- 不释放 pending core 持有的 same-session lane；释放策略留给后续明确的 lane/scheduler change。
- timeout 行为不持久化为 request 字段，由 runtime 按 `HUMAN_HANDOFF` 已冻结的 no-synthesis timeout outcome 处理。
- 可审计投影只记录 handoff request safe ref、handler safe ref、result type、timestamp 和 reason code。
- 可审计投影不记录 raw sensitive content。

非目标：

- 不建设人工工作台。
- 不建立长期人工接管队列。
- 不改变 pending input core 的 lane blocking 语义。

验收要点：

- integration test 覆盖 final answer 终结 run。
- integration test 覆盖 resume instruction 恢复原 run。
- resilience test 覆盖 handoff pending timeout 和 cancel。

并行边界：

- 不修改 pending input core 三对象契约。
- 不把人工工作台能力填入本 change。
