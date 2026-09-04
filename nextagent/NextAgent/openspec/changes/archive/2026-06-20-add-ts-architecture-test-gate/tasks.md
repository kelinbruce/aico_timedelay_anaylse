## 实施任务

> 按依赖顺序排列，每个 task 对应一个可独立验收的交付结果。
> 本次对账按 source review checkpoint 更新状态：已勾选项以 `tests/TESTClaw/tests/suites/add-ts-architecture-test-gate/`、`tests/TESTClaw/tests/playwright.config.ts`、`tests/TESTClaw/tests/helpers/`、`tests/TESTClaw/tests/fixtures/` 与 `tests/TESTClaw/README.md` 的静态证据为准。实现实际以 TC 粒度 Playwright 文件落地，而非任务文案中的聚合 suite 文件名；执行类门禁与缺少直接静态证据的 helper 项继续保留未勾选。

### Phase 1: 基础设施准备

- [x] **T01**: 创建 E2E 测试目录结构（business-flow/spec-shall/concurrency/non-functional/ui-interaction）
  - 对账依据：source review 确认 5 个测试目录已存在，文件计数分别为 53、148、9、15、16
  - 来源：design.md 测试组织结构

- [x] **T02**: 配置 Playwright 测试环境（更新 playwright.config.ts 支持 5 个新目录）
  - 对账依据：source review 确认 `tests/TESTClaw/tests/playwright.config.ts` 已指向 `tests/suites` 并排除 backend/vitest 测试
  - 来源：design.md 测试框架选择

- [x] **T03**: 实现确定性模型 SSE mock helper（通用 fixture）
  - 对账依据：source review 确认 `tests/TESTClaw/tests/helpers/sse.ts` 已落地
  - 来源：design.md 确定性模型 Mock

- [x] **T04**: 实现进程重启测试 helper（spawn/kill/restart）
  - 对账依据：source review 确认 `tests/TESTClaw/tests/helpers/process-manager.ts` 已落地
  - 来源：design.md 进程重启测试实现

- [x] **T05**: 实现 canary 注入和检测 helper（安全测试专用）
  - 对账依据：source review 确认 `tests/TESTClaw/tests/helpers/canary.ts` 已落地，并已被 `TC-SEC-02`、`TC-SEC-03`、`TC-SPC-SEG-01` 引用
  - 来源：design.md 安全质量属性

### Phase 2: 业务流测试用例实现（62个 TC）

- [x] **T06**: 实现 submit-request.spec.ts（TC-SUB-01~07, 7个用例）
  - 对账依据：source review 确认 `business-flow/` 目录中的 `TC-SUB-*` 用例文件已落地
  - 来源：TP-SUB-01~07 → MK-R01, MK-R08, WS-R01, WCI-R01, LOC-R06, CC-R02

- [x] **T07**: 实现 session-create.spec.ts（TC-SCN-01~03, 3个用例）
  - 对账依据：source review 确认 `business-flow/` 目录中的 `TC-SCN-*` 用例文件已落地
  - 来源：TP-SCN-01~03 → MK-R01, AEG-R06, SCN-R01

- [x] **T08**: 实现 agent-assembly.spec.ts（TC-AAR-01~02, 2个用例）
  - 对账依据：source review 确认 `business-flow/` 目录中的 `TC-AAR-*` 用例文件已落地
  - 来源：TP-AAR-01~02 → MK-R02, APA-R05, APA-R07

- [x] **T09**: 实现 context-model.spec.ts（TC-CAM-01~07, 7个用例）
  - 对账依据：source review 确认 `business-flow/` 目录中的 `TC-CAM-*` 用例文件已落地
  - 来源：TP-CAM-01~07 → CTE-R01, CTE-R11, CTE-R08, CTE-R18, MIC-R10, MSN-R01, MIC-R09

- [x] **T10**: 实现 capability-invocation.spec.ts（TC-CIV-01~12, 12个用例）
  - 对账依据：source review 确认 `business-flow/` 目录中的 `TC-CIV-*` 用例文件已落地
  - 来源：TP-CIV-01~12 → BT-R01, BT-R03, BTF-R07, WT-R01, WT-R05, GT-R01, PT-R01, PT-R04, ST-R01, CAT-R08, APTS-R01, IA-R02

- [x] **T11**: 实现 timeline-stream.spec.ts（TC-TSP-01~06, 6个用例）
  - 对账依据：source review 确认 `business-flow/` 目录中的 `TC-TSP-*` 用例文件已落地
  - 来源：TP-TSP-01~06 → WS-R01, RSV-R01, RP-R04, SR-R01, SHC-R02, SR-R02

- [x] **T12**: 实现 terminal-commit.spec.ts（TC-TCM-01~05, 5个用例）
  - 对账依据：source review 确认 `business-flow/` 目录中的 `TC-TCM-*` 用例文件已落地
  - 来源：TP-TCM-01~05 → MK-R11, CC-R03, LRTS-R03, SES-R07

- [x] **T13**: 实现 history-read.spec.ts（TC-HRD-01~03, 3个用例）
  - 对账依据：source review 确认 `business-flow/` 目录中的 `TC-HRD-*` 用例文件已落地
  - 来源：TP-HRD-01~03 → MK-R08, SHC-R01, CC-R02, LCR-R04

- [x] **T14**: 实现 session-list.spec.ts（TC-SLT-01~02, 2个用例）
  - 对账依据：source review 确认 `business-flow/` 目录中的 `TC-SLT-*` 用例文件已落地
  - 来源：TP-SLT-01~02 → MK-R01, CC-R02

- [x] **T15**: 实现 checkpoint-save.spec.ts（TC-CPS-01~02, 2个用例）
  - 对账依据：source review 确认 `business-flow/` 目录中的 `TC-CPS-*` 用例文件已落地
  - 来源：TP-CPS-01~02 → CC-R06, MK-R12, CAC-R05

- [x] **T16**: 实现 hook-invocation.spec.ts（TC-HIV-01~03, 3个用例）
  - 对账依据：source review 确认 `business-flow/` 目录中的 `TC-HIV-*` 用例文件已落地
  - 来源：TP-HIV-01~03 → MK-R12, CC-R07

- [x] **T17**: 实现 pending-input.spec.ts（TC-PIN-01~04, 4个用例）
  - 对账依据：source review 确认 `business-flow/` 目录中的 `TC-PIN-*` 用例文件已落地
  - 来源：TP-PIN-01~04 → RSV-R06, CC-R07

- [x] **T18**: 实现 owner-scope.spec.ts（TC-OSP-01~02, 2个用例）
  - 对账依据：source review 确认 `business-flow/` 目录中的 `TC-OSP-*` 用例文件已落地
  - 来源：TP-OSP-01~02 → CC-R02, BA-R11, LOC-R07

- [x] **T19**: 实现 attachment-validation.spec.ts（TC-ATV-01~02, 2个用例）
  - 对账依据：source review 确认 `business-flow/` 目录中的 `TC-ATV-*` 用例文件已落地
  - 来源：TP-ATV-01~02 → BA-R12, RR-R04

- [x] **T20**: 实现 context-compression.spec.ts（TC-CCO-01~02, 2个用例）
  - 对账依据：source review 确认 `business-flow/` 目录中的 `TC-CCO-*` 用例文件已落地
  - 来源：TP-CCO-01~02 → CTE-R18, CTE-R19, CTE-R16

### Phase 3: Spec SHALL 测试用例实现（148个 TC）

- [x] **T21**: 实现 backend-architecture.spec.ts（TC-SPC-BA-01~03, 3个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-BA-*` 用例文件已落地
  - 来源：TP-SPC-BA-01~03 → BA-R27, BA-R28, BA-R03

- [x] **T22**: 实现 core-contracts.spec.ts（TC-SPC-CC-01~03, 3个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-CC-*` 用例文件已落地
  - 来源：TP-SPC-CC-01~03 → CC-R02, CC-R04, CC-R03

- [x] **T23**: 实现 minimal-agent-kernel.spec.ts（TC-SPC-MK-01~03, 3个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-MK-*` 用例文件已落地
  - 来源：TP-SPC-MK-01~03 → MK-R01, MK-R02, MK-R11

- [x] **T24**: 实现 agent-package-assembly.spec.ts（TC-SPC-APA-01~03, 3个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-APA-*` 用例文件已落地
  - 来源：TP-SPC-APA-01~03 → APA-R01, APA-R05, APA-R06

- [x] **T25**: 实现 app-config-schema.spec.ts（TC-SPC-ACS-01~04, 4个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-ACS-*` 用例文件已落地
  - 来源：TP-SPC-ACS-01~04 → ACS-R01, ACS-R09, ACS-R11, ACS-R05

- [x] **T26**: 实现 context-engine.spec.ts（TC-SPC-CTE-01~04, 4个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-CTE-*` 用例文件已落地
  - 来源：TP-SPC-CTE-01~04 → CTE-R01, CTE-R02, CTE-R08, CTE-R09, CTE-R25, CTE-R06

- [x] **T27**: 实现 context-assembly-contracts.spec.ts（TC-SPC-CAC-01, 1个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-CAC-*` 用例文件已落地
  - 来源：TP-SPC-CAC-01 → CAC-R05

- [x] **T28**: 实现 local-configured-auth.spec.ts（TC-SPC-LOC-01~06, 6个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-LOC-*` 用例文件已落地
  - 来源：TP-SPC-LOC-01~06 → LOC-R03, LOC-R06, LOC-R04, LOC-R01

- [x] **T29**: 实现 session-lane-scheduling.spec.ts（TC-SPC-SES-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-SES-*` 用例文件已落地
  - 来源：TP-SPC-SES-01~02 → SES-R04, SES-R02

- [x] **T30**: 实现 request-cancel.spec.ts（TC-SPC-RC-01~05, 5个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-RC-*` 用例文件已落地
  - 来源：TP-SPC-RC-01~05 → RC-R01, RC-R03, RC-R06, RC-R02, RC-R07

- [x] **T31**: 实现 request-retry.spec.ts（TC-SPC-RR-01~04, 4个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-RR-*` 用例文件已落地
  - 来源：TP-SPC-RR-01~04 → RR-R01, RR-R06, RR-R08, RR-R02

- [x] **T32**: 实现 run-status-visibility.spec.ts（TC-SPC-RSV-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-RSV-*` 用例文件已落地
  - 来源：TP-SPC-RSV-01~02 → RSV-R03, RSV-R04

- [x] **T33**: 实现 web-transports.spec.ts（TC-SPC-WS-01~03, 3个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-WS-*` 用例文件已落地
  - 来源：TP-SPC-WS-01~03 → WS-R01, WS-R03, WS-R07

- [x] **T34**: 实现 stream-resume.spec.ts（TC-SPC-SRR-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-SRR-*` 用例文件已落地
  - 来源：TP-SPC-SRR-01~02 → SR-R01, SR-R04

- [x] **T35**: 实现 stream-history-consistency.spec.ts（TC-SPC-SHC-01, 1个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-SHC-*` 用例文件已落地
  - 来源：TP-SPC-SHC-01 → SHC-R01

- [x] **T36**: 实现 fullstack-packaging.spec.ts（TC-SPC-FPB-01~03, 3个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-FPB-*` 用例文件已落地
  - 来源：TP-SPC-FPB-01~03 → FPB-R01, FPB-R12, FPB-R14

- [x] **T37**: 实现 alpha-kernel-gate.spec.ts（TC-SPC-AEG-01~06, 6个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-AEG-*` 用例文件已落地
  - 来源：TP-SPC-AEG-01~06 → AEG-R03, AEG-R04, AEG-R05, AEG-R06, AEG-R07

- [x] **T38**: 实现 product-journey-gate.spec.ts（TC-SPC-PJG-01, 1个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-PJG-*` 用例文件已落地
  - 来源：TP-SPC-PJG-01 → PJG-R02

- [x] **T39**: 实现 release-package-gate.spec.ts（TC-SPC-RPG-01, 1个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-RPG-*` 用例文件已落地
  - 来源：TP-SPC-RPG-01 → RPG-R01, RPG-R02

- [x] **T40**: 实现 resilience-gate.spec.ts（TC-SPC-REG-01, 1个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-REG-*` 用例文件已落地
  - 来源：TP-SPC-REG-01 → REG-R02

- [x] **T41**: 实现 security-gate.spec.ts（TC-SPC-SEG-01, 1个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-SEC-*` 用例文件已落地
  - 来源：TP-SPC-SEG-01 → SEG-R02

- [x] **T42**: 实现 web-command-idempotency.spec.ts（TC-SPC-WCI-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-WCI-*` 用例文件已落地
  - 来源：TP-SPC-WCI-01~02 → WCI-R01

- [x] **T43**: 实现 local-runtime-recovery.spec.ts（TC-SPC-LRR-01~03, 3个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-LRR-*` 用例文件已落地
  - 来源：TP-SPC-LRR-01~03 → LRR-R01, LRR-R08, LRR-R09

- [x] **T44**: 实现 local-runtime-package.spec.ts（TC-SPC-LRP-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-LRP-*` 用例文件已落地
  - 来源：TP-SPC-LRP-01~02 → LRP-R05, LRP-R04

- [x] **T45**: 实现 local-runtime-release.spec.ts（TC-SPC-LRL-01, 1个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-LRL-*` 用例文件已落地
  - 来源：TP-SPC-LRL-01 → LRL-R01, LRL-R06

- [x] **T46**: 实现 capability-catalog.spec.ts（TC-SPC-CAT-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-CAT-*` 用例文件已落地
  - 来源：TP-SPC-CAT-01~02 → CAT-R08, BSS-R09

- [x] **T47**: 实现 capability-source-config.spec.ts（TC-SPC-CSC-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-CSC-*` 用例文件已落地
  - 来源：TP-SPC-CSC-01~02 → CSC-R05, CSC-R07

- [x] **T48**: 实现 conflict-resolution.spec.ts（TC-SPC-CR-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-CR-*` 用例文件已落地
  - 来源：TP-SPC-CR-01~02 → CR-R03, CR-R04

- [x] **T49**: 实现 idempotency-contract.spec.ts（TC-SPC-IC-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-IC-*` 用例文件已落地
  - 来源：TP-SPC-IC-01~02 → IC-R03, IC-R04

- [x] **T50**: 实现 model-invocation-contract.spec.ts（TC-SPC-MIC-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-MIC-*` 用例文件已落地
  - 来源：TP-SPC-MIC-01~02 → MIC-R09, MIC-R10

- [x] **T51**: 实现 model-fallback.spec.ts（TC-SPC-MFA-01, 1个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-MFA-*` 用例文件已落地
  - 来源：TP-SPC-MFA-01 → MFA-R02

- [x] **T52**: 实现 model-stream-normalization.spec.ts（TC-SPC-MSN-01, 1个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-MSN-*` 用例文件已落地
  - 来源：TP-SPC-MSN-01 → MSN-R03

- [x] **T53**: 实现 model-provider-config.spec.ts（TC-SPC-MPC-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-MPC-*` 用例文件已落地
  - 来源：TP-SPC-MPC-01~02 → MPC-R04, MPC-R06

- [x] **T54**: 实现 sandbox-runtime.spec.ts（TC-SPC-SR-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-SR-*` 用例文件已落地
  - 来源：TP-SPC-SR-01~02 → SR-R02, SR-R06, SDA-R02

- [x] **T55**: 实现 sandbox-deny-by-default.spec.ts（TC-SPC-SDA-01, 1个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-SDA-*` 用例文件已落地
  - 来源：TP-SPC-SDA-01 → SDA-R02, SDA-R03

- [x] **T56**: 实现 large-content-references.spec.ts（TC-SPC-LCR-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-LCR-*` 用例文件已落地
  - 来源：TP-SPC-LCR-01~02 → LCR-R01, LCR-R04

- [x] **T57**: 实现 secret-config-boundary.spec.ts（TC-SPC-SEC-B-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-SEC-B-*` 用例文件已落地
  - 来源：TP-SPC-SEC-B-01~02 → SEC-B-R06, SEC-B-R08

- [x] **T58**: 实现 recovery-idempotency-guard.spec.ts（TC-SPC-RIG-01~03, 3个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-RIG-*` 用例文件已落地
  - 来源：TP-SPC-RIG-01~03 → RIG-R02, RIG-R03, RIG-R05

- [x] **T59**: 实现 cross-platform-executable.spec.ts（TC-SPC-CPES-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-CPES-*` 用例文件已落地
  - 来源：TP-SPC-CPES-01~02 → CPES-R01, CPES-R02

- [x] **T60**: 实现 redaction-policy.spec.ts（TC-SPC-RP-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-RP-*` 用例文件已落地
  - 来源：TP-SPC-RP-01~02 → RP-R01, RP-R07

- [x] **T61**: 实现 audit-event-contract.spec.ts（TC-SPC-AEC-01, 1个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-AEC-*` 用例文件已落地
  - 来源：TP-SPC-AEC-01 → AEC-R01

- [x] **T62**: 实现 audit-sink.spec.ts（TC-SPC-AS-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-AS-*` 用例文件已落地
  - 来源：TP-SPC-AS-01~02 → AS-R05, AS-R06

- [x] **T63**: 实现 invocation-audit.spec.ts（TC-SPC-IA-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-IA-*` 用例文件已落地
  - 来源：TP-SPC-IA-01~02 → IA-R01, IA-R04, IA-R03

- [x] **T64**: 实现 lifecycle-observability.spec.ts（TC-SPC-ILCO-01, 1个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-ILCO-*` 用例文件已落地
  - 来源：TP-SPC-ILCO-01 → ILCO-R07

- [x] **T65**: 实现 structured-logging.spec.ts（TC-SPC-SL-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-SL-*` 用例文件已落地
  - 来源：TP-SPC-SL-01~02 → SL-R04, RP-R04, SL-R06

- [x] **T66**: 实现 trace-log-linking.spec.ts（TC-SPC-TLL-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-TLL-*` 用例文件已落地
  - 来源：TP-SPC-TLL-01~02 → TLL-R02, TLL-R14

- [x] **T67**: 实现 runtime-metrics.spec.ts（TC-SPC-ARM-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-ARM-*` 用例文件已落地
  - 来源：TP-SPC-ARM-01~02 → ARM-R04, ARM-R07

- [x] **T68**: 实现 multi-host-modes.spec.ts（TC-SPC-AWM-01~05, 5个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-AWM-*` 用例文件已落地
  - 来源：TP-SPC-AWM-01~05 → AWM-R02, AWM-R03, AWM-R06, AWM-R10, AWM-R01

- [x] **T69**: 实现 health-check.spec.ts（TC-SPC-SYHC-01~03, 3个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-SYHC-*` 用例文件已落地
  - 来源：TP-SPC-SYHC-01~03 → SHC-R02, SHC-R03, SHC-R05

- [x] **T70**: 实现 local-timeline-store.spec.ts（TC-SPC-LRTS-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-LRTS-*` 用例文件已落地
  - 来源：TP-SPC-LRTS-01~02 → LRTS-R03, LRTS-R07

- [x] **T71**: 实现 provider-error-safe-mapping.spec.ts（TC-SPC-PES-01, 1个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-PES-*` 用例文件已落地
  - 来源：TP-SPC-PES-01 → PES-R01, PES-R03

- [x] **T72**: 实现 builtin-skill-source.spec.ts（TC-SPC-BSS-01~03, 3个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-BSS-*` 用例文件已落地
  - 来源：TP-SPC-BSS-01~03 → BSS-R01, BSS-R04, BSS-R15

- [x] **T73**: 实现 builtin-tool-framework.spec.ts（TC-SPC-BTF-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-BTF-*` 用例文件已落地
  - 来源：TP-SPC-BTF-01~02 → BTF-R01, BTF-R09

- [x] **T74**: 实现 skill-manifest-contract.spec.ts（TC-SPC-SMC-01~03, 3个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-SMC-*` 用例文件已落地
  - 来源：TP-SPC-SMC-01~03 → SMC-R01, SMC-R06, SMC-R16, SMC-R07

- [x] **T75**: 实现 skill-tool.spec.ts（TC-SPC-ST-01, 1个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-ST-*` 用例文件已落地
  - 来源：TP-SPC-ST-01 → ST-R01

- [x] **T76**: 实现 local-skill-source.spec.ts（TC-SPC-LSS-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-LSS-*` 用例文件已落地
  - 来源：TP-SPC-LSS-01~02 → LSS-R06, LSS-R04

- [x] **T77**: 实现 bash-tool.spec.ts（TC-SPC-BT-01~03, 3个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-BT-*` 用例文件已落地
  - 来源：TP-SPC-BT-01~03 → BT-R03, BT-R05, BT-R07

- [x] **T78**: 实现 write-tool.spec.ts（TC-SPC-WT-01~03, 3个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-WT-*` 用例文件已落地
  - 来源：TP-SPC-WT-01~03 → WT-R03, WT-R04, WT-R02

- [x] **T79**: 实现 glob-tool.spec.ts（TC-SPC-GT-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-GT-*` 用例文件已落地
  - 来源：TP-SPC-GT-01~02 → GT-R06

- [x] **T80**: 实现 python-tool.spec.ts（TC-SPC-PT-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-PT-*` 用例文件已落地
  - 来源：TP-SPC-PT-01~02 → PT-R01, PT-R04

- [x] **T81**: 实现 model-provider-adapter.spec.ts（TC-SPC-MPA-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-MPA-*` 用例文件已落地
  - 来源：TP-SPC-MPA-01~02 → MPA-R04, MPA-R06

- [x] **T82**: 实现 context-token-estimator.spec.ts（TC-SPC-CTE-T-01, 1个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-CTE-T-*` 用例文件已落地
  - 来源：TP-SPC-CTE-T-01 → MIC-R02, MPC-R02

- [x] **T83**: 实现 api-backed-tool-source.spec.ts（TC-SPC-APTS-01~02, 2个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-APTS-*` 用例文件已落地
  - 来源：TP-SPC-APTS-01~02 → APTS-R03, APTS-R06

- [x] **T84**: 实现 dev-watch-mode.spec.ts（TC-SPC-FPB-DW-01~03, 3个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-FPB-DW-*` 用例文件已落地
  - 来源：TP-SPC-FPB-DW-01~03 → FPB-R11, FPB-R17, FPB-R25

- [x] **T85**: 实现 session-title-generation.spec.ts（TC-SPC-STG-01, 1个用例）
  - 对账依据：source review 确认 `spec-shall/` 目录中的 `TC-SPC-STG-*` 用例文件已落地
  - 来源：TP-SPC-STG-01 → STG-R01

### Phase 4: 并发测试用例实现（12个 TC）

- [x] **T86**: 实现 runtime-race.spec.ts（TC-CON-RT-01~03, 3个用例）
  - 对账依据：source review 确认 `concurrency/` 目录中的 `TC-CON-RT-*` 用例文件已落地
  - 来源：TP-CON-RT-01~03 → SES-R04, RC-R08, CC-R04, LRR-R01, SES-R02

- [x] **T87**: 实现 gateway-concurrency.spec.ts（TC-CON-GW-01~03, 3个用例）
  - 对账依据：source review 确认 `concurrency/` 目录中的 `TC-CON-GW-*` 用例文件已落地
  - 来源：TP-CON-GW-01~03 → CC-R02

- [x] **T88**: 实现 channel-web-concurrency.spec.ts（TC-CON-CH-01~02, 2个用例）
  - 对账依据：source review 确认 `concurrency/` 目录中的 `TC-CON-CH-*` 用例文件已落地
  - 来源：TP-CON-CH-01~02 → SR-R01, WS-R01

- [x] **T89**: 实现 session-capability-concurrency.spec.ts（TC-CON-SN-01, 1个用例）
  - 对账依据：source review 确认 `concurrency/` 目录中的 `TC-CON-SN-*` 用例文件已落地
  - 来源：TP-CON-SN-01 → CC-R05

- [x] **T90**: 实现 context-engine-concurrency.spec.ts（TC-CON-CE-01, 1个用例）
  - 对账依据：source review 确认 `concurrency/` 目录中的 `TC-CON-CE-*` 用例文件已落地
  - 来源：TP-CON-CE-01 → CTE-R16

- [x] **T91**: 实现 catalog-concurrency.spec.ts（TC-CON-CR-01, 1个用例）
  - 对账依据：source review 确认 `concurrency/` 目录中的 `TC-CON-CR-*` 用例文件已落地
  - 来源：TP-CON-CR-01 → CAT-R08

### Phase 5: 非功能测试用例实现（15个 TC）

- [x] **T92**: 实现 performance.spec.ts（TC-PER-01~04, 4个用例）
  - 对账依据：source review 确认 `non-functional/` 目录中的 `TC-PER-*` 用例文件已落地
  - 来源：TP-PER-01~04 → ARM-R06, WS-R01, BA-R06, SHC-R02

- [x] **T93**: 实现 reliability.spec.ts（TC-REL-01~02, 2个用例）
  - 对账依据：source review 确认 `non-functional/` 目录中的 `TC-REL-*` 用例文件已落地
  - 来源：TP-REL-01~02 → LRR-R01, REG-R02, ILCO-R06

- [x] **T94**: 实现 security.spec.ts（TC-SEC-01~05, 5个用例）
  - 对账依据：source review 确认 `non-functional/` 目录中的 `TC-SEC-*` 用例文件已落地
  - 来源：TP-SEC-01~05 → CC-R02, LOC-R07, SEC-B-R08, SEG-R02, RP-R04, LOC-R04, BT-R05, SR-R05

- [x] **T95**: 实现 resilience.spec.ts（TC-RES-01~04, 4个用例）
  - 对账依据：source review 确认 `non-functional/` 目录中的 `TC-RES-*` 用例文件已落地
  - 来源：TP-RES-01~04 → MFA-R02, PES-R01, SR-R01, LRTS-R03, RIG-R01, SL-R06, AS-R05, ARM-R07

### Phase 6: 前端 UI 测试用例实现（16个 TC）

- [x] **T96**: 实现 user-input-reply.spec.ts（TC-UI-01~02, 2个用例）
  - 对账依据：source review 确认 `ui-interaction/` 目录中的 `TC-UI-01`、`TC-UI-02` 已落地
  - 来源：TP-UI-01~02 → AWM-R01, WS-R01

- [x] **T97**: 实现 sse-consumption.spec.ts（TC-UI-03~04, 2个用例）
  - 对账依据：source review 确认 `ui-interaction/` 目录中的 `TC-UI-03`、`TC-UI-04` 已落地
  - 来源：TP-UI-03~04 → WS-R01, SR-R02

- [x] **T98**: 实现 tool-call-render.spec.ts（TC-UI-05, 1个用例）
  - 对账依据：source review 确认 `ui-interaction/` 目录中的 `TC-UI-05` 已落地
  - 来源：TP-UI-05 → AWM-R01

- [x] **T99**: 实现 session-management-ui.spec.ts（TC-UI-06~09, 4个用例）
  - 对账依据：source review 确认 `ui-interaction/` 目录中的 `TC-UI-06` 至 `TC-UI-09` 已落地
  - 来源：TP-UI-06~09 → AWM-R01, AWM-R10, AWM-R09

- [x] **T100**: 实现 auth-settings.spec.ts（TC-UI-10~16, 7个用例）
  - 对账依据：source review 确认 `ui-interaction/` 目录中的 `TC-UI-10` 至 `TC-UI-16` 已落地
  - 来源：TP-UI-10~16 → LOC-R03, AWM-R02, AWM-R04, AWM-R08, AWM-R09

### Phase 7: 验收与归档

- [ ] **T101**: 全量测试运行验证（242个 TC 全部通过）
  - 验证：`npx playwright test --reporter=html` 产出完整报告，242个测试通过
  - 当前状态：未执行；`tests/TESTClaw/scripts/run-tests.ps1` 明确要求先准备 `tests/TESTClaw/target/` 二进制包目录并设置 `OPENAI_API_KEY`，当前仓库缺少 `target/`
  - 来源：所有 spec requirements

- [ ] **T102**: P0 测试独立运行验证（64个 P0 TC 全部通过）
  - 验证：`npx playwright test --grep=@P0` 全部通过
  - 当前状态：未执行；与 T101 相同，受 `tests/TESTClaw/target/` 缺失和 runner 环境前置条件阻塞
  - 来源：P0 测试点清单

- [x] **T103**: 更新 openspec 基线文档（overview.md、spec-to-design-map）
  - 对账依据：source review 确认 `openspec/overview.md` 与 `openspec/designs/spec-to-design-map.md` 已补齐 TESTClaw contract/E2E 相关基线条目
  - 来源：proposal.md 归档前更新基线

- [x] **T104**: 生成测试用例文档最终版本（同步到项目基线）
  - 对账依据：source review 确认 `tests/TESTClaw/testcase-document.md` 已落地，并记录 suite inventory、TC/TP 追溯规则及 242/241/assertion 计数口径差异说明
  - 来源：所有 TP 编号和 Spec Requirement 编号
