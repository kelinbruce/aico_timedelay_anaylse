## 1. `FN-2.4 查看请求状态`

- [x] 1.1 为 RAG `SUMMARY` 增加共享 stream projector contract test，覆盖 RAG 成功结果的来源/预览、敏感字段裁剪及非 RAG `SUMMARY` 不变。
  来源：FN-2.4 + 系统质量属性 + `RAG SUMMARY 结果展示保持安全且可核验` + 三个 Scenario。
  验证：`npx vitest run --maxWorkers=4 packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts`（90 tests passed）。

- [x] 1.2 修改共享 Capability 结果投影，仅在成功 RAG `SUMMARY` 透出既有有界 `ragRetrieval` `safeResult`，使 Agent Web 显示条数、来源和预览。
  来源：FN-2.4 + 系统质量属性 + `RAG SUMMARY 结果展示保持安全且可核验` + `默认 RAG SUMMARY 展示来源和预览`；design `FN-2.4 查看请求状态/修改方案`。
  验证：共享 projector 90 tests passed；`npm --prefix frontend/agent-web test -- --run src/features/chat/components/ProcessPanel.test.ts`（28 tests passed）。

- [x] 1.3 验证 live/history 共享投影和前端渲染不从原始结果补字段。
  来源：FN-2.4 + 系统质量属性 + `RAG SUMMARY 结果展示保持安全且可核验` + `RAG SUMMARY 不泄露原始检索字段`；design `验证策略`。
  验证：`npx vitest run --config vitest.config.channel-web.ts packages/agent-channel-web/tests/rag-result-projection.test.ts packages/agent-channel-web/tests/session-event-history-route.test.ts`（20 tests passed），共享 projector 90 tests passed，前端 28 tests passed。

## 2. Change 整体验证

- [ ] 2.1 校验 OpenSpec delta、受影响 TypeScript 构建和前端构建。
  来源：proposal `影响范围` + design `验证策略`。
  验证：`openspec validate refine-rag-summary-result-display --strict`、`npm run build`、`npm --prefix frontend/agent-web run build`；全部通过。

## 归档前更新基线检查（非实施任务）

归档时按 design 的“长期基线刷新计划”同步 `ts-run-status-visibility`、FN-2.4 和 stream projection 设计。
