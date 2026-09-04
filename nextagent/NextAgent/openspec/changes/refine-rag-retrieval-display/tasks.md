## 1. `FN-2.4 查看请求状态`

- [x] 1.1 先修改后端 shared projector 测试，断言 RAG DETAIL items shape 为 `{ source, content }`，source 为原始字符串（含 `|`），content 为完整内容；同时断言 `provenance`、`score`、`rankHint` 不泄漏，SUMMARY 仍无 safeResult。
  来源：`FN-2.4` + 安全 + `RAG 检索结果具有可展示的安全摘要`
  验证：在仓库根运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-web/tests/rag-result-projection.test.ts packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts`；实现前预期 items shape 断言失败，完成后全部通过。

- [x] 1.2 修改后端 `projectRagRetrievalSafeResult`，直接输出 `{ source, content }`，删除 `projectRagDisplaySource`、`previewUnicodeCodePoints`、`resolveRagContentPreviewMaxCodePoints` 调用和函数定义，删除 RAG code point 常量。保留 `resultListPreviewMaxItems = 50` 不变。
  来源：`FN-2.4` + 安全 + `RAG 检索结果具有可展示的安全摘要`；design `修改方案 / 后端 projector`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-web/tests/rag-result-projection.test.ts packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts packages/agent-channel-common/tests/process-message-projection.test.ts`；预期 items shape 为 `{ source, content }`，provenance/score 不泄漏。

- [x] 1.3 先修改前端 guard 测试，断言 `SafeRagRetrievalItem` shape 为 `{ source, content }`，删除长度校验相关断言，新增非 string 类型 fail-closed 断言。
  来源：`FN-2.4` + 安全 + `RAG 检索结果具有可展示的安全摘要`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/safeCapabilityResult.test.ts`；实现前预期新 shape 断言失败，完成后全部通过。

- [x] 1.4 修改前端 `SafeRagRetrievalItem` 类型和 `readRagRetrievalItems`，改为读取 `source` 和 `content`，仅做 string 类型校验，删除所有长度校验和 `resolveRagContentPreviewMaxCodePoints`、RAG code point 常量。
  来源：`FN-2.4` + 安全 + `RAG 检索结果具有可展示的安全摘要`；design `修改方案 / 前端 guard`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/safeCapabilityResult.test.ts`；预期合法结构通过，非法类型 fail closed。

- [x] 1.5 先修改前端 projection 测试，断言 `displaySource` 从 `source.split('|')[0]` 派生，`content` 为完整内容。
  来源：`FN-2.4` + `RAG 过程详情以来源标签和单行预览呈现`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/processDetailsProjection.test.ts`；实现前预期 split 断言失败，完成后全部通过。

- [x] 1.6 修改前端 `RagRetrievalDisplayItem` 和 `describeRagRetrievalSafeResult`，`displaySource = source.split('|')[0]`，`content` 保留完整内容。
  来源：`FN-2.4` + `RAG 过程详情以来源标签和单行预览呈现`；design `修改方案 / 前端 projection`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/processDetailsProjection.test.ts`；预期 displaySource 为分割首段。

- [x] 1.7 先修改前端 ProcessPanel 测试，覆盖来源标签 512 字符截断 + `...`、Tooltip 显示完整 `displaySource`、点击 source 打开 Modal、Modal 内 Markdown 渲染完整 content、无内联 content 预览。
  来源：`FN-2.4` + `RAG 过程详情以来源标签和单行预览呈现`
  验证：在 `frontend/agent-web` 运行 `npm test -- src/features/chat/components/ProcessPanel.test.ts`；实现前预期新行为断言失败，完成后全部通过。

- [x] 1.8 修改前端 `RagRetrievalDetails` 组件，新增 `RAG_SOURCE_DISPLAY_LIMIT = 512`、Tooltip、Modal + MarkdownContent、点击 source 触发弹窗；新增 CSS `.turn-process-rag-retrieval-source--clickable` 样式；删除 `normalizeRagPreviewForDisplay` 如果不再使用。
  来源：`FN-2.4` + `RAG 过程详情以来源标签和单行预览呈现`；design `修改方案 / 前端 render`
  验证：在 `frontend/agent-web` 运行 `npm test -- src/features/chat/components/ProcessPanel.test.ts`；预期截断、Tooltip、Modal 交互全部通过。

- [x] 1.9 完成 `FN-2.4` 聚焦回归，验证后端 projector、前端 reader/projection、ProcessPanel、live/history fixture 没有旁路。
  来源：design `验证策略`
  验证：根目录运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-web/tests/rag-result-projection.test.ts packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts`；`frontend/agent-web` 运行 `npm test -- tests/safeCapabilityResult.test.ts tests/processDetailsProjection.test.ts src/features/chat/components/ProcessPanel.test.ts`；预期全部通过。
  结果：后端 RAG 相关断言全部通过（`session-event-history-route.test.ts` 中 Bash 投影 1 个失败为 main 既有，与本 change 无关）；前端 3 个测试文件 158/158 通过。

- [x] 1.10 先修改后端 shared projector 测试，断言 RAG DETAIL 中 source 与 title 均为空时 `source` 回退 `content` 去除首尾空白后的前 256 个字符（完整 `content` 不受影响），source、title、content 均缺失时 `source` 为空字符串。
  来源：`FN-2.4` + `RAG 检索结果具有可展示的安全摘要` + design `修改方案 / 后端 projector`
  验证：在仓库根运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts`；新增 `falls back to the first 256 characters of content` 与 `falls back to an empty source` 两个用例，实现前预期失败，完成后通过（139 passed 含新增用例）。

- [x] 1.11 修改 `projectRagRetrievalSafeResult` / `extractRagSafeSource`，实现 `source | 分割首段 → title → content 前 256 字符` 三级兜底链（新增 `ragSourceFallbackContentMaxChars = 256`）；同步修正 `rag-result-projection.test.ts`、`session-event-history-route.test.ts` 中与 `|` 分割行为脱节的陈旧断言（改为 DETAIL 档位 + 管道符分割期望）。
  来源：design `修改方案 / 后端 projector`、spec delta `RAG DETAIL 按 | 分割 source 取首段并发送完整 content` 等场景
  验证：在仓库根运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-web/tests/rag-result-projection.test.ts packages/agent-channel-web/tests/session-event-history-route.test.ts packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts`；RAG 相关断言全部通过（session-event-history-route.test.ts 中 Bash 投影相关 1 个失败为 main 既有失败，与本 change 无关）。

- [x] 1.12 content 兜底截断时追加省略号：先修改 `capability-result-presentation-policy.test.ts` 断言 `content` 去除首尾空白后超过 256 个字符时 `source` 为前 256 个字符 + `...`，不超过 256 个字符时为完整文本且不追加 `...`；再修改 `extractRagSafeSource` 实现该行为。
  来源：用户后续要求「如果取的是 content，除了取前 256 字符之外，后面加上 ...」+ spec delta `source 与 title 均为空时回退 content 前 256 个字符并追加省略号`
  验证：在仓库根运行 `npx vitest run --config vitest.config.release.ts packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts`；超限用例断言 `...` 后缀、不超限用例断言无 `...`，全部通过。

## 2. Change 整体验证

- [ ] 2.1 完成 OpenSpec、前后端构建和全量测试门禁。
  来源：proposal 影响范围 + design `验证策略`
  验证：根目录运行 `openspec validate --all --strict`、`npm run build`、`npm test`；`frontend/agent-web` 运行 `npm run build`、`npm test`。预期所有本 change 相关门禁通过。

- [ ] 2.2 使用 `$nextagent-code-review` 做语义检视，覆盖 OpenSpec consistency、平台安全上限、browser ownership、三宿主一致性、无新增公共 contract、minimal-kernel non-regression、KISS；P0/P1 清零后才允许 push。
  来源：design `修改方案`、`风险与取舍`
  验证：模型检视结论必须为 `PASS` 或 `PASS WITH FOLLOW-UP`；任何 P0/P1 必须修复并重新检视。

## 归档前更新基线检查（非实施任务）

归档流程按照 design 的"长期基线刷新计划"同步 stable spec、`FN-2.4`、`F-2.4`、相关 architecture/module 与 spec-to-design-map。
