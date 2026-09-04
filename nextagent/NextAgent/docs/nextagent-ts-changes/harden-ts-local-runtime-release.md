# harden-ts-local-runtime-release

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Release Hardening

状态：active
类型：发布门槛 change
主要 owner：`agent-app`
依赖：`add-ts-local-runtime-package`；各 gate、health、smoke 和 capacity owner change 负责交付对应标准命令与 machine-readable 报告

目标：
- 形成首个可运行、可验证、可交付的本地 TS 后端版本，覆盖启动命令、配置样例、测试门禁、health check 和 release scope。
- 实现单一 `npm run release:qualify` 入口，按固定标准命令清单执行检查、读取 machine-readable 结果并聚合最终 `ReleaseQualificationResult`。

门槛类型：发布闭环

能力组共享输入：

整理状态：已整理为能力组级输入

能力组目标：
- 形成首个可运行、可验证、可交付的本地 TS 后端版本。

共享规格输入：
- 首版硬门槛包括 contract、architecture、security、resilience gates。
- `agent-app` 只定义最小 `ReleaseCheckResult`、固定命令清单、command launcher 和 verdict aggregator；不定义 adapter API、动态 registry 或 `outputRef`。
- 固定命令以退出状态作为最小接口；`release:qualify` 创建隔离报告目录并通过 orchestrator-owned `NEXTAGENT_RELEASE_CHECK_DIR` 传给标准命令，命令可选写 `<checkId>.json` 补充安全诊断，CLI 不得覆盖目录。
- contract 与 architecture 直接调用标准命令 `npm run test:contract`、`npm run lint:architecture`。
- security、resilience、release-package、product-journey、capacity 标准命令或有效报告缺失时必须返回 `MISSING` 并阻断，禁止 no-op 成功或手工预制 passed result。
- qualification CLI 只接受 candidate 与 scope，不接受任意命令、跳过检查参数或预制 gate verdict。
- Contract gate 覆盖核心契约、channel event、capability descriptor、gateway store contract。
- Architecture gate 覆盖模块边界、依赖方向、跨层绕行和实现包泄漏。
- Security gate 覆盖 secret/redaction、sandbox deny-by-default、授权/高危确认和敏感日志泄露。
- Resilience gate 覆盖 cancel、retry、checkpoint recovery、runtime recovery idempotency guard、pending timeout、stream replay。
- Capacity benchmark 是基线门槛：首版必须可运行、有记录、有容量/性能基线，只阻断明显不可用场景，不绑定严格 SLA。
- Qualification 必须先完整执行四类硬门槛，再调用 release-package 标准命令从实际 candidate 产生完整且已校验的 `PackageCandidateEvidence`；调用方不得预制该 evidence，manifest、layout、configuration validation、startup 或 health/readiness evidence 缺失时直接阻断；release smoke 只由 product-journey 标准命令产生。
- 所有必需上游结果统一使用 `PASSED`、`FAILED`、`MISSING`、`TIMEOUT`、`UNAVAILABLE` 状态，只有 `PASSED` 可以继续推进。
- health owner 只通过统一 `HealthProof` 提供 primary、deep、critical dependency 状态；qualification 唯一输出为 `ReleaseQualificationResult`。
- 本地 release 必须以 localhost-only local auth 作为默认本地访问保护：默认 loopback-only，未认证不创建用户数据，登录票据有 TTL 且服务重启失效，remote/IAM 产品入口不得打包 local auth。

实现约束：
- `agent-app/src/release/run-release-qualification.ts` 拥有固定命令顺序、硬门槛完整聚合、timeout/异常/报告缺失归一化、阶段阻断和 verdict 聚合。
- 固定命令 adapter 的命令及参数由代码声明，运行时输入不得覆盖。
- 本 change 不实现 security、resilience、health、smoke、capacity 的内部检查逻辑，只调用各 owner 交付的唯一标准命令。

验收要点：
- 从单一 CLI 输入 candidate/scope 后，实际执行 contract 与 architecture 标准门禁。
- 任一必需 runner 缺失、失败、超时或返回错误 check id 时，最终结果为 `BLOCKED`。
- 所有 runner `PASSED` 时，聚合输出唯一 `ReleaseQualificationResult`。

并行边界：
- 本 change 拥有固定命令编排和 verdict aggregator。
- 各 gate change 拥有检查内部规则、唯一标准命令和 machine-readable 报告，不得实现第二套 release aggregator。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
