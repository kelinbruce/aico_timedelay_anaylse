## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-8.2 检索和写入记忆` | `add_memory` 触发条件从 5 类收敛为 2 类；skip list 横切适用；新增 turn 内核验义务和"口头确认不持久化"约束 | `memory-tools` | `FN-8.2 检索和写入记忆` |
| `FN-10.4 自定义工具和提示词` | `memory.md` 正文策略层细化为六个维度；触发条件恰好 2 类；skip list 横切适用；新增核验和边界维度 | `prompt-template-assembly` | `FN-10.4 自定义工具和提示词` |

本次 change 不触及 legacy Requirement 迁移：两个 MODIFIED Requirement 均在其所属 Function 的 canonical spec 内原位修改，无跨 spec 迁移。

## `FN-8.2 检索和写入记忆`

### 目标与规范依据

proposal 指出当前 `add_memory` 触发条件过度膨胀（5 类含任务异常触发），导致模型在排障中写入未经验证的 PROCEDURAL 记忆，与 `memory-tools` spec "模型观察/推断型知识不得写入"的边界冲突；同时存在"口头确认≠持久化"混淆和 turn 内核验缺失问题。本设计闭合这些 GAP，只调整 `memory.md` 承载的策略正文和 spec 对触发条件清单的授权描述，不改变工具 schema、写入语义、scope 安全或失败行为。

#### 本 Function 的目标 Requirements

canonical spec：`memory-tools`

- `MODIFIED`：`add_memory structured write`

### 当前实现

- `packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/memory.md` 当前正文承载 5 类触发条件：(1) 显式指令、(2) 用户纠正历史信息、(3) 澄清后的确认信息、(4) 稳定偏好/约束、(5) 任务异常触发（含 Agent 任务执行错误和 Tool call 失败及解决方法）。
- `memory.md` 当前有"What not to save"清单，但未明确 skip list 横切适用于全部触发类别。
- `memory.md` 当前无 turn 内核验义务，无"口头确认不持久化"约束。
- `memory.md` 当前 note 指出 case (1) 直接调用工具，其他 case 在 session 结束后调用——这与工具实际行为冲突：`add_memory` 是同步 fast path，`nextAction` 要求不再重复调用，不存在"session 结束后调用"的机制。
- stable spec `memory-tools` 的 `add_memory structured write` Requirement 第 353 行触发机制描述只要求"明确要求记住/以后按这个来/默认采用"，但把"完整触发条件清单"授权给 `memory.md` 承载；spec 第 351 行要求 `memory.md` 承载 skip list。
- 工具代码（`agent-memory` memory tools provider）不依赖 `memory.md` 正文，只通过 capability descriptor description 引用"memory strategy section"；`memory.md` 改动不影响工具执行路径。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 触发条件恰好 2 类（显式记忆指令、澄清后确认） | `memory.md` 承载 5 类，含任务异常触发和纠正历史 | `memory.md` 正文需收敛为 2 类；spec 触发机制描述需同步 |
| skip list 横切适用全部触发类别 | `memory.md` 有 skip list 但未声明横切适用 | `memory.md` 需明确声明；spec 需授权 |
| turn 内核验：口头确认必须伴随 `add_memory` 调用 | `memory.md` 无核验义务 | `memory.md` 需新增核验规则；spec 需授权 |
| 口头确认不持久化 | `memory.md` 无此约束 | `memory.md` 需新增边界声明；spec 需授权 |
| `memory.md` 不承诺"session 结束后调用" | 当前 note 说其他 case session 结束后调用 | `memory.md` 需移除该 note，改为每项独立调用 |
| spec `add_memory structured write` 触发机制与 `memory.md` 一致 | spec 第 353 行描述较窄，未明确 2 类清单和排除项 | spec 需 MODIFIED 同步 |

### 修改方案

唯一修改路径是更新 `memory.md` 正文，使其承载新的 2 类触发条件、横切 skip list、turn 内核验规则和"口头确认不持久化"边界声明。spec 通过 MODIFIED `add_memory structured write` Requirement 授权这些策略正文约束。

**必须保留的现有实现路径**：
- `add_memory` 工具 schema、输入字段、category content 规范化、idempotency、scope 安全、失败/降级语义、`outcome`/`nextAction` 返回值——全部不变。
- `memory` section 渲染顺序（`tooling` 之后、`action_safety` 之前）、`memoryEnabled` 门控、文件来源（`memory.md`）——不变。
- 工具 descriptor 默认文案和 semantic guidance——不变（仍引用"memory strategy section"）。

**明确不修改的边界**：
- `memory-core`、`memory-extraction`、`memory-aging` 行为契约。
- Agent package 覆盖 `memory.md` section 的既有优先级语义。
- `search_memory` / `get_memory_detail` 的工具 schema 和调用机制。

**owner 与模块协作**：
- `memory.md` 是 `agent-context-engine` 拥有的 builtin prompt template 资源，由 context-engine prompt template assembly 在 `memoryEnabled=true` 时渲染。
- `agent-memory` memory tools provider 不消费 `memory.md` 正文，只通过 descriptor description 引用。
- spec `memory-tools` 的 `add_memory structured write` Requirement 把触发条件清单承载权授予 `memory.md`，spec 只定义边界约束（恰好 2 类、skip list 横切、turn 内核验、口头确认不持久化），不定义正文措辞。

**`memory.md` 目标正文结构**：
- 第 1 节 `search_memory` / `get_memory_detail` 策略：保留现有检索时机指导（首 turn 自动注入、按需召回），不改变。
- 第 2 节 `add_memory` 策略：
  - 触发条件恰好 2 类（显式记忆指令 + 澄清后确认），列出典型措辞。
  - 规则：每项独立调用、不臆造可选字段、turn 内核验工具调用存在。
  - skip list：横切适用全部触发类别。
  - 边界：口头确认不持久化，`add_memory` 是唯一持久化机制。
- 移除"session 结束后调用"note。

**失败路径**：
- `memory.md` 正文不合法（例如 Agent package 覆盖时违反 spec 约束）由 prompt template assembly compile-time validation 在 app startup 或 context-engine composition 时 fail closed，这是既有机制，本次不改变。
- `add_memory` 工具调用本身的失败/降级由 `memory-tools` spec 既有 Requirement 承载，不变。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | `add_memory structured write`（功能性 Requirement，无新增黑盒质量目标） | 减少未经验证 PROCEDURAL 记忆写入，降低记忆库污染 | prompt template tests 断言任务异常不作为独立触发类别 |
| 可测试性 | 同上 | `memory.md` 正文结构化，可断言 2 类触发、skip list、核验规则 | prompt template tests 断言正文包含必要维度 |

## `FN-10.4 自定义工具和提示词`

### 目标与规范依据

proposal 指出 `memory.md` 正文策略层需从"何时记、记什么、不记什么、何时检索、核验与边界"细化为六个明确维度，使触发条件、skip list、核验和边界约束有唯一承载位置。本设计闭合 `prompt-template-assembly` spec 对 `memory.md` 正文要求的 GAP，不改变 section 渲染机制。

#### 本 Function 的目标 Requirements

canonical spec：`prompt-template-assembly`

- `MODIFIED`：`System prompt memory guidance section`

### 当前实现

- stable spec `prompt-template-assembly` 第 435 行要求 `memory.md` 承载"何时记、记什么、不记什么、何时检索、核验与边界"，但未强制六个维度的正文结构，未明确触发条件恰好 2 类、skip list 横切适用、turn 内核验和口头确认边界。
- `memory.md` 当前正文有 5 类触发条件、skip list 未声明横切、无核验、无口头确认边界（与 FN-8.2 当前实现一致）。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| spec 要求 `memory.md` 承载六个维度正文 | spec 只泛化要求"何时记、记什么、不记什么、何时检索、核验与边界" | spec 需 MODIFIED 明确六个维度和各自强制内容 |
| spec 要求触发条件恰好 2 类 | spec 未限定类别数 | spec 需明确恰好 2 类并排除其他类别 |
| spec 要求 skip list 横切适用 | spec 未要求横切适用 | spec 需明确 skip list 适用于全部触发类别 |
| spec 要求 turn 内核验和口头确认边界 | spec 未要求 | spec 需明确这两个维度的强制正文 |

### 修改方案

唯一修改路径是 MODIFIED `System prompt memory guidance section` Requirement，把 `memory.md` 正文要求从泛化描述细化为六个维度的强制约束。`memory.md` 正文更新由 FN-8.2 的修改方案统一承载（同一文件），本 Function 只通过 spec 授权正文结构。

**必须保留的现有实现路径**：
- `memory` section 渲染顺序、`memoryEnabled` 门控、文件来源（`memory.md`）、section compile-time validation——不变。
- builtin prompt template registry 初始化、Agent package 覆盖优先级——不变。

**明确不修改的边界**：
- prompt template assembly 的 generic resolver boundary、variable renderer、section taxonomy——不变。
- `SUMMARY_GENERATION`、`MEMORY_EXTRACTION` 等 non-system purpose 的 ordered-section rendering——不变。

**owner 与模块协作**：
- `memory.md` 由 `agent-context-engine` 拥有。
- spec `prompt-template-assembly` 的 `System prompt memory guidance section` Requirement 定义 `memory.md` 正文结构约束；触发条件清单和 skip list 的行为权威由 `memory-tools` spec `add_memory structured write` Requirement 承载（跨 spec 引用，不重复定义）。

**失败路径**：
- `memory.md` 正文不符合 spec 约束（例如 Agent package 覆盖时缺失必要维度）由 compile-time validation fail closed，既有机制不变。

## 验证策略（Verification Strategy）

| 验证目标 | 验证层级 | 覆盖内容 |
|---|---|---|
| `memory.md` 正文承载恰好 2 类触发条件 | prompt template unit test | 断言正文包含显式记忆指令和澄清后确认两类，不含任务异常/纠正历史/推断偏好 |
| skip list 横切适用 | prompt template unit test | 断言正文声明 skip list 适用于全部触发类别 |
| turn 内核验规则 | prompt template unit test | 断言正文包含"口头确认必须伴随 add_memory 调用"和"turn 结束前核验" |
| 口头确认不持久化边界 | prompt template unit test | 断言正文包含"无 add_memory 调用的口头确认不持久化" |
| `memory` section 渲染顺序和门控不变 | contract test | 既有 prompt template assembly tests，不回归 |
| `add_memory` 工具 schema 和写入语义不变 | contract test | 既有 memory-tools contract tests，不回归 |
| negative: 任务异常不独立触发 | prompt template unit test | 断言正文不含"任务异常触发"作为独立类别 |
| negative: `memory.md` 不提及 `update_memory`/`forget_memory` | prompt template unit test | 既有断言，不回归 |
| OpenSpec 一致性 | `openspec validate --all --strict` | delta spec 合并键和规范关键词校验 |
| 架构边界 | architecture test | 既有 prompt template assembly boundary tests，不回归 |

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/memory-tools/spec.md`：MODIFIED `add_memory structured write` Requirement 合并到 stable spec。
- `openspec/specs/prompt-template-assembly/spec.md`：MODIFIED `System prompt memory guidance section` Requirement 合并到 stable spec。
- `openspec/designs/functions/D8-数据与记忆/D8.2-记忆/FN-8.2-检索和写入记忆.md`：更新"规格"表中 `add_memory` 触发条件类别和 skip list 适用范围（若该字段存在）。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.1-扩展与插件/FN-10.4-自定义工具和提示词.md`：无需更新（规格表不涉及 `memory.md` 正文维度细节）。
- `openspec/overview.md`：无需更新（无系统不变量变化）。
- `openspec/designs/architecture/`：无需更新（无架构边界变化）。
- `openspec/designs/modules/agent-context-engine.md`：无需更新（`memory` section 渲染机制不变）。
- `openspec/designs/modules/agent-memory.md`：无需更新（工具行为不变）。
- `openspec/designs/adr/`：无需新增 ADR（无长期技术决策变化）。
- `openspec/designs/spec-to-design-map.md`：无需更新（spec 到 design 映射不变）。

## 风险与取舍（Risks / Trade-offs）

- **风险：依赖"任务异常触发"的既有 Agent 需调整**。部分 Agent package 可能依赖旧 5 类触发条件中的"任务异常触发"自动记录 PROCEDURAL 经验。收敛为 2 类后，这类经验只能由用户显式要求记住或由 future dreaming/extraction 边界处理。缓解：MR 描述明确告知 Agent 开发者需调整为用户显式指令触发；电信网络运维场景中未经验证的 PROCEDURAL 记忆污染风险高于丢失部分自动经验的风险。
- **取舍：spec 同时 MODIFIED 两个 Requirement**。`memory.md` 正文约束由 `memory-tools` 和 `prompt-template-assembly` 两个 spec 共同授权——前者承载触发条件行为权威，后者承载正文结构约束。这避免了重复定义，但要求归档时两个 spec 同步合并。

## 待确认问题（Open Questions）

无。
