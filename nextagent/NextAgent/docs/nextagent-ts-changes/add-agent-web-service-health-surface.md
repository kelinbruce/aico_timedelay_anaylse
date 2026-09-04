# add-agent-web-service-health-surface

规划入口：[UCD 能力差距交付里程碑](../roadmap/ucd-capability-delivery.md)
所属分组：UCD-P3

状态：clarify
类型：product + health-consumer contract candidate
主要 owner：待 health consumer policy 确认；候选 UI owner 为 `frontend/agent-web` application shell
认领人：不可认领
依赖：既有 `/health`、`/health/deep` 和 `system-health-check` 语义

当前状态：
- `/health` 是轻量 live check。
- `/health/deep` 在 timeout/budget/frequency 约束下执行真实 dependency probes，面向 operator/orchestrator 的语义和浏览器消费策略尚未冻结。
- frontend 当前没有全局 health UI。

目标：
- 在不篡改 request/run truth 的前提下，为最终用户提供安全、稳定且不会由单次网络抖动触发的全局服务状态提示。

进入 `ready` 前必须确认：
- 浏览器消费 `/health`、`/health/deep`，还是新增受控 safe projection；只能保留一个 canonical 输入。
- endpoint 的 auth/exposure policy，以及浏览器 polling 是否符合 deep probe frequency budget。
- polling interval、timeout、backoff、jitter、页面不可见和组件卸载规则。
- `AVAILABLE`、`DEGRADED`、`UNAVAILABLE` 的精确映射，以及连续失败/恢复的次数或时间 hysteresis。
- 哪一种 canonical 状态可以阻塞新 submit；历史、搜索和分享等只读能力如何独立降级。

实现约束：
- health UI 不改写 canonical request/run status，不把 stream reconnect 状态当 readiness。
- UI 只能展示 safe reason code、safe summary 和重试建议，不展示 endpoint、credential、内部路径或 raw exception。
- polling/view state 归 frontend；dependency probes 和 health truth 留在 backend owner。

非目标：
- 不实现运维监控台、依赖拓扑、指标图表、health persistence 或管理员控制面。
- 不替代 request-level degradation notice 和 stream reconnect UI。

转为 `ready` 后的验收出口：
- contract tests 固化唯一 endpoint 和状态映射。
- component/integration tests 覆盖三态、单次抖动、稳定恢复、probe timeout、页面隐藏/卸载和 submit gating。
- security tests 证明 raw diagnostic 不进入 DOM。

并行边界：
- clarify 状态不可实施。
- 不在 endpoint、polling 和 hysteresis 未确认前先做 frontend-only 状态条。
