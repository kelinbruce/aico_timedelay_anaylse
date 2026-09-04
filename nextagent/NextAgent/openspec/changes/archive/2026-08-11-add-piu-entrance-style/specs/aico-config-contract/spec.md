## Function

- **所属 Function**：`FN-10.6 前端定制`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: AICOConfig configuration type and field definitions

AICOConfig SHALL 是用于定制 NextAgent 前端外观、行为开关、布局、PIU 渲染注入点和扩展 Capability 业务名称的 JSON-compatible 配置对象。全部字段均为 optional；整个 AICOConfig 或任一字段缺省时，对应界面或行为 MUST 使用当前默认值。未提供任何字段时，AICOConfig MUST NOT 引入行为变化。

**需求类别**：功能性需求

AICOConfig SHALL 支持以下字段与类型：

- `containerId?: string`
- `icon?: string`
- `activeIcon?: string`
- `entranceIcon?: string`
- `entranceStyle?: Readonly<Record<string, string | number>>`
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

既有 supporting types 的 shape 与语义保持不变。

全部 icon 字段（`icon`、`activeIcon`、`entranceIcon`、`guideIcon`、`Operator.lightIcon`、`Operator.darkIcon`）MUST 是 base64-encoded string。前端 MUST 把该值放入 `data:image/...;base64,...` URL，并通过 `<img>` 的 `src` 渲染。

`entranceStyle` SHALL 是一个对象，其键为 CSS 属性名（camelCase），值为 `string` 或 `number`。前端 MUST 将其作为 inline style 叠加到 PIU 入口按钮（`AIAgentEntrance` 的 `<button>`）上。非 string/number 的值 MUST 在校验时被过滤。

#### Scenario: 未提供 AICOConfig

- **WHEN** 任一宿主没有提供 AICOConfig
- **THEN** 全部界面与行为 MUST 保持当前默认值
- **AND** 系统 MUST NOT 产生错误或警告

#### Scenario: 只提供部分字段

- **WHEN** AICOConfig 只提供 `{ name: '网络助手' }`
- **THEN** display title MUST 变为"网络助手"
- **AND** 其他界面与行为 MUST 保持当前默认值

#### Scenario: base64 icon 字段渲染

- **WHEN** AICOConfig 提供 `entranceIcon` 作为 base64 string
- **THEN** collaborative 入口按钮 MUST 渲染解码后的图像
- **AND** 如果 base64 string malformed，前端 MUST 回退到默认 logo 并产生 console warning

#### Scenario: entranceStyle 叠加到入口按钮

- **GIVEN** AICOConfig 提供 `entranceStyle: { right: 16, bottom: '20px', borderRadius: 8 }`
- **WHEN** 入口按钮渲染
- **THEN** 入口按钮 MUST 通过 inline style 应用 `right: 16`、`bottom: '20px'` 和 `borderRadius: 8`
- **AND** CSS class 中的同名属性被 inline style 覆盖

#### Scenario: entranceStyle 缺省时使用默认样式

- **WHEN** AICOConfig 不提供 `entranceStyle`
- **THEN** 入口按钮 MUST 不应用额外 inline style
- **AND** 入口按钮外观 MUST 与当前默认完全一致

### Requirement: AICOConfig validation uses hand-written functions

AICOConfig validation SHALL 使用 hand-written TypeScript validation functions，并 MUST 在 sessionStorage read 或 `loadAIAgent` handler 的前端输入边界完成；系统 MUST NOT 为此契约引入 TypeBox、Ajv 或其他 schema validation library。

**需求类别**：系统质量属性

**质量属性**：安全、可维护性、可测试性
**适用范围**：该 Function

校验 MUST 遵守以下规则：

- top-level value MUST 是 object 或 null/undefined；null/undefined 应用全部默认值。
- 每个已知字段 MUST 按期望类型校验；unknown field MUST 被静默忽略。
- string field MUST 在 trim 后非空；空 string 视为 absent。
- `operators` 与 `capabilityBusinessNames` MUST 逐项校验；invalid item MUST 被过滤并产生 console warning，其他合法项继续生效。
- enum field MUST 匹配 allowed value；invalid value MUST 回退该字段默认值。
- base64 icon string 只需在输入边界校验非空；render 时发现 malformed base64 MUST 回退默认 logo。
- top-level AICOConfig 不是 object 时，前端 MUST 忽略完整配置、应用全部默认值并产生一条 console warning。
- `entranceStyle` MUST 是对象类型；非对象值 MUST 返回 `undefined`（视为 absent）。
- `entranceStyle` 对象中，非 string/number 的值 MUST 被过滤；不产生 console warning。
- `entranceStyle` 过滤后为空对象时 MUST 返回 `undefined`（视为 absent）。

#### Scenario: 合法配置被接受

- **WHEN** 输入是 well-formed AICOConfig object
- **THEN** 全部合法字段 MUST 被应用
- **AND** unknown field MUST 被静默忽略

#### Scenario: 非对象配置安全降级

- **WHEN** AICOConfig 是 string、number 或 array
- **THEN** 前端 MUST 忽略完整配置并使用全部默认值
- **AND** 前端 MUST 产生一条 console warning

#### Scenario: 部分非法 operators 逐项过滤

- **WHEN** `operators` 中一个元素具有 invalid `position` 值
- **THEN** 该元素 MUST 被过滤并产生 console warning
- **AND** 其他合法 operators MUST 继续生效

#### Scenario: entranceStyle 合法值被保留

- **GIVEN** AICOConfig 提供 `entranceStyle: { right: 16, bottom: '20px', borderRadius: 8 }`
- **WHEN** 前端校验 AICOConfig
- **THEN** `entranceStyle` MUST 被完整保留为 `{ right: 16, bottom: '20px', borderRadius: 8 }`

#### Scenario: entranceStyle 非 string/number 值被过滤

- **GIVEN** AICOConfig 提供 `entranceStyle: { right: 16, invalid: true, alsoInvalid: null }`
- **WHEN** 前端校验 AICOConfig
- **THEN** `entranceStyle` MUST 只保留 `{ right: 16 }`
- **AND** 非法值 MUST NOT 产生 console warning

#### Scenario: entranceStyle 非对象返回空

- **GIVEN** AICOConfig 提供 `entranceStyle: 'big'`
- **WHEN** 前端校验 AICOConfig
- **THEN** `entranceStyle` MUST 被视为 absent
- **AND** 其他合法字段 MUST 继续生效

#### Scenario: entranceStyle 空对象返回空

- **GIVEN** AICOConfig 提供 `entranceStyle: {}`
- **WHEN** 前端校验 AICOConfig
- **THEN** `entranceStyle` MUST 被视为 absent

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
- `entranceStyle`：不应用额外 inline style，入口按钮使用 CSS class 默认样式

**需求类别**：功能性需求

#### Scenario: 空对象使用全部默认值

- **WHEN** AICOConfig 是 empty object `{}`
- **THEN** 全部界面与行为 MUST 与没有 AICOConfig 时相同
- **AND** 不 MUST 产生任何视觉或行为差异

#### Scenario: 缺省 operators 只显示默认按钮

- **WHEN** AICOConfig 不包含 `operators`
- **THEN** toolbar / sidebar MUST 只显示默认按钮

#### Scenario: entranceStyle 缺省时不影响其他定制

- **WHEN** AICOConfig 提供其他合法字段但不包含 `entranceStyle`
- **THEN** 其他合法定制 MUST 正常生效
- **AND** 入口按钮 MUST 使用当前默认样式

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：AICOConfig 增加可选的 `entranceStyle` 字段，允许集成方通过 CSS 键值对定制 PIU 入口按钮的视觉样式。
- **依据 Requirements**：`AICOConfig configuration type and field definitions`、`AICOConfig validation uses hand-written functions`、`AICOConfig default behavior when fields are absent`

### 输入

- **变更类型**：修改
- **目标内容**：AICOConfig 可包含 `entranceStyle: Readonly<Record<string, string | number>>`，键为 CSS 属性名（camelCase），值为 `string` 或 `number`。
- **依据 Requirements**：`AICOConfig configuration type and field definitions`

### 规格

- **规格项**：入口按钮样式定制
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`entranceStyle` 接受 CSS 属性名（camelCase）到 `string` 或 `number` 的键值对，作为 inline style 叠加到入口按钮；非 string/number 值在校验时被过滤；缺省时不应用额外 inline style
- **依据 Requirements**：`AICOConfig configuration type and field definitions`、`AICOConfig validation uses hand-written functions`、`AICOConfig default behavior when fields are absent`

### 覆盖特性

- **变更类型**：修改
- **目标内容**：`F-10.6 前端定制` 增加通过 AICOConfig 定制入口按钮 CSS 样式的用户价值。
- **依据 Requirements**：`AICOConfig configuration type and field definitions`、`AICOConfig default behavior when fields are absent`