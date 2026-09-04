# workflow-knowledge-nodes Specification Delta

## MODIFIED Requirements

### Requirement: API Choice Model Routing Dedup

`api-choice` 节点的模型配置解析 MUST 复用 shared `resolveNodeModelConfig` 函数，与 `restful` 节点参数提取的模型配置解析保持同形同策。

**触发机制：**
- api-choice 节点执行 LLM 选择时触发
- 属于节点内模型调用阶段

**输入与前置条件：**
- 可选 `model` — 节点级模型名称覆盖
- 可选 `modelGroup` — 节点级模型路由组（deferred，当前不生效）
- 可选 `model_params` — 模型扩展参数，全量透传
- `resolveModelForParamExtract` 或 `resolveModelInvocationConfig` 可用

**核心判断逻辑：**
1. 通过 shared `resolveNodeModelConfig` 解析 model/modelGroup override + fallback
2. 若 `model_params` 非空，合并到 `commonOptions`（节点级覆盖全局）
3. 使用最终配置调用大模型

**输出与副作用：**
- 模型调用使用合并后的配置
- 不产生独立模型配置产物

**失败与降级：**
- `resolveModelForParamExtract` 不可用 → fallback 到 `resolveModelInvocationConfig`
- modelGroup 为 deferred：有值但 model 为空时，fallback 到全局配置，不报错

#### Scenario: Model Config Shared Resolution
- **WHEN** api-choice 节点和 restful 参数提取都配置了 model
- **THEN** 两者 MUST 通过同一个 shared 函数解析模型配置
- **AND** 行为一致

#### Scenario: model_params Merge
- **WHEN** api-choice 节点配置了 model_params
- **THEN** model_params MUST 合并到 commonOptions
- **AND** 节点级覆盖全局配置

#### Scenario: modelGroup Deferred
- **WHEN** 节点配置了 modelGroup 但没有 model
- **THEN** 实现 MUST fallback 到全局配置
- **AND** 不得报错或中断流程