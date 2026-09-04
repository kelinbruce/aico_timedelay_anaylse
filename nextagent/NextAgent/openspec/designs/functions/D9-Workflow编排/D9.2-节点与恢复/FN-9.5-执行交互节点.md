# FN-9.5 执行交互节点

> 能力域 D9 Workflow 编排 · 子域 [D9.2 节点与恢复](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-9.2](../../../features/D9-Workflow编排/D9.2-节点与恢复/F-9.2-工作流节点.md) |
| spec | `workflow-interaction-nodes` |
| 接口 | 系统内部，节点处理器 |

## 描述

执行交互节点，向用户提问并桥接到运行时待确认输入生命周期；`display-content` 把安全文本/markdown 投影给客户端；`guardrail-check` 经既有 policy/hook 体系产出 `pass`/`block`；`delay-gateway` 按 `delay_time`（字符串秒）等待后继续；`interrupt-gateway` 等待外部 resume；`sub-recipe` 加载并执行子 recipe，把 `${recipe_result}` 绑定到子 recipe answer node 的 `nodeResult.output`，并在子流程完成后构建步骤记录列表写入流程上下文变量 `node_record_info`，供后续节点引用子流程执行历史。

## 前置条件

- 工作流正在执行。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 节点定义 | 是 | 交互节点定义 |
| 节点输入 | 是 | 节点输入数据 |

## 输出

节点执行结果（待确认输入及用户回答）；`sub-recipe` 节点额外产出 `node_record_info` 步骤记录数组。

## 处理过程

1. 节点处理器发起交互提问。
2. 桥接到运行时待确认输入生命周期，等待用户回答。
3. 经状态接口与运行时协作，返回结果。
4. `display-content` 校验内容为 safe text/markdown 后投影到 stream，并立即继续下游。
5. `guardrail-check` 读取 policy hook 执行检查，输出 `pass` 或 `block`；现存 `guardrail_check` 被兼容解析到标准 `guardrail-check`。
6. `delay-gateway` 把字符串 `delay_time`（秒）转为数字并乘以 1000 转毫秒，启动计时器，到时后继续下游；`AbortSignal` 立即中断。
7. `interrupt-gateway` 创建 `WORKFLOW_INTERRUPT` 等待事实，仅在外部 resume 后继续；pending input 超时 resume 时（`resumeState.answers === undefined`）防御性抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT），不创建新 pending input，由 engine exception 分支处理或终态化 `FAILED`。
8. `sub-recipe` 通过 recipe definition source `require(agentId, recipe_name)` 解析目标 recipe，按 `inputMapping` 构造子 execution 输入并递归调用 workflow execution；`recipe_name` 支持变量模板，解析失败抛 `WORKFLOW_NODE_INPUT_INVALID` 并携带 `recipeNameTemplate`、`resolvedType`、`availableVariableKeys`。
9. `sub-recipe` 把父节点 `outputs` 中 `${recipe_result}` 绑定到子 recipe answer node 的 `nodeResult.output`（map 结构），`sub_recipe_result` 绑定到子执行 summary；answer node 从 `END` 沿单前驱链反向遍历、跳过 gateway（START/END/CONDITION/PARALLEL）、取第一个非 gateway 节点；answer node 未定义或 output 缺失时回退空对象 `{}`；中间节点输出经 `outputMapping` 显式映射。
10. `sub-recipe` 把子 recipe 执行期间产生的 `WorkflowExecutionEvent` 转发给父 execution observer，事件携带子 execution 的 `executionId` 和 `nodeId`，observer 按 `executionId` 查找 recipe 定义用于轨迹还原。
11. `sub-recipe` 节点在子流程执行完成后，从 `WorkflowExecutionResult.nodeResults` 与 `RecipeDefinition.flowGraph.nodes` 构建步骤记录列表写入 `node_record_info`；按固定字段名将节点输出分类为 `inputs`/`outputs`，RESTFUL 节点提取 `api_resp_define` 为 `outputDefine`，`recipe_result` 仅在 `is_node_record_with_recipe_result=true` 或 `scene=MAE-CN` 时归入 `outputs`。

## 结果

- 正常：节点执行完成。
- 失败：安全失败。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| user-check pending input | 暂停 workflow，创建 pending input 等待用户回答，owner 为 `agent-runtime`；超时或无效回答按 `onError`/validation 失败 | `workflow-interaction-nodes`：`User Check` |
| output parser 来源与模板作用域 | 按 `node.presentation.outputParser`、`node.outputParser`、`node.outputs.output_parser` 优先级解析；模板可引用上游变量，节点自有输出和展示字段覆盖同名变量 | `workflow-interaction-nodes`：`Display Content` |
| display-content 投影 | 只投影 safe text/markdown，不得包含 raw HTML/script；消费方为 `agent-channel-web` | `workflow-interaction-nodes`：`Display Content` |
| guardrail-check | 经既有 policy/hook 产出 `pass`/`block`；现存 `guardrail_check` 兼容解析到标准 `guardrail-check` | `workflow-interaction-nodes`：`Guardrail Check` |
| delay-gateway | `inputs.delay_time` 为字符串秒，handler 转数字乘 1000 为毫秒；非正整数或负数抛 `invalidNodeInput`；`AbortSignal` 立即中断 | `workflow-interaction-nodes`：`Delay Gateway` |
| interrupt-gateway | 创建 `WORKFLOW_INTERRUPT` 等待事实，仅在外部 resume 后继续；owner 为 `agent-runtime`；超时 resume 时（`resumeState.answers === undefined`）抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT），不创建新 pending input，走 exception 分支或 `FAILED` | `workflow-interaction-nodes`：`Interrupt Gateway` |
| sub-recipe recipe_name | 继续使用 DSL 字段 `recipe_name`，经 `require(agentId, recipe_name)` 解析；支持变量模板，解析失败抛 `WORKFLOW_NODE_INPUT_INVALID` 并携带诊断字段 | `workflow-interaction-nodes`：`Sub Recipe` |
| recipe_result 绑定 | `${recipe_result}` 绑定子 recipe answer node 的 `nodeResult.output`（map 结构）；`sub_recipe_result` 绑定子执行 summary；answer node 未定义或 output 缺失回退空对象 `{}` | `workflow-interaction-nodes`：`Sub Recipe`、`Sub Recipe Answer Node Resolution` |
| answer node 解析 | 从 `END` 沿单前驱链反向遍历、跳过 gateway（START/END/CONDITION/PARALLEL）、取第一个非 gateway 节点；与父 recipe projector answer 解析同一算法 | `workflow-interaction-nodes`：`Sub Recipe Answer Node Resolution` |
| 子流程事件转发 | 子 recipe `WorkflowExecutionEvent` 转发给父 observer，携带 `executionId` 和 `nodeId`，observer 按 `executionId` 查找 recipe 用于轨迹还原 | `workflow-interaction-nodes`：`Sub Recipe Answer Node Resolution` |
| sub-recipe 步骤记录 | `node_record_info` 为步骤记录数组，每条含 `name`/`type`/`description`/`inputs`/`outputs`，RESTFUL 节点含 `outputDefine`；记录顺序与 `nodeResults` 一致 | `workflow-interaction-nodes`：`Sub Recipe Node Record Info` |
| recipe_result 归属 | `is_node_record_with_recipe_result=true` 或 `scene=MAE-CN` 时归入 `outputs`，否则过滤 | `workflow-interaction-nodes`：`Sub Recipe Node Record Info` |
