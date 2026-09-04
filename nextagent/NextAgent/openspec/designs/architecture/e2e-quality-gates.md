# E2E Quality Gates

## Alpha E2E Gate (`alpha-kernel-gate`)

**命令：** `npm run test:e2e:alpha`
**依赖能力：** `ts-minimal-agent-kernel`（Alpha 串行底座最小问答内核）
**checkId：** `alpha-kernel-gate`

Alpha E2E gate 使用真实 local product process、真实 HTTP/SSE 连接和真实 local persistence，验证 Alpha 最小问答内核的用户可观测行为。涵盖 6 个必需用例（`alpha-01` 到 `alpha-06`），每个 case id 只有一个主要维护 spec。

**真实边界：** product composition、Web transport、runtime 和 local gateway persistence MUST NOT 被 mock 替代。外部 model/provider 使用明确声明的 deterministic provider。

**P0 能力隔离：** Alpha gate 的 product process fixture MUST NOT 启动 local auth route、WebSocket upgrade、P0 tool registration 或 P0 context assembly 增强。任一 P0 行为出现在 Alpha E2E 用例中时 gate MUST 拒绝该用例。

**用例唯一归属：**

| 用例 | 主要验证目标 | Alpha 行为来源 |
|---|---|---|
| `alpha-01` | 最小问答主流程：session create → submit → SSE → terminal → history 一致 | `ts-minimal-agent-kernel` "最小问答主流程" |
| `alpha-02` | SSE canonical sequence：事件类型、顺序、终态 | `ts-minimal-agent-kernel` "Stream Web Channel" |
| `alpha-03` | 同 session 并发冲突拒绝（简单 reject） | `ts-minimal-agent-kernel` "同 session 并发 submit 不串写" |
| `alpha-04` | SafeError 安全边界：非法输入 → safe error，无原始泄漏 | `ts-minimal-agent-kernel` "Terminal Consistency And Safe Error" |
| `alpha-05` | Idempotent session create：重复创建返回首次结果 | `ts-minimal-agent-kernel` "创建或使用会话" |
| `alpha-06` | Owner scope 隔离：跨 owner 访问返回 safe not-found | `ts-minimal-agent-kernel` "Owner Scope And No-op Boundaries" |

**Evidence 规则：** 每个用例 MUST 保存 case id、开始/结束时间、结果、失败阶段和安全 artifact refs。任何必需用例 skipped、timeout 或 failed 时 gate MUST 失败。报告不得包含 raw credential、prompt、模型完整输出、附件内容或未脱敏路径。

**最小实现边界：** 只允许抽取启动/停止 Alpha 级产品进程、隔离临时目录、真实 HTTP/SSE client、case inventory 和 report 写入所需的最小 helper。不得新增通用 E2E DSL、独立 case 编排框架、产品 API 或可被产品路径依赖的测试机制。

## P0 / P1 / P2 E2E Gates

P0 / P1 / P2 阶段的 E2E gate 覆盖首版增强能力以及后续联合场景门槛（auth、cancel、retry、WebSocket、tool、title、feedback、packaging、memory、workflow、pending input、conversation share 等）：

| Gate | 命令 | checkId |
|---|---|---|
| Product Journey | `npm run test:e2e:release` (covers product-journey) | `product-journey` |
| Security | `npm run test:e2e:release` (covers security) | `security` |
| Resilience | `npm run test:e2e:release` (covers resilience) | `resilience` |
| P1/P2 Scenario | `npm run test:e2e:release` (covers p1-p2-scenario-gate) | `p1-p2-scenario-gate` |
| Release Package | `npm run test:e2e:release` (covers release-package) | `release-package` |

`p1-p2-scenario-gate` 承接当前 activated 的 6 个联合黑盒场景：extension governance、long-term memory、routing child-agent、human pending input、workflow routing、conversation share。它们已经具备真实 product composition、真实 transport、真实 persistence 和真实 orchestration，因此适合作为源码态版本打包前的 release E2E 门槛，并由 `npm run test:e2e:release` 统一执行。

`p1-p2-scenario-gate` 使用三态 inventory 管理准入：`activated`、`planned`、`excluded`。只有具备 active/ready OpenSpec 输入，或已归档进入稳定基线但仍缺真实边界 E2E evidence，且能形成外部可观察结果的场景才能进入 `activated`；candidate、assumption-ready 或仍缺稳定 API / 权限 / persistence owner / 真实产品闭环的扩面候选只保留在 `planned` backlog，不阻断当前 gate。每个 activated case 都必须绑定唯一 `caseId`、唯一 `ownerGate`、唯一实现位置和固定 evidence shape（`caseId`、`scenarioFamily`、`maturityStage`、`result`、`failurePhase`、`evidenceRefs`），并继续遵守“不接受 mock transport、fake stream、直接 service/gateway fixture 结果作为通过证据”的真实边界规则。

P0 E2E gate 的 `product-journey` 用例依赖 local auth、WebSocket、cancel/retry、tool、attachment、title、feedback、context compression 等 P0 能力，不能放入 Alpha gate。

## Gate 关系

| 维度 | Alpha gate (`alpha-kernel-gate`) | P0 / P1 / P2 gates |
|---|---|---|
| 依赖能力 | 仅 `ts-minimal-agent-kernel` | local auth、WebSocket、cancel、retry、tool、attachment、title、feedback、context 等 |
| 用例 ID | `alpha-01` 到 `alpha-06` | `e2e-P0-02` 到 `e2e-P0-26`、`e2e-P1P2-01` 到 `e2e-P1P2-06` |
| product composition | Alpha 级（无 auth、无 WS、无 P0 工具） | P0 级 with-frontend |
| 命令 | `npm run test:e2e:alpha` | `npm run test:e2e:release` |

Alpha gate 作为串行底座核心路径的回归保护，在 P0 能力持续变更期间保持独立验证，不依赖尚未完成的 P0 active change。

## System Integration Validation Gate (`system-integration`)

**命令：** `npm --prefix tests/TESTClaw run test:system-integration`
**owner：** TestClaw（`FN-10.31 验证系统集成`，spec `ts-system-integration-validation-gate`）
**checkId：** `system-integration`

TestClaw 系统集成门禁独立执行 122 个 activated 用例（`TC-SI-001..122`），对候选运行包和外部 package artifacts 做黑盒验证，不复用源码测试结果。它与上述源码态 gate 的边界：

- 41 个固定后端 gate cases（`TC-SI-001..041`）、49 个独立 backend E2E 场景（`TC-SI-042..090`）和 24 个 browser E2E 场景（`TC-SI-091..111`、`TC-SI-120..122`）逐条同步到 TestClaw，每个来源场景与 TestClaw `caseId` 一对一映射；源码测试继续由原 owner 维护，但其结果不参与本门禁 verdict。
- 3 个新增系统集成用例（`TC-SI-112..114`）覆盖外部 ESM TypeScript consumer、remote gateway loopback 和 SkillHub HTTP/文件系统；5 个新增 E2E 流程（`TC-SI-115..119`）覆盖 remote deployment 主链、远端 RAG/sandbox 诊断、SkillHub 获取到执行、远端失败/取消和三宿主真实后端语义。
- 输入为两个显式根：candidate root（`NEXTAGENT_PACKAGE_ROOT`，缺省 `tests/TESTClaw/target`）和 external packages root（`NEXTAGENT_EXTERNAL_PACKAGES_ROOT`），缺失输入对应 case 为 `UNAVAILABLE`，不回退源码。
- 报告 `report.json` 含 `layers={INTEGRATION,E2E}`、122 cases、双向追踪和安全 evidence refs；总 `status` 仅在 3 INTEGRATION + 119 E2E 全部 `PASSED` 且 evidence 安全时通过。
- TestClaw MUST NOT 导入源码/private path/`@nextagent/*/testing`，MUST NOT 读取源码测试报告，MUST NOT 以 skip/todo/mock/source-report 结果计为通过。
- 候选本地 operational diagnostic 只留在 restricted diagnostic root，MUST NOT 被复制到 evidence/stdout/stderr/报告；每次执行独立隔离 runId/端口/临时根，`finally` 停止进程并删除 restricted diagnostic root。

deferred coverage：真实 AICO Service consumer 为 `PLANNED`；`ts-performance-test-gate`、容量/集群/remote Agent/AgentLink 为 `EXCLUDED`，不分配 `TC-SI-*` id，不进入 122 用例计数或 verdict。

源码 checkout 维护期追加 `npm --prefix tests/TESTClaw run test:system-integration:sync` 校验 114 个来源场景是否发生增删/重命名/参数化边界漂移；该校验不参与独立候选包的运行时证据。

## HarnessBench External Evaluation (`harnessbench-evaluation`)

**命令：** `node tests/harnessbench/run.mjs`（按需运行，不进入默认 `npm test` 或 release gate）
**owner：** `tests/harnessbench/**`（`FN-10.13 HarnessBench 评测`，spec `harnessbench-evaluation`）
**checkId：** 无（外部能力评测，非发布门禁）

HarnessBench 评测是独立于 release E2E gate 的外部能力评测路径，复用当前 NextAgent 产品入口和 HarnessBench 原生评分，不改变被测生产代码或公共契约。它与上述源码态 gate、TestClaw 系统集成门禁的并列边界：

- 实现唯一 owner 是 `tests/harnessbench/**`，使用 Node.js ESM、静态 JSON/YAML 和 Vitest；运行期缓存与报告位于已忽略的 `test-output/harnessbench/**`。不进入根 `package.json` 默认 gate，不定义 release `ReleaseCheckResult` 或产品 API。
- 标准入口 `node tests/harnessbench/run.mjs` 无参数运行 `full-suite.json`，对固定上游 commit（`1025086a446653702b80cfb48babbeec35db6b2c`，`https://github.com/Qihoo360/harness-bench.git`）的全部 106 个 task 逐项执行或标记 `unsupported`。`--smoke` 只运行 `001-file`、`002-exec`，输出标记 `nonScoring`，不发布 `frameworkEffectScore`。
- 每个 task 从当前 build 产物 staging 一个 backend-only local runtime candidate，安装 `harnessbench-agent.yaml`（只启用现有 `Read`/`Write`/`Edit`/`Glob`/`Grep`/`Bash`/`Python` 工具，保持现有 sandbox gateway），通过 Web channel IR Session/Request/SSE 路径执行 task。`nextagent-cli.mjs` 只从 public package exports 使用 `@nextagent/agent-app/local-runtime-package` 和 `@nextagent/agent-runtime` execution workspace resolver；禁止导入 `packages/*/src/**`、`@nextagent/*/testing` 或 private subpath。
- 真实模型与 grader 各自从 profile 的独立安全引用（`providerBaseUrlRef`/`credentialRef`/`graderProviderBaseUrlRef`/`graderCredentialRef`，均只允许 `env:<NAME>`）解析，经 usage proxy 转发；credential 不进入 candidate 配置或报告。grader 不复用隐式 `OPENAI_*` fallback。candidate/grader preflight 任一失败则在首个 task 前 fail closed。
- 私有 profile JSON 字段：`profileId`、`upstreamUrl`、`upstreamCommit`（`^[0-9a-f]{40}$`）、`taskSupport`（key 与上游完整 task catalog 恰好一致，value 为 `execute` 或 `{status:"unsupported",reason:<non-empty>}`）、`modelId`、`providerBaseUrlRef`、`credentialRef`、`graderModelId`、`graderProviderBaseUrlRef`、`graderCredentialRef`、`taskTimeoutSeconds`（1–1800，默认 600）。预检生成不可变 `run-manifest.json`，在第一个 task 前独占创建，后续只读。
- 计分只实现 spec 的 `frameworkEffectScore` 公式，以清单中全部 `execute` task 数量 `scoringDenominator` 为分母；`unsupported` 排除出分母，缺失/超出 `[0,1]` 的 `combined_score` 统一归零且对应 execute task 仍留在分母。完整计分运行无论 rubric/process 覆盖是否完整均发布 `frameworkEffectScore`；退化运行同时给出 `coverageGap`，并可保留同值的 `diagnosticFrameworkEffectScore`。内部 task 终态使用闭合集合 `scored`/`unsupported`/`agent_failed`/`model_evidence_missing`/`timed_out`/`grading_failed`，只有 `scored` 可保留非零 `taskScore`。
- 报告为本 Function 私有测试 artifact，不进入 `agent-contracts` 或产品 API。schema version 4 JSON 报告提供全部 execute task 的 `taskScore` 总体和 `terminalStatus=scored` task 的 `combinedScore` 总体，两者分别使用固定互斥分档；JSON 先写临时文件，完成 schema 校验和敏感字段扫描后 rename 到最终路径，Markdown 只从已验证 JSON 渲染。扫描器拒绝 credential/token header、完整 prompt/output 字段、task 文件内容字段和绝对路径；原始 proxy trace 和上游结果留在本地私有运行目录，只以 run-relative evidence ref 引用。
- 失败诊断汇聚同一 task 全部 adapter 轮次的安全结构化证据，保留最后一个明确失败诊断、任一轮工作区观测及模型输出达到候选上限的独立事实；输出上限观测不得改变 terminal、重试或计分。已知 stream 等待失败区分 `STREAM_HTTP_FAILED`、`STREAM_CLOSED_WITHOUT_TERMINAL`、`STREAM_TRANSPORT_FAILED`，本地等待预算耗尽使用 `TASK_TIMED_OUT`；携带合法 timeline sequence 的 idle-close stream 以 session cursor 续接同一 accepted run，且不重置总等待预算。
- 基础设施失败有界恢复：只在 `failurePhase=harness_process`、没有上游 result、模型请求数为零且没有工作区产物时进行一次自动重试，以 attempt ledger 记录两次尝试；terminal/grading/已有模型调用或已有工作区结果的失败不自动重试。中断处理器把未结束 task 标记为 `not_completed` 后复用同一写入路径，同一不可变 manifest 的连续完成前缀可恢复。`failure-recovery-regression` 与 `stream-failure-regression` 提供固定非计分真实回归入口。

deferred scope：首版不规定发布阈值，不把单次分数解释为 SLA；`--smoke` 不得被解释为框架效果；真实模型评测费用和时长由按需运行约束。
