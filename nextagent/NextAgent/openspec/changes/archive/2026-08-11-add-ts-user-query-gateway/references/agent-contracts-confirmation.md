# agent-contracts 群内确认记录

- 确认日期：2026-08-08
- 确认结论：已群内确认并同意实施。
- 确认范围：
  - `agent-contracts/gateway` 新增 `UserQueryGateway`、请求/结果 runtime schemas 和 `GatewayAdapterKind='user-query'`；
  - 顶层 `GatewayBindings` 新增 optional `userQuery?: UserQueryGateway`，不新增单成员聚合 binding；
  - `agent-contracts/channel` 的共享知识 management view 新增 optional `ownerUserName`；
  - LOCAL 默认实现返回 `${subjectId}-name`，REMOTE transport 留给外部实现仓。

本记录只确认本 change proposal、specs 与 design 已定义的公共契约范围，不扩大实现范围。
