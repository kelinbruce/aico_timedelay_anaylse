# Tasks

## 1. 恢复 model-gateway bypass

### 1.1 assembly-authorization bypass

- [ ] 1.1.1 恢复 createAssemblyAuthorizedModelInvocationService 的 modelProfiles optional 参数和 isModelGateway 计算。
  验证：packages/agent-model/src/invocation/assembly-authorization.ts

- [ ] 1.1.2 恢复 uthorize 函数的 isModelGateway 参数和 bypass 分支：当 isModelGateway && !assembly.modelIds.includes(request.modelId) 时返回 undefined（放行），ssemblyRef 检查仍强制执行。
  验证：同文件

### 1.2 configured-model-runtime 参数桥接

- [ ] 1.2.1 恢复 createConfiguredModelRuntime 中 createAssemblyAuthorizedModelInvocationService 调用时传入 options.providers.profiles。
  验证：packages/agent-model/src/runtime/configured-model-runtime.ts

### 1.3 workflow runtime-adapters Gateway fallback

- [ ] 1.3.1 恢复 WorkflowRuntimeAdaptersOptions 中 modelProfiles 和 modelCatalog optional 字段。
  验证：packages/agent-workflow/src/runtime-adapters.ts

- [ ] 1.3.2 恢复 createWorkflowRuntimeAdapters 中 isModelGateway 计算和 MODEL_ID_NOT_ELIGIBLE 时的 
esolveModelGatewayConfig fallback。
  验证：同文件

### 1.4 capability-composition 和 create-app 参数桥接

- [ ] 1.4.1 恢复 composeCapabilityLayer 中 modelCatalog 参数和向 createWorkflowRuntimeAdapters 传递 modelProfiles + modelCatalog。
  验证：packages/agent-app/src/composition/capability-composition.ts

- [ ] 1.4.2 恢复 composeNextAgentApp 中向 composeCapabilityLayer 传递 modelCatalog。
  验证：packages/agent-app/src/composition/create-app.ts

## 2. 基线 spec 更新

### 2.1 model-invocation-contract spec

- [ ] 2.1.1 在 Invocation preconditions are validated before provider execution requirement 中新增 model-gateway 透传例外场景：当 provider 为 model-gateway 时，modelId 资格检查可被跳过，但 ssemblyRef 校验仍强制执行。
  验证：openspec/specs/model-invocation-contract/spec.md

### 2.2 workflow-llm-nodes spec

- [ ] 2.2.1 在 Shared LLM Node Execution requirement 中新增 model-gateway 场景下 MODEL_ID_NOT_ELIGIBLE fallback 说明。
  验证：openspec/specs/workflow-llm-nodes/spec.md

## 3. 测试同步

### 3.1 model-catalog 测试

- [ ] 3.1.1 更新 locks a configured but non-activated model before hooks and provider execution 测试：model-gateway 场景下未激活 modelId 不再返回 MODEL_NOT_ACTIVATED，而是放行给 provider 执行。
  验证：packages/agent-model/tests/model-catalog.test.ts

- [ ] 3.1.2 新增 model-gateway bypasses modelId eligibility for non-activated model 测试：断言 model-gateway 场景下未激活 modelId 能通过 authorization，ssemblyRef 不匹配时仍返回 MODEL_NOT_ACTIVATED。
  验证：同文件
