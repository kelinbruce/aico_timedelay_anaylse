## 背景和现状（Context）

NextAgent 长期记忆后端已就绪：`memory-tools` 暴露 `search_memory` / `get_memory_detail` / `add_memory` 三个模型工具，受 exposure gate（`MemoryConfig` VALID + Agent opt-in + memory core 可用）门控；`memory-core` / `memory-extraction` / `memory-aging` 承载存储、后台抽取与生命周期。`memory-tools` spec 明确禁止 context assembly 自动检索或注入长期记忆，模型必须主动调用工具回忆。

当前 builtin `SYSTEM_PROMPT` 模板（`packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/template.yaml`）有 identity / system_behavior / task_approach / communication_style / agent_delegation / tooling / action_safety / context_management / workspace / runtime / environment 等段，但**没有记忆使用指导段**。模型不知道何时该回忆、`add_memory` 仅在用户明确要求时调用、记忆命名的事实行动前需核验。

system prompt 的 section id 是封闭白名单（`prompt-template-purpose-policy.ts` 的 `systemSectionOrder`，由 `prompt-template-assembly` spec 强制校验"非 builder-owned section id 拒绝"）。`prompt-template-assembly` spec 已规定 system render policy 负责 system section 的 filter/order。新增 `memory` 段即修改 context 契约。

`assemble-context.ts` 的 `assemblePrompt` 已经收到 `visibleCapabilities`（`resolveCapabilities` 算出的模型可见 disclosed 集合），当前以 `_visibleCapabilities` 忽略。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 在 builtin `SYSTEM_PROMPT` 新增 `memory` section（独立 `memory.md` 内容文件），指导模型正确使用记忆工具。
- `memory` section 仅当模型实际可见/可调 `search_memory` 时渲染，否则省略，未启用记忆的 Agent 行为不变。

**非目标：**
- 不新增/修改任何记忆工具或记忆后端行为契约。
- 不让 context assembly 自动检索或注入记忆结果。
- 不暴露 `update_memory` / `forget_memory` 给模型。
- 不修复 `enabledSkills` 在请求路径上始终为空的缺口（独立 change 处理）；本变更不 populate `enabledCapabilities`。
- 不把记忆指导写成 per-Agent 可配置文本（首版用 builtin 固定正文）。

## 设计决策（Decisions）

**决策 1：门控 = 注入的记忆 capability id 在模型可见 capability 集合中。** `memoryEnabled = visibleCapabilities.some(c => c.capabilityId === memoryToolCapabilityId)`，在 `assemblePrompt` 用已有 `visibleCapabilities` 算（无新查询）。语义：指导段出现 ⇔ 模型真能调该记忆工具。若某披露模式把该工具藏起来，模型调不了，省略指导段反而正确——"披露脆弱性"在此语义下变成特性。

**决策 1b：capability id 由 app 注入，context engine 不引用记忆工具名。** 架构边界（`memory-extraction-boundary` 测试）禁止 `agent-context-engine/src` 出现 `search_memory`/`LongTermMemory`/`add_memory` 等字面量。故 app 组装层把 `searchMemoryCapabilityId`（已导入）作为 `memoryToolCapabilityId` 注入 `DefaultContextEngineDependencies`；context engine 用该注入值做泛化 `.some()` 检查，源码不含工具名。放弃"context engine 直接硬编码工具名"备选：违反边界；放弃"配置谓词"备选：per-assembly 谓词既要全局 `memoryToolsRegistered` 又要 `hasEnabledMemoryToolsOptIn(assembly)` 才正确，复杂且本质重推导可见集合已有答案；放弃"全局布尔"备选：丢失 per-Agent 可见性精度。

**决策 2：`memoryEnabled` 经 `PromptAssemblyRequest` → 渲染上下文 → policy 过滤。** context engine 在 `assemblePrompt` 算出布尔，经 `assemble({memoryEnabled})` 传入；`buildPromptTemplateRenderContext` 写入 `PromptTemplateRenderContext.memoryEnabled`；`systemRenderPolicy` 据此过滤。`memoryEnabled` 仅用于条件渲染，不参与模板/模型选择、不内联进 prompt。不 populate `enabledCapabilities`，避免触及 `enabledSkills` 行为。

**决策 3：独立 `memory.md` 内容文件。** `memory` section 用 `file: memory.md`，与 identity.md / tooling.md 等形态一致，指导正文在 md 文件中维护。

**决策 4：条件省略由 system render policy 过滤。** `memory.md` 是静态正文，无法靠"渲染为空"省略。spec 已规定 system render policy 负责 system section 的 filter/order，故扩展 `systemRenderPolicy.orderSections` 接收渲染上下文，在 `memoryEnabled !== true` 时过滤掉 `memory` section。放弃"inline `{{ memoryGuidance? }}` 变量承载正文"备选，因用户要求正文进 md 文件。

**决策 5：`memory` 段位置在 `tooling` 之后、`action_safety` 之前。** 记忆使用本质是工具使用指导，紧随 `tooling` 逻辑连贯。

**决策 6：指导正文为 builtin 固定英文文本。** 与现有 builtin SYSTEM_PROMPT 段一致用英文。Agent 可通过自身 `agent` source SYSTEM_PROMPT 模板整体覆盖该段（现有 agent-over-builtin 机制），无需新机制。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | `memoryEnabled` 仅布尔投影，不含 credential/路径/记忆内容；不内联进 prompt 文本；`memory` 段不预加载记忆结果、不提文件路径/update/forget。context engine 不读 MemoryConfig/memory gateway、不 import memory 包。 | prompt-shaping 条件渲染测试；架构边界测试；code review |
| 性能/容量 | `memory` 段仅一段短文本，仅 `search_memory` 可见 Agent 增加 prompt token；`memoryEnabled` 复用已算 `visibleCapabilities`，无新查询。 | prompt-shaping 渲染测试 |
| 可靠性/恢复 | `visibleCapabilities` 不含 `search_memory`（或 `memoryEnabled` 未提供）时 `memory` 段省略，降级为无记忆指导，不阻断装配。 | 条件渲染测试 |
| 可维护性 | 复用现有 section 白名单、system render policy、agent-over-builtin 覆盖机制；`memory.md` 与兄弟段形态一致。 | 架构边界测试；模块设计文档 |
| 可测试性 | `memoryEnabled` 可在装配请求直接构造；policy 过滤 deterministic。 | unit/contract tests |
| 审计/可追溯性 | 不引入新审计事实；记忆工具调用审计仍由 `memory-tools` owning path 承载。 | 不适用（现有路径足够） |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `memory` 为 builder-owned system section，顺序在 `tooling` 后 | T2 | `prompt-template-purpose-policy` 单测 + `prompt-template-assembly-boundary` 架构测试 |
| `memoryEnabled` 由注入的 capability id 对 `visibleCapabilities` 推导，无新查询/不读 MemoryConfig | T2.2/T4.3 | `memory-guidance-integration.test.ts` + code review |
| `memoryEnabled` 不参与模板/模型选择、不内联进 prompt | T3 | prompt-shaping 测试 |
| `memory` 段在 `memoryEnabled=false/未提供` 时被 policy 过滤省略 | T4 | prompt-shaping 渲染测试 |
| `memory` 段内容来自 `memory.md`，不含记忆条目/路径/update/forget | T4 | prompt-shaping 渲染快照 + code review |
| 不 populate `enabledCapabilities`（不触及 enabledSkills） | T3 | grep + code review |
| 不违反 `memory-tools` No context assembly mutation | T5 | memory spec 场景回归 + code review |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/prompt-template-assembly/spec.md` 主承载 `memory` section、`memoryEnabled` 投影与 system render policy 过滤契约。
- 架构/跨模块设计：`openspec/designs/architecture/memory.md` 补一句——system prompt 通过 `memoryEnabled` 门控的条件渲染 `memory` section 指导模型主动调用记忆工具，仍不自动注入记忆结果。
- 模块设计：`openspec/designs/modules/agent-context-engine.md` 补 `memoryEnabled` 推导与 `memory` section 条件渲染落点。
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md` 补 `prompt-template-assembly` → `agent-context-engine` 模块设计导航（若尚未存在）。

## 风险与取舍（Risks / Trade-offs）

- [system render policy 接口增加渲染上下文参数] -> 改动 `orderSections` 签名；default policy 忽略该参数，非系统 purpose 行为不变；架构测试守卫。
- [门控基于模型可见集合而非配置] -> 在非默认披露模式下若 `search_memory` 被藏，指导段省略；此为正确语义（模型调不了就不指导），非缺陷。
- [`search_memory` 字面量出现在 context engine] -> 架构边界禁止；改由 app 注入 `memoryToolCapabilityId`，context engine 源码不出现工具名（`memory-extraction-boundary` 测试守卫）。
- [Agent 覆盖 SYSTEM_PROMPT 时需自带 memory 段] -> 现有 agent-over-builtin 是整模板覆盖；首版接受，因当前无 Agent 自带 SYSTEM_PROMPT。
- [未修 `enabledSkills` 空缺] -> 该缺口与记忆门控无关，留给独立 change，避免本变更范围蔓延；故不 populate `enabledCapabilities`。

## 迁移计划（Migration Plan）

无迁移。`memoryEnabled` 可选，`memory` 段条件渲染，未启用记忆的 Agent 行为不变。回滚即还原 template.yaml / policy / assembler / assemble-context 改动。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/prompt-template-assembly/spec.md`：合并 `memory` section、`memoryEnabled` 投影、system render policy 过滤 requirement。
- `openspec/designs/architecture/memory.md`：补 system prompt 条件渲染记忆指导、不自动注入的事实。
- `openspec/designs/modules/agent-context-engine.md`：补 `memoryEnabled` 推导与 `memory` section 落点。
- `openspec/designs/spec-to-design-map.md`：补导航（若缺）。
- `openspec/overview.md`：无（长期记忆能力已体现）。

## 待确认问题（Open Questions）

无。
