## 所属 Function

- `FN-9.5 执行交互节点`

## Function 变更类型

- 修改

## spec 角色

- 主规格

## MODIFIED Requirements

### Requirement: Display Content

`display-content` MUST 将安全文本内容投影给用户，并立即继续下游。

节点 MUST 按既有优先级解析 output parser 来源：`node.presentation.outputParser`、`node.outputParser`、`node.outputs.output_parser`。解析 `output_parser` 模板时，节点 MUST 能引用当前 workflow 上游变量，同时节点自有输出和自有展示字段 MUST 能覆盖同名上游变量。

当有效 output parser 的 `data` 是非空 object 时，`display-content` MUST 保留该 object 数据供既有 projector 构建 structured delta，MUST NOT 把该 object 当作单值 string 输出校验失败，也 MUST NOT 对该 object 数据执行字符串 HTML 安全校验。

当有效 output parser 的 `data` 是非空 object 且节点没有可投影文本输入时，`display-content` MUST NOT 发出冗余文本 `NODE_OUTPUT_DELTA`；workflow engine MUST NOT 为该节点生成兜底文本 delta。当节点存在文本输入时，文本输入 MUST 继续按既有 safe text / markdown 语义投影并接受 HTML 安全校验。

当有效 output parser 的 `type` 为 `OBJECT` 且节点没有可投影文本输入时，`display-content` MUST 将解析后的 object 输出序列化为 JSON 字符串并作为 `NODE_OUTPUT_DELTA` 的文本内容投影；MUST NOT 将多个字段值用换行拼接为值列表。

需求类别：功能性需求

**触发机制：**

- 节点 ready 时触发

**输入与前置条件：**

- safe text / markdown 内容，或有效 output parser 的非空 object `data`
- output parser 模板可引用当前上游变量

**输出与副作用：**

- 文本输入存在时产生 stream projection
- output parser `data` 存在时产生可被 projector 消费的 resolved `output_parser`
- 无文本输入且 `data` 为非空 object 时不产生文本 delta

**核心判断逻辑：**

1. 按既有优先级解析 output parser 来源
2. 使用上游变量和节点 runtime bindings 解析模板
3. 文本输入存在时校验内容为允许格式并投影
4. object `data` 存在时传递给 projected output，由 projector 构建 structured delta
5. 标记节点完成并继续下游

**状态 / 产物契约：**

- 投影内容与 execution / nodeId / retryCount 或等价安全可追溯键可追溯
- 文本内容不得包含 raw HTML / script
- `output_parser` 不得泄漏给下游变量

**流程接入：**

- 消费方为 `agent-channel-web` 与既有 workflow structured delta projector

**失败与降级：**

- 文本内容不安全 -> 明确拒绝
- 无文本输入且无有效展示数据 -> 既有输入校验失败

#### Scenario: Safe Projection Only

- **WHEN** `display-content` 投影文本内容
- **THEN** 内容 MUST 只包含 safe text / markdown

#### Scenario: PIU Object Data Reaches Structured Delta

- **GIVEN** 上游变量 `pyresult` 是 JSON object
- **AND** `display-content` 的有效 output parser 为 `type: PIU`，且 `data` 是引用 `pyresult` 的模板
- **WHEN** 节点执行完成
- **THEN** projected output 的 `output_parser.data` MUST 保留解析后的 object
- **AND** 节点 MUST NOT 因 object 不是 string 而失败

#### Scenario: Output Parser Source Precedence Applies

- **GIVEN** 节点同时声明 `node.outputParser` 和 `node.outputs.output_parser`
- **WHEN** `display-content` 解析 output parser
- **THEN** 系统 MUST 使用 `node.outputParser`
- **AND** MUST NOT 合并或覆盖它

#### Scenario: Presentation Parser Takes Precedence

- **GIVEN** 节点同时声明 `node.presentation.outputParser` 和 `node.outputParser`
- **WHEN** `display-content` 解析 output parser
- **THEN** 系统 MUST 使用 `node.presentation.outputParser`
- **AND** MUST NOT 合并或覆盖它

#### Scenario: No Redundant Text Delta For Object Data

- **GIVEN** `display-content` 的有效 output parser `data` 是非空 object
- **AND** 节点没有文本输入
- **WHEN** 节点执行完成
- **THEN** 节点 MUST NOT 发出文本 `NODE_OUTPUT_DELTA`
- **AND** engine MUST NOT 发出兜底文本 delta

#### Scenario: Text Input Remains Safe Projection

- **GIVEN** `display-content` 的有效 output parser `data` 是非空 object
- **AND** 节点存在文本输入
- **WHEN** 节点执行完成
- **THEN** 文本输入 MUST 继续接受既有 HTML 安全校验并按 safe text / markdown 语义投影

#### Scenario: OBJECT Content Serializes As JSON

- **GIVEN** `display-content` 的有效 output parser 为 `type: OBJECT`
- **AND** 节点输出包含 `cell_id: NB123` 和 `status: 告警恢复`
- **WHEN** 节点执行完成
- **THEN** 文本 `NODE_OUTPUT_DELTA` 内容 MUST 为 JSON 字符串 `{"cell_id":"NB123","status":"告警恢复"}`
- **AND** MUST NOT 为 `NB123\n告警恢复`

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：`display-content` 支持解析上游变量模板、保留 PIU object 数据并交给既有 structured delta 投影；无文本输入时不产生冗余文本 delta，有文本输入时继续执行安全文本投影。
- **依据 Requirements**：`Display Content`

### 规格

- **规格项**：output parser 来源与模板作用域
- **变更类型**：修改
- **原规格值**：仅按节点自有 output parser 配置解析展示控制，模板作用域未显式包含上游变量。
- **目标规格值**：按 `node.presentation.outputParser`、`node.outputParser`、`node.outputs.output_parser` 优先级解析；模板可引用上游变量，节点自有输出和展示字段覆盖同名变量。
- **依据 Requirements**：`Display Content`

- **规格项**：PIU object 展示数据
- **变更类型**：修改
- **原规格值**：PIU object 数据可能被单值 string 校验拒绝，且无文本输入时可能产生冗余文本 delta。
- **目标规格值**：非空 object `data` 必须保留给 structured delta，不得按 string 校验失败；无文本输入时不得产生文本 delta。
- **依据 Requirements**：`Display Content`

- **规格项**：文本展示安全
- **变更类型**：不变
- **原规格值**：文本内容按 safe text / markdown 投影并执行 HTML 安全校验。
- **目标规格值**：文本输入存在时继续优先投影并执行既有 HTML 安全校验。
- **依据 Requirements**：`Display Content`

- **规格项**：OBJECT 展示序列化
- **变更类型**：不变
- **原规格值**：OBJECT 输出按 JSON 字符串投影。
- **目标规格值**：OBJECT 输出继续按 JSON 字符串投影，不使用值列表换行拼接。
- **依据 Requirements**：`Display Content`

### 主规格

- **变更类型**：修改
- **目标内容**：`workflow-interaction-nodes`
- **依据 Requirements**：`Display Content`
