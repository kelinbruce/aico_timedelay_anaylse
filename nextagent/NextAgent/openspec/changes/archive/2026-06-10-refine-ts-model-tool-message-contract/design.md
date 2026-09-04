## 背景和现状（Context）

`agent-contracts/model` 当前把模型返回的 tool call 字段命名为 `capabilityId`，而 `ModelToolResultContentPart` 不携带 tool name。实际执行链路中，模型协议看到的是 tool name；`agent-core` 再将 tool name 解析为当前 Agent 可用的 capability descriptor，并在 capability/runtime/audit/recovery 边界使用解析后的 `capabilityId`。

当前 contract 把这两个语义阶段混在一起，导致 OpenRouter provider private mapper 需要维护 `toolCallId -> capabilityId` 的临时映射来为 tool result 补 provider tool name。这个隐式反查路径既不是 capability resolution，也不是 provider stream normalization 的核心职责。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 将 `ModelToolCall.capabilityId` 收敛为 `toolName`，表达模型协议中的 provider-neutral tool name。
- 在 `ModelToolResultContentPart` 中增加 `toolName`，让 tool result 自身携带与 assistant tool call 配对所需的稳定名称。
- 让 `agent-model` provider adapter 直接使用 contract 中的 `toolName` 映射 provider DTO。
- 保持 `agent-core` 对 capability descriptor 的解析职责不变：模型输出 `toolName`，执行边界使用解析后的 `capabilityId`。

**非目标：**
- 不把 AI SDK DTO、OpenRouter request shape 或 provider-native tool part 暴露到 `agent-contracts`。
- 不修改 `CapabilityInvocationRequest`、runtime `ToolCallState`、timeline/audit/web projection 中的 `capabilityId` 语义。
- 不新增兼容旧 `ModelToolCall.capabilityId` 的双字段路径；当前 TS 首版按目标态收敛。

## 设计决策（Decisions）

1. `ModelToolCall` 使用 `toolName` 作为唯一模型工具名称字段。

模型调用 contract 是 provider-neutral 模型协议边界，不是 capability execution 边界。字段名使用 `toolName` 能让调用方、adapter 和测试明确区分“模型请求里的工具名称”和“NextAgent 解析后的 capability identity”。

2. `ModelToolResultContentPart` 必须携带 `toolName`。

tool result message 是独立的模型输入事实。它必须自描述与哪个 tool call/tool name 配对，OpenRouter mapper 不再维护跨消息反查 map。precondition 校验负责断言前序 assistant tool-call 和后续 tool-result 的 `toolCallId + toolName` 一致。

3. capability resolution 留在 `agent-core`。

`agent-core` 接收 `ModelFinalResult.toolCalls` 后，用 `toolCall.toolName` 查找当前 accepted Agent 可见 capability descriptor。解析成功后，capability invocation、timeline、recovery、audit 均继续使用 descriptor 的 `capabilityId`。这保持 Agent Scope 和 capability governance 的现有边界。

4. context render 从持久化 tool-use/result facts 渲染 provider-neutral model messages。

assistant tool-use message 持久化 `ModelToolCall`，因此内容字段随 contract 改为 `toolName`。capability result message 由 core 写入时同时保存 `toolCallId`、`toolName` 和 `payload`，context-engine 渲染为 `ModelToolResultContentPart`。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 不新增身份输入；`toolName` 仍必须通过 accepted Agent 的 capability catalog 解析，未启用 tool 不可绕过 capability boundary。provider DTO 不进入 public contract。 | capability governance/config assembly tests；architecture lint |
| 性能/容量 | 删除 provider private mapper 的跨消息反查 map，新增字段校验为线性扫描；不增加持久化表或外部调用。 | unit/contract tests；build |
| 可靠性/恢复 | 持久化 assistant tool-use/result message 携带 `toolName`，恢复重建 pending tool call 时不需要旧字段。 | local runtime recovery/tool loop tests |
| 可维护性 | model contract 命名与 capability execution 命名分层，adapter 映射路径更单一。 | contract tests；model provider tests；code review |
| 可测试性 | precondition 可直接断言缺失/不匹配 `toolName` 失败；OpenRouter body 可直接断言 tool result name。 | openrouter-provider tests；core-contract tests |
| 审计/可追溯性 | timeline/audit 继续使用解析后的 `capabilityId` 与 `toolCallId`，不记录 raw arguments/result。 | existing observability/audit tests；review checkpoint |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `ModelToolCall` 使用 `toolName`，tool result 携带 `toolName` | T1 | `npm run build`, `npm run test:contract` |
| provider adapter 直接映射 `toolName`，不反查 tool result name | T2 | `npm test -- packages/agent-model/tests/openrouter-provider.test.ts` |
| core 将 `toolName` 解析为 capability descriptor 后再执行 | T3 | `npm test -- tests/agent-kernel/tool-loop.test.ts tests/agent-kernel/config-assembly.test.ts` |
| context render 和 recovery 使用新持久化 shape | T4 | `npm test -- tests/agent-kernel/local-runtime-recovery.test.ts tests/agent-kernel/config-assembly.test.ts` |
| OpenSpec delta 有效 | T5 | `openspec validate refine-ts-model-tool-message-contract --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/model-invocation-contract/spec.md` 主承载 model invocation tool message contract。
- 架构和跨模块设计：`openspec/designs/architecture/core-contracts.md` 主承载 model tool name 与 capability identity 的边界。
- 模块设计：`openspec/designs/modules/agent-model.md`、`openspec/designs/modules/agent-core.md`、`openspec/designs/modules/agent-context-engine.md` 分别承载 adapter 映射、capability resolution、context render 职责。
- ADR：无。
- 导航：如归档时设计入口变化，更新 `openspec/designs/spec-to-design-map.md`。

## 风险与取舍（Risks / Trade-offs）

- [破坏性 contract 改名影响测试和内部调用] -> 首版目标态直接收敛，不保留双字段兼容；通过 build 和 targeted tests 找齐引用。
- [toolName 与 capabilityId 当前值常常相同，容易误改 capability 边界] -> 只在 model invocation contract 和 model result/message 使用 `toolName`；capability invocation、runtime state、timeline、audit 继续使用 `capabilityId`。
- [持久化消息 shape 改动影响恢复] -> 同步 runtime recovery parse 逻辑和 recovery tests。

## 迁移计划（Migration Plan）

当前 TS 首版按目标态收敛，不提供运行时旧字段兼容。发布前必须确保所有生成 assistant tool-use/result message 的产品路径已经写入 `toolName`，所有读取路径按新 contract 校验。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/model-invocation-contract/spec.md`：更新 `ModelToolCall.toolName`、`ModelToolResultContentPart.toolName` 和 pairing 约束。
- `openspec/designs/architecture/core-contracts.md`：更新 model invocation contract 字段和 toolName -> capabilityId resolution 边界。
- `openspec/designs/modules/agent-model.md`：保留 provider adapter 使用 `toolName` 映射 provider DTO 的事实。
- `openspec/designs/modules/agent-core.md`：保留 core 用 `toolName` 解析 capability descriptor 的事实。
- `openspec/designs/modules/agent-context-engine.md`：保留 context render 输出 tool result `toolName` 的事实。
- `openspec/designs/spec-to-design-map.md`：按归档后的设计入口补充导航。

## 待确认问题（Open Questions）

无。