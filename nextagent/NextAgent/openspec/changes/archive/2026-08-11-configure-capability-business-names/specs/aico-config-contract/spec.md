## Function

- **所属 Function**：`FN-10.6 前端定制`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: AICOConfig configuration type and field definitions

AICOConfig SHALL 是用于定制 NextAgent 前端外观、行为开关、布局、PIU 渲染注入点和扩展 Capability 业务名称的 JSON-compatible 配置对象。全部字段均为 optional；整个 AICOConfig 或任一字段缺失时，对应界面或行为 MUST 使用当前默认值。未提供任何字段时，AICOConfig MUST NOT 引入行为变化。

**需求类别**：功能性需求

AICOConfig SHALL 支持以下字段与类型：

- `containerId?: string`
- `icon?: string`
- `activeIcon?: string`
- `entranceIcon?: string`
- `guideIcon?: string`
- `name?: string`
- `welcome?: string`
- `modalSize?: ModalSize`
- `clearStorage?: boolean`
- `declaration?: boolean | { title: string; tips: string }`
- `showAskTime?: boolean`
- `showThinkingChain?: boolean`
- `operators?: Operator[]`
- `answerOperator?: PIUInfoItem`
- `quickInfo?: { type: QuickType; data?: PIUInfoItem }`
- `inputOperator?: PIUInfoItem`
- `layoutConfig?: { expandPanelPosition?: ExpandPanelPosition; operatorPosition?: ToolBarPosition }`
- `guideInfo?: { type: GuideAreaType; data?: PIUInfoItem }`
- `capabilityBusinessNames?: CapabilityBusinessNameEntry[]`

既有 supporting types 的 shape 与语义保持不变。新增 supporting types 如下：

- `CapabilityBusinessNameKind`: enum `TOOL | AGENT | SKILL | WORKFLOW`
- `CapabilityBusinessNames`: `{ "zh-CN"?: string; "en-US"?: string }`
- `CapabilityBusinessNameEntry`: `{ kind: CapabilityBusinessNameKind; id: string; names: CapabilityBusinessNames }`

`capabilityBusinessNames` MUST 至多包含 1000 项。每个 `id` 在 trim 后 MUST 包含 1 至 128 个 Unicode code point且 MUST NOT 包含 Unicode control character；每个已提供的语言名称在 trim 后 MUST 包含 1 至 256 个 Unicode code point且 MUST NOT 包含 Unicode control character。`names` MUST 至少包含一个有效名称，并 MUST NOT 接受 `zh-CN`、`en-US` 之外的语言 key。名称是纯文本数据，前端 MUST 按文本渲染，MUST NOT 作为 HTML 或 Markdown 解释。

全部 icon 字段（`icon`、`activeIcon`、`entranceIcon`、`guideIcon`、`Operator.lightIcon`、`Operator.darkIcon`）MUST 是 base64-encoded string。前端 MUST 把该值放入 `data:image/...;base64,...` URL，并通过 `<img>` 的 `src` 渲染。

#### Scenario: 未提供 AICOConfig

- **WHEN** 任一宿主没有提供 AICOConfig
- **THEN** 全部界面与行为 MUST 保持当前默认值
- **AND** 系统 MUST NOT 产生错误或警告

#### Scenario: 只提供部分字段

- **WHEN** AICOConfig 只提供 `{ name: "网络助手" }`
- **THEN** display title MUST 变为“网络助手”
- **AND** 其他界面与行为 MUST 保持当前默认值

#### Scenario: 提供扩展 Capability 双语名称

- **WHEN** AICOConfig 提供 `{ kind: "SKILL", id: "alarm-diagnosis", names: { "zh-CN": "告警诊断", "en-US": "Alarm diagnosis" } }`
- **THEN** 该条目 MUST 作为合法的扩展 Skill 业务名称配置
- **AND** 两个名称 MUST 仅作为纯文本数据被消费

#### Scenario: 名称语言 key 不受支持

- **WHEN** 一个名称条目只提供 `names: { "fr-FR": "Diagnostic" }`
- **THEN** 该条目 MUST 被忽略
- **AND** 其他合法 AICOConfig 字段 MUST 继续生效

### Requirement: AICOConfig injection paths per host mode

AICOConfig SHALL 通过下列宿主路径注入：

- local 与 immersive 宿主 MUST 在页面启动时从 `sessionStorage["AICOConfig"]` 读取 JSON string，并 MUST 在该页面生命周期内只解析、校验和应用一次；刷新页面 MUST 重新读取。
- collaborative 宿主 MUST 通过 PIU `loadAIAgent` handler payload 接收完整 AICOConfig object，并 MUST 在每次 `loadAIAgent` 调用时解析、校验和完整替换当前配置。

**需求类别**：功能性需求

系统 MUST NOT 在同一启动生命周期内轮询或重新读取 sessionStorage，也 MUST NOT 提供 AICOConfig hot update。collaborative 宿主收到后续 `loadAIAgent` 时 MUST 先卸载 active custom PANEL，再完整替换配置，MUST NOT 与旧配置合并。

#### Scenario: local 与 immersive 读取同一个启动期配置

- **GIVEN** `sessionStorage["AICOConfig"]` 包含合法 JSON string
- **WHEN** local 或 immersive 页面启动
- **THEN** 前端 MUST 读取、校验并应用该配置
- **AND** 前端 MUST NOT 在同一页面生命周期内再次读取该 key

#### Scenario: sessionStorage 配置缺失

- **GIVEN** `sessionStorage["AICOConfig"]` 不存在
- **WHEN** local 或 immersive 页面启动
- **THEN** 前端 MUST 使用全部默认值
- **AND** 页面 MUST 继续正常呈现

#### Scenario: collaborative 接收完整配置

- **GIVEN** collaborative host 通过 `loadAIAgent` 发送完整 AICOConfig payload
- **WHEN** handler 处理该 payload
- **THEN** 前端 MUST 校验并应用该配置
- **AND** 后续 payload MUST 完整替换旧配置而不是合并

### Requirement: AICOConfig validation uses hand-written functions

AICOConfig validation SHALL 使用 hand-written TypeScript validation functions，并 MUST 在 sessionStorage read 或 `loadAIAgent` handler 的前端输入边界完成；系统 MUST NOT 为此契约引入 TypeBox、Ajv 或其他 schema validation library。

**需求类别**：系统质量属性

**质量属性**：安全、可靠性/恢复、可维护性、可测试性
**适用范围**：该 Function

校验 MUST 遵守以下规则：

- top-level value MUST 是 object 或 null/undefined；null/undefined 应用全部默认值。
- 每个已知字段 MUST 按期望类型校验；unknown field MUST 被静默忽略。
- string field MUST 在 trim 后非空；空 string 视为 absent。
- `operators` 与 `capabilityBusinessNames` MUST 逐项校验；invalid item MUST 被过滤并产生 console warning，其他合法项继续生效。
- enum field MUST 匹配 allowed value；invalid value MUST 回退该字段默认值。
- base64 icon string 只需在输入边界校验非空；render 时发现 malformed base64 MUST 回退默认 logo。
- top-level AICOConfig 不是 object 时，前端 MUST 忽略完整配置、应用全部默认值并产生一条 console warning。
- `capabilityBusinessNames` 超过 1000 项时，前端 MUST 忽略第 1001 项及其后全部项目并产生一条 console warning。
- 相同 `kind + id` 出现多个合法条目时，按数组顺序的首个合法条目 MUST 生效；后续重复条目 MUST 被忽略并产生 console warning。
- 一个名称条目的某个语言值非法时，该语言值 MUST 被忽略；若该条目仍有至少一个有效语言值则保留该条目，否则 MUST 忽略整个条目。

#### Scenario: 合法配置被接受

- **WHEN** 输入是 well-formed AICOConfig object
- **THEN** 全部合法字段 MUST 被应用
- **AND** unknown field MUST 被静默忽略

#### Scenario: 非对象配置安全降级

- **WHEN** AICOConfig 是 string、number 或 array
- **THEN** 前端 MUST 忽略完整配置并使用全部默认值
- **AND** 前端 MUST 产生一条 console warning

#### Scenario: 部分非法名称逐项过滤

- **GIVEN** `capabilityBusinessNames` 同时包含一个合法 Tool 条目和一个带 control character 的 Skill 名称
- **WHEN** 前端校验该数组
- **THEN** 合法 Tool 条目 MUST 被保留
- **AND** 非法 Skill 条目 MUST 被忽略并产生 console warning

#### Scenario: 重复身份使用首个合法条目

- **GIVEN** 两个合法条目具有相同 `kind=TOOL` 与 `id=networkDiagnostic`
- **WHEN** 前端校验该数组
- **THEN** 数组中的首个条目 MUST 生效
- **AND** 后续重复条目 MUST 被忽略并产生 console warning

### Requirement: AICOConfig default behavior when fields are absent

AICOConfig 字段缺失或非法时，前端 MUST 使用以下默认值：

- `containerId`：仅 collaborative 宿主使用 `loadAIAgent` call 的 `containerId`
- `icon`、`entranceIcon`、`guideIcon`：built-in logo SVG
- `activeIcon`：保留但不消费
- `name`：`NextAgent`
- `welcome`：i18n `welcome.subtitle`
- `modalSize`：`DOCKED_DEFAULT_WIDTH` 484px 与当前默认 height/minWidth
- `clearStorage`：false
- `declaration`：当前 i18n default disclaimer text 与 tips
- `showAskTime`：false
- `showThinkingChain`：true
- `operators`：empty array
- `answerOperator`：default BubbleActions
- `quickInfo`：default `SKILL_LIST`
- `inputOperator`：default slash hint
- `layoutConfig`：`operatorPosition: LEFT` 与 `expandPanelPosition: RIGHT`
- `guideInfo`：default `HIGH_FREQUENCY_RECOMMEND`
- `capabilityBusinessNames`：empty array

**需求类别**：功能性需求

#### Scenario: 空对象使用全部默认值

- **WHEN** AICOConfig 是 empty object `{}`
- **THEN** 全部界面与行为 MUST 与没有 AICOConfig 时相同
- **AND** `capabilityBusinessNames` MUST 不提供任何配置名称

#### Scenario: 名称字段缺失不影响其他定制

- **WHEN** AICOConfig 提供其他合法字段但不包含 `capabilityBusinessNames`
- **THEN** 其他合法定制 MUST 正常生效
- **AND** Capability 业务标题 MUST 继续使用既有名称解析与降级行为

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：前端定制支持宿主通过同一 AICOConfig 提供扩展 Capability 双语业务名称，local、immersive 和 collaborative 保持确定的启动期注入与安全降级。
- **依据 Requirements**：`AICOConfig configuration type and field definitions`、`AICOConfig injection paths per host mode`、`AICOConfig validation uses hand-written functions`、`AICOConfig default behavior when fields are absent`

### 输入

- **变更类型**：修改
- **目标内容**：local 与 immersive 接收 `sessionStorage["AICOConfig"]` 启动快照，collaborative 接收 `loadAIAgent` 完整 payload；配置可包含有界的扩展 Capability 双语业务名称。
- **依据 Requirements**：`AICOConfig configuration type and field definitions`、`AICOConfig injection paths per host mode`

### 结果

- **变更类型**：修改
- **目标内容**：合法名称配置可供过程标题使用；缺失、部分非法、重复或超量配置确定性降级，且不阻塞其他前端定制。
- **依据 Requirements**：`AICOConfig validation uses hand-written functions`、`AICOConfig default behavior when fields are absent`

### 规格

- **规格项**：Capability 业务名称配置范围
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：支持 `TOOL`、`AGENT`、`SKILL`、`WORKFLOW`，每项可提供 `zh-CN`、`en-US` 纯文本名称，最多 1000 项
- **依据 Requirements**：`AICOConfig configuration type and field definitions`、`AICOConfig validation uses hand-written functions`

- **规格项**：AICOConfig 宿主注入
- **变更类型**：修改
- **原规格值**：immersive 使用 sessionStorage，collaborative 使用 `loadAIAgent`，local 不消费
- **目标规格值**：local 与 immersive 使用一次性 sessionStorage 启动快照，collaborative 使用完整 `loadAIAgent` payload；均不支持 hot update
- **依据 Requirements**：`AICOConfig injection paths per host mode`

### 覆盖特性

- **变更类型**：修改
- **目标内容**：`F-10.6 前端定制` 增加通过 AICOConfig 配置扩展 Capability 业务名称的用户价值。
- **依据 Requirements**：`AICOConfig configuration type and field definitions`、`AICOConfig injection paths per host mode`
