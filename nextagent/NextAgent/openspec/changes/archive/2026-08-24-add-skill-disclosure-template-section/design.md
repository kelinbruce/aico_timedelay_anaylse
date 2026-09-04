## 背景和现状（Context）

Skill 披露的渲染现状（`model-input-renderer.ts`）：

- `renderSkillDisclosure`（`list` 模式，348-368 行）：门控为 `Skill` TOOL 可见且 AVAILABLE；过滤 `kind='SKILL'` + AVAILABLE + `modelInvocable=true` + 非 DEFERRED/HIDDEN；渲染 `### Available skills`（`- <id>: <description>` bullet 列表）+ `### How to use skills`（15 条固定英文指令）。
- `renderSkillToolSearchDisclosure`（`tool-search` 模式，421-440 行）：门控为 `Skill` 和 `ToolSearch` 两个 TOOL 均可见；过滤放宽（仅排除 HIDDEN，DEFERRED 不进列表由 ToolSearch 发现）；指令为 13 条不同英文内容。
- 两段都由 `renderSystemMessageText`（180-193 行）追加在 `renderSystemPromptContent` 产物之后，即 CACHE_BOUNDARY 标记之后的 dynamic 区。

模板侧现状：

- `systemSectionOrder` 是 builder-owned 闭集（`prompt-template-purpose-policy.ts`），`mergeSections` 支持 agent 层同 id 覆盖 builtin、缺省回落。
- `memory` section 先例（2026-06-30 change）验证了"新增 section id + `SystemSectionRenderFilters` 条件过滤"路径。
- `{{ enabledSkills? }}` 变量（`variable-resolver.ts` 104-114 行）消费 `PromptAssemblyRequest.enabledCapabilities`；`assemble-context.ts` 683 行把 `visibleCapabilities` 传入。即 `enabledCapabilities` 在主路径上已被 populate（与 memory change 时代"始终为空"的旧况不同），skill 列表实际会渲染两次，且两次的过滤规则不同：变量版无任何门控（含 `modelInvocable=false`、HIDDEN），renderer 版有完整门控。
- `skillDisclosureMode` 当前只到达 renderer option（`assemble-context.ts` 550 行）和 capability filter（648-649 行），不进入模板装配请求。

规格现状：`skill-tool` spec "Skill disclosure 使用固定英文 prompt 格式"（122-128 行）冻结 heading 与 owner；`prompt-template-assembly` spec 288 行把 SYSTEM_PROMPT section id 限制在 builder-owned 闭集。两处均需经本 change 修改。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- Skill 使用指导（`### How to use skills` 指令正文）进入模板系统，Agent 可经既有 agent-over-builtin 机制定制。
- builtin 默认渲染产物与现状逐字一致（两种模式、含门控省略行为），零行为漂移。
- 收敛 skill 列表双来源：system prompt 中 skill 列表只出现一次，数据源统一为 post-patch `visibleCapabilities`，过滤规则单一 owner。
- 指令文本归入模板后保持 dynamic 区位置语义，不制造缓存边界行为变化。

**非目标：**

- 不模板化 CLIP、agent、attachment disclosure（同构但独立 change，避免单 change 蔓延）。
- 不为 `skillDisclosureMode` 扩展模板 `match` 选择维度。
- 不给覆盖内容做语义校验（不验证覆盖后的指令是否仍含"精确 name"等要求）。
- 不引入 per-section 的 Agent 模板允许列表或新配置项。
- 不改变 `Skill` tool 执行契约与 `skillDisclosureMode` 配置语义。

## 设计决策（Decisions）

**决策 1：新增专用 builder-owned section `skill_disclosure`，而非把指令塞进 `tooling.md` 或用变量承载。** 放进 `tooling.md` 意味着 Agent 要定制 skill 指导必须整体覆盖整个 tooling section（粒度过粗，且 tooling 是 stable 区，列表动态内容会破坏 stable 前缀）；纯变量承载（`{{ skillUsageInstructions? }}`）无法支持 Agent 定制正文。专用 section 让覆盖粒度恰好等于定制需求粒度。位置在 `memory` 之后、`action_safety` 之前：与 `memory` 同属"工具使用指导"族群，紧跟其后逻辑连贯。

**决策 2：门控与列表留在 policy 层，模板只消费安全投影。** 模板语法（闭集变量替换）表达不了"Skill TOOL 可见性 + modelInvocable + DEFERRED/HIDDEN 过滤"，这些治理规则必须留在 context engine。落法与 `memoryEnabled` 同构：`SystemSectionRenderFilters` 增加 skill disclosure 门控（`skillToolVisible` + `skillDisclosureAvailable`），`orderSections` 在门控不满足时过滤整个 section——Agent 覆盖内容同样被该门控约束，无法绕过。列表本体作为 `skillDisclosureList` 变量注入：由 policy 层按现有过滤规则从 `visibleCapabilities` 渲染 bullet 列表（含 `### Available skills` heading 语义），模板引用 `{{ skillDisclosureList }}`。列表过滤逻辑从 renderer 迁到 resolver 侧时保持规则逐条不变。

**决策 3：覆盖即接管，模式感知由覆盖方负责。** `skillDisclosureMode`（`list` / `tool-search`）作为新的安全投影变量暴露给模板；builtin `skill-disclosure.md` 内含两种模式的默认正文，按变量值选用。Agent 覆盖该 section 后：若覆盖内容仍引用 `{{ skillDisclosureList }}` / `{{ skillDisclosureMode }}`，则继续获得规范的列表投影与模式值，自行组织差异化文案；若覆盖内容不引用，则以覆盖内容为准。这与 `mergeSections` 既有覆盖语义（同 id 完全替换）一致，不新增"部分覆盖"或"指令继承"机制。硬性安全底线（门控省略、列表只含 governed name + safe description）由 policy 层保证，不依赖覆盖内容自觉。放弃"核心指令保留在不可覆盖层"备选：与既有 Agent 覆盖 `tooling.md` 的信任级别不一致，且把一段指令人为拆成两个渲染 owner，违背同形同策。

**决策 4：`skill_disclosure` 归入 `dynamicSystemSections`。** 列表内容随 request-local capability patch 变化，进 stable 区会造成 stable 前缀每请求变化。归 dynamic 区后渲染位置在 CACHE_BOUNDARY 之后，与现状（renderer 追加在 section block 末尾）语义一致。放弃"指令与列表拆两个 section、指令归 stable"的缓存优化备选：收益微小（指令文本约 2KB），拆分引入两个 section id 与两次门控，过度设计。

**决策 5：删除 `enabledSkills` 变量与 `enabledCapabilities` 投影，收敛双来源。** 保留 `enabledSkills` 意味着同一 skill 列表继续存在两个 owner、两套过滤（现状中变量版无门控，实际会把 `modelInvocable=false`/HIDDEN 的 skill 也披露进 `tooling` 段，本身就是披露缺陷）。`tooling.md` 移除 `{{ enabledSkills? }}` 引用后，`enabledCapabilities` 在主路径无消费者，一并下线。这是对 Agent 模板的受控 breaking（未知变量编译期 fail-closed）；当前仓库无 Agent 模板引用该变量。放弃"保留变量但修正其过滤"备选：两处列表语义注定趋同，保留即维持平行实现。

**决策 6：`skillDisclosureMode` 穿线路径改为装配投影。** 现状 mode 作为 renderer option 只到 renderer；本 change 把它同时作为 `PromptAssemblyRequest` 投影进入渲染上下文（供 `skillDisclosureMode` 变量与 render filters 使用），renderer option 删除。mode 仍是 trusted app config（config → `DefaultContextEngineDependencies`），不进入模板选择维度，不来自客户端请求。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 门控（Skill tool 可见性、列表为空）由 policy 层强制，覆盖不可绕过；列表投影只含 governed name + safe description；`skillDisclosureMode` 投影为受控枚举字符串，不内联进 prompt 文本（仅作为变量值被模板引用） | 门控测试 + 架构测试 + 覆盖负例测试 |
| 性能/容量 | builtin 默认渲染产物逐字不变，prompt token 无变化；列表过滤逻辑迁移不新增查询（复用已算 `visibleCapabilities`） | 渲染快照断言 |
| 可靠性/恢复 | 变量缺失/门控不满足时 section 省略，装配不失败；builtin 编译失败 fail startup（既有机制） | 条件渲染测试 |
| 可维护性 | skill 使用指导与 memory 指导同构（section + filter + 投影变量）；删除一段硬编码串与一个平行变量，净代码量下降 | code review |
| 可测试性 | 模式与门控均可在装配请求直接构造；覆盖行为可用 agent 层模板注册验证 | unit/contract tests |
| 审计/可追溯性 | 不引入新审计事实；模板 identity 经既有 `templateRef` 追踪 | 不适用 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| builtin 默认渲染产物与现状逐字一致（两模式） | T1/T4 | `skill-disclosure-render.test.ts` 现有断言迁移后全通过 |
| Skill tool 不可见/列表为空时 section 省略（覆盖内容同样被门控） | T3 | 门控过滤测试（含 agent 覆盖负例） |
| `skill_disclosure` 在 `systemSectionOrder`、位于 dynamic 区、CACHE_BOUNDARY 之后 | T2/T4 | `prompt-shaping.test.ts` 顺序与 marker 断言 |
| 列表只含 governed name + safe description（无 modelInvocable=false、HIDDEN、路径、内部 id） | T2 | 渲染断言负例 |
| Agent 覆盖生效、缺省回落 builtin、覆盖后可引用投影变量 | T4 | agent 层模板注册测试 |
| `enabledSkills` 变量删除后未知变量 fail-closed | T5 | 编译负例测试 |
| `tooling.md` 不再渲染 skill 列表 | T4 | 渲染断言（system prompt 中 `- <id>:` bullet 只出现一次） |
| mode 投影不进入模板选择/modelOptions、不内联 prompt | T3 | prompt-shaping 负例断言 |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/skill-tool/spec.md` 改写披露格式 Requirement（owner 从 "Context Engine 硬编码" 变为 "builtin `skill_disclosure` 模板 section + Agent 覆盖"）；`openspec/specs/prompt-template-assembly/spec.md` 新增 `skill_disclosure` section Requirement、修改变量注册表与决策边界投影集合。
- 架构/跨模块设计：`openspec/designs/architecture/prompt-template-assembly.md` 更新 capability disclosure 与通用模板渲染的关系表述。
- 模块设计：`openspec/designs/modules/agent-context-engine.md` 补 section、变量、门控落点。
- ADR：无（沿用 memory section 既有模式，无新架构决策）。
- 导航：`openspec/designs/spec-to-design-map.md` 检查后按需更新。

## 风险与取舍（Risks / Trade-offs）

- [删除 `enabledSkills` 变量] -> 对引用它的 Agent 模板是编译期 fail-closed；当前仓库无引用者，且变量现状存在无门控披露缺陷；受控 breaking，在 proposal 归档说明。
- [覆盖即接管后指令底线变为软要求] -> 门控与列表投影由 policy 强制；指令正文质量由 Agent package 治理评审兜底，与覆盖 `tooling.md` 的既有信任级别一致。
- [mode 感知依赖覆盖方自觉引用 `{{ skillDisclosureMode }}`] -> builtin 默认内容按模式分化；覆盖方不引用则以单套文案覆盖两模式，属其显式选择。
- [`renderSystemMessageText` 其余 disclosure（CLIP/agent/attachment）仍 renderer-owned] -> 本 change 范围外；skill 先行验证模式，后续 change 按同形同策跟进。
- [渲染产物逐字一致约束] -> 实现时以现有测试断言为基准迁移，任何空行/顺序差异都会被测试捕获。

## 迁移计划（Migration Plan）

- builtin 默认路径无迁移：渲染产物逐字不变。
- Agent 模板若引用 `{{ enabledSkills? }}`（当前无）将在 Agent assembly 编译期失败并得到 `PROMPT_VARIABLE_UNKNOWN` 安全错误，需改为引用 `{{ skillDisclosureList }}` 或自行覆盖 `skill_disclosure` section。
- 回滚：还原 policy/变量/renderer/模板文件与 `tooling.md`，无持久化数据迁移。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/skill-tool/spec.md`：合并改写后的披露格式 Requirement。
- `openspec/specs/prompt-template-assembly/spec.md`：合并 `skill_disclosure` section Requirement、变量注册表变更、投影集合变更。
- `openspec/designs/architecture/prompt-template-assembly.md`：更新 capability disclosure 表述。
- `openspec/designs/modules/agent-context-engine.md`：补落点。
- `openspec/designs/spec-to-design-map.md`：按需更新。
- `openspec/overview.md`：无。

## 待确认问题（Open Questions）

无。
