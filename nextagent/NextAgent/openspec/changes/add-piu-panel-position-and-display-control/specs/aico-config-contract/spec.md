# aico-config-contract Delta Specification

**所属 Function**：`FN-10.6 前端定制`
**Function 变更类型**：修改
**spec 角色**：主规格

## MODIFIED Requirements

### Requirement: AICOConfig configuration type and field definitions

AICOConfig SHALL 支持以下新增字段：

- `panelPosition?: { top?: number | string; bottom?: number | string; left?: number | string; right?: number | string }`
- `closeBehavior?: 'hide' | 'minimize'`
- `initialDisplayState?: { showEntrance?: boolean; showPanel?: boolean; minimized?: boolean }`
- `controls?: { close?: boolean; maximize?: boolean; dockFloat?: boolean; drag?: boolean; resize?: boolean }`
- `minimizedStyle?: Readonly<Record<string, string | number>>`

全部新增字段均为 optional；缺省时 MUST 使用当前默认值，不引入行为变化。新增字段 MUST NOT 影响 existing 字段的类型或语义。

`panelPosition` 的四个字段 `top` / `bottom` / `left` / `right` 均为 optional `number | string`。同时传入 `left` 和 `right` 时，`left` 优先。校验时非 string/number 值 MUST 被静默过滤，空对象 MUST 返回 undefined。

`closeBehavior` MUST 是 `'hide'` 或 `'minimize'` 枚举值。非法值 MUST 返回 undefined（视为 absent）。

`initialDisplayState` 的三个字段均为 optional boolean。非 boolean 值 MUST 被过滤。

`controls` 的五个字段均为 optional boolean。非 boolean 值 MUST 被过滤。

`minimizedStyle` SHALL 是一个对象，键为 CSS 属性名（camelCase），值为 `string` 或 `number`。校验逻辑 MUST 与 `entranceStyle` 一致：非对象返回 undefined，非 string/number 值静默过滤，空对象返回 undefined。

**需求类别**：功能性需求

#### Scenario: panelPosition 合法值被保留

- **GIVEN** AICOConfig 提供 `panelPosition: { top: 0, bottom: 0, left: 0 }`
- **WHEN** 前端校验 AICOConfig
- **THEN** `panelPosition` MUST 被完整保留为 `{ top: 0, bottom: 0, left: 0 }`

#### Scenario: panelPosition 非 string/number 值被过滤

- **GIVEN** AICOConfig 提供 `panelPosition: { top: 0, invalid: true, alsoInvalid: null }`
- **WHEN** 前端校验 AICOConfig
- **THEN** `panelPosition` MUST 只保留 `{ top: 0 }`
- **AND** 非法值 MUST NOT 产生 console warning

#### Scenario: closeBehavior 合法值被保留

- **GIVEN** AICOConfig 提供 `closeBehavior: 'minimize'`
- **WHEN** 前端校验 AICOConfig
- **THEN** `closeBehavior` MUST 被保留为 `'minimize'`

#### Scenario: closeBehavior 非法值被忽略

- **GIVEN** AICOConfig 提供 `closeBehavior: 'close'`
- **WHEN** 前端校验 AICOConfig
- **THEN** `closeBehavior` MUST 被视为 absent

#### Scenario: initialDisplayState 合法值被保留

- **GIVEN** AICOConfig 提供 `initialDisplayState: { showEntrance: false, showPanel: true, minimized: true }`
- **WHEN** 前端校验 AICOConfig
- **THEN** `initialDisplayState` MUST 被完整保留

#### Scenario: controls 非 boolean 值被过滤

- **GIVEN** AICOConfig 提供 `controls: { close: false, maximize: 'yes', resize: 1 }`
- **WHEN** 前端校验 AICOConfig
- **THEN** `controls` MUST 只保留 `{ close: false }`

#### Scenario: minimizedStyle 复用 entranceStyle 校验

- **GIVEN** AICOConfig 提供 `minimizedStyle: { left: 56, right: 'auto', invalid: true }`
- **WHEN** 前端校验 AICOConfig
- **THEN** `minimizedStyle` MUST 只保留 `{ left: 56, right: 'auto' }`
- **AND** 非法值 MUST NOT 产生 console warning

#### Scenario: 新增字段全部缺省时行为不变

- **WHEN** AICOConfig 不包含任何新增字段
- **THEN** 全部界面与行为 MUST 与当前完全一致

#### Scenario: 未提供 AICOConfig

- **WHEN** 任一宿主没有提供 AICOConfig
- **THEN** 全部界面与行为 MUST 保持当前默认值
- **AND** 系统 MUST NOT 产生错误或警告

#### Scenario: 只提供部分字段

- **WHEN** AICOConfig 只提供 `{ name: "网络助手" }`
- **THEN** display title MUST 变为“网络助手”
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

#### Scenario: Capability 名称 key 不是 AICOConfig 字段

- **WHEN** 宿主 payload 包含 unknown `capabilityBusinessNames` key
- **THEN** AICOConfig 输入边界 MUST 按 unknown field 规则静默忽略该 key
- **AND** 该 key MUST NOT 改变任一 Capability 展示名称
- **AND** 其他合法 AICOConfig 字段 MUST 继续生效

### Requirement: AICOConfig default behavior when fields are absent

AICOConfig 新增字段缺失或非法时，前端 MUST 使用以下默认值：

- `panelPosition`：`top` 默认 `PREL_MENU_HEIGHT`（63.2），`bottom` 默认 `0`，`left`/`right` 默认由 `inferDockSide` 决定（`left: 0` 或 `right: 0`）
- `closeBehavior`：`'hide'`
- `initialDisplayState`：`{ showEntrance: true, showPanel: false, minimized: false }`（与 `defaultDisplayState` 一致）
- `controls`：全部默认 `true`
- `minimizedStyle`：`{ position: 'fixed', bottom: 16, right: 16, width: 360, borderRadius: 8 }`（与当前硬编码值一致）

**需求类别**：功能性需求

#### Scenario: 不传 panelPosition 使用硬编码位置

- **WHEN** AICOConfig 不包含 `panelPosition`
- **THEN** 面板 docked 布局 MUST 使用 `top: PREL_MENU_HEIGHT`、`bottom: 0`、`left: 0` 或 `right: 0`

#### Scenario: 不传 closeBehavior 使用 hide 行为

- **WHEN** AICOConfig 不包含 `closeBehavior`
- **THEN** close 按钮 MUST 调用 `closePanel()`，行为与当前完全一致

#### Scenario: 不传 minimizedStyle 使用默认最小化样式

- **WHEN** AICOConfig 不包含 `minimizedStyle`
- **THEN** 最小化面板 MUST 使用 `{ position: 'fixed', bottom: 16, right: 16, width: 360, borderRadius: 8 }`

#### Scenario: 空对象使用全部默认值

- **WHEN** AICOConfig 是 empty object `{}`
- **THEN** 全部界面与行为 MUST 与没有 AICOConfig 时相同
- **AND** AICOConfig MUST NOT 提供任何 Capability 名称配置

#### Scenario: 缺省 operators 只显示默认按钮

- **WHEN** AICOConfig 不包含 `operators`
- **THEN** toolbar / sidebar MUST 只显示默认按钮

#### Scenario: entranceStyle 缺省时不影响其他定制

- **WHEN** AICOConfig 提供其他合法字段但不包含 `entranceStyle`
- **THEN** 其他合法定制 MUST 正常生效
- **AND** 入口按钮 MUST 使用当前默认样式

#### Scenario: 其他定制不影响 Capability 名称来源

- **WHEN** AICOConfig 提供任意合法的外观或行为定制字段
- **THEN** 这些定制 MUST 正常生效
- **AND** Capability 业务标题 MUST 继续只使用 Provider-backed 展示资源与其降级行为

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：AICOConfig 新增 5 个 optional 字段（`panelPosition`、`closeBehavior`、`initialDisplayState`、`controls`、`minimizedStyle`），全部缺省时行为不变。
- **依据 Requirements**：`AICOConfig configuration type and field definitions`、`AICOConfig default behavior when fields are absent`

### 规格

- **规格项**：AICOConfig 配置字段
- **变更类型**：修改
- **目标规格值**：新增 5 个字段的类型定义和默认值
- **依据 Requirements**：`AICOConfig configuration type and field definitions`、`AICOConfig default behavior when fields are absent`

### 主规格

- **变更类型**：修改
- **目标内容**：`aico-config-contract`
- **依据 Requirements**：`AICOConfig configuration type and field definitions`、`AICOConfig default behavior when fields are absent`
