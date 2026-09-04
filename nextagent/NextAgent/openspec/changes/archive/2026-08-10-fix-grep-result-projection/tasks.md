## 0. 跨 Function 前置门禁

- [x] 0.1 确认 `refine-ts-tool-default-root` 已归档，`file-search-tools` 已进入 stable baseline；完成后本 change 不再与并行 active change 修改同一规范或 Grep 实现落点。
  来源：`design / 已确认事项`、`design / 迁移与回滚`
  验证：运行 `openspec list --json`，预期 `refine-ts-tool-default-root` 不在 active changes；运行 `rg -n "Grep Has A Strict Pattern And Path Contract" openspec/specs/file-search-tools/spec.md`，预期 canonical stable Requirement 恰好存在。
  实际结果（2026-08-10）：前置归档已通过 MR #1079 合入 `main@303b225bf`，本分支已重放到该主线；`openspec list --json` 无 `refine-ts-tool-default-root`，stable Requirement 在 `openspec/specs/file-search-tools/spec.md` 唯一命中。

- [x] 0.2 完成公开 Web 契约群内确认，明确接受 `grepResult` 两个 variants、两个成功摘要码及精确 args 白名单。
  来源：`FN-2.4 查看请求状态`、`proposal / 影响范围`、`design / 已确认事项`
  验证：无法自动化；code review 必须核对确认内容与 `specs/ts-run-status-visibility/spec.md` 的字段、枚举、容量和降级语义逐项一致，并确认没有新增 `agent-contracts` 顶层 DTO、event 或 export。未取得确认时不得实施公开 Web shape。
  实际结果（2026-08-10）：用户确认群内消息已通过；确认范围覆盖 `grepResult` 的 `files_with_matches`/`content` 两个严格 variants、两个成功摘要码及精确 args 白名单。实现沿用既有 JSON envelope，`git diff --name-only` 未包含 `packages/agent-contracts/**`。

## 1. `FN-5.4 搜索文件`

- [x] 1.1 在 Grep capability contract tests 中先加入 `output_mode` 必填、两种模式、默认模式、零匹配和模式/数组矛盾 shape 的目标行为；变更前测试必须因缺失 discriminator 或 schema 未拒绝矛盾 shape 而失败。
  来源：`FN-5.4 搜索文件 + Grep 成功结果显式携带实际输出模式 + 全部 Scenarios`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/grep-capability.test.ts --maxWorkers=1`，预期实施前新增断言失败；完成 1.2 后相同命令通过。
  实际结果（2026-08-10）：实施前 20 tests 中 5 个目标断言失败，均明确指向缺失 `output_mode` 或旧 output schema。

- [x] 1.2 修改 Grep executor 与 output schema，使每个成功结果携带可信必填 `output_mode`，并拒绝缺失模式、未知模式与模式专属数组矛盾的结果；完成后仓库内 first-party Grep fixture 均满足新 contract。
  来源：`FN-5.4 搜索文件 + Grep 成功结果显式携带实际输出模式 + 全部 Scenarios`、`design / FN-5.4 搜索文件 / 修改方案`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/grep-capability.test.ts packages/agent-capability/tests/tool-framework.test.ts packages/agent-capability/tests/skill-tool.test.ts packages/agent-capability/tests/skill-resource-projection.test.ts --maxWorkers=2`，预期全部通过且零匹配结果仍含实际 `output_mode`。
  实际结果（2026-08-10）：4 files / 92 tests 全部通过；覆盖两种模式、默认模式、零匹配、非法或矛盾 shape 及 first-party workspace fixture。

- [ ] 1.3 完成 `FN-5.4` package 级验证，确认新增 result 字段没有破坏其他文件工具、扩展策略或 Tool framework contract。
  来源：`design / FN-5.4 搜索文件 / 质量属性影响`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests --maxWorkers=4` 与 `npm run typecheck`，预期全部通过且无 TypeScript contract 遗漏。
  当前结果（2026-08-10）：重放到 `main@303b225bf` 后，根 `npm run build`（包含 typecheck）通过，Grep 及全部 first-party Grep fixture 聚焦套件为 4 files / 93 tests 通过；package suite 为 689 passed、25 skipped、15 failed，其中 2 项由当前环境无法创建 Unix socket 导致，其余失败均位于 ApiCall、Cron guidance、execution budget、first-party registry、Python context、Skill metadata/acquisition 等未触达路径。用户已同意本 change 不扩展修复这些既有 package baseline，但 task 定义要求完整 package suite 全绿，因此本 task 仍不勾选，也不把该接受记录表述为验证通过。

## 2. `FN-2.4 查看请求状态`

- [x] 2.1 在共享 projector tests 中先加入文件模式/内容模式 summary、两种 detail、50 条上限、零匹配、旧结果缺失模式、矛盾 shape 和 matched line 不泄漏断言；变更前测试必须因 Grep 仍复用 `fileList` projector 而失败。
  来源：`FN-2.4 查看请求状态 + 系统质量属性（安全、性能/容量）+ Grep 结果按实际模式生成有界安全投影 + 全部 Scenarios`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts --maxWorkers=1`，预期实施前新增 Grep projector 断言失败；完成 2.3 后相同命令通过。
  实际结果（2026-08-10）：实施前 7 个目标断言因旧 `fileList` 投影失败；安全复核新增的控制字符路径、超限 matched line 与 canonical 总数小于返回条目数负例也均在收紧前失败。

- [x] 2.2 在 `frontend/agent-web` 先加入 `grepResult` strict parser、两个成功摘要、两种详情、非法 shape 降级和中英文文案测试；变更前测试必须因 parser 与本地化映射不存在而失败。
  来源：`FN-2.4 查看请求状态 + Grep 结果按实际模式生成有界安全投影 + 全部 Scenarios`
  验证：在 `frontend/agent-web` 运行 `npm test -- src/features/chat/utils/safeSummaryPresentation.test.ts tests/processDetailsProjection.test.ts`，预期实施前新增断言失败；完成 2.4 后相同命令通过。
  实际结果（2026-08-10）：实施前两个文件共 5 个目标断言失败，明确指向摘要码、strict parser 和详情 renderer 缺失。

- [x] 2.3 修改 `agent-channel-common` Grep 专用 safe projector 和 summary descriptor，严格按 canonical mode/totals 生成安全投影，并使非法或旧 shape 降为 `STATUS_ONLY`；完成后 Glob 继续使用原 `fileList` 投影。
  来源：`FN-2.4 查看请求状态 + Grep 结果按实际模式生成有界安全投影 + 全部 Scenarios`、`design / FN-2.4 查看请求状态 / 修改方案`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-common/tests --maxWorkers=4` 与 `npm run build --workspace @nextagent/agent-channel-common`，预期全部通过；测试必须断言 `line`、pattern、glob filter 和 raw paths 不进入结果。
  实际结果（2026-08-10）：channel-common 8 files / 227 tests 通过；加强负例后聚焦文件 131 tests 通过；package build 通过。投影最多 50 条，matched line 被主动删除，canonical 总数与条目矛盾、旧或其他非法 shape 均降为 `STATUS_ONLY`。

- [x] 2.4 修改 `frontend/agent-web` 的 safe result union/parser、过程详情 renderer、成功摘要解释和中英文资源，使三种宿主只消费闭合投影并显示模式正确的摘要或有界详情。
  来源：`FN-2.4 查看请求状态 + Grep 结果按实际模式生成有界安全投影 + 全部 Scenarios`、`design / FN-2.4 查看请求状态 / 修改方案`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/safeCapabilityResult.test.ts src/features/chat/utils/safeSummaryPresentation.test.ts tests/processDetailsProjection.test.ts tests/streamCompaction.test.ts tests/conversationStore.test.ts` 与 `npm run build`，预期全部通过，未知或非法 variant 不产生详情。
  实际结果（2026-08-10）：核心 parser/摘要/详情 3 files / 111 tests 通过；加上 stream compaction 与 conversation store 的受影响回归为 5 files / 203 tests 通过；frontend build 通过。

- [x] 2.5 增加 live/history 同投影 contract 或 integration coverage，证明同一 Grep 事实经 SSE、WebSocket 和 run history 得到相同 summary、args、safeResult 与降级结果，且不新增逐结果请求。
  来源：`FN-2.4 查看请求状态 + 系统质量属性（安全、性能/容量）+ Grep 结果按实际模式生成有界安全投影 + 内容模式详情只增加路径和行号、旧结果缺少模式时安全降级`、`design / 跨 Function 协作与端到端流程`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-common/tests/web-stream-delivery.test.ts packages/agent-channel-web/tests/session-event-history-route.test.ts -t "Grep projection|representative capability categories" --maxWorkers=2`；整体验证阶段追加 `npm run test:contract`。预期 transport-neutral stream（SSE/WS 共用）与 history payload 深度相等，且只使用既有 history 请求。
  实际结果（2026-08-10）：2 个聚焦 integration tests 通过；共享 stream source 输出与 history route 输出使用同一 projector，content matched line 未进入任一 payload，旧结果在两条路径均为 `STATUS_ONLY`。

## 3. 跨 Function 集成与安全边界

- [x] 3.1 建立从 Grep producer result 到 Web projector/frontend parser 的端到端 fixture 矩阵，覆盖文件模式、内容模式、零匹配和旧历史 shape；完成后每个场景只有一个模式解释。
  来源：`FN-5.4 搜索文件`、`FN-2.4 查看请求状态`、`design / 跨 Function 协作与端到端流程`、`design / 跨 Function 质量属性设计`
  验证：运行 producer、共享 projector、frontend strict parser 与 process details 的上述聚焦命令，预期矩阵全部通过且 content detail 中不出现 matched line。
  实际结果（2026-08-10）：producer 20 tests、共享 projector 131 tests、frontend parser/摘要/详情 111 tests 均通过；文件模式、内容模式、零匹配、50 条上限和旧历史 shape 各只有一个闭合解释。

- [x] 3.2 对实现 diff 执行架构与安全语义 review，确认没有新增 `agent-contracts` 顶层 contract、浏览器 raw-result owner、宿主分支、Gateway/persistence 变化、搜索失败语义或调用参数披露。
  来源：`design / 跨 Function 协作与端到端流程`、`design / 验证策略`、`proposal / 非目标`
  验证：运行 `npm run lint:architecture`；随后使用 `$nextagent-code-review` 检视完整 diff，预期结论为 PASS 或无 P0/P1 的 PASS WITH FOLLOW-UP。若出现任何未确认公共 contract 变化，本 task 必须保持未完成并重新执行群内确认。
  当前结果（2026-08-10）：群内确认通过后，`nextagent-skill-review` 为 PASS；重放到 `main@303b225bf` 后对完整 diff 再次执行 `nextagent-skill-review` 与 `nextagent-code-review`，结论分别为 `PASS` 与 `PASS WITH FOLLOW-UP`，实现范围内无 P0/P1。未修改 `agent-contracts`、Gateway、persistence、runtime lifecycle 或宿主入口，浏览器只消费共享安全投影，匹配正文和调用参数均未披露。`npm run lint:architecture` 的唯一失败仍位于未触达的 `packages/agent-capability/src/builtins/api-call-tool.ts` logging boundary，由 [#706](https://gitcode.com/gdd_hw/NextAgent/issues/706) 跟踪并指派；其他完整门禁失败见 task 4.1。用户已明确接受这些已归因、已跟踪的 main baseline 作为交付 follow-up，该接受不表示完整门禁全绿。

## 4. Change 整体验证

- [ ] 4.1 执行 OpenSpec、后端 workspace 与前端完整受影响门禁，记录每条命令的实际结果；全部通过后 change 才能声明实现完成。
  来源：`proposal / 影响范围`、`design / 验证策略`
  验证：在仓库根目录运行 `openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`；在 `frontend/agent-web` 运行 `npm run build` 和 `npm test`。预期全部退出码为 0；若增加或改变浏览器用户旅程，再运行对应 `npm run test:e2e -- ...` 并要求通过。
  当前结果（2026-08-10）：当前 change 的 `openspec validate fix-grep-result-projection --strict`、根 `npm run build`、根 `npm run typecheck`、frontend `npm run build` 通过；`openspec validate --all --strict` 为 310 passed / 3 个无关 active changes 失败。根 `npm test` 为 151 files passed、3 failed、1 skipped（本地监听 `EPERM`、metric timeout、Workbench browser 启动失败）；`npm run test:contract` 为 44 files passed、2 failed（5 tests，均由本地监听 `EPERM`/timeout 导致）；`npm run lint:architecture` 为 46 files passed、1 failed（未触达的 `api-call-tool.ts` logging boundary）；frontend `npm test` 为 166 files passed、12 failed（22 tests，均未命中本 change 文件或 Grep 行为）。全部 Grep producer/projector/frontend/live-history 聚焦门禁通过，但完整门禁非零，因此本 task 保持未完成。
  提交前复验（2026-08-10）：Grep live/history 聚焦用例继续通过；组合后端相关套件为 180 passed / 1 failed，唯一失败是既有 Bash process message history 投影断言。该用例在同一 `HEAD` 的 detached、未修改基线上独立复跑得到完全相同失败，确认不是本 change 引入。
  MiniMax 本地全栈验证（2026-08-10）：使用仓内实现构建并启动真实服务后，默认 `SUMMARY` 分别验证了 0 个匹配文件、1 个匹配文件以及 `content` 模式 1 条匹配/1 个文件；临时切换 Grep 为 `DETAIL` 后，`content` 只显示 `temp/grep-detail-fixture.txt:2`、`:4`，`files_with_matches` 只显示两个逻辑路径，均未显示匹配行正文或调用参数。两种策略均在刷新后保持相同历史投影；随后在英文 Local 宿主中补充验证 Grep 与 Glob 的 `SUMMARY`/`DETAIL` 展示。用户确认功能手工测试通过。临时策略已移除并恢复默认 `SUMMARY` 服务；该手工证据不替代上述非零完整门禁，因此不改变 task 状态。
  基线问题跟踪（2026-08-10）：OpenSpec 无 delta 失败登记 [#707](https://gitcode.com/gdd_hw/NextAgent/issues/707)，architecture logging 失败登记 [#706](https://gitcode.com/gdd_hw/NextAgent/issues/706)，Bash history 失败登记 [#708](https://gitcode.com/gdd_hw/NextAgent/issues/708)；frontend 失败复用 [#695](https://gitcode.com/gdd_hw/NextAgent/issues/695) 并新增 [#709](https://gitcode.com/gdd_hw/NextAgent/issues/709)、[#710](https://gitcode.com/gdd_hw/NextAgent/issues/710)、[#711](https://gitcode.com/gdd_hw/NextAgent/issues/711)、[#712](https://gitcode.com/gdd_hw/NextAgent/issues/712)、[#713](https://gitcode.com/gdd_hw/NextAgent/issues/713)、[#714](https://gitcode.com/gdd_hw/NextAgent/issues/714)，均已指派对应责任人。本地监听 `EPERM`、浏览器启动失败和仅在全量运行出现一次、聚焦复跑通过的滚动测试波动按环境/flake 证据处理，不错误归因给产品提交。用户同意这些已归因基线不阻断本 change 继续进入最终语义检视与交付，但由于本 task 明确要求所有完整门禁退出码为 0，4.1 仍保持未完成，change 不声明完整门禁全绿或可归档。
  最新主线重放复验（2026-08-10）：基于 `main@303b225bf`，producer 4 files / 93 tests、共享 projector 131 tests、Grep live/history 2 tests、前端受影响回归 5 files / 204 tests、根 build、frontend build 与本 change strict validation 通过；architecture 与全量 OpenSpec 仍分别只命中 #706 与 #707。package suite 的未触达失败与 Unix socket 环境失败记录在 task 1.3。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 `design.md / 长期基线刷新计划` 归并 stable specs、Functions、Features、受影响 architecture/modules 与 spec-to-design-map，并检查：`file-search-tools` 已由前置 change 建立；新公开 schema 只在 `ts-run-status-visibility` 定义一次；长期文档不保留临时依赖、群内确认状态或迁移步骤。
