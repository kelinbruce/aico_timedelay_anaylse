# 任务

- [x] 1. 在 `agent-capability` 定义 `WorkflowSandboxExecutionPort` 接口和创建函数，public export
  - 验证: TypeScript 编译通过，public export 可从 `@nextagent/agent-capability` 导入
- [x] 2. 在 `agent-workflow` 的 `CreateWorkflowNodeCatalogOptions` 新增 `sandboxExecution` 可选字段，`executePythonNode` 优先使用新 port
  - 验证: TypeScript 编译通过，现有测试不回归
- [x] 3. 在 `agent-app` composition 中创建 `WorkflowSandboxExecutionPort` 实例并注入
  - 验证: TypeScript 编译通过，app composition 正常启动
- [x] 4. 补充测试：Python 节点使用新 port 执行脚本、不经 guardrail
  - 验证: `vitest run` 相关测试通过
- [x] 5. 补充测试：`sandboxExecution` 未注入时 fallback 到 `capabilityInvocation`
  - 验证: `vitest run` fallback 测试通过
- [x] 6. 补充测试：`python` capability 仍触发 nl2py guardrail（不回归）
  - 验证: `vitest run` guardrail 测试通过
- [x] 7. 运行 TypeScript 编译和测试验证
  - 验证: `tsc --noEmit` 和 `vitest run` 全部通过
