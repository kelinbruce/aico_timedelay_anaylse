## 设计决策

### D1: 提取统一 resolveNodeModelConfig 到 shared.ts

`resolveApiChoiceModelConfig`（knowledge-nodes.ts:696）和 `resolveParamExtractModelConfig`（restful-param-extract.ts:177）是同形逻辑：

1. 读 model / modelGroup
2. 如果 resolveModelForParamExtract 可用且有值 → 调用 override
3. 否则 fallback 到 resolveModelInvocationConfig / requireWorkflowModelConfig

唯一差异：api-choice 版额外合并 model_params 到 commonOptions。

**方案**：提取 `resolveNodeModelConfig(context, options, inputs)` 到 `shared.ts`，封装步骤 1-3。api-choice 的 model_params 合并在调用后由调用方追加：

```
const config = await resolveNodeModelConfig(context, options, inputs);
const modelParams = inputs.model_params;
return isRecord(modelParams)
  ? { ...config, commonOptions: { ...config.commonOptions, ...modelParams } }
  : config;
```

不把 model_params 合并放进 shared 函数，因为 model_params 是 api-choice 和 restful-param-extract 的通用需求，但合并语义（覆盖 commonOptions 的哪些字段）可能因节点而异。shared 函数只负责"解析节点级 model/modelGroup override + fallback"，model_params 合并留给调用方。

### D2: modelGroup 处理策略

当前 `resolveModelForParamExtract` adapter 忽略 `_modelGroup`，因为 `WorkflowRuntimeModelProfile` 没有 modelGroup 字段，`selectModelProfile` 只接收 request 不接收 modelGroup。

**方案**：将 modelGroup 标记为 deferred，在 adapter 中添加注释说明原因，并在 spec 中明确 modelGroup 为预留能力。理由：

- `selectModelProfile` 的签名 `(request) => profile` 不支持传入 modelGroup
- 修改 selectModelProfile 签名会影响所有 workflow 节点的模型路由，超出本 change 的修复范围
- 当前无 Recipe 使用 modelGroup（所有测试只用 model）
- modelGroup 的路由组语义需要在 canonical `model-invocation-contract` 与 Context Engine 模型选择边界上通过独立 change 定义

在 adapter 中将 `_modelGroup` 改为 `modelGroup`（去掉下划线前缀），添加注释 `// modelGroup deferred: selectModelProfile does not accept routing group`，并在 types.ts 的 JSDoc 中明确 modelGroup 为 deferred。

### D3: asNonNegativeInteger 去重

capability-nodes.ts:277 和 engine/index.ts:1307 各有一份 `asNonNegativeInteger`，实现略有不同（一个用 coerceNumber，一个直接 typeof）。

**方案**：提取到 `shared.ts`，使用 coerceNumber 版本（更健壮，能处理字符串数字）。两处改为 import shared 版本。

### D4: whitespace damage 修复

capability-nodes.ts 中 executePythonNode 和 executeAgentNode 有 2 处缩进从 2-space 被改为 1-space：

```
-  const trace = nodeTrace(context, "Python");
+ const trace = nodeTrace(context, "Python");
```

这是意外 damage，不是有意修改。直接恢复为 2-space。

### D5: restful 节点增强规格补齐

已在 `enhance-ts-workflow-api-choice-node` 中修改的 `workflow-capability-nodes/spec.md` stable spec 新增了以下内容：

- Param Extraction（fm_extract_parameter）requirement + scenarios
- Time Parameter Conversion requirement + scenarios
- API-Level Retry requirement + scenarios
- Param Extract Reflection requirement + scenarios
- 1.0 Alias Compatibility scenario

本 change 确认这些 spec 条目与实现一致，不需要额外修改 spec。但需要在 proposal 中明确这些 restful 增强属于本 change 的规格覆盖范围，而非 api-choice change 的范围。

## 与依赖 change 的边界

| 依赖 change | 本 change 的职责 | 不 owner |
|------------|----------------|---------|
| enhance-ts-workflow-api-choice-node | 修复其代码审查发现 | 不修改 api-choice 的 D1-D9 设计决策 |
| add-ts-workflow-knowledge-nodes | 复用已有的 retrieveKnowledge 机制 | 不修改检索逻辑 |
| add-ts-workflow-llm-nodes | 复用 prepareLlmPrompt + renderTemplate | 不修改模板引擎 |
| add-ts-workflow-capability-nodes | restful 节点增强规格补齐 | 不修改 capability invocation 边界 |
