## Why

最终用户对一个请求执行 Retry 并获得新的可见回答后，继续提交下一轮问题时，模型可能看不到上一轮的原始问题和最新有效回答，并把会话误判为刚开始。该问题会破坏普通问答、Tool 调用和 Workflow 执行后的多轮连续性，也使已经成功完成的 Retry 无法成为后续诊断或追问的有效上下文。

系统需要在保留被替换 attempt 可追溯事实的同时，明确区分“用于审计的旧事实”和“当前仍有效的模型可见轮次”。现有上下文契约已经要求排除被替换消息并保留完整可见轮次，但 Retry 后同一请求同时存在旧隐藏输出和最新可见输出时，当前行为没有满足该不变量，因此需要独立修正。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- Retry 完成后，后续请求的模型上下文包含原始用户问题和最新可见且协议完整的 attempt。
- 被 Retry 替换的旧 attempt 中，全部非 USER output 都不进入普通模型上下文；即使执行期 assistant tool-use 在 Retry 前已经是 hidden 且没有 replacement reason，也必须随同一明确被替换的 run 一起排除。旧事实继续保留既有审计和显式诊断可追溯性。
- 纯文本、完整 Tool protocol 和 Direct Workflow 的 Retry 结果遵守同一条 prior turn 完整性规则。
- 不完整或孤立 Tool protocol 以及非 Retry 原因隐藏的轮次继续按既有规则 fail closed。

**非目标：**

- 不改变 Retry acceptance、attempt lineage、latest-request、terminal commit、消息可见性写入或恢复语义。
- 不改变 ActiveContextView、Message/Event、Gateway、数据库、Web API、stream event、public DTO 或 `agent-contracts`。
- 不修改 Agent Web 的 attempt 展示投影，不建立 Workflow 专属上下文选择分支。
- 不恢复或展示被替换 attempt，不放宽不完整 Tool protocol、Edit replacement 或 Guard replacement 的排除规则。

## What Changes

- 修改 `FN-4.3 装配上下文` 的 prior conversation 行为：同一请求包含 Retry 替换历史时，系统只使用未被 Retry 替换的消息重新判定有效轮次，并把通过完整性校验的原始用户问题与最新 attempt 作为 history candidate。
- 明确 Context Engine 只以同一 prior request 内持久化的 `RETRY_REPLACED` message 识别被替换 run，并排除该 run 的全部非 USER messages；不按时间、顺序或 `runId` 大小猜测最新 attempt。
- 明确其他隐藏原因、不完整终态和孤立 Tool protocol 继续导致对应 prior turn 被排除，不产生 current-request-only 的静默伪连续性。

本 change 不包含破坏性公共契约变更。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-4.3 装配上下文` → `specs/context-engine/spec.md`
  - 功能边界：补充 Retry 后 prior conversation 的有效轮次判定，确保最新完整可见 attempt 成为后续请求的模型可见历史，同时排除旧 attempt 输出。
  - 系统质量属性：可靠性、可维护性、可测试性、审计/可追溯性。
  - 映射说明：`context-engine` 是 canonical spec；本 change 不触及其他 legacy spec。

## 影响范围（Impact）

- 最终用户：Retry 后继续追问时，模型能够使用原问题和最新回答保持对话连续性。
- Agent 开发者与平台集成方：无需修改公共 API、配置、消息 schema、Gateway 或 Workflow 接入。
- 运维人员：旧 attempt 的隐藏事实和诊断可追溯性保持不变，普通模型输入只消费最新有效轮次。
- 主要受影响范围为上下文历史候选选择及其纯文本、Tool protocol、连续 Retry 和 Workflow 回归验证。
