## 背景与问题（Why）

NextAgent 已具备完整的长期记忆能力：模型可调用工具 `search_memory`、`get_memory_detail`、`add_memory`（`memory-tools` spec），后台 extraction/dreaming 从 TaskTrajectory 自动抽取知识，aging 负责生命周期（`memory-core`、`memory-extraction`、`memory-aging` spec）。记忆按 owner scope（tenantId/subjectId/agentId）隔离，context assembly 明确禁止自动检索或注入长期记忆，模型必须主动调用工具回忆。

但当前 builtin `SYSTEM_PROMPT` 模板没有任何记忆指导段。模型不知道：

- 何时该在回答前调 `search_memory` 回忆跨会话知识；
- `search_memory` 应做一次广搜而非按类别扇出，`purpose` 仅对 `USER_CHARACTERISTICS` 有效；
- `add_memory` 仅在用户**明确**要求记住时调用，且按 `nextAction` 停止重复调用；
- 哪些内容不该写入（临时上下文、公开通用知识、推断观察、疑似重复冲突）；
- 记忆命名的具体事实/配置/流程在行动前需用工具或当前来源核验，因为记忆可能过时。

结果是即便记忆后端可用，模型也常常不去回忆或滥用 `add_memory`，长期记忆投资无法在主路径产生价值。本变更把长期记忆使用指导以**条件渲染**方式加入 system prompt：仅当长期记忆对该 Agent 实际启用时才渲染指导段，未启用记忆的 Agent 不受影响。

## 变更范围（What Changes）

- 在 builtin `SYSTEM_PROMPT` 模板中新增 `memory` section，位置在 `tooling` 之后、`action_safety` 之前；内容来自独立内容文件 `memory.md`，指导模型正确使用 `search_memory` / `get_memory_detail` / `add_memory`。
- `memory` section 由 system render policy 条件过滤：仅当 `memoryEnabled` 投影为 true 时渲染，否则在公共变量替换前被 policy 过滤省略。
- `memoryEnabled` 由 context engine 从该 Agent 模型可见 capability 集合推导：app 注入的记忆门控 capability id 在集合中即为 true。语义：指导段出现 ⇔ 模型实际可调该记忆工具；若某披露模式把该工具藏起来，模型调不了，省略指导段是正确行为。默认 `list` 披露模式下与"记忆已启用"等价。
- 架构边界（`memory-extraction-boundary`）禁止 `agent-context-engine/src` 出现记忆工具名字面量，故记忆门控 capability id 由 app 组装层注入 `DefaultContextEngineDependencies.memoryToolCapabilityId`，context engine 用注入值做泛化检查、不引用工具名。
- `PromptAssemblyRequest` 增加可选 `memoryEnabled` 布尔投影字段；`prompt-template-assembly` 的 system section 白名单加入 `memory`。

非变更：

- 不新增模型可调用工具，不修改 `memory-tools` / `memory-core` / `memory-extraction` / `memory-aging` 任何行为契约。
- 不让 context assembly 自动检索或注入长期记忆；不违反 `memory-tools` spec「No context assembly mutation」——system prompt 仅指导工具调用，不预加载记忆结果。
- 不暴露 `update_memory` / `forget_memory` 给模型（首版仍不暴露）。
- 不修复 `enabledSkills` 在请求路径上始终为空的缺口（独立 change 处理）；本变更不 populate `enabledCapabilities`。
- 不读 `MemoryConfig`、不导入 memory 包进 context engine；记忆门控 capability id 仅以字符串由 app 注入。
- **BREAKING**：无。`memoryEnabled` 可选，`memoryToolCapabilityId` 可选注入，`memory` section 在门控 capability 不可见时不渲染，现有 Agent 行为不变。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `prompt-template-assembly`: system prompt builder-owned section 列表新增 `memory`；装配请求允许携带 `memoryEnabled` 布尔投影用于条件渲染；system render policy 在 `memoryEnabled` 为 false 时过滤 `memory` section。

## 影响范围（Impact）

- 代码：
  - `packages/agent-context-engine/src/prompt-shaping/prompt-template-purpose-policy.ts`：`systemSectionOrder` 插入 `memory`；`systemRenderPolicy.orderSections` 接收渲染上下文并按 `memoryEnabled` 过滤 `memory` section。
  - `packages/agent-context-engine/src/prompt-shaping/prompt-template-types.ts`：`PromptAssemblyRequest` 增加可选 `memoryEnabled`。
  - `packages/agent-context-engine/src/prompt-shaping/prompt-template-assembler.ts`：`PromptTemplateRenderContext` 增加 `memoryEnabled`；`buildPromptTemplateRenderContext` 写入；`renderSections` 先建 ctx 再传给 policy。
  - `packages/agent-context-engine/src/assembly/assemble-context.ts`：`DefaultContextEngineDependencies` 增加可选 `memoryToolCapabilityId`；`assemblePrompt` 从 `visibleCapabilities` 推导 `memoryEnabled`（注入的 capability id 是否可见）并传入 `assemble`。
  - `packages/agent-app/src/composition/create-app.ts`：注入 `memoryToolCapabilityId: searchMemoryCapabilityId`。
  - `packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/`：新增 `memory.md`，`template.yaml` 注册 `memory` section。
- 契约：`PromptAssemblyRequest` 增加可选字段；不破坏现有消费者。
- 配置：无新配置；记忆是否启用仍由 `memory-tools` exposure gate 决定，本变更只从模型可见 capability 集合消费其结果，capability id 由 app 注入以守 context engine 边界。
- 测试：prompt-shaping 段落顺序/条件渲染测试、`prompt-template-assembly-boundary` 架构测试。
- 运维：无。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/prompt-template-assembly/spec.md`：修改（新增 `memory` section、`memoryEnabled` 投影与 system render policy 过滤语义）

长期背景：
- `openspec/overview.md`：无（长期记忆能力已在 overview 体现，本变更仅补主路径使用指导）

设计视图：
- `openspec/designs/architecture/memory.md`：补充一句——system prompt 通过 `memoryEnabled` 门控的条件渲染 `memory` section 指导模型主动调用记忆工具，仍不自动注入记忆结果
- `openspec/designs/modules/agent-context-engine.md`：补充 `memoryEnabled` 谓词注入与 `memory` section 的条件渲染落点
- `openspec/designs/adr/`：无
- `openspec/designs/spec-to-design-map.md`：补充 `prompt-template-assembly` 到 `agent-context-engine` 模块设计的导航（若尚未存在）

验证入口：
- `packages/agent-context-engine/tests/prompt-shaping.test.ts`：`memory` section 顺序与条件渲染
- `tests/architecture/prompt-template-assembly-boundary.test.ts`：`memory` 进白名单、非白名单 id 仍被拒
- `packages/agent-memory` 相关 spec 场景回归：不违反「No context assembly mutation」
