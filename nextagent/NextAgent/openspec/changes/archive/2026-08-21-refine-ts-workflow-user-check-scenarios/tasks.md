## 1. 超时字段（Gap1）

- [x] 1.1 修改 `executeUserCheckNode`（`packages/agent-workflow/src/nodes/interaction-nodes.ts`），将等待超时字段从 `inputs.timeout` 改为读取 `context.node.timeout`（秒），转换为 `timeoutAt`。废弃 `inputs.timeout` 读取逻辑。
  验证：`npx vitest run packages/agent-workflow/tests/workflow-interaction-nodes.test.ts` 中 "reads node.timeout as wait timeout" 测试通过
  来源：spec scenario `Node Timeout Reused As Wait Timeout`，design D1

- [x] 1.2 修改 `executeUserCheckNode` 超时 resume 路径，将 `timeout_result` 兜底恢复改为抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT）。废弃 `readTimeoutResult` 函数和 `timed_out` 输出变量。
  验证：`npx vitest run packages/agent-workflow/tests/workflow-interaction-nodes.test.ts` 中 "timeout is failure not fallback" 测试断言抛出 `WORKFLOW_NODE_TIMEOUT` 而非 `timed_out: true`
  来源：spec scenario `Timeout Is Failure Not Fallback`，design D2

- [x] 1.3 新增测试：超时抛 `WORKFLOW_NODE_TIMEOUT` 后，节点定义了 `exception: { on_timeout: { condition: '${error.category == "TIMEOUT"}' } }` 时，execution 走 `on_timeout` 分支而非 FAILED。
  验证：`npx vitest run packages/agent-workflow/tests/workflow-interaction-nodes.test.ts` 中 "timeout routes via exception condition" 测试通过
  来源：spec scenario `Timeout Routes Via Exception Condition`，design D2

- [x] 1.4 新增 negative test：超时后 `outputVariables` MUST NOT 包含 `timed_out` 字段和 `timeout_result` 值。
  验证：`npx vitest run packages/agent-workflow/tests/workflow-interaction-nodes.test.ts` 中 negative case 断言字段不存在
  来源：spec scenario `Timeout Is Failure Not Fallback`，design D2

- [ ] 1.5 (DEFERRED: 拆到后续 change) 修改 `agent-run-state-port.ts`（`packages/agent-runtime/src/lifecycle/agent-run-state-port.ts`）的 `pendingInputMaxTimeoutMs` 从 `24 * 60 * 60 * 1000` 改为 `48 * 60 * 60 * 1000`。
  验证：`npx vitest run packages/agent-runtime` 中 "rejects timeoutAt exceeding 48h" 测试断言 `PENDING_INPUT_INTENT_INVALID`
  来源：spec scenario `Wait Timeout Upper Bound 48h`、`Pending input timeout upper bound 48h`，design D3

- [ ] 1.6 (DEFERRED: 拆到后续 change) 新增 negative test：`timeoutAt` 超过 48h 时 runtime MUST 拒绝并抛 `PENDING_INPUT_INTENT_INVALID`。
  验证：`npx vitest run packages/agent-runtime` 中 48h 超限 negative case 实际触发失败并断言
  来源：spec scenario `Pending input timeout upper bound 48h`，design D3

## 2. 填空题格式约束 inputFormat（Gap2）

- [ ] 2.1 (DEFERRED: 拆到后续 change) 在 `agent-contracts` 的 `PendingInputQuestion`（`packages/agent-contracts/src/runtime/index.ts`）新增 `readonly inputFormat?: JsonObject` 字段。同步在 `PendingInputQuestionRecord`（`packages/agent-contracts/src/gateway/index.ts`）新增对应字段。`inputFormat` 为 opaque JSON 对象，子字段不做约束，产品按需定义（如 `name`/`placeholder`/`pattern`/`maxLength` 等）。
  验证：`npm run build` 通过；`npm run test:contract` 通过
  来源：spec scenario `Pending input 边界对象保持精简`、`InputFormat is opaque typed passthrough`，design D4

- [ ] 2.2 (DEFERRED: 拆到后续 change) 修改 `parsePendingInputQuestions`、`pendingInputActivationToJson`、`parsePendingInputActivation`、`parsePendingInputRequest`、`pendingInputRequestToJson`（`packages/agent-workflow/src/pending-input-shared.ts`），透传 `inputFormat` 字段。
  验证：`npx vitest run packages/agent-workflow/tests/workflow-interaction-nodes.test.ts` 中 inputFormat 透传测试通过
  来源：design D4

- [ ] 2.3 (DEFERRED: 拆到后续 change) 修改 `executeUserCheckNode`（`packages/agent-workflow/src/nodes/interaction-nodes.ts`），`QUESTION` + `action_type: input` 场景读取 `inputs.fields`，为每个 field 创建一个 `PendingInputQuestion`（prompt 取 description，options 为空，custom=true，inputFormat 携带 field 中除 name/description 外的格式约束字段。fields 子字段不做约束，产品按需定义）。
  验证：`npx vitest run packages/agent-workflow/tests/workflow-interaction-nodes.test.ts` 中 "input fields create questions with inputFormat" 测试通过
  来源：spec scenario `Input Fields Create Questions With InputFormat`，design D4

- [ ] 2.4 (DEFERRED: 拆到后续 change) 修改 `executeUserCheckNode` resume 路径，用 `inputFormat.name` 做 key 组装结构化 `user_check_result`（多 field 为对象，单 field 为字符串）。新增 negative test：resume 后 `outputVariables` MUST NOT 包含 `inputFormat`。
  验证：`npx vitest run packages/agent-workflow/tests/workflow-interaction-nodes.test.ts` 中 "structured user check result" 和 negative case 通过
  来源：spec scenario `Structured User Check Result For Multiple Fields`、`InputFormat Passed Through To Task Channel`，design D4

- [ ] 2.5 (DEFERRED: 拆到后续 change) 修改 `agent-run-state-port.ts` 的 `acceptPendingInput`，构造 `PendingInputRequestRecord` 的 `request.questions` 时透传 `question.inputFormat`（当前只提取 prompt/options/multiple/custom，会丢弃 inputFormat）。
  验证：`npx vitest run packages/agent-runtime` 中 pending input record 含 inputFormat 的断言测试通过
  来源：spec scenario `InputFormat is opaque typed passthrough`、`Pending input 边界对象保持精简`，design D4

- [ ] 2.6 (DEFERRED: 拆到后续 change) 修改 `agent-run-state-port.ts` 的 `assertValidPendingInputAnswerEntry`，对填空题（options 为空）可选校验 `inputFormat.pattern` 和 `inputFormat.maxLength`（如果 inputFormat 存在）。
  验证：`npx vitest run packages/agent-runtime` 中 inputFormat pattern/maxLength 校验测试通过
  来源：spec scenario `InputFormat is opaque typed passthrough`，design D4

## 3. 场景支持（Gap3）

- [x] 3.1 修改 `executeUserCheckNode`，读取 `inputs.kind`（缺省 `QUESTION`）。新增测试：未提供 kind 时行为等价于 `QUESTION`，`action_type`/`options` 逻辑与现有行为一致。
  验证：`npx vitest run packages/agent-workflow/tests/workflow-interaction-nodes.test.ts` 中 "kind defaults to question" 测试通过
  来源：spec scenario `Kind Defaults To Question`，design D5

- [x] 3.2 修改 `executeUserCheckNode`，`kind: CONFIRMATION` 时不读 `options`/`action_type`，自动构造 `options: [{label:"approve",value:"approve"},{label:"reject",value:"reject"}]`，创建 `kind: "CONFIRMATION"` pending input。
  验证：`npx vitest run packages/agent-workflow/tests/workflow-interaction-nodes.test.ts` 中 "confirmation auto-constructs binary options" 测试通过
  来源：spec scenario `Confirmation Auto-Constructs Binary Options`，design D5

- [x] 3.3 修改 `executeUserCheckNode`，`kind: AUTHORIZATION` 时不读 `options`/`action_type`，自动构造 `options: [{label:"approve",value:"approve"},{label:"deny",value:"deny"}]`，创建 `kind: "AUTHORIZATION"` pending input。
  验证：`npx vitest run packages/agent-workflow/tests/workflow-interaction-nodes.test.ts` 中 "authorization auto-constructs binary options" 测试通过
  来源：spec scenario `Authorization Auto-Constructs Binary Options`，design D5

- [x] 3.4 修改 `executeUserCheckNode`，`kind: HUMAN_HANDOFF` 时不创建 pending input，通过 `context.emitOutputDelta({ channel: "CONTENT", content: tips })` 投影通知内容，然后抛 `WORKFLOW_HUMAN_HANDOFF`（category: INTERNAL, retryable: false）。
  验证：`npx vitest run packages/agent-workflow/tests/workflow-interaction-nodes.test.ts` 中 "human handoff notifies and exits" 测试断言 emitOutputDelta 被调用且抛 `WORKFLOW_HUMAN_HANDOFF`
  来源：spec scenario `Human Handoff Notifies And Exits`，design D6

- [x] 3.5 新增 negative test：`kind: HUMAN_HANDOFF` 时 MUST NOT 调用 `requestPendingInput`，MUST NOT 携带 inputFormat。
  验证：`npx vitest run packages/agent-workflow/tests/workflow-interaction-nodes.test.ts` 中 negative case 断言 requestPendingInput 未被调用
  来源：spec scenario `Human Handoff Notifies And Exits`，design D6

- [x] 3.6 新增 negative test：CONFIRMATION `reject` 后 runtime MUST 直接终态化 FAILED，workflow MUST NOT 恢复执行。
  验证：`npx vitest run packages/agent-workflow/tests/workflow-interaction-nodes.test.ts` 中 "confirmation reject terminates without resume" 测试断言 workflow 未恢复
  来源：spec scenario `Confirmation Reject Terminates Without Resume`，design D5

- [x] 3.7 修改 `executeUserCheckNode` resume 路径，按 kind 区分 answers 结构和输出绑定：QUESTION 输出 `user_check_result`/`selectedOption`（choice）或结构化对象（input）；CONFIRMATION/AUTHORIZATION 输出 `user_check_result`（approve 值）；HUMAN_HANDOFF 不 resume。
  验证：`npx vitest run packages/agent-workflow/tests/workflow-interaction-nodes.test.ts` 中 resume 路径按 kind 区分的测试通过
  来源：spec `User Check` requirement 输出与副作用，design D5

## 4. 契约与架构验证

- [ ] 4.1 (DEFERRED: 拆到后续 change) 修改 `agent-channel-web` 的 pending input stream projection schema，暴露 `inputFormat` 字段。
  验证：`npx vitest run packages/agent-channel-web` 中 pending input projection 测试通过
  来源：spec scenario `InputFormat Passed Through To Task Channel`，design D4

- [x] 4.2 运行 `npm run lint:architecture` 确认无新增架构边界违规。
  验证：`npm run lint:architecture` 通过
  来源：design 文档承载决策，AGENTS.md 架构边界

## 5. 验证和收尾

- [x] 5.1 运行 agent-workflow 包全量测试，确认无回归。
  验证：`npx vitest run packages/agent-workflow` 全绿
  来源：design 验证映射全量覆盖

- [x] 5.2 运行 agent-runtime 包全量测试，确认 `pendingInputMaxTimeoutMs` 变更和 `assertValidPendingInputAnswerEntry` inputFormat 校验无回归。
  验证：`npx vitest run packages/agent-runtime` 全绿
  来源：design 验证映射全量覆盖

- [x] 5.3 运行 `openspec validate --all --strict` 确认 change 文档合法。
  验证：`openspec validate --all --strict` 无错误
  来源：AGENTS.md 验证门禁

- [x] 5.4 确认 `inputs.timeout`/`inputs.timeout_result`/`inputs.timeoutResult`/`readTimeoutResult`/`timed_out` 相关代码和测试已全部清理，无残留引用。
  验证：`rg "timeout_result|timeoutResult|timed_out|readTimeoutResult|inputs\.timeout" packages/agent-workflow/src packages/agent-workflow/tests` 无残留
  来源：design D2 废弃项

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的"归档前更新基线"处理：

- 同步 `openspec/specs/workflow-interaction-nodes/spec.md`：重述 User Check requirement。
- 同步 `openspec/specs/workflow-execution-engine/spec.md`：更新 Timeout and Retry requirement。
- 同步 `openspec/specs/ts-core-contracts/spec.md`：修改 Hook And Pending Boundary Baseline requirement（inputFormat 字段、48h 上限）。
- 按需更新 `openspec/designs/architecture/workflow-execution-and-routing.md`：补充 user-check 跨模块流程。
- 按需更新 `openspec/designs/modules/agent-workflow.md`：补充 executeUserCheckNode 设计落点。
- 按需新增 `openspec/designs/adr/workflow-user-check-timeout-reuse.md`。
- 按需新增 `openspec/designs/adr/workflow-human-handoff-notify-exit.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义。
