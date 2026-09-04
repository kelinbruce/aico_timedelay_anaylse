## 1. Descriptor 和 schema

- [x] 1.1 定义 `AskUserQuestion` Tool descriptor，其 canonical model/tool/capability id 为 `AskUserQuestion`、display name 为 `AskUserQuestion`、bundled provider 为 `{ providerId: "builtin-tools", providerKind: "BUNDLED" }`，并使用 `design.md` 中的固定面向模型描述。
- [x] 1.2 使用 `prompt`、`options`、`multiple?` 和 `custom?` 支持文本、单选、多选和自定义 question 请求字段。
- [x] 1.2.1 确保面向模型的 tool schema 和字段描述通过形状说明 question 种类：`options` 缺失表示文本 question，`options` 配缺失/false 的 `multiple` 表示单选，`options` 配 `multiple=true` 表示多选，`options` 配 `custom=true` 表示自定义选项 question；不新增 `questionType` 或另一个 discriminator。
- [x] 1.3 定义 question 和 option 预算：`questions` 必须允许 1-3 项，`options` 出现时必须允许 2-8 项，`prompt` 必须允许 1-500 字符，option `value` 必须允许 1-500 字符，option `label` 必须允许 1-500 字符；四个或更多 question 或为空/超预算的可见文本必须以 `INVALID_INPUT` 失败，不得截断或部分创建 pending；本 change 不定义 tool 级 timeout 行为。
- [x] 1.3.1 确保面向模型的 tool input schema 在 provider 侧 tool schema 支持 JSON Schema 兼容 string 约束时，把这些具体 string 预算表达为 JSON Schema `minLength` 和 `maxLength`；provider 无法表达这些边界时不得放宽 Agent/core 在 pending 创建前对已解析 descriptor schema 的校验，且 provider adapter 必须保留精确 tool 名称 `AskUserQuestion`，否则必须不做别名归一化地安全失败。
- [x] 1.4 只用确定性 fixture 驱动的可见文本安全检查拒绝 credential/raw secret、authorization grant、受保护操作审批、高风险确认和人工 handoff/escalation prompt 用途；拒绝必须返回 `INVALID_INPUT` 且不得创建 pending input；AskUserQuestion 必须只创建 `QUESTION` pending input；不得把那些请求转发、升级、转换或改路由到 confirmation、authorization、handoff、hook、guard、policy 或风险路由路径；本 change 不得引入 policy engine、风险分类器、语义意图分类器、模型 moderation 调用或可配置 moderation 规则系统。
- [x] 1.5 确认 tool input schema 只包含 `questions[].prompt`、`questions[].options[].value`、`questions[].options[].label`、`questions[].multiple?` 和 `questions[].custom?`；不新增 `header`、option `description`、`annotations`、answer schema、identity、idempotency、timeout 行为或 producer 坐标。
- [x] 1.6 校验选项 question 约束：`options` 缺失表示文本 question，`options` 存在表示选项 question，option `value` 必须在同一 question 内唯一，`multiple` 和 `custom` 只能出现在选项 question 上，非法组合以 `INVALID_INPUT` 失败且不创建 pending input。

## 2. Pending input 集成

- [x] 2.1 新增 Agent/core AskUserQuestion producer branch，只在既有 capability resolver 确认可用 descriptor 具有 `kind="TOOL"`、`capabilityId="AskUserQuestion"`、`provider.providerId="builtin-tools"`、`provider.providerKind="BUNDLED"` 和 `availabilityStatus="AVAILABLE"` 之后运行；保持其为狭窄的内置 descriptor 身份分支，而不是通用 pending producer registry、descriptor 标志、metadata 标记或 capability 发现式 pending 路由。
- [x] 2.2 按已解析的 `CapabilityDescriptor.inputSchema` 校验 producer 参数，应用确定性可见文本安全检查，把已接受的输入转换为既有的 `PendingInputIntent` contract（`kind="QUESTION"`），并且只通过 `AgentRunStatePort.requestPendingInput(run, context, intent)` 提交。
- [x] 2.3 确保初始 AskUserQuestion producer branch 不调用普通 `CapabilityInvocationPort.invoke(...)`、不追加即时模型可见的 `CAPABILITY_RESULT`、在 `requestPendingInput(...)` 成功后立即返回携带安全 pending ref 的 `AgentExecutionOutcome.PENDING_INPUT`，并停止当前 dispatch 而不继续后续 tool call。
- [x] 2.4 确保 owner scope、已接受的 `RequestRun`、trusted `RequestContext`、session id、request id、run id 和 request context id 来自 Agent/core runtime 调用路径，而不是 tool input。
- [x] 2.5 通过既有 pending input 事件路径新增投影测试，不让 channel 拥有 AskUserQuestion 发送、等待、回答、取消或 resume 行为。
- [x] 2.6 新增 resume 集成测试：已接受的回答为原始 `AskUserQuestion` tool call 恰好物化一个安全 `CAPABILITY_RESULT`，且不重新调用 `AskUserQuestion`。
- [x] 2.7 新增 multi-call 集成测试：当一个模型 tool batch 包含多个 `AskUserQuestion` 调用时，当前正在执行的调用用自己 runtime 拥有的 `producerRef` 创建 pending input；它的回答只物化被引用的那个 tool call，后续 `AskUserQuestion` 调用在 resume 执行到达之前不被预先创建。

## 3. 边界和安全

- [x] 3.1 确认 `AskUserQuestion` 不经过 sandbox 执行路由。
- [x] 3.2 新增 architecture test，验证 producer branch 不导入 `agent-capability` 实现路径、runtime 私有路径、channel 私有路径或 gateway adapter 私有路径。
- [x] 3.3 新增安全 logging/audit 断言：prompt/options 只在 log/audit 输出中被 sanitize 或 redact，hidden context、identity 和 idempotency 材料不被记录。
- [x] 3.4 新增 architecture/source 检查，验证本 change 不引入 `CapabilityInvocationRuntimeContext.requestPendingInput(...)`、通用 pending producer registry、通用 `PolicyPort`、public create-pending command、新 `RunStatus`、新 lifecycle stage、新 checkpoint trigger，或 contract/core pending change 定义的 runtime 拥有的最小 `producerRef` 之外的 pending record producer/tool-call 字段。
- [x] 3.5 新增路由 negative test，验证 `question`、`AskUser`、`ask_user_question`、`askUserQuestion`、`askUser`、`ask_user`、`ask_user_questions`、同 schema 普通工具和非 bundled `AskUserQuestion` descriptor 不进入 producer branch、不创建 pending input。
- [x] 3.6 新增 source/行为检查，验证 producer branch 不按 display name、description、schema 形状、字符串相似度、自然语言推断或 `CapabilityDescriptor.metadata` 路由，并且 context/model provider adapter 不把 `AskUserQuestion` 归一化为别名。
- [x] 3.7 按 `design.md` 的失败 reason 映射，为 `CAPABILITY_UNAVAILABLE`、`INVALID_INPUT`、`PENDING_INPUT_UNAVAILABLE`、`ABORTED` 和 `EXECUTION_FAILED` 新增失败映射测试。

## 4. DFX 和验证

- [x] 4.1 覆盖不安全文本、硬性禁止 prompt 用途、作为非 policy 范围指导的问卷/长表单指导、为空或超预算的 prompt/value/label 文本、重复 option value、非法 options、非法 multi/custom 组合、四个或更多 question、descriptor 不可用、pending boundary 不可用、cancellation 传播、基于 `producerRef` 的 resume 物化、路由身份 negative case 和安全 audit/log。
- [x] 4.2 运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` 和 `openspec validate add-ts-ask-user-question-tool --strict`。
