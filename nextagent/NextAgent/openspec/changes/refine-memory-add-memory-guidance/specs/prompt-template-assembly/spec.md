## Function

- **所属 Function**：`FN-10.4 自定义工具和提示词`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: System prompt memory guidance section

系统 SHALL 在 builtin `SYSTEM_PROMPT` 模板中提供一个 `memory` section 作为 builder-owned system section，渲染顺序位于 `tooling` 之后、`action_safety` 之前。`memory` section 的内容 SHALL 来自独立的内容文件 `memory.md`，与其他 system section 形态一致，不通过 inline 变量承载正文。

`memory` section SHALL 仅当装配上下文的 `memoryEnabled` 投影为 true 时被渲染。`memoryEnabled` 为 true 即等价于 app 注入的记忆门控 capability id 出现在该 Agent 的模型可见 capability 集合中——也就是说，模型实际能调用该记忆工具；当该 capability id 不在集合中时，模型无法调用记忆工具，`memory` 指导段无意义，MUST NOT 渲染。当 `memoryEnabled` 为 false 或未提供时，system render policy MUST 在公共变量替换之前过滤掉 `memory` section，使其不出现在最终 system prompt 中。

`memory.md` 指导正文 SHALL 以策略层为主，并 MUST 覆盖以下六个维度：

1. **何时记**：触发条件清单恰好包含两类——显式记忆指令（用户明确要求记住，覆盖"记住""请记住""帮我存储""记住以上内容""记住以下内容""以后""未来""默认""不要""以后不要""默认不要"及任意语言等价表述）和澄清后的确认信息（模型主动澄清后用户提供的可复用稳定信息）。`memory.md` MUST NOT 把任务异常、纠正历史、推断偏好或其他类别作为独立触发类别承载。
2. **记什么**：单一 turn 中包含多个独立事实或定义时，每个事实 MUST 各自触发一次 `add_memory` 调用。`memory.md` MUST 要求模型不得为可选字段臆造值，用户未指定的可选字段 MUST 省略。
3. **不记什么**：`memory.md` MUST 承载 skip list，且 MUST 明确 skip list 横切适用于全部触发类别。skip list 至少 MUST 覆盖临时会话上下文或一次性调试状态、可从公开文档或检索获得的知识、大体量原始代码/日志/表格内容、推断或未经验证的观察、可能与既有记忆重复或冲突的内容。
4. **何时检索**：`memory.md` MUST 承载 `search_memory` 和 `get_memory_detail` 的策略层调用时机，包括首 turn 用户特征自动注入后的按需召回规则。工具 schema、L1/L2 渐进披露流程和参数细节由工具描述承载，`memory.md` MUST NOT 重复。
5. **核验**：`memory.md` MUST 要求模型在 turn 结束前核验：若模型在 turn 中向用户确认"已记住""记下了"或等价表述，该 turn 内 MUST 存在至少一次实际 `add_memory` 工具调用；未产生则 MUST 补发调用。
6. **边界**：`memory.md` MUST 明确声明，无 `add_memory` 工具调用的口头确认（例如"Got it""Noted""I'll remember that"或任意语言等价表述）SHALL NOT 持久化任何内容，信息 SHALL 在该 turn 结束时丢失；`add_memory` 是唯一持久化机制。

`memory.md` MAY 承载与存取策略紧密相关的最小调用提示，例如单次 ID 上限（`get_memory_detail` 最多 20 个 `longTermMemoryIds`）或按 `category` 的内容字段格式清单（`FACTUAL` / `CONCEPTUAL` / `PROCEDURAL` / `USER_CHARACTERISTICS` 的最小字段组合）。`memory.md` MUST NOT 重复完整工具 schema、L1/L2 渐进披露流程、`purpose` 语义、`nextAction` 回执或其他纯工具机制细节；这些 SHALL 由工具描述承载。`memory.md` MUST NOT 让 context assembly 自动检索或注入长期记忆结果，MUST NOT 预加载任何记忆条目到 system prompt，MUST NOT 提及文件路径、frontmatter、`MEMORY.md`、`update_memory` 或 `forget_memory`（首版不暴露这些工具）。该 section 不改变 `memory-tools` / `memory-core` / `memory-extraction` / `memory-aging` 的任何行为契约，触发条件清单和 skip list 的行为权威由 `memory-tools` spec `add_memory structured write` Requirement 承载。

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

#### Scenario: Memory guidance carries exactly two trigger categories
- **WHEN** `memory` section 被渲染
- **THEN** 该 section MUST 承载恰好两类触发条件：显式记忆指令和澄清后的确认信息
- **AND** 该 section MUST NOT 把任务异常、纠正历史、推断偏好或其他类别作为独立触发类别

#### Scenario: Memory guidance carries skip list applicable to all trigger categories
- **WHEN** `memory` section 被渲染
- **THEN** 该 section MUST 承载 skip list
- **AND** 该 section MUST 明确 skip list 适用于全部触发类别，不得因触发类别不同而绕过

#### Scenario: Memory guidance carries turn verification and verbal acknowledgment boundary
- **WHEN** `memory` section 被渲染
- **THEN** 该 section MUST 声明 turn 内口头确认"已记住"必须伴随 `add_memory` 调用
- **AND** 该 section MUST 声明无 `add_memory` 调用的口头确认不持久化任何内容
- **AND** 该 section MUST 要求模型在 turn 结束前核验 `add_memory` 调用是否存在

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：`memory.md` 正文策略层从"何时记、记什么、不记什么、何时检索、核验与边界"细化为六个明确维度，新增"核验"和"边界"维度的强制性正文要求，并明确触发条件恰好 2 类、skip list 横切适用、口头确认不持久化。section 渲染顺序、文件来源和 `memoryEnabled` 门控不变。
- **依据 Requirements**：`System prompt memory guidance section`

### 规格

- **规格项**：`memory.md` 策略维度
- **变更类型**：修改
- **原规格值**：何时记、记什么、不记什么、何时检索、核验与边界（未强制六个维度）
- **目标规格值**：恰好六个维度：何时记（2 类触发）、记什么（每项独立调用、不臆造可选字段）、不记什么（skip list 横切适用）、何时检索、核验（turn 内核验工具调用）、边界（口头确认不持久化）
- **依据 Requirements**：`System prompt memory guidance section`
