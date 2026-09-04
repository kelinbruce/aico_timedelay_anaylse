# fix-display-content-piu-object-data design

## 设计范围

| Function | 目标变化 | Delta specs | Function 设计章节 |
|---|---|---|---|
| `FN-9.5 执行交互节点` | `display-content` 支持 PIU object 数据、上游变量模板解析、非冗余 structured delta 投影，并保持 safe text 语义 | `workflow-interaction-nodes` | [FN-9.5 执行交互节点](#fn-95-执行交互节点) |

## FN-9.5 执行交互节点

### 目标与规范依据

`display-content` 必须在 PIU 场景下把上游 object 数据解析到有效 `output_parser.data`，并交给既有 structured delta projector；无文本输入时不产生冗余文本 delta。文本输入存在时，继续沿用 safe text / markdown 投影与 HTML 安全校验。

本 Function 的目标 Requirements：

- canonical spec：`workflow-interaction-nodes`
- `MODIFIED Display Content`

### 当前实现

- `executeDisplayContentNode` 只从 `node.outputs.output_parser` 的解析结果判断 object `data`，未统一使用 `node.presentation.outputParser` / `node.outputParser` / `node.outputs.output_parser` 的优先级。
- `displayBindings` 未包含上游变量，导致 `output_parser.data` 中的模板无法引用上游 object。
- `resolveDisplayContent` 只允许 `OBJECT` 直接返回 object，PIU object 输入会进入 string 校验并失败。
- handler 和 engine 兜底都可能在 object `data` 场景下发出冗余文本 `NODE_OUTPUT_DELTA`。

### GAP 分析

- PIU object 数据被 string 校验拒绝，无法到达 projector。
- parser 来源优先级未统一，`node.outputParser` 或 `presentation.outputParser` 场景可能仍产生文本 delta。
- `output_parser` 模板缺少上游变量作用域。
- 无文本输入时的 object data 展示与文本展示路径未分层，可能产生冗余文本 delta，也可能在文本输入存在时跳过必要的安全检查。

### 修改方案

1. 在 `agent-workflow` 中抽取唯一的 effective output parser 解析函数，按 `presentation.outputParser`、`node.outputParser`、`outputs.output_parser` 顺序选择第一个 object。
2. 在节点执行开始处用上游 `context.variables` 解析 effective parser 模板；节点自有 output 与展示结果仍优先覆盖同名变量。
3. PIU 与 OBJECT 一样允许 object 内容；但文本输入存在时优先投影文本，并执行既有字符串 HTML 安全校验。
4. 只有“object `data` 存在且没有文本输入”时抑制 handler 文本 delta；engine 兜底基于 projected `output_parser` 使用同一判断，避免第二套语义。
5. `projectNodeOutputs` 继续负责把解析后的 `output_parser` 写入 node output；projector 继续唯一拥有 PIU structured delta 构建职责。

质量属性影响：

- 安全：文本输入继续执行既有 HTML 安全校验；object data 不做字符串化 HTML 检查，避免把结构化数据伪装成文本。
- 可靠性/恢复：PIU object 数据不再因类型校验失败阻断 workflow。
- 可测试性：用黑盒 workflow execution 测试覆盖三种 parser 来源、上游变量、无文本 delta 和文本输入安全路径。

## 跨 Function 协作与端到端流程

`FN-9.5 执行交互节点` 产出 resolved `output_parser` 后，由既有 `FN-9.1 执行工作流` 的 workflow runtime event projector 构建 `TOOL_STRUCTURED_DELTA`。本 change 不修改 projector 或跨 Function contract，只保证 display-content 产出的数据满足该既有输入。

## 验证策略

- **行为验证**：`agent-workflow` workflow execution tests 覆盖 PIU object 不抛 `WORKFLOW_NODE_INPUT_INVALID`、`output_parser.data.data` 解析为上游 object、无文本输入时不产生 `NODE_OUTPUT_DELTA`。
- **来源优先级验证**：分别覆盖 `node.outputParser` 和 `node.presentation.outputParser`，断言解析后的 parser 数据进入 node output，且不产生冗余文本 delta。
- **安全验证**：保留 unsafe HTML 的既有 negative test，并新增 object data + 文本输入场景，断言文本输入仍走 HTML 安全校验。
- **架构验证**：运行 `npm run lint:architecture`，确认未引入跨 package private path 或新 contract。
- **整体验证**：运行 focused workflow tests、`npm run build`、`npm test`、`npm run test:contract` 和 `openspec validate --all --strict`。

## 长期基线刷新计划

- stable spec：归档前更新 `openspec/specs/workflow-interaction-nodes/spec.md`。
- Function：归档前更新 `openspec/designs/functions/D9-Workflow编排/D9.2-节点与恢复/FN-9.5-执行交互节点.md`。
- Feature / overview / architecture / modules / ADR / spec-to-design-map：无新增 owner 或架构变化，无需更新。

## 风险与取舍

- 抽取 effective parser 解析函数会轻微扩大触达范围，但可消除三处读取逻辑的平行语义，是避免来源优先级缺陷的最小闭环。
- engine 兜底判断必须与 handler 使用同一 helper，否则会再次产生冗余 delta；测试同时覆盖 handler 和 engine 两条路径。
- object data 不执行字符串 HTML 检查是刻意分层：structured delta 的安全检查仍由既有 structured delta safety 路径承担，本 change 不扩大其契约。

## 待确认问题

无。
