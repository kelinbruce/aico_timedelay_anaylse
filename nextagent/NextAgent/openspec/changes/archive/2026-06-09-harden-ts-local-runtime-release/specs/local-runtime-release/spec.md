## ADDED Requirements

### Requirement: Release qualification follows one minimal detection flow

系统 SHALL 使用一条最小且固定的核心检测流程来判定 candidate 是否具备本地 release 资格。核心检测流程 MUST 按以下顺序执行：

1. 校验 candidate identity 与 release scope statement；
2. 调用并聚合四类硬门槛标准命令：contract、architecture、security、resilience；
3. 四类硬门槛全部得到终态后，若任一失败、缺失、超时或不可用，返回 `BLOCKED` 且不构建或启动 candidate；
4. 调用 release-package 标准命令，从实际 candidate 产生完整且已校验的 `PackageCandidateEvidence` 与 `HealthProof`；
5. release input builder 校验 package evidence 与 candidate identity，解引用 `configValidationEvidenceRef` 并判定实际 candidate 的唯一 `ConfigValidationEvidence`；
6. 若 package/startup/health 非 `PASSED`、config readiness 为 `BLOCKED`、ref 无法解引用或 evidence 与 candidate 不一致，返回 `BLOCKED`；
7. 调用 product-journey 标准命令并判定最小 in-scope smoke 结果；
8. 若 smoke 无终态、超时、失败、依赖 out-of-scope 能力，返回 `BLOCKED`；
9. 调用 capacity 标准命令并判定 baseline 未显示明显不可用；
10. 若 baseline 缺失或显示明显不可用，返回 `BLOCKED`；
11. 若上述检查均通过，再根据 scope 中已批准的 declared degradation 聚合为 `QUALIFIED` 或 `QUALIFIED_WITH_DECLARED_DEGRADATIONS`。

本 qualification flow MUST 只消费上游 owner 产出的 gate、health/readiness、smoke 和 capacity baseline 结果或证据。它 MUST NOT 重新定义 contract、architecture、security、resilience、health、smoke 或 benchmark 的内部检查规则，也 MUST NOT 成为并列的 gate runner、health checker、smoke runner 或 benchmark runner。

Every required upstream stage result MUST use one of `PASSED`, `FAILED`, `MISSING`, `TIMEOUT`, or `UNAVAILABLE`. Only `PASSED` MAY advance the qualification flow. Any other required-stage status MUST return `BLOCKED` at that stage.

#### Scenario: Candidate passes the core detection flow
- **WHEN** candidate 依次通过输入校验、四类硬门槛、启动与最小健康证明、最小 smoke 和 baseline 检查
- **THEN** 系统返回 `QUALIFIED` 或 `QUALIFIED_WITH_DECLARED_DEGRADATIONS`

#### Scenario: Candidate is blocked after a failed detection stage
- **WHEN** candidate 在核心检测流程中的任一阶段出现 blocker
- **THEN** qualification flow 完成当前聚合阶段后停止继续推进
- **AND** 返回 `BLOCKED`

### Requirement: Release qualification exposes one executable entrypoint and invokes fixed check commands

系统 SHALL 提供单一可执行 release qualification 入口。该入口 MUST 接收 candidate root 与显式 release scope，调用固定检查命令清单，读取 machine-readable 结果，并将结果交给唯一 verdict 聚合流程。调用方 MUST NOT 被要求预先构造全部 gate result，也 MUST NOT 能通过参数注入任意检查命令、跳过必需检查或提供伪造的 passed result。

固定命令清单 MUST 包含：

- `npm run test:contract`
- `npm run lint:architecture`
- `npm run test:gate:security`
- `npm run test:gate:resilience`
- `npm run test:e2e:release-package`
- `npm run test:e2e:product-journey`
- `npm run test:gate:capacity`

The minimum command contract SHALL be the exit status: exit code `0` maps to `PASSED`, non-zero maps to `FAILED`, a missing command maps to `MISSING`, and timeout maps to `TIMEOUT`. `release:qualify` MUST create an isolated report directory and pass it through orchestrator-owned `NEXTAGENT_RELEASE_CHECK_DIR`. A command MAY write `<NEXTAGENT_RELEASE_CHECK_DIR>/<checkId>.json` to supplement safe reason and evidence refs; a missing optional report MUST NOT change the status derived from command execution. The release-package command MUST additionally write authoritative `PackageCandidateEvidence` and `HealthProof` using their existing shapes; missing required package or health output MUST block release. CLI input MUST NOT override the report directory. The system MUST NOT introduce generic payload, runner adapters, a dynamic registry, or `outputRef`.

命令缺失、异常或超时时 MUST fail closed，并归一化为对应检查的非 `PASSED` 结果。可选报告非法或 check id 不匹配时 MUST NOT 把失败提升为通过；release-package 必需输出缺失时 MUST return `MISSING`. `npm run test:gate:security` MUST 纳入低层与 E2E security 权威结果；`npm run test:gate:resilience` MUST 纳入低层与 E2E resilience 权威结果。

#### Scenario: Qualification invokes commands instead of accepting theoretical results
- **WHEN** operator 从单一 release qualification 入口提交 candidate 与 scope
- **THEN** 系统按固定阶段调用必需检查命令，并完整执行四类硬门槛命令
- **AND** 使用命令实际结果计算唯一 `ReleaseQualificationResult`

#### Scenario: Missing deferred command blocks release
- **WHEN** roadmap 中对应检查实现尚未交付，固定标准命令不可用或未产出有效报告
- **THEN** 该检查结果为 `MISSING`
- **AND** 最终 qualification result 为 `BLOCKED`

### Requirement: Existing contract and architecture gates are directly connected

Contract 与 architecture 检查 SHALL 直接接入标准门禁命令 `npm run test:contract` 与 `npm run lint:architecture`。qualification MUST 直接使用其退出状态，不要求已有命令为 release 改造报告输出，不得重新实现对应检查规则，也不得接受运行时输入覆盖固定命令。

#### Scenario: Existing gate command failure blocks release
- **WHEN** `npm run test:contract` 或 `npm run lint:architecture` 返回非零退出状态
- **THEN** 对应检查结果为 `FAILED`
- **AND** qualification result 为 `BLOCKED`

### Requirement: Release qualification is an explicit bounded flow, not an implicit conclusion

系统 SHALL 将本地 release 的成立视为一个显式 qualification flow，而不是“能启动就算可发布”的隐式推断。

#### Scenario: Normal user traffic does not trigger release qualification
- **WHEN** 普通用户提交请求、读取历史或访问 health 入口
- **THEN** 系统不会把这些动作解释为 release qualification

### Requirement: Qualification input and prerequisites are fixed and explicit

外部 qualification 入口 SHALL 只接收 candidate root 与显式 release scope。application orchestrator SHALL 通过固定标准命令和 release input builder 构造内部 resolved qualification input，至少包含：

- candidate identity
- 显式 release scope statement
- release-package 标准命令从实际 candidate 产生的完整且已校验 `PackageCandidateEvidence`，至少包含 package manifest、layout check result、`configValidationEvidenceRef`、startup proof 和 health/readiness proof
- 四类硬门槛标准命令的实际结果
- primary health / readiness diagnostics
- `HealthProof`，由 release/package E2E gate 通过 `@nextagent/agent-app/release` public subpath 的唯一 mapper 从 health owner 权威结果生成，固定包含 primary status、deep status、critical dependency statuses 和 evidence refs
- smoke qualification 结果
- capacity baseline 结果或其记录 ref

若任一命令未产生上述必需内部输入、package evidence 未通过 handoff validation，或 package evidence 中的 candidate identity 不一致，qualification flow MUST 直接返回 blocked。调用方 MUST NOT 提供或覆盖 `PackageCandidateEvidence`。

`configValidationEvidenceRef` MUST point to the exact `ConfigValidationEvidence` produced by the actual candidate startup. The release input builder MUST resolve that ref and qualification MUST consume that authoritative evidence without defining or accepting an alternative configuration evidence shape. `ConfigValidationEvidence.readinessState=BLOCKED` MUST return `BLOCKED`. `ConfigValidationEvidence.readinessState=DEGRADED_READY` MAY continue only when every relevant degradation is explicitly approved and included in `declaredDegradations`.

#### Scenario: Missing prerequisite input blocks qualification immediately
- **WHEN** package evidence、candidate identity、gate 结果、health 证明或 baseline ref 中任一必需输入缺失或不一致
- **THEN** qualification flow 不继续推进后续阶段
- **AND** 结果直接返回 blocked

#### Scenario: Blocked candidate configuration blocks qualification
- **WHEN** `configValidationEvidenceRef` resolves to actual candidate `ConfigValidationEvidence` with `readinessState=BLOCKED`
- **THEN** qualification result MUST be `BLOCKED`
- **AND** qualification MUST NOT replace or reinterpret the configuration evidence

### Requirement: Qualification produces a stable release result and diagnostic artifacts

每次 qualification MUST 产生唯一稳定的 `ReleaseQualificationResult`。该结果至少包含：

- `candidateId`
- `qualificationStatus`
- `blockingReasons[]`
- `declaredDegradations[]`
- `evidenceRefs[]`
- `evaluatedAt`

`qualificationStatus` 的稳定语义至少区分：

- `QUALIFIED`
- `QUALIFIED_WITH_DECLARED_DEGRADATIONS`
- `BLOCKED`

The implementation MUST NOT define or return a competing `ReleaseVerdict`, equivalent diagnostic result, or second qualification result shape.

#### Scenario: Qualification output keeps the same minimum result shape
- **WHEN** 任一次 qualification 完成并产生 verdict
- **THEN** 输出包含稳定的最小结果字段与状态枚举
- **AND** 下游消费者不需要依赖自由文本推断 verdict

### Requirement: Gate semantics are evaluated in a fixed order

release qualification SHALL 按确定顺序判定 gate，不把关键 release 逻辑留给实现自由发挥。

Gate 的具体测试内容和 pass/fail 事实 SHALL 由对应 gate owner 产生。Release qualification MUST 调用对应标准命令并消费其结果；四类硬门槛 MUST 全部得到终态并被聚合，任一结果 missing、failed、timeout 或 unavailable 时返回 blocked，且不得构建或启动 candidate。

#### Scenario: Multiple hard gate failures are aggregated
- **WHEN** contract 与 security 标准命令均返回非 `PASSED`
- **THEN** qualification result 为 blocked
- **AND** blocking reasons 与 evidence refs 同时包含两个 gate 的安全结果
- **AND** qualification 不构建或启动 candidate

#### Scenario: Security gate failure blocks release even if startup succeeds
- **WHEN** candidate 可以启动，但 security gate 失败
- **THEN** qualification result 为 blocked
- **AND** smoke 成功不能覆盖该失败

### Requirement: Candidate startup and health proof are mandatory release steps

通过硬门槛后，qualification flow SHALL 消费 release/package E2E gate 从实际 candidate 生成的有界 startup proof 与统一 `HealthProof`，而不是自行启动 candidate或只依赖静态构建结果。primary health / readiness 只证明基础运行面可响应；关键真实依赖是否可服务，必须由 `HealthProof.deepStatus` 和 `criticalDependencyStatuses` 证明。

Health / readiness 和 deep health 的内部判定 SHALL 由 health owner 产生。Release/package E2E gate SHALL use the single mapper exported by `@nextagent/agent-app/release` to convert the authoritative health result into `HealthProof`. Release qualification MUST only consume `HealthProof`; the health implementation package MUST NOT depend on `agent-app`, and no consumer MAY define an alternative health evidence shape.

#### Scenario: Readiness not-ready blocks release qualification
- **WHEN** candidate 已启动，但 readiness verdict 为 not-ready
- **THEN** qualification result 为 blocked

#### Scenario: Primary health alone is not enough to prove critical dependency serviceability
- **WHEN** candidate 的 `HealthProof.primaryStatus=PASSED`，但 `deepStatus` 或任一 critical dependency status 不是 `PASSED`
- **THEN** qualification flow 不把关键依赖视为已证明可服务
- **AND** qualification result 为 blocked

### Requirement: Smoke qualification validates the minimum in-scope serving path

release qualification SHALL 在 candidate 启动后执行 bounded smoke qualification，用于证明最小 in-scope 主链路真实可服务。

#### Scenario: Smoke success that depends on out-of-scope capability is invalid
- **WHEN** candidate 只有在调用 out-of-scope 能力时才能通过 smoke
- **THEN** smoke qualification 视为失败
- **AND** qualification result 为 blocked

### Requirement: Capacity baseline is recorded and interpreted conservatively

release qualification SHALL 要求 candidate 具备一份当前 release 的容量 / 性能 baseline 记录，但首版不把它定义为严格 SLA。

Capacity baseline 的采集方法、指标和报告格式 SHALL 由 capacity baseline owner 定义。Release qualification MUST only consume whether the baseline exists and whether the upstream result marks it as timeout、missing or obviously unavailable.

#### Scenario: Missing capacity baseline blocks release
- **WHEN** candidate 完成 smoke 但没有任何 capacity baseline 记录
- **THEN** qualification result 为 blocked

### Requirement: Release scope, degradation, and blockers are separated explicitly

qualification flow MUST 明确区分：

- `scope-excluded`
- `declared-degradation`
- `blocking-defect`

#### Scenario: Undeclared in-scope degradation blocks release
- **WHEN** smoke 或 health 阶段发现 scope 内能力只能以未声明的降级方式工作
- **THEN** qualification result 为 blocked

### Requirement: Release diagnostics are traceable, safe, and non-authoritative

release qualification 产生的 diagnostics、reports 和 refs MUST 保持可追溯但安全受控。它们只是 release 诊断证据，不是 request truth、checkpoint、memory record 或用户可见聊天历史的一部分。

#### Scenario: Release diagnostics point to evidence without becoming business truth
- **WHEN** qualification 输出 blocker 或 declared degradation 的诊断信息
- **THEN** 系统提供可追溯的 evidence refs 和安全摘要
- **AND** 这些诊断不会被当作请求真相或用户可见历史的一部分

### Requirement: Qualification failure and degradation handling are explicit and bounded

当 qualification flow 遇到 gate timeout、candidate 启动失败、health / readiness 超时、smoke 无终态、baseline 超时、依赖 unavailable、结果读取失败或诊断裁剪失败时，系统 MUST 显式返回 blocked 或更保守的安全诊断结果，而不是静默跳过该阶段。

#### Scenario: Smoke timeout becomes explicit blocked evidence
- **WHEN** smoke qualification 在限定时间内没有得到终态
- **THEN** qualification result 为 blocked
- **AND** 原因中显式记录 timeout
