## 背景与问题（Why）

workflow 节点 DSL 中，`output_parser` 可以放在 `outputs` 内部，作为该节点输出行为的控制配置。但当前实现存在三个缺失：

1. **`outputs.output_parser` 被当作普通输出字段传递给后续节点**：`projectNodeOutputs` 会将 `output_parser` 作为 key 投影到 output variables 中，导致后续节点可以通过 `${{output_parser}}` 访问到控制配置，而不是实际业务数据。
2. **`outputs.output_parser` 不被 `resolveOutputParser` 识别**：前端显示控制（`show_title`/`show_content`）只从 `node.presentation.outputParser` 和 `node.outputParser` 读取，不读 `outputs.output_parser`。当用户在 `outputs` 内配置 `output_parser` 时，`show_title: false` / `show_content: false` 不生效。
3. **节点输出序列化包含 key 且使用 JSON.stringify**：`serializeOutput` 将整个 output 对象 JSON.stringify，前端收到的是 `{{"answer":"诊断完成"}}` 而不是 `诊断完成`。当只有一个参数时应直接返回 value，多个参数应以 `\n` 拼接 value。

## 变更范围（What Changes）

- **修改** `projectNodeOutputs`（agent-workflow shared）：当 `outputs` 中包含 `output_parser` key 时，跳过该 key 的投影，不写入 output variables。
- **修改** `resolveOutputParser`（agent-core projector）：新增 `node.outputs.output_parser` 作为第三个来源（优先级低于 `presentation.outputParser` 和 `node.outputParser`）。
- **修改** `readDisplayOutputType` / `readDisplayLevel`（agent-workflow interaction-nodes）：`output_parser` 和 `level` 读取也 fallback 到 `outputs.output_parser`。
- **修改** `readWorkflowOutputSchema`（agent-workflow shared）：schema/outputSchema 读取也 fallback 到 `outputs.output_parser`。
- **修改** `serializeOutput`（agent-core projector）：单参数直接返回 value；多参数用 `\n` 拼接 value。

## Capability 影响

### 修改的 Capability

- `workflow-output-projection`：`projectNodeOutputs` 过滤 `output_parser`；`resolveOutputParser` 新增来源；`serializeOutput` 格式化规则。

## 影响范围

- 代码：`packages/agent-workflow/src/nodes/shared.ts`、`packages/agent-workflow/src/nodes/interaction-nodes.ts`、`packages/agent-core/src/agent/workflow-runtime-event-projector.ts`
- 测试：`packages/agent-workflow/tests/workflow-execution-engine.test.ts`、`packages/agent-core/tests/workflow-runtime-event-projector.test.ts`
- 不涉及 contract schema 变更、gateway 变更、前端变更。

## 归档前更新基线检查（非实施任务）

- 同步 `openspec/specs/workflow-execution-engine/spec.md` 中 `output_parser` 来源和 `serializeOutput` 格式化规则。
- 按需更新 `openspec/designs/modules/agent-workflow.md`。

验证入口：`npm test` + `openspec validate --all --strict`
