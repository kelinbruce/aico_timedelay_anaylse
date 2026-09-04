## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.6 前端定制` | AICOConfig 增加 `entranceStyle` 字段，允许集成方传入 CSS 键值对作为入口按钮 inline style | `aico-config-contract`、`aico-display-control` | `FN-10.6 前端定制` |

## `FN-10.6 前端定制`

### 目标与规范依据

本设计呼应 proposal 中"让集成方通过 AICOConfig 定制 PIU 入口按钮样式"的目标。`entranceStyle` 只用于入口按钮的视觉样式叠加，不改变入口按钮的交互行为（点击打开面板）、图标渲染逻辑（`entranceIcon` base64 + fallback）或显示控制（`showEntrance`）。

#### 本 Function 的目标 Requirements

canonical spec：`aico-config-contract`

- `MODIFIED`：AICOConfig configuration type and field definitions
- `MODIFIED`：AICOConfig validation uses hand-written functions
- `MODIFIED`：AICOConfig default behavior when fields are absent

canonical spec：`aico-display-control`

- `MODIFIED`：Icon fields use base64 and override defaults

### 当前实现

- `AICOConfig` 类型定义在 `frontend/agent-web/src/aico-config/types.ts`，已包含 `entranceIcon`、`guideIcon`、`icon` 等 icon 字段，但无样式传入字段。
- `validateAICOConfig` 使用 hand-written 校验函数，对每个字段按类型校验；icon 字段只校验非空字符串。
- `AIAgentEntrance` 组件渲染入口按钮，使用 CSS class `ai-agent-piu-entrance` 和 `ai-agent-piu-logo`，图标通过 `entranceIcon` + fallback 到 `logo.svg`。
- `ExpandPanel` 最外层 div 使用 inline style 设置 `position`、`height`、`display`、`flexDirection`，未显式设置 `lineHeight`。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 集成方可传入入口按钮 CSS 样式 | AICOConfig 无样式字段，入口按钮样式完全由 CSS class 固定 | 缺少 `entranceStyle` 字段定义、校验和应用 |
| 样式值类型安全 | 无样式校验逻辑 | 需新增校验函数，过滤非 string/number 值 |
| 缺省时保持默认 | 无该字段，无需处理 | 新字段缺省时 `undefined`，不应用 inline style |
| ExpandPanel 行高正常 | 未显式设置 `lineHeight`，可能继承异常行高 | 补充 `lineHeight: 'normal'` |

### 修改方案

唯一实现路径如下：

1. 在 `AICOConfig` 类型中新增 `entranceStyle?: Readonly<Record<string, string | number>>` 字段，位于 `entranceIcon` 之后。
2. 在 `validateAICOConfig.ts` 新增 `validateEntranceStyle` 函数：
   - 输入非对象时返回 `undefined`。
   - 遍历对象属性，只保留 `string` 和 `number` 类型的值。
   - 过滤后为空对象时返回 `undefined`。
   - 在 `validateAICOConfig` 主函数中，于 icon 字段循环之后调用该校验函数。
3. 在 `AIAgentEntrance` 组件的 `<button>` 上新增 `style={aicoConfig?.entranceStyle}`，将传入样式作为 inline style 叠加。
4. 在 `ExpandPanel` 最外层 div 的 inline style 中新增 `lineHeight: 'normal'`。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `entranceStyle` 只接受 string/number 值 | 校验函数过滤非 string/number 值，不执行或解释样式内容 | 非对象、非 string/number 值被过滤；不产生 console warning |
| 可维护性 | 无新增黑质量量目标 | 单一校验函数，不建立第二套样式传入机制 | 字段定义、校验和应用位置一致 |
| 可测试性 | 无新增黑质量量目标 | 纯校验函数行为通过 unit test 覆盖 | 正向保留、负向过滤、空对象、非对象路径覆盖 |

## 验证策略（Verification Strategy）

- 在 `frontend/agent-web` 运行 `npx vitest run src/aico-config/validateAICOConfig.test.ts`，覆盖 `entranceStyle` 的合法值保留、非法值过滤、非对象返回空、空对象返回空四个路径。
- 在 `frontend/agent-web` 运行 `npx tsc --noEmit`，确认 TypeScript 类型兼容。
- 在 `frontend/agent-web` 运行 `npx vitest run src/aico-config/regression.test.ts src/features/expand-panel/ExpandPanelStore.test.ts src/features/expand-panel/expandPanelLayout.test.tsx`，确认无回归。
- 运行 `openspec validate add-piu-entrance-style --strict`，确认 OpenSpec 结构合法。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/aico-config-contract/spec.md`：归档时合并 `entranceStyle` 字段定义、校验规则和默认行为。
- `openspec/specs/aico-display-control/spec.md`：归档时合并入口按钮样式叠加描述。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.2-集成与定制/FN-10.6-前端定制.md`：补充 `entranceStyle` 样式传入能力摘要。
- `openspec/designs/features/D10-二次开发与平台集成/D10.2-集成与定制/F-10.6-前端定制.md`：补充集成方定制入口按钮样式的用户价值摘要。
- `openspec/designs/spec-to-design-map.md`：更新 `aico-config-contract` 和 `aico-display-control` 的设计摘要与验证入口。

## 风险与取舍（Risks / Trade-offs）

- `entranceStyle` 作为 inline style 会覆盖 CSS class 中的同名属性；这是预期行为，集成方需自行确保样式不破坏入口按钮的可点击性和可访问性。
- 只接受 string/number 值，不支持嵌套对象或函数值；这保持了 React `CSSProperties` 的类型安全边界。

## 待确认问题（Open Questions）

无。