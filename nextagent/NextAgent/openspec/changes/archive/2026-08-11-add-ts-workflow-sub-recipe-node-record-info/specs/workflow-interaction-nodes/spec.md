## ADDED Requirements

### Requirement: Sub Recipe Node Record Info

`sub-recipe` MUST 在子流程执行完成后，从子执行结果中构建步骤记录列表，写入流程上下文变量 `node_record_info`，供后续节点通过 `${node_record_info}` 引用。

**触发机制：**
- 子流程执行完成且状态为 `COMPLETED` 后触发

**输入与前置条件：**
- 子流程已执行完成
- `childResult.nodeResults` 可用

**输出与副作用：**
- `node_record_info`：步骤记录数组，每条记录包含 `name`、`type`、`description`、`inputs`、`outputs`、`outputDefine`

**核心判断逻辑：**
1. 遍历 `childResult.nodeResults`，对每个节点结果构建一条步骤记录
2. `name` 取 `nodeResult.nodeId`
3. `type` 取 `nodeResult.nodeType`
4. `description` 从 `RecipeDefinition.flowGraph.nodes[nodeId].description` 获取（若存在）
5. 从 `nodeResult.output` 中按固定字段名分类为 `inputs` 和 `outputs`
6. `recipe_result` 按归属规则决定是否包含在 `outputs` 中
7. restful 类型节点从 `outputs` 提取 `api_resp_define` 为 `outputDefine`，并从 `outputs` 移除

**输入/输出变量分类规则：**
- 输入参数固定字段：`api_name`、`prompt_template` → 归入 `inputs`
- 输出参数固定字段：`api_response`、`llm_completion`、`api_resp_define`、`user_check_result` → 归入 `outputs`
- 其他非输入类字段 → 归入 `outputs`

**`recipe_result` 归属规则：**
- `is_node_record_with_recipe_result` 为 `true` → 归入 `outputs`
- 系统部署环境 `scene` 为 `MAE-CN` → 归入 `outputs`
- 以上都不满足 → 不归入 `outputs`（被过滤掉）

**`is_node_record_with_recipe_result`：**
- 布尔类型节点输入参数，默认 `false`
- 当值为 `true` 时，`recipe_result` 被包含在步骤记录的 `outputs` 中

**状态 / 产物契约：**
- `node_record_info` 是只读步骤记录数组，不得被后续节点修改
- 步骤记录中的变量值来自子流程节点执行结果，不得包含未执行的节点

**流程接入：**
- 上游：`sub-recipe` 节点自身产出
- 下游：任意后续节点通过 `${node_record_info}` 引用

**失败与降级：**
- 子流程失败时，`executeSubRecipeNode` 已在 `node_record_info` 构建前抛出异常，不产出 `node_record_info`
- `nodeResult.output` 为 `undefined` 时，该节点步骤记录的 `inputs` 和 `outputs` 为空对象

#### Scenario: Build Node Record Info From Child Node Results
- **GIVEN** 子流程执行完成，`childResult.nodeResults` 包含多个节点结果
- **WHEN** `sub-recipe` 节点构建步骤记录
- **THEN** `node_record_info` MUST 为数组，每条记录包含 `name`、`type`、`description`、`inputs`、`outputs`
- **AND** 记录顺序 MUST 与 `nodeResults` 顺序一致

#### Scenario: Classify Input And Output Fields
- **WHEN** 节点输出变量包含 `api_name`、`prompt_template`、`api_response`、`llm_completion`
- **THEN** `api_name`、`prompt_template` MUST 归入 `inputs`
- **AND** `api_response`、`llm_completion` MUST 归入 `outputs`

#### Scenario: Filter Recipe Result By Default
- **GIVEN** `is_node_record_with_recipe_result` 未设置或为 `false`，且 `scene` 不为 `MAE-CN`
- **WHEN** 节点输出变量包含 `recipe_result`
- **THEN** `recipe_result` MUST NOT 出现在步骤记录的 `inputs` 或 `outputs` 中

#### Scenario: Include Recipe Result When Flag Enabled
- **GIVEN** `is_node_record_with_recipe_result` 为 `true`
- **WHEN** 节点输出变量包含 `recipe_result`
- **THEN** `recipe_result` MUST 归入步骤记录的 `outputs`

#### Scenario: Include Recipe Result When Scene Is MAE-CN
- **GIVEN** 系统部署环境 `scene` 为 `MAE-CN`
- **WHEN** 节点输出变量包含 `recipe_result`
- **THEN** `recipe_result` MUST 归入步骤记录的 `outputs`

#### Scenario: Extract OutputDefine For Restful Node
- **GIVEN** 节点类型为 `RESTFUL`，节点输出变量包含 `api_resp_define`
- **WHEN** 构建步骤记录
- **THEN** `api_resp_define` MUST 被提取为 `outputDefine` 字段
- **AND** `outputs` MUST NOT 包含 `api_resp_define`

#### Scenario: Empty Output When Node Result Has No Output
- **GIVEN** `nodeResult.output` 为 `undefined`
- **WHEN** 构建步骤记录
- **THEN** `inputs` MUST 为空对象 `{}`
- **AND** `outputs` MUST 为空对象 `{}`
