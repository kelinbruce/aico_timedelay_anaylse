# Tasks

## FN-5.14 搜索工具

- [x] 1. 先新增黑盒测试，覆盖 ToolSearch 默认可见且不隐藏现有 `modelInvocable=true` Tool/Skill。
  - 来源：`ToolSearch disclosure preserves existing model Tool Calling`、`Skill descriptor disclosure can be ToolSearch-deferred by trusted app configuration`
  - 验证：`npx vitest run --config vitest.config.release.ts packages/agent-context-engine/tests/skill-disclosure-render.test.ts tests/agent-kernel/config-assembly.test.ts -t "keeps ToolSearch visible by default|exposes stateless framework-default builtin capabilities"`
  - 预期：目标断言在实现前失败；实现后通过。

- [x] 2. 先新增黑盒和 negative tests，覆盖 deferred-only search、optional/empty/`*` query、`keyword|natural`、filters、bounded result、no-match 和非法输入。
  - 来源：`ToolSearch input supports keyword, natural, and bounded list queries`、`ToolSearch searches only governed visible tool metadata`
  - 验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/tool-search-tool.test.ts`
  - 预期：正常、边界和失败场景全部通过，`modelInvocable=true`、hidden 和 unavailable descriptors 不进入结果。

- [x] 3. 实现 ToolSearch 默认披露、输入归一化、deferred resolver 查询、确定性排序、metadata scalar filters 和 request-local activation。
  - 来源：design `FN-5.14 搜索工具 / 修改方案` 第 1 至 6、8 项
  - 验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/tool-search-tool.test.ts packages/agent-capability/tests/skill-tool.test.ts packages/agent-context-engine/tests/skill-disclosure-render.test.ts`
  - 预期：相关测试全部通过，Tool 和 Skill 分别写入 `allowedTools` 与 `discoveredSkills`。

- [x] 4. 复用 CLIP source 和普通 Tool activation 路径，使 ToolSearch mode 下的 CLIP-backed Tool 进入 deferred search pool。
  - 来源：`ToolSearch Projects Deferred CLIP Tool Results`；design `FN-5.14 搜索工具 / 修改方案` 第 7 至 8 项
  - 验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/clip-tool-source.test.ts tests/e2e/clipc-tool-search-lazy-context.test.ts`
  - 预期：startup snapshot 不触发全量 describe；命中候选通过 `allowedTools` 激活后按需水合 concrete `inputSchema`，结果不包含 CLIP provider 私有事实。

- [x] 5. 验证跨 step Skill/Tool 发现与调用路径。
  - 来源：`ToolSearch searches only governed visible tool metadata`、`Skill descriptor disclosure can be ToolSearch-deferred by trusted app configuration`
  - 验证：`npx vitest run --config vitest.config.release.ts tests/e2e/skill-tool-search-multi-round-context.test.ts`
  - 预期：ToolSearch patch 提交后，下一模型 step 可调用 activated Tool 或 `Skill(name=<capability_id>)`。

- [x] 6. 完成 Function 级验证。
  - 来源：proposal `目标`；design `验证策略`
  - 验证：`npm run build`；`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/tool-search-tool.test.ts packages/agent-capability/tests/skill-tool.test.ts packages/agent-context-engine/tests/skill-disclosure-render.test.ts tests/e2e/clipc-tool-search-lazy-context.test.ts tests/e2e/skill-tool-search-multi-round-context.test.ts`；`openspec validate fix-tool-search-default-skill-fallback --strict`
  - 预期：全部命令通过。

## 共享门禁

- [x] 7. 验证 OpenSpec 和仓库架构一致性。
  - 来源：design `验证策略`、`长期基线刷新计划`
  - 验证：`openspec validate --all --strict`；`npm run lint:architecture`
  - 预期：全部命令通过；归档前按长期基线刷新计划同步稳定文档。
