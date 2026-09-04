## 1. system section 白名单与渲染策略

- [x] 1.1 在 `packages/agent-context-engine/src/prompt-shaping/prompt-template-purpose-policy.ts` 的 `systemSectionOrder` 中，于 `memory` 之后、`action_safety` 之前插入 `skill_disclosure`，并加入 `dynamicSystemSections`。
  验证：`npx vitest run --config vitest.config.context-engine-local.ts packages/agent-context-engine/tests/prompt-shaping.test.ts`（27 tests passed；`skill_disclosure` 渲染在 CACHE_BOUNDARY 之后断言通过；契约测试 `context-assembly-contracts.test.ts` 顺序清单已同步并通过）
  来源：spec `System prompt skill disclosure section`；design 决策 1、4
- [x] 1.2 扩展 `SystemSectionRenderFilters` 增加 skill disclosure 门控字段 `skillDisclosureVisible`，`systemRenderPolicy.orderSections` 在门控不满足时过滤 `skill_disclosure` section。门控事实（`Skill`/`ToolSearch` TOOL 可见性 + 列表非空）由 `assemble-context.ts` 的 `skillDisclosureProjection` 推导：工具门控在投影推导处执行，列表非空在 render filter 处执行。
  验证：`npx vitest run --config vitest.config.context-engine-local.ts packages/agent-context-engine/tests/skill-disclosure-render.test.ts`（19 tests passed，含 Skill tool denied/filtered 时 section 省略的原有断言）
  来源：spec `System prompt skill disclosure section`（门控省略）；design 决策 2

## 2. 投影与变量

- [x] 2.1 在 `prompt-template-types.ts` 的 `PromptAssemblyRequest` 增加 `skillDisclosure` 投影字段（`mode` + 已过滤 `skills` 列表），删除 `enabledCapabilities` 字段；`prompt-template-assembler.ts` 的渲染上下文同步增删。
  验证：`npm run typecheck`（tsc -b 全 workspace 通过，无输出无错误）
  来源：spec `Prompt assembly has one decision boundary`（MODIFIED）
- [x] 2.2 在 `assemble-context.ts` 中新增 `skillDisclosureProjection`：从已算 `visibleCapabilities` 推导 `Skill`（及 tool-search 模式下 `ToolSearch`）TOOL 可见性与按原过滤规则（list 模式排除 DEFERRED/HIDDEN；tool-search 模式仅排除 HIDDEN）的 skill 列表，连同 `skillDisclosureMode`（来自 `DefaultContextEngineDependencies` 既有配置）传入 `assemble`；移除 `enabledCapabilities` 传递与 renderer 的 `skillDisclosureMode` option。过滤规则与原 renderer 函数逐条一致。
  验证：`npx vitest run --config vitest.config.context-engine-local.ts packages/agent-context-engine/tests/skill-disclosure-render.test.ts`（含 DEFERRED/HIDDEN/modelInvocable=false 过滤负例断言原样通过）
  来源：design 决策 2、6
- [x] 2.3 在 `variable-resolver.ts` 新增 `skillDisclosureList`（消费投影的已过滤 skills，渲染 `- <capabilityId>: <description>` bullet 列表）、`skillDisclosureMode`（模式值）与 `skillDisclosureBody`（mode 感知的 builtin 默认指令正文，正文文本迁至 `skill-disclosure-defaults.ts` 与原 renderer 逐字一致）三个变量；删除 `enabledSkills` 变量。列表过滤规则保留在 `skillDisclosureProjection`（policy 层），resolver 只做格式化。
  验证：`npx vitest run --config vitest.config.context-engine-local.ts packages/agent-context-engine/tests/prompt-shaping.test.ts`（27 tests passed，含 `{{ enabledSkills? }}` 编译期 fail-closed 断言与两模式正文分化断言）
  来源：spec `Prompt rendering supports governed template variables and optional substitutions`（MODIFIED）；design 决策 2、5
  实现说明：模板变量语法无条件分支，builtin 两套默认正文经 `skillDisclosureBody` 受治理变量按模式解析（正文文本存于 `skill-disclosure-defaults.ts`，与原 renderer 逐字一致）；Agent 覆盖 `skill_disclosure` section 即完全接管正文，可引用 `{{ skillDisclosureMode }}` 自行分化。

## 3. builtin 模板内容

- [x] 3.1 新增 `packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/skill-disclosure.md`：承载 `### Available skills`（引用 `{{ skillDisclosureList }}`）与 `{{ skillDisclosureBody }}`（两套默认英文正文，list 模式 14 条、tool-search 模式 14 条，与 `model-input-renderer.ts` 原硬编码文本逐字一致）；在 `template.yaml` 的 `memory` 之后注册 `skill_disclosure` section。
  验证：`npx vitest run --config vitest.config.context-engine-local.ts packages/agent-context-engine/tests/skill-disclosure-render.test.ts`（19 tests passed——现有全部文本断言（含 `call the Skill tool immediately in the same assistant turn`、`Such planning text is incomplete`、tool-search 模式 `defer_loading=true` 等）一字未改、原样通过，作为逐字一致的 characterization 证据）
  来源：spec `System prompt skill disclosure section`；design 目标（零行为漂移）
- [x] 3.2 从 `tooling.md` 移除 `{{ enabledSkills? }}` 引用；`tooling.md` 其余内容不变。
  验证：`npx vitest run --config vitest.config.context-engine-local.ts packages/agent-context-engine/tests/prompt-shaping.test.ts`（tooling 文本断言原样通过）+ `skill-disclosure-render.test.ts` 新增 "renders the skill list exactly once" 断言（bullet 只出现一次、无 "Available skill capabilities" 旧标题）
  来源：spec `System prompt skill disclosure section`（skill 列表只出现一次）
- [x] 3.3 从 `model-input-renderer.ts` 删除 `renderSkillDisclosure`、`renderSkillToolSearchDisclosure`、`renderSkillList` 与 `skillDisclosureMode` option 及其 import；`renderSystemMessageText` 不再追加 skill disclosure（CLIP/agent/attachment disclosure 保持不变）。
  验证：`npm run typecheck` 通过 + `npx vitest run --config vitest.config.context-engine-local.ts`（agent-context-engine 全量 45 files / 423 tests passed）
  来源：proposal 变更范围；design 决策 2

## 4. Agent 覆盖与回归

- [x] 4.1 新增测试：agent 层模板注册覆盖 `skill_disclosure` section 后，最终 system prompt 该 section 内容完全来自覆盖内容，builtin 默认正文不出现；覆盖内容引用 `{{ skillDisclosureList }}`/`{{ skillDisclosureMode }}` 时解析正常。
  验证：`npx vitest run --config vitest.config.context-engine-local.ts packages/agent-context-engine/tests/prompt-shaping.test.ts`（"lets an agent template override the skill disclosure section while remaining gated" 通过：覆盖内容渲染、`### How to use skills` builtin 正文不出现、投影变量正常解析）
  来源：spec `Agent 覆盖 skill_disclosure section 生效`
- [x] 4.2 negative：Agent 覆盖 `skill_disclosure` 后，skill 列表为空时 section 仍被过滤省略；`skillDisclosureList` 投影不含 `modelInvocable=false`/HIDDEN Skills（由投影推导保证，覆盖内容消费同一投影）；system prompt 中 skill bullet 列表只出现一次。
  验证：同 4.1 测试用例（`skills: []` 时覆盖内容不出现）+ `skill-disclosure-render.test.ts` 既有过滤负例（`user-only`、`hidden-skill`、`search-skill` 不出现）+ 新增 "renders the skill list exactly once"
  来源：spec `Agent 覆盖 skill_disclosure 仍受门控约束`（skill-tool MODIFIED）
- [x] 4.3 扩展 `tests/architecture/prompt-template-assembly-boundary.test.ts`：`skill_disclosure` 在 builder-owned 白名单与 dynamic 集合内；`enabledSkills`/`enabledCapabilities` 在 variable-resolver 无残留。
  验证：`npx vitest run --config vitest.config.architecture.ts tests/architecture/prompt-template-assembly-boundary.test.ts`（11 tests passed）；非白名单 section id 拒绝由既有用例 "rejects system string content, identity fields, optional flags and invalid system sections" 持续覆盖
  来源：spec `enabledSkills 变量引用被编译期拒绝`（该 fail-closed 断言在 prompt-shaping.test.ts 变量用例中）
- [x] 4.4 回归端到端路径：`tests/smoke/framework-capability.smoke.test.ts` 与 `tests/e2e/p1-p2-scenario-gate/routing-child-agent.test.ts` 的 'Available skills' 断言路径。
  验证：smoke 测试因缺少真实模型环境变量（OPENAI_API_KEY/OPENAI_MODEL_NAME/OPENAI_BASE_URL，`describeRealModelSmoke` gate）在本机 skip，非本次改动导致；端到端渲染路径由 agent-context-engine 全量 423 tests（含 engine.render 集成路径）与 `npm test` 全量 173 files / 2252 tests 通过覆盖。push 前需在有真实模型配置的环境补跑 smoke/e2e gate。
  来源：proposal 影响范围
- [x] 4.5 negative：`skillDisclosureMode` 投影不改变模板选择、模型选择、`modelOptions` 交接，未被模板变量引用时不内联进 rendered prompt 文本。
  验证：`npx vitest run --config vitest.config.context-engine-local.ts packages/agent-context-engine/tests/prompt-shaping.test.ts`（"keeps the skill disclosure projection out of template selection and prompt text"：两模式 templateId 一致、渲染输出不含裸模式字面）
  来源：spec `skill disclosure 投影只驱动条件渲染与变量解析`

## 5. 验证和收尾

- [x] 5.1 运行 agent-context-engine 全量测试、契约测试与架构门禁。
  验证：`npx vitest run --config vitest.config.context-engine-local.ts`（45 files / 423 tests passed）；`npm run test:contract`（50 files / 388 tests passed，含更新后的 section 顺序契约）；`npm run lint:architecture`（54 files / 322 tests passed）；`npm test`（173 files / 2252 tests passed）；`npm run build`（通过）；`npm run typecheck`（通过）
  来源：所有 spec requirement；AGENTS.md 验证门禁
- [x] 5.2 `openspec validate add-skill-disclosure-template-section --strict` 通过。
  验证：`./node_modules/.bin/openspec validate add-skill-disclosure-template-section --strict` → "Change 'add-skill-disclosure-template-section' is valid"（初版遗漏 MODIFIED 块必需的基线场景，已补齐 skill metadata 相关 12 个场景与原披露格式场景后通过）。仓库既有 24 个其他 change/spec 的 validate --all 失败为 main 上的存量问题，与本次改动无关。
  来源：OpenSpec change 完整性
- [x] 5.3 检查无残留：`enabledSkills`/`enabledCapabilities` 在产品源码无引用（仅测试中以编译负例/历史注释形态出现于 prompt-shaping.test.ts 断言字符串）；`capability-listing-formatter.ts` 未接入未新增引用（现状保持，处置留待独立 change）；无临时 debug logging；临时验证用 `vitest.config.context-engine-local.ts` 已在收尾删除。
  验证：`grep -rn "enabledSkills\|enabledCapabilities" packages/ --include="*.ts" | grep -v tests` 为空；`git status` 核对改动文件清单
  来源：design 非目标；AGENTS.md 实现质量门禁

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的"归档前更新基线"处理：

- 合并 `openspec/specs/skill-tool/spec.md`：披露格式 Requirement 改写（模板承载 + Agent 定制 + 门控不变）。
- 合并 `openspec/specs/prompt-template-assembly/spec.md`：`skill_disclosure` section Requirement、变量注册表变更、投影集合变更。
- 更新 `openspec/designs/architecture/prompt-template-assembly.md`：capability disclosure 与通用模板渲染关系表述。
- 更新 `openspec/designs/modules/agent-context-engine.md`：section、变量、门控落点。
- 检查 `openspec/designs/spec-to-design-map.md` 导航，按需更新。
- 检查长期文档未重复定义同一状态机、API schema、数据 owner 或接口语义。
