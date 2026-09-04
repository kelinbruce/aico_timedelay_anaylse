# TESTClaw Test Case Document

## Purpose

This document is the baseline inventory for the TESTClaw suites introduced by `add-ts-contract-test-gate` and `add-ts-architecture-test-gate`. It records the suite layout, case families, and traceability conventions used by the binary-package black-box test harness.

## Traceability Rules

- Every TESTClaw case uses a `TC-*` identifier in the filename or top-of-file header.
- Every TESTClaw case maps to a `TP-*` test point and one or more stable spec requirements.
- Contract-gate suites use file-level grouping (`01-functional` through `09-architecture`) and place the Gateway/SPI semantic checkpoints in `08-contract.test.ts`.
- Architecture-gate suites use TC-granular Playwright files under `tests/suites/add-ts-architecture-test-gate/`.

## Inventory Summary

| Change | Suite root | Inventory shape | Traceability anchor |
|---|---|---|---|
| `add-ts-contract-test-gate` | `tests/suites/add-ts-contract-test-gate/` | 9 Vitest files / 144 backend cases | `01`-`09` file groups + `08-contract.test.ts` semantic checkpoints |
| `add-ts-architecture-test-gate` | `tests/suites/add-ts-architecture-test-gate/` | 241 Playwright files implementing the change's E2E corpus | `TC-*` filename + top-of-file `TP-*` / spec requirement headers |
| `add-ts-system-integration-validation-gate` | `tests/suites/add-ts-system-integration-validation-gate/` | 122 independent cases: 3 integration + 119 E2E | `sourceCaseRef → TC-SI-* → executionRef → current result/evidence` |

## System Integration Gate Matrix

| TC range | Count | Origin | Runner |
|---|---:|---|---|
| `TC-SI-001` .. `TC-SI-041` | 41 | Fixed backend gates | Vitest |
| `TC-SI-042` .. `TC-SI-090` | 49 | Backend E2E | Vitest |
| `TC-SI-091` .. `TC-SI-111`, `TC-SI-120` .. `TC-SI-122` | 24 | Browser E2E | Playwright |
| `TC-SI-112` .. `TC-SI-114` | 3 | New public-export/loopback/SkillHub integration | Vitest |
| `TC-SI-115` .. `TC-SI-118` | 4 | New cross-boundary backend E2E | Vitest |
| `TC-SI-119` | 1 | Three-host browser E2E | Playwright |

The activated manifest is `case-manifest.ts`. The standard entrypoint is `npm run test:system-integration`; it emits exactly 122 results and passes only at `122/122 PASSED`. The source-sync command verifies the fixed `41 + 49 + 24` mapping but never supplies a test verdict.

## Contract Gate Matrix

| File | Scope | Case count |
|---|---|---:|
| `01-functional.test.ts` | Runtime command, session, message, active context, request run, timeline, checkpoint, attachment, gateway full-path behavior | 58 |
| `02-performance.test.ts` | Startup, latency, throughput | 12 |
| `03-reliability.test.ts` | Restart recovery and fault handling | 10 |
| `04-compatibility.test.ts` | Version / platform compatibility | 8 |
| `05-security.test.ts` | Credential and sandbox boundaries | 6 |
| `06-serviceability.test.ts` | Logs and diagnostics | 8 |
| `07-e2e.test.ts` | End-to-end product flow | 16 |
| `08-contract.test.ts` | 11 Gateway/SPI semantic contract checks | 11 |
| `09-architecture.test.ts` | Package and dependency boundary checks | 15 |

## Architecture Gate Matrix

### Business Flow

| Test point family | TC range |
|---|---|
| Submit request | `TC-SUB-01` .. `TC-SUB-07` |
| Session create | `TC-SCN-01` .. `TC-SCN-03` |
| Agent assembly | `TC-AAR-01` .. `TC-AAR-02` |
| Context model | `TC-CAM-01` .. `TC-CAM-07` |
| Capability invocation | `TC-CIV-01` .. `TC-CIV-05` |
| Timeline stream | `TC-TSP-01` .. `TC-TSP-04` |
| Terminal commit | `TC-TCM-01` .. `TC-TCM-05` |
| History read | `TC-HRD-01` .. `TC-HRD-03` |
| Session list | `TC-SLT-01` .. `TC-SLT-02` |
| Owner scope | `TC-OSP-01` .. `TC-OSP-02` |
| Checkpoint save | `TC-CPS-01` .. `TC-CPS-02` |
| Hook invocation | `TC-HIV-01` .. `TC-HIV-03` |
| Pending input | `TC-PIN-01` .. `TC-PIN-04` |
| Attachment validation | `TC-ATV-01` .. `TC-ATV-02` |
| Context compression | `TC-CCO-01` .. `TC-CCO-02` |

### Spec SHALL

| Test point family | TC range |
|---|---|
| Backend architecture | `TC-SPC-BA-01` .. `TC-SPC-BA-03` |
| Core contracts | `TC-SPC-CC-01` .. `TC-SPC-CC-03` |
| Minimal kernel | `TC-SPC-MK-01` .. `TC-SPC-MK-03` |
| Agent package assembly | `TC-SPC-APA-01` .. `TC-SPC-APA-03` |
| App config schema | `TC-SPC-ACS-01` .. `TC-SPC-ACS-04` |
| Context engine | `TC-SPC-CTE-01` .. `TC-SPC-CTE-04` |
| Context assembly contracts | `TC-SPC-CAC-01` |
| Local configured auth | `TC-SPC-LOC-01` .. `TC-SPC-LOC-06` |
| Session lane scheduling | `TC-SPC-SES-01` .. `TC-SPC-SES-02` |
| Request cancel | `TC-SPC-RC-01` .. `TC-SPC-RC-05` |
| Request retry | `TC-SPC-RR-01` .. `TC-SPC-RR-03` |
| Run status visibility | `TC-SPC-RSV-01` |
| Web transports | `TC-SPC-WS-01` .. `TC-SPC-WS-02` |
| Stream resume | `TC-SPC-SR-01` |
| Stream/history consistency | `TC-SPC-SHC-01` |
| Fullstack packaging | `TC-SPC-FPB-01` .. `TC-SPC-FPB-03` |
| Alpha kernel gate | `TC-SPC-AEG-01` .. `TC-SPC-AEG-05` |
| Product journey gate | `TC-SPC-PJG-01` |
| Release package gate | `TC-SPC-RPG-01` |
| Resilience gate | `TC-SPC-REG-01` |
| Security gate | `TC-SPC-SEG-01` |
| Web command idempotency | `TC-SPC-WCI-01` .. `TC-SPC-WCI-02` |
| Local runtime recovery | `TC-SPC-LRR-01` .. `TC-SPC-LRR-02` |
| Local runtime package | `TC-SPC-LRP-01` .. `TC-SPC-LRP-02` |
| Local runtime release | `TC-SPC-LRL-01` |
| Capability catalog | `TC-SPC-CAT-01` .. `TC-SPC-CAT-02` |
| Capability source config | `TC-SPC-CSC-01` .. `TC-SPC-CSC-02` |
| Conflict resolution | `TC-SPC-CR-01` .. `TC-SPC-CR-02` |
| Idempotency contract | `TC-SPC-IC-01` .. `TC-SPC-IC-02` |
| Model invocation contract | `TC-SPC-MIC-01` .. `TC-SPC-MIC-02` |
| Model fallback | `TC-SPC-MFA-01` |
| Model stream normalization | `TC-SPC-MSN-01` |
| Model provider config | `TC-SPC-MPC-01` .. `TC-SPC-MPC-02` |
| Sandbox runtime | `TC-SPC-SR-01` |
| Sandbox deny-by-default | `TC-SPC-SDA-01` |
| Large content references | `TC-SPC-LCR-01` |
| Secret config boundary | `TC-SPC-SEC-B-01` .. `TC-SPC-SEC-B-02` |
| Recovery idempotency guard | `TC-SPC-RIG-01` .. `TC-SPC-RIG-03` |
| Cross-platform executable semantics | `TC-SPC-CPES-01` .. `TC-SPC-CPES-02` |
| Redaction policy | `TC-SPC-RP-01` |
| Audit event contract | `TC-SPC-AEC-01` |
| Audit sink | `TC-SPC-AS-01` .. `TC-SPC-AS-02` |
| Invocation audit | `TC-SPC-IA-01` .. `TC-SPC-IA-02` |
| Lifecycle observability | `TC-SPC-ILCO-01` |
| Structured logging | `TC-SPC-SL-01` |
| Trace-log linking | `TC-SPC-TLL-01` .. `TC-SPC-TLL-02` |
| Runtime metrics | `TC-SPC-ARM-01` |
| Multi-host modes | `TC-SPC-AWM-01` .. `TC-SPC-AWM-05` |
| Health check | `TC-SPC-SYHC-01` .. `TC-SPC-SYHC-03` |
| Local timeline store | `TC-SPC-LRTS-01` |
| Provider error safe mapping | `TC-SPC-PES-01` |
| Builtin skill source | `TC-SPC-BSS-01` .. `TC-SPC-BSS-03` |
| Builtin tool framework | `TC-SPC-BTF-01` .. `TC-SPC-BTF-02` |
| Skill manifest contract | `TC-SPC-SMC-01` .. `TC-SPC-SMC-03` |
| Skill tool | `TC-SPC-ST-01` |
| Local skill source | `TC-SPC-LSS-01` |
| Bash tool | `TC-SPC-BT-01` .. `TC-SPC-BT-02` |
| Write tool | `TC-SPC-WT-01` .. `TC-SPC-WT-03` |
| Glob tool | `TC-SPC-GT-01` |
| Python tool | `TC-SPC-PT-01` .. `TC-SPC-PT-02` |
| Model provider adapter | `TC-SPC-MPA-01` .. `TC-SPC-MPA-02` |
| Context token estimator | `TC-SPC-CTE-T-01` |
| API-backed tool source | `TC-SPC-APTS-01` .. `TC-SPC-APTS-02` |
| Dev watch mode | `TC-SPC-FPB-DW-01` .. `TC-SPC-FPB-DW-03` |
| Session title generation | `TC-SPC-STG-01` |

### Concurrency / Non-Functional / UI

| Suite | TC range |
|---|---|
| Concurrency | `TC-CON-RT-*`, `TC-CON-GW-*`, `TC-CON-CH-*`, `TC-CON-SN-*`, `TC-CON-CE-*`, `TC-CON-CR-*` |
| Non-functional | `TC-PER-*`, `TC-REL-*`, `TC-SEC-*`, `TC-RES-*` |
| UI interaction | `TC-UI-01` .. `TC-UI-16` |

## Reconciliation Note

The active change documents use more than one counting lens:

- task/proposal acceptance planning references a 242-case baseline;
- the checked-in Playwright corpus currently materializes as 241 files;
- those files contain a larger number of concrete Playwright `test` / `test.skip` assertions because several files carry multiple sub-cases and deferred skip-only checks.

For baseline governance, this document treats the `TC-*` / `TP-*` inventory above as the authoritative traceability map, while execution reports remain the source of truth for exact active-vs-skipped assertion counts.
