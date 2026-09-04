## 目标与边界（Goals and Boundaries）

`AskUserQuestion` 是内置 Tool capability，其 canonical model/tool/capability id 为 `AskUserQuestion`。它的 display name 也是 `AskUserQuestion`。它让 Agent 通过 runtime 拥有的 pending input boundary 向当前用户请求澄清。

Tool descriptor 暴露一个可被模型调用的澄清 capability，Agent/core 拥有狭窄的 AskUserQuestion producer branch，负责把已接受的 tool 参数转换为经过校验的 `QUESTION PendingInputIntent`。Runtime 拥有 checkpoint、pause、answer 校验、resume、cancel、terminal 状态，以及 timeout change 存在时的 timeout。Channel 只投影 pending request 并提交 answer command。

## 黑盒输入与输出（Black-Box Input And Output）

输入 schema：

```yaml
questions: array[1-3] of {
  prompt: string[1-500]
  options?: array[2-8] of {
    value: string[1-500]
    label: string[1-500]
  }
  multiple?: boolean
  custom?: boolean
}
```

Agent/core 在 schema 校验前只应用一层狭窄的 model-output normalization：

- 如果 `questions` 是一个包含数组且在 producer 预算内的 JSON 字符串，把它解析为数组形式；
- 如果某个 question 携带少于两个选项的欠指定 `options` 数组，则丢弃 `options` 和仅适用于选项的修饰符，按文本 question 处理。

归一化后的参数在创建任何 pending input 之前，仍必须通过已解析 descriptor schema 和确定性可见文本校验。该兼容步骤不是 public client contract，也不放宽 string 预算、question 数量、重复 option 拒绝、禁止用途拒绝或 trusted runtime 坐标。

Canonical descriptor：

```text
capabilityId/name: "AskUserQuestion"
displayName: "AskUserQuestion"
provider: { providerId: "builtin-tools", providerKind: "BUNDLED" }
```

面向模型的 tool description：

```text
Ask the current user one to three short, directly answerable ordinary clarification questions required to continue the current task. Use only when missing user-provided information blocks safe progress and the answer cannot be determined from the current context or available tools. Calling this tool creates a runtime-owned question pending input and pauses the current run while waiting for the user's response.

Do not use this tool to request credentials, raw secrets, authorization grants, approval for protected operations, high-risk confirmations, human handoff or escalation, surveys, or long-form form input.
```

Agent/core 即时 outcome 形状：

```text
{ status: "PENDING_INPUT", pendingInput: PendingInputRequest }
```

这是 pending input core contract 定义的控制 outcome `AgentExecutionOutcome.PENDING_INPUT`。`pendingInput` 是 `AgentRunStatePort.requestPendingInput(...)` 返回的安全 `PendingInputRequest`，只包含 runtime contract 允许的字段：`id`、`sessionId`、`kind`、`questions` 和可选的 `timeoutAt`。

Channel/UI 投影 MAY 渲染更窄的展示引用，例如 `{ pendingInputId, status: "pending" }`，但该投影不是 Agent/core outcome，也不是原始 tool call 面向模型可见的最终 `CAPABILITY_RESULT`。用户回答和模型可见的完成结果由 runtime pending input 流程拥有。

失败 reason code：

- `CAPABILITY_UNAVAILABLE`：descriptor 缺失、被禁用、不可用，或无法解析为 bundled `AskUserQuestion` Tool descriptor。
- `INVALID_INPUT`：schema、question 预算、option 约束或确定性禁止用途校验失败。
- `PENDING_INPUT_UNAVAILABLE`：runtime 拥有的 pending handoff 无法接受该 pending input，包括 pending boundary 不可用、checkpoint/pending acceptance 失败或 active pending 冲突。
- `ABORTED`：请求在 pending input acceptance 完成前被 abort 或 cancel。
- `EXECUTION_FAILED`：descriptor 解析之后出现的不属于上述安全类别的意外 producer 失败。

## 核心流程（Core Flow）

1. Agent-capability 暴露 bundled Tool descriptor `AskUserQuestion`。
2. Context rendering 把该 descriptor 以 `name` 等于 capability id 的 tool 形式披露给模型。
3. 模型可以返回名为 `AskUserQuestion` 的 tool call。
4. Agent/core 通过既有 capability resolver/catalog 路径解析这个精确的 `toolName`，并要求解析结果是可用的 bundled 内置 Tool descriptor。
5. Agent/core 在普通 capability invocation 之前，先用专用 producer branch 处理初始 `AskUserQuestion` 调用。
6. Producer branch 只应用本 change 定义的狭窄 model-output normalization，然后按已解析 descriptor 的 input schema 和 question/option 预算校验归一化后的 tool 参数。
7. Producer branch 用确定性可见文本规则校验用户可见的 prompt 和 option 文本。禁止用途文本以 `INVALID_INPUT` 拒绝；redaction 仅限于 logs/audit，且 MUST NOT 把不安全文本转换为 pending request。
8. Producer branch 把已接受的输入转换为既有的 `agent-contracts/runtime` `PendingInputIntent`，`kind="QUESTION"`。
9. Agent/core 使用已接受的 `RequestRun`、trusted `RequestContext` 和当前 `AskUserQuestion` tool call 坐标，通过 `AgentRunStatePort.requestPendingInput(run, context, intent)` 提交该 intent；owner scope、session id、request id、run id 和 producer 坐标不从 tool input 读取。
10. Agent/core 在 `requestPendingInput(...)` 成功后立即返回携带安全 pending 引用的 `AgentExecutionOutcome.PENDING_INPUT`，停止当前 dispatch，并且不为该 producer tool call 追加普通 capability result。
11. Channel 通过既有 pending input stream/transport boundary 投影该 pending input。
12. 用户回答后，pending input core 消费持久化且由 runtime 拥有的 `producerRef`，把已解析的回答物化为原始 tool call 的安全 `CAPABILITY_RESULT`，并继续原始 run。

## 设计决策（Design Decisions）

### D1：Tool schema 镜像 question pending request 字段

使用 `prompt`、`options`、`multiple` 和 `custom`，使该 tool 产生与 `add-ts-question-pending-input` 消费的相同安全 request 形状。

`multiple` 和 `custom` 是 question 约束，不是回答字段。客户端回答仍使用 `PendingInputAnswer.answers: string[][]`，不能设置这两个标志。

该 schema 有意不包含 `header`、option `description`、`annotations`、answer schema、identity、idempotency、timeout 行为或 producer 坐标。这些字段要么是 channel/runtime 投影拥有的展示选择，要么是 tool input 之外的 trusted runtime 状态。

没有 `options` 的 question 是文本 question。文本 question 上的 `custom=true` 只作为兼容 no-op 被接受，不保留进 pending request；文本 question 上的 `multiple` 或 `custom=false` MUST 以 `INVALID_INPUT` 失败。当归一化后的 `options` 存在时，它 MUST 包含 2-8 个 option，该 question 是选项 question。`multiple` 和 `custom` MAY 用于选项 question。

如果模型输出包含少于两个条目的 `options`，Agent/core 在 descriptor schema 校验之前把这个欠指定的 option 形状当作文本 question 处理。这能防止常见的模型漂移（例如单个 "I will provide it" option 变成死胡同选项 question），同时让已接受的 pending request 保持在既有文本 question contract 内。

每个 option `value` 是 `PendingInputAnswer.answers` 使用的稳定 answer token，MUST 在同一 question 内唯一。Option `label` 是展示文本，不需要唯一。

String 预算是 descriptor input schema 的一部分。为空或超预算的 `prompt`、option `value` 或 option `label` 字段 MUST 在创建 pending input 之前以 `INVALID_INPUT` 校验失败。

模型从渲染进 model provider request 的可调用 tool descriptor input schema 中学习这些预算。当 provider 侧 tool schema 支持 JSON Schema 兼容的 string 约束时，它 MUST 为 `questions[].prompt`、`questions[].options[].value` 和 `questions[].options[].label` 携带 `minLength` 和 `maxLength`。如果某个 provider 无法表达这些边界，Agent/core 在创建 pending input 之前仍 MUST 按同一已解析 descriptor schema 校验归一化后的返回 tool 参数。面向模型的 schema 约束是指导和 provider 侧 contract，不是信任边界。

如果模型需要四个或更多 question，当前调用 MUST 以 `INVALID_INPUT` 校验失败且不创建 pending input。Agent/core MUST NOT 截断列表，也不创建部分 pending request。模型可以先询问优先级最高的一到三个 question，并在 resume 后再次调用 `AskUserQuestion` 获取更多澄清。

该 schema 不定义 tool 级 timeout。默认和显式 pending timeout 行为属于 `add-ts-human-pending-input-timeout`；本 change 只消费已接受的 pending request 形状。

### D1.1：面向模型的 schema 通过形状传达 question 种类

模型 MUST 从可调用 tool schema 和字段描述学习四种受支持的 question 形式，而不是通过新的 discriminator 字段：

- 文本 question：`options` 缺失；冗余的 `custom=true` 作为 no-op 被接受以兼容模型。
- 单选 question：`options` 存在且 `multiple` 缺失或为 `false`。
- 多选 question：`options` 存在且 `multiple=true`。
- 自定义选项 question：`options` 存在且 `custom=true`；用户可以选择一个 option value，或提供一条由 question pending input 规则接受的自定义文本回答。

Tool descriptor SHOULD 在 `questions`、`options`、`multiple` 和 `custom` 的 schema 描述中显式说明这些组合。Context rendering 和 model provider adapter MUST 在 provider 支持范围内保留已解析 descriptor 的面向模型 schema，包括条目数量、string 边界和字段描述。如果某个 provider 无法表达某个 schema 注解或边界，该限制 MUST NOT 放宽 Agent/core 对已解析 `CapabilityDescriptor.inputSchema` 的校验。

Context rendering 和 model provider adapter MUST 保留精确的 tool 名称 `AskUserQuestion`。它们 MUST NOT 把它归一化为 `AskUser`、`ask_user_question`、`askUserQuestion`、`askUser`、`ask_user` 或任何 provider 本地别名。如果某个 provider 无法暴露这个精确的可调用名称，adapter MUST 以 capability/tool 不可用安全失败，而不是静默重命名 tool 或在返回时接受别名。

本 change 有意不在 tool input 中新增 `questionType`、`kind` 或另一个 discriminator。已接受的 question 种类由上面经过校验的形状推导得出。新增一个平行的类型字段会制造第二事实来源，并使 `type="text"` 加 `options` 这类非法组合成为可能。

### D2：Tool 是非阻塞的

Producer 路径通过 `AgentExecutionOutcome.PENDING_INPUT` 立即返回 pending 引用。它 MUST NOT 持有私有 promise、创建私有等待队列、在回答之前追加模型可见的 tool result，也不直接 resume run。

### D2.1：Producer branch 留在 Agent/core 内并只使用既有 capability contract

Agent/core 在普通 capability 解析之后按 canonical capability id `AskUserQuestion` 识别 AskUserQuestion。Producer branch MUST 使用已解析的 `CapabilityDescriptor.inputSchema` 和本 change 的确定性安全规则，在构建 pending intent 之前校验已接受的参数。

这是本 change 定义的唯一 producer branch，且只限于已解析的 bundled 内置 Tool descriptor：

- `kind="TOOL"`
- `capabilityId="AskUserQuestion"`
- `provider.providerId="builtin-tools"`
- `provider.providerKind="BUNDLED"`
- `availabilityStatus="AVAILABLE"`

该分支 MUST NOT 对 `question`、`AskUser`、`ask_user_question`、`askUserQuestion`、`askUser`、`ask_user`、`ask_user_questions`、schema 匹配的普通 tool 或非 bundled 的 `capabilityId="AskUserQuestion"` descriptor 进入。

它 MUST NOT 引入通用 pending producer registry、descriptor 标志、metadata 标记或 capability 发现式 pending 路由。

Producer branch MUST NOT 为初始 AskUserQuestion 请求调用 `CapabilityInvocationPort.invoke(...)`，MUST NOT 导入 `agent-capability` 实现路径，MUST NOT 依赖 display name、description、schema 形状、字符串相似度、`CapabilityDescriptor.metadata` 或任何自然语言推断来决定路由、授权、replay 安全或 pending 生命周期，且 MUST NOT 为等待或 resume 定义第二个 tool executor。

如果已解析 descriptor 缺失、被禁用或不可用，Agent/core MUST 返回既有的安全 capability 不可用 outcome，且 MUST NOT 创建 pending input。

如果模型结果包含多个 tool call，Agent/core MUST 遵循既有的当前 tool batch 顺序。AskUserQuestion 分支只作用于当前正在执行的 canonical `AskUserQuestion` tool call。在创建 pending input 之后，Agent/core MUST 立即通过 `AgentExecutionOutcome.PENDING_INPUT` 停止；它 MUST NOT 向前扫描为同一 batch 中后续的 `AskUserQuestion` 调用创建 pending input。那些后续调用只在原始 run resume 且执行到达它们之后才被处理。

### D2.2：本 change 不新增 capability runtime context facade

本 change 复用 `add-ts-human-pending-input-core` 的 producer contract：`AgentRunStatePort.requestPendingInput(run, context, intent)` 是唯一的 pending 创建 port。它 MUST NOT 新增 `CapabilityInvocationRuntimeContext.requestPendingInput(...)`、通用 pending producer registry、通用 policy port、public create-pending command，或 contract/core pending change 定义的 runtime 拥有的最小 `producerRef` 之外的任何 pending record producer/tool-call 字段。

### D3：AskUserQuestion 不经过 sandbox 路由

这是一个用户交互 capability，不是动态代码执行。它仍然经过 capability 框架、校验、安全日志和 runtime 拥有的 pending input boundary。

### D4：不收集 credential、authorization 或 handoff

该 tool MUST NOT 用于收集 credential、raw secret、authorization grant、受保护操作审批、高风险确认决策或人工 handoff/escalation 请求。这些流程属于专用 pending input 种类和治理逻辑。AskUserQuestion 只创建 `QUESTION` pending input，MUST NOT 创建 `CONFIRMATION`、`AUTHORIZATION` 或 `HUMAN_HANDOFF`。

本 change 只要求对明确禁止的 prompt 用途做确定性的、fixture 驱动的可见文本安全拒绝。它不引入 policy engine、风险分类器、语义意图分类器、模型 moderation 调用、可配置 moderation 规则系统、authorization 决策引擎、高风险确认流程或人工 handoff 流程。

当可见文本请求确认、authorization、受保护操作审批或人工 handoff/escalation 时，AskUserQuestion 只 MUST 以 `INVALID_INPUT` 拒绝。它 MUST NOT 把该请求转发、升级、转换或改路由到 `CONFIRMATION`、`AUTHORIZATION`、`HUMAN_HANDOFF`、lifecycle hook、guard、handoff producer 或任何 policy/风险路由路径。

问卷和长表单输入属于面向模型的范围指导和 schema 限定的非目标。本 change MUST NOT 为它们引入确定性分类器。此类输入只有同时违反 descriptor schema/预算或请求上述禁止用途时才被拒绝。

## 质量属性设计（Quality Attributes）

- 安全：log/audit 渲染对 prompt 和 option 文本做 redact 或 sanitize；不暴露 raw model context、credential、hidden reasoning、identity 和 idempotency 材料。
- 可靠性：cancellation 和 answer/resume 通过 runtime 传播。Timeout 行为在启用时由 pending input timeout change 拥有。
- 可审计性：pending input 创建/拒绝事件安全且可按 id/reference 追踪。
- 可测试性：schema 校验、不安全文本拒绝、非阻塞行为、pending boundary 失败、cancellation、resume 物化和投影可独立验证。

## 验证映射（Verification Map）

- Tool descriptor 和 input schema：针对文本、单选、多选、自定义、字符串化 question 数组归一化、欠指定单 option 归一化、重复 option value、非法文本修饰符、非法 options、为空或超预算的 prompt/value/label 文本、四个或更多 question、descriptor 不可用和 question 上限的单元测试。
- Pending input 集成：integration test 验证 Agent/core 解析 `AskUserQuestion` descriptor、在普通 capability invocation 之前处理 producer branch、调用 `AgentRunStatePort.requestPendingInput`、立即返回 `AgentExecutionOutcome.PENDING_INPUT`，并且不在同一次 dispatch 中继续后续 tool call。
- 路由身份：negative test 验证 `question`、`AskUser`、`ask_user_question`、`askUserQuestion`、`askUser`、`ask_user`、`ask_user_questions`、同 schema 普通 tool 和非 bundled `AskUserQuestion` descriptor 不进入 producer branch、不创建 pending input。
- Provider/名称保留：source 或行为测试验证 context rendering 和 provider adapter 暴露精确 tool 名称 `AskUserQuestion`、不把它归一化为别名，并在无法暴露精确名称时安全失败。
- Resume 物化：integration test 验证回答 resume 消费持久化且由 runtime 拥有的 `producerRef`、为原始 `AskUserQuestion` tool call 恰好产生一个安全 `CAPABILITY_RESULT`、并且不重新调用 `AskUserQuestion`；multi-call 测试覆盖同一 tool batch 中两个 `AskUserQuestion` 调用按原始顺序依次处理且拥有不同 producer ref。
- 边界所有权：architecture test 验证 producer branch 不拥有 wait/resume 状态、不为初始 pending 请求调用普通 `CapabilityInvocationPort.invoke(...)`、并且不导入 agent-capability、channel、runtime 私有或 gateway 私有路径。
- 安全：针对 credential/raw secret/authorization/受保护操作审批/高风险确认/handoff prompt 和不安全投影的 negative test。
- Cancel 边界：integration test 验证由 runtime 处理 run cancel/pending cancel 而不是 tool handler。Timeout 专属行为由 timeout/question pending change 验证。

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/changes/add-ts-ask-user-question-tool/specs/ask-user-question-tool/spec.md`
- 相关 question 语义：`openspec/changes/add-ts-question-pending-input/specs/question-pending-input/spec.md`
- 模块设计提升目标：`openspec/designs/modules/agent-capability.md`
- 架构提升目标：`openspec/designs/architecture/pending-input-and-user-interaction.md`

## 风险与取舍（Risks and Trade-Offs）

- 不安全文本可能被投影给用户。缓解：在提交 pending intent 之前拒绝禁止用途的可见 prompt/option 文本；只对 log 和 audit 输出做 sanitize/redact。
- Pending input boundary 可能不可用。缓解：返回 `PENDING_INPUT_UNAVAILABLE` 安全错误，不静默回退到私有状态。
- 非阻塞 tool result 需要 runtime 续接。这保留唯一生命周期 owner，避免出现竞争的交互状态机。
- 如果 producer 路径被当作普通 capability 成功处理，run 可能在未等待回答的情况下继续。缓解：要求 `AgentExecutionOutcome.PENDING_INPUT`，并把模型可见 capability result 物化推迟到回答 resume。
