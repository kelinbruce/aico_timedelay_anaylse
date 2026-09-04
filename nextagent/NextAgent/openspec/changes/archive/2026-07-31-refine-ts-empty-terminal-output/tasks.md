# Tasks: Refine TS empty terminal output guard

## 1. 实现

- [x] 1.1 `packages/agent-core/src/model/output-guard.ts`：新增 terminal 内容存在性断言，对空或仅空白字符内容抛出 `MODEL_FINAL_CONTENT_EMPTY`。
- [x] 1.2 `packages/agent-core/src/agent/default-agent.ts`：在 `BEFORE_AGENT_TERMINAL` 之前、terminal hook 变更之后应用该断言，失败前发出 `DEGRADATION_NOTICE(MODEL_FINAL_CONTENT_EMPTY)`。
- [x] 1.3 `packages/agent-runtime/src/terminal/terminal-commit.ts`：把内容为空或仅空白字符的 `COMPLETED` terminal commit 转换为 safe `FAILED`，并发出 `DEGRADATION_NOTICE(MODEL_FINAL_CONTENT_EMPTY)`。

## 2. 测试

- [x] 2.1 `tests/agent-kernel/output-guard.test.ts`：为模型以空最终内容 `stop` 新增黑盒覆盖；断言 `REQUEST_FAILED`、无 `REQUEST_COMPLETED`、非空失败历史和 `MODEL_FINAL_CONTENT_EMPTY` 降级。
- [x] 2.2 `tests/agent-kernel/output-guard.test.ts`：为直接发出空最终内容的自定义 agent 新增 runtime 兜底覆盖。

## 3. 验证

- [x] 3.1 `npx vitest run --config vitest.config.release.ts tests/agent-kernel/output-guard.test.ts` - 8/8 通过。
- [x] 3.2 `openspec validate refine-ts-empty-terminal-output --strict` - 通过。
- [x] 3.3 `npm run build --workspace @nextagent/agent-core` - 通过。
- [x] 3.4 `npm run build --workspace @nextagent/agent-runtime` - 通过。
- [x] 3.5 `npm run build` - 通过。
- [x] 3.6 `npm test` - 98 个文件 / 768 个测试通过。
- [x] 3.7 `npm run test:contract` - 30 个文件 / 272 个测试通过。
- [x] 3.8 `openspec validate --all --strict` - 206 项通过。

## 4. 仅 reasoning 恢复实现

- [x] 4.1 `packages/agent-core/src/model/model-output-recovery.ts`：新增一个固定的 provider 中立纠正请求构建器，不重放 reasoning。
- [x] 4.2 `packages/agent-core/src/agent/default-agent.ts`：检测仅 reasoning 的 `stop`，每个规划轮执行恰好一次同模型纠正调用，然后复用既有的 `MODEL_EMPTY_OUTPUT` fallback 路径。

## 5. 仅 reasoning 恢复测试

- [x] 5.1 新增聚焦覆盖，证明仅 reasoning 的 `stop` 恰好收到一次纠正请求，并可以以可见内容完成。
- [x] 5.2 新增聚焦覆盖，证明连续两次仅 reasoning 的 `stop` 只执行一次纠正，然后使用符合条件的 fallback 路由。
- [x] 5.3 新增负向覆盖，证明 reasoning 加 tool call、已确认可见输出后的仅 reasoning continuation 不触发纠正，且 fallback 路由不会收到第二次纠正。

## 6. 仅 reasoning 恢复验证

- [x] 6.1 `npx vitest run packages/agent-core/tests/model-output-recovery.test.ts packages/agent-core/tests/budget-degradation-notice.test.ts packages/agent-core/tests/model-fallback-orchestration.test.ts --maxWorkers=1` - 3 个文件 / 54 个测试通过。
- [x] 6.2 `npm run build`、`npm test`（116 个文件 / 1091 个测试）、`npm run test:contract`（39 个文件 / 331 个测试）和 `npm run lint:architecture`（40 个文件 / 242 个测试）通过。
- [x] 6.3 `npx -y @fission-ai/openspec@0.22.0 validate refine-ts-empty-terminal-output --strict` 和 `npx -y @fission-ai/openspec@0.22.0 validate --all --strict` 通过（258 项）。
