## 1. `FN-10.6 前端定制`

- [x] 1.1 在 `frontend/agent-web/tests/useProcessEntryDisclosure.test.tsx` 增加 persistent PIU key 的失败回归测试：已挂载 PIU key 在自动、手工和 reduced-motion 收起后仍属于 `renderedKeys`；未挂载 PIU 不被添加；普通 key 与投影失效 key 仍被移除。实施前运行测试并确认因 hook 不接受/不实现 persistent key 而失败。
  来源：`FN-10.6` + `Automatic process disclosure preserves the next visual focus` + `PIU 条目自动收起后复用交互实例`、`reduced-motion 收起保留 PIU 实例`、`未查看的 PIU Detail 不提前挂载`、`PIU owner 移除后释放容器`
  验证：在 `frontend/agent-web` 运行 `npm test -- --run tests/useProcessEntryDisclosure.test.tsx`；修改生产代码前预期新增测试 FAIL，实施后预期全部 PASS。
  实际结果（2026-08-02）：使用 Node 22 运行后共 21 tests，其中新增的 automatic collapse 与 reduced-motion manual collapse 两项按预期 FAIL，均收到 `renderedKeys.has("piu") === false`；其余 19 tests PASS，证明失败来自 persistent render membership 尚未实现。

- [x] 1.2 在 `frontend/agent-web/tests/ProcessPanel.piu-lifecycle.test.tsx` 增加真实 `ProcessPanel → AnswerSegments → PiuMessage` 组件回归：entry 折叠和整个面板折叠期间 PIU DOM node identity、交互值与 loader/emit 次数保持不变，隐藏 subtree 具有 `aria-hidden` 和 `inert`；未查看 PIU 不预加载，普通 Detail 仍卸载；run scope 替换且 entry key 相同时旧 PIU 仍先卸载。实施前运行测试并确认折叠后 PIU node 被移除或重新初始化。
  来源：`FN-10.6` + `Automatic process disclosure preserves the next visual focus` + `PIU 条目自动收起后复用交互实例`、`整个过程面板收起后复用 PIU 交互实例`、`未查看的 PIU Detail 不提前挂载`、`自动完成条目在下一步骤前直接收起`
  验证：在 `frontend/agent-web` 运行 `npm test -- --run tests/ProcessPanel.piu-lifecycle.test.tsx`；修改生产代码前预期新增测试 FAIL，实施后预期全部 PASS。
  实际结果（2026-08-02）：使用 Node 22 运行 5 个新组件测试；entry collapse 与 whole-panel collapse 后均无法再找到 `structured-piu-message`，同 key 的 run scope 替换还复用了旧 PIU node，三项按预期 FAIL；未查看 PIU 不预加载、普通 Detail 折叠卸载两项 PASS，确认缺陷位于 PIU render membership/scope ownership，且负向边界基线成立。

- [x] 1.3 在 `frontend/agent-web/src/features/chat/components/structured/AnswerSegments.test.tsx` 增加 `PiuMessage` 生命周期回归：相同值内容 rerender 不重复 emit，内容变化仍 emit；unmount 清空容器并阻止 pending `autoLoad` 的迟到 emit。实施前运行测试并确认重复 emit 或迟到 emit 断言失败。
  来源：`FN-10.6` + `Automatic process disclosure preserves the next visual focus` + `PIU 条目自动收起后复用交互实例`、`PIU owner 移除后释放容器`
  验证：在 `frontend/agent-web` 运行 `npm test -- --run src/features/chat/components/structured/AnswerSegments.test.tsx`；修改生产代码前预期新增测试 FAIL，实施后预期全部 PASS。
  实际结果（2026-08-02）：使用 Node 22 运行后共 36 tests；equal JSON rerender 实际调用 `autoLoad` 2 次，unmount 后捕获容器仍保留 1 个 child，两项新增测试按预期 FAIL；内容变化再次 emit 与其余 33 项测试 PASS，证明失败分别来自 effect identity 和 cleanup 缺口。

- [x] 1.4 修改 `useProcessEntryDisclosure` 和 `ProcessPanel`：从当前投影派生 PIU-only persistent keys；已渲染 PIU 收起时只移出 expanded/visible state，entry 或 scope 失效时仍卸载；整个面板为已渲染 PIU 保留 React subtree，并在隐藏层设置 `aria-hidden` 与 `inert`。不得改变普通 Detail、最终答案、Expand Panel 或后端 lifecycle。
  来源：design `FN-10.6 前端定制 / 修改方案` 第 2-4 项
  验证：在 `frontend/agent-web` 运行 `npm test -- --run tests/useProcessEntryDisclosure.test.tsx tests/ProcessPanel.piu-lifecycle.test.tsx tests/TurnBlock.test.tsx tests/TurnBlock.process-history.test.tsx`；预期全部 PASS，普通 disclosure assertions 不变。
  实际结果（2026-08-02）：使用 Node 22 运行包含结构化渲染的 5 个相关文件，共 169 tests 全部 PASS；PIU entry/whole-panel node identity 与 `inert` 断言通过，普通 Detail 卸载、TurnBlock disclosure/history 的 107 项既有回归保持通过。

- [x] 1.5 修改 `PiuMessage`：按 PIU 内容值稳定 effect，捕获容器 ref；cleanup 取消迟到 emit 并清空容器 DOM，不新增 host `dispose`/`destroy` contract。
  来源：design `FN-10.6 前端定制 / 修改方案` 第 5-6 项
  验证：在 `frontend/agent-web` 运行 `npm test -- --run src/features/chat/components/structured/AnswerSegments.test.tsx tests/ProcessPanel.piu-lifecycle.test.tsx`；预期相同内容只 emit 一次、内容变化 emit、owner 移除后无迟到 emit 且容器为空。
  实际结果（2026-08-02）：使用 Node 22 运行 `AnswerSegments` 与 `ProcessPanel.piu-lifecycle` 共 41 tests 全部 PASS；equal JSON rerender 保持一次 load/emit，内容值变化触发第二次 emit，unmount 清空捕获容器且 pending load resolve 后 emit 次数保持 0。`npm run build` exit code 0，未修改 `host/prel.ts`。

- [x] 1.6 完成 `FN-10.6` 前端验证：受影响测试与 TypeScript build 均通过；完整前端 unit tests 的失败必须在同一 `origin/main` 基线上复现，确认没有本 change 引入的新失败或未处理 rejection。
  来源：design `验证策略` 与 `质量属性影响`
  验证：在 `frontend/agent-web` 运行 `npm test` 和 `npm run build`；若全量 suite 受既有基线失败阻塞，则在 detached `origin/main` 基线对失败文件逐一执行相同命令并比较结果。
  实际结果（2026-08-02）：Node 22 下 `npm run build` 与 `npm run build:vite:modes` 均 exit code 0，受影响 5 个文件共 169 tests 全部 PASS。沙箱外运行完整 `npm test -- --reporter=dot` 得到 151 files PASS、3 files FAIL，1751 tests PASS、10 FAIL；失败只涉及 `chat-page.route-state.test.tsx`、`chat-composer-controller.attachments.test.tsx`、`auth/MessageInput.permission.test.tsx`。在 detached `origin/main@644e37c1b` 上分别复跑这三个文件，得到与 change worktree 相同的 3/99、4/6、1/8 失败；另外 2 项只在全量高负载时超时/级联。由此确认全量非零退出和既有 React/antd warning 均为基线噪声，本 change 未新增失败或未处理 rejection。

- [x] 1.7 修正 live process projection 对 lifecycle-only completion text 的 canonical 判定：`<toolName> completed` 不得替换同 capability 已投影的结构化 PIU Detail；显式 `safeResult`、`safeSummary`、非通用 completion text 与 `contentUnavailable` 仍按 canonical completion 处理。
  来源：design `FN-10.6 前端定制 / 修改方案` 第 1 项与 `验证策略`
  验证：在 `frontend/agent-web` 运行 `npm test -- --run tests/processDetailsProjection.test.ts src/features/chat/process/processDetails.test.ts tests/ProcessPanel.piu-lifecycle.test.tsx`；并使用 `piu-process-detail` mock 场景验证自动完成收起前后 PIU DOM、交互值与隐藏属性。
  实际结果（2026-08-02）：修改生产代码前新增 projection 测试共 55 tests，其中 1 项按预期 FAIL，实际只得到 `routerAudit · 已完成` 且无 structured segment；最小修复后相关 3 files 共 89 tests 全部 PASS。最终聚焦回归共 7 files、253 tests 全部 PASS，`npm run build` exit code 0。浏览器 live 场景中点击 PIU 后计数为 1，自动完成收起期间 wrapper/card 各保持 1 个、owner 同时具有 `aria-hidden` 与 `inert`，重新展开后计数仍为 1；用户完成同一人工用例并确认验证完成。

## 2. Change 整体验证

- [x] 2.1 对 active change 执行 strict validation 和仓内 spec 语义审查，确认 proposal/spec/design/tasks 指向唯一 PIU-only 实施路径，没有 `agent-contracts` 变化或 browser ownership 越界。
  来源：proposal `影响范围`、design `验证策略`、`长期基线刷新计划`
  验证：在仓库根目录运行 `openspec validate preserve-process-detail-piu-lifecycle --strict` 和 `openspec validate --all --strict`；预期均 exit code 0。按 `$nextagent-skill-review` 输出 PASS，`需群内确认` 为 None。
  实际结果（2026-08-02）：重放到最新 `origin/main@27e2279aa` 后，change 级 strict validation exit code 0。`openspec validate --all --strict` 中本 change 与全部 stable specs 均 PASS；总计 262 PASS、1 FAIL，唯一失败的 `add-ts-skill-driven-api-call` 在 detached `origin/main@27e2279aa` 上同样失败且基线为 261 PASS、1 FAIL，确认不是本 change 引入。`$nextagent-skill-review` 结论 PASS，`需群内确认: None`；未修改 `agent-contracts`、host adapter、runtime 或 persistence。

- [x] 2.2 检查最终 diff 与任务证据：只包含 active change、PIU disclosure/lifecycle 实现和对应测试；所有任务 checkbox 只在记录实际命令和结果后勾选，worktree 依赖链接不进入提交范围。
  来源：design `修改方案`、proposal `非目标`
  验证：运行 `git status --short`、`git diff --check`、`git diff --stat` 和 `git diff -- openspec/changes/preserve-process-detail-piu-lifecycle frontend/agent-web`；预期无 whitespace error、无 `node_modules` 跟踪、无范围外生产代码。
  实际结果（2026-08-02）：`git diff --check` exit code 0；新增文件单独 trailing-whitespace 检查无命中。最终提交范围包含 PIU disclosure/lifecycle、completion projection 修复、对应测试、mock 手工验证说明和 `preserve-process-detail-piu-lifecycle` active change；不包含 `node_modules`。本地人工验证结束后已停止服务并移除两个未跟踪临时依赖链接，原依赖目录未受影响。模型语义审查未发现 P0-P3 finding，结论 PASS；未执行 push。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”更新 stable spec、Function、Feature、architecture、module 与 spec-to-design-map；实施阶段不直接修改这些长期基线。
