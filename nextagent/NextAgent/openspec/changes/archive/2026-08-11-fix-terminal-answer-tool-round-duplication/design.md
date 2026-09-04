## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-1.1 查看会话消息流` | model live 正文按 `stepId` 隔离，Tool 轮次说明与终止轮次最终回答分离，live 与 history 不重复 | `ts-web-sse-ws-transports` | `FN-1.1 查看会话消息流` |

## `FN-1.1 查看会话消息流`

### 目标与规范依据

本设计闭合多轮 Tool 请求中“进行中正文按 model step 隔离、过程说明作为独立过程事实保留、最终 Assistant Message 只承载终止模型轮次回答”的黑盒目标。SSE、WebSocket、terminal commit 和 history 继续消费既有事件与消息 shape，不增加新的公共字段或读取路径。

#### 本 Function 的目标 Requirements

canonical spec：`ts-web-sse-ws-transports`

- `MODIFIED`：`Tool 轮次执行说明与 Tool 调用连续呈现`

### 当前实现

`DefaultAgent` 在一次请求的模型轮次循环外维护 `finalContent`。每次 `executeModelTurn(...)` 都把该值作为 `visibleContentBeforeTurn` 传入；`ModelRouteExecution` 通过 `combineOutputRecoveryContent(...)` 将此前可见内容、同一模型 route 已确认的续写片段和本次 invocation 内容组合为累计 `visibleContent`。

模型轮次返回后，`DefaultAgent` 同时取得两个字符串：

- `modelTurn.visibleContent`：包含先前模型轮次公开内容的请求内累计快照；#576 终态修复后只继续传给下一轮并用于 round-limit 日志长度。
- `modelTurn.currentRoundContent`：从累计快照中去除 `visibleContentBeforeTurn` 后得到的当前模型轮次正文。

当当前轮次包含 Tool 调用时，`currentRoundContent` 已作为 `ASSISTANT_TOOL_USE` 消息中的公开说明写入，并由 completed `LLM_CONTENT_DELTA` 消息引用事件投影到过程区。该路径不会把先前轮次正文重复写入当前 Tool 消息。

当当前轮次不包含 Tool 调用时，#576 已使终态路径统一使用 `currentRoundContent`。因此请求级 `visibleContent` 不再参与 terminal、Tool 消息持久化、上下文或恢复，只会在下一 model step 被错误地作为 live delta 前缀再次发出。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 非终态 model 正文只属于事件 `stepId` | 新 route 把先前 step 正文作为 `contentBeforeRoute` 并在当前 `stepId` 下再次发出 | 事件身份与正文归属不一致 |
| Tool 轮次说明只在自身过程位置显示一次 | 后续 step 的待定 delta 包含先前 Tool 轮次说明 | 同一正文进入两个 step lane |
| 同一终止轮次的输出续写保持完整 | `currentRoundContent` 已包含该 route 的已确认续写和最终 invocation 内容 | 缺少以该事实作为终态输入的回归验证 |
| 请求级累计状态是否仍有消费者 | #576 后只剩跨轮传递和 round-limit 日志长度 | 保留第二套正文状态没有业务收益，并持续制造错误事实 |

### 修改方案

唯一实现路径是删除没有业务消费者的请求级累计正文，让 `ModelRouteExecution` 只拥有当前 model step 的一个累计正文事实：

```text
stepVisibleContent = confirmedContinuationContent + currentInvocationContent
```

1. `DefaultAgent` 不再维护 `finalContent`，`ModelTurnInput` 不再携带 `visibleContentBeforeTurn`。
2. `ModelRouteExecutionInput` 删除 `contentBeforeRoute`；route 开始、预算提升重试和 reasoning-only correction 时，未确认正文均从空字符串开始。
3. 同一 route 的 output continuation 继续按生成顺序累计 `confirmedContent + invocationContent`，并继续使用现有 `maxModelVisibleChars` 单 route 容量边界。
4. `ModelRouteExecutionResult` 和 `ModelTurnResult` 只返回一个当前 step 正文，不再保留同值的请求级与当前 route 两套字段。
5. 删除只服务旧双状态的 `combineOutputRecoveryContent(...)`、`contentAfterPrefix(...)` 及其白盒拼接测试。
6. Tool 消息持久化、no-tool terminal、terminal hook、fallback 可见输出保护、Runtime terminal commit 和 channel/frontend lane 规则继续消费当前 step 正文，不增加文本去重。

该方案保留 route 内恢复所需的唯一累计状态，删除跨 step 的错误前缀和重复派生，符合 KISS。Runtime、channel 和 frontend 不获得 model-loop 语义，也不进行字符串扣除或相似度判断。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | `Tool 轮次执行说明与 Tool 调用连续呈现` 的 step 隔离和 live/history 场景 | 每个 route 只维护自身累计正文，final event 与 Tool 轮次消息各自只承载权威正文 | 跨 step 不重复；同 step continuation、fallback gate 和 terminal 保持完整 |
| 容量 | 既有 direct model `150000` UTF-16 code unit 单 route 上限 | 只计算当前 route 的 confirmed/current 正文，不计入其他 step | 边界值、超限降级和截断终态不变 |
| 可测试性 | 同一 Requirement 的 step 隔离、相同文本和续写场景 | 以真实 model 脚本和 in-memory run state 观察事件 | 测试在修复前因跨 step 前缀失败，最小修改后转绿 |

## 验证策略（Verification Strategy）

- Agent Core characterization/integration 测试构造至少两个含公开说明的 Tool 轮次和一个无 Tool 终止轮次，断言每个 Tool 说明仍分别持久化、final event 只包含终止轮次回答。
- Agent Core live event 回归按 `stepId` 收集非终态 `LLM_CONTENT_DELTA`，断言后续 step 不含先前说明、空白轮次不重放先前正文、相同文本在不同 step 保持独立。
- Runtime product-path 测试读取 terminal commit 后的会话消息，断言最终 Assistant Message 与 final event 一致，且 Tool 说明只存在于对应隐藏 Tool 消息和过程事件投影中。
- 输出续写测试证明同一终止模型轮次的多个已确认片段完整保留，而先前 Tool 轮次说明不被拼接。
- 既有无 Tool、terminal hook mutation/continuation、Tool 失败、output guard、process-message projection 和 architecture tests 提供非回归覆盖。
- negative case 明确断言最终 Assistant Message 不包含任一已完成 Tool 轮次说明，不使用前端、Runtime 或字符串相似度去重。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/ts-web-sse-ws-transports/spec.md`：合并按 `stepId` 隔离累计正文及终态分离后的 `Tool 轮次执行说明与 Tool 调用连续呈现` Requirement。
- `openspec/specs/ts-minimal-agent-kernel/spec.md`：移除 `Tool-call rounds preserve public assistant content for subsequent model invocation` 中不再成立的 request-level stream cumulative 辅助描述，不改变该 Requirement 的消息持久化义务。
- `openspec/designs/functions/D1-会话与流式交互/D1.1-流式交互与恢复/FN-1.1-查看会话消息流.md`：刷新输出、结果和“Tool 轮次说明与最终答案分离”规格。
- `openspec/designs/features/D1-会话与流式交互/D1.1-流式交互与恢复/F-1.1-实时查看处理过程.md`：补充过程说明与最终答案唯一展示位置的用户价值保证。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/conversation-process-history.md`：明确终止轮次回答与先前 Tool 轮次消息的正文边界。
- `openspec/designs/modules/agent-core.md`：明确 model route 只累计当前 step 正文，no-tool terminal boundary 使用当前终止模型轮次正文。
- `openspec/designs/adr/`：无；本 change 沿用既有 Message-first 与 Runtime terminal commit 决策。
- `openspec/designs/spec-to-design-map.md`：验证入口增加终态答案与 Tool 轮次正文分离测试。

## 风险与取舍（Risks / Trade-offs）

- 外部消费者若错误地把不同 `stepId` 的 `metadata.accumulated=true` 解释为请求级累计，需要改为按 `stepId` lane 聚合；现有 Agent Web 已按该身份规则消费。
- 已经持久化的错误历史不会被重写；修复只保证新执行产生正确事实。通过不增加迁移或启发式清理避免误删用户正文。
- terminal hook 将不再看到先前 Tool 轮次说明作为 `finalContent` 前缀。这是修复终态边界所需的有意变化；hook 仍可通过既有运行上下文观察授权事实，但不得把过程正文重新拼入最终答案。

## 待确认问题（Open Questions）

无。

## 需群内确认

- **APPROVED（2026-08-07）**：非终态 model `LLM_CONTENT_DELTA` 的累计边界为当前非空 `stepId`；同 step continuation 累计，跨 step 不继承正文。事件类型、payload shape、runtime schema、terminal final event 和 owner 边界不变。
- 确认来源：用户在当前 Codex 任务中明确回复“同意契约，继续”；群消息追溯字段未提供。
