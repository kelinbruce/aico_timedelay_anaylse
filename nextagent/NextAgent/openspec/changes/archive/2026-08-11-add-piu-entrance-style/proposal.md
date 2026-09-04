## Why

PIU 集成时入口按钮（`AIAgentEntrance`）的样式完全由内置 CSS class 固定，集成方只能通过 `entranceIcon` 替换图标，无法调整入口按钮的定位、尺寸、圆角等视觉属性。不同平台的嵌入场景对入口按钮的位置和外观有不同要求，当前缺少一个受控的样式传入入口。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- AICOConfig 新增可选的 `entranceStyle` 字段，允许集成方通过 `loadAIAgent` payload 传入 CSS 样式对象，作为 inline style 叠加到 PIU 入口按钮上。
- `entranceStyle` 值只接受 string 和 number 类型的键值对，非 string/number 值在校验时被过滤，不产生副作用。
- 字段缺省时入口按钮保持当前默认样式，不引入任何行为变化。

**非目标：**

- 不为面板（`ai-agent-piu-panel`）、header 或其他 PIU 内部组件新增样式传入入口；本次只覆盖入口按钮。
- 不引入 CSS class 覆盖机制或样式优先级协商；`entranceStyle` 纯粹是 inline style 叠加。
- 不修改 `entranceIcon` 的 base64 图标校验和 fallback 逻辑。
- 不修改 `ExpandPanel` 的 `lineHeight: 'normal'` 调整；该改动是纯 CSS 修复，不涉及 contract 变更。

## What Changes

- AICOConfig 新增 `entranceStyle?: Readonly<Record<string, string | number>>` 字段。
- `validateAICOConfig` 新增 `validateEntranceStyle` 校验函数：非对象返回 `undefined`，过滤非 string/number 值，空对象返回 `undefined`。
- `AIAgentEntrance` 组件的入口按钮新增 `style={aicoConfig?.entranceStyle}`，将传入样式作为 inline style 应用。
- `ExpandPanel` 最外层 div 的 inline style 新增 `lineHeight: 'normal'`，防止继承行高影响内容布局。

## Feature 影响（Features）

### 修改的 Feature

- `F-10.6 前端定制`：集成方可以通过 AICOConfig 的 `entranceStyle` 字段定制 PIU 入口按钮的 CSS 样式，无需修改源码。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.6 前端定制` -> `specs/aico-config-contract/spec.md`
  - 功能边界：AICOConfig 增加 `entranceStyle` 可选字段，允许集成方传入 CSS 键值对作为入口按钮 inline style。
  - 系统质量属性：安全、可维护性、可测试性。
  - 映射说明：本 change 触及已有主规格 `aico-config-contract`，不新增 Function 或 spec 映射。
- `FN-10.6 前端定制` -> `specs/aico-display-control/spec.md`
  - 功能边界：入口按钮的显示控制增加 `entranceStyle` 样式叠加能力。
  - 系统质量属性：安全、可维护性、可测试性。
  - 映射说明：本 change 触及已有主规格 `aico-display-control`，不新增 Function 或 spec 映射。

## 影响范围（Impact）

- 平台集成方可以在 `loadAIAgent` payload 中传入 `entranceStyle` 对象，定制入口按钮的定位、尺寸、圆角等 CSS 属性。
- 未提供 `entranceStyle` 时，入口按钮外观和行为与当前完全一致。
- 后端 API、Runtime、Gateway、持久化、Capability 和部署配置不受影响。