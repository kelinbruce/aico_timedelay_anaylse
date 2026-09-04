## 1. `FN-2.4 查看请求状态`

- [x] 1.1 先修改配置测试，断言内置基线中 `Rag`、`Bash`、`Python` 默认为 `DETAIL`，其他内置项、`default-level` 和 exact override 保持目标表；运行测试确认旧实现因三项仍为 `SUMMARY` 而失败。
  来源：`FN-2.4` + `Capability 结果呈现策略受平台安全上限约束` + `默认命令和程序结果使用既有安全详情`、`默认 RAG 结果使用既有详情`、`集成规则仍可收窄命令结果`
  验证：在仓库根运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/capability-result-presentation-config.test.ts`；实现前预期仅目标默认值断言失败，完成后全部通过。

- [x] 1.2 修改 `agent-app` 内置呈现基线，只把 `Rag`、`Bash`、`Python` 改为 `DETAIL`，不修改三档 schema、ready gate、默认级别和 rule merge。
  来源：`FN-2.4` + `Capability 结果呈现策略受平台安全上限约束` + `默认命令和程序结果使用既有安全详情`、`集成规则仍可收窄命令结果`；design `FN-2.4 查看请求状态 / 修改方案 / 配置基线`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/capability-result-presentation-config.test.ts tests/agent-kernel/config-assembly.test.ts`；预期新默认表、exact override 和非法配置场景全部通过。

- [x] 1.3 先修改 shared projector 测试，断言 RAG SUMMARY 只有计数 descriptor 且无 `safeResult`，RAG DETAIL 继续逐值保留既有 50 项、来源和 40/100 code point 安全投影；同时断言 Bash/Python DETAIL 不包含命令、代码或参数。
  来源：`FN-2.4` + 安全 + `RAG 检索结果具有可展示的安全摘要` + `RAG SUMMARY 只显示召回数量`、`RAG DETAIL 复用既有来源和预览`、`RAG 非法结果继续安全降级`；`Capability 结果呈现策略受平台安全上限约束` + `默认命令和程序结果使用既有安全详情`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts`；实现前预期 RAG SUMMARY 无 safeResult 断言失败，完成后全部通过。

- [x] 1.4 修改 RAG shared projector，删除 SUMMARY 对 detail safe result 的复用，只保留既有数量 descriptor；DETAIL projector、专项 schema 和所有既有容量常量不变。
  来源：`FN-2.4` + 安全 + `RAG 检索结果具有可展示的安全摘要` + `RAG SUMMARY 只显示召回数量`、`RAG DETAIL 复用既有来源和预览`、`RAG 非法结果继续安全降级`；design `FN-2.4 查看请求状态 / 修改方案 / RAG 三档裁剪`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts packages/agent-channel-common/tests/process-message-projection.test.ts`；预期 SUMMARY 无详情、DETAIL 字段与既有边界不变、unknown/invalid fail closed。

- [x] 1.5 先补前端行为测试，覆盖 Bash/Python 有输出时展开区直接显示既有结果且无完成占位摘要、零输出成功无摘要/无空展开、Workflow outer 重复摘要省略、ordinary raw JSON/关键词/首句不生成摘要。
  来源：`FN-2.4` + `Capability 业务呈现必须与结果显示策略正交` + `成功命令直接呈现已有详情而不显示废话摘要`、`空成功命令没有摘要和空展开入口`、`Workflow 外层成功摘要不重复状态`、`前端不从 raw JSON 生成摘要`
  验证：在 `frontend/agent-web` 运行 `npm test -- src/features/chat/process/processDetails.test.ts tests/processDetailsProjection.test.ts`；实现前预期新行为断言失败，完成后全部通过。

- [x] 1.6 封闭 ordinary Capability 成功结果的浏览器摘要回退：移除 command/program、Workflow 和 CLIP 已确认占位摘要，禁止从 raw detail/JSON/关键词/首句生成摘要；保留安全失败、recognized safeResult、有效 descriptor 和产品显式 structured presentation 路径。
  来源：`FN-2.4` + `Capability 业务呈现必须与结果显示策略正交` + `成功命令直接呈现已有详情而不显示废话摘要`、`空成功命令没有摘要和空展开入口`、`Workflow 外层成功摘要不重复状态`、`前端不从 raw JSON 生成摘要`；design `FN-2.4 查看请求状态 / 修改方案 / 摘要价值判定`、`封闭普通结果回退`
  验证：在 `frontend/agent-web` 运行 `npm test -- src/features/chat/process/processDetails.test.ts tests/processDetailsProjection.test.ts`；预期受信结果/失败仍显示，unknown/raw success 仅标题状态，禁止内容不泄漏。

- [x] 1.7 先补 ToolSearch、Cron typed safe-result parser/formatter 与 TodoWrite i18n 测试，覆盖合法 shape、unknown field/非法 type fail closed、空详情无展开、截断、中文和英文状态。
  来源：`FN-2.4` + `已有 typed safe result 必须使用本地化结构呈现` + `ToolSearch DETAIL 使用专用结构`、`Cron 三种结果使用专用结构`、`TodoWrite 状态使用当前语言`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/safeCapabilityResult.test.ts src/features/chat/process/processDetails.test.ts tests/processDetailsProjection.test.ts tests/i18n.test.ts`；实现前预期 ToolSearch/Cron reader 和 Todo 本地化断言失败，完成后全部通过。

- [x] 1.8 扩展现有 closed `SafeCapabilityResult` reader 和 presenter：增加后端已有 `toolSearch`、`cron` variants；为 ToolSearch、Cron、TodoWrite 增加中英文平台标签，逐值保留 safe result 内容、顺序和截断事实，不新增结果字段或容量规则。
  来源：`FN-2.4` + `已有 typed safe result 必须使用本地化结构呈现` + `ToolSearch DETAIL 使用专用结构`、`Cron 三种结果使用专用结构`、`TodoWrite 状态使用当前语言`；design `FN-2.4 查看请求状态 / 修改方案 / 补现有 typed reader`、`本地化 presenter`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/safeCapabilityResult.test.ts src/features/chat/process/processDetails.test.ts tests/processDetailsProjection.test.ts tests/i18n.test.ts`；预期合法结构友好显示，非法结构 fail closed，双语切换只改变标签。

- [x] 1.9 补 ProcessPanel characterization，确认本 change 后运行中自动展开、settled 后收起、手动 override 和两级 disclosure 不变，SUMMARY/DETAIL 不新增收起态常驻摘要，空详情不显示展开入口。
  来源：`FN-2.4` + `Capability 业务呈现必须与结果显示策略正交` + `成功命令直接呈现已有详情而不显示废话摘要`、`空成功命令没有摘要和空展开入口`；design `FN-2.4 查看请求状态 / 修改方案 / disclosure 保持`
  验证：在 `frontend/agent-web` 运行 `npm test -- src/features/chat/components/ProcessPanel.test.ts tests/useProcessEntryDisclosure.test.tsx`；预期现有 disclosure 场景和新增无常驻摘要/无空入口场景全部通过。

- [x] 1.10 完成 `FN-2.4` 聚焦回归，验证配置、shared projector、frontend reader/presenter、live/history fixture 与三宿主共享入口没有旁路。
  来源：design `FN-2.4 查看请求状态 / 验证策略`
  验证：根目录运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/capability-result-presentation-config.test.ts packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts packages/agent-channel-common/tests/process-message-projection.test.ts tests/agent-kernel/config-assembly.test.ts`；`frontend/agent-web` 运行 `npm test -- tests/safeCapabilityResult.test.ts src/features/chat/process/processDetails.test.ts src/features/chat/components/ProcessPanel.test.ts tests/processDetailsProjection.test.ts tests/i18n.test.ts tests/useProcessEntryDisclosure.test.tsx`；预期全部通过。

## 2. Change 整体验证

- [x] 2.1 完成 OpenSpec、前后端构建、架构、契约和全量测试门禁，并记录既有失败与本 change 引入失败的归属。
  来源：proposal 影响范围 + design `验证策略`
  验证：根目录运行 `openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`；`frontend/agent-web` 运行 `npm run build`、相关 `npm test -- ...` 和 `npm run build:vite:modes`。预期所有本 change 相关门禁通过；范围外既有失败必须有独立 Issue 和证据，不能通过修改本 change 绕过。
  当前证据（2026-08-12，重放到 `origin/main@81c1a71fb` 后）：change strict 与全库 strict 为 259/259；聚焦后端为 4 files / 246 passed / 4 skipped，前端原聚焦范围为 6 files / 219 passed；补充 `safeSummaryPresentation`、`TurnBlock`、`buildSessionProjection` 后为 3 files / 137 passed，并确认 recognized safe result 的累计快照可见且 unknown/raw success fail closed。frontend 全量为 184 files / 2255 tests passed、2 个范围外既有失败；同一 `origin/main` 基线可复现 `loadSessionStorageAICOConfig.test.ts` 与 `TurnBlock.pinQuestion.test.tsx` 各 1 个失败，本 change 引入失败为 0。frontend TypeScript build 与三个 Vite host modes 通过；根 `npm run build` 通过；根 `npm test` 为 165 files passed / 1 skipped、2084 tests passed / 2 skipped；contract 为 48 files / 381 tests，architecture 为 49 files / 304 tests。旧基线上的 `skill-manifest.test.ts:674` `TS2554` 已被最新 main 消除，临时跟踪 #749 已关闭。

- [x] 2.2 使用 `$nextagent-code-review` 做语义检视，覆盖 OpenSpec consistency、平台安全上限、browser ownership、三宿主一致性、无新增公共 contract、minimal-kernel non-regression、KISS 和全部延期 Issue 边界；P0/P1 清零后才允许 push。
  来源：design `FN-2.4 查看请求状态 / 修改方案`、`风险与取舍`、`待确认问题`
  验证：模型检视结论必须为 `PASS` 或 `PASS WITH FOLLOW-UP`；任何 P0/P1 必须修复并重新检视。

## 归档前更新基线检查（非实施任务）

归档流程按照 design 的“长期基线刷新计划”同步 stable spec、`FN-2.4`、`F-2.4`、相关 architecture/module 与 spec-to-design-map；检查长期基线不记录 #741–#748 的 deferred 目标，不把候选通用容量值写成已实现规格。
