## 背景与问题（Why）

）

NextAgent TS 后端可靠性维度目前缺少 OpenSpec 规范性设计文档。现有测试用例（TC-R-001~019））覆盖 Recovery gate、Terminal CAS 幏Cancel 终态唯一性、Idempotency guard、CAS 失败降级路径等，但这些测试用例的行为契约、设计决策和验证映射尚未以 OpenSpec 格式系统性记录。

经过实际测试执行发现多个真实 API 差异：
- Cancel COMPLETED run 返回 409 + error.code=REQUEST_CANCEL_ALREADY_TERMINAL（非 spec 假设的 CONFLICT）
- Recovery 日志为 NO_REPLAY_LOG/NO_RECOVERY_LOG stub（未实际执行 recovery）
- baseRequestId/failedRequestId 变量引用 bug（undefined）
- Recovery 依赖真实进程 kill/restart（测试环境不支持）
- 30s 超时限制导致 recovery 测试无法完成

这些差异需要在设计文档中系统性标注，以便后续测试执行和用例修正参考。

## 变更范围（What Changes）

- 新增 ts-reliability-test-gate 的 OpenSpec 规范性设计文档
- 涉盖 Recovery gate、Terminal CAS、Cancel 终态唯一性、Idempotency guard、CAS 降败级路径的完整行为契约
- 标注真实 API 差异对测试执行的影响
- 不修改任何测试用例代码（仅新增设计文档）

## Capability 影响（Capabilities）

### 新增 Capability
- `reliability-test-behavior-contracts`: 可靠性维度测试行为契约，定义 Recovery gate 阻断新请求、Terminal CAS 写入唯一终态、Cancel 终态不可覆盖、Idempotency guard replay policy、CAS 失败降级路径的行为约束

### 修改的 Capability
无

## 影响范围（Impact）

- 新增设计文档: D:\SKILLS\NextAgent\03 E2ETestcase\ts-reliability-test-gate\ (4 个文件)
- 测试用例代码不受影响（D:\SKILLS\NextAgent\03 E2ETestcase\tests\add-ts-reliability-test-gate\ 保持原样）
- 真实 API 差异标注影响后续测试修正方向

- 测试经验库（TE-01, TE-07, TE-08）已验证状态更新

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- openspec/specs/reliability-test-behavior-contracts/spec.md：新增 Recovery gate、CAS 唯一终态、Idempotency guard 行为契约

长期背景：
- openspec/overview.md：无

设计视图：
- openspec/designs/architecture/testcase-architecture.md：更新执行架构和已知失败分类
- openspec/designs/modules/reliability-test-gate.md：新增可靠性测试 gate 模块设计（Recovery gate、CAS、Idempotency guard）
- openspec/designs/adr/003-cancel-terminal-cas.md：新增 ADR — Cancel 终态 CAS 决策（真实 API: REQUEST_CANCEL_ALREADY_TERMINAL vs CONFLICT）
- openspec/designs/spec-to-design-map.md：新增 reliability-test-behavior-contracts → design 导航

验证入口：
- vitest run TC-R-001-004.test.ts — 19 tests (Recovery gate + CAS)
- vitest run TC-R-005-011.test.ts — 6 tests (CAS 降级 + Cancel CAS)
- vitest run TC-R-015-019.test.ts — 15 tests (Idempotency + Recovery replay)
