## Why

使用 builtin `SYSTEM_PROMPT` 的 Agent 在长期记忆写入触发上存在可观察的稳定性问题：

- **触发条件过度膨胀**：当前 `memory.md` 把 `add_memory` 触发条件列为 5 类（显式指令、纠正历史信息、澄清后的确认信息、稳定偏好/约束、任务异常触发），其中"任务异常触发"（Agent 任务执行错误、Tool call 失败及解决方法）授权模型在任务失败时主动写入记忆。这会让模型在普通排障过程中写入大量推断型、未经验证的经验，与 `memory-tools` spec "模型观察/推断型知识不得通过 `add_memory` 写入"的边界冲突，并在电信网络运维场景中引入未经验证的 PROCEDURAL 记忆（例如一次命令失败就固化"该命令已废弃"的结论），影响后续诊断准确性。
- **"记住"声明与实际持久化混淆**：当前 `memory.md` 没有明确区分模型口头确认"记住了"与实际调用 `add_memory` 工具持久化。模型可能在回复中说"Got it, I'll remember that"却未触发工具调用，导致用户误以为信息已持久化，但下一会话信息丢失。这是最终用户可观察的信任问题。
- **核验缺失**：当前 `memory.md` 没有要求模型在 turn 结束前核验"承诺记住的内容是否真的产生了 `add_memory` 调用"，导致上述混淆无法在 turn 内自纠。
- **skip list 与触发条件耦合不清**：当前"What not to save"清单与 5 类触发条件并列，但没有明确 skip list 适用于所有触发类别，模型在"任务异常触发"等类别下容易绕过 skip list。

现在处理是因为上述问题已在电信网络智能体实际运行中造成未经验证的 PROCEDURAL 记忆污染和用户信任落差，且 `memory.md` 是 `memory-tools` spec 明确引用的"完整存记忆触发条件清单"唯一承载位置，必须通过 OpenSpec change 同步调整 spec 授权和 prompt 正文。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 使用 builtin `SYSTEM_PROMPT` 的 Agent 在 `add_memory` 触发上只依赖两个明确类别：（1）用户显式记忆指令；（2）Agent 主动澄清后用户提供的可复用稳定信息。其他观察、推断、纠正或任务异常不得作为独立触发类别。
- 模型在任何 turn 中口头确认"记住"时，必须伴随实际 `add_memory` 工具调用；无工具调用的口头确认不持久化任何内容，且 `memory.md` 明确声明这一约束。
- 模型在 turn 结束前核验承诺记住的内容是否已产生 `add_memory` 调用；未产生则补发调用。
- `memory.md` 保留"不记什么"（skip list）清单，并明确 skip list 适用于全部触发类别，不得因触发类别不同而绕过。
- `memory.md` 的触发条件清单、skip list 和核验规则由 `memory-tools` spec 和 `prompt-template-assembly` spec 共同授权承载，spec 与 prompt 正文一致。

**非目标：**

- 不改变 `add_memory` 工具的 schema、输入字段、category 内容格式、写入语义、idempotency、scope 安全或失败/降级行为——这些由 `memory-tools` spec 既有 Requirement 承载，本次不改。
- 不改变 `memory` section 的渲染顺序、`memoryEnabled` 门控、section 文件来源或 system prompt 装配边界——这些由 `prompt-template-assembly` spec 既有 Requirement 承载，本次不改。
- 不引入 `update_memory`、`forget_memory` 或任何新的 model-facing 记忆工具。
- 不改变 `memory-core`、`memory-extraction`、`memory-aging` 的行为契约。
- 不改变 Agent package 覆盖 `memory.md` section 的既有优先级语义。
- 不把"任务异常经验"作为独立触发类别保留；任务失败中的可复用经验只能由用户显式要求记住时才写入，或由 future 显式授权的 dreaming/extraction 边界处理。

## What Changes

### 修改

- **`FN-8.2 检索和写入记忆`**（`memory-tools` spec）：`add_memory` 的模型可见触发条件清单从 5 类收敛为 2 类。删除"用户纠正历史信息""稳定偏好/约束"和"任务异常触发"作为独立触发类别；"显式记忆指令"覆盖"记住/以后/默认/不要"等所有用户显式声明场景，"澄清后的确认信息"保留为第二类别。skip list（不记什么）从触发条件并列关系改为适用于全部触发类别的横切约束。新增模型 turn 内核验义务：承诺记住必须伴随 `add_memory` 调用。这些变更仅影响 `memory.md` 承载的策略正文，不改变 `add_memory` 工具的 schema、写入语义或失败行为。

- **`FN-10.4 自定义工具和提示词`**（`prompt-template-assembly` spec）：`memory.md` 正文策略层约束从"何时记、记什么、不记什么、何时检索、核验与边界"细化为"何时记（2 类触发）、记什么（每项独立调用、不臆造可选字段）、不记什么（skip list 横切适用）、何时检索、核验（turn 内核验工具调用存在）、边界（口头确认不持久化）"。不改变 `memory` section 渲染顺序、文件来源或 `memoryEnabled` 门控。

## Function 影响（OpenSpec Capabilities）

### 修改的 Function

- `FN-8.2 检索和写入记忆` → `specs/memory-tools/spec.md`
  - 功能边界：`add_memory` 模型可见触发条件清单从 5 类收敛为 2 类（显式记忆指令、澄清后的确认信息）；skip list 成为横切约束；新增 turn 内核验义务和"口头确认不持久化"约束。不改变工具 schema、写入语义、scope 安全或失败行为。
  - 系统质量属性：可靠性/恢复（减少未经验证 PROCEDURAL 记忆污染）、可维护性、可测试性
  - 映射说明：canonical spec `memory-tools`；本次触及 `memory-tools`（`add_memory structured write` Requirement 的 `memory.md` 触发条件承载描述）

- `FN-10.4 自定义工具和提示词` → `specs/prompt-template-assembly/spec.md`
  - 功能边界：`memory.md` 正文策略层约束细化，新增"核验"和"边界"维度的明确正文要求。不改变 section 渲染顺序、文件来源或门控。
  - 系统质量属性：可维护性、可测试性
  - 映射说明：canonical spec `prompt-template-assembly`；本次触及 `prompt-template-assembly`（`System prompt memory guidance section` Requirement 的 `memory.md` 正文要求描述）

## 影响范围（Impact）

- **最终用户**：用户显式要求记住的内容会更可靠地持久化（turn 内核验）；用户不再因模型口头确认而误以为信息已存储。任务失败经验不再被模型主动写入，避免未经验证的电信运维结论污染记忆库。
- **Agent 开发者**：覆盖 `memory.md` section 的 Agent package 需注意新的触发条件结构；既有依赖"任务异常触发"写入 PROCEDURAL 记忆的 Agent 需改为由用户显式指令触发。
- **运维人员**：记忆库中 PROCEDURAL 类条目的来源更可控，减少推断型污染，降低审计和清理成本。
- **受影响代码**：`packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/memory.md`（正文更新）。
- **受影响测试**：既有 `memory.md` section 内容相关 prompt template tests 需同步更新断言（触发条件清单、skip list、核验规则）。
