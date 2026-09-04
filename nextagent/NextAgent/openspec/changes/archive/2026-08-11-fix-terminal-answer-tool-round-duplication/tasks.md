## 1. `FN-1.1 查看会话消息流`

- [x] 1.1 在真实 Agent Core/runtime 测试路径复现多 Tool 轮次说明进入最终 Assistant Message：保留两条逐轮 `ASSISTANT_TOOL_USE` 说明，同时断言最终可见 `ASSISTANT` 消息只等于终止轮次回答；在修改生产代码前运行测试并确认断言按预期失败。
  来源：`FN-1.1 查看会话消息流` + `Tool 轮次执行说明与 Tool 调用连续呈现` + `多个 Tool 轮次后只提交终止轮次回答`、`刷新历史不重新产生跨区域重复`。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/tool-loop.test.ts -t "persists each tool round" --reporter=dot`；预期修改生产代码前 FAIL，实际最终消息包含 `round-one`、`round-two` 和 `done`，而目标断言只接受 `done`。

- [x] 1.2 在 no-tool terminal boundary 使用当前终止模型轮次正文完成日志长度、output guard、terminal hook、checkpoint snapshot 和 final event；保持 Tool 轮次消息、live 累计投影、公共契约和 Runtime terminal commit 路径不变。
  来源：design `FN-1.1 查看会话消息流 / 修改方案`；`FN-1.1 查看会话消息流` + `Tool 轮次执行说明与 Tool 调用连续呈现` + `多个 Tool 轮次后只提交终止轮次回答`。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/tool-loop.test.ts -t "persists each tool round" --reporter=dot`；预期 PASS，两条 Tool 轮次消息分别只包含自身说明，最终可见 Assistant 消息只包含 `done`。

- [x] 1.3 增加终止轮次输出续写和 terminal hook characterization，证明同一终止轮次的已确认片段完整保留、hook 只接收终止轮次正文且合法 mutation/continuation 行为不回归。
  来源：`FN-1.1 查看会话消息流` + `Tool 轮次执行说明与 Tool 调用连续呈现` + `终止轮次输出续写保持完整且不带入先前说明`；design `验证策略`。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-core/tests/budget-degradation-notice.test.ts tests/agent-kernel/lifecycle-hook-execution-terminal.test.ts tests/agent-kernel/tool-loop.test.ts --reporter=dot`；预期全部 PASS，续写后的 final event、hook boundary 和最终消息均不包含先前 Tool 轮次说明。

- [x] 1.4 验证 process-message live/history 投影继续从逐轮 Tool 消息恢复说明，final Assistant Message 不参与过程正文关联且不需要前端去重。
  来源：`FN-1.1 查看会话消息流` + `Tool 轮次执行说明与 Tool 调用连续呈现` + `刷新历史不重新产生跨区域重复`；design `验证策略`。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/process-message-event-projection.test.ts packages/agent-channel-common/tests/process-message-projection.test.ts packages/agent-channel-web/tests/session-event-history-route.test.ts --reporter=dot`；预期全部 PASS，过程说明引用、顺序、正文唯一性和 history 安全投影保持不变。

- [x] 1.5 完成非终态 model `LLM_CONTENT_DELTA` 累计边界的群内确认：`content`/`text` 只在同一非空 `stepId` 内累计，跨 step 不继承正文；事件字段、runtime schema、terminal final event 和 owner 边界不变。
  来源：proposal/design「需群内确认」；`Tool 轮次执行说明与 Tool 调用连续呈现` 的 step 隔离目标。
  验证：2026-08-07 用户在当前 Codex 任务中明确回复“同意契约，继续”；群平台、群名称、消息链接、消息 ID 和明确确认人未提供。

- [x] 1.6 先增加 Agent Core 黑盒失败回归，证明后续 model step 的非终态 `LLM_CONTENT_DELTA` 不得包含先前 Tool 轮次说明，并覆盖跨 step 空白正文不会重放先前说明、不同 step 相同正文保持独立。
  来源：`Tool 轮次执行说明与 Tool 调用连续呈现` + `后续 model step 不继承先前执行说明`、`不同步骤的相同正文保持独立`；design「验证策略」。
  验证：修改生产代码前运行 `npx vitest run --config vitest.config.release.ts packages/agent-core/tests/agent-routing-core.test.ts -t "isolates live accumulated content by model step" --reporter=dot`，实际 1 FAIL；`turn-2/3/4` 分别得到 `same explanation `、`same explanation same explanation`、`same explanation same explanationdone`，而目标分别为单个空格、独立相同正文和 `done`，确认失败来自跨 step 前缀。

- [x] 1.7 删除 Agent Core 请求级累计正文链路，使 `ModelRouteExecution` 只累计当前 step 的 `confirmedContent + invocationContent`；删除旧双状态字段和只服务该形状的拼接/扣前缀 helper，不修改 public contract、channel 或 frontend。
  来源：design「修改方案」；`Tool 轮次执行说明与 Tool 调用连续呈现` 的 step 隔离 Scenarios。
  验证：1.6 的同一命令实际 1 PASS；随后运行 `npx vitest run --config vitest.config.release.ts packages/agent-core/tests/agent-routing-core.test.ts packages/agent-core/tests/model-output-recovery.test.ts packages/agent-core/tests/budget-degradation-notice.test.ts packages/agent-core/tests/model-fallback-orchestration.test.ts --reporter=dot`，实际 4 files / 111 tests PASS，覆盖同 step continuation、reasoning correction、fallback gate、150000 字符边界和终态行为。

- [x] 1.8 运行 Agent Core、process-message、channel projection 和 Agent Web 定向回归，确认 terminal/history 接管、相同文本独立事实、SSE/WebSocket 安全投影与前端 lane 规则无需生产修改。
  来源：proposal 非目标；design「验证策略」「质量属性影响」。
  验证：Agent Core 定向回归 4 files / 111 tests PASS；`tests/agent-kernel/process-message-event-projection.test.ts`、`packages/agent-channel-common/tests/process-message-projection.test.ts`、`packages/agent-channel-web/tests/session-event-history-route.test.ts` 实际 3 files / 54 tests PASS。Agent Web 的 `TurnBlock.process-history.test.tsx` 与 `TurnBlock.test.tsx` 在隔离分支和未应用本 change 的原工作区均为 99 PASS / 8 FAIL，失败集合相同（既有过程面板文案与 reduced-motion 动画断言），据此归类为基线失败而非本 change 回归；本 change 不扩大范围修改前端。另行运行 `tests/agent-kernel/tool-loop.test.ts` 时，隔离分支与原工作区均因测试 fixture 的 `Read package.json` 返回 `FILE_UNAVAILABLE` 失败，归类为既有测试环境/fixture 基线问题。2026-08-07 使用 `MiniMax-M2.7` 在非 3000 端口启动真实 fullstack，由用户按跨 step 顺序 Tool 场景完成手工验收并明确回复“手工验收通过”。

## 2. Change 整体验证

- [ ] 2.1 完成 OpenSpec、Agent Core、Runtime terminal、contract 与 architecture 门禁，并确认没有新增公共 contract、Gateway schema、持久化表、配置项或浏览器隐藏消息读取路径。
  来源：proposal `目标与非目标`、`影响范围`；design `验证策略`。
  验证：2026-08-08 rebase 到 `origin/main@8be73a545` 后，`openspec validate fix-terminal-answer-tool-round-duplication --strict` PASS；`openspec validate --all --strict` 299 items PASS / 2 FAIL，失败仅为本 change 范围外的 `fix-conversation-preview-validation` 和 `fix-session-list-validation`；`npm run build` PASS；`npm test` 153 files PASS / 1 skipped、1889 tests PASS / 2 skipped；`npm run test:contract` 45 files / 359 tests PASS；`npm run lint:architecture` 46 files / 291 tests PASS；聚焦 Agent Core 回归 3 files / 107 tests PASS；`git diff --check` PASS。由于全量 OpenSpec 门禁仍存在两个主线基线失败，本 task 保持未完成。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按 design 的“长期基线刷新计划”同步 stable spec、`FN-1.1`、`F-1.1`、conversation process-history architecture、`agent-core` module 和 spec-to-design-map；不新增 ADR，不重写既有错误历史会话。
