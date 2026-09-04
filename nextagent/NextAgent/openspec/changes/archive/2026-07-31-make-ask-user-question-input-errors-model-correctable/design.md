## 背景和现状（Context）

普通 Tool 的输入 Schema 由 `agent-capability` executor 校验。失败结果使用 `CapabilityInvocationResult.status="FAILED"` 和 `SafeError`，`agent-core` 再把 `SafeError.message` 投影为模型可见的 `safeError.errorMessage`；`VALIDATION` 不属于立即终止类别，因此模型可以在下一轮修正参数。该路径的安全 formatter 最多返回 3 个问题、总长 768 字符，不回显被拒绝的值。

canonical `AskUserQuestion` 是受控例外：`agent-core` 在普通 capability invocation 之前识别它，直接把合法参数转换为 runtime-owned `PendingInputIntent`，不得调用 `CapabilityInvocationPort.invoke(...)`。当前实现把 AskUserQuestion Schema 和 producer 语义预检放在 assistant tool-use batch 持久化之前；可纠正失败不写 assistant/tool result，而是注入一条 request-local `USER` correction message。该路径虽然避免孤立 tool use，但丢失模型实际发出的非法调用，trace 无法还原多次纠错，而且错误反馈没有采用普通 Tool 的正式 `CAPABILITY_RESULT.safeError` 结构。

完整工具协议要求模型产生的每个 tool use 都有且仅有一个匹配 result。新设计先持久化模型原始 assistant tool-use batch，再执行 AskUserQuestion 无副作用预检。任一调用预检失败时，失败调用写入具体、安全的 `CAPABILITY_INPUT_INVALID` result；同批其它未执行调用写入有界的 batch-rejected result。该批次不执行任何 tool，也不创建 pending input，然后模型在下一轮基于正式 tool results 修正。

本 change 以 option-level `requiresTextInput`、`inputPlaceholder` 以及它们与 `multiple`、question-level `custom` 的互斥规则作为当前 AskUserQuestion descriptor 基线。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 模型能收到 AskUserQuestion 可纠正参数错误的具体、安全、有界信息并在下一轮修正。
- 错误结果沿用普通 Tool 的 `status/result/safeError` 结构、`Capability input failed validation: ...` 文案、字段路径和非泄漏规则。
- assistant tool-use batch 在校验前持久化；校验仍发生在任何 tool execution 和 pending 创建之前，失败时为整批调用补齐结果。
- 最新 option-attached text input 字段和互斥约束得到可操作诊断。
- 禁止用途、pending boundary、取消和内部错误保持 terminal、安全、粗粒度。
- 正常用户答案保留可信 `string[][]` 原始事实，同时提供模型友好的语义投影。

**非目标：**

- 不新增通用 capability input validation port，不修改 `agent-contracts`。
- 不让 AskUserQuestion 进入普通 Tool executor，不改变 pending-input owner。
- 不向 Web stream 新增错误正文、raw args、Ajv errors 或新的 public DTO。
- 不把用户答案加入模型可写的 AskUserQuestion input schema，不改变可信 pending-answer boundary。
- 不删除 stringified questions、underspecified options 或 4–20 questions 的既有兼容行为。
- 不改变普通 Tool 的自然模型纠错和 repeated-failure 语义。

## 设计决策（Decisions）

### D1：先持久化原始 tool-use batch，再以完整配对结果拒绝

AskUserQuestion input preflight 继续解析 canonical descriptor 和 21+ question count，同时调用现有纯转换逻辑验证规范化参数、resolved descriptor Schema 与 producer 语义，但不创建 pending input、不调用 capability、不执行 tool。

`appendAssistantToolUseMessage(...)` 在 preflight 之前保存模型原始 batch。preflight 失败时：

1. 失败的 AskUserQuestion 写入 `status="FAILED"`、`safeError.code="CAPABILITY_INPUT_INVALID"` 的 `CAPABILITY_RESULT`；
2. 同批其它未执行调用写入 `status="FAILED"`、`safeError.code="CAPABILITY_BATCH_REJECTED"` 的 `CAPABILITY_RESULT`；
3. 每个 result 使用原 `toolCallId`，不得遗漏、重复或改变原 assistant batch；
4. 当前 batch 不执行任何普通 Tool、不创建 pending input。

合法 preflight 通过后，现有执行路径仍按 batch 顺序处理 ordinary prefix，并在 AskUserQuestion 创建 pending 后停止。该设计复用现有 `buildFailedCapabilityPayload(...)` 和 `appendCapabilityResultMessage(...)`，不新增 capability port 或 public contract。

### D2：使用现有失败 Capability Result，不新增错误 DTO

`agent-core` 内部为 AskUserQuestion 输入失败保留 terminal control error `code="INVALID_INPUT"`、`category="VALIDATION"`、`retryable=false` 和 allowlisted reason marker；模型可见 result 则使用普通 capability failure 结构：

```json
{
  "status": "FAILED",
  "result": {},
  "safeError": {
    "code": "CAPABILITY_INPUT_INVALID",
    "category": "VALIDATION",
    "retryable": false,
    "errorMessage": "Capability input failed validation: ..."
  }
}
```

不增加并行的 `validationErrors`、`issues` 或 Tool-specific public payload。`retryable=false` 仍表示基础设施不得自动重放相同调用；新的模型轮次由 agent loop 发起，模型必须重新生成参数。

### D3：AskUserQuestion formatter 与普通 Tool 保持同一安全规则

`agent-core` 不能依赖 `agent-capability` 实现包，且稳定规格要求 AskUserQuestion producer 自己使用 resolved descriptor 校验。因此 `agent-core` 放置一个仅供该 producer 使用的 formatter adapter，接受 Ajv `ErrorObject[]` 和 input shape，执行与普通 Tool 相同的规则：

- 最多 3 个去重问题、总长 768 字符；
- 支持 required、type、additionalProperties、enum、minimum/maximum、长度、array bounds、`const`；
- string 误传 object 或 array 时提示传 native JSON，不得 `JSON.stringify`；
- composition-only `if` 诊断在已有具体子约束时不重复输出；
- 字段段名使用保守 allowlist，credential-like 或异常段名替换为通用 `field`；
- 不读取或输出 rejected value、schema pattern、prompt、option text 或 raw input。

普通 Tool formatter同步补充 array native-JSON 提示和 boolean/string/number/null `const` 文案，使两个 owner 的可验证输出原则一致。该双 owner 是 pending producer 边界导致的受控例外；不通过跨 package private import 或新 public contract 复用实现。

### D4：基于最新 descriptor 生成 option-attached input 诊断

preflight 始终编译 resolved descriptor 的 `inputSchema`，不 hardcode `requiresTextInput` 或 `inputPlaceholder` 的 Schema shape。最新 descriptor 会产生以下安全诊断：

- `inputPlaceholder` 没有 `requiresTextInput=true`：缺少 `questions.<index>.options.<index>.requiresTextInput`；
- attached input 与 `multiple=true`：`questions.<index>.multiple` 必须为 `false`；
- attached input 与 `custom=true`：`questions.<index>.custom` 必须为 `false`；
- `header` 或根级 `multiple`：对应路径为 unsupported field。

Schema 之后仍执行 option value 唯一性、text-question modifier 和 visible-text 安全检查。重复 value、modifier 和普通长度错误可纠正；credential/secret/authorization/approval/handoff 等禁止用途使用独立 non-correctable marker，不能通过改写表面参数绕过。

### D5：统一有限模型纠错预算

DefaultAgent 使用一个连续 AskUserQuestion correction counter，覆盖现有 question-count correction 和新增 input correction，预算沿用 `toolCallLimitRecoveryLimit=3`。每次成功执行一个合法 AskUserQuestion preflight 后计数重置。

前 3 次可纠正失败：

1. 发布现有 `DEGRADATION_NOTICE`，只携带 allowlisted code；
2. 保留已经持久化的 assistant batch 和完整失败 `CAPABILITY_RESULT`；
3. 不添加伪装的 request-local `USER` correction message，直接继续下一模型轮次。

第 4 次仍先持久化 assistant batch 和完整失败 results，再重新抛出 safe `INVALID_INPUT`，由 runtime 提交 `REQUEST_FAILED`。四次尝试均可在 canonical messages 和 trace 重建中识别，不创建 pending，不执行该 batch 的其它 tools。

### D6：非纠正性失败保持原路径

descriptor 缺失、Schema 不可编译、pending boundary unavailable、abort 和 internal exception 不进入 input correction reader。禁止用途虽然仍由 producer 可见文本安全规则识别，但使用 non-correctable internal classification，直接进入现有 terminal failure。

日志和 stream 只保留 code、attempt、question count 等已有低熵字段；不得记录 correction message、prompt、option/placeholder、raw arguments 或 Ajv rejected values。

### D7：可信原始回答与模型语义投影分离

Web/channel 继续按现有 contract 提交 `answers: string[][]`，runtime 继续在 `PendingInputRecord.responseAnswers` 中保存该可信原始事实。模型不能通过 AskUserQuestion 参数提供或覆盖 answers。

pending resume 写入正常 `CAPABILITY_RESULT` 时，在既有 `answers` 旁增加 `resolvedAnswers`：

- 无 options 的文本题投影为 `{ questionIndex, text }`；
- 普通选项投影为 `{ questionIndex, selections: [{ value, label }] }`；
- option-attached input 在 selection 中增加 `textInput`；
- custom text 单独投影为 `customText`；
- multi-select 保留多个 selection。

解析只使用 accepted pending question shape 和已通过 runtime 校验的 `responseAnswers`，不新增 Web DTO、runtime command、Record 字段或数据库列。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 仅反馈 allowlisted Schema/普通语义约束；禁止用途和基础设施错误保持 terminal；raw args、prompt、option text、placeholder 和 credential canary 不进入 message/log/stream | formatter canary tests、AskUserQuestion forbidden-purpose tests、语义代码审查 |
| 性能/容量 | 每个模型 tool batch 在最多 5 个普通 calls/20 个 read-only calls约束内对 AskUserQuestion 做一次额外有界 Ajv 校验；问题最多 20、每题最多 8 options；诊断最多 3 条/768 字符 | producer unit tests、现有 tool-call capacity tests |
| 可靠性/恢复 | preflight 失败写完整 assistant batch 和一一配对失败 results，但不执行 tools、不创建 pending；纠错最多 3 次，第 4 次 safe terminal | tool-loop integration tests、message/pending assertions |
| 可维护性 | 保留 agent-core producer owner和现有 SafeError/AgentError；不新增 contract/port；formatter 例外有独立测试锁定与普通 Tool 的共同文案原则 | architecture tests、nextagent-skill-review、nextagent-code-review |
| 可测试性 | deterministic model steps 可直接验证 invalid → correction → valid pending；Ajv fixture覆盖最新 attached-input Schema | capability-governance/tool-loop/tool-framework Vitest |
| 审计/可追溯性 | 每次非法调用及正式失败 result 均进入 canonical messages；沿用低熵 DEGRADATION_NOTICE，不把 raw args 或诊断正文加入日志/stream | message/trace reconstruction assertions、日志非泄漏检查 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 最新 descriptor 的 type/additional/required/const 产生具体安全文案 | 1.1、1.2 | `packages/agent-capability/tests/tool-framework.test.ts`、`tests/agent-kernel/capability-governance.test.ts` |
| invalid AskUserQuestion 形成 assistant tool-use 与失败 result 配对 | 2.1、2.2 | `tests/agent-kernel/capability-governance.test.ts`、`packages/agent-core/tests/parallel-tool-loop.test.ts` |
| 修正调用创建 pending 并重置预算 | 2.2 | deterministic model correction integration test |
| 第 4 次失败 safe terminal | 2.3 | correction budget negative test |
| 禁止用途和基础设施错误不进入纠错 | 2.4 | forbidden-purpose、producer failure characterization |
| 无 raw args/prompt/option/placeholder/credential 泄漏 | 1.2、2.4 | canary assertions、model request/log/event assertions |
| 用户回答保留原始矩阵并提供语义投影 | 2.6 | runtime pending resume 与 context rendering tests |
| OpenSpec 与架构门禁 | 3.1、3.2 | strict OpenSpec、build/test/contract/architecture、两项语义 review |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ask-user-question-tool/spec.md` 主承载可纠正与 terminal 分类、预算和兼容行为。
- 架构和跨模块设计：`openspec/designs/architecture/capability-spi.md` 主承载 tool-use pairing、preflight 与模型轮次协作。
- 模块设计：`openspec/designs/modules/agent-core.md` 主承载 producer/preflight 实现职责；普通 Tool formatter 仍由 `agent-capability` 模块设计承载。
- ADR：无；不新增长期架构或 dependency 决策。
- 导航：`openspec/designs/spec-to-design-map.md` 在归档前补充行为到 architecture/module/验证入口的映射。

## 风险与取舍（Risks / Trade-offs）

- [preflight 与 pending producer重复执行纯校验] -> 输入规模有界，重复校验换取不新增缓存状态和 contract；测试保证两次使用同一 resolved descriptor 与规范化函数。
- [两个 package 各有安全 formatter 实现] -> 这是禁止 `agent-core -> agent-capability` 依赖和禁止新增 frozen contract 下的受控例外；共同 fixture 锁定前缀、array/const 文案、数量/长度和非泄漏规则。
- [非法 AskUserQuestion 使同 batch 普通 tools不执行] -> 为所有未执行调用写明确 batch-rejected result，既保持完整配对，也避免在缺少用户答案时继续 side effect；下一模型轮可重新发出仍需要的 tools。
- [正常 answer result 同时携带 raw 与 resolved 两种形状] -> raw 字段保持兼容与审计事实，resolved 字段减少模型位置推断；输入规模受现有问题数和每项长度边界约束。
- [模型消耗额外轮次] -> 最多 3 次，成功后重置；比直接终止用户任务更可恢复。

## 迁移计划（Migration Plan）

无数据库、配置或 public contract 迁移。发布时直接替换 agent-core/agent-runtime/agent-capability 代码。新增 `resolvedAnswers` 仅存在于新写入的内部/model-visible capability result payload；旧历史仍可按既有 `answers` 渲染。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ask-user-question-tool/spec.md`：合并模型可纠正参数错误、3 次预算、terminal 分类和兼容场景。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/capability-spi.md`：记录 AskUserQuestion pre-persistence validation correction 与 tool-use pairing 不变量。
- `openspec/designs/modules/agent-core.md`：记录 preflight/producer 的职责和错误分类。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：增加 spec 到设计和测试入口导航。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-4.1-调用模型` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/ask-user-question-tool/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
