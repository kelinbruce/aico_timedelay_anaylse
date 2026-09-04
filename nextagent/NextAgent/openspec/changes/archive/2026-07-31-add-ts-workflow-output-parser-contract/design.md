## 设计目标

使 `outputs.output_parser` 作为 DSL 级控制配置正确生效：不作为输出数据传递、能控制前端显示行为、输出序列化遵循单值/多值格式化规则。

## 核心判定逻辑

### P1 output_parser 不投影

`projectNodeOutputs` 遍历 `outputs` 的 key-value 对时，当 key 为 `output_parser` 时跳过该 key，不写入 projected result。这确保：

- 后续节点的 variables 中不出现 `output_parser`
- `WorkflowNodeResult.output` 中不包含 `output_parser`
- `WorkflowExecutionEvent.output` 中不包含 `output_parser`

优先级：无论 `output_parser` 的值是什么（对象、字符串、null），只要 key 匹配就不投影。

### P2 resolveOutputParser 新增来源

`resolveOutputParser` 的查找顺序：

1. `node.presentation.outputParser`（最高优先级）
2. `node.outputParser`
3. `node.outputs.output_parser`（新增，最低优先级）

当高优先级来源存在且为 object 时，直接使用，不再查找低优先级来源。`outputs.output_parser` 的值必须是 object（isRecord 检查），否则忽略。

### P3 serializeOutput 格式化

`serializeOutput` 将 output 对象转换为字符串时：

- 0 个字段 -> 返回空字符串
- 1 个字段 -> 返回该字段的 value（不包含 key）
- 多个字段 -> 将每个字段的 value 用 `\n` 拼接

value 的格式化规则（`formatOutputValue`）：

- string -> 原值
- number / boolean -> `String(value)`
- 其他 -> `JSON.stringify(value)`

## 状态与产物契约

不涉及新契约。修改仅限于内部投影和序列化行为。

## 失败与降级

- `outputs.output_parser` 不是 object -> 忽略，不影响投影和显示控制
- `formatOutputValue` 遇到 undefined/null -> `JSON.stringify(undefined/null)` -> 不应发生，因为 `projectNodeOutputs` 已过滤 undefined

## 设计决策

### D1 过滤在 projectNodeOutputs 而非 engine 层

`output_parser` 是 DSL 声明层面的控制字段，不是业务输出。在投影层（`projectNodeOutputs`）过滤最为合理，因为所有节点类型的输出都经过此函数。engine 层无需额外处理。

### D2 outputs.output_parser 优先级最低

`presentation.outputParser` 和 `node.outputParser` 是显式声明，语义更明确。`outputs.output_parser` 是 DSL 1.0 惯例（放在 outputs 内），作为兼容来源，优先级应最低。

### D3 格式化在 projector 而非 engine 层

`serializeOutput` 是 projector 的内部方法，用于将 output 转为前端可见的字符串。格式化规则是展示层关注点，不应影响 engine 的 outputVariables 结构。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-9.1-执行工作流` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/workflow-output-parser-contract/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
