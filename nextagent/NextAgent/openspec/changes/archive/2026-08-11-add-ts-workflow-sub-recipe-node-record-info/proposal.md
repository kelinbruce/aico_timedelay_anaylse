## 背景与问题（Why）

`sub-recipe` 节点当前在子流程执行完成后，仅通过显式 `outputMapping` 和 `recipe_result` 绑定将结果写回父流程上下文。自定义 recipe 在消费子流程执行历史时，无法获取子流程内部各节点的执行步骤记录（节点名称、类型、描述、输入/输出参数）。

电信网络运维场景中，某些自定义 recipe 需要通过 `${node_record_info}` 引用子流程的完整节点执行记录来构建历史诊断报告或审计追溯链路。当前实现不产出此变量，导致这些 recipe 无法工作。

## 变更范围（What Changes）

### node_record_info 步骤记录

`sub-recipe` 节点在子流程执行完成后，从 `childResult.nodeResults` 构建步骤记录列表，写入流程上下文变量 `node_record_info`，供后续节点通过 `${node_record_info}` 引用。

每条步骤记录包含：
- `name`：节点 ID（来自 `WorkflowNodeResult.nodeId`）
- `type`：节点类型（来自 `WorkflowNodeResult.nodeType`）
- `description`：节点描述（来自 `RecipeDefinition.flowGraph.nodes[nodeId].description`，若存在）
- `inputs`：从节点输出变量中提取的输入类固定字段（`api_name`、`prompt_template`）
- `outputs`：从节点输出变量中提取的输出类固定字段（`api_response`、`llm_completion`、`api_resp_define`、`user_check_result`）及其他非输入类字段
- `outputDefine`：仅 restful 类型节点，从 `outputs` 中提取 `api_resp_define` 并移除

### recipe_result 归属规则

`recipe_result` 默认不归入步骤记录的 `outputs`，仅在以下条件之一满足时包含：
- 节点输入参数 `is_node_record_with_recipe_result` 为 `true`（默认 `false`）
- 系统部署环境 `scene` 为 `MAE-CN`（通过 `CreateWorkflowNodeCatalogOptions.scene` 注入）

### 明确舍弃

- **DryRun 模式**：无实际用途，不实现。
- **parentIdNodeName**：父子任务记录关联是 `executeSubRecipe` boundary 关注点，不属于节点 handler 职责，本次不实现。

## Capability 影响（Capabilities）

### 修改的 Capability

- `workflow-interaction-nodes`：`Sub Recipe` requirement 扩展——新增 `node_record_info` 步骤记录产出和 `recipe_result` 归属规则。

## 影响范围（Impact）

- **agent-workflow**：`executeSubRecipeNode` 扩展——构建 `node_record_info` 步骤记录；新增 `buildNodeRecordInfo` 辅助函数；`CreateWorkflowNodeCatalogOptions` 新增 `scene?: string` 字段。
- **agent-app**：`workflow-composition.ts` 传入 `scene` 配置（从系统环境读取，属配置加载）。
- **agent-contracts**：无变更（`WorkflowNodeResult` 已有 `nodeId/nodeType/output` 字段，`RecipeDefinition.flowGraph.nodes` 已有 `description` 字段）。
- **测试**：`node_record_info` 构建测试、`is_node_record_with_recipe_result` 条件测试、`scene=MAE-CN` 条件测试、restful `outputDefine` 提取测试、`recipe_result` 过滤测试。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/workflow-interaction-nodes/spec.md`：修改，Sub Recipe requirement 新增 `node_record_info` 产出和 `recipe_result` 归属规则 scenario。

长期背景：
- `openspec/overview.md`：无（模块内行为增强，不影响系统级背景）。

设计视图：
- `openspec/designs/modules/agent-workflow.md`：修改，补充 `node_record_info` 步骤记录构建的设计注释。
- `openspec/designs/spec-to-design-map.md`：修改，新增 workflow-interaction-nodes Sub Recipe 到 module design 的导航。

验证入口：
- `packages/agent-workflow/tests/workflow-interaction-nodes.test.ts`：`node_record_info` 构建与条件过滤测试。
