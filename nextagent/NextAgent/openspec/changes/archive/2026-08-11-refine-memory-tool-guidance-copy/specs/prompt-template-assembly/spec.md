## Function
- **所属 Function**：`FN-10.4 自定义工具和提示词`
- **Function 变更类型**：MODIFIED
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: System prompt memory guidance section

系统 SHALL 在 builtin `SYSTEM_PROMPT` 模板中提供一个 `memory` section 作为 builder-owned system section，渲染顺序位于 `tooling` 之后、`action_safety` 之前。`memory` section 的内容 SHALL 来自独立的内容文件 `memory.md`，与其他 system section 形态一致，不通过 inline 变量承载正文。

`memory` section SHALL 仅当装配上下文的 `memoryEnabled` 投影为 true 时被渲染。`memoryEnabled` 为 true 即等价于 app 注入的记忆门控 capability id 出现在该 Agent 的模型可见 capability 集合中——也就是说，模型实际能调用该记忆工具；当该 capability id 不在集合中时，模型无法调用记忆工具，`memory` 指导段无意义，MUST NOT 渲染。当 `memoryEnabled` 为 false 或未提供时，system render policy MUST 在公共变量替换之前过滤掉 `memory` section，使其不出现在最终 system prompt 中。

`memory.md` 指导正文 SHALL 以策略层为主：何时记、记什么、不记什么、何时检索、核验与边界。`memory.md` MAY 承载与存取策略紧密相关的最小调用提示，例如单次 ID 上限（`get_memory_detail` 最多 20 个 `longTermMemoryIds`）或按 `category` 的内容字段格式清单（`FACTUAL` / `CONCEPTUAL` / `PROCEDURAL` / `USER_CHARACTERISTICS` 的最小字段组合）。`memory.md` MUST NOT 重复完整工具 schema、L1/L2 渐进披露流程、`purpose` 语义、`nextAction` 回执或其他纯工具机制细节；这些 SHALL 由工具描述承载。`memory.md` MUST NOT 让 context assembly 自动检索或注入长期记忆结果，MUST NOT 预加载任何记忆条目到 system prompt，MUST NOT 提及文件路径、frontmatter、`MEMORY.md`、`update_memory` 或 `forget_memory`（首版不暴露这些工具）。该 section 不改变 `memory-tools` / `memory-core` / `memory-extraction` / `memory-aging` 的任何行为契约。

**需求类别**：功能性需求

#### Scenario: Memory enabled renders guidance section
- **WHEN** 一次 `SYSTEM_PROMPT` 装配的 `memoryEnabled` 投影为 true
- **THEN** `memory` section MUST 出现在最终 system prompt 中，顺序位于 `tooling` section 之后、`action_safety` section 之前
- **AND** 该 section 内容 MUST 来自 `memory.md`

#### Scenario: Memory not enabled omits guidance section
- **WHEN** 一次 `SYSTEM_PROMPT` 装配的 `memoryEnabled` 投影为 false 或未提供
- **THEN** system render policy MUST 过滤掉 `memory` section
- **AND** `memory` section MUST 不出现在最终 system prompt 中

#### Scenario: Memory guidance does not preload memory
- **WHEN** `memory` section 被渲染
- **THEN** 该 section 内容 MUST NOT 包含任何已检索的记忆条目、记忆内容或记忆 id
- **AND** 该 section MUST NOT 指示 context assembly 自动检索或注入长期记忆

#### Scenario: Memory guidance carries minimal call hints without duplicating tool schema
- **WHEN** `memory` section 被渲染
- **THEN** 该 section MAY 包含与存取策略紧密相关的最小调用提示（单次 ID 上限、按 category 内容字段格式清单）
- **AND** 该 section MUST NOT 重复完整工具 schema、L1/L2 渐进披露流程、`purpose` 语义或 `nextAction` 回执
- **AND** 该 section MUST NOT 提及文件路径、frontmatter、`MEMORY.md`、`update_memory` 或 `forget_memory`

## Function 变更汇总

### 输出
- **变更类型**：修改
- **目标内容**：`memory.md` 正文边界从"仅策略层、MUST NOT 重复工具调用机制（参数、category 内容字段、L1/L2 渐进披露、`purpose` 语义、`nextAction` 回执等）"放宽为"以策略层为主，MAY 承载与存取策略紧密相关的最小调用提示（单次 ID 上限、按 category 内容字段格式清单），MUST NOT 重复完整工具 schema、L1/L2 渐进披露流程、`purpose` 语义、`nextAction` 回执、文件路径、`MEMORY.md`、`update_memory` / `forget_memory`"。
- **依据 Requirements**：`System prompt memory guidance section`

## 规格

| 规格项 | 目标值 |
|---|---|
| `memory.md` 正文边界 | 以策略层为主；MAY 承载最小调用提示（单次 ID 上限、按 category 字段格式清单）；MUST NOT 重复完整工具 schema、L1/L2 渐进披露流程、`purpose` 语义、`nextAction` 回执、文件路径、`MEMORY.md`、`update_memory` / `forget_memory` |
| `memory` section 渲染门禁 | `memoryEnabled=true` 渲染、`memoryEnabled=false` 过滤；section 顺序位于 `tooling` 之后、`action_safety` 之前；内容来自 `memory.md` 文件 |
