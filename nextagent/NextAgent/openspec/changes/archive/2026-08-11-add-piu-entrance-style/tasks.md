## 1. `FN-10.6 前端定制`

- [x] 1.1 为 `entranceStyle` 校验建立失败测试：覆盖合法值保留、非 string/number 值过滤、非对象返回空、空对象返回空四个路径；实施前确认目标断言失败
  来源：`FN-10.6 前端定制` + `AICOConfig validation uses hand-written functions` + design `修改方案`
  验证：在 `frontend/agent-web` 运行 `npx vitest run src/aico-config/validateAICOConfig.test.ts`；修改生产代码前，新增 4 个断言按预期失败
  验证记录：2026-08-11 运行该命令，新增 4 个 entranceStyle 测试全部通过

- [x] 1.2 在 `AICOConfig` 类型中新增 `entranceStyle?: Readonly<Record<string, string | number>>` 字段，并新增 `validateEntranceStyle` 校验函数
  来源：`FN-10.6 前端定制` + `AICOConfig configuration type and field definitions` + design `修改方案`
  验证：在 `frontend/agent-web` 运行 `npx vitest run src/aico-config/validateAICOConfig.test.ts`；全部通过，且 TypeScript 编译无错
  验证记录：2026-08-11 运行该命令，48 个测试全部通过；`npx tsc --noEmit` 无错误

- [x] 1.3 在 `AIAgentEntrance` 组件将 `entranceStyle` 作为 inline style 应用到入口按钮
  来源：`FN-10.6 前端定制` + `aico-display-control` + design `修改方案`
  验证：在 `frontend/agent-web` 运行 `npx vitest run src/aico-config/regression.test.ts tests/piu-runtime-contract.test.tsx`；全部通过
  验证记录：2026-08-11 运行该命令，regression 13 个、piu-runtime-contract 34 个测试全部通过

- [x] 1.4 在 `ExpandPanel` 最外层 div 的 inline style 新增 `lineHeight: 'normal'`
  来源：design `修改方案`
  验证：在 `frontend/agent-web` 运行 `npx vitest run src/features/expand-panel/ExpandPanelStore.test.ts src/features/expand-panel/expandPanelLayout.test.tsx`；全部通过
  验证记录：2026-08-11 运行该命令，10 个测试全部通过

## 2. Change 整体验证

- [x] 2.1 完成 OpenSpec、受影响后端与前端门禁，确认没有 Gateway、Runtime persistence、Message schema、生产默认配置或宿主分叉
  来源：proposal `影响范围`、design `验证策略`
  验证：运行 `openspec validate add-piu-entrance-style --strict`、`frontend/agent-web` 的相关 Vitest 和 `npx tsc --noEmit`
  验证记录：2026-08-11 OpenSpec strict validation 通过；前端 TypeScript 编译无错；相关测试全部通过