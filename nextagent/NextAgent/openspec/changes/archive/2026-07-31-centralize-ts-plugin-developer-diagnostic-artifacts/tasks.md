## 0. 契约与迁移门禁

- [x] 0.1 完成 `developer-hook-trace-logging` 与 `context-monitor-logging` 被触及 Requirements 的原子迁移：来源保持 `REMOVED`、FN-10.5 主规格完整承载目标行为、未触及 Requirements 原位保留且直接引用一致。
  来源：FN-10.5；design「存量 Requirement 迁移方案」
  验证：运行 `openspec validate centralize-ts-plugin-developer-diagnostic-artifacts --strict`，预期迁移对、Function 元数据和 delta 格式全部通过；人工核对两个 stable source spec 的未触及 Requirements 未进入 delta。

## 1. `FN-10.5 管理插件开发诊断产物`

- [x] 1.1 先增加 plugin API 1.1 host sink 的失败测试，覆盖 manifest-bound `pluginId`、非法物理输出字段、API 1.0 host shape 不漂移和 stable drop reason；实现前运行并确认目标测试失败。
  来源：FN-10.5 + `系统统一接收插件开发诊断记录` +「已加载插件提交合法记录」「插件尝试控制物理输出」
  验证：运行 `npx vitest run packages/agent-plugin-sdk/tests/plugin-sdk.test.ts packages/agent-app/tests/plugin-loader.test.ts`，预期新增用例实现前失败、实现后全部通过。

- [x] 1.2 在 `agent-plugin-sdk` 与 plugin loader 实现 API 1.1 `DeveloperDiagnosticArtifactSink`、noop sink、精确 factory host shape 和 per-manifest plugin identity binding，不修改 `agent-contracts`。
  来源：FN-10.5 + `系统统一接收插件开发诊断记录`；design「修改方案」1-2
  验证：运行 `npm run build` 及 `npx vitest run packages/agent-plugin-sdk/tests/plugin-sdk.test.ts packages/agent-app/tests/plugin-loader.test.ts packages/agent-app/tests/plugin-host-externals.test.ts`，预期类型检查和 v1.0/v1.1 loader matrix 全通过。

- [x] 1.3 先增加 gateway-local writer 的目标行为和故障注入测试，覆盖完整 NDJSON、第四独立 family、4 MiB boundary、100 MiB/daily rotation、gzip、3-day retention、overflow、recovery、status 与 bounded close；实现前运行并确认失败。
  来源：FN-10.5 + 性能/容量 + `开发诊断记录使用独立的短期产物文件族`、`产物写入具有有界容量和生命周期`；相关 normal/boundary scenarios
  验证：运行新增的 `agent-platform-gateway-local` developer diagnostic writer tests，预期实现前失败、实现后全部通过。

- [x] 1.4 在 `agent-platform-gateway-local` 实现唯一 `LocalDeveloperDiagnosticArtifactWriter`，复用一个独立 `agent-local-file-roll` handle并实现私有 envelope、预算、状态和 lifecycle；不得新增 local-file-roll production consumer。
  来源：FN-10.5 + 性能/容量、可靠性/恢复 + `产物写入具有有界容量和生命周期`、`产物失败不改变受保护操作`、`本地状态只暴露有界安全证据`；design「修改方案」3-4
  验证：运行 gateway-local writer tests、`packages/agent-local-file-roll/tests/local-file-roll.test.ts` 和 `npm run lint:architecture`，预期所有 family ownership、failure 和 dependency assertions 通过。

- [x] 1.5 先增加 app composition/config/status 测试，覆盖默认 disabled、LOCAL enabled、REMOTE no-local-fallback、sync/async等价、start/close exactly-once、失败不进入 RuntimeLogger 与 workbench status 不含 payload/path；实现前确认失败。
  来源：FN-10.5 + 安全、可靠性/恢复 + `产物失败不改变受保护操作`、`本地状态只暴露有界安全证据`、`原始调测内容与主输出面隔离`
  验证：运行相关 `agent-app` config/composition/workbench tests，预期实现前失败、实现后全部通过。

- [x] 1.6 在 frozen config、app composition scope 和 local workbench 中装配 writer/sink/status，确保 operational、audit、metrics、timeline、stream 和 public Web 不消费 payload 或 failure mirror。
  来源：FN-10.5 + 安全、可靠性/恢复；design「修改方案」5-6、9
  验证：运行 `packages/agent-app` 定向 tests、`tests/architecture/runtime-logging-boundary.test.ts`、plugin composition architecture tests 和 `npm run test:contract`，预期隔离 negative cases 实际触发并通过。

- [x] 1.7 先更新两个内置调测插件的测试与 product-path E2E，断言统一 artifact types、记录次数、内容语义、请求继续完成及无 session-specific/direct file；实现前确认失败。
  来源：FN-10.5 + `内置调测插件提交统一记录` +「Developer hook trace 记录模型调用边界」「Context monitor 记录压缩与终态」
  验证：运行 plugin SDK tests、`tests/e2e/developer-hook-trace-plugin-product-path.test.ts` 和 context-monitor product-path E2E，预期实现前失败、实现后全部通过。

- [x] 1.8 把 `developer-hook-trace` 与 `context-monitor` SDK helper和正式 artifacts迁移为 API 1.1 factory/sink，删除 file sink helper、path activation config 和 bundle direct fs。
  来源：FN-10.5 + `内置调测插件提交统一记录`；design「修改方案」7-8
  验证：运行 task 1.7 测试及 architecture source negative test，预期两个 bundle 无 `node:fs`、`appendFileSync`、`writeFileSync`、`logDirectory`、`logFile` 且黑盒记录语义通过。

- [x] 1.9 更新 local runtime packaging fixtures/artifacts 和开发指南，使候选包包含 API 1.1 artifacts但默认 config/Agent activation仍不启用。
  来源：proposal「影响范围」；design「修改方案」7
  验证：运行 local runtime packaging tests和插件文档示例校验，预期 packaged manifests/bundles为1.1且 sample config不激活。

- [x] 1.10 完成 FN-10.5 定向验证并确认无 deferred file helper、no-op product writer、主日志镜像或 legacy direct fs。
  来源：FN-10.5 全部 Requirements；design「验证策略」
  验证：运行 plugin-sdk、gateway-local、agent-app、local-file-roll、两条 product-path E2E 和 architecture定向套件，预期全部通过并记录命令结果。

## 2. Change 整体验证

- [x] 2.1 完成 OpenSpec、后端和架构全量门禁。
  来源：proposal「影响范围」；design「验证策略」
  验证：运行 `openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`，预期全部通过。

- [x] 2.2 使用 `$nextagent-code-review` 覆盖 Frozen core contract、Architecture boundary、Minimal kernel non-regression、Security、OpenSpec consistency和Clean Code；P0/P1清零后才允许 push。
  来源：AGENTS.md Push 门禁；design「验证策略」
  验证：模型语义检视结论必须为 PASS 或 PASS WITH FOLLOW-UP，且不存在 P0/P1。

- [x] 2.3 移除 `developerDiagnostics.artifacts.enabled` 配置契约；LOCAL composition 固定装配 writer，REMOTE 不创建本地 writer，并保持 Agent hook activation 是唯一记录开关。
  来源：FN-10.5 + `开发诊断记录使用独立的短期产物文件族`、`本地状态只暴露有界安全证据`、`原始调测内容与主输出面隔离`；design「修改方案」
  验证：实现后 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/runtime-logging-config.test.ts packages/agent-app/tests/composition.test.ts packages/agent-platform-gateway-local/tests/developer-diagnostic-artifact-writer.test.ts tests/e2e/developer-hook-trace-plugin-product-path.test.ts tests/e2e/context-monitor-plugin-product-path.test.ts --maxWorkers=8` 为 59 passed；`npm run build`、`openspec validate centralize-ts-plugin-developer-diagnostic-artifacts --strict` 和 `git diff --check` 全部通过。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design「长期基线刷新计划」创建 FN-10.5/F-10.5、合并三个 stable specs，并同步 overview、architecture、modules、既有 local-file-roll ADR 和 spec-to-design-map；不得把实施过程或旧 direct-file 布局写入长期目标态。
