## ADDED Requirements

### Requirement: 结构化 workflow 过程呈现保持可见

`ProcessPanel` MUST 把来自 `TOOL_STRUCTURED_DELTA` TITLE 或 SUB_TITLE 事件的 entry 当作结构化 workflow 呈现。当首次渲染时已处于 settled 状态，该 panel MUST 默认展开。settling 一个运行中的 turn MUST NOT 自动折叠该结构化呈现。用户显式折叠 MUST 保持权威。没有 TITLE 或 SUB_TITLE 结构化 entry 的 settled 过程 panel MUST 保持既有的默认折叠行为。

#### Scenario: 快速结构化 workflow 首次渲染即 settled
- **GIVEN** 一个已完成 turn 包含带 DETAIL 内容的 TITLE entry
- **WHEN** ProcessPanel 首次渲染时执行阶段已是 `settled`
- **THEN** TITLE 和 DETAIL 内容 MUST 无需额外用户操作即可见

#### Scenario: 结构化 workflow 在 settling 后不自动折叠
- **GIVEN** 一个结构化 workflow 过程 panel 在运行期间被自动展开
- **WHEN** 执行阶段变为 `settled`
- **THEN** 该 panel MUST 保持展开

#### Scenario: 用户折叠保持权威
- **GIVEN** 一个结构化 workflow 过程 panel 可见
- **WHEN** 用户显式折叠它
- **THEN** 该 panel MUST 保持用户折叠状态

#### Scenario: 普通已 settled 过程保留折叠默认值
- **GIVEN** 一个 settled 过程 panel 没有 TITLE 或 SUB_TITLE 结构化 entry
- **WHEN** ProcessPanel 首次渲染
- **THEN** 它 MUST 使用既有的默认折叠行为
