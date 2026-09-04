# workflow-output-parser-contract Specification Delta

## MODIFIED Requirements

### Requirement: Workflow 输出 parser 控制配置

Workflow 执行 MUST 把 `node.outputs.output_parser` 当作控制配置而不是业务输出数据。

`projectNodeOutputs` MUST 基于 handler runtime 绑定解析 `node.outputParser` 模板，并把解析出的 `output_parser` 包含在投影输出（`WorkflowNodeResult.output` 和 `WorkflowExecutionEvent.output`）中，使 projector 可以读取它。下游变量合并 MUST 剥离 `output_parser`，使下游节点 MUST NOT 访问它。

解析出的 output parser MUST 提供展示可见性（`show_title`/`show_content`）、展示类型（`type`）、展示数据（`data`）、消息级别（`message_level`）、AIGC 标记（`show_aigc`）和输出 schema 字段的来源。

#### Scenario: Output parser 不被投影

- **GIVEN** 某个 workflow 节点声明了业务输出字段和 `outputs.output_parser`
- **WHEN** 该节点输出被投影
- **THEN** 投影出的业务输出 MUST 包含声明的业务字段
- **AND** 它 MUST NOT 包含 `output_parser`
- **AND** 下游变量引用 MUST NOT 能读取 `output_parser`

## ADDED Requirements

### Requirement: Workflow 输出 parser 展示类型解析

当解析出的 output parser 包含 `type` 字段（string）时，projector MUST 对照产品规格中定义的展示类型集合校验它：`TEXT`、`CHART`、`CHART_PRO`、`HTML`、`TABLE`、`PIU`、`DSL`。

Projector MUST 把展示类型映射为一个 `ToolMessageType`：
- `PIU` MUST 映射为 `"PIU"`。
- `DSL` MUST 映射为 `"DSL"`。
- 所有其他有效类型 MUST 映射为 `"TEXT"`。

原始展示类型字符串 MUST 作为结构化 delta payload 中的 `displayType` metadata 传递，使前端可以选择合适的渲染方式。

当 `type` 缺失或不是 string 时，projector MUST 使用默认的 `"TEXT"`，并且 MUST NOT 在 payload 中包含 `displayType`。

#### Scenario: PIU 类型映射为 PIU 消息类型

- **GIVEN** 某节点的 output parser 带有 `type: "PIU"`
- **WHEN** projector 为节点完成构建一个结构化 delta，由 `type`、`data` 或 `message_level` 触发
- **THEN** `toolMessageType` MUST 为 `"PIU"`
- **AND** payload MUST 包含 `displayType: "PIU"`

#### Scenario: TABLE 类型映射为 TEXT 消息类型并带 metadata

- **GIVEN** 某节点的 output parser 带有 `type: "TABLE"`
- **WHEN** projector 为节点完成构建一个结构化 delta，由 `type`、`data` 或 `message_level` 触发
- **THEN** `toolMessageType` MUST 为 `"TEXT"`
- **AND** payload MUST 包含 `displayType: "TABLE"`

#### Scenario: 缺失 type 时默认为 TEXT

- **GIVEN** 某节点的 output parser 不包含 `type`
- **WHEN** projector 为节点完成构建一个结构化 delta
- **THEN** `toolMessageType` MUST 为 `"TEXT"`
- **AND** payload MUST NOT 包含 `displayType`

#### Scenario: 只有 type 而没有 data 或 message_level 时不触发 output_parser 路径

- **GIVEN** 某节点的 output parser 带有 `type: "PIU"` 但没有 `data` 或 `message_level`
- **WHEN** projector 为节点完成构建一个结构化 delta
- **THEN** output_parser 驱动的路径 MUST NOT 被进入
- **AND** `toolMessageType` MUST 遵循默认或 output 驱动的路径
- **AND** payload MUST NOT 包含 `displayType`

### Requirement: Workflow 输出 parser 数据内容覆盖

当解析出的 output parser 包含一个非空 object 的 `data` 字段时，projector MUST 使用 `data` 作为结构化 delta 的 `content`，而不是序列化节点输出。

当 `data` 缺失、为 `null` 或不是 object 时，projector MUST 回退到输出序列化。

`output_parser.data` MUST 优先于 output 驱动的内容（即由 `tryOutputDrivenDelta` 读取的 `output["content"]`）。

#### Scenario: 存在 data 时覆盖输出序列化

- **GIVEN** 某节点的 output parser 带有 `data: { piuName: "reportViewer", piuVersion: "1.0.0" }`
- **AND** 节点输出包含业务字段
- **WHEN** projector 为节点完成构建一个结构化 delta
- **THEN** `content` MUST 是 `data` 对象
- **AND** `content` MUST NOT 是序列化的输出字符串

#### Scenario: 缺失 data 时回退到序列化

- **GIVEN** 某节点的 output parser 不包含 `data`
- **AND** 节点输出包含 `{ answer: "done" }`
- **WHEN** projector 为节点完成构建一个结构化 delta
- **THEN** `content` MUST 为 `"done"`（序列化输出）

#### Scenario: data 不是 object 时被忽略

- **GIVEN** 某节点的 output parser 带有 `data: "some string"`
- **WHEN** projector 为节点完成构建一个结构化 delta
- **THEN** `content` MUST 是序列化输出（data 被忽略）

### Requirement: Workflow 输出 parser 消息级别覆盖

当解析出的 output parser 包含 `message_level` 或 `messageLevel` 字段（string）时，projector MUST 对照 `ToolEventType` 值校验它：`TITLE`、`DETAIL`、`ANSWER`、`EXPAND_PANEL`。

当有效时，projector MUST 在应用 sub-workflow scope 映射（例如 sub-workflow scope 中 `TITLE` -> `SUB_TITLE`）之后，把它用作结构化 delta 的 `toolEventType`。

当缺失或无效时，projector MUST 回退到既有的由 answer 节点派生的级别（answer 节点为 ANSWER，否则为 DETAIL）。

`output_parser.message_level` MUST 优先于 output 驱动的级别（即由 `tryOutputDrivenDelta` 读取的 `output["level"]`）。

#### Scenario: message_level 覆盖 answer 节点派生

- **GIVEN** 某个非 answer 节点的 output parser 带有 `message_level: "ANSWER"`
- **WHEN** projector 为节点完成构建一个结构化 delta
- **THEN** `toolEventType` MUST 为 `"ANSWER"`（而不是默认的 `DETAIL`）

#### Scenario: 无效 message_level 被忽略

- **GIVEN** 某节点的 output parser 带有 `message_level: "INVALID"`
- **WHEN** projector 为节点完成构建一个结构化 delta
- **THEN** `toolEventType` MUST 遵循默认的 answer 节点派生

#### Scenario: 缺失 message_level 时使用默认派生

- **GIVEN** 某节点的 output parser 不包含 `message_level`
- **WHEN** projector 为节点完成构建一个结构化 delta
- **THEN** `toolEventType` MUST 遵循默认的 answer 节点派生

### Requirement: Workflow 输出 parser AIGC 标记透传

当解析出的 output parser 将 `show_aigc` 或 `showAigc` 设为 `true` 且 output_parser 驱动的路径被触发（由 `data` 或 `message_level`）时，projector MUST 在结构化 delta payload 中包含 `aigc: true`。

当 `show_aigc` 为 `false` 或缺失时，projector MUST 从 payload 中省略 `aigc` 字段。

#### Scenario: show_aigc 为 true 时包含 aigc 字段

- **GIVEN** 某节点的 output parser 带有 `show_aigc: true` 和 `data: { content: "x" }`
- **WHEN** projector 构建一个结构化 delta
- **THEN** payload MUST 包含 `aigc: true`

#### Scenario: show_aigc 为 false 时省略 aigc 字段

- **GIVEN** 某节点的 output parser 带有 `show_aigc: false` 和 `data: { content: "x" }`
- **WHEN** projector 构建一个结构化 delta
- **THEN** payload MUST NOT 包含 `aigc` 字段

#### Scenario: 只有 show_aigc 而没有 data 或 message_level 时不输出 aigc

- **GIVEN** 某节点的 output parser 带有 `show_aigc: true` 但没有 `data` 或 `message_level`
- **WHEN** projector 构建一个结构化 delta
- **THEN** output_parser 驱动的路径 MUST NOT 被进入
- **AND** payload MUST NOT 包含 `aigc` 字段

#### Scenario: 缺失 show_aigc 时省略 aigc 字段

- **GIVEN** 某节点的 output parser 不包含 `show_aigc`
- **WHEN** projector 构建一个结构化 delta
- **THEN** payload MUST NOT 包含 `aigc` 字段

### Requirement: Workflow 输出 parser 存储模型偏离

TS runtime MUST 对所有 workflow 输出展示使用统一的 `TOOL_STRUCTURED_DELTA` timeline event 模型。PIU 数据（包括 `piuName`、`piuVersion`、`data`、`method`）MUST 内联承载为结构化 delta 的 `content` 字段。

遗留的 HOFS/ZENITH 双存储路由 MUST NOT 应用于 TS runtime。这一对遗留产品规格的偏离是 OpenSpec design 中文档化的显式设计决策。

#### Scenario: PIU 数据内联承载在结构化 delta 中

- **GIVEN** 某节点的 output parser 带有 `type: "PIU"` 和 `data: { piuName: "reportViewer", piuVersion: "1.0.0" }`
- **WHEN** projector 为节点完成构建一个结构化 delta
- **THEN** `content` MUST 是内联带有 PIU 字段的 `data` 对象
- **AND** MUST NOT 发生独立的 HOFS 存储调用

#### Scenario: 非 PIU 数据内联承载在结构化 delta 中

- **GIVEN** 某节点的 output parser 带有 `type: "TABLE"` 且没有 `data` 字段
- **WHEN** projector 为节点完成构建一个结构化 delta
- **THEN** `content` MUST 是序列化的输出字符串
- **AND** MUST NOT 发生独立的 ZENITH 存储调用
