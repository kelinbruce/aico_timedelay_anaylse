## 背景和现状（Context）

`harden-ts-local-runtime-release` 不是一个"做更多测试"的 change，而是一个"定义 release 成立条件"的 change。

## 第一性原理（First Principle）

release hardening 的唯一职责，是把"是否可发布"收敛成一条最小且固定的资格判定链。

它负责 verdict，不负责子系统真相，也不扩展成发布治理平台。

## 黑盒目标（Blackbox Goal）

给定一个 candidate 与 release scope，系统通过固定标准命令获得权威检查结果并返回一个明确 release verdict。这个 verdict 必须是单一的、可追溯的，并且不能依赖隐含人工常识。

## 责任边界（Boundary）

- 负责：
  - 单一可执行 qualification CLI / application entrypoint
  - 固定检查命令调用、结果读取与归一化
  - release qualification flow
  - blocker / declared degradation / scope-excluded 的判定边界
  - 对 gate、health、smoke、baseline 的固定聚合顺序
  - 最小 verdict 输出结构
- 不负责：
  - health / readiness 业务语义
  - contract / architecture 之外各 gate 的测试内容
  - smoke 具体脚本形态
  - benchmark 具体方法学
  - observability / redaction / audit 内部逻辑

## 核心检测流程（Core Detection Flow）

业务主链只有一条：

1. `release:qualify` 入口校验 candidate 与 scope
2. 调用并聚合四类硬门槛标准命令；任一非 `PASSED` 则阻断后续阶段
3. 调用 release-package 标准命令，从实际 candidate 产生完整 `PackageCandidateEvidence` 与 `HealthProof`
4. 校验 package evidence、解引用 config evidence，并判定 startup / health；任一非 `PASSED` 则阻断后续阶段
5. 调用 product-journey 标准命令获得 release smoke 结果
6. 调用 capacity 标准命令获得 baseline 结果
7. 归一化结果并聚合 verdict

这是一条固定阶段、fail-closed 的资格判定链，而不是评分模型。`PackageCandidateEvidence` 只能来自实际 release-package 标准命令，不能由调用方预制。四类硬门槛属于同一聚合阶段，必须全部执行以形成完整门禁结论；该阶段失败后不构建或启动 candidate。

## 关键设计决定（Core Design Decisions）

### D1. Release verdict 只由最小检测流程产生

release verdict 只能由固定的最小检测流程产生。

### D2. 本 change 只消费上游真相，不定义子系统语义

package manifest/layout、app-config validation、health/readiness、gate、smoke evidence、baseline evidence 都由各自能力拥有；本 change 只消费完整且已校验的 `PackageCandidateEvidence` 与结果。配置证据的唯一链路是 `PackageCandidateEvidence.configValidationEvidenceRef` 指向实际 candidate startup 产生的 `ConfigValidationEvidence`；release input builder 解引用同一 evidence，qualification 不定义、接受或推断替代配置 evidence shape。

换句话说，本 change 是固定命令 orchestrator 与 verdict aggregator，不是各检查内部规则的 owner。它必须真正调用检查命令，而不是要求调用方预先拼好所有结果。上游 owner 负责维护自己的唯一标准命令与 machine-readable 结果；本 change 负责固定调用顺序、超时/异常归一化、缺失检查阻断与最终 verdict。

### D2a. 固定命令与唯一执行入口

`release:qualify` 只调用以下固定标准命令：

- `npm run test:contract`
- `npm run lint:architecture`
- `npm run test:gate:security`
- `npm run test:gate:resilience`
- `npm run test:e2e:release-package -- --candidate <candidate-root> --scope <scope-file>`
- `npm run test:e2e:product-journey -- --candidate <candidate-root> --scope <scope-file>`
- `npm run test:gate:capacity -- --candidate <candidate-root> --scope <scope-file>`

固定命令的最小接口是退出状态：退出码 `0` 归一化为 `PASSED`，非零退出码归一化为 `FAILED`，命令缺失为 `MISSING`，超时为 `TIMEOUT`。`release:qualify` 为每次执行创建隔离 report directory，并通过仅由 orchestrator 设置的 `NEXTAGENT_RELEASE_CHECK_DIR` 传给固定命令；命令可选写 `<checkId>.json` 补充 safe reason 与 evidence refs，报告缺失不改变由退出状态确定的结果。release-package 命令必须额外在同一目录按其既有权威 shape 写出 `PackageCandidateEvidence` 与 `HealthProof`；这两个必需输出缺失时 release 被阻断。不引入 generic payload、adapter API、registry 注入或 `outputRef`。CLI 用户不得覆盖 report directory。

唯一执行入口是仓库标准命令 `npm run release:qualify -- --candidate <candidate-root> --scope <scope-file>`，其 application entrypoint 位于 `agent-app/src/release/run-release-qualification.ts`。入口只接受 candidate 与 scope，不接受任意 shell command、预制 gate verdict 或跳过必需检查的参数。

命令清单固定且 fail closed。命令缺失、执行异常或超时时，统一归一化为对应检查的 `MISSING`、`FAILED` 或 `TIMEOUT`；可选报告非法时忽略其内容并保留更保守的安全原因，不能把失败提升为通过。release-package 必需权威输出缺失时返回 `MISSING`。四类硬门槛结果全部收集后再判定是否阻断后续阶段；其他阶段失败时停止执行更后阶段。

### D2b. 已存在检查直接接线，未实现检查登记 owner

- contract 与 architecture 直接调用其标准命令，不增加 release-only wrapper。
- `add-ts-security-test-gate` 交付唯一 `npm run test:gate:security`，内部纳入其低层检查与 `add-ts-e2e-security-gate` 权威结果。
- `add-ts-resilience-test-gate` 交付唯一 `npm run test:gate:resilience`，内部纳入其低层检查与 `add-ts-e2e-resilience-gate` 权威结果。
- `add-ts-capacity-benchmark-gate` 交付唯一 `npm run test:gate:capacity`。
- `add-ts-e2e-release-package-gate` 与 `add-ts-e2e-product-journey-gate` 分别维护唯一 release-package 与 product-journey 标准命令。
- 对应 change 尚未交付命令时，qualification 返回 `MISSING`；不得以假成功、no-op 或手工输入替代。

### D3. Smoke 只证明最小 in-scope 主链路

smoke qualification 只验证首版本地 release 的最小 in-scope serving path，不扩展成全面回归测试平台。

### D4. Capacity baseline 只做"存在且不明显不可用"的保守判定

首版 baseline 只证明 candidate 没有明显不可用，不绑定 SLA。

baseline 的采集方法、指标口径和报告格式由 capacity baseline owner 定义；本 change 只消费 baseline 是否存在，以及是否被上游标记为 timeout、missing 或 obviously unavailable。

### D5. 输出只保留最小 verdict 结构

qualification result 只保留：

- `candidateId`
- `qualificationStatus`
- `blockingReasons[]`
- `declaredDegradations[]`
- `evidenceRefs[]`
- `evaluatedAt`

### D6. Deep health 由 health/readiness owner 提供

Primary health / readiness 只证明基础运行面可响应。关键真实依赖（如本地 SQLite、模型 provider 连通性）是否可服务，由 health owner 提供权威 health result，再由 release/package E2E gate 通过 `@nextagent/agent-app/release` public subpath 的唯一 mapper 转换为 `HealthProof`。`HealthProof` 固定包含 `primaryStatus`、`deepStatus`、`criticalDependencyStatuses` 和 `evidenceRefs`；qualification 只消费该结构，不接受第二种健康证据 shape。health implementation package 不反向依赖 `agent-app`。

## KISS 审视（KISS Review）

1. 只定义一个问题：candidate 能不能发。
2. 只定义一条主链：六步检测。
3. 只输出一个 verdict 和最小证据。
4. 只消费上游权威结果，不重做子系统。
5. 只要求 baseline 存在且不明显不可用。

## 最小实现闭环（Minimum Viable Slice）

首版只要求形成以下闭环：

1. 能收集 candidate、scope、配置样例和启动入口
2. 能通过固定标准命令清单调用全部必需检查
3. contract 与 architecture 直接执行标准门禁命令
4. 未实现命令或缺失报告明确返回 `MISSING`，且 release 被阻断
5. 能归一化各命令的成功、失败、超时、异常和缺失结果
6. 能输出单一 verdict 与最小 evidence refs

所有必需上游阶段结果使用统一状态语义：`PASSED`、`FAILED`、`MISSING`、`TIMEOUT`、`UNAVAILABLE`。qualification 只允许必需阶段的 `PASSED` 继续推进；四类硬门槛全部执行并聚合后，任一非 `PASSED` 返回 `BLOCKED`，其他阶段出现非 `PASSED` 时停止执行更后阶段并返回 `BLOCKED`。release-package 标准命令产生的 `PackageCandidateEvidence` 必须证明 manifest、layout check、`configValidationEvidenceRef`、startup proof 和 health/readiness proof 完整且 candidate identity 一致。Release input builder MUST 在该命令完成后解引用 `configValidationEvidenceRef` 到实际 candidate 的唯一 `ConfigValidationEvidence`；`ConfigValidationEvidence.readinessState=BLOCKED` 必须立即返回 `BLOCKED`，`DEGRADED_READY` 只有在其 degradations 已被显式批准并进入 `declaredDegradations` 时才可继续。

qualification 的唯一输出类型为 `ReleaseQualificationResult`。不得再定义 `ReleaseVerdict`、等价诊断对象或第二套 qualification result shape。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | release qualification 只消费上游权威结果，不重做子系统检查；verdict 和 evidence refs 不包含 prompt、模型输出、raw provider error、credential 或高基数字段 | release qualification contract tests：verdict 字段安全断言 |
| 性能/容量 | qualification flow 采用固定阶段顺序；四类硬门槛完整聚合，失败后不启动更昂贵的 candidate/smoke/baseline 阶段；baseline 只做"存在且不明显不可用"的保守判定 | release qualification integration tests：qualification 耗时回归 |
| 可靠性/恢复 | qualification 只允许必需阶段的 `PASSED` 继续推进；硬门槛完整聚合后 fail closed，后续阶段失败即阻断；不允许无界重试或等待 | release qualification contract tests：状态转换和 blocking 路径 |
| 可维护性 | release qualification 只消费完整且已校验的 `PackageCandidateEvidence` 与上游权威结果，不重定义子系统真相；contract / architecture / security / resilience gate、health/readiness、smoke 和 capacity baseline 的内部检查规则由各自 owner 提供 | architecture lint：release qualification 不反向依赖子系统内部实现 |
| 可测试性 | 每个 qualification 阶段（input validation、gate、health proof、smoke、baseline、verdict）可通过 unit test 独立验证；状态语义固定为 `PASSED`、`FAILED`、`MISSING`、`TIMEOUT`、`UNAVAILABLE` | release qualification contract tests：阶段状态覆盖 |
| 审计/可追溯性 | `ReleaseQualificationResult` 携带 `candidateId`、`qualificationStatus`、`blockingReasons[]`、`declaredDegradations[]`、`evidenceRefs[]`、`evaluatedAt`，可追溯到 candidate 和上游证据 | release qualification contract tests：result 字段和追溯性断言 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| qualification flow 只消费上游权威结果 | release qualification contract tests | architecture lint：不反向依赖子系统内部 |
| qualification 真实调用固定标准命令 | release qualification integration tests | contract/architecture 命令执行测试与 missing-command/report 阻断测试 |
| 必需阶段 `PASSED` 才允许继续推进 | release qualification contract tests | qualification 状态转换断言 |
| 硬门槛完整聚合且阶段 fail closed | release qualification contract tests | 多硬门槛失败聚合与 blocking 路径覆盖 |
| smoke 只证明最小 in-scope 主链路 | release qualification integration tests | smoke scope 断言 |
| baseline 只做"存在且不明显不可用"判定 | release qualification contract tests | baseline 状态断言 |
| verdict 只通过唯一 `ReleaseQualificationResult` 输出 | release qualification contract tests | result shape 唯一性断言 |

## 文档承载决策（Documentation Ownership）

归档时需更新以下长期基线文档：

- `openspec/specs/local-runtime-release/spec.md`：新增 release qualification 行为契约
- `openspec/designs/architecture/release-qualification-flow.md`：补充 qualification flow 在发布链路中的位置
- `openspec/designs/contracts/package-candidate-evidence-spi.md`：补充 evidence 消费契约
- `openspec/designs/modules/agent-app.md`：补充 release qualification 与 app composition 的集成点
- `openspec/designs/spec-to-design-map.md`：新增 local-runtime-release spec 与设计文档映射

## 风险与取舍（Risks / Trade-offs）

- [风险] qualification flow 与子系统 gate runner、health checker、smoke runner 职责重叠 -> 本 change 只消费上游权威结果，不重做子系统检查；通过 architecture lint 和 contract test 守护边界
- [风险] baseline 判定过于保守，无法覆盖真实性能问题 -> 首版 baseline 只证明 candidate 没有明显不可用，不绑定 SLA；深度性能验证由后续独立 change 定义
- [风险] verdict 结构与上游 evidence 存在重复 -> verdict 只保留最小字段和 evidence refs，不复制上游证据详情；通过 contract test 断言字段最小化
- [取舍] 四类硬门槛全部执行会增加少量耗时 -> 换取完整、可操作的门禁诊断；硬门槛失败后不执行更昂贵的后续阶段

## 归档前更新基线（Baseline Promotion Plan）

行为契约：

- `openspec/specs/local-runtime-release/spec.md`：新增

设计视图：

- `openspec/designs/architecture/release-qualification-flow.md`
- `openspec/designs/contracts/package-candidate-evidence-spi.md`
- `openspec/designs/modules/agent-app.md`
- `openspec/designs/spec-to-design-map.md`

验证入口：

- release qualification contract tests
- release qualification integration tests
- smoke scope validation tests
- baseline status validation tests
