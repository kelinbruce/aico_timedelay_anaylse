# fix-ts-pending-input-timeout-lifecycle

规划入口：[NextAgent TypeScript 重构与功能增强 Roadmap v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Human Pending Input lifecycle reliability
OpenSpec：[fix-ts-pending-input-timeout-lifecycle](../../openspec/changes/fix-ts-pending-input-timeout-lifecycle/)

状态：active（implementation and verification complete，ready for archive review）
类型：runtime lifecycle defect fix
主要 owner：`agent-runtime`
协作模块：`agent-app`、`agent-platform-gateway-local`、`agent-session`、`agent-channel-web`、`frontend/agent-web`
认领人：已认领（当前会话）
依赖：[refine-ts-pending-input-timeout-contracts](./refine-ts-pending-input-timeout-contracts.md)、现有 pending resolve/canonical event/terminal commit、`add-ts-cross-session-activity-awareness`

目标：

- pending input 在 durable `timeoutAt` 到期后，无新 submit、无页面连接、无进程重启时仍由 runtime 自动推进。
- partial resolve/event/terminal failure 能从 durable facts 幂等恢复。
- timeout terminalization 不再进入可能重新创建 pending input 的 terminal lifecycle hook。
- 后台会话由既有 activity projection 从 `WAITING_FOR_INPUT` 收敛为 `UNREAD_FAILURE`。
- 用户切回超时会话后消费 canonical facts，看到普通 Composer。

唯一实现路径：

- `AgentRequestLifecycleService` 只维护一个 unref deadline timer与single-flight reconciliation，不执行固定周期polling。
- startup recovery扫描一次unresolved facts；durable pending创建成功后显式通知当前runtime更新最早deadline。
- 每个 reconciliation固定 cutoff，按100条keyset分页；单条失败不阻塞后续fact，只有failure path按有上限backoff重试。
- `PENDING` candidate走既有CAS；`TIMED_OUT` incomplete candidate继续幂等event与`FAILED/PENDING_INPUT_TIMEOUT` terminal commit。
- timeout专用terminal context跳过terminal lifecycle hook；session composite delete同步清理`pending_inputs`。
- `agent-app`只在recovery后、server listen前启动worker，并在gateway close前关闭runtime。

边界：

- frontend本地倒计时只显示，不清除pending、不发送answer/cancel、不拥有timeout。
- session activity只消费committed canonical facts，不监听deadline、不推进RequestRun。
- 不新增配置、分布式scheduler、Web API、stream vocabulary、数据表、observation、feed revision或per-pending timer。
- Agent Scope来自现有trusted composition；Owner Scope来自candidate record并逐条校验。

验收要点：

- 先用fake-clock测试复现“无外部流量不超时”。
- Runtime tests覆盖健康空闲零polling、deadline触发、create通知、single-flight、101+ fact、partial failure、terminal-hook skip、late answer和close。
- App lifecycle tests覆盖recovery → worker start → listen与runtime close → gateway close。
- Activity/frontend tests与两session浏览器旅程覆盖切走、自然到期、未读失败、切回和Composer恢复。
- backend/full contract/architecture、frontend build/test/modes、Playwright与strict OpenSpec全部通过。

并行边界：

- 不得在前置 contract refinement完成前修改 frozen gateway surface。
- runtime lifecycle主文件、app lifecycle composition与activity/frontend集成测试是冲突面；其他change如同时触达必须协调。
- activity change仍是唯一session activity owner；本 change只提供它需要消费的canonical timeout与terminal facts。
