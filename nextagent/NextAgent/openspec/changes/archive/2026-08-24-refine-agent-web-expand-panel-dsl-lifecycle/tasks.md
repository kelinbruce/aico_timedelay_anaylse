## 0. 前置门禁

- [x] 0.1 OpenSpec 验证：`npx openspec validate --all --strict` 通过（253/253 passed）
  来源：proposal scope
  验证：`npx openspec validate --all --strict`

## 1. `agent-web-expand-panel`

- [x] 1.1 更新 delta spec：新增 DSL 引擎内容源、header 显隐、生命周期回调、容器 key 与 DOM 清理相关 requirement
  来源：design
  验证：`npx openspec validate --all --strict`

- [x] 1.2 更新 `ExpandPanelStore`：增加 `contentSource`、`openDsl`、`closeDsl`、`registerDslClearHandler`（9/9 tests passed）
  来源：design
  验证：`cd frontend/agent-web && npx vitest run src/features/expand-panel/ExpandPanelStore.test.ts`

- [x] 1.3 更新 `renderRoot`：DSL `init` 的 `handleExpandPanel` 映射到 `openDsl`/`closeDsl`
  来源：design
  验证：运行相关测试

- [x] 1.4 更新 `ExpandPanel`：按 `contentSource` 隐藏 header，容器 key 使用 `contentSource`（9/9 tests passed）
  来源：design
  验证：`cd frontend/agent-web && npx vitest run src/features/expand-panel/expandPanelLayout.test.tsx`

- [x] 1.5 在 `ImmersiveApp` 与 `AIAgentPiuRuntime` 注册 DSL 清理回调
  来源：design
  验证：审查代码 + 运行相关测试

- [x] 1.6 运行整体 build 与测试（tsc --noEmit 通过；build:vite:modes multi-host-page + piu 产物构建成功；expand-panel 25/25 passed；全量 2130 passed / 106 failed 为 pre-existing flaky）
  来源：proposal scope
  验证：`cd frontend/agent-web && npm run build && npx vitest run`
