## 0. 规格与并行边界门禁

- [x] 0.1 验证两个新增 Requirements 与现有 active Skill changes 不修改同一 Requirement，且 change artifacts 形成唯一实施路径。
  来源：`FN-5.9 调用技能`、`FN-5.10 访问技能资源`；design“设计范围”“跨 Function 协作与端到端流程”
  验证：`openspec validate fix-skill-redundant-manifest-read --strict` 通过；`rg -n "^### Requirement: (Inline Skill 正文必须保持单一隐藏注入|SKILL.md 必须保持为内部正文来源)$" openspec/changes --glob "spec.md"` 对每个新增 Requirement 仅返回本 change 一处。
  实际结果（2026-07-30）：两条命令均通过；每个新增 Requirement 仅命中本 change 一处，`git diff --check` 通过。

## 1. `FN-5.10 访问技能资源`

- [x] 1.1 在 Skill Tool/projection tests 中先复现 `SKILL.md` 被投影及零附属资源仍披露资源根的问题，并确认修复前目标断言失败。
  来源：`FN-5.10 访问技能资源` + Requirement `SKILL.md 必须保持为内部正文来源` + Scenarios“SKILL.md 不进入模型可读 projection”“只有 SKILL.md 时没有可披露资源根”
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-tool.test.ts packages/agent-capability/tests/skill-resource-projection.test.ts` 在实现前因目标断言失败，在实现后全部通过。
  实际结果（2026-07-30）：实现前 `skill-tool.test.ts` 的目标断言确认 projection listing 包含 `SKILL.md`，且零附属资源 listing 仍含一个 synthetic `SKILL.md`；目标用例按预期失败。

- [x] 1.2 收窄 Skill resource projection 输入，只投影 source 提供的合规附属资源；完成后 `projectedCount` 不再包含 `SKILL.md`，合法附属资源仍可读。
  来源：`FN-5.10 访问技能资源` + Requirement `SKILL.md 必须保持为内部正文来源` + Scenarios“SKILL.md 不进入模型可读 projection”“符合条件的附属资源仍然可访问”；design“FN-5.10 访问技能资源 / 修改方案”
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-tool.test.ts packages/agent-capability/tests/skill-resource-projection.test.ts` 全部通过，并断言 projection listing 不含 `SKILL.md`、附属资源保持可读。
  实际结果（2026-07-30）：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-tool.test.ts packages/agent-capability/tests/skill-resource-projection.test.ts packages/agent-core/tests/per-call-skill-trust.test.ts` 通过，42 passed、2 skipped；unit listing 仅含 `scripts/rag_query.py`，per-call 真实 projection 断言 `SKILL.md` 不存在且脚本可读。

## 2. `FN-5.9 调用技能`

- [x] 2.1 在 Skill Tool 和 Agent Core contract tests 中先复现正文进入可见 result、generated message 缺失及无条件枚举提示的问题，并确认修复前目标断言失败。
  来源：`FN-5.9 调用技能` + Requirement `Inline Skill 正文必须保持单一隐藏注入` + Scenarios“可见结果不携带 Skill 正文”“无附属资源时不披露资源根”“有附属资源时只提示按正文引用访问”
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-tool.test.ts packages/agent-core/tests/per-call-skill-trust.test.ts tests/agent-kernel/capability-governance.test.ts` 在实现前因目标断言失败，在实现后全部通过。
  实际结果（2026-07-30）：实现前确认 `structuredPayload.body` 存在、`generatedMessages` 为空、无附属资源仍含 root/Glob hint，4 个目标用例按预期失败；同轮 ToolSearch 用例另有非本 change 失败，已与目标失败分离。

- [x] 2.2 恢复固定 `structuredPayload` 与单条 hidden generated message，并按附属资源数量生成受限资源提示；同步删除 Glob 的通用 Skill 资源搜索说明。
  来源：`FN-5.9 调用技能` + Requirement `Inline Skill 正文必须保持单一隐藏注入` + 全部 Scenarios；design“FN-5.9 调用技能 / 修改方案”
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-tool.test.ts packages/agent-core/tests/per-call-skill-trust.test.ts tests/agent-kernel/capability-governance.test.ts` 全部通过；结果中正文只出现于一条 hidden generated message，零资源不含 root，有资源提示不含目录枚举指令。
  实际结果（2026-07-30）：Skill Tool 与 per-call tests 26/26 通过；`capability-governance.test.ts -t "does not duplicate Skill content"` 1/1 通过。可见 payload 精确为 `{name,status}`，正文只在一条 hidden message，零资源不含 root，有资源提示禁止枚举目录和读取 `SKILL.md`。

- [x] 2.3 在 Context Engine prompt-shaping tests 中先复现后续 `Read` 轮次把 Skill generated message 移到消息尾部的问题，再把同名 Skill generated message 稳定插入包含最近一个对应 Skill tool result 的完整 result batch 之后；没有对应结果的 generated message 保持尾部追加。
  来源：`FN-5.9 调用技能` + Requirement `Inline Skill 正文必须保持单一隐藏注入` + Scenarios“后续工具轮次保持 Skill 正文与结果相邻”“模型 loop 前加载的 Skill 没有结果锚点”；design“FN-5.9 调用技能 / 修改方案”
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-context-engine/tests/prompt-shaping.test.ts packages/agent-core/tests/per-call-skill-trust.test.ts` 在实现前因位置断言失败，在实现后全部通过。
  实际结果（2026-07-31）：实现前顺序为 `Skill result → Read tool-use/result → Skill body`，新增位置断言按预期失败；实现后两文件 20/20 tests 通过，顺序为 `Skill result → Skill body → Read tool-use/result`，无匹配结果时仍在当前已选消息之后。

## 3. 跨 Function 集成与整体门禁

- [x] 3.1 验证 Skill 激活端到端边界：正文只注入一次、可见 capability result 不含正文、正文在后续工具轮次保持紧随 Skill result、projection 不含 `SKILL.md`、合法附属资源继续可访问。
  来源：`FN-5.9 调用技能`、`FN-5.10 访问技能资源`；design“跨 Function 协作与端到端流程”“验证策略”
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-tool.test.ts packages/agent-capability/tests/skill-resource-projection.test.ts packages/agent-capability/tests/glob-capability.test.ts packages/agent-context-engine/tests/prompt-shaping.test.ts packages/agent-core/tests/per-call-skill-trust.test.ts` 与 `npx vitest run --config vitest.config.release.ts tests/agent-kernel/capability-governance.test.ts -t "does not duplicate Skill content"` 全部通过。
  实际结果（2026-07-30）：第一条命令 56 passed、4 skipped；第二条命令目标用例 1 passed、40 skipped。原验证覆盖可见结果、hidden message、projection、合法附属资源与 Glob 通用描述边界；2026-07-31 发现未覆盖多轮相对位置，重新打开本任务。
  实际结果（2026-07-31）：加入 Context Engine 顺序与并行 result batch 验证后，第一条命令 74 passed、4 skipped；第二条命令目标用例 1 passed、40 skipped。顺序稳定为 `Skill result batch → Skill body → 后续工具轮次`，无正文持久化或 public contract 变化。

- [x] 3.2 完成 backend、contract、architecture 与 OpenSpec 总门禁，并确认没有修改 public contract 或引入无关文件。
  来源：proposal“影响范围”；design“验证策略”
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`、`git diff --check` 全部通过；`git diff -- packages/agent-contracts` 无输出。
  实际结果（2026-07-30）：受影响 production projects `npx tsc -b packages/agent-capability packages/agent-core --pretty false` 通过；`npm test` 131 files / 1232 tests、`npm run test:contract` 40 files / 338 tests、`npm run lint:architecture` 42 files / 253 tests、本 change strict validation 均通过；`git diff -- packages/agent-contracts` 无输出。总门禁尚未完成：`npm run build` 被未触达的 `packages/agent-workflow/tests/workflow-interaction-nodes.test.ts` 既有类型错误阻断；`openspec validate --all --strict` 仅未触达的 `add-ts-toggle-question-favorite` 失败。
  实际结果（2026-07-31）：加入 Context Engine 位置修复后，受影响三个 production projects typecheck 通过；再次运行 `npm test` 131 files / 1232 tests、contract 40 files / 338 tests、architecture 42 files / 253 tests、本 change strict validation 均通过。总门禁仍只被上述未触达 workflow 类型错误和 `add-ts-toggle-question-favorite` validation 阻断。
  实际结果（2026-07-31）：将 workflow 测试对 opaque `pendingInput` 的数组索引改为公开 JSON 投影结构断言，并修正 `add-ts-toggle-question-favorite` Requirement 的解析段落后，`npm run build`、`npm test`（131 files / 1232 tests）、`npm run test:contract`（40 files / 338 tests）、`npm run lint:architecture`（42 files / 253 tests）与 `openspec validate --all --strict`（275 items）全部通过；`git diff --check` 通过，`git diff -- packages/agent-contracts` 无输出。
  实际结果（2026-07-31）：合入最新 `origin/main` 并移除 `extend-ts-workflow-batch-config-scope` delta 文件的 UTF-8 BOM 后，最终门禁再次全部通过：`npm run build`、`npm test`（131 files / 1237 tests）、`npm run test:contract`（40 files / 339 tests）、`npm run lint:architecture`（42 files / 254 tests）与 `openspec validate --all --strict`（278 items）；受影响定向测试 5 files / 86 passed / 2 skipped，四个受影响 workspace typecheck 通过。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”同步 stable specs、Functions、architecture 和 module 文档；Feature、overview、ADR 与 spec-to-design-map 不新增变化。
