## 1. Spec

- [x] 1.1 补强 `local-runtime-release` spec，明确本 change 的唯一职责是对 candidate 给出 release qualification verdict。
  来源：proposal 影响范围
- [x] 1.2 冻结最小核心检测流程：candidate/scope 校验 -> 四类硬门槛标准命令完整执行与聚合 -> release-package 命令与 package/config/startup/health 判定 -> product-journey 命令 -> capacity 命令 -> verdict 聚合。
  来源：spec requirement "Release qualification follows one minimal detection flow"
- [x] 1.3 明确 `scope-excluded`、`declared-degradation`、`blocking-defect` 三类结论边界。
  来源：spec requirement "Release scope, degradation, and blockers are separated explicitly"
- [x] 1.4 收敛唯一 `ReleaseQualificationResult` 输出结构为最小必要集合：`candidateId`、`qualificationStatus`、`blockingReasons[]`、`declaredDegradations[]`、`evidenceRefs[]`、`evaluatedAt`；禁止 `ReleaseVerdict` 或等价第二结果 shape。
  来源：spec requirement "Qualification produces a stable release result and diagnostic artifacts"
- [x] 1.5 明确本 change 只消费上游权威结果，而不重定义其内部语义。
  来源：spec requirement "Release qualification follows one minimal detection flow"
- [x] 1.6 明确本 change 不是 gate runner、health checker、smoke runner 或 benchmark runner；缺失、失败或超时的上游结果按固定顺序返回 `BLOCKED`。
  来源：spec requirement "Gate semantics are evaluated in a fixed order"
- [x] 1.7 明确所有必需上游结果统一使用 `PASSED`、`FAILED`、`MISSING`、`TIMEOUT`、`UNAVAILABLE` 状态；仅 `PASSED` 可推进。
  来源：spec requirement "Qualification failure and degradation handling are explicit and bounded"
- [x] 1.8 冻结单一可执行 qualification 入口、固定检查命令清单、最小 `ReleaseCheckResult` 语义，以及缺失命令/报告 fail-closed 行为。
  来源：spec requirement "Release qualification exposes one executable entrypoint and invokes fixed check commands"
- [x] 1.9 明确 contract 与 architecture 必须直接接入标准命令 `npm run test:contract`、`npm run lint:architecture`。
  来源：spec requirement "Existing contract and architecture gates are directly connected"

## 2. Design

- [x] 2.1 写清 release qualification 的第一性原理：回答”当前 candidate 是否达到最低发布资格”。
  来源：design 第一性原理
- [x] 2.2 写清为什么 release qualification 必须是显式 candidate-based flow。
  来源：design 黑盒目标
- [x] 2.3 写清四类硬门槛的职责分工。
  来源：design 核心检测流程
- [x] 2.4 写清 candidate 启动与最小 health proof 由 release/package E2E gate 从实际 candidate 生成，本 change 只消费其结果。
  来源：design 核心检测流程；spec requirement “Candidate startup and health proof are mandatory release steps”
- [x] 2.5 写清 smoke 只证明最小 in-scope 主链路。
  来源：design D3
- [x] 2.6 写清 capacity baseline 只要求”有记录且不明显不可用”。
  来源：design D4
- [x] 2.7 写清 release diagnostics 只是 evidence refs 和安全诊断。
  来源：design D5；spec requirement “Release diagnostics are traceable, safe, and non-authoritative”
- [x] 2.8 写清 declared degradation 与 blocker 的判定边界。
  来源：spec requirement “Release scope, degradation, and blockers are separated explicitly”
- [x] 2.9 写清 gate、health/readiness、smoke、baseline 的内部规则由对应 owner 定义，本 change 只消费结果字段和 evidence refs。
  来源：design D2
- [x] 2.9a 固定唯一 `HealthProof`：release/package E2E gate 通过 `@nextagent/agent-app/release` public subpath 的 mapper 将 health owner 权威结果映射为 `primaryStatus`、`deepStatus`、`criticalDependencyStatuses`、`evidenceRefs`；qualification 不接受第二种健康证据 shape，health implementation package 不依赖 `agent-app`。
  来源：design D6；spec requirement "Candidate startup and health proof are mandatory release steps"
- [x] 2.10 写清完整且已校验的 `PackageCandidateEvidence` 只能由 release-package 标准命令从实际 candidate 产生；`configValidationEvidenceRef` 必须指向实际 candidate startup 的唯一 `ConfigValidationEvidence`，candidate identity 不一致、mandatory evidence 缺失、ref 无法解引用或 config readiness 为 `BLOCKED` 时立即 `BLOCKED`。
  来源：spec requirement "Qualification input and prerequisites are fixed and explicit"
- [x] 2.11 写清固定命令清单、调用顺序、退出码到 status 的最小映射、orchestrator-owned `NEXTAGENT_RELEASE_CHECK_DIR`、可选 `<checkId>.json` 补充报告、release-package 必需输出、超时/异常归一化，以及禁止任意命令或报告目录注入。
  来源：spec requirement "Release qualification exposes one executable entrypoint and invokes fixed check commands"

## 3. Validation

- [x] 3.1 覆盖正常路径：所有硬门槛通过、candidate 成功启动、health 正常、smoke 成功、baseline 合格，最终返回 `QUALIFIED`。
  来源：spec requirement scenario "Candidate passes the core detection flow"
- [x] 3.2 覆盖边界路径：所有硬门槛通过，但存在已批准 degradation，最终返回 `QUALIFIED_WITH_DECLARED_DEGRADATIONS`。
  来源：spec requirement "Release scope, degradation, and blockers are separated explicitly"
- [x] 3.3 覆盖前置缺失路径：必需输入或任一 gate 结果缺失时直接 `BLOCKED`。
  来源：spec requirement scenario "Missing prerequisite input blocks qualification immediately"
- [x] 3.4 覆盖 gate 聚合与阻断路径：四类硬门槛全部执行并聚合；任一非 `PASSED` 时最终 `BLOCKED`，blocking reasons/evidence refs 包含全部失败门槛，且后续阶段不执行。
  来源：spec requirement scenario "Candidate is blocked after a failed detection stage"
- [x] 3.5 覆盖启动 / 健康阻断路径：candidate 启动失败、readiness not-ready、关键依赖 unavailable 或 health proof 超时，最终 `BLOCKED`。
  来源：spec requirement scenario "Readiness not-ready blocks release qualification"
- [x] 3.5a 覆盖配置 evidence 路径：`configValidationEvidenceRef` 缺失、关联错误、无法解引用、引用替代 shape 或实际 `ConfigValidationEvidence.readinessState=BLOCKED` 时最终 `BLOCKED`；`DEGRADED_READY` 只有全部 degradation 已批准时可继续。
  来源：spec requirement scenario "Blocked candidate configuration blocks qualification"
- [x] 3.6 覆盖 smoke 阻断路径：最小 in-scope 请求无终态、超时、失败或依赖 out-of-scope 能力，最终 `BLOCKED`。
  来源：spec requirement scenario "Smoke success that depends on out-of-scope capability is invalid"
- [x] 3.7 覆盖 baseline 阻断路径：capacity baseline 缺失、超时或显示明显不可用，最终 `BLOCKED`。
  来源：spec requirement scenario "Missing capacity baseline blocks release"
- [x] 3.8 覆盖诊断降级路径：diagnostic sanitization 失败时输出更保守的 safe reason，而不是泄露原始细节。
  来源：spec requirement "Release diagnostics are traceable, safe, and non-authoritative"
- [x] 3.9 覆盖真实入口路径：入口调用固定命令清单，并使用命令实际结果计算 verdict；缺失命令/报告、错误 check id、异常和 timeout 均 fail closed。
  来源：spec requirement "Release qualification exposes one executable entrypoint and invokes fixed check commands"
- [x] 3.10 覆盖门禁接线路径：contract/architecture 分别执行固定标准命令，非零退出状态归一化为 `FAILED`；禁止覆盖命令文本。
  来源：spec requirement "Existing contract and architecture gates are directly connected"


## 4. Implementation

- [x] 4.1 在 `agent-app/src/release/` 定义 `ReleaseCheckId`、最小 `ReleaseCheckResult`、固定命令描述、`QualificationStatus`、`HealthProof` 和 `ReleaseQualificationResult`；`ReleaseCheckResult` 只允许 `checkId`、status、safe reason 和 evidence refs，禁止 generic payload、adapter API、动态 registry 和 `outputRef`。复用 `@nextagent/agent-app/packaging` 的 `PackageCandidateEvidence`，不修改 `agent-contracts`。
  验证：`npm run build`。
  来源：spec requirement "Release qualification exposes one executable entrypoint and invokes fixed check commands"；design D2a

- [x] 4.1a 实现固定 command launcher：创建隔离 report directory，通过 orchestrator-owned `NEXTAGENT_RELEASE_CHECK_DIR` 调用固定标准命令；将退出码 `0` / 非零、命令缺失和 timeout 分别归一化为 `PASSED` / `FAILED` / `MISSING` / `TIMEOUT`，并可选读取 `<checkId>.json` 补充安全原因与 evidence refs；命令、参数和报告目录不得由 CLI 输入覆盖。
  验证：integration tests 证明现有 contract/architecture 命令无需报告即可接入，非零退出状态为 `FAILED`、timeout 为 `TIMEOUT`、命令缺失为 `MISSING`、非法可选报告不能把失败提升为通过、输入不能注入命令或报告目录。
  来源：spec requirement "Existing contract and architecture gates are directly connected"

- [x] 4.1b 固定七个必需标准命令及 check id；对应 owner change 未交付命令或有效报告时返回 `MISSING`，不得 no-op 成功。
  验证：command inventory contract tests 断言完整必需命令集与 missing-command fail-closed。
  来源：spec requirement "Release qualification exposes one executable entrypoint and invokes fixed check commands"

- [x] 4.2 在 `agent-app/src/release/` 实现 release input builder：读取 release-package 标准命令按权威既有 shape 产出的 `PackageCandidateEvidence` / `HealthProof`，再校验 `configValidationEvidenceRef` 与 candidate 关联并解引用为实际 candidate 的唯一 `ConfigValidationEvidence`；调用方、package/E2E/qualification 不自行提供、解引用或复制该 evidence。
  验证：input builder tests 覆盖 package/health 报告缺失、关联错误和替代输出，以及 config evidence ref 缺失、关联错误和无法解引用。
  来源：spec requirement "Qualification input and prerequisites are fixed and explicit"

- [x] 4.3 在 `agent-app/src/release/` 实现 `qualify(candidateId, resolvedInput)` 纯函数：只消费 release input builder 已解析的权威 package/config/health 输出与标准命令实际结果，按固定阶段执行四类硬门槛聚合 → package/config/startup/health → smoke → baseline → verdict 聚合。四类硬门槛的全部非 `PASSED` 结果共同进入 blocking reasons/evidence refs；其他阶段非 `PASSED` 时阻断更后阶段；全部通过返回 `QUALIFIED`；`DEGRADED_READY` 且全部 degradation 已批准时返回 `QUALIFIED_WITH_DECLARED_DEGRADATIONS`。
  验证：unit test 覆盖 3.1–3.8 及 3.5a 的全部 scenario。
  来源：spec requirement "Release qualification follows one minimal detection flow"；design 核心检测流程

- [x] 4.3.1 确保 `qualify(candidateId, resolvedInput)` 只消费已校验 package evidence、已解析权威 `ConfigValidationEvidence` 和标准命令结果对象及 evidence refs，不在该模块中执行命令、解引用 config evidence、启动 candidate 或执行检查规则。
  验证：unit test 使用伪造的标准命令结果对象驱动 verdict。
  来源：spec requirement "Gate semantics are evaluated in a fixed order"；design D2

- [x] 4.3.2 在 `agent-app/src/release/run-release-qualification.ts` 实现 application orchestrator：校验 candidate/scope，先完整执行四类硬门槛命令，再执行 release-package、product-journey 和 capacity 命令，读取报告、归一化结果并调用 `qualify(...)`；阶段失败后不执行更后阶段。
  验证：integration tests 覆盖真实命令调用顺序、多硬门槛失败聚合、阶段阻断、missing/failed/timeout 和最终 verdict。
  来源：spec requirement "Release qualification exposes one executable entrypoint and invokes fixed check commands"

- [x] 4.3.3 提供仓库标准可执行命令 `npm run release:qualify -- --candidate <candidate-root> --scope <scope-file>`，只允许 candidate/scope 输入并输出安全的 `ReleaseQualificationResult`；不得接受任意 command、跳过必需检查或预制 gate result。
  验证：CLI black-box tests 覆盖 qualified、blocked、非法参数和命令注入拒绝。
  来源：spec requirement "Release qualification exposes one executable entrypoint and invokes fixed check commands"

- [x] 4.4 收尾验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`npm run release:qualify -- --candidate <fixture-candidate> --scope <fixture-scope>`、`openspec validate harden-ts-local-runtime-release --strict`。
  来源：AGENTS.md 验证门禁
