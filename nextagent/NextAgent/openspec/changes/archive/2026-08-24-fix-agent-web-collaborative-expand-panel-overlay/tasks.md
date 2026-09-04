## 0. Change 前置与复现

- [x] 0.1 验证 OpenSpec artifacts 语法与跨 artifact 一致性，确认 delta 只修改 `agent-web-expand-panel` 的 Collaborative 布局 Requirement。
  来源：proposal scope + design 设计范围
  验证：
  - `./node_modules/.bin/openspec validate fix-agent-web-collaborative-expand-panel-overlay --type change --strict`；预期本 change 通过。
  - `./node_modules/.bin/openspec validate --all --strict`；实际 275 passed / 25 failed，本 change 通过，25 个失败为当前仓库既有 active change/spec 问题。

- [x] 0.2 在修改实现前用目标行为测试复现缺陷：PIU host 下扩展面板打开时对话 pane 仍为 `0 0 484px`，且 PIU 面板收窄到基准宽度以下时扩展面板边界不跟随共享视口规则。
  来源：`agent-web-expand-panel` + `Collaborative 模式下的扩展面板布局` + `基准宽度内共享视口`
  验证：
  - `cd frontend/agent-web && npm test -- tests/chat-page.route-state.test.tsx -t 'lets the PIU conversation pane fill the host panel'`：修改前失败，实际结果为 `0 0 484px`。
  - `cd frontend/agent-web && npm test -- tests/piu-runtime-contract.test.tsx -t 'keeps the expand panel boundary at the base width'`：修改前失败，400px PIU 面板时扩展面板边界仍为 484px。

## 1. `agent-web-expand-panel`

- [x] 1.1 增加 PIU runtime 布局契约测试，覆盖 PIU 面板 484px、684px、400px 时扩展面板边界的共享与覆盖行为。
  来源：`agent-web-expand-panel` + `Collaborative 模式下的扩展面板布局` + `基准宽度内共享视口` / `超过基准宽度时覆盖扩展面板`
  验证：`cd frontend/agent-web && npm test -- tests/piu-runtime-contract.test.tsx`；预期 62/62 passed，新增测试断言 684px 时边界保持 484px、400px 时边界为 400px。

- [x] 1.2 增加 ChatPage host-mode 布局测试，断言 PIU host 下对话 pane 填满面板，local host 保持既有 484px 规则。
  来源：`agent-web-expand-panel` + `Collaborative 模式下的扩展面板布局` + `Collaborative 模式打开扩展面板`
  验证：`cd frontend/agent-web && npm test -- tests/chat-page.route-state.test.tsx`；预期 109/109 passed，PIU 为 `1 1 auto`，local 为 `0 0 484px`。

- [x] 1.3 实现 Collaborative 布局修正：扩展面板右边界使用 `min(当前 docked PIU 面板宽度, 基准宽度)`，PIU host 下 ChatPage 对话 pane 不再套用 local/immersive 的固定 484px flex 约束。
  来源：design `agent-web-expand-panel > 修改方案`
  验证：
  - `cd frontend/agent-web && npm test -- tests/piu-runtime-contract.test.tsx`；预期 62/62 passed。
  - `cd frontend/agent-web && npm test -- tests/chat-page.route-state.test.tsx`；预期 109/109 passed。

## 2. Collaborative 浏览器旅程验证

- [x] 2.1 增加并运行 collaborative E2E：打开记忆管理后拖宽 PIU 面板，断言对话内容变宽且左侧扩展面板宽度保持不变。
  来源：`agent-web-expand-panel` + `Collaborative 模式下的扩展面板布局` + `超过基准宽度时覆盖扩展面板`
  验证：`cd frontend/agent-web && PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:e2e -- tests/e2e/collaborative-layout.spec.cjs`；预期 1/1 passed。

## 3. Change 整体验证

- [x] 3.1 运行前端类型检查、多宿主构建和 diff 检查，确认 local/immersive/PIU 多宿主产物可构建。
  来源：proposal 影响范围 + design 验证策略
  验证：
  - `cd frontend/agent-web && npm run build`；预期 TypeScript 检查通过。
  - `cd frontend/agent-web && npm run build:vite:modes`；预期 multi-host-page 与 PIU artifacts 构建成功。
  - `git diff --check`；预期无 whitespace error。

## 归档前更新基线检查（非实施任务）

归档时按 design 的“长期基线刷新计划”更新 `openspec/specs/agent-web-expand-panel/spec.md`、`openspec/designs/architecture/agent-web-host-modes.md` 和 `openspec/designs/modules/agent-web.md`，并确认 Function、Feature、overview、ADR 与 spec-to-design-map 无需额外变化。
