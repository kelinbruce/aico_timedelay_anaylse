## 背景与问题（Why）

LLM Tool Calling 的 AskUserQuestion capability 用于向用户追问澄清信息，实现 agent 与用户的受控交互。它的模型可调用 tool/capability id 固定为 `AskUserQuestion`，`displayName` 同样固定为 `AskUserQuestion`。

业务调用流程：
1. `agent-capability` 暴露 bundled Tool descriptor：`capabilityId/name="AskUserQuestion"`、`displayName="AskUserQuestion"`、`provider={ providerId:"builtin-tools", providerKind:"BUNDLED" }`。
2. context rendering 将该 descriptor 作为 model tool 披露给模型，其中 tool `name` 等于 capability id。
3. LLM 可以返回名为 `AskUserQuestion` 的 Tool Calling。
4. Agent/core 通过既有 capability resolver/catalog path 精确解析该 `toolName`。
5. 只有解析结果是 available bundled built-in Tool descriptor（`kind="TOOL"`、`capabilityId="AskUserQuestion"`、`provider.providerId="builtin-tools"`、`provider.providerKind="BUNDLED"`）时，Agent/core 才进入 AskUserQuestion producer 分支。
6. Agent/core 的 producer 分支按 descriptor input schema 校验、清洗问题输入，并应用 deterministic safety rejection。
7. Agent/core 将已校验输入转换为 `QUESTION PendingInputIntent`。
8. Agent/core 通过 `AgentRunStatePort.requestPendingInput(run, context, intent)` 进入 runtime-owned pending input handoff。
9. Agent/core 在 `requestPendingInput(...)` 成功后立即返回 `AgentExecutionOutcome.PENDING_INPUT`，当前 run 暂停但不 terminal；用户回答后由 pending input core 恢复，并按 runtime-owned `producerRef.toolCallId` materialize 原 `AskUserQuestion` tool call 的 capability result。

模型需要在信息不足时向用户提问，但该能力必须进入统一 pending input 边界，而不能由工具自行创建第二套交互状态机。`AskUserQuestion` 需要独立 change 承载 Tool descriptor/schema、问题输入安全约束，以及到 runtime-owned `QUESTION` pending input producer 通道的接入。

## 变更范围（What Changes）

- 新增 canonical id 为 `AskUserQuestion` 的 built-in Tool descriptor、input/output schema 和 safe result，`displayName` 同样为 `AskUserQuestion`。
- 定义工具到 runtime-owned `QUESTION` pending input boundary 的提交规则。
- 定义问题输入 schema、文本/选项预算、safe redaction 和 deterministic safety rejection 约束。
- 明确 AskUserQuestion 不直接发送 channel 消息、不等待 answer、不通过普通 capability invocation 提交 answer 前的 capability result。

## Capability 影响（Capabilities）

### 新增 Capability

- `ask-user-question-tool`：模型通过 `AskUserQuestion` Tool 入口请求用户回答澄清问题、文本题或选项题。

### 边界说明

- AskUserQuestion 是用户交互 capability，通过 runtime-owned pending input projection 让 channel 展示问题
- 不经过 sandbox（不执行动态代码）
- 依赖 `add-ts-human-pending-input-core` 的 `AgentRunStatePort.requestPendingInput` 和 `AgentExecutionOutcome.PENDING_INPUT` 进行请求暂停/恢复

## 影响范围（Impact）

- `agent-capability`：descriptor、input schema 和 capability catalog 可见性。
- `agent-context-engine`：将 resolved `CapabilityDescriptor.inputSchema` 保真渲染为 model-facing tool schema，并保留题型字段组合、预算约束和字段说明；不拥有 pending lifecycle。
- `agent-model` / provider adapter：在 provider 支持 JSON Schema-compatible 约束时保留 `minItems`、`maxItems`、`minLength`、`maxLength` 和字段说明；provider 表达能力不足不得放松 Agent/core 对 resolved descriptor schema 的校验，也不得把 exact tool name `AskUserQuestion` 静默规范化为别名。
- `agent-core`：在既有 capability resolver 精确解析到 available bundled `AskUserQuestion` Tool descriptor 后处理 AskUserQuestion producer 分支，执行 schema/safety validation，调用 runtime-owned pending handoff，并返回 pending execution outcome。
- `agent-runtime`：通过前置 pending input core change 拥有 pending input lifecycle、checkpoint、pause/resume 和 materialization。
- `agent-channel-web`：只消费 pending input stream/projection，不拥有 AskUserQuestion 私有发送/等待状态。
- `agent-observability`：safe audit/log。

## 主要 Owner

- Owner 9 Tool Capability

## 非目标（Non-Goals）

- 不创建新的 pending input 状态机。
- 不定义 Web UI 表单或浏览器 UI。
- 不实现长期记忆、任务调度或 Agent handoff。
- 不定义 channel 实现细节。
- 不定义 confirmation、authorization 或高风险 approval 语义。
- 不实现 timeout scanner、timeout policy 或 tool-level timer。
- 不新增 `CapabilityInvocationRuntimeContext.requestPendingInput(...)` facade、generic pending producer registry、除 core/refine 定义的 runtime-owned `producerRef` 之外的 pending record producer 字段、RunStatus、LifecycleStage 或 CheckpointTriggerReason。
- 不新增 agent-core 到 agent-capability implementation package 的直接依赖；Agent/core 只能通过既有 capability contract surface 读取 descriptor/schema。
- 不支持 `question`、`AskUser`、`ask_user_question`、`askUser`、`askUserQuestion`、`ask_user`、`ask_user_questions` 等别名；这些名称不得触发 AskUserQuestion producer 分支。
