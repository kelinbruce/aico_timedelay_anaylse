# Tasks: 统一 Agent Web 前端诊断输出

## 1. `FN-10.6 前端定制`

- [x] 1.1 新增 `frontend/agent-web/src/utils/diagnostics.test.ts`：先锁定 reporter 的 warning/error/debug 级别分发与参数保真，并新增 source-level architecture 断言——除 `frontend/agent-web/src/utils/diagnostics.ts` 外，`frontend/agent-web/src/**/*.{ts,tsx}` 不存在直接 `console.(log|debug|info|warn|error)(` 调用。
  来源：`FN-10.6` + 系统质量属性（可维护性、可测试性）+ Requirement `Agent Web diagnostics use runtime-owned reporters` + Scenarios `业务源码不直接依赖 console`、`诊断不改变业务结果`
  验证：在 `frontend/agent-web` 运行 `npm test -- src/utils/diagnostics.test.ts`；实施前预期 reporter 分发与 architecture 断言均失败，用于确认测试有效。
  实际结果（2026-08-22）：首次运行失败于无法 resolve `src/utils/diagnostics.ts`，证明 reporter 目标测试先行； reporter 落地后同一测试中 3 项级别分发通过，architecture 断言失败并列出 10 个既有直接调用文件。

- [x] 1.2 新增 `frontend/agent-web/src/utils/diagnostics.ts`：导出同步 `reportWarning`、`reportError`、`reportDebug`，按级别原样输出 `message` 与 `details`，不改变控制流、不渲染 UI、不网络上报、不持久化。
  来源：`FN-10.6` + 系统质量属性（可维护性、可测试性）+ Requirement `Agent Web diagnostics use runtime-owned reporters` + Scenarios `诊断不改变业务结果`、`诊断不进入产品输出或外部边界`
  验证：在 `frontend/agent-web` 运行 `npm test -- src/utils/diagnostics.test.ts`；预期 reporter 三项级别分发测试通过，architecture 断言仍在既有直接调用处失败。
  实际结果（2026-08-22）：`reportWarning` / `reportError` / `reportDebug` 3 项参数保真测试通过；architecture 断言按预期失败并列出 10 个待迁移生产文件。

- [x] 1.3 迁移 `frontend/agent-web/src` 生产源码中的全部 `console.warn`、`console.error`、`console.debug` 调用到对应 reporter 函数，覆盖 AICOConfig、PIU、local/immersive entry、Mermaid、stream connection 和 mock Prel；保持原调用时机、message、details、降级与错误处理行为。
  来源：`FN-10.6` + Requirement `Agent Web diagnostics use runtime-owned reporters` + Scenarios `业务源码不直接依赖 console`、`诊断不改变业务结果`
  验证：在 `frontend/agent-web` 运行 `npm test -- src/utils/diagnostics.test.ts src/aico-config/validateAICOConfig.test.ts src/aico-config/loadSessionStorageAICOConfig.test.ts src/entries/aico-config-entry-loading.test.tsx src/host/prel-mock.test.tsx` 与 `npm run build`；预期测试与 TypeScript build 均通过。
  实际结果（2026-08-22）：5 个目标测试文件 55/55 通过，覆盖 AICOConfig 校验/加载、local 与 immersive entry 启动、mock Prel no-op 以及 source architecture 断言；`npm run build` 退出 0。

## 2. Change 整体验证

- [x] 2.1 验证浏览器生产源码边界与 OpenSpec 变更一致性：确认 `frontend/agent-web/src` 只有 `utils/diagnostics.ts` 直接访问 console，测试与 Node scripts 不被误改，Change strict validate 通过；mock server 后续由第 3 节扩展覆盖。
  来源：proposal 非目标 + design `修改方案`、`验证策略`
  验证：仓库根目录运行 `rg -n --glob '*.{ts,tsx}' '\\bconsole\\.(log|debug|info|warn|error)\\s*\\(' frontend/agent-web/src` 仅输出 `src/utils/diagnostics.ts`；运行 `./node_modules/.bin/openspec validate replace-agent-web-console-diagnostics --strict`，预期 valid。
  实际结果（2026-08-22）：`rg` 仅在 `frontend/agent-web/src/utils/diagnostics.ts` 找到 3 处受控 console 调用；当时 `git status --short` 显示未修改测试、Node scripts 或 `agent-web-mock-server`；Change strict validate 输出 valid。补充：`openspec validate --all --strict` 当前 288 通过 / 26 失败，失败项为其他 active/stable 债务，本 change 在输出中为 valid。

## 归档前更新基线检查（非实施任务）

按 design 的“长期基线刷新计划”同步 stable specs 与 `FN-10.6` Function 文档；归档前重新运行 `./node_modules/.bin/openspec validate --all --strict` 并检查新增诊断事实没有在长期文档中形成第二个 owner。

## 3. `FN-10.6` Mock server 诊断范围扩展

- [x] 3.1 新增 mock server reporter 与防回退断言：在 `frontend/agent-web-mock-server/diagnostics.js` 提供 `logInfo` / `logWarning` / `logError`，并在现有 Node tests 中断言除该文件外 server/routes/data 运行时源码不直接调用 `console.*`。
  来源：`FN-10.6` + 系统质量属性（可维护性、可测试性）+ Requirement `Agent Web diagnostics use runtime-owned reporters` + Scenario `Mock server 运行时源码不直接依赖 console`
  验证：在 `frontend/agent-web-mock-server` 运行 `npm test`；实施前 architecture 断言应因 5 个运行时文件存在直接调用而失败。
  实际结果（2026-08-22）：先安装 mock package 依赖后运行测试；reporter 参数/级别测试通过，architecture 断言按预期失败并列出 `server.js`、`routes/requests.js`、`routes/stream.js`、`routes/websocket.js`、`data/stream.js`。

- [x] 3.2 迁移 `frontend/agent-web-mock-server` server、routes 与 data stream 中全部直接 `console.log/warn/error` 调用到 reporter；保留原输出级别、参数、调用时机与 HTTP/WS/SSE 行为。
  来源：`FN-10.6` + Requirement `Agent Web diagnostics use runtime-owned reporters` + Scenarios `Mock server 运行时源码不直接依赖 console`、`诊断不改变业务结果`
  验证：在 `frontend/agent-web-mock-server` 运行 `npm test`；在 `frontend/agent-web` 运行 `npm test -- tests/mock-server-session-search.test.ts tests/mock-server-process-history-stress.test.ts tests/mockServerStreamContract.test.ts`；预期全部通过。
  实际结果（2026-08-22）：mock server 14/14 通过；agent-web mock contract 相关 3 个测试文件 13/13 通过。启动 smoke 得到 `{"transportKind":"SSE"}`，启动横幅保留；`rg` 确认 mock 运行时源码仅 `diagnostics.js` 存在受控 console 调用。
