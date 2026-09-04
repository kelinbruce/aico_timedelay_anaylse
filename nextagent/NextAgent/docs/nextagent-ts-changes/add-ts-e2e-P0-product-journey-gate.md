# add-ts-e2e-product-journey-gate

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Release Hardening / E2E Quality Gates

状态：active
类型：发布门槛 change
主要 owner：E2E/release quality owner，`agent-app` 协作
依赖：对应首版产品能力完成；`refine-ts-fullstack-packaging-boundary`

目标：
- 使用真实 local product process、真实浏览器和真实 HTTP/SSE/WebSocket 验证首版主用户旅程。
- 为 E2E-615-02、03、04、06、07、08、09、10、11、13、14、15、18、22、23、24 建立唯一主要维护归属。
- 维护唯一标准命令 `npm run test:e2e:product-journey`，按 `NEXTAGENT_RELEASE_CHECK_DIR` 协议写出 machine-readable release smoke `ReleaseCheckResult`。

规格输入：
- 必需 case 缺失、skipped、timeout 或 failed 时 gate 必须失败。
- mock HTTP/EventSource/WebSocket 或直接领域 service 调用不得替代目标真实边界。
- gate 必须产生安全、machine-readable evidence。

非目标：
- 不实现或重新定义产品行为。
- 不替代 contract、architecture、security 或 resilience 低层验证。

验收要点：
- `npm run test:e2e:product-journey`
- case inventory 唯一归属检查
- forbidden mock negative verification

并行边界：
- 不修改 `agent-contracts`。
- 产品行为缺口回到对应 owner change 修复。
- 本 change 不拥有 release runner registry、调用顺序或最终 verdict 聚合。
