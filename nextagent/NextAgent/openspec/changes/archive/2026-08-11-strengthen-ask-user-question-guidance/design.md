## 设计范围

| Function ID | Function 名称 | 变更类型 | Delta specs | 设计章节 | 影响边界 |
| --- | --- | --- | --- | --- | --- |
| FN-5.6 | 向用户提问 | MODIFIED | `ask-user-question-tool`、`ask-user-question-trigger-policy` | `FN-5.6 向用户提问` | 内置 System Prompt、`AskUserQuestion` Tool 与输入 Schema 的模型可见描述，以及对应 characterization tests |

本次变更只调整模型可见指导，不改变 `AskUserQuestion` 的输入 shape、pending input lifecycle、Web API、stream event、answer contract、持久化或前端渲染。

## 存量 Requirement 迁移方案

| 来源 | 目标 | 迁移动作 | 保留内容 |
| --- | --- | --- | --- |
| `ask-user-question-trigger-policy` / `User-facing agents trigger AskUserQuestion for blocking ordinary user input` | `FN-5.6` canonical spec `ask-user-question-tool` 中的同名 Requirement | 来源 delta 标记 REMOVED，目标 delta 标记 ADDED；归档时原子迁移，不并存两份同名 Requirement | `ask-user-question-trigger-policy` 中 `Invoked read-only network explorer does not directly create user questions` 继续保留 |

迁移后的触发 Requirement 由 `ask-user-question-tool` 统一拥有。源 spec 因仍承载 network explorer 可见性边界而不退役；归档时同步更新 Feature、Function、模块与 spec-to-design map 中的 canonical/legacy 导航关系。

并行 active change `unify-capability-failure-disposition` 也修改目标 `ask-user-question-tool`，但只修改 `AskUserQuestion 可纠正输入错误进入安全模型纠错` 和 `AskUserQuestion 非纠正性失败保持终止和安全边界`，不触及本 change 迁移的 Requirement。两个 change 的实施 ownership 明确分离：本 change 只修改模型可见 prompt/descriptor/schema description，不修改 runtime validation 或失败处置；`unify-capability-failure-disposition` 继续拥有 runtime validation 与失败处置。归档顺序固定为先归档 `unify-capability-failure-disposition`，再基于刷新后的 stable spec 归档本 change 并重新运行 strict validate。

## FN-5.6 向用户提问

### 目标与规范依据

目标是让所有面向用户 Agent 在实际需要用户回答普通问题时，通过唯一的结构化 `AskUserQuestion` 通道提问，同时保持禁止用途的 purpose-specific 安全边界。

#### 目标 Requirements

- `ADDED`：`User-facing agents trigger AskUserQuestion for blocking ordinary user input`

主规格为 `ask-user-question-tool`；`ask-user-question-trigger-policy` 仅保留 network explorer 的历史可见性约束。

### 当前实现

- `agent-context-engine` 的 `tooling.md` 仅在当前任务无法安全继续时推荐 `AskUserQuestion`，没有禁止 assistant 文本问句的统一规则。
- `task-approach.md` 要求在多种解释或不确定时询问用户，但没有指定必须使用的提问通道。
- `agent-capability` 的 Tool description 对触发条件较保守且篇幅较长；Schema 字段描述混入较多策略性说明，降低了模型定位参数约束的效率。
- 既有实现已经提供自由文本、预设选项、多选、option-attached text input 与 question-level custom，且已有 pending input lifecycle；本次无需新增 runtime 能力。

### GAP 分析

| 目标 | 当前状态 | 差距 |
| --- | --- | --- |
| 所有实际需要用户回答的普通问题统一调用 Tool | System Prompt 只在阻塞安全推进时推荐调用 | 普通追问、偏好、实现选择或普通确认可能退化为 assistant 文本问句 |
| Prompt、Tool description、Schema description 语义一致 | 三处使用不同粒度与侧重点的描述 | 模型需要自行合并触发与参数规则，存在遗漏和冲突风险 |
| 普通确认与高风险确认边界明确 | 禁止项以笼统 confirmation 表述 | 可能误伤普通确认，或弱化受保护操作的独立审批边界 |

### 修改方案

1. 由 `agent-context-engine` 在 `task-approach.md` 增加全局提问通道规则：凡实际需要用户回答的问题必须使用 `AskUserQuestion`，不得在 assistant 文本中直接写问句。
2. 在 `tooling.md` 将追问、澄清、偏好、实现选择和普通确认明确为强制调用场景，并保留先使用已有上下文、可用工具或安全明确假设的原则。
3. 当 Tool 不可用时，不退化为文本问句；使用无需回答的安全假设继续，或给出不含问句的 blocked explanation。
4. 由 `agent-capability` 缩短 Tool description，明确 mandatory trigger、参数构造规则和禁止用途。普通确认允许使用；protected-operation approval 与 high-risk confirmation 继续禁止。
5. 将输入 Schema description 收敛为字段语义和局部约束，不改变 Schema shape 或 runtime validation。
6. 保持 `network-explorer` 不暴露 `AskUserQuestion` 的既有策略，不增加 forced tool choice、自然语言推断或 runtime 自动路由。

### 质量属性

- 本 change 不新增黑盒系统质量属性目标；其功能性 Requirement 只改变用户问题的模型可见触发指导。
- **安全**：凭据、secret、授权授予、受保护操作审批和高风险确认继续由专用 owner 与 guard 处理。
- **可维护性**：触发规则集中到同一 Function 的 canonical spec，模型可见描述使用一致词汇。
- **可测试性**：通过 prompt rendering 与 Tool descriptor characterization tests 锁定强制规则、禁止用途和 Schema description。

### 验证策略

- 定向测试内置 System Prompt 渲染后同时包含 task approach 与 tooling 的 mandatory guidance，并不再保留冲突的保守触发语句。
- 定向测试 `AskUserQuestion` Tool description 与各 Schema description 的目标文本及禁止用途边界。
- 运行受影响 package 测试与构建，确认 descriptor/schema shape 和 prompt assembly 无回归。
- 运行 `openspec validate --all --strict`，确认 Requirement 迁移、Function 映射和 change 结构有效。

## 基线归并计划

- **Stable specs**：将同名触发 Requirement 从 `ask-user-question-trigger-policy` 原子迁入 `ask-user-question-tool`；前者保留 network explorer Requirement。
- **Function**：更新 `FN-5.6` 的描述、处理过程、用户问题通道规格和 canonical/legacy spec 导航。
- **Feature**：更新 `F-5.4` 的用户可见保证，明确普通问题通过结构化提问交互发出。
- **Overview**：同步 System Prompt 与 Tool descriptor 的统一触发原则。
- **Architecture / modules**：更新 `agent-context-engine` 的 prompt shaping 说明和 `agent-capability` 的内置 Tool descriptor 责任；不改变 runtime owner 边界。
- **ADR**：不新增。该变更不引入新的架构决策或不可逆技术选型。
- **Spec-to-design map**：将触发 Requirement 的 canonical 映射指向 `ask-user-question-tool`，保留 legacy spec 对 network explorer Requirement 的映射。

## 风险与缓解

- **过度提问**：强制规则可能诱导模型询问可自行取得的信息。通过“先使用上下文、工具或安全明确假设，仅在实际仍需回答时提问”限制触发范围。
- **确认语义混淆**：普通确认与安全审批容易被同一词覆盖。描述中显式区分 ordinary confirmation 与 protected-operation/high-risk confirmation，并让禁止用途优先。
- **Tool 不可用**：若某个用户可见 Agent 未绑定 Tool，纯文本追问会破坏统一交互。指导要求改用安全假设或无问句的 blocked explanation，避免静默降级。

## Open Questions

无。
