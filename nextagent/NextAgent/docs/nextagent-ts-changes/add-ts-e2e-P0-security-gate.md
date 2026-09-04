# add-ts-e2e-security-gate

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Release Hardening / E2E Quality Gates

状态：active
类型：发布硬门槛 change
主要 owner：E2E/release quality owner，`agent-observability`、`agent-capability`、`agent-app` 协作
依赖：local auth、attachment、sandbox、provider safe mapping、redaction、audit 对应 change 完成

目标：
- 使用真实 process/network/filesystem/sink 验证 E2E-615-01、12、16、17、21。
- 产出既有 security hard gate 可消费的 E2E evidence。
- 产出供 `add-ts-security-test-gate` 的 release `SECURITY` 门禁族 adapter 聚合的权威 E2E 结果；本 change 不实现 release aggregator。

规格输入：
- 使用敏感 canary 扫描 response、stream、safe error、log、audit 和测试 report。
- 任一必需输出表面无法检查时 fail closed。
- evidence 只保留安全 reason、hash 和 opaque ref。

非目标：
- 不重新定义安全策略或产品行为。
- 不替代 `add-ts-security-test-gate` 拥有的低层 contract、negative 和 architecture 验证。

验收要点：
- `npm run test:e2e:security`
- canary leakage 和 sink-unavailable negative verification

并行边界：
- 不修改 `agent-contracts`。
- 安全行为缺口回到对应 owner change 修复。
