# Design: Sub Recipe Node Record Info

## Context

`executeSubRecipeNode` 当前在子流程完成后，仅产出 `sub_recipe_result`（summary）和 `recipe_result`（answer node output），以及通过 `outputMapping` 映射的变量。自定义 recipe 需要通过 `${node_record_info}` 获取子流程内部各节点的执行步骤记录。

## Data Sources

步骤记录的数据来自两个已有结构，无需新增 contract 字段：

1. `WorkflowExecutionResult.nodeResults`（`WorkflowNodeResult[]`）：提供 `nodeId`、`nodeType`、`output`
2. `RecipeDefinition.flowGraph.nodes`（`Record<string, WorkflowNodeDef>`）：提供 `description`

## Step Record Shape

```typescript
interface NodeRecordInfo {
  readonly name: string;           // nodeResult.nodeId
  readonly type: WorkflowNodeType; // nodeResult.nodeType
  readonly description?: string;   // flowGraph.nodes[nodeId].description
  readonly inputs: JsonObject;     // api_name, prompt_template
  readonly outputs: JsonObject;    // api_response, llm_completion, ... + others
  readonly outputDefine?: JsonObject; // restful only: api_resp_define
}
```

## Classification Algorithm

对每个 `nodeResult.output`（`JsonObject | undefined`）：

1. 若 `output` 为 `undefined`，`inputs = {}`，`outputs = {}`
2. 遍历 `output` 的每个 key：
   - `api_name`、`prompt_template` → `inputs`
   - `recipe_result` → 检查归属条件，满足则放入 `outputs`，否则跳过
   - 其他所有 key → `outputs`
3. 若 `nodeType === "RESTFUL"` 且 `outputs` 含 `api_resp_define`：
   - 提取为 `outputDefine`
   - 从 `outputs` 移除 `api_resp_define`

归属条件：`is_node_record_with_recipe_result === true || scene === "MAE-CN"`

## Scene Injection

`scene` 是系统部署环境标识，通过 `CreateWorkflowNodeCatalogOptions.scene?: string` 注入。`agent-app` 的 `workflow-composition.ts` 在组装 node catalog 时从 `process.env.SCENE` 读取并传入（属配置加载，不违反 agent-app 边界约束）。

## Implementation Location

- **`packages/agent-workflow/src/nodes/interaction-nodes.ts`**：`executeSubRecipeNode` 末尾调用 `buildNodeRecordInfo`，结果写入 `node_record_info` 输出变量
- **`packages/agent-workflow/src/nodes/shared.ts`**：新增 `buildNodeRecordInfo` 辅助函数和输入/输出字段分类常量
- **`packages/agent-workflow/src/nodes/types.ts`**：`CreateWorkflowNodeCatalogOptions` 新增 `scene?: string`
- **`packages/agent-app/src/composition/workflow-composition.ts`**：传入 `scene`

## What Is NOT Implemented

- **DryRun 模式**：用户确认无实际用途，舍弃。
- **parentIdNodeName**：父子任务记录关联是 `executeSubRecipe` boundary 的职责，不属于节点 handler。当前 boundary 接口不暴露任务记录更新能力，如需实现需扩展 boundary contract，不在本次范围。
- **lawyers 链表嵌套追踪**：已由 `executionMetadata.subRecipeDepth` 整数替代，等价且更简单。
- **PAUSE 恢复（appendStart）**：当前实现 WAITING 状态直接抛异常，是有意设计。
- **Options/Headers 隐式透传**：OpenSpec 要求显式 mapping，不实现隐式透传。

## Test Strategy

黑盒测试覆盖：
1. 基本步骤记录构建（多节点、顺序一致）
2. 输入/输出字段分类
3. `recipe_result` 默认过滤
4. `is_node_record_with_recipe_result=true` 时包含
5. `scene=MAE-CN` 时包含
6. restful 节点 `outputDefine` 提取
7. `nodeResult.output` 为空时 `inputs`/`outputs` 为空对象
8. `description` 从 recipe 定义获取
9. `${node_record_info}` 可被后续节点引用
