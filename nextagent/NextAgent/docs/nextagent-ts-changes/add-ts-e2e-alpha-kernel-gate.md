# add-ts-e2e-alpha-kernel-gate

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Alpha / E2E Quality Gate

状态：active
类型：Alpha 回归 gate
主要 owner：E2E/release quality owner，`agent-app` 协作
依赖：`ship-ts-minimal-agent-kernel`（已 archive）

目标：
- 使用真实 Alpha 级 local product process、真实 HTTP/SSE 和真实 local persistence 验证 Alpha 最小问答内核的用户可观测行为。
- 为 e2e-alpha-01、02、03、04、05、06 建立唯一主要维护归属。
- 维护唯一标准命令 `npm run test:e2e:alpha`，产出 machine-readable `ReleaseCheckResult`。

规格输入：
- Alpha 级 product process fixture MUST 不包含 local auth、WebSocket、P0 工具注册和 P0 context assembly 增强。
- 必需 case 缺失、skipped、timeout 或 failed 时 gate 必须失败。
- mock HTTP/EventSource 或直接领域 service 调用不得替代目标真实边界。
- P0 能力（auth、WebSocket、cancel、retry、tool、attachment、title、feedback、context compression、packaging）不得出现在 Alpha E2E 用例中。
- gate 必须产生安全、machine-readable evidence。

非目标：
- 不实现或重新定义产品行为。
- 不替代 contract、architecture、security 或 resilience 低层验证。
- 不依赖 P0 能力。

验收要点：
- `npm run test:e2e:alpha`
- case inventory 唯一归属检查
- forbidden mock negative verification
- P0 leakage negative verification

并行边界：
- 不修改 `agent-contracts`。
- 产品行为缺口回到对应 owner change 修复。
- 本 change 不拥有 release runner registry、调用顺序或最终 verdict 聚合。
- 与 P0 `add-ts-e2e-product-journey-gate` 平行独立，共享 `tests/e2e/` 目录但使用不同 product composition fixture。
