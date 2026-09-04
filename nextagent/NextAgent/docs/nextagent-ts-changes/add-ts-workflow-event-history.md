# add-ts-workflow-event-history

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：P3 — Workflow 执行范式 / Workflow 生产硬化

状态：blocked
类型：实施 change（待重新设计）
主要 owner：待当前 change 归档后重新确认
依赖：`add-ts-workflow-execution-engine`、`add-ts-workflow-engine-contracts`、`persist-ts-refresh-stable-completed-turns`

阻塞原因：

- `persist-ts-refresh-stable-completed-turns` 正在成为用户可见 Workflow product process、Message/Event owner、live/history recovery 与模型上下文边界的唯一实施 change。
- 旧输入中的全量 `input`/`output`、node description、专用 query 和 inner Capability Result 路径会与当前 closed product contract、runtime canonical timeline 和安全边界冲突。
- 当前 change 归档前不得恢复本 change 的 proposal/design/tasks 实施；归档后必须基于新的 stable specs 重新拆分并通过语义审查。

后续候选目标：

- 仅评估审计/诊断级全节点 durable history、受控查询和保留策略，不重新拥有用户可见 Workflow product body。
- 继续复用 runtime canonical timeline，除非新的 OpenSpec design 证明需要独立 durable fact和Gateway owner。
- 明确审计数据与public stream/history、模型上下文、share/fork、raw diagnostics和telecom retention policy的隔离。

非目标：

- 用户可见 Workflow product process持久化或恢复
- Direct/Workflow-as-Tool inner projector
- inner `ASSISTANT_TOOL_USE`/`CAPABILITY_RESULT` Message或`CAPABILITY_RESULT_DELTA`
- terminal answer、terminal Hook continuation或模型上下文管理
- 在当前change归档前冻结`WorkflowEventRecordQuery`、input/output正文或Gateway schema

重新准入条件：

- `persist-ts-refresh-stable-completed-turns` 已归档并同步stable architecture/spec-to-design map。
- 审计/诊断需求、数据分类、retention、owner、public visibility和查询scope已经闭合。
- 新proposal不与canonical product Event、Message-first ordinary process或runtime timeline竞争真相。
