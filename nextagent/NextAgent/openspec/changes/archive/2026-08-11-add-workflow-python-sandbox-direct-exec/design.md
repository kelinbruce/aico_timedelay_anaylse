# 设计

## 设计约束

- `agent-capability` 拥有 sandbox 执行边界（`SandboxExecutionPort`），其他 package 不得直接持有或调用。
- `guardrail-gateway` spec 规定 nl2py 检查 MUST 只对 `python` capability 生效。
- `workflow-capability-nodes` spec 规定 Python 节点 "通过 sandbox gateway 执行完整脚本"。
- `extension-registration` spec 规定 sandbox filesystem preparation、Python temp script preparation 是 capability-owned semantics。
- sandbox gateway 继续拥有可执行文件授权、文件系统策略、进程创建、超时、取消和 safe error mapping。
- risk policy 在 sandbox 执行路径上继续生效。

## 方案

### 新增 WorkflowSandboxExecutionPort

`agent-contracts/capability` 定义窄 port 接口（与 `CapabilityInvocationPort`、`ToolExecutionContext` 同层），`agent-capability` 通过 public export 暴露并提供建工厂：

```typescript
// 定义在 agent-contracts/capability
export interface WorkflowSandboxExecutionPort {
  runPython(input: WorkflowSandboxExecutionInput, context: ToolExecutionContext, signal?: AbortSignal): Promise<JsonObject>;
}
```

该 port 内部复用 `createWorkspaceBackedSandboxExecutionPort` 创建的 `SandboxExecutionPort.runPython`，不经 guardrail、不经 capability executor。context 复用 `agent-contracts/capability` 已有的 `ToolExecutionContext`，避免平行类型。`agent-capability` 的 `createWorkflowSandboxExecutionPort` factory 负责 port 实例创建，`agent-app` 在 composition 时调用 factory 创建实例并注入到 `createWorkflowNodeCatalog`。

### executePythonNode 改用新 port

`CreateWorkflowNodeCatalogOptions` 新增可选字段 `sandboxExecution?: WorkflowSandboxExecutionPort`。`executePythonNode` 优先使用 `sandboxExecution`，fallback 到 `capabilityInvocation`。

### agent-app composition 注入

`agent-app` 在 `composeWorkflowExecutionLayer` 中创建 `WorkflowSandboxExecutionPort` 实例并传入 `createWorkflowNodeCatalog`。

## 为什么这是长期方案

Python 节点的脚本来自 recipe 作者预定义，不是 LLM 动态生成。nl2py guardrail 的设计目标是拦截 LLM 生成的不可信代码。把预定义脚本和动态代码走同一条 guardrail 路径，既不符合 spec 意图（"MUST 只对 python capability 生效"），又在 guardrail 服务不可用时阻断正常业务流程。

通过 `agent-capability` 暴露窄 port 的方式，保持了 sandbox 归 capability 所有的架构边界，同时让 Workflow Python 节点走正确的执行路径。

## 兼容性

- `sandboxExecution` 未注入时，`executePythonNode` fallback 到现有 `capabilityInvocation` 路径，行为不变。
- `python` capability 的 guardrail 检查逻辑不变。
- sandbox gateway 的授权策略、文件系统策略和 safe error mapping 不变。
- risk policy 在 sandbox 执行路径上继续生效。

## 验证策略

- Python 节点执行预定义脚本时不触发 nl2py guardrail。
- `python` capability 执行 LLM 动态代码时仍触发 nl2py guardrail。
- `sandboxExecution` 未注入时 fallback 行为与当前一致。
- sandbox denial / timeout 仍正确返回安全错误。
