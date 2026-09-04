## 设计范围

| Function | 目标变化 | Delta spec | 设计章节 |
|---|---|---|---|
| `FN-10.4 自定义工具和提示词` | 统一跨 Tool guidance，并使 11 个 Tool descriptor 与实际 contract 对齐 | `prompt-template-assembly` | `FN-10.4 工具指导装配` |

## FN-10.4 工具指导装配

### 目标与规范依据

模型需要从同一组规则中判断文件操作、命令执行、Python snippet、知识检索、Skill/Agent 调用和 deferred capability discovery，同时依据真实 Tool outcome 采取恢复动作。

本 Function 的目标 Requirements：

- `ADDED 系统提示词与 Tool descriptor 提供一致的工具调用指导`

唯一 canonical spec：`prompt-template-assembly`。

### 当前实现

`agent-context-engine` 通过 builtin `SYSTEM_PROMPT` 的 `tooling.md`、`workspace.md` 和 `agent-delegation.md` 提供通用指导。`agent-capability` 在每个 Tool definition 中提供 model-visible description，部分 schema property 还提供字段 description。当前通用规则较少，许多跨 Tool 选择边界分散在各 descriptor 中；部分 descriptor 对 outcome 的表述与实际 executor mapping 不完全一致。

### GAP 分析

- 文件名、文件内容和已知路径的决策顺序没有单一主承载位置。
- Bash 与专用 Tool 的关系被窄化为 diagnostic/shell-only，不能准确表达 sandbox policy 所拥有的权限边界。
- Python snippet 与已有 Python script 的输入形态边界不对称。
- Skill、Agent 和 ToolSearch 的可见性约束分散且容易被任务动词覆盖。
- 已披露 Skill/Agent、实际调用结果、外部依赖健康和源码完整性之间缺少明确证据边界，模型会把 execution view 的空结果错误推广为能力未实现。
- 并行指导强调调用数量而未先约束必要性和独立性，模型会拆分可由单一 Glob pattern 覆盖的扩展名变体。
- 通用 outcome 恢复原则缺失，而个别 descriptor 把不同 Tool outcome 表述成普通返回。
- Bash background schema description 与 runtime message 对是否自动通知存在冲突。

### 修改方案

1. 在 `SYSTEM_PROMPT/tooling.md` 增加动作优先、专用 Tool 优先、最短合法链、并行依赖和通用 outcome 处理；不加入 Tool schema 细节。
2. 在 `SYSTEM_PROMPT/workspace.md` 增加 execution-view path 复用、已知/未知目标判断以及 Read/Write/Edit/Glob/Grep 的统一分工。
3. 在 `SYSTEM_PROMPT/agent-delegation.md` 收敛 Skill、Agent 和 ToolSearch 的 visibility/disclosure 边界，并保留 Agent isolated context 约束。
4. 在 11 个 Tool definition 中使用一致结构表达 Tool-local purpose、use/not-use、authority、input/output limits 和实际 key outcomes；不复制完整全局路由规则。
5. 仅修正与当前实现矛盾的 schema field description，特别是 Bash background notification；不改变 schema shape 或 validator。
6. 新增集中式 guidance contract test，断言正向边界和关键禁止项；各 Tool 既有测试继续断言自身 schema、outcome 和硬前置条件。
7. 在 `tooling.md` 规定可信上下文优先、单一最窄完整工具优先以及仅对必要且独立调用并行；空文件结果只约束实际搜索的 authorized execution roots。
8. 在 `agent-delegation.md` 明确已披露 Skill/Agent 列表是当前 request scope 的 capability visibility 权威事实，并区分 visibility、invocation、dependency health 与 source completeness；本次不修改 `renderAgentDisclosure()`。
9. 在 Glob descriptor 和 `pattern` 字段说明中披露 brace alternatives 与 character classes，并要求同一文件类别的扩展名变体优先使用单一覆盖 pattern；不修改 Glob schema、授权、500 条上限或执行实现。

质量属性影响：

- 可维护性：共享规则单点承载，减少 11 个 descriptor 间的重复和漂移。
- 可靠性：描述与实际 outcome mapping 对齐，避免把降级、超时或空结果误报为完成。
- 安全：Bash authority 明确归 composed sandbox policy，失败恢复不得绕过 authorization。
- 可测试性：集中式 contract test 覆盖跨 Tool 选择，Tool-local tests 覆盖实际字段和结果语义。

## 验证策略

- `agent-context-engine` prompt template tests：断言三个 builtin section 包含唯一职责的共享规则。
- `agent-capability` descriptor tests：断言 11 个 Tool descriptor 与 schema/实现一致。
- 集中式 guidance tests：覆盖 Issue 中的代表性错例及其反例，包括已知路径、未知文件名、未知内容、已有脚本、snippet、indexed knowledge、available Skill、available Agent 和 deferred Tool/Skill。
- 既有 capability tests：验证 schema、权限、结果状态和执行行为未发生变化。

## 长期基线刷新计划

- Stable spec：归档前把本 change 的 Requirement 合并到 `openspec/specs/prompt-template-assembly/spec.md`。
- Function：归档前刷新 `FN-10.4 自定义工具和提示词` 的描述、处理过程和结果摘要。
- Feature：无。
- overview：无。
- architecture：归档前评估 `capability-spi.md` 与 prompt template architecture 是否需要引用统一 guidance 分层；不重复规范正文。
- modules：归档前评估 `agent-capability.md` 与 `agent-context-engine.md` 的职责导航。
- ADR：无。
- spec-to-design-map：归档前为 `prompt-template-assembly` 补充本次验证入口。

## 风险与取舍

- 描述过长会增加模型上下文并稀释关键边界，因此共享规则只在 `SYSTEM_PROMPT` 出现一次，Tool descriptor 只保留 Tool-local 事实。
- 静态字符串断言无法直接证明所有模型 provider 的选择准确率，因此测试同时覆盖 descriptor contract、prompt composition 和代表性 intent fixture，不把某个模型版本的单次分类结果写成产品契约。
- Issue 样本包含依赖 runtime capability visibility 或 host path authority 的条件标签，门禁将同时覆盖正例和反例，不把所有历史期望标签机械固化。
