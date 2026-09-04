# add-ts-e2e-resilience-gate

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Release Hardening / E2E Quality Gates

状态：active
类型：发布硬门槛 change
主要 owner：E2E/release quality owner，`agent-runtime`、`agent-channel-web`、gateway owner 协作
依赖：stream replay、local runtime recovery、runtime recovery idempotency guard 完成

目标：
- 使用真实断连、真实 process restart 和真实 persistence 验证 E2E-615-05、27、28。
- 产出既有 resilience hard gate 可消费的 E2E evidence。
- 产出供 `add-ts-resilience-test-gate` 的 release `RESILIENCE` 门禁族 adapter 聚合的权威 E2E 结果；本 change 不实现 release aggregator。

规格输入：
- 恢复后 sequence 不重复或回绕，每个 run 最多一个 terminal result，history 与 terminal result 一致。
- 非幂等 capability 在不确定恢复点不得重复执行。
- 故障注入只能存在于 test composition。

非目标：
- 不覆盖 PaaS 多实例恢复。
- 不复制普通 cancel/retry/edit 产品旅程。

验收要点：
- `npm run test:e2e:resilience`
- fault-control product leakage negative verification

并行边界：
- 不修改 recovery 状态机或 `agent-contracts`。
- 恢复行为缺口回到对应 owner change 修复。
