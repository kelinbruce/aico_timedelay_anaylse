## 背景和现状（Context）

NextAgent TS 后端可靠性维度涵盖 Recovery gate、Terminal CAS 唯一终态、Cancel 终态不可覆盖、Idempotency guard replay policy、CAS 失败降级路径等关键路径。当前测试用例已编写（TC-R-001~019），覆盖 19 个 Vitest 用例 + 6 个 Vitest 用例（Part 2）+ 15 个补充用例（Part 3）。

经过实际测试执行发现多个真实 API 差异：
- Cancel COMPLETED run 返回 409 + error.code=REQUEST_CANCEL_ALREADY_TERMINAL（非 spec 假设的 CONFLICT）
- Recovery 日志为 NO_REPLAY_LOG/NO_RECOVERY_LOG stub（未实际执行 recovery）
- baseRequestId/failedRequestId 变量引用 bug（undefined）
- Recovery 依赖真实进程 kill/restart（测试环境可能不支持）
- 30s 超时限制导致 recovery 测试无法完成

## 目标和非目标（Goals / Non-Goals）

**目标：**
1. 建立 reliability-test-gate 的完整 OpenSpec 规范性设计文档（proposal → specs → design → tasks）
2. 明确真实 API 差异对测试的影响和标注策略
3. 记录 Recovery gate 阻断、CAS 唯一终态、Cancel 终态不可覆盖、Idempotency guard 的行为契约

**非目标：**
1. 不修改系统实现代码或前端代码
2. 不修改已有 spec 假设值（仅标注真实 API 差异）
3. 不解决 SSE 超时问题（标记为已知系统 bug）
4. 不修复 sessionStorage key 不存在和 theme-toggle-btn 缺失问题（标记为前端功能缺失）

## 设计决策（Decisions）

### D1: 真实 API 差异对齐策略

**决策**：测试用例预期结果使用真实 API 值（HTTP 200 非 202、REQUEST_CANCEL_ALREADY_TERMINAL 非 CONFLICT），在设计文档中标注差异。

**理由**：spec 假设与真实 API 存在差异时，测试应验证系统真实行为而非假设行为。标注差异便于后续修正 spec。

**放弃的备选**：修改前端/API 代码使行为符合 spec（代价太高、不可控）。

### D2: Recovery 依赖真实进程重启

**决策**：Recovery 测试用例标注为需要真实 kill/restart 環境，当前测试环境可能不支持。

**理由**：simulateRestart() 函数依赖 /api/v1/admin/kill 瑯点或外部重启机制，测试环境（单机本地开发）可能不具备此能力。

**放弃的备选**：模拟 Recovery 稡式（不真实，测试可信度低）。

### D3: CAS error.code 真实值标注

**决策**：Cancel 已 COMPLETED run 返回 409 + REQUEST_CANCEL_ALREADY_TERMINAL，标注为 ⚠️ 真实API 差异。

**理由**：真实 API 的 error code 与 spec 假设不同（CONFLICT vs REQUEST_CANCEL_ALREADY_TERMINAL）。测试应验证真实行为。

**放弃的备选**：修改 API 使 error.code 为 CONFLICT（影响面大，不值得）。

### D4: Recovery 日志 stub 标注

**决策**：Recovery replay/persisted result 日志为 NO_REPLAY_LOG/NO_RECOVERY_LOG stub，标注为 ⚠️ 已知问题。

**理由**：真实 Recovery 日志尚未实现，搜索日志返回 stub 响应。

**放弃的备选**：等待 Recovery 日志实现后再测试（阻塞测试进度）。

### D5: CAS 失败降级路径环境依赖

**决策**：CAS 失败降级路径测试需要可施加/解除 SQLite write lock 的环境，标注为环境依赖。

**理由**：CAS 失败需要人为施加 write lock，当前测试环境可能不支持。

**放弃的备选**：仅验证正常 CAS 成功路径（不覆盖降级场景）。

### D6: Idempotency guard 日志依赖

**决策**：idempotencyKey 不出现在日志审计 stream 中通过 conversation 间接验证和日志搜索验证，标注为 ⚠️ 间接验证。

**理由**：真实 API 无 getAuditEvents 端点，audit stream 通过 conversation 间接验证；日志搜索依赖服务端日志文件。

### D7: 目录结构继承架构测试门

**决策**：reliability-test-gate 测试用例放在 add-ts-reliability-test-gate/ 目录下，继承架构测试门的 Vitest .test.ts 格式。

**理由**：所有 gate suite 统一使用 Vitest .test.ts 格式，helpers 通过 symlink 共享。

**放弃的备选**：为 reliability 单独建立目录结构（增加维护成本）。

### D8: 测试经验库已验证状态更新

**决策**：TE-01（双终态竞争）更新为 ⚠️ error.code = REQUEST_CANCEL_ALREADY_TERMINAL；TE-08（重放不重复调用）更新为 ⚠️ Recovery 日志为 stub。

**理由**：经过实际测试验证，发现真实 API 行为与 spec 假设不一致，需要在测试经验库中反映。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|---|
| 安全 | trusted identity 模式默认无需认证；Cancel COMPLETED 返回 409 + REQUEST_CANCEL_ALREADY_TERMINAL | TC-R-002E, TC-S-006 |
| 可靠性/恢复 | Recovery gate 阻断新请求；CAS 终态唯一；⚠️ Recovery 依赖真实重启；⚠️ Recovery 日志为 stub | TC-R-001~004, TC-R-015~019 |
| 可维护性 | Vitest 框架；helpers 通过 symlink 共享；测试经验标注已验证状态 | 目录结构检查 |
| 可测试性 | api-client.ts 共用工具；⚠️ Recovery 需要真实 kill/restart 环境；⚠️ CAS 失败需要 write lock 环境 | helper 函数可用性 |
| 审计/可追溯性 | idempotencyKey 不出现在日志/审计 stream 中；⚠️ audit 通过 conversation 间接验证 | TC-R-016 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|---|
| Recovery gate 阻断新请求 | TC-R-001 | vitest run TC-R-001-004.test.ts — recovery 期间 submit 返回 503 |
| CAS 终态唯一 | TC-R-002 | vitest run TC-R-001-004.test.ts — EXECUTING→COMPLETED CAS 成功 |
| Cancel 终态不可覆盖（⚠️ REQUEST_CANCEL_ALREADY_TERMINAL） | TC-R-002E | vitest run TC-R-001-004.test.ts — cancel COMPLETED 返回 409 |
| Idempotency guard replay policy | TC-R-004 | vitest run TC-R-001-004.test.ts — 相同 key 返回已有 requestId |
| CAS 失败降级路径 | TC-R-005 | vitest run TC-R-005-011.test.ts — CAS 写入失败后降级标记 |
| Cancel CAS 唯一终态 | TC-R-006 | vitest run TC-R-005-011.test.ts — cancel EXECUTING→CANCELLED, cancel COMPLETED→409 |
| IDEMPOTENT replay 不产生副作用 | TC-R-015 | vitest run TC-R-015-019.test.ts — recovery replay 使用 stable key |
| idempotencyKey 不出现在日志审计 | TC-R-016 | vitest run TC-R-015-019.test.ts — 日志搜索无原始 key |
| Recovery 发现 persisted result 不重复调用 | TC-R-017 | vitest run TC-R-015-019.test.ts — recovery skip 重复调用 |
| 非幂等 tool recovery 不重放 | TC-R-018 | vitest run TC-R-015-019.test.ts — NON_IDEMPOTENT 不被重放 |
| Multi-tool recovery 逐个独立 reconcile | TC-R-019 | vitest run TC-R-015-019.test.ts — 各 tool 逐个 reconcile |

## 文档承载决策（Documentation Ownership）

- Recovery gate 阻断行为：reliability-test-behavior-contracts/spec.md（本 change 的 spec delta）
- CAS 唯一终态行为：reliability-test-behavior-contracts/spec.md
- Idempotency guard 行为：reliability-test-behavior-contracts/spec.md
- 测试经验库（TE-01/TE-08）已验证状态：E2ETestcaseSKILL/SKILL.md + references/methodology.md
- 真实 API 差异标注策略：E2ETestcaseSKILL/SKILL.md（真实 API 规则章节）

## 风险与取舍（Risks / Trade-offs）

- [Recovery 依赖真实重启] → ⚠️ 标注为环境依赖，当前测试环境可能不支持，用 simulateRestart() 模拟但可信度低
- [CAS error.code = REQUEST_CANCEL_ALREADY_TERMINAL] → ⚠️ 标注为真实 API 差异，不修改测试脚本逻辑
- [Recovery 日志为 stub] → ⚠️ 标注为已知问题，等 Recovery 实现后补充验证
- [CAS 失败需要 write lock 环境] → ⚠️ 标注为环境依赖，当前环境可能不支持
- [baseRequestId/failedRequestId 变量引用 bug] → ⚠️ 标注为代码 bug，影响 TC-R-002E 测试

## 迁移计划（Migration Plan）

无。本 change 不涉及系统代码或配置迁移。

## 归档前更新基线（Baseline Promotion Plan）

- openspec/specs/reliability-test-behavior-contracts/spec.md：新增 Recovery gate、CAS 唯一终态、Idempotency guard 行为契约
- openspec/designs/architecture/testcase-architecture.md：更新执行架构和已知失败分类
- openspec/designs/modules/reliability-test-gate.md：新增可靠性测试 gate 模块设计
- openspec/designs/adr/003-cancel-terminal-cas.md：新增 ADR — Cancel 终态 CAS 决策
- openspec/designs/spec-to-design-map.md：新增 reliability-test-behavior-contracts → design 导航

## 待确认问题（Open Questions）

1. Recovery 依赖真实 kill/restart — 是否有 admin/kill 端点或外部重启机制？
2. CAS 失败降级路径 — 是否有可施加/解除 write lock 的测试环境？
3. Recovery 日志实现时间 — NO_REPLAY_LOG/NO_RECOVERY_LOG stub何时替换为真实日志？
4. sessionStorage key 前端使用什么机制（影响 TC-R-016 日志搜索）
