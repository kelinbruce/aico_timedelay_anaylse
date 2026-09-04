## 背景与问题（Why）

`AskUserQuestion` 通过 runtime-owned pending-input lifecycle 暂停原始 request run。用户回答后，runtime 已经以 compare-and-set 方式把 pending input 解析为 `RECEIVED`，发布不携带回答正文的 `USER_INPUT_RECEIVED`，并为原始 `AskUserQuestion` tool call 写入一个包含已接受回答的可见 `CAPABILITY_RESULT` message，然后继续原始 run。

当前 Web 实时投影没有把这个已持久化结果同步投影为 `CAPABILITY_RESULT_DELTA`。agent-web 也没有把 `USER_INPUT_REQUIRED` 的问题、`USER_INPUT_RECEIVED` 的状态和 `CAPABILITY_RESULT` 的回答关联为同一次交互。因此，回答后的当前页面只能显示通用“已响应”信息；完成、刷新或历史加载后，回答结果又可能显示成独立的通用 `AskUserQuestion` tool result。即使把问题与回答分别保留成两个 process entry，也会把一次连续的补充信息交互拆成两条系统记录。当前行为无法自然、稳定地呈现用户实际补充的信息，并造成 live、settled 与 history 展示不一致。

浏览器本地提交内容不是 canonical execution fact，不能用作长期展示来源。该问题必须通过 runtime 已接受并持久化的回答事实解决，同时保持 pending-input、stream projection 和 frontend view state 的现有 owner 边界。

现有实现还把 `AskUserQuestion.questions` 的 model-facing 上限和系统接收上限都固定为 3 项。模型一次偏离约束生成 4 个问题时，Agent/core 在 assistant tool-use message 已写入后才发现 schema 校验失败，并以 `INVALID_INPUT` 直接终止 run；用户看不到问题，只看到请求失败和输入解锁提示。模型正常使用仍应被明确限制为每次最多 3 个必要问题，但系统不应因一次可控偏差立即失败。另一方面，当前前端把全部问题同时铺开，问题增多时弹层变长、认知负担上升。该 change 需要保留“模型最多 3 题”的明确契约，同时以 runtime 现有 20 项容量作为兼容兜底，并把兜底接收的多问题交互改为逐题填写、最终一次提交。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- `QUESTION` pending input 的回答被 runtime 接受并持久化后，当前页面能够通过同一 session stream 看到回答的有界安全投影。
- agent-web 能够把问题、接收状态和回答结果关联为同一次 `AskUserQuestion` 交互：等待回答时显示一个“等待补充信息”process entry，回答被接受后把同一条目更新为“用户补充信息”，按问题顺序展示问题与实际回答，不再增加独立“已响应”entry。
- durable `CAPABILITY_RESULT` message 继续作为回答结果的最终事实；live-only stream result 丢失时，conversation/history 能够恢复同一展示结果。
- 相同结果的实时投影、重复投影和历史重建保持幂等；同一个 `pendingInputId` 在当前 attempt 中始终只形成一个补充信息 process entry，不产生额外的 response entry 或通用 `AskUserQuestion` tool result 卡片。
- conversation item 缺少 `requestContextId` 时，frontend 仍以 durable/live 共有的 root、run 与 `pendingInputId` 关联同一次交互；retry/edit 的不同 run 不得串联。
- `AskUserQuestion` 的 model-facing schema 与描述继续明确要求每次提出 1–3 个必要问题，不向模型暴露 20 题为正常可用额度。
- 当模型偏离上述约束但返回 4–20 个其他方面均有效的问题时，系统将其作为兼容兜底接收为一个 pending input，不因超过 3 题直接终止；该行为不改变模型契约。
- 超出 20 项技术容量的问题批次不得被截断、不得创建部分 pending input、不得留下不配对的 assistant tool-use message，也不得第一次越界就终止 run；Agent/core 应在有界次数内要求模型收敛到最多 3 题后重试。
- 对已接受的多问题 pending input，agent-web 每次只呈现一个问题，保留已填写草稿并允许前后翻页；全部问题完成后仍通过现有 answer route 一次性提交完整 `answers[][]`。

**非目标：**

- 不把 `AskUserQuestion` 改造成普通 capability invocation，不新增 `CAPABILITY_STARTED` 或 `CAPABILITY_COMPLETED`。
- 不在 `USER_INPUT_RECEIVED` 中加入回答正文，不改变该事件的安全边界。
- 不覆盖 `CONFIRMATION`、`AUTHORIZATION`、`HUMAN_HANDOFF` 或 workflow pending input 的回答展示。
- 不新增 stream event type、`RunStatus`、lifecycle stage、public Web route、持久化表、gateway contract 或第二套 pending-input 状态机。
- 不修改 `lastSeenSequence`、timeline replay 或 live-only event persistence 规则。
- 不使用浏览器 request body 或本地 composer state 作为 canonical 回答来源；逐题填写草稿仍是 frontend view state，不升级为 durable execution fact。
- 不把 pending answer 生成为新的顶层用户消息、conversation turn 或 root request；它只补全当前模型执行详情中的同一个补充信息条目。
- 不在 frontend 重复实现 capability-result 安全裁剪；live 与 conversation 必须复用 Web channel 的同一 projector。
- 不修改 `agent-contracts` 的 DTO、event vocabulary、public export 或 owner。
- 不宣称系统支持无界问题数，不移除 runtime 的 20 项 pending question 防御上限，不自动把一个越界 tool call 拆成多个 pending input，也不允许多个 pending input 同时占用同一 run。
- 不把 20 项兼容兜底写入 model-facing schema、字段描述或纠正提示，不把 4–20 题描述为模型的正常用法。
- 不为逐题填写增加草稿持久化、页面刷新后草稿恢复或新的 answer API；刷新后由现有 pending input 事实恢复问题，未提交的本地草稿可重置。

## 变更范围（What Changes）

- 修改 runtime 对 `AskUserQuestion` 回答的结果发布行为：仅在 `QUESTION` 回答对应的 durable `CAPABILITY_RESULT` message 成功写入后，发布一个现有类型的 live-only `CAPABILITY_RESULT_DELTA`，携带原始 tool call、pending input 和已由 runtime 接受的回答事实；runtime 不负责 Web 裁剪。
- 在 `agent-channel-common` 增加唯一、窄范围的 `projectAskUserQuestionAnswerResult(...)` 安全投影，并由 stream projection 与 `agent-channel-web` conversation projection 共同调用。该 projector 只为 canonical `AskUserQuestion` answer result 输出明确 allowlist、容量限制和截断语义的 `pendingInputAnswer` safe result；conversation item 通过可选的 channel-owned `pendingInputAnswer` 字段返回同一投影，未知或越界字段不得进入该字段。
- 修改 agent-web 的 history adapter 和 process projection：只消费 conversation API 的 `pendingInputAnswer` 安全投影来重建与实时流同形的 history envelope，并按受控 run/attempt、tool call 与 `pendingInputId` 关联问题、状态和回答；等待、已接收和实际回答共同更新一个补充信息 process entry。该条目对自由输入、单选、多选、自定义输入和一个或多个已接受问题使用同一“问题—回答”格式，匹配的 answer result 被该条目消费，不再形成独立 response entry 或 tool result；安全投影被截断时必须显示明确提示。既有 conversation message content 保持兼容，但不得作为该回答展示的 frontend 数据源。
- 修正 frontend 关联坐标：同一 root 下使用 `runId + pendingInputId` 区分 interaction，不再要求 conversation/history item 携带 live-only 的 `requestContextId`。
- 修改 canonical `AskUserQuestion` 输入处理但不放宽 model-facing descriptor：`questions.maxItems` 与描述继续要求最多 3 题。Agent/core 在持久化 assistant tool-use 之前做无副作用计数预检；4–20 题只通过 producer 内部的窄范围兼容校验接收，该校验仅放宽顶层 question count，继续复用 resolved descriptor 的其余 schema 与全部安全规则，且不修改或重新投影 descriptor。超过 20 题时使用既有 request-local model correction 机制最多重试 3 次，纠正提示仍要求模型收敛到最多 3 题。其他 schema、安全目的或 descriptor 错误继续使用现有失败语义。
- 修改 Web safe answer projector 的 answer group 上限，使其与 accepted pending question 技术上限一致；单组 item、单字符串和总字符预算保持有界。
- 修改现有 pending-input composer：多问题时显示当前序号/总数，每页只渲染一个问题，支持上一步/下一步和返回修改；只有最后一页且全部问题有效时显示并执行最终提交。翻页不调用后端，不创建多个 pending input。
- 增加 runtime、Web channel、frontend component/store 和浏览器旅程回归验证，覆盖实时回答、terminal settle、后续 submit、刷新、gap/history recovery、重复投影、越界投影和 stream delivery 缺失。

本 change 不包含破坏性变更。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `ask-user-question-tool`：为已接受 `QUESTION` 回答增加 durable-first、live-safe 的原始 tool call 结果投影，并明确模型每次最多 3 题、系统对 4–20 题只做兼容兜底。
- `ts-run-status-visibility`：定义 `AskUserQuestion` answer result 的 Web allowlist、容量边界和安全降级行为。
- `ts-stream-history-consistency`：定义 agent-web 对问题、回答状态和 durable/live answer result 的单条目关联、格式化、去重、settle 与刷新恢复行为。
- `e2e-ui-interaction`：定义多问题 pending input 的逐题填写、翻页和一次提交行为。

## 影响范围（Impact）

- `packages/agent-runtime`：pending capability result materialization 和 live-only result publication。
- `packages/agent-capability`、`packages/agent-core`：AskUserQuestion 的 3 题 model-facing descriptor、4–20 题兼容接收、持久化前预检和有界模型纠正。
- `packages/agent-channel-common`、`packages/agent-channel-web`：stream/conversation 共用的 AskUserQuestion answer projector、现有 conversation item 的可选安全投影字段与 contract/transport tests。
- `frontend/agent-web`：conversation answer projection adapter、safe capability result vocabulary、process detail projection、live/settled/history merge、多问题逐题交互和相关组件测试。
- runtime characterization、Web contract、frontend unit/component 及 Playwright 浏览器测试需要增加相应验收覆盖。
- 不增加 npm dependency、配置项、数据库 migration、部署步骤或运维接口。
- 本 change 只复用当前代码已经存在的 durable `CAPABILITY_RESULT`、`CAPABILITY_RESULT_DELTA`、pending-input lifecycle、conversation API 和 active/settled/history 投影，不依赖任何尚未实施的 completed-turn metadata、通用 final-fact 或 projector change。与其他修改相同 channel/frontend 文件的工作需要按文件串行集成，但不存在产品或契约前置依赖。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ask-user-question-tool/spec.md`：增加 accepted answer result 的 durable-first live projection，以及 model-facing 3 题与内部 20 题兜底的分层行为。
- `openspec/specs/ts-run-status-visibility/spec.md`：增加 `pendingInputAnswer` safe result 的 Web 安全投影契约。
- `openspec/specs/ts-stream-history-consistency/spec.md`：增加 AskUserQuestion 补充信息条目在 live、settled 和 history 之间的一致性契约。
- `openspec/specs/e2e-ui-interaction/spec.md`：增加多问题逐题填写与原子提交行为。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/stream-projection.md`：补充 durable capability result 与 live-only safe result 的恢复关系。
- `openspec/designs/modules/agent-capability.md`：补充 AskUserQuestion 每次最多 3 题的 model-facing schema 与说明。
- `openspec/designs/modules/agent-core.md`：补充 4–20 题兼容接收、count-only 持久化前预检和有界 model correction。
- `openspec/designs/modules/agent-runtime.md`：补充 pending capability result 发布职责。
- `openspec/designs/modules/agent-channel-web.md`：补充 AskUserQuestion answer result allowlist。
- `openspec/designs/modules/agent-web.md`：补充 pending-input process projection 的关联与降级职责。
- `openspec/designs/adr/`：无。
- `openspec/designs/features/`：无。
- `openspec/designs/functions/`：无。
- `openspec/designs/spec-to-design-map.md`：增加上述 stable spec 与长期设计入口的导航。

长期基线更新由归档流程执行，不是实施阶段默认任务。
