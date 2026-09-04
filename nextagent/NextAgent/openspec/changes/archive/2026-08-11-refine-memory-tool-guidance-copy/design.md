## 设计范围

本 change 修改 `FN-8.2 检索和写入记忆` 与 `FN-10.4 自定义工具和提示词`：升级三个内置 memory 工具的默认 `CapabilityDescriptor.description` 固化文案，并放宽 `SYSTEM_PROMPT/memory.md` 的正文边界，使其能在策略层之外承载与存取决策紧密相关的最小调用提示。

唯一实现路径是：`memory-tools` spec MODIFIED 三个 Requirement 的默认文案段、`prompt-template-assembly` spec MODIFIED `System prompt memory guidance section` 的正文边界；`agent-memory` 同步替换三段 description 字面量；`agent-context-engine` 同步替换 `memory.md` 内容文件。不引入新工具、新 schema 字段、新配置项或新装配流程。

## FN-8.2 检索和写入记忆

### 目标与规范依据

目标 Requirement 是 `search_memory L1 retrieval`、`get_memory_detail L2 retrieval`、`add_memory structured write`：内置默认工具描述 SHALL 由 spec 固化，Agent definition 可通过 `capabilityBindings[].description` 覆盖。本 Function 的目标 Requirements：

- `search_memory L1 retrieval`（MODIFIED）：默认描述改为结构化"何时检索 + 参数引导"两段式。
- `get_memory_detail L2 retrieval`（MODIFIED）：默认描述明确单次最多 20 个 ID 与 L2 完整结构化字段语义。
- `add_memory structured write`（MODIFIED）：默认描述改为"引用 memory 策略段 + 按 category 列出内容字段格式"。

### 当前实现

- `packages/agent-memory/src/memory-tools.ts`：`searchMemoryToolDefinition` / `getMemoryDetailToolDefinition` / `addMemoryToolDefinition` 各内联一段 `description` 字符串字面量，与 spec 固化文案逐字一致；`add_memory` 描述把"何时存"和"不存什么"压在工具自身。
- `openspec/specs/memory-tools/spec.md`：三个 Requirement 各有"Default tool description"段固化文案 + "Tool description semantic guidance"列出描述 MUST 覆盖的语义约束。

### GAP 分析

- `add_memory` 默认文案只覆盖"用户明确要求记住"单一触发条件，遗漏用户更正历史信息、消歧确认、稳定偏好/约束、任务执行异常可复用经验等高频存记忆场景；这些策略无法仅靠工具描述承载而不冗长，需要 `memory.md` 承载完整策略并把工具描述简化为"引用策略段 + 字段格式"。
- `search_memory` 默认文案为单段长文，参数引导不够结构化，模型容易误用 `categoryFilter`（如对探索性查询强行按 category 分发）或忽略 `get_memory_detail` 的 L2 下钻。
- `get_memory_detail` 默认文案未在描述中明示单次最多 20 个 ID，模型存在重复拉取或漏拉取倾向。
- 现有 `memory.md` 边界过严：禁止承载任何与工具调用相关的最小提示，导致策略层无法与工具参数引导形成连贯指引；需要放宽边界允许"与策略紧密相关的最小调用提示"。

### 修改方案

- `search_memory` 默认文案改为两段：首段说明检索目的、L1 摘要性质和 `get_memory_detail` 下钻关系；次段以"Parameter guidance"列出 `categoryFilter` 选择规则（不确定时单次 broad search、明确命名时使用、跨类别/探索性禁用）和 `categoryFilter=USER_CHARACTERISTICS` 需要 `purpose` 的约束。`purpose` 仅对 `USER_CHARACTERISTICS` 生效的语义保留在描述中。
- `get_memory_detail` 默认文案明确"Pass up to 20 longTermMemoryIds"和"per-entry results with full structured fields such as procedural text or conceptual definitions"。
- `add_memory` 默认文案改为"引用 memory 策略段 + 按 category 列出内容字段格式"：首段说明新增 ACTIVE 长期记忆并引用 `memory` 策略段；次段按 `FACTUAL` / `CONCEPTUAL` / `PROCEDURAL` / `USER_CHARACTERISTICS` 列出最小字段格式（如 `FACTUAL → subject + claim + optional evidence + optional qualifiers`）。字段格式仅作为最小调用提示，工具层仍按现有 `normalizeAddMemoryContent` 规范化为 core content，convenience 输入兼容（USER_CHARACTERISTICS 字符串、FACTUAL claim aliases、PROCEDURAL 字符串/JSON-string）保持不变。
- 三个 Requirement 的"Tool description semantic guidance"清单同步更新以匹配新文案覆盖的语义，保持"覆盖语义约束、不要求逐字拼接"的原则。

### 质量属性影响

无新增黑盒质量目标。本 change 不改工具行为、schema、scope 安全、失败语义或 capability 暴露门禁，仅升级模型可见描述文案与 `memory.md` 正文边界。可维护性影响：默认文案与 `memory.md` 由 spec 固化，Agent definition 仍可覆盖；文案变更需同步 spec、实现和断言文案/section 出现的测试。

## FN-10.4 自定义工具和提示词

### 目标与规范依据

目标 Requirement 是 `System prompt memory guidance section`：`memory.md` 正文 SHALL 以策略层为主，工具调用机制由工具描述承载。本 Function 的目标 Requirements：

- `System prompt memory guidance section`（MODIFIED）：放宽 `memory.md` 正文边界，允许承载与存取策略紧密相关的最小调用提示。

### 当前实现

- `packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/memory.md`：当前正文按"When to recall / When to save / What not to save / Verify before acting on memory / Memory is not plan or task tracking"组织，纯策略层，不重复工具参数。
- `openspec/specs/prompt-template-assembly/spec.md` line 429：`memory.md` MUST NOT 重复"参数、category 内容字段、L1/L2 渐进披露、`purpose` 语义、`nextAction` 回执等"机制细节。

### GAP 分析

- 新 `memory.md` 策略正文需要承载五类存记忆触发条件（显式指令、历史信息更正、消歧确认、稳定偏好/约束、任务异常可复用经验），并补充"首屏用户特征加载"和"按需召回"两个检索时机。其中部分内容（如"Pass up to 20 longTermMemoryIds"、按 category 的内容字段格式）属于与策略紧密相关的最小调用提示，但当前 spec line 429 禁止 `memory.md` 承载任何"参数、category 内容字段"。
- 需要放宽边界：允许 `memory.md` 承载与存取策略紧密相关的最小调用提示（单次 ID 上限、按 category 的内容字段格式清单），仍禁止重复完整工具 schema、L1/L2 渐进披露流程、`purpose` 语义、`nextAction` 回执、文件路径、`MEMORY.md`、`update_memory` / `forget_memory`。

### 修改方案

- MODIFIED `System prompt memory guidance section` Requirement：把 `memory.md` 正文边界从"仅策略层、MUST NOT 重复工具调用机制（参数、category 内容字段、L1/L2 渐进披露、`purpose` 语义、`nextAction` 回执等）"调整为"以策略层为主，MAY 承载与存取策略紧密相关的最小调用提示（如单次 ID 上限、按 category 的内容字段格式清单），MUST NOT 重复完整工具 schema、L1/L2 渐进披露流程、`purpose` 语义、`nextAction` 回执、文件路径、`MEMORY.md`、`update_memory` / `forget_memory`"。
- `memory.md` 替换为新策略正文：按 `search_memory` / `get_memory_detail` / `add_memory` 三个工具组织，包含首屏用户特征加载（fire-once-per-session）、按需召回、五类存记忆触发条件、不存什么清单、以及最小调用提示（单次 ID 上限、按 category 字段格式）。
- 渲染门禁不变：`memoryEnabled=true` 渲染、`memoryEnabled=false` 过滤、section 顺序位于 `tooling` 之后 `action_safety` 之前、内容来自 `memory.md` 文件、MUST NOT 预加载记忆条目或指示 context assembly 自动检索。

### 质量属性影响

无新增黑盒质量目标。`memory.md` 渲染门禁、装配流程、cache-boundary 和 system section 顺序不变。

## 跨 Function 职责切分

`add_memory` 默认描述通过"引用 memory 策略段"把"何时存/记什么"策略委托给 `memory.md`，`memory.md` 承载完整五类触发条件；工具描述只保留"引用 + 字段格式"。`search_memory` / `get_memory_detail` 的参数引导由工具描述承载，`memory.md` 仅承载检索时机策略（首屏加载、按需召回）和最小调用提示（单次 ID 上限）。两者不重复完整 schema、L1/L2 渐进披露流程、`purpose` 语义或 `nextAction` 回执。

## 备选方案

- 仅改 `add_memory` 默认文案覆盖五类触发条件、不动 `memory.md` 边界：会使工具描述过长，且策略与工具描述耦合，违反"策略层由 `memory.md` 承载"的设计意图。未采纳。
- 新增 `update_memory` / `forget_memory` 工具承载更正/删除：首版不暴露这些工具，超出本 change 范围。未采纳。
- 把 `memory.md` 边界彻底放开、不再约束机制细节重复：会导致策略正文与工具描述信息重复、维护成本上升，且违反"工具调用机制由工具描述承载"的长期设计。未采纳。

## 长期基线刷新计划

归档前同步：

- `openspec/specs/memory-tools/spec.md`：合并三个 Requirement 的新默认文案与新 semantic guidance 清单。
- `openspec/specs/prompt-template-assembly/spec.md`：合并 `System prompt memory guidance section` 的新正文边界。
- 无 Function / Feature / module / architecture / ADR / spec-to-design-map 变更（不改 capability 映射、owner、边界或契约 shape）。

## 验证

- `openspec validate --all --strict`。
- `packages/agent-memory` 相关单元测试：断言三个 `description` 字面量与新固化文案一致。
- `packages/agent-context-engine` prompt-template-assembly 测试：断言 `memory` section 在 `memoryEnabled=true` 时渲染、`memoryEnabled=false` 时过滤、内容来自 `memory.md`。
- `npm run lint:architecture`。
- push 前 `$nextagent-code-review` 模型语义检视。
