## Why

当使用 `providerId=model-gateway` 时，Gateway 作为透明代理将 `modelId` 透传给后端 API。在此场景下，本地模型注册校验（`assembly.modelIds` 包含检查）是不必要的，会阻止 Workflow recipe 中 `modelId` 与已注册 `modelId` 不同时的正常执行。

此前 commit `67f7b53f0` 实现了三层 bypass：
1. `runtime-adapters.ts`：workflow 模型选择中捕获 `MODEL_ID_NOT_ELIGIBLE`，使用已注册 Gateway model catalog 配置和请求的 `modelId`
2. `assembly-authorization.ts`：当 provider 为 `model-gateway` 时跳过 `modelId` 资格检查（`assemblyRef` 检查仍强制执行）
3. `catalog-backed-model-invocation.ts`：当 `bindings.get(request.modelId)` 返回 `undefined` 时回退到第一个可用 binding，使用已注册 `modelId` 进行 catalog lookup

commit `511494b77`（`fix(release): restore full backend and agent-web validation`）回退了 `assembly-authorization.ts` 中的 bypass（第 2 层），但保留了 `catalog-backed-model-invocation.ts` 中的 fallback binding 逻辑（第 3 层）。这导致 bypass 不完整：assembly-authorization 层仍然拒绝 `model-gateway` 场景下未激活的 `modelId`，而 catalog-backed 层已经准备好了 fallback。

本 change 恢复完整的三层 bypass，使 `model-gateway` 透传行为重新生效。

## 目标与非目标

**目标：**

- 恢复 `assembly-authorization.ts` 中 `isModelGateway` bypass 分支：当 provider 为 `model-gateway` 且 `modelId` 不在 `assembly.modelIds` 中时，跳过 `MODEL_NOT_ACTIVATED` 拒绝（`assemblyRef` 检查仍强制执行）。
- 恢复 `configured-model-runtime.ts` 中向 `createAssemblyAuthorizedModelInvocationService` 传递 `modelProfiles` 的参数桥接。
- 恢复 `capability-composition.ts` 和 `create-app.ts` 中向 workflow runtime adapters 传递 `modelProfiles` 和 `modelCatalog` 的参数桥接。
- 恢复 `runtime-adapters.ts` 中 workflow 模型选择 `MODEL_ID_NOT_ELIGIBLE` 时的 Gateway fallback 逻辑。
- 同步更新基线 spec，明确 `model-gateway` provider 的透传语义。
- 同步更新受影响的测试用例。

**非目标：**

- 不改变 `catalog-backed-model-invocation.ts` 中的 fallback binding 逻辑（该层未被回退，保持现状）。
- 不改变 `openai-compatible` provider 的校验逻辑。
- 不改变 Agent Scope 的 `assemblyRef` 校验（`model-gateway` 场景下 `assemblyRef` 仍必须匹配）。
- 不改变 `ModelProviderProfile` / `ModelProfile` 的 closed schema。

## What Changes

- **MODIFIED**: `model-invocation-contract` spec 中 `Invocation preconditions are validated before provider execution` requirement 新增 `model-gateway` 透传例外场景。
- **MODIFIED**: `workflow-llm-nodes` spec 中 `Shared LLM Node Execution` requirement 新增 `model-gateway` 场景下 `MODEL_ID_NOT_ELIGIBLE` fallback 的说明。
- 恢复 `assembly-authorization.ts` 的 `isModelGateway` bypass。
- 恢复 `configured-model-runtime.ts` 的 `modelProfiles` 参数传递。
- 恢复 `runtime-adapters.ts` 的 `MODEL_ID_NOT_ELIGIBLE` Gateway fallback。
- 恢复 `capability-composition.ts` 和 `create-app.ts` 的参数桥接。
- 更新 `model-catalog.test.ts` 测试用例以适配 `model-gateway` 透传语义。

## Feature 影响

无。`model-gateway` 透传是已设计的行为，本 change 恢复其正确实现。

## Function 影响

### 修改的 Function

- `FN-4.1 调用模型` → `specs/model-invocation-contract/spec.md`
  - 功能边界：`model-gateway` provider 的 `modelId` 资格检查从"始终校验 `assembly.modelIds`"改为"`model-gateway` 场景下跳过 `modelId` 资格检查，仅校验 `assemblyRef`"。
  - 系统质量属性：安全、可维护性
  - 映射说明：canonical spec `model-invocation-contract`

- `FN-8.x Workflow LLM 节点执行` → `specs/workflow-llm-nodes/spec.md`
  - 功能边界：Workflow 模型选择在 `model-gateway` 场景下 `MODEL_ID_NOT_ELIGIBLE` 时 fallback 到已注册 Gateway model catalog 配置。
  - 系统质量属性：可靠性
  - 映射说明：canonical spec `workflow-llm-nodes`

## 影响范围

- **Agent 开发者**：使用 `model-gateway` provider 时，recipe 中的 `modelId` 可以与已注册 `modelId` 不同，Gateway 会透传。
- **公共 API**：无变化。`createAssemblyAuthorizedModelInvocationService` 新增 optional `modelProfiles` 参数，但非 breaking。
- **配置**：无变化。
- **受影响代码**：`assembly-authorization.ts`、`configured-model-runtime.ts`、`runtime-adapters.ts`、`capability-composition.ts`、`create-app.ts`。
- **受影响测试**：`model-catalog.test.ts`。
