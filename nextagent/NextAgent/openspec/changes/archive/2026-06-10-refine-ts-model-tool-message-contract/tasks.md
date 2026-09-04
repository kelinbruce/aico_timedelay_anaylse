## 1. Contract 与边界校验

- [x] 1.1 将 `ModelToolCall.capabilityId` 调整为 `toolName`，并在 `ModelToolResultContentPart` 中增加必填 `toolName`。
  验证：`npm run build`、`npm run test:contract`
  来源：`model-invocation-contract` / `Messages and tools are provider-neutral contract inputs`
- [x] 1.2 更新 model invocation precondition，校验 tool-call 与 tool-result 的 `toolCallId + toolName` pairing，缺失或不匹配时 provider execution 不得启动。
  验证：`npm test -- packages/agent-model/tests/openrouter-provider.test.ts`
  来源：design / Decisions 2；spec / Tool result message is assembled

## 2. Adapter、Core、Context 和 Recovery 实现

- [x] 2.1 更新 OpenRouter adapter，使 stream/non-stream tool call 归一化输出 `toolName`，provider private mapper 直接使用 tool-call/result 上的 `toolName`，不再为 tool result 维护跨消息反查 map。
  验证：`npm test -- packages/agent-model/tests/openrouter-provider.test.ts`
  来源：spec / Provider adapter maps tool messages
- [x] 2.2 更新 `agent-core` tool loop，用 `ModelToolCall.toolName` 解析 visible capability descriptor，解析成功后 capability invocation 与 timeline 继续使用 descriptor `capabilityId`。
  验证：`npm test -- tests/agent-kernel/tool-loop.test.ts tests/agent-kernel/capability-governance.test.ts`
  来源：spec / Core resolves model tool calls；design / Decisions 3
- [x] 2.3 更新 assistant tool-use/result message 写入与 context render，使 model-visible assistant tool call 和 tool result 都携带 `toolName`。
  验证：`npm test -- tests/agent-kernel/config-assembly.test.ts`
  来源：design / Decisions 4
- [x] 2.4 更新 runtime recovery 从持久化 assistant tool-use message 重建 pending tool call 时读取 `toolName`，并继续把解析后的 capability identity 保存在 runtime `ToolCallState.capabilityId`。
  验证：`npm test -- tests/agent-kernel/local-runtime-recovery.test.ts tests/agent-kernel/runtime-recovery-guard.test.ts`
  来源：design / Quality Attributes / 可靠性/恢复

## 3. 验证和收尾

- [x] 3.1 更新 contract、provider、kernel 测试 fixture 和断言，覆盖缺失/不匹配 `toolName` 的 negative case。
  验证：`npm test -- packages/agent-model/tests/openrouter-provider.test.ts tests/contract/core-contracts.test.ts tests/agent-kernel/config-assembly.test.ts tests/agent-kernel/tool-loop.test.ts tests/agent-kernel/local-runtime-recovery.test.ts`
  来源：spec / Tool result message is assembled；design / 可测试性
- [x] 3.2 运行 OpenSpec 和架构验证，确认独立 change 与模块边界有效。
  验证：`openspec validate refine-ts-model-tool-message-contract --strict`、`npm run lint:architecture`
  来源：proposal / Baseline Promotion Plan；design / Verification Map
- [x] 3.3 运行常规构建和 contract gate，确认 public contract breaking change 已全量收敛。
  验证：`npm run build`、`npm run test:contract`
  来源：AGENTS.md 验证门禁；design / Verification Map

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/model-invocation-contract/spec.md`。
- 更新 `openspec/designs/architecture/core-contracts.md` 中 model tool message contract 和 toolName -> capabilityId resolution 边界。
- 更新 `openspec/designs/modules/agent-model.md`、`openspec/designs/modules/agent-core.md`、`openspec/designs/modules/agent-context-engine.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。