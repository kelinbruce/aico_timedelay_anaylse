# fix-display-content-piu-object-data

## Why

Agent 开发者在 `display-content` 节点中使用 `output_parser.type=PIU` 时，上游 Python 节点输出的 JSON object 无法进入 PIU 渲染数据。节点先因 object 输出被当作单值 string 校验而失败；即使绕过该失败，`output_parser.data` 中的模板变量也缺少上游变量上下文，导致前端收到的 PIU content 缺少 `data` 字段。

这阻断了“Workflow 输出结构化数据 → PIU 渲染器”的主路径，属于可复现的黑盒行为缺陷，需要立即修复。

## 目标与非目标

**目标：**

- `display-content` 节点在 PIU 类型下可以接收上游变量中的 JSON object。
- `output_parser` 模板可以引用上游变量，并将解析后的 object 数据完整带入 `WorkflowNodeResult.output.output_parser.data`，供既有 projector 构建 PIU structured delta。
- 遵循既有 output parser 来源优先级：`node.presentation.outputParser` > `node.outputParser` > `node.outputs.output_parser`。
- 当有效 parser 的 `data` 是非空 object 且节点没有文本输入时，节点不得发出冗余文本 `NODE_OUTPUT_DELTA`。
- 保留既有 safe text / markdown 展示与 HTML 安全校验语义。

**非目标：**

- 不新增或修改 Web API、stream event、DTO 或 public contract。
- 不改变 projector 的 PIU structured delta 构建职责。
- 不改变 `output_parser` 不泄漏到下游变量的既有规则。
- 不引入 PIU 数据 schema、前端渲染器行为或通用 object 安全校验规则。

## What Changes

- **MODIFIED**: `display-content` 的 PIU object 数据处理。PIU 与 OBJECT 一样允许 object 内容；有效 parser `data` 为非空 object 时，object 作为结构化展示数据传给既有 projector，不再按 string 内容执行 HTML 安全校验。
- **MODIFIED**: `display-content` 的 `output_parser` 模板解析作用域。模板解析必须能看到上游执行变量，同时节点自有输出仍可覆盖同名变量。
- **MODIFIED**: `display-content` 的 stream 投影行为。当有效 parser `data` 是非空 object 且节点没有文本输入时，只依赖 projector 的 structured delta，不产生文本 `NODE_OUTPUT_DELTA` 或 engine 兜底文本 delta。
- **PRESERVED**: 节点输入中的文本内容优先作为 safe text / markdown 投影；存在文本输入时仍执行既有安全检查和文本 delta 投影。

## Function 影响（OpenSpec Capabilities）

### 修改的 Function

- `FN-9.5 执行交互节点` → `specs/workflow-interaction-nodes/spec.md`
  - 功能边界：`display-content` 支持 PIU object 数据、上游变量模板解析和非冗余 structured delta 投影。
  - 系统质量属性：可靠性/恢复、安全、可维护性、可测试性。
  - 映射说明：canonical spec `workflow-interaction-nodes`。

## 影响范围

- **Agent 开发者**：Recipe 中的 PIU `output_parser.data` 可引用上游变量，前端通过既有 PIU structured delta 收到完整 object。
- **前端**：无被动契约变化，继续消费既有 `TOOL_STRUCTURED_DELTA` inline payload。
- **公共 API / contract**：无新增或变更。
- **配置与运维**：无变化。
- **受影响代码**：`agent-workflow` interaction node handler、workflow engine 兜底投影逻辑及相关测试。
