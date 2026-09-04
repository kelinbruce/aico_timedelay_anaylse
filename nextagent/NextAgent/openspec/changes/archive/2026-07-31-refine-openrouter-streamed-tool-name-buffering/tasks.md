## 1. Characterization 与负例

- [x] 1.1 为首个 ToolCall chunk 名称为空、后续 chunk 才返回完整名称的流式响应增加 characterization test，并断言只产生一个非空名称的标准化 ToolCall。
  验证：`npm test --workspace @nextagent/agent-model -- openrouter-provider.test.ts`
  来源：`流式工具名称与参数完整聚合`；design 的 SDK 前 SSE 预归一化决策。
- [x] 1.2 为工具名称和 arguments 同时多片拆分增加测试，并断言名称与 JSON object 均按原序完整聚合。
  验证：`npm test --workspace @nextagent/agent-model -- openrouter-provider.test.ts`
  来源：`流式工具名称与参数完整聚合` 的名称拆片场景。
- [x] 1.3 为多个 ToolCall 分片交错返回增加测试，并断言调用隔离及首次出现顺序。
  验证：`npm test --workspace @nextagent/agent-model -- openrouter-provider.test.ts`
  来源：`流式工具名称与参数完整聚合` 的并行调用场景。
- [x] 1.4 为流结束仍为空名称、未知名称、非法 JSON 或非 object arguments 增加 negative tests，实际触发并断言 safe failure，且没有任何公共 ToolCall。
  验证：`npm test --workspace @nextagent/agent-model -- openrouter-provider.test.ts`
  来源：`流式工具名称与参数完整聚合` 的不完整流场景；design 安全失败规则。

## 2. Provider adapter 缓冲实现

- [x] 2.1 在 `packages/agent-model/src/providers/openrouter/` 实现请求内 OpenAI-compatible SSE ToolCall normalizer，按 index 缓冲 id、名称和 arguments，在 finish 前完整校验并生成 SDK 可消费的单个完整 delta。
  验证：任务 1.1 至 1.4 的定向测试；`npm run build --workspace @nextagent/agent-model`
  来源：design 唯一实现路径及 `流式工具名称与参数完整聚合`。
- [x] 2.2 将 normalizer 组合到 OpenRouter provider 的 trusted fetch response 边界，同时保持非 SSE、非 ToolCall 字段、AbortSignal、headers 和非流式路径不变。
  验证：`npm test --workspace @nextagent/agent-model`; code review 检查 raw chunk 不越过 `agent-model`
  来源：design 的边界、安全、可靠性和非目标约束。

## 3. 验证和收尾

- [x] 3.1 运行 agent-model 完整测试与构建，确认现有 complete、stream、reasoning、usage 和 safe error 行为无回归。
  验证：`npm test --workspace @nextagent/agent-model`; `npm run build --workspace @nextagent/agent-model`
  来源：proposal 影响范围；design 验证映射。
- [x] 3.2 运行仓库架构与严格 OpenSpec 校验，确认未新增跨 package 泄漏或规格错误。
  验证：`npm run lint:architecture`; `openspec validate --all --strict`
  来源：AGENTS.md 架构边界；design 文档承载与安全边界。
- [x] 3.3 使用 `$nextagent-code-review` 对 OpenSpec、Provider 实现、测试和验证证据进行语义检视，修复所有 P0/P1 并给出 PASS、PASS WITH FOLLOW-UP 或 BLOCKED 结论。
  验证：模型语义 review 记录与最终结论。
  来源：AGENTS.md push 前语义检视规则；design 可维护性和审计/可追溯性。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，归档前：

- 同步 `openspec/specs/model-stream-normalization/spec.md`。
- 更新 `openspec/designs/architecture/model-provider-boundary.md`。
- 更新 `openspec/designs/modules/agent-model.md`。
- 检查 `openspec/designs/spec-to-design-map.md` 的既有映射与验证入口。
- 不新增 ADR，不更新 `openspec/overview.md`。
