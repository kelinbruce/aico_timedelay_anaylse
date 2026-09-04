## Why

安全护栏（input guardrail）拦截用户违规输入时，`SubmitRequestCommand` 携带 `guardBlockRefusal` 字段，runtime 创建一个 COMPLETED run 但不调用模型。然而 `createQuestionActivityTrackingCommandPort` 的 `submit` 和 `editLatest` 方法在 `inner.submit()` / `inner.editLatest()` 返回后**无条件**调用 `trackQuestionActivity`，将违规问题文本写入 `user_question_activity` 表。

该表被 `listHighFrequency` 查询，结果用于高频问题推荐和输入框联想内容获取。这意味着被安全护栏拦截的违规内容会出现在其他用户或同一用户的高频问题列表和输入框联想中，造成安全绕过和信息泄露。

此外，`editLatest` 路由此前未接入安全护栏检查，用户可以通过编辑最新请求绕过安全护栏提交违规内容。

现在处理该问题，是因为远端部署已实际发现违规内容通过高频问题和输入框联想暴露。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 当 `SubmitRequestCommand.guardBlockRefusal` 存在时（即安全护栏已拦截该输入），`submit` 路径 MUST NOT 记录问题活动到 `user_question_activity`。
- 当 `EditLatestRequestCommand.guardBlockRefusal` 存在时，`editLatest` 路径 MUST NOT 记录问题活动到 `user_question_activity`。
- `editLatest` 路由 MUST 接入安全护栏检查，与 `submit` 路由保持同构：当 guardrail 拦截编辑后输入时，传入 `guardBlockRefusal`，runtime 创建 COMPLETED run 但不调用模型。
- 正常提交和编辑（无 `guardBlockRefusal`）的频率跟踪行为 MUST 保持不变。

**非目标：**

- 不修改 `retryLatest`、`cancel`、`answerPendingInput` 路径。
- 不修改 `user_question_activity` 表结构或 Gateway 接口。
- 不修改高频问题查询逻辑。
- 不清理已存储的历史违规数据（数据清理是运维操作，不在本次 change 范围内）。

## What Changes

- 修改 `createQuestionActivityTrackingCommandPort` 的 `submit` 方法：当 `command.guardBlockRefusal !== undefined` 时，跳过 `trackQuestionActivity` 调用。
- 修改 `createQuestionActivityTrackingCommandPort` 的 `editLatest` 方法：当 `command.guardBlockRefusal !== undefined` 时，跳过 `trackQuestionActivity` 调用。
- `EditLatestRequestCommand` 新增 `guardBlockRefusal` 可选字段，语义与 `SubmitRequestCommand.guardBlockRefusal` 一致。
- `agent-channel-web` 的 editLatest 路由新增安全护栏检查：当 guardrail 启用且 `checkQuestion` 返回 `isLegal=false` 时，传入 `guardBlockRefusal`。
- runtime 的 `editLatest` 方法新增 `guardBlockRefusal` 处理：当存在时，commitTerminal + hideEditedSourceRequestMessages，不 enqueueWork。

## Function 影响（OpenSpec Capabilities）

### 修改的 Function

- `FN-8.1 持久化运行数据` → canonical spec `user-question-activity`
  - 变化边界：`submit` 和 `editLatest` 路径的 `ask_frequency` 增长新增安全护栏拦截豁免——当 `guardBlockRefusal` 存在时不记录问题活动。
  - 系统质量属性：安全。

### 新增 Function

无。

## 影响范围（Impact）

- **前端用户**：被安全护栏拦截的违规输入不再出现在高频问题推荐和输入框联想中。
- **Agent 开发者**：无感知。
- **公共契约**：`EditLatestRequestCommand` 新增 `guardBlockRefusal` 可选字段，属于 additive 扩展。
- **代码**：`packages/agent-contracts/src/runtime/index.ts`、`packages/agent-session/src/services/question-activity-tracking-command-port.ts`、`packages/agent-runtime/src/lifecycle/submit.ts`、`packages/agent-channel-web/src/routes/requests.ts`；相关测试新增。
