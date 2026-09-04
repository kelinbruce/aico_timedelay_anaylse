## Function

- **所属 Function**：`FN-10.6 前端定制`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Icon fields use base64 and override defaults

AICOConfig icon fields（`icon`、`entranceIcon`、`guideIcon`）SHALL 是 base64-encoded strings that replace the corresponding default icons when provided. `activeIcon` is reserved and MUST NOT be consumed in this change.

Icon mapping:

- `icon`：replaces the top bar / sidebar header icon
- `entranceIcon`：replaces the collaborative entrance button icon
- `guideIcon`：replaces the welcome page brand icon

`entranceStyle` SHALL 是一个可选的 CSS 键值对对象，其键为 CSS 属性名（camelCase），值为 `string` 或 `number`。前端 MUST 将 `entranceStyle` 作为 inline style 叠加到入口按钮（`AIAgentEntrance` 的 `<button>`）上。`entranceStyle` 的 inline style MUST 覆盖 CSS class 中的同名属性。

When an icon field is absent, the corresponding default icon MUST be used. When a base64 string is malformed or cannot be decoded as an image, the frontend MUST fall back to the default icon and emit a `console.warn`. When `entranceStyle` is absent, the frontend MUST NOT apply additional inline style to the entrance button.

**需求类别**：功能性需求

#### Scenario: entranceStyle 叠加到入口按钮

- **GIVEN** AICOConfig with `entranceIcon: "data:image/png;base64,iVBOR..."` and `entranceStyle: { right: 16, bottom: '20px' }`
- **WHEN** the entrance button renders
- **THEN** the entrance button MUST display the decoded base64 icon
- **AND** the entrance button MUST apply `right: 16` and `bottom: '20px'` as inline style

#### Scenario: entranceStyle absent uses default styling

- **WHEN** AICOConfig does not provide `entranceStyle`
- **THEN** the entrance button MUST NOT apply additional inline style
- **AND** the entrance button MUST use CSS class default styling
## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：入口按钮渲染时，将 `entranceStyle` 作为 inline style 叠加到 `<button>` 上，覆盖 CSS class 中的同名属性。
- **依据 Requirements**：`Icon fields use base64 and override defaults`

### 结果

- **变更类型**：修改
- **目标内容**：入口按钮支持集成方通过 `entranceStyle` 定制定位、尺寸、圆角等 CSS 属性；未提供时使用 CSS class 默认样式。
- **依据 Requirements**：`Icon fields use base64 and override defaults`

### 覆盖特性

- **变更类型**：修改
- **目标内容**：`F-10.6 前端定制` 增加入口按钮 CSS 样式叠加能力。
- **依据 Requirements**：`Icon fields use base64 and override defaults`