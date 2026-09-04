## 1. 类型定义与校验

- [x] 1.1 在 `types.ts` 新增 `PanelPosition`、`CloseBehavior` 类型，扩展 `AICOConfig` 接口新增 5 个 optional 字段
  来源：`aico-config-contract` + `AICOConfig configuration type and field definitions`
  验证：`cd frontend/agent-web && npx tsc --noEmit`

- [x] 1.2 在 `validateAICOConfig.ts` 新增 `validatePanelPosition`、`validateCloseBehavior`、`validateInitialDisplayState`、`validateControls`、`validateMinimizedStyle` 校验函数
  来源：`aico-config-contract` + Scenario `panelPosition 合法值被保留` / `closeBehavior 合法值被保留` / `initialDisplayState 合法值被保留` / `controls 非 boolean 值被过滤` / `minimizedStyle 复用 entranceStyle 校验`
  验证：`cd frontend/agent-web && npx vitest run src/aico-config/validateAICOConfig.test.ts`

- [x] 1.3 在 `validateAICOConfig.test.ts` 新增 5 个新字段的校验测试：合法值保留、非法值过滤、缺省返回 undefined
  来源：`aico-config-contract` + 全部 Scenario
  验证：`cd frontend/agent-web && npx vitest run src/aico-config/validateAICOConfig.test.ts`

## 2. 显示状态与 store

- [x] 2.1 在 `displayState.ts` 修改 `normalizeDisplayState`：新增可选 `options` 参数，`closeBehavior === 'minimize'` 时跳过 `!showEntrance && showPanel` 规则
  来源：`agent-web-piu-minimize` + Scenario `normalizeDisplayState 在 closeBehavior minimize 下放开规则` / `normalizeDisplayState 不传 options 保留原规则`
  验证：`cd frontend/agent-web && npx vitest run tests/piu-state.test.ts`

- [x] 2.2 在 `runtimeStore.ts` 新增 `closeBehavior` 内部字段、`setCloseBehavior` 方法，修改 `closePanel` 在 `closeBehavior === 'minimize'` 时调用 `minimize()`
  来源：`aico-display-control` + `closeBehavior controls close button action` + Scenario `closeBehavior minimize 时关闭按钮触发最小化`
  验证：`cd frontend/agent-web && npx vitest run tests/piu-state.test.ts`

- [x] 2.3 在 `piu-state.test.ts` 新增测试：`closeBehavior: 'minimize'` 时 `closePanel()` 调用 `minimize()`；默认 `closeBehavior` 时 `closePanel()` 走原逻辑；`normalizeDisplayState` 不传 options 时原规则不变；传 `closeBehavior: 'minimize'` 时放开规则
  来源：`agent-web-piu-minimize` + `aico-display-control`
  验证：`cd frontend/agent-web && npx vitest run tests/piu-state.test.ts`

## 3. handler 接线

- [x] 3.1 在 `registerAIAgentPIU.tsx` 修改 `loadAIAgentWithConfig`：应用 `closeBehavior` 到 store；应用 `initialDisplayState` 到 `normalizeDisplayState`（传入 `closeBehavior`）
  来源：`aico-display-control` + `initialDisplayState controls initial panel state on load` + Scenario `initialDisplayState 应用初始最小化`
  验证：`cd frontend/agent-web && npx vitest run tests/piu-runtime-contract.test.tsx`

- [x] 3.2 在 `registerAIAgentPIU.tsx` 修改 `displayAIAgent` handler：未传字段保留当前值；传入 `closeBehavior` 到 `normalizeDisplayState`
  来源：`aico-display-control` + `displayAIAgent preserves current values for absent fields` + Scenario `displayAIAgent 只传 showPanel 保留 showEntrance`
  验证：`cd frontend/agent-web && npx vitest run tests/piu-runtime-contract.test.tsx`

## 4. 面板渲染

- [x] 4.1 在 `AIAgentPiuRuntime.tsx` 修改 `panelStyle` useMemo：docked 布局从 `panelPosition` 读取 `top`/`bottom`/`left`/`right`，缺省使用硬编码值
  来源：`aico-layout-mode` + `panelPosition controls panel fixed positioning`
  验证：`cd frontend/agent-web && npx vitest run tests/piu-runtime-contract.test.tsx`

- [x] 4.2 在 `AIAgentPiuRuntime.tsx` 修改 expand panel 位置：`top`/`bottom` 跟随 `panelPosition`；`left`/`right` 根据面板在左还是右自动推断
  来源：`aico-layout-mode` + `expand panel follows panelPosition`
  验证：`cd frontend/agent-web && npx vitest run tests/piu-runtime-contract.test.tsx`

- [x] 4.3 在 `AIAgentPiuRuntime.tsx` 修改 expand panel useEffect：不强制 `setDocked(width, 'right')`，保留当前 `layout.side`
  来源：`aico-layout-mode` + `expand panel follows panelPosition` + Scenario `expand panel 不强制 right`
  验证：`cd frontend/agent-web && npx vitest run tests/piu-runtime-contract.test.tsx`

- [x] 4.4 在 `AIAgentPiuRuntime.tsx` 修改 header 控件：从 `controls` 读取 `maximize`/`close`/`dockFloat`/`drag`/`resize`，条件渲染按钮和交互
  来源：`aico-layout-mode` + `controls toggles header controls and interactions`
  验证：`cd frontend/agent-web && npx vitest run tests/piu-runtime-contract.test.tsx`

- [x] 4.5 在 `AIAgentPiuRuntime.tsx` 修改 `panelStyle` minimized 分支：从 `minimizedStyle` 读取，叠加到默认值上
  来源：`aico-layout-mode` + `minimizedStyle overrides minimized panel inline style` + `agent-web-piu-minimize`
  验证：`cd frontend/agent-web && npx vitest run tests/piu-runtime-contract.test.tsx`

## 5. 契约测试

- [x] 5.1 在 `piu-runtime-contract.test.tsx` 新增测试：`panelPosition` 渲染、`controls` 隐藏控件、`closeBehavior` 分流、`initialDisplayState` 应用、`minimizedStyle` 覆盖、`displayAIAgent` 保留当前值
  来源：全部 spec delta + Scenario
  验证：`cd frontend/agent-web && npx vitest run tests/piu-runtime-contract.test.tsx`

## 6. 构建验证

- [x] 6.1 前端类型检查和多宿主构建验证
  来源：AGENTS.md 验证门禁
  验证：`cd frontend/agent-web && npm run build && npm run build:vite:modes`

## 7. expand panel 宽度回退与恢复

- [x] 7.1 修改 `expandPanelPiuWidth` 取值优先级为 `minWidth > width > DOCKED_DEFAULT_WIDTH`
  来源：`aico-layout-mode` + Scenario `expand panel 打开时面板宽度缩小为 minWidth`
  验证：`cd frontend/agent-web && npx vitest run tests/piu-runtime-contract.test.tsx -t "expand panel width fallback"`；4/4 passed

- [x] 7.2 expand panel 关闭时恢复面板宽度为 `panelFullWidth`（`modalSize.width > DOCKED_DEFAULT_WIDTH`）
  来源：`aico-layout-mode` + Scenario `expand panel 关闭时恢复面板宽度`
  验证：`cd frontend/agent-web && npx vitest run tests/piu-runtime-contract.test.tsx -t "expand panel width fallback"`；4/4 passed

- [x] 7.3 新增 expand panel 宽度回退和恢复测试
  来源：`aico-layout-mode` + Scenario
  验证：`cd frontend/agent-web && npx vitest run tests/piu-runtime-contract.test.tsx -t "expand panel width fallback"`；4/4 passed

- [x] 7.4 更新 `aico-layout-mode` delta spec 补充宽度行为描述和 scenario
  来源：design `aico-layout-mode > 修改方案`
  验证：`openspec validate --all --strict`；通过

- [x] 7.5 补充 controls 渲染测试（使用 loadPiuRuntimeComponent 断言按钮隐藏/resize 不渲染）
  来源：`aico-layout-mode` + `controls toggles` + code review P1 修复
  验证：`cd frontend/agent-web && npx vitest run tests/piu-runtime-contract.test.tsx -t "controls rendering"`；4/4 passed
## 8. expand panel 偏移修复、关闭清理和 updatePanelLayout handler

- [ ] 8.1 修复 expand panel 偏移：当 `panelPosition.left` 或 `panelPosition.right` 不为 0 时，expand panel 的 `left`/`right` 加上对应偏移量
  来源：`aico-layout-mode` + `expand panel follows panelPosition` + Scenario `expand panel 偏移加上 panelPosition.left` / `expand panel 偏移加上 panelPosition.right`
  验证：`cd frontend/agent-web && npx vitest run tests/piu-runtime-contract.test.tsx`

- [ ] 8.2 关闭面板时清理 expand panel：`showPanel` 变 false 时关闭 expand panel + dispatch `smart-canvas:clearExpandPanel`
  来源：`aico-display-control` + `关闭面板时清理 expand panel` + Scenario `displayAIAgent 关闭面板时清理 expand panel` / `closePanel 在 hide 模式时清理 expand panel`
  验证：`cd frontend/agent-web && npx vitest run tests/piu-runtime-contract.test.tsx`

- [ ] 8.3 新增 `updatePanelLayout` handler：更新 `panelPosition`、`modalSize`、`minimizedStyle`，不触发卸载
  来源：`aico-display-control` + `updatePanelLayout handler updates current panel layout`
  验证：`cd frontend/agent-web && npx vitest run tests/piu-runtime-contract.test.tsx`

- [ ] 8.4 新增测试覆盖上述三个修复
  来源：全部 spec delta + Scenario
  验证：`cd frontend/agent-web && npx vitest run tests/piu-runtime-contract.test.tsx`
- [ ] 8.6 修改入口按钮渲染条件：最小化时 showEntrance === true 的入口按钮继续渲染
  来源：gent-web-piu-minimize + Scenario 最小化时入口按钮继续渲染
  验证：cd frontend/agent-web && npx vitest run tests/piu-runtime-contract.test.tsx

## 归档前更新基线检查（非实施任务）

归档时按 design 的"长期基线刷新计划"更新 `openspec/specs/aico-config-contract/spec.md`、`openspec/specs/aico-layout-mode/spec.md`、`openspec/specs/aico-display-control/spec.md`、`openspec/specs/agent-web-piu-minimize/spec.md`、`openspec/designs/modules/agent-web.md`。