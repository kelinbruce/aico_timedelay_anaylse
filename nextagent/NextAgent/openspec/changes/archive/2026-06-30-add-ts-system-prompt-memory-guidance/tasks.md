## 1. system section 白名单与契约

- [x] 1.1 在 `packages/agent-context-engine/src/prompt-shaping/prompt-template-purpose-policy.ts` 的 `systemSectionOrder` 中，于 `tooling` 之后、`action_safety` 之前插入 `memory`。
  验证：`npx vitest run packages/agent-context-engine/tests/prompt-shaping.test.ts`（新增 `memory` 顺序断言通过）
  来源：spec `System prompt memory guidance section`；design 决策 5
- [x] 1.2 在 `PromptAssemblyRequest`（`prompt-template-types.ts`）增加可选 `memoryEnabled?: boolean` 字段。
  验证：`npx tsc --noEmit -p packages/agent-context-engine/tsconfig.json`
  来源：spec `Prompt assembly has one decision boundary`（MODIFIED）

## 2. memoryEnabled 推导与穿线

- [x] 2.1 在 `DefaultContextEngineDependencies`（`assemble-context.ts`）增加可选 `memoryToolCapabilityId?: string`。
  验证：`npx tsc -b packages/agent-app`；code review 确认 context engine 不引用记忆工具名
  来源：design 决策 1b；spec `Prompt assembly has one decision boundary`（MODIFIED）
- [x] 2.2 修改 `assemblePrompt`：`const memoryEnabled = this.deps.memoryToolCapabilityId !== undefined && visibleCapabilities.some((c) => c.capabilityId === this.deps.memoryToolCapabilityId)`，传入 `assemble({ ..., memoryEnabled })`。不新增 catalog 查询、不读 MemoryConfig、不 import memory 包、源码不含记忆工具名字面量。
  验证：`npx vitest run tests/contract/context-assembly-contracts.test.ts`；`grep -rn "search_memory\|LongTermMemory\|add_memory" packages/agent-context-engine/src` 为空
  来源：design 决策 1、1b；spec `memoryEnabled projection drives conditional rendering only`
- [x] 2.3 在 `create-app.ts` 组装 context engine 处注入 `memoryToolCapabilityId: searchMemoryCapabilityId`（复用既有导入）。
  验证：`npx tsc -b packages/agent-app`；`npx vitest run packages/agent-app`
  来源：design 决策 1b
- [x] 2.4 修改 `prompt-template-assembler.ts`：`PromptTemplateRenderContext` 增加可选 `memoryEnabled?: boolean`；`buildPromptTemplateRenderContext` 写入 `request.memoryEnabled === true`；`renderSections` 先建 ctx 再把 `{ memoryEnabled: ctx.memoryEnabled === true }` 传给 policy。
  验证：`npx vitest run packages/agent-context-engine/tests/prompt-shaping.test.ts`
  来源：design 决策 2
- [x] 2.5 negative：断言 `memoryEnabled` 不改变模板选择、模型选择、`modelOptions` 交接，且不被内联进 rendered prompt 文本；断言未 populate `enabledCapabilities`（`enabledSkills` 行为不变）。
  验证：扩展 prompt-shaping 测试，构造 `memoryEnabled=true` 装配请求，断言 `renderedContent` 不含 `memoryEnabled` 字面、`templateId` 不因投影变化、`enabledSkills` 仍为空
  来源：spec `memoryEnabled projection drives conditional rendering only`；design 非目标

## 3. system render policy 过滤与 memory 段

- [x] 3.1 扩展 `systemRenderPolicy.orderSections` 接收渲染上下文：当 `memoryEnabled !== true` 时过滤掉 `memory` section；`defaultRenderPolicy` 忽略该参数。更新 `PromptRenderPolicy` 接口与 `renderSections` 调用（先建 ctx 再传入 policy）。
  验证：`npx vitest run packages/agent-context-engine/tests/prompt-shaping.test.ts`（`memoryEnabled=false/未提供` 时 `memory` 段省略；`true` 时渲染）
  来源：spec `System prompt memory guidance section`；design 决策 4
- [x] 3.2 新增 `packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/memory.md`，**仅承载策略层**：何时检索（回答涉及事实/配置/流程/偏好/历史会话知识前调 `search_memory`）、何时记（仅用户明确要求记住/以后采用时调 `add_memory`，不存推断）、不记什么（临时上下文/公开通用知识/大段原文日志表/推断观察/疑似重复冲突）、推荐前先验证（记忆可能过时，行动前核验，冲突以现状为准）、记忆 ≠ plan/tasks。工具调用机制（参数、category 字段、L1/L2 披露、`purpose` 语义、`nextAction` 回执）由工具描述承载，不写入 `memory.md`。不含文件路径/frontmatter/MEMORY.md/update_memory/forget_memory。
  验证：code review 对照 `memory-tools` 工具描述与 spec 职责分层条款；prompt-shaping 渲染断言关键字
  来源：spec `System prompt memory guidance section`（策略层职责）；`memory-tools` spec
- [x] 3.3 在 `SYSTEM_PROMPT/template.yaml` 的 `tooling` 条目之后、`action_safety` 之前注册 `memory` section：`id: memory`，`file: memory.md`。
  验证：`npx vitest run packages/agent-context-engine/tests/prompt-shaping.test.ts`（`memory` 段在 `tooling` 后渲染、内容来自 `memory.md`）
  来源：spec `System prompt memory guidance section`；design 决策 3、5
- [x] 3.4 negative：断言 `memory` 段不含任何已检索记忆条目/id，且不指示自动检索注入。
  验证：扩展 prompt-shaping 测试，断言渲染输出不含记忆 id 与"自动检索/注入"语义
  来源：spec `Memory guidance does not preload memory`

## 4. 架构边界与回归

- [x] 4.1 扩展 `tests/architecture/prompt-template-assembly-boundary.test.ts`：`memory` 在 builder-owned system section 白名单内；构造非白名单 section id 的 SYSTEM_PROMPT 模板仍被拒绝。
  验证：`npx vitest run tests/architecture/prompt-template-assembly-boundary.test.ts`
  来源：spec `Prompt rendering supports governed template variables and optional substitutions`
- [x] 4.2 确认不违反 `memory-tools` spec「No context assembly mutation」：context assembly 仍不自动检索记忆，system prompt 不预加载记忆结果；context engine 未导入 memory 包/MemoryConfig、未 populate `enabledCapabilities`。
  验证：`npx vitest run packages/agent-memory/tests/memory-tools-provider.test.ts`；`grep` 确认 agent-context-engine 未新增 memory 导入
  来源：`memory-tools` spec No context assembly mutation 场景；AGENTS.md 边界
- [x] 4.3 集成测试 assemble-context → assembler 业务流闭环：`DefaultContextEngine` 注入 `memoryToolCapabilityId`，`capabilityCatalog` 返回含门控 capability 时 system prompt 含 `memory` 段；不含时省略。
  验证：`npx vitest run packages/agent-context-engine/tests/memory-guidance-integration.test.ts`
  来源：spec `Memory enabled renders guidance section` / `Memory not enabled omits guidance section`
- [x] 4.4 守卫 create-app 注入 `memoryToolCapabilityId`，防回归。
  验证：`npx vitest run tests/architecture/prompt-template-assembly-boundary.test.ts`（注入断言）
  来源：design 决策 1b

## 5. 验证和收尾

- [x] 5.1 运行 agent-context-engine 全量测试与架构测试门禁。
  验证：`npx vitest run packages/agent-context-engine tests/architecture/prompt-template-assembly-boundary.test.ts`
  来源：所有 spec requirement
- [x] 5.2 `openspec validate add-ts-system-prompt-memory-guidance --strict` 通过。
  验证：`openspec validate add-ts-system-prompt-memory-guidance --strict`
  来源：OpenSpec change 完整性
- [x] 5.3 检查无残留临时状态：`memory.md` 正文无硬编码路径/凭据；`memoryEnabled` 未被任何 SUMMARY_GENERATION / MEMORY_EXTRACTION 装配调用传入；`enabledCapabilities` 仍为 `[]`（未触及）。
  验证：`grep` 检查 + code review
  来源：design 非目标与质量属性

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的"归档前更新基线"处理：

- 合并 `openspec/specs/prompt-template-assembly/spec.md`：`memory` section、`memoryEnabled` 投影、system render policy 过滤 requirement。
- 更新 `openspec/designs/architecture/memory.md`：system prompt 条件渲染记忆指导、不自动注入。
- 更新 `openspec/designs/modules/agent-context-engine.md`：`memoryEnabled` 推导与 `memory` section 落点。
- 更新 `openspec/designs/spec-to-design-map.md`：`prompt-template-assembly` → `agent-context-engine` 导航（若缺）。
- 检查长期文档未重复定义同一状态机、API schema、数据 owner 或接口语义。
