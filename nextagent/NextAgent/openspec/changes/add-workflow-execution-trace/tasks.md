## 1. 配置层

- [ ] 1.1 在 `agent-app/config/component-config.ts` 新增 optional `workflowTrace?: { readonly enabled: boolean }` 到 `DefaultSystemConfig` 和 `RawDefaultSystemConfig`；在 `validation.ts` 新增对应 optional TypeBox schema；默认不存在等价 `enabled: false`。
  来源：FN-9.1 执行工作流 + Requirement `workflow execution trace 默认关闭且可配置开关`
  验证：运行 `npm run build` 和 config validation tests；预期未配置时 `enabled` 为 `false`。

## 2. Trace Collector 和 Boundary Wrapper

- [ ] 2.1 在 `agent-plugin-sdk` 新增 `workflow-trace-collector.ts`，实现 `WorkflowTraceCollector`（`WorkflowExecutionObserver`），按判断顺序处理事件：`nodeExecutionId` 为 undefined 跳过 → `NODE_STARTED` 暂存 → `NODE_COMPLETED`/`NODE_FAILED` 配对计算 `durationMs` 并输出 `artifactType: workflow-node-trace`（含 inputKeys/outputKeys） → 孤立终态跳过 → `emitEvent` 异常不传播。暂存条目在终态后清除。
  来源：FN-9.1 执行工作流 + Requirement `节点级 trace 通过 observer 捕获输入输出和耗时` + 全部 Scenarios
  验证：运行 SDK 定向测试；预期事件配对、durationMs 计算、inputKeys/outputKeys 提取、脚手架过滤、孤立终态跳过、暂存清理、caller observer 不受影响均通过。

- [ ] 2.2 在 `agent-plugin-sdk/workflow-trace-collector.ts` 实现通用 `createTimingWrappedService(original, sink, boundaryType, methodNames)` 工厂，按判断顺序：记录 `startedAt` → 调用原方法 → 成功 emit `SUCCEEDED` → 异常 emit `FAILED` 后重抛 → emit 异常不传播。分别用于 model（`complete`/`stream`，`MODEL`）、capability（`invoke`，`API`）、sandbox（`runPython`，`PYTHON`）。
  来源：FN-9.1 执行工作流 + Requirement `三方调用级 trace 通过 service wrapper 捕获耗时` + 全部 Scenarios
  验证：运行 SDK 定向测试；预期 MODEL/API/PYTHON boundary trace、失败 trace、原 service 行为不变、emit 异常不传播均通过。

## 3. Composition 接线

- [ ] 3.1 在 `agent-app/composition/workflow-composition.ts` 的 `composeWorkflowExecutionLayer` 中，新增入参 `developerDiagnosticArtifactWriter`；根据 `systemConfig.workflowTrace?.enabled` 和 writer 可用性决定是否创建 trace：`enabled: false` 或 writer 为 undefined → 返回原始 service；`enabled: true` 且 writer 可用 → 创建 trace sink（内联 `writer.emit({ ...input, pluginId: 'workflow-trace' })`）和 collector，包装 model/capability/sandbox service 注入 `createWorkflowNodeCatalog`，返回 `WorkflowExecutionService` wrapper。
  来源：FN-9.1 执行工作流 + Requirement `workflow execution trace 默认关闭且可配置开关` + Requirement `workflow trace 通过 developer diagnostic artifact 输出` + Scenario `writer 不可用时跳过 trace`
  验证：运行 composition tests；预期 `enabled: true` + writer 可用时创建 collector 和 wrapped service，`enabled: false` 或 writer 不可用时不创建。

- [ ] 3.2 在 `agent-app/composition/workflow-composition.ts` 实现 `WorkflowExecutionService` wrapper，`execute()` 内 composite trace collector 和 caller observer（先调 collector 再调 caller，`registerExecutionRecipe` 透传，collector emit 异常不传播）；传给原始 service。
  来源：FN-9.1 执行工作流 + Requirement `节点级 trace 通过 observer 捕获输入输出和耗时` + Scenario `trace collector 与 caller observer 同时收到 event`
  验证：运行 composition tests；预期 composite observer 同时分发给 collector 和 caller observer。

- [ ] 3.3 在 `agent-app/composition/create-app.ts` 调用 `composeWorkflowExecutionLayer` 时传入 `developerDiagnosticArtifactWriter`。
  来源：design `修改方案` 第 4 步
  验证：运行 composition tests；预期 writer 被正确传入。

## 4. Viewer

- [ ] 4.1 在 `agent-plugin-sdk/assets/` 新增 `workflow-trace-viewer.html`，加载 NDJSON 文件，过滤 `pluginId` 为 `workflow-trace` 的记录，按 `(sessionId, requestId)` 聚合，展示节点轨迹和边界调用耗时；通过 `recordedAt` 时间戳落在节点 `startedAt`/`completedAt` 区间内关联；不依赖网络、不写持久存储、字符串作为文本显示、非法行降级报告。
  来源：FN-9.1 执行工作流 + Requirement `workflow trace viewer 离线查看 trace 数据` + 全部 Scenarios
  验证：运行 viewer tests；预期 NDJSON 加载、按 session/request 聚合、节点和 boundary 展示、XSS 防护、非法行降级均通过。

## 5. 安全与验证

- [ ] 5.1 编写安全 tests 断言 trace payload 不含 `prompt`/`messages`/`rawModelOutput`/`capabilityResult`/`secret`/`path` 字段，inputKeys 只含字段名不含值；断言 emit 异常不传播给 workflow。
  来源：FN-9.1 执行工作流 + Requirement `workflow trace 不影响执行安全` + 全部 Scenarios
  验证：运行安全 tests；预期全部断言通过。

- [ ] 5.2 编写 architecture tests 断言只有 `composeWorkflowExecutionLayer` 直接调用 `writer.emit()` 并设置 `pluginId: 'workflow-trace'`，其他路径仍走 `developerDiagnosticsForPlugin(pluginId)` scoped sink；断言 `agent-workflow` engine 和 node handler 源码不被修改。
  来源：design `pluginId 受控例外` + design `验证策略`
  验证：运行 architecture tests；预期断言通过。

- [ ] 5.3 执行 `openspec validate add-workflow-execution-trace --strict` 和 `$nextagent-skill-review`，确认 Function/spec 映射、delta operation、owner、public contract 确认和唯一实施路径无阻塞项。
  来源：全部 Functions，design `验证策略`
  验证：命令通过，审查结论为 PASS。

- [ ] 5.4 执行受影响 package 测试、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict` 与 `git diff --check`，并确认既有 `docs/issues/` 未进入 change。
  来源：全部 Functions，design `验证策略`
  验证：全部门禁通过；若存在基线失败，必须给出可重复证据且不得勾选受影响任务。


