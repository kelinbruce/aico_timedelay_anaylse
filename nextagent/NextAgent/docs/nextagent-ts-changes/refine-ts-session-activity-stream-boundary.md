# refine-ts-session-activity-stream-boundary

规划入口：[UCD 能力差距交付里程碑](../roadmap/ucd-capability-delivery.md)
所属分组：UCD-P1 串行前置
OpenSpec：[refine-ts-session-activity-stream-boundary](../../openspec/changes/refine-ts-session-activity-stream-boundary/)

状态：active（contract refinement 已完成，strict validation 与 semantic review 均 PASS）
类型：core contract refinement change
主要 owner：`agent-contracts/channel` Web stream contract boundary
协作模块：`agent-runtime`、`agent-channel-web`、`agent-session`
认领人：已认领（当前会话）
依赖：稳定 `ts-core-contracts`、`ts-web-sse-ws-transports`、`StreamEnvelope` 与 `RuntimeSessionPort.streamEvents(...)`

目标：

- 区分 Request Execution Stream 与 Session Activity Projection Stream，保持既有执行流契约不变。
- 为 `cross-session-activity-awareness` 授权唯一 scope-level derived projection stream例外。
- 禁止把该例外泛化成任意模块可新增的私有 Web stream机制。

规格输入：

- Request Execution Stream继续使用canonical timeline/runtime status、`StreamEnvelope`、`StreamEventType`、session-scoped sequence和`RuntimeSessionPort.streamEvents(...)`。
- Session Activity Projection Stream只投影Owner + Agent scope内当前会话活动，不属于canonical timeline，不使用execution replay或resume cursor，不驱动request lifecycle。
- SSE与WebSocket在同一明确流类型内保持等价；两类流的连接、payload、恢复和失败状态互相隔离。
- 非Request Execution Stream且非Session Activity Projection Stream的第三类用户可见SSE/WS必须先经过独立contract refinement。

契约输入：

- 修改stable `ts-core-contracts` requirement `Canonical Timeline And Stream Projection`的适用范围。
- 修改stable `ts-web-sse-ws-transports` requirement `等价 Web Stream Transport`的按流类型等价语义。
- 不修改`agent-contracts` TypeScript类型、`StreamEnvelope` wire shape或任何现有endpoint。

实现约束：

- 本change只冻结契约与架构边界，不实现Activity service、port、route、store或UI。
- `agent-runtime`继续只拥有Request Execution Stream的timeline、sequence、replay与lifecycle。
- Activity只允许复用SSE/WS framing、transport selection和cleanup primitive，不得复用execution payload、cursor、subscriber或store。
- 后续implementation change必须以architecture/contract negative tests证明Activity不进入`agent-contracts/channel`、`StreamEnvelope`、`RuntimeSessionPort.streamEvents(...)`或IR route。

非目标：

- 不建立通用stream registry、plugin或抽象框架。
- 不把Activity包装为execution event。
- 不改变request lifecycle、same-session lane、pending input或terminal commit。
- 不新增部署、配置、数据库或迁移。

验收要点：

- 两个MODIFIED requirements完整重述稳定requirement，并保留全部既有Request Execution Stream行为。
- 新增Activity SSE/WS等价、两类连接互不驱动和禁止第三类私有stream的normal/negative scenarios。
- `openspec validate refine-ts-session-activity-stream-boundary --strict`与`openspec validate --all --strict`通过。
- `$nextagent-skill-review`确认core contract、owner、current code与下游依赖一致，结论不得为BLOCKED。

并行边界：

- 本change必须先于`add-ts-cross-session-activity-awareness`任何port、route或controller实现完成确认。
- 它不修改实现文件，可与其他代码change并行；归档时需要协调`ts-backend-architecture.md`、`core-contracts.md`和`web-stream-transports.md`长期设计同步。
- `add-ts-cross-session-activity-awareness`仍是唯一Session Activity实现owner，不得在本change中提前实现其功能。
