# fix-display-content-piu-object-data tasks

## 1. `FN-9.5 执行交互节点`

- [x] 1.1 建立 PIU object 数据行为测试：上游变量为 JSON object，`output_parser.type=PIU` 且 `data.data=${pyresult}`；断言节点不抛 `WORKFLOW_NODE_INPUT_INVALID`，projected `output_parser.data.data` 保留 object，且无文本输入时不产生 `NODE_OUTPUT_DELTA`。
  来源：`FN-9.5 执行交互节点 + Display Content + PIU Object Data Reaches Structured Delta / No Redundant Text Delta For Object Data`
  验证：`npx vitest run packages/agent-workflow/tests/workflow-piu-object-data.test.ts --reporter=verbose`，7/7 通过；实施前原 3 个用例中 2 个失败，复现原缺陷。

- [x] 1.2 统一 effective output parser 来源优先级：按 `node.presentation.outputParser`、`node.outputParser`、`node.outputs.output_parser` 解析模板；断言 `node.outputParser` 和 `presentation.outputParser` 场景的 object data 进入 projected output 且不产生冗余文本 delta。
  来源：`FN-9.5 执行交互节点 + Display Content + Output Parser Source Precedence Applies / Presentation Parser Takes Precedence`
  验证：新增 focused tests 后运行 `npx vitest run packages/agent-workflow/tests/workflow-piu-object-data.test.ts --reporter=verbose`，7/7 通过。

- [x] 1.3 保留文本输入的 safe projection 语义：当 object `data` 与文本输入同时存在时，文本输入继续优先投影并执行既有 HTML 安全校验。
  来源：`FN-9.5 执行交互节点 + Display Content + Text Input Remains Safe Projection`
  验证：在 `workflow-piu-object-data.test.ts` 增加文本输入场景；focused test 7/7 通过，同时 `workflow-interaction-nodes.test.ts` 43/43 通过。

- [x] 1.4 保留 OBJECT 类型 JSON 字符串投影：当 `output_parser.type=OBJECT` 且无文本输入时，节点输出 object MUST 序列化为 JSON 字符串并作为文本 `NODE_OUTPUT_DELTA` 内容。
  来源：`FN-9.5 执行交互节点 + Display Content + OBJECT Content Serializes As JSON`
  验证：新增 focused test 后运行 `npx vitest run packages/agent-workflow/tests/workflow-piu-object-data.test.ts --reporter=verbose`，8/8 通过。

## 2. Change 整体验证

- [x] 2.1 运行后端 build、全量测试、contract 测试、architecture lint 和 OpenSpec strict validation，确认无回归。
  来源：proposal 影响范围 + design 验证策略。
  验证：`npm run build` 通过；`npm test` 172 files / 2207 tests 通过；`npm run test:contract` 49 files / 387 tests 通过；`npm run lint:architecture` 51 files / 314 tests 通过；`openspec validate --all --strict` 311 items 通过。本地缺失 `OPENAI_*` 环境时使用仅限本次命令的占位配置。

## 归档前更新基线检查（非实施任务）

- 归档时将 delta spec 合并到 `openspec/specs/workflow-interaction-nodes/spec.md`。
- 归档时更新 `openspec/designs/functions/D9-Workflow编排/D9.2-节点与恢复/FN-9.5-执行交互节点.md` 的 display-content 行为描述。
- 确认无 Feature、overview、architecture、modules、ADR 或 spec-to-design-map 变更。
