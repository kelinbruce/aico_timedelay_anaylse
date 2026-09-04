## 背景与问题（Why）

NextAgent 的 OpenAI-compatible 模型路径通过 `@openrouter/ai-sdk-provider` 接收流式 ToolCall。当前依赖实现要求某个 `tool_calls[index]` 首次出现时已经携带工具名，并且后续只合并 arguments、不补齐或追加工具名。部分第三方模型或兼容网关会把 `function.name` 延后、拆片，或先返回空字符串再返回实际名称；这会导致正常可恢复的 provider 分片被固化为空名称，最终触发 `TOOL_NAME_EMPTY`，或者在名称缺失时提前映射为无关的 stream validation failure。

`agent-model` 已经是 provider stream normalization 和 tool-use normalization 的 owner。为保持 provider 差异不泄漏到 Agent Core，第三方 ToolCall 分片必须先在该边界内按稳定调用坐标聚合，只有工具名和 arguments 均完整有效时才形成公共 `ModelToolCall`。

## 变更范围（What Changes）

- 修改 OpenAI-compatible/OpenRouter adapter 的流式 ToolCall 归一化：在 `agent-model` 边界按 tool-call index/稳定 id 缓冲 provider-native ToolCall 分片，同时合并工具名和 arguments。
- 工具名首片为空、名称延后到达或名称被拆成多个 chunk 时，不提前向 Core 发出空名称 ToolCall；完整名称与合法 JSON arguments 就绪后只发出一个标准化 ToolCall。
- 并行 ToolCall 必须按各自稳定坐标独立聚合，不得交叉合并；最终结果保持模型原始调用顺序。
- 流结束时仍无法得到非空工具名或合法 JSON arguments，必须通过既有 safe model failure boundary 失败，不执行任何不完整 ToolCall。
- 不新增配置项，不改变公共 Web API、gateway、persistence 或 capability contract。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `model-stream-normalization`：明确流式 ToolCall 的工具名与 arguments 都可跨 provider chunk 到达，归一化边界必须完成有序缓冲、稳定关联和完整性校验后才发出 `ModelToolCall`。

## 影响范围（Impact）

- 代码：`packages/agent-model/src/providers/openrouter/` 的 stream adapter/normalizer。
- 依赖：继续使用现有 `ai` 与 `@openrouter/ai-sdk-provider`，不修改依赖版本。
- 测试：扩展 `packages/agent-model/tests/openrouter-provider.test.ts`，覆盖空首片名称、延后/拆分名称、细碎 arguments、并行调用隔离以及流结束仍不完整的负例。
- 安全与可观测：原始 provider chunk 只在 `agent-model` 内存中短暂存在，不进入日志、timeline、Web stream 或持久化。
- 容量：缓冲受单次模型响应及现有模型输出限制约束，不新增跨请求状态或持久化。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/model-stream-normalization/spec.md`：补充工具名与 arguments 分片缓冲、并行关联和不完整流安全失败的稳定需求。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/model-provider-boundary.md`：补充 provider-native ToolCall 分片在 `agent-model` 内完成缓冲与完整性校验的边界事实。
- `openspec/designs/modules/agent-model.md`：补充 OpenAI-compatible adapter 对名称和 arguments 的聚合职责及非职责。
- `openspec/designs/adr/<id>.md`：无；该方案延续既有 provider normalization owner，不形成新的跨系统技术决策。
- `openspec/designs/spec-to-design-map.md`：无需新增映射，仅在归档检查现有 `model-stream-normalization` 导航仍准确。

验证入口：
- `packages/agent-model/tests/openrouter-provider.test.ts`
- `npm test --workspace @nextagent/agent-model`
- `npm run build --workspace @nextagent/agent-model`
- `openspec validate --all --strict`
