## 背景与问题（Why）

agent-web 会依次组合 message history、settled process、仍保留的 live process，以及对应 display run 的持久化 event history。当前可见性调度只按可见 turn 的 `runId` 选择 event-history target，没有排除 active run；因此当前轮仍由 live stream 驱动时，也可能并行查询自己的持久化 events。模型步骤或实时流结束后，settled/event-history layer 已经包含 thinking step 的完成态，live layer 仍可能保留同一 step 的累计 partial。两份 envelope 的 `eventId` 可以不同，现有 turn overlay 和 process-history 组合仅按 `eventId` 去重，因此同一个 thinking step 会在 live/terminal 交接窗口或 history hydration 后显示两次。

`LLM_THINKING_DELTA.payload.stepId` 已提供 thinking step 的稳定业务身份，active-run scoped stream replay 也已负责恢复当前 run 的可恢复流事件。当前 run 不需要再通过 event-history hydration 建立第二条恢复路径；组合逻辑仍必须在同一 turn、同一 run 内按稳定身份处理 active/settled/history 交接，同时不得按文本推测身份，否则文字相同但属于不同 step 的 thinking 会被错误合并。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 当同一 thinking step 同时存在 live 累计 envelope 和 settled/event-history 完成态 envelope 时，过程面板只显示先进入已结算层的完成态 canonical copy。
- 同一 stable step 在纯 live layer 中出现多条累计 snapshot 时，只投影最新 snapshot，不因中间事件或异步批次形成多条卡片。
- active run 只由 live stream 与 active-run scoped replay 恢复，不进入自动或过程面板展开触发的 event-history hydration；run 终态后才取得 history hydration 资格。
- 历史 event 重复回填或页面重连时，组合结果保持幂等，不重新引入已被持久化完成态替代的 live copy。
- 不同 `stepId` 的 thinking 即使文本相同也保持为不同过程步骤。
- 缺少稳定 `stepId` 时只复用既有 `eventId` 去重规则，不按文本、sequence 或出现顺序猜测 thinking 身份。

**非目标：**

- 不修改 think 的实时流式输出、完成态持久化规则、event 查询接口或后端 owner。
- 不修改 process-history hydration 的并发、缓存、取消、重试或分页生命周期；仅收紧 target eligibility。
- 不修改工具结果组合、最终答案 owner、过程面板折叠时序或多 host 入口。
- 不新增 public DTO、stream event、持久化字段或 `agent-contracts` 内容。

## 变更范围（What Changes）

- 统一 agent-web turn overlay 与 process-history 组合使用的稳定 thinking step 身份：`sessionId + runId + rootMessageId + stepId`。
- 在 pure live 输入内，同一稳定 step 的累计 snapshots 以最新 snapshot 为 canonical；当已组合输入中存在该 step 的完成态 `LLM_THINKING_DELTA` 时，settled/event-history 完成态替代同 step live partial/completed copies。
- process-history target selection 显式排除 active run；terminal transition 重新计算 eligibility，已完成历史轮次、预览跳转与展开过程面板仍沿用既有受控并发加载。
- 增加 pure-live 累计替换、settled/live、base/event-history 交接、active/terminal eligibility、active-run replay、不同行为入口及保守降级的自动化验证。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `ts-stream-history-consistency`：补充 active run 的 event-history eligibility，以及同一 thinking step 在实时层与历史层交接时的 canonical copy 选择和保守降级规则。

## 影响范围（Impact）

- 生产代码仅影响 `frontend/agent-web`：turn envelope overlay、process-history composition、共享稳定身份 helper，以及可见/显式 process-history target eligibility。
- 现有 `StreamEnvelope`、run event REST API、conversation store cache shape、scheduler 并发实现和 UI component contract 保持不变。
- agent-web turn/session projection、process-history target 与 active-run replay tests 增加对应回归场景；不需要数据库迁移、配置变更或部署变更。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-stream-history-consistency/spec.md`：补充 thinking live/history 交接的一致性要求。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/conversation-ui-state.md`：补充 active-run history eligibility 与单 turn thinking canonical copy 选择边界。
- `openspec/designs/modules/agent-web.md`：补充 process-history scheduler 的 terminal eligibility 和 adapter 的稳定 step 去重职责。
- `openspec/designs/adr/`：无。
- `openspec/designs/features/`：无。
- `openspec/designs/functions/`：无。
- `openspec/designs/spec-to-design-map.md`：仅在上述长期设计导航发生变化时更新。

长期基线更新由归档流程执行，不是实施阶段默认任务。
