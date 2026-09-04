## 背景和现状（Context）

Stable Pending Input capabilities 已经定义 runtime-owned lifecycle、canonical kind、答案 shape、超时、取消和安全投影。`frontend/agent-web` 在这些 contract 之上实现了 UI projection，但 Stable Specs 尚未说明用户何时看到 Pending Input 响应面板，以及该面板何时退回普通 Composer。

当前生产调用链如下：

1. `useStreamConnection` 将 canonical `USER_INPUT_REQUIRED` 和 resolved outcome 交给当前会话的 stream handler。
2. `useChatSessionStream` 将已经进入 frontend 的 Pending Input projection 归一化为 `ActiveUserInput`，并写入 `useUserInputStore`。
3. `ChatPage` 在 `activeInput` 存在时渲染 `RespondInput`，否则渲染普通 `MessageInput`。
4. `RespondInput` 按当前 kind 选择响应控件，并把 ordered answers 交回 `ChatPage`。
5. answer 请求成功时，`ChatPage` 立即清除本地 active input；当前会话收到 `USER_INPUT_RECEIVED`、`USER_INPUT_TIMEOUT` 或 `USER_INPUT_CANCELED` 时，同一 store 也被清除。
6. `useChatSessionStream` 把已投影的过期坐标保存在 `ActiveUserInput`；`RespondInput` 用本地时钟更新剩余/过期显示，但不会据此触发 answer、cancel 或 store clear。
7. `QUESTION` 与 `HUMAN_HANDOFF` 的取消按钮通过 `ChatPage` 把 `activeInput.requestId` 交给既有 request cancel 路径；cancel request 成功后响应面板仍等待 canonical resolved outcome。

本 change 只把这条已经存在且有测试的 UI 状态转换建立为规格。它不接管 canonical event、public DTO、answer route 或 runtime lifecycle 的 owner。

存在以下 implementation-vs-spec gap，本 change 明确不将其固化：

- `CONFIRMATION` 缺少 options 时，当前组件会构造与 Stable confirmation answer vocabulary 不一致的 fallback 值。
- 当前兼容 `CLARIFICATION`、`APPROVAL`、`SELECTION` 等非 canonical UI kind，但这些兼容分支没有 Stable Pending Input owner。
- answer 失败只显示统一错误；没有分类错误 contract。
- 当前前端没有可单独证明 exactly-once 的并发提交契约，也不拥有 runtime idempotency。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 为 active pending input 替换普通 Composer 的行为建立唯一的前端 UI spec owner。
- 为成功回答和 canonical resolved outcome 恢复普通 Composer 的行为建立可验证契约。
- 为投影过期坐标建立只读展示边界，明确本地倒计时不是 lifecycle authority。
- 为当前 `QUESTION`、`HUMAN_HANDOFF` 取消入口建立 owning-request 委托边界。
- 只描述当前生产实现和现有测试已经证明的结果。
- 保持 Pending Input lifecycle、transport 和 answer contract 的既有 owner 不变。

**非目标：**

- 不修改生产代码、API、DTO、event schema、runtime、gateway 或 persistence。
- 不通过测试引入或改变产品行为；只补充严格按当前 UI 结果编写的 characterization tests。
- 不定义 Pending Input 的创建、resolve、timeout、cancel、checkpoint、resume 或 idempotency 语义。
- 不定义 `CONFIRMATION` fallback、fallback decision、分类错误、重复提交、timeout policy、timer cadence、精确倒计时格式、字数限制、按钮顺序或视觉样式。
- 不定义 cancel command shape、HTTP route、runtime cancellation authority，或其他 kind 是否提供取消入口。
- 不定义非 canonical 兼容 kind。
- 已按用户授权把本 capability 的最小 UI projection 职责同步到现有 Stable `openspec/designs/modules/agent-web.md`；不创建平行 architecture owner，也不复制未归档 delta 的规范正文。

## 设计决策（Decisions）

### D1. 只建立缺失的 UI 规格，不修改当前 UI 实现

选定路径是使用当前 `useUserInputStore -> ChatPage -> RespondInput` 调用链作为事实证据，新增 active change 文档，并用 characterization tests 补足此前缺失的 canonical `CONFIRMATION`、倒计时到期和 owning-request 取消证据。现有实现已经满足本 change 的四条 Requirement；测试只锁定用户可观察的控件选择、提交/取消委托和 UI 收敛结果。修改生产代码会扩大边界并把规格补齐变成功能开发。

放弃把 Pending Input UI 并入 `add-ts-task-channel`。该 change 拥有 Web/Task channel surface、answer route 和 transport projection，不拥有浏览器中的 Composer 切换；修改它既会影响他人未归档 change，也会混淆 channel contract 与 UI state owner。

### D2. UI 只消费既有 Pending Input contract

新 capability 只规定“frontend state 已存在 active pending input”之后的 UI 行为。canonical kind、ordered answers 和 resolved outcome 的含义继续引用现有 Stable Pending Input capabilities。本 change 不复制 payload schema，也不规定 transport-specific 行为；SSE 和 WebSocket 继续通过同一 frontend stream handler 获得等价 UI 结果。

### D3. `useUserInputStore` 保持单一的本地 UI 状态 owner

当前实现用一个 `activeInput` 决定响应面板与普通 Composer 的互斥显示。answer 请求成功和 canonical resolved outcome 都收敛到该 store 的 clear/resolve 操作。该设计让本地成功响应不必等待后续 stream event 才恢复 Composer，同时允许其他客户端回答、timeout 或 cancel 通过 stream outcome 收敛当前 UI。

本 change 不新增平行 store、状态机或 session persistence。页面切换时清理 active input 是当前实现细节，不纳入本次 Requirement。

### D4. 冲突行为必须留在规格范围外

`CONFIRMATION` fallback、兼容 kind、通用错误展示和重复提交均不满足“代码、测试、Stable owner 一致”的门禁，因此不写入 Requirement。未来若处理这些问题，必须单独建立或修改对应 OpenSpec owner，不能在本 change 中顺带修正。

### D5. 投影过期坐标只驱动显示，不驱动 lifecycle

`expiresAt`/等价过期坐标进入 `ActiveUserInput` 后，前端可以用本地时钟显示剩余或过期状态，但该坐标不是 timeout authority。显示到期不得提交答案、授权、发起取消或清除 active input；只有既有 answer 成功路径或 canonical received/timeout/canceled outcome 才能恢复普通 Composer。规格不冻结一秒刷新频率、文本格式、颜色或布局。

### D6. 取消入口委托 owning request，并等待 canonical outcome

`QUESTION` 与 `HUMAN_HANDOFF` 当前提供取消入口。`ChatPage` 使用 active input 已携带的 `requestId` 调用既有 request cancel owner；frontend 不创建独立 pending-input cancel command，不合成 `USER_INPUT_CANCELED`，也不因 cancel HTTP 成功就清除 response surface。runtime/channel 继续拥有 cancellation authority、idempotency、terminal lifecycle 和 canonical event。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 不新增身份、授权、answer vocabulary 或 protected-operation 字段；`AUTHORIZATION`、timeout 和 cancel authority 继续由既有 Stable Specs 拥有。本地倒计时不能授权或捏造答案；已知 `CONFIRMATION` fallback 冲突被排除。 | Stable Pending Input specs review；`RespondInput.test.tsx` 的 canonical kind/倒计时场景；边界 review |
| 性能/容量 | 本 change 不增加运行时路径。当前 UI 只保存一个 active input 并渲染一个响应面板，不建立列表、缓存或持久化容量契约。 | 生产调用链 review；无新增 benchmark 需求 |
| 可靠性/恢复 | answer 成功可立即恢复 Composer；canonical received、timeout、canceled outcome 提供 stream 收敛路径。倒计时到期和 cancel request 成功都不提前清除 UI；runtime resolve、重放顺序和幂等仍由既有 owner 保证。 | `RespondInput.test.tsx` 的倒计时到期场景；`chat-page.route-state.test.tsx` 的成功回答、timeout、cancel 场景；`useStreamConnection.test.tsx` 的 resolved outcome 路由场景 |
| 可维护性 | UI 切换由 `useUserInputStore` 单一控制，不新增平行 owner；change scope 与 channel/runtime owner 分离。 | production symbol review；未归档 change overlap scan |
| 可测试性 | Requirement 映射到组件、stream 和 route-state 测试；characterization tests 补足 canonical `CONFIRMATION`、倒计时到期不收敛和取消等待 canonical outcome 的证据。只运行相关 test name，避免用同文件中的无关失败掩盖或否定本 capability 证据。 | `RespondInput.test.tsx`、`useStreamConnection.test.tsx`、定向 `chat-page.route-state.test.tsx` |
| 审计/可追溯性 | 不新增日志、trace 或 audit event。canonical Pending Input event 仍是 runtime/channel 的事实来源；本 change 通过 spec、production symbol 和测试命令建立追溯。 | OpenSpec strict validation；验证映射；最终 review |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| Active pending input 替换普通 Composer | 1.1 | `chat-page.route-state.test.tsx`：approval/NextAgent pending input 场景 |
| 四种 canonical kind 选择对应响应控件 | 1.2 | `RespondInput.test.tsx`：QUESTION、AUTHORIZATION、HUMAN_HANDOFF 场景；`chat-page.route-state.test.tsx`：canonical `CONFIRMATION` 使用 `{ label, value }` options 选择 confirmation controls。现有 `RespondInput` CONFIRMATION 组件测试使用与 Stable contract 冲突的 `continue/stop` vocabulary，不能作为本 capability 的通过证据 |
| answer 成功后恢复普通 Composer | 1.3 | `chat-page.route-state.test.tsx`：canonical `CONFIRMATION` answer submit 场景 |
| received、timeout、canceled outcome 恢复普通 Composer | 1.4 | `useStreamConnection.test.tsx`：三种 resolved outcome 到 blocking-response callback 的路由；`chat-page.route-state.test.tsx`：timeout、cancel 和 UI 清理场景 |
| 投影过期坐标只改变显示，不自行收敛 active input | 5.2 | `RespondInput.test.tsx`：倒计时推进到过期后 response surface 保持，submit/cancel 均未触发 |
| `QUESTION`、`HUMAN_HANDOFF` 提供 owning-request 取消入口 | 5.1、5.3 | `RespondInput.test.tsx`：两种控件的 cancel action；`chat-page.route-state.test.tsx`：pending request id 委托及 canonical outcome 前不恢复 Composer |
| 不争用 channel/runtime/未归档 owner | 2.1 | 全量 Stable/active owner scan；change diff review |
| Active change 自身结构有效 | 2.2 | `openspec validate establish-agent-web-pending-input-ui --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：归档后由 `openspec/specs/agent-web-pending-input-ui/spec.md` 唯一拥有 Composer 与 Pending Input 响应面板的 UI 切换、展示型过期状态和 owning-request 取消委托行为。
- 架构和跨模块设计：无新增长期主承载；canonical lifecycle、event 和 channel projection 继续由既有 Pending Input architecture/spec owner 负责。
- 模块设计：`openspec/designs/modules/agent-web.md` 现已是 Stable 前端 module owner。归档前只补 `useUserInputStore -> ChatPage -> RespondInput` 的 Pending Input UI projection、Composer 互斥、展示型过期状态和 owning-request 取消委托职责；AICO、Expand Panel 和 structured delta 已有 Stable owner，不在本 change 重复。
- ADR：无。
- 导航：归档前仅在 `openspec/designs/spec-to-design-map.md` 增加新 capability 到生产实现和测试入口的导航。

## 风险与取舍（Risks / Trade-offs）

- [只建立 UI 切换规格，未解决 `CONFIRMATION` fallback 冲突] -> 在 proposal、spec 和 tasks 中显式排除；后续作为独立 contract/implementation change 处理。
- [同一个 route-state 文件存在与本 capability 无关的失败] -> 验证使用精确 test name；同时如实记录全文件结果，不把无关失败声称为通过。
- [仍未归档的 channel change 未来可能改变 transport projection] -> 本 change 不定义 payload/schema/channel owner；归档前重新执行 active owner overlap scan，并只向 Stable `agent-web.md` 合并前端 UI 职责。
- [本地成功后立即清除 UI，后续 stream outcome 可能重复到达] -> 当前 store clear 是可重复的本地状态收敛；runtime idempotency 和 event 顺序仍由既有 owner 保证。
- [本地时钟可能先于 canonical timeout 到期] -> 到期只改变显示，response surface 保持到 authoritative outcome；不把客户端时钟升级为 lifecycle authority。
- [cancel request 成功与 canonical canceled event 存在时间差] -> frontend 保持 response surface，避免伪造 terminal/canceled 事实；最终收敛仍走既有 stream owner。

## 迁移计划（Migration Plan）

无生产迁移、数据迁移或发布步骤。本 change 仅建立增量规格和验证证据。若后续归档，只将通过终审的行为契约提升到 Stable Spec，并更新导航；回滚方式是撤销本 change 文档，不影响运行时。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/agent-web-pending-input-ui/spec.md`：提升四条已验证的 UI Requirement。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/<topic>.md`：无。
- `openspec/designs/modules/agent-web.md`：最小补充 Pending Input response surface、普通 Composer 互斥、本地恢复、展示型过期状态和 owning-request 取消委托职责，不复制 canonical lifecycle、answer/cancel route 或 stream payload。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：增加新 capability、当前 production symbols 和定向测试入口；不得复制未归档 change 内容。

## 待确认问题（Open Questions）

无。已知但排除的 `CONFIRMATION` fallback、兼容 kind、分类错误和 exactly-once 提交不是本 change 的待确认实现项。
