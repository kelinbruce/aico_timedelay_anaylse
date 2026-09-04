## 0. 前置门禁

- [x] 0.1 确认 `refine-local-runtime-diagnostic-visibility` 的 Tool/Model raw payload、`rawExceptionData`、精确字段分类和聚焦测试已完成；本 change 只在其目标态上新增关联与汇总，不修改同名 Requirement。
  来源：`design.md` 的“设计范围”与 proposal 非目标
  验证：运行 `openspec validate refine-local-runtime-diagnostic-visibility --strict` 和该 change 记录的聚焦 Vitest；预期 strict validation 与全部聚焦测试通过。
  实施记录：2026-08-06 运行 strict validation 通过；运行 `npx vitest run --config vitest.config.release.ts packages/agent-core/tests/parallel-tool-loop.test.ts tests/agent-kernel/session-lane-scheduling.test.ts`，2 files / 66 tests 通过。

## 1. `FN-7.1 输出结构化日志`

- [x] 1.1 先新增 trace correlation 失败复现：覆盖 lifecycle started/terminal span 配对、direct payload/error 同 boundary 关联、caller spoof 拒绝、tracing 关闭省略和 observation/public surface 不扩散；实施前运行并确认目标断言失败。
  来源：`FN-7.1 输出结构化日志` + 系统质量属性“审计/可追溯性” + Requirement `Operational entry 使用可信执行关联坐标` + Scenarios `复杂 Model 和 Tool 请求按 trace 关联`、`Caller 不能伪造 trace`、`Tracing 关闭时日志行为降级`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-observability/tests/timeline-span-lifecycle.test.ts packages/agent-observability/tests/structured-log-projector.test.ts packages/agent-log/tests/runtime-logger.test.ts tests/agent-kernel/trace-log-linking.test.ts`；预期新增目标断言在实现前失败，既有边界断言继续通过。
  实施记录：2026-08-06 首次运行 2 个新增断言失败、其余 69 tests 通过；失败分别为 physical entry 缺少 trace 和 runtime correlation helper 尚不存在。

- [x] 1.2 实现 trusted correlation sidecar：runtime logger 只读取 execution ALS，timeline observation 只通过 object-identity sidecar 把可信 trace 交给 LOG projector，普通 caller 与其它 surface 均不能读取或伪造；完成后 physical lifecycle 与 local diagnostic 可按 trace/span 关联。
  来源：`design.md` 的“可信 correlation sidecar”；`FN-7.1 输出结构化日志` + Requirement `Operational entry 使用可信执行关联坐标`
  验证：重复运行 task 1.1 命令；预期全部测试通过，且 trace 字段只出现在批准的 operational entry。
  实施记录：2026-08-06 实现 execution ALS、timeline observation object sidecar、host transfer、LOG-only projection、runtime/observation writer 信任分路，并把 request/Model/Tool owner 日志纳入既有 execution ref；task 1.1 命令与 session lane 回归共 5 files / 118 tests 通过。

- [x] 1.3 先新增 request terminal 汇总失败复现：覆盖两个 Model usage 与三个唯一 Tool invocation 的完整汇总、缺 accepted/usage/model terminal/queue event 时的 `PARTIAL`、重复 event/id 去重、failed/canceled status 和 terminal 不含 raw exception；实施前运行并确认目标断言失败。
  来源：`FN-7.1 输出结构化日志` + 系统质量属性“可靠性/恢复” + Requirement `Request terminal entry 提供可验证汇总` + Scenarios `完整 terminal 汇总`、`恢复后缺失中间事实`、`重放事件不重复计数`、`失败根因不在 terminal 重复`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-observability/tests/structured-log-projector.test.ts tests/agent-kernel/trace-log-linking.test.ts tests/agent-kernel/logging.test.ts`；预期新增目标断言在实现前失败。
  实施记录：2026-08-06 首次运行新增的 complete、partial、dedup、queue-drop 四条断言均失败；同时识别并修正前置 stepId 行为对应的既有过期断言。

- [x] 1.4 在 `StructuredLogProjector` 实现 per-run 有界 accumulator、timeline event 与 invocation 去重、queue-drop hook、canonical status 和 terminal cleanup；完成后 terminal entry 输出可证明完整性的 usage、`toolCallCount` 和 `summaryStatus`，不改变 runtime terminal truth。
  来源：`design.md` 的“Request terminal accumulator”；`FN-7.1 输出结构化日志` + Requirement `Request terminal entry 提供可验证汇总`
  验证：重复运行 task 1.3 命令；预期完整、缺失、重复、overflow、failed/canceled 全部通过。
  实施记录：2026-08-06 LOG projector 增加 per-run accumulator 与 host drop hook；task 1.3 命令 3 files / 42 tests 通过。

- [x] 1.5 先新增 error/message identity 失败复现：覆盖无分类 error 的 fallback、已有分类保持、stable event 无 `msg/message` 和 Fastify native access 保留 `msg/reqId/req/res`；实施前运行并确认目标断言失败。
  来源：`FN-7.1 输出结构化日志` + 系统质量属性“可维护性” + Requirement `Error 和 structured event 使用单一诊断身份` + Scenarios `Error entry 总有分类`、`稳定 event 不重复 msg`、`Fastify native access 保留 msg`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-log/tests/runtime-logger.test.ts packages/agent-app/tests/logging-composition.test.ts`；预期新增目标断言在实现前失败，native access characterization 保持通过。
  实施记录：2026-08-06 首次运行新增断言因 unclassified error 缺少 fallback 失败，另外 43 tests 与 Fastify native access characterization 通过。

- [x] 1.6 修改 operational writer 的 error fallback 与 event/native message 分路；完成后每个 product error entry 有批准分类，stable event 只由 `event` 标识，Fastify native access 形状不变。
  来源：`design.md` 的“Error 分类与单一 message”；`FN-7.1 输出结构化日志` + Requirement `Error 和 structured event 使用单一诊断身份`
  验证：重复运行 task 1.5 命令；预期全部测试通过。
  实施记录：2026-08-06 writer 对无批准分类的 error 注入 `UNCLASSIFIED_RUNTIME_ERROR`，stable event 不再消费 message argument，native access writer 不变；2 files / 44 tests 通过。

- [x] 1.7 先新增 deployment/package identity 失败复现：覆盖缺失或非法 serviceVersion 启动失败、manifest candidate version 与 log/OTel 一致、product static component 与 owning package 不一致被 architecture gate 拒绝；实施前运行并确认目标断言失败。
  来源：`FN-7.1 输出结构化日志` + 系统质量属性“审计/可追溯性” + Requirement `Operational entry 使用真实 deployment 和 package identity` + Scenarios `Local package 标识实际 candidate`、`缺失 deployment version 启动失败`、`Component 归属唯一`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/observability-preload-composition.test.ts packages/agent-app/tests/metrics-exporter-composition.test.ts packages/agent-app/tests/logging-composition.test.ts tests/local-runtime-package.test.ts packages/agent-remote-deployment/tests/runtime-package-service-version.test.ts`，并运行 `npx vitest run --config vitest.config.architecture.ts tests/architecture/workspace.test.ts`；预期新增目标断言在实现前失败。
  实施记录：2026-08-06 首次运行时非法 version 未阻止 test composition，architecture gate 报告 5 个 product component owner 不一致；同时确认 local/remote candidate version 既有正向路径。

- [x] 1.8 删除 app observability 的硬编码 version fallback，统一 packaged/non-packaged version 注入与 OTel/log 复用，并把触达的 product logger component 收敛为 package 短名、角色移入 source；完成后所有 product entry 可定位实际 deployment 和唯一 package owner。
  来源：`design.md` 的“Deployment 和 package identity”；`FN-7.1 输出结构化日志` + Requirement `Operational entry 使用真实 deployment 和 package identity`
  验证：重复运行 task 1.7 命令；预期 version normal/failure 与 component negative case 全部通过。
  实施记录：2026-08-06 app 从 package manifest 解析默认 version，显式非法 version 以 `APP_SERVICE_VERSION_INVALID` 失败，log/metric/trace 复用同一 resolved version；5 个 product logger 收敛到 package component。相关 release tests 7 files / 85 tests、architecture workspace 27 tests 通过。回归修复将默认 package metadata 读取延迟到未注入 `serviceVersion` 的非 packaged composition 分支，避免 local runtime package 在模块加载时按平铺 backend 路径解析 manifest；新增 packaging boundary negative assertion，`npm run pack:release -- skip` 的真实 ZIP 解压 self-check 通过。

- [x] 1.9 增加信任边界回归验证，断言 trace sidecar、local Model/Tool payload 和 `rawExceptionData` 不进入 `ObservabilityObservationEvent`、Web/stream、audit 或 metric label，且 canonical lifecycle 与 local diagnostic 的 surface 不互换。
  来源：`design.md` 的“Surface 边界”；proposal 非目标
  验证：运行 `npx vitest run --config vitest.config.release.ts tests/agent-kernel/redaction-policy.test.ts tests/agent-kernel/trace-log-linking.test.ts tests/agent-kernel/logging.test.ts tests/agent-kernel/audit-sink.test.ts tests/agent-kernel/runtime-metrics.test.ts`；预期全部 boundary/negative assertions 通过。
  实施记录：2026-08-06 修正允许 canonical `stepId` 的过期 audit 断言后，5 files / 42 tests 通过；trace/raw payload/raw exception 未进入 Web、audit、metric 或 observation contract。

## 2. Change 整体验证

- [x] 2.1 验证复杂 Model→Tool→Model→terminal product path 的 physical operational entries：共享 trace、boundary span 配对、raw payload 可定位、terminal 汇总完整、error 有分类、stable event 无 msg、serviceVersion/component 正确，且不要求或修改 `udsGateway` 噪声。
  来源：proposal 目标与非目标；`design.md` 的“验证策略”
  验证：运行相关 `tests/agent-kernel/config-assembly.test.ts` 与 logging integration fixture，并对测试生成的 JSONL 做结构断言；预期所有目标字段成立，测试不包含 UDS 数量/采样断言。
  实施记录：2026-08-06 `packages/agent-app/tests/logging-composition.test.ts` 使用真实 writer、OTel provider 与 Model→Tool→Model 请求，对 physical JSONL 断言共享 trace、raw Model/Tool payload、`usage={7,5,12}`、`toolCallCount=1`、`summaryStatus=COMPLETE`、无 `msg`、真实 serviceVersion 和 package component；与 audit 边界共 2 files / 19 tests 通过，未修改 UDS 行为。

- [x] 2.2 运行仓库门禁并记录结果，确保日志变更不破坏构建、contract、architecture 或现有最小内核。
  来源：proposal 影响范围；`design.md` 的“验证策略”
  验证：运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`；预期全部命令成功。
  实施记录：2026-08-06 全部门禁通过：build 成功；npm test 144 files / 1631 tests；contract 44 files / 357 tests；architecture 45 files / 281 tests 且 dependency/manifest policy 通过；OpenSpec 279 items strict validation 通过；NetAgent external dependency interface guard 9 tests 通过。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 `design.md` 的“长期基线刷新计划”归并 stable spec、Function、Feature、architecture、modules 和 spec-to-design-map，并检查 `refine-local-runtime-diagnostic-visibility` 已先归档且本 change 没有覆盖其 raw diagnostic 契约。
