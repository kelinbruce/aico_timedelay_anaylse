## 0. 前置确认

- [x] 0.1 确认 `refine-ts-workflow-execution-engine-v2` 的 controlPolicy 解析（2.1/2.2）已合入或在本 change 内一并实现
  验证：`git log` 或代码检查 `resolveControlPolicy` 是否存在
  来源：design D5 前置依赖

## 1. 契约扩展

- [x] 1.1 `WorkflowNodeDefSchema` 新增 `loopConfig` 可选字段（loopId/loopCardinality/loopCompletionCondition/loopInputDataItem/loopElementVariable/loopTimeCycle/loopEndNode/loopStartNode/loopResultVariable/loopResultType/loopResultKey/loopResultValue）
  验证：`npm run test:contract`
  来源：design D7 / spec Multi-Node Loop Execution
- [x] 1.2 `WorkflowExecutionResumeState` 新增 `loopContext` 可选字段
  验证：`npm run test:contract`
  来源：design D13 / spec Multi-Node Loop Execution
- [x] 1.3 新增 `WorkflowLoopContext` interface（loopId/iteration/elementIndex/collectedResults）
  验证：`npm run test:contract`
  来源：design D13
- [x] 1.4 `WorkflowExecutionService.execute` 的 `runtime` 参数新增 `saveCheckpoint` 回调类型
  验证：`npm run build`
  来源：design D1 / spec Workflow Checkpoint Persistence

- [x] 1.5 `normalizeNodeDefinition` 新增 `loop_config`→`loopConfig` snake_case normalize（13 个子字段）
  验证：`npm test` + YAML snake_case 加载测试
  来源：design D6A
- [x] 1.6 `normalizeRecipeDefinition` 补 `runtime` normalize（`control_policy`→`controlPolicy`、`default_retry`→`defaultRetry`）
  验证：`npm test` + runtime snake_case 加载测试
  来源：design D6A 既有缺口
## 2. Checkpoint 持久化

- [x] 2.1 `executePath` 在非 gateway 节点完成后、transition 求值前调用 `saveCheckpoint`
  验证：`npm test` + checkpoint 写入测试
  来源：design D3 / spec Workflow Checkpoint Persistence
- [x] 2.2 checkpoint resume state 含 nodeId/nodeType/recipeName/variables，循环内含 loopContext（由回调写入 context.flowVariables.workflowExecutionState，runtime 落 CheckpointRecord.flowVariables）
  验证：`npm test` + payload 内容断言
  来源：design D2 / spec Workflow Checkpoint Persistence
- [x] 2.3 checkpoint 写入失败不阻塞，记录 `WORKFLOW_CHECKPOINT_WRITE_FAILED` 事件
  验证：`npm test` + 失败降级测试
  来源：design D3 / spec Workflow Checkpoint Persistence
- [x] 2.4 gateway 节点不写 checkpoint
  验证：`npm test`
  来源：design D3 / spec Workflow Checkpoint Persistence

## 3. Resume 恢复

- [x] 3.1 `parseWorkflowResumeState` 解析 `loopContext`
  验证：`npm test`
  来源：design D4 D13 / spec Resume From Checkpoint
- [x] 3.1a `default-agent.readWorkflowResumeState` 扩展解析 `workflowExecutionState.loopContext` 子字段，构造含 `loopContext` 的 `WorkflowExecutionResumeState`
  验证：`npm test` + flowVariables resume 测试
  来源：design D2 D4 / spec Resume From Checkpoint
- [x] 3.2 resume 从 `resumeState.nodeId` 继续，使用 `resumeState.variables`
  验证：`npm test` + resume 测试
  来源：design D4 / spec Resume From Checkpoint
- [x] 3.3 engine `execute` 消费 `request.resumeState` 时校验 `resumeState.recipeName` 与当前 recipe 一致，不一致抛 `WORKFLOW_RESUME_RECIPE_MISMATCH`；default-agent `readWorkflowResumeState` 读取内部 checkpoint 时 recipeName 不匹配视为陈旧记录静默忽略（从 START 启动）
  验证：`npm test` + mismatch 报错测试
  来源：design D4 / spec Resume From Checkpoint
- [x] 3.4 resume 含 `loopContext` 时恢复循环上下文
  验证：`npm test` + 循环 resume 测试
  来源：design D12 / spec Resume From Checkpoint

## 4. ControlPolicy 回滚

- [x] 4.1 `resolveControlPolicy` 在节点失败时解析 `runtime.controlPolicy`
  验证：`npm test`
  来源：design D5 / spec ControlPolicy Rollback Execution
- [x] 4.2 `STOP` 终止流程，`CONTINUE` 跳过继续，`RESTART` 从 START 重跑
  验证：`npm test` + 各策略测试
  来源：design D5 / spec ControlPolicy Rollback Execution
- [x] 4.3 `ROLLBACK_THEN_CONTINUE`/`ROLLBACK_THEN_RESTART`/`ROLLBACK_THEN_STOP` 执行 rollbackNode 子路径
  验证：`npm test` + 回滚测试
  来源：design D5 D6 / spec ControlPolicy Rollback Execution
- [x] 4.4 回滚路径通过 `executePath`（stopBeforeNodeId=失败节点），结果合并到 scope
  验证：`npm test`
  来源：design D6 / spec ControlPolicy Rollback Execution
- [x] 4.5 回滚路径不写 checkpoint，回滚失败抛 `WORKFLOW_ROLLBACK_FAILED` 不递归
  验证：`npm test` + 回滚失败测试
  来源：design D6 / spec ControlPolicy Rollback Execution
- [x] 4.6 无 controlPolicy 时默认 STOP
  验证：`npm test`
  来源：design D5 / spec ControlPolicy Rollback Execution

## 5. 多节点循环（loop）

- [x] 5.1 新建 `executeLoopPath`，封装循环 while + 计数 + 条件求值 + 元素注入 + 结果收集
  验证：`npm test` + 循环执行测试
  来源：design D8 D9 / spec Multi-Node Loop Execution
- [x] 5.2 `executePath` 检测循环尾节点 `loopConfig` 后委托 `executeLoopPath`
  验证：`npm test`
  来源：design D8 / spec Multi-Node Loop Execution
- [x] 5.3 `loopCardinality` 固定次数循环
  验证：`npm test`
  来源：design D8 D9 / spec Multi-Node Loop Execution
- [x] 5.4 `loopInputDataItem` 数组遍历循环 + `loopElementVariable` 元素注入
  验证：`npm test`
  来源：design D8 / spec Multi-Node Loop Execution
- [x] 5.5 `loopCompletionCondition` 条件求值结束循环（复用 `evaluateBranchCondition`）
  验证：`npm test`
  来源：design D8 D9 / spec Multi-Node Loop Execution
- [x] 5.6 `loopTimeCycle` 循环间隔等待（可中断）
  验证：`npm test`
  来源：design D8 / spec Multi-Node Loop Execution
- [x] 5.7 `loopResultType` List/Map 结果收集 + `loopResultKey`/`loopResultValue` 解析
  验证：`npm test` + append/map 合并测试
  来源：design D10 / spec Multi-Node Loop Execution
- [x] 5.8 循环防死循环（无配置默认 1 次，有条件无上限兜底 1000 次）
  验证：`npm test`
  来源：design D11 / spec Multi-Node Loop Execution
- [x] 5.9 循环中断后 checkpoint 含 `loopContext`，resume 恢复循环
  验证：`npm test` + 循环 resume 测试
  来源：design D12 / spec Multi-Node Loop Execution

## 6. Loader 校验

- [x] 6.1 `loopConfig.loopCardinality` > 1000 时 loader 拒绝
  验证：`npm test`
  来源：design D7 D11
- [x] 6.2 `loopConfig.loopStartNode` 不存在时 loader 拒绝
  验证：`npm test`
  来源：design D7 / spec Multi-Node Loop Execution
- [x] 6.3 `loopConfig.loopEndNode` 必须等于配置节点自身 id
  验证：`npm test`
  来源：design D7 / spec Multi-Node Loop Execution

- [x] 6.4 loader 检测旧 `loop` 子配置时发 deprecation warning 并忽略（不报错）
  验证：`npm test` + 旧格式兼容测试
  来源：design D14

## 7. 桥接与 composition

- [x] 7.1 `default-agent.ts` `executeRecipeRoute` 注入 `saveCheckpoint` 桥接（通过 runtime 参数）
  验证：`npm test` + 集成测试
  来源：design D1 / spec Workflow Checkpoint Persistence
- [x] 7.2 `saveCheckpoint` 桥接把 resume state 写入 `context.flowVariables.workflowExecutionState` 后调 `runState.saveCheckpoint(run, context, "STEP_STARTED")`，纯复用 runtime checkpoint 路径（engine 不构造 CheckpointRecord）
  验证：`npm test`
  来源：design D2 / spec Workflow Checkpoint Persistence

## 8. 收尾

- [x] 8.1 `npm run build && npm test && npm run test:contract && npm run lint:architecture`
  验证：全部通过
- [x] 8.2 `openspec validate --strict`
  验证：通过
- [x] 8.3 Code review
  验证：`$nextagent-code-review` PASS

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 处理：

- 同步 `openspec/specs/workflow-execution-engine/spec.md`（新增 checkpoint/resume/controlPolicy/loop requirement）。
- 按需更新 `openspec/designs/modules/agent-workflow.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。