## 背景与问题（Why）

`AskUserQuestion` 是由 `agent-core` 在普通 capability invocation 之前识别的 runtime-owned pending-input producer。当前 producer 会校验模型返回的参数，但除问题数量超限外，`questions` 类型错误、禁止字段、字段层级错误以及 option-attached text input 组合错误都会直接抛出 `INVALID_INPUT`，使 request 进入 `REQUEST_FAILED`。模型既看不到具体的安全校验原因，也没有机会在下一轮修正参数。

普通 Tool 已经把可由模型修正的输入校验失败格式化为有界、脱敏的 `SafeError.message`，并以 `Capability input failed validation: ...` 形式反馈给下一模型轮次。AskUserQuestion 的特殊 producer 没有接入等价纠错行为，导致同类 Tool 参数错误采用不同策略。最新 AskUserQuestion 参数契约还增加了 option-level `requiresTextInput`、`inputPlaceholder` 及其与 `multiple`、question-level `custom` 的互斥规则，校验反馈必须覆盖这些新约束。

## 变更范围（What Changes）

- 对 canonical AskUserQuestion 的规范化参数执行完整、无副作用的 descriptor Schema 与 producer 语义预检；assistant tool-use batch 先按模型原始输出持久化，随后为预检失败的调用和同批未执行调用写入配对的失败 `CAPABILITY_RESULT`。
- 对类型、required、additional property、长度、数组数量、常量约束、option value 唯一性和普通 modifier 组合等模型可纠正错误，生成与普通 Tool 相同结构和安全约束的 `safeError`，通过正式 tool result 进入下一模型轮次，不再伪装成 request-local `USER` correction message。
- 保留 stringified question-array 和 underspecified option 的既有有界兼容规范；无法解析的 stringified input 返回明确的 native JSON array 修正提示。
- 纠错采用既有有限次数预算；重复失败超过预算后保持 safe `INVALID_INPUT` terminal failure。
- 用户提交的有序 `string[][]` 回答继续作为可信 runtime 输入保存；runtime 在正常 AskUserQuestion `CAPABILITY_RESULT` 中增加由 accepted question shape 解析出的 `resolvedAnswers`，明确区分预设选项、option-attached text、纯文本和 custom text，避免模型自行猜测数组位置。
- credential、raw secret、authorization、protected-operation approval、high-risk confirmation、human handoff 等禁止用途，以及 pending boundary、取消和内部错误，不进入可纠正参数路径，继续使用粗粒度 terminal failure。
- 不新增 public DTO、capability contract、stream event、runtime command、数据库字段或前端错误协议。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `ask-user-question-tool`：模型可纠正的 AskUserQuestion 输入错误从立即终止 request 改为持久化完整 tool-use/tool-result 失败配对并提供具体、安全、有界的模型纠错信息；正常用户回答增加模型友好的语义投影。

## 影响范围（Impact）

- `agent-core`：AskUserQuestion preflight、Schema 诊断格式化、配对失败结果、错误分类、有限模型纠错和 producer 调用顺序。
- `agent-runtime`：在恢复 pending producer 时，把既有可信 `responseAnswers` 解析为模型可见的 `resolvedAnswers`；不改变 answer command、Record 或数据库列。
- `agent-capability`：普通 Tool Schema 诊断补充 array-as-string 和 `const` 的统一安全文案，保证 AskUserQuestion 最新数组与互斥约束采用相同表达原则。
- 测试：AskUserQuestion producer/model-loop characterization、普通 Tool formatter 回归、敏感原值不泄漏、重试预算和 option-attached text input 最新 Schema 场景。
- 不影响 Web API、SSE/WebSocket shape、pending input public contract、frontend host mode 或数据库 schema。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ask-user-question-tool/spec.md`：补充模型可纠正参数错误的失败 tool result、完整配对、有限纠错、正常答案语义投影和 terminal 分类。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/capability-spi.md`：补充特殊 pending-input producer 在 tool-use pairing 约束下的失败结果路径。
- `openspec/designs/modules/agent-core.md`：补充 AskUserQuestion preflight、batch rejection result 与 pending producer 的职责边界。
- `openspec/designs/adr/<id>.md`：无，不新增需要独立保留的架构决策。
- `openspec/designs/spec-to-design-map.md`：将 `ask-user-question-tool` 的纠错 requirement 导航到上述 architecture/module 设计。

验证入口：
- `tests/agent-kernel/capability-governance.test.ts`
- `tests/agent-kernel/tool-loop.test.ts`
- `packages/agent-capability/tests/tool-framework.test.ts`
- `packages/agent-core/tests/capability-result-projection.test.ts`
- `npx --yes @fission-ai/openspec@1.6.0 validate --all --strict`
