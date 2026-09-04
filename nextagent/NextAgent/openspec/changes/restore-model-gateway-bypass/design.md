# Design

## 背景与目标

commit 67f7b53f0 实现了 model-gateway provider 的三层 bypass，使 Gateway 能透传未在 ssembly.modelIds 中激活的 modelId。commit 511494b77 回退了第 2 层（ssembly-authorization.ts），保留了第 3 层（catalog-backed-model-invocation.ts），导致 bypass 不完整。

本 change 恢复完整的三层 bypass。

## 当前实现

### ssembly-authorization.ts（被回退后的状态）

`	s
if (assembly.agentAssemblyRef !== request.invocationScope.agentAssemblyRef) {
  return authorizationFailure();
}
if (!assembly.modelIds.includes(request.modelId)) {
  return authorizationFailure();  // model-gateway 场景下也拒绝
}
return undefined;
`

### catalog-backed-model-invocation.ts（未被回退，保留 fallback）

`	s
let binding = bindings.get(request.modelId);
let usedFallback = false;
if (binding === undefined) {
  binding = findFallbackBinding(bindings);
  usedFallback = true;
}
`

### configured-model-runtime.ts（被回退后的状态）

`	s
createAssemblyAuthorizedModelInvocationService(hookedInvocation, options.assemblyRegistry)
// 没有传 modelProfiles
`

## 修改方案

### 1. 恢复 ssembly-authorization.ts 的 isModelGateway bypass

`	s
export function createAssemblyAuthorizedModelInvocationService(
  inner: ModelInvocationService,
  assemblyRegistry: AgentAssemblyRegistry,
  modelProfiles?: readonly ModelProviderProfile[],
): ModelInvocationService {
  const isModelGateway = Array.isArray(modelProfiles) && modelProfiles.some((p) => p.providerId === 'model-gateway');
  // ...
  if (assembly.agentAssemblyRef !== request.invocationScope.agentAssemblyRef) {
    return authorizationFailure();
  }
  // When provider is model-gateway, skip modelId eligibility check
  if (isModelGateway && !assembly.modelIds.includes(request.modelId)) {
    return undefined;
  }
  if (!assembly.modelIds.includes(request.modelId)) {
    return authorizationFailure();
  }
  return undefined;
}
`

### 2. 恢复 configured-model-runtime.ts 参数传递

`	s
createAssemblyAuthorizedModelInvocationService(hookedInvocation, options.assemblyRegistry, options.providers.profiles)
`

### 3. 恢复 
untime-adapters.ts Gateway fallback

在 
esolveModelInvocationConfig 和 
esolveModelForParamExtract 中，当 selected.failureReason === 'MODEL_ID_NOT_ELIGIBLE' 且 isModelGateway 时，使用 
esolveModelGatewayConfig fallback。

### 4. 恢复 capability-composition.ts 和 create-app.ts 参数桥接

传递 modelProfiles 和 modelCatalog 到 createWorkflowRuntimeAdapters。

## 安全约束

- ssemblyRef 校验始终强制执行，即使 model-gateway 也不跳过。
- bypass 仅影响 modelId 资格检查，不影响 invocation scope、cancellation、budget 等其他 precondition。
- 非 model-gateway provider 不受影响。
