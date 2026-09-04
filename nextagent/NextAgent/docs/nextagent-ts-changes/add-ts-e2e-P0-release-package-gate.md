# add-ts-e2e-release-package-gate

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Release Hardening / E2E Quality Gates

状态：active
类型：发布门槛 change
主要 owner：E2E/release quality owner，`agent-app`、packaging owner 协作
依赖：`add-ts-local-runtime-package`、`refine-ts-fullstack-packaging-boundary`、`add-ts-metrics-health`

目标：
- 从正式候选运行包验证 E2E-615-19、20、25、26。
- 产出 `harden-ts-local-runtime-release` 可消费的 package、startup 和 health evidence；release smoke 由 product-journey gate 独立拥有。
- 维护唯一标准命令 `npm run test:e2e:release-package`，按 `NEXTAGENT_RELEASE_CHECK_DIR` 协议写出 machine-readable `ReleaseCheckResult` 及权威 `PackageCandidateEvidence` / `HealthProof`；release smoke 不属于本 gate。

规格输入：
- 必须从 actual candidate root 和声明的启动入口执行。
- 不得使用 workspace private path、源码 fallback、目录探测或 dev server 替代候选产物。
- 非法配置、缺失产物、版本漂移、启动/health 失败和 route precedence 错误必须 fail closed。

非目标：
- 不重新实现 `pack()`、`qualify()`、health checker 或 fullstack hosting。
- 不自行产生 release qualification verdict。

验收要点：
- `npm run test:e2e:release-package`
- workspace fallback 和缺失产物 negative verification

并行边界：
- 不修改 package layout、health 语义或 `agent-contracts`。
- 产物行为缺口回到对应 owner change 修复。
- 本 change 不拥有 release runner registry、调用顺序或最终 verdict 聚合。
