# add-ts-capacity-benchmark-gate

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Release Hardening

状态：ready
类型：发布门槛 change
主要 owner：`agent-runtime`、`agent-channel-web`、`agent-app`
依赖：首版必需 change 完成

目标：
- 建立首版容量/性能基线并记录结果；只阻断明显不可用场景，不绑定严格 SLA。
- 维护唯一标准命令 `npm run test:gate:capacity`，调用本 change 权威 baseline 检查并按 `NEXTAGENT_RELEASE_CHECK_DIR` 协议写出 machine-readable `ReleaseCheckResult`。

门槛类型：基线门槛

能力组共享输入：

整理状态：已整理为能力组级输入

能力组目标：
- 形成首个可运行、可验证、可交付的本地 TS 后端版本。

共享规格输入：
- 首版硬门槛包括 contract、architecture、security、resilience gates。
- Contract gate 覆盖核心契约、channel event、capability descriptor、gateway store contract。
- Architecture gate 覆盖模块边界、依赖方向、跨层绕行和实现包泄漏。
- Security gate 覆盖 secret/redaction、sandbox deny-by-default、授权/高危确认和敏感日志泄露。
- Resilience gate 覆盖 cancel、retry、checkpoint recovery、runtime recovery idempotency guard、pending timeout、stream replay。
- Capacity benchmark 是基线门槛：首版必须可运行、有记录、有容量/性能基线，只阻断明显不可用场景，不绑定严格 SLA。

后续维护：
- 标准命令或有效报告未交付前，release qualification 必须将该检查归一化为 `MISSING` 并阻断；不得由 harden change 内置替代 benchmark。
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
