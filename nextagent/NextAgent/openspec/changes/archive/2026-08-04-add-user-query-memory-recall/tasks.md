## 1. `FN-8.2 检索和写入记忆`

- [x] 1.1 为 `UserQueryMemoryRecallService` 编写失败优先测试：L1 只调用一次，唯一 `queryText` 来自调用输入，不传 `categoryFilter`，固定 `limit=10`、`minConfidence=0.3`；全部 L1 候选各读取一次 L2，Owner Scope 和 Agent Scope 原样传递。
  来源：`FN-8.2 检索和写入记忆` + `Memory tools architecture boundaries` + `已启用 Agent 在首次模型调用前主动召回`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-memory/tests/user-query-memory-recall.test.ts`；实际结果：1 个文件、5 个测试通过，参数与调用次数断言通过。
- [x] 1.2 为 L2 批次编写失败优先测试：最大并发 `3`、未命中不读 L2、父请求取消或任一 L2 失败后停止分发、等待已开始调用并返回零详情；L1/L2 均不重试。
  来源：`FN-8.2 检索和写入记忆` + 系统质量属性 `主动召回的 L2 读取有界、响应取消且全有或全无` + `L2 并发受限`、`任一 L2 失败时停止分发同批读取`、`父请求取消`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-memory/tests/user-query-memory-recall.test.ts`；实际结果：最大在途数为 3，失败/取消用例均返回零详情且未重复读取。
- [x] 1.3 在 `agent-memory` 实现并导出最小 `UserQueryMemoryRecallService`，只依赖 `LongTermMemoryRetrieverGateway`，不调用 Tool/Capability 路径且不持久化结果。
  来源：`Memory tools architecture boundaries` + [设计：`FN-8.2 检索和写入记忆`](design.md#fn-82-检索和写入记忆)
  验证：`npm run build --workspace @nextagent/agent-memory`、`npx eslint packages/agent-memory/src/user-query-memory-recall.ts packages/agent-memory/tests/user-query-memory-recall.test.ts`；实际结果：均通过。

## 2. `FN-4.3 装配上下文`

- [x] 2.1 为最终输入补充内容准入编写失败优先测试：以最终消息、工具、模型窗口和预留输出预算依次整体评估 L2、L1、无上下文；禁止截断、部分注入、重新压缩或重新 render。
  来源：`FN-4.3 装配上下文` + 系统质量属性 `主动记忆召回使用最终输入预算整体降级` + `L2 超限时整体降级为 L1`、`L1 仍超限`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-context-engine/tests/rendered-context-supplement-admission.test.ts`；实际结果：1 个文件、4 个测试通过，覆盖三种 disposition、工具预算和精确边界。
- [x] 2.2 在 `agent-context-engine` 实现并公开 `RenderedContextSupplementAdmission`，复用现有 `TokenEstimator`，输出唯一消息 mutation 候选；在 `ModelInvokeBoundary` 增加只读可选 `contextWindowTokens` 并由 `DefaultAgent` 必须填入，兼容调用方缺失时零注入。
  来源：`首轮用户 Query 主动记忆召回进入最终模型输入` + [设计：`FN-4.3 装配上下文`](design.md#fn-43-装配上下文)
  验证：上述定向测试；`npm run build --workspace @nextagent/agent-context-engine`、`npm run build --workspace @nextagent/agent-contracts`、`npm run build --workspace @nextagent/agent-core` 及定向 ESLint；实际结果：全部通过。

## 3. `FN-10.1 注册和执行钩子`

- [x] 3.1 为 lifecycle executor 编写 characterization/失败优先测试：普通 observe/impact Hook 先执行，已激活受信终末 Hook 最后执行；普通/plugin Hook 无 Owner Scope 且看不到受信 mutation；未注册、未激活和阶段不匹配不能取得受信输入。
  来源：`FN-10.1 注册和执行钩子` + 系统质量属性 `Hook inputs are stage-scoped, minimal, and authority-safe` + `受信终末 Hook 在普通 Hook 后执行`、`非受信 Hook 不能请求内部作用域`
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/lifecycle-hook-trusted-terminal.test.ts`；实际结果：5 个测试通过，覆盖普通 Hook 先行、未注册隔离、非法 mutation 拒绝和私有 mutation 隔离。
- [x] 3.2 在 `agent-runtime` 实现只支持 `BEFORE_MODEL_INVOKE` 的 `TrustedTerminalLifecycleHookExecutor` 注册、materialize 分流、终末执行和合法 `messages` mutation 应用；保持通用 `HookInput` 与 plugin SDK 不变。
  来源：`Hook inputs are stage-scoped, minimal, and authority-safe` + [设计：`FN-10.1 注册和执行钩子`](design.md#fn-101-注册和执行钩子)
  验证：上述定向测试；`npm run build --workspace @nextagent/agent-runtime`、`npm run typecheck`；实际结果：全部通过。
- [x] 3.3 增加受信终末 Hook 的实际观测测试：成功、跳过、超时和异常均形成安全 `HOOK_INVOKED`；mutation 不产生 `mutationSummary`，序列化 payload 不含 Query、Owner Scope、记忆正文、记忆 ID 或模型消息。
  来源：`FN-10.1 注册和执行钩子` + 系统质量属性 `Every hook invocation produces a timeline-only observability fact` + `受信终末 mutation 不进入观测 payload`、`失败调用仍形成 Hook 观测事实`
  验证：上述定向测试；实际结果：成功、SKIP、TIMEOUT、异常均形成安全事件，payload 脱敏断言通过。

## 4. 跨 Function 集成与边界验证

- [x] 4.6 为 `user-query-memory-recall` 补齐受控诊断日志：每次 Hook 调用均通过既有 `HOOK_INVOKED` 投影记录固定结果码、L1 候选数、可用 L2 详情数、上下文准入结果和耗时；禁止记录 Query、Owner Scope、记忆 ID、记忆正文、模型消息或 mutation 值。
  来源：`Every hook invocation produces a timeline-only observability fact` + `Memory tools architecture boundaries`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/user-query-memory-recall-hook.test.ts packages/agent-memory/tests/user-query-memory-recall.test.ts packages/agent-observability/tests/timeline-observation-mapper.test.ts packages/agent-observability/tests/structured-log-projector.test.ts tests/agent-kernel/lifecycle-hook-trusted-terminal.test.ts`；实际结果：5 个文件、38 个测试通过，成功、降级、无结果、跳过和失败的安全摘要及脱敏断言通过。
- [x] 4.1 在 `agent-app` 将 `user-query-memory-recall` 受信终末 Hook 限定为首轮 `turn-1` 的 `BEFORE_MODEL_INVOKE`；移除 RequestRun attempt gateway 依赖，并以有界的 RequestRun 尝试集合验证 fallback、续写与后续 tool round 均跳过读取。
  来源：`首轮用户 Query 主动记忆召回进入最终模型输入` + [设计：跨 Function 协作与端到端流程](design.md#跨-function-协作与端到端流程)
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/user-query-memory-recall-hook.test.ts tests/agent-kernel/user-query-memory-recall-integration.test.ts` 与 `npx vitest run --config vitest.config.contract.ts tests/contract/gateway-configuration-contracts.test.ts`；实际结果：7 个 Hook/集成测试和 46 个 gateway contract 测试通过，首轮注入、fallback/tool round 跳过和 attempt gateway 移除均已断言。
- [x] 4.2 更新 Agent Core/app 集成测试：首轮模型调用可见召回消息；fallback 和 tool round 不再读取或注入；L1/L2/Hook 失败不阻断模型调用和 RequestRun terminal commit。
  来源：`首轮用户 Query 主动记忆召回进入最终模型输入` + 系统质量属性 `主动记忆召回使用最终输入预算整体降级`
  验证：上述 Hook/集成测试；实际结果：首轮模型输入包含 L2，tool round 不再注入；L1/L2 失败用例维持原模型调用路径。
- [x] 4.3 在内置 `default-agent` 定义中添加仅含 `BEFORE_MODEL_INVOKE` 的 `user-query-memory-recall` activation；默认启动配置保持 `activeAgentId=default-agent`。
  来源：[设计：跨 Function 协作与端到端流程](design.md#跨-function-协作与端到端流程)
  验证：`packages/agent-app/tests/user-query-memory-recall-agent-definition.test.ts`；实际结果：真实 loader、唯一阶段 activation 和默认 activeAgentId 断言通过。
- [x] 4.4 增加 architecture/negative 验证，阻止 Context Engine 导入 memory gateway、主动召回调用 model-facing Tool/Capability 路径、通用 Hook/plugin input 增加 Owner Scope，或受信 Hook 在普通 Hook 前执行。
  来源：`Memory tools architecture boundaries` + `Hook inputs are stage-scoped, minimal, and authority-safe`
  验证：`npm run lint:architecture` 和 `tests/architecture/user-query-memory-recall-boundary.test.ts`；实际结果：43 个 architecture 文件、258 个测试通过，其中新增 3 个负向断言通过。
- [x] 4.5 运行 OpenSpec、受影响 workspace 和仓库级门禁，确认既有 memory tools、首会话用户特征提示、普通 lifecycle Hook 和 terminal 语义不变。
  来源：proposal `Goals`、`Non-goals` + [设计：验证策略](design.md#验证策略-verification-strategy)
  验证：`openspec validate add-user-query-memory-recall --strict`、`npm run build`、`npm test`、`npm run lint:code`、`npm run lint:architecture` 均通过；`npm test` 为 142 个文件、1578 个测试通过，`lint:architecture` 为 279 个测试通过。`openspec validate --all --strict` 中本 change 通过，唯一无关失败为 `add-bash-structured-argv`；`lint:code` 仅报告 17 条既有 warning，未涉及本次文件。

## 归档前更新基线检查（非实施任务）

归档时按 [设计：长期基线刷新计划](design.md#长期基线刷新计划-baseline-promotion-plan) 合并 stable specs、Function、Feature、overview、architecture、module 和 spec-to-design-map；确认长期文档只保留归档后仍成立的事实。
