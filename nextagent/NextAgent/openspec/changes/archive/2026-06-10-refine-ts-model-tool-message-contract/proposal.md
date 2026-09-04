## 背景与问题（Why）

当前 `ModelToolCall` 使用 `capabilityId` 表达模型返回的 tool call 名称，`ModelToolResultContentPart` 只携带 `toolCallId` 和 `output`。这会把模型工具协议中的 tool name 与 NextAgent capability binding 中的 capability identity 混在一起，并导致 provider adapter 在组装 tool result message 时需要从前序 assistant tool-call 反查名称。

在电信网络智能体主路径中，模型输入/输出必须保持 provider-neutral，同时也要保持 tool-call / tool-result pairing 清晰、可恢复、可测试。当前字段命名和 tool result 信息不完整，使 adapter 存在隐式反查路径，不利于 KISS，也不利于后续多 provider adapter 对齐。

## 变更范围（What Changes）

- **BREAKING**：`ModelToolCall.capabilityId` 调整为 `toolName`，表示模型协议中的 provider-neutral tool name。
- `ModelToolResultContentPart` 增加必填 `toolName` 字段，使 tool result 自身携带与 tool call 配对所需的 tool name。
- `agent-model` invocation precondition 必须校验 tool-call 与 tool-result 的 `toolCallId + toolName` 配对一致。
- OpenRouter adapter 必须直接使用 contract 中的 `toolName` 映射 AI SDK tool call/result，不再通过前序 assistant message 反查 tool result 名称。
- `agent-core` 仍负责把模型返回的 `toolName` 解析到当前 Agent 可用 capability descriptor；capability invocation、timeline、audit、runtime recovery 中的 `capabilityId` 语义不变。
- 不引入 AI SDK message/tool DTO 到 `agent-contracts`，不新增 provider-specific contract 字段。

## Capability 影响（Capabilities）

### 新增 Capability
无。

### 修改的 Capability
- `model-invocation-contract`: 收敛 model tool-call/tool-result provider-neutral contract 字段，明确 `toolName` 与 capability identity 的边界。

## 影响范围（Impact）

- `packages/agent-contracts/src/model/index.ts`: public model contract breaking change。
- `packages/agent-model`: precondition 校验、OpenRouter request/stream/non-stream adapter 映射。
- `packages/agent-core`: tool loop 通过 `toolName` 解析 capability descriptor，内部 capability execution 继续使用 `capabilityId`。
- `packages/agent-context-engine`: 从持久化 assistant tool-use/result message 渲染 model input 时输出 `toolName`。
- `packages/agent-runtime`: recovery 重建 pending tool call 时需要读取旧持久化 tool-use message 中的新字段。
- 测试：contract、OpenRouter provider、context assembly、tool loop/recovery/architecture 相关测试需要同步。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/model-invocation-contract/spec.md`: 更新 model tool-call/tool-result contract 字段和 pairing 约束。

长期背景：
- `openspec/overview.md`: 无。

设计视图：
- `openspec/designs/architecture/core-contracts.md`: 更新 `ModelToolCall`、`ModelToolResultContentPart` 以及 model tool name 到 capability resolution 的边界说明。
- `openspec/designs/modules/agent-model.md`: 更新 provider adapter 对 `toolName` 的映射职责。
- `openspec/designs/modules/agent-core.md`: 更新 core 从 `toolName` 解析 capability descriptor 的职责说明。
- `openspec/designs/modules/agent-context-engine.md`: 更新 rendered model input 中 tool result 携带 `toolName` 的说明。
- `openspec/designs/adr/<id>.md`: 无。
- `openspec/designs/spec-to-design-map.md`: 若新增或改名设计入口，则补充导航；否则无。

验证入口：
- `npm run build`
- `npm test -- packages/agent-model/tests/openrouter-provider.test.ts tests/contract/core-contracts.test.ts tests/agent-kernel/config-assembly.test.ts tests/agent-kernel/tool-loop.test.ts tests/agent-kernel/local-runtime-recovery.test.ts`
- `npm run test:contract`
- `npm run lint:architecture`
- `openspec validate refine-ts-model-tool-message-contract --strict`