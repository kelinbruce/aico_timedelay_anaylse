## 背景与问题（Why）

Agent Web 的会话展示以服务器持久化的 visible `SessionMessage` 为权威来源：正常请求经 `runtime.submit` 接受后，run 的用户输入与 assistant 终态由 runtime 持久化，前端经 stream 与 conversation 重建，刷新前后语义一致。

输入护栏拦截轮是这条不变量上的唯一例外。当 RobotRouter 输入校验返回 `BLOCKED` 时，Web channel 的 submit 路径在 `runtime.submit` 之前就抛 `GUARD_INPUT_BLOCKED`（HTTP 400），后端不持久化任何消息。为了让拦截轮在当前页面可见，前端在 `requestStore` 伪造两条 `local-optimistic` 信封（用户输入 + `OUTPUT_GUARD_BLOCKED`/`phase=INPUT_GUARD` 拒答），并 mirror 到 `sessionStorage`，刷新时在 `loadConversation` 末尾重灌。

这造成**双数据源**：服务器对持久化轮权威，输入拦截轮是纯客户端副本。`sessionStorage` 镜像有三个具体缺口导致刷新错乱：

1. 重灌进 live 层而非 history 层，无服务器 terminal 事件使其沉淀，`mergeEnvelopes` 时被孤立错位。
2. 伪造信封 `sequence=0` + 客户端时钟，`buildTurnBlocks` 按时钟再按 sequence 排序，时钟偏斜把拦截轮顶到错误时序位置。
3. 只在主 `loadConversation` 重灌，`loadAnchoredConversation` 与 older/newer 游标分页路径不重灌，滚动或锚定时拦截轮从视图消失。

关闭浏览器 tab 后 `sessionStorage` 被清空，拦截轮彻底丢失，多 tab、服务端 fork/分享/搜索/标题生成也看不到该轮。

## 目标结果（Goals）

- 输入护栏拦截轮的权威来源与正常轮一致：单一数据源 = 服务器持久化的 visible `SessionMessage`。
- 拦截轮在后端持久化为 `visible=true` 的用户输入消息与拒答消息，携带 `metadata.modelVisibility = { excluded: true, reason: "GUARD_BLOCKED" }`，不调用 `runtime.submit`、不产生 run、不进入后续轮次 model context。
- conversation 接口返回该轮，页面刷新、关闭重开、锚定、游标分页后该轮均按真实时序位置可见。
- 前端删除全部本地伪造信封与 `sessionStorage` 镜像，刷新后由 conversation 直接重建。

## 非目标（Non-Goals）

- 不改变 stream event vocabulary，不新增 stream event type；拦截仍以 HTTP 400 `GUARD_INPUT_BLOCKED` 即时反馈前端，不向客户端流注入新事件。
- 不改变 `visible` 字段语义或 model context 现有选择规则：本 change 新增 `metadata.modelVisibility.excluded` 作为独立的"模型排除"标记，由 context assembly `isHiddenReplacement` 新增第 4 条路径消费，与 `visible` 字段解耦。现有 `visible=false`/`replacement.kind` 排除路径不动。
- 不持久化逐条 stream delta，不为拦截轮创建 run 或 terminal timeline event。
- 不新增 message role、数据库表或 gateway port；新增的 runtime command 复用现有 `SessionMessageStoreGateway.appendSessionMessage` 写入路径。
- 不修改 OUTPUT 护栏路径（`web-stream-delivery.ts`、`hideRunMessages`、`OUTPUT_GUARD_BLOCKED` 事件）。

## 变更范围（What Changes）

- Web channel 的 submit 路径在输入护栏拦截时，抛 `GUARD_INPUT_BLOCKED` 之前，经新增 `RuntimeCommandPort.recordInputGuardBlock` 命令持久化一对 `visible=true` 消息：用户输入（`role=USER`）与拒答（`role=ASSISTANT`，content 为 RobotRouter 的 `refusalMessage` 透传不改写），均带 `metadata.modelVisibility = { excluded: true, reason: "GUARD_BLOCKED" }`、同一 `requestId`、幂等键防重复写。仍不调用 `runtime.submit`。
- `RuntimeCommandPort` 新增可选 `recordInputGuardBlock?(command)`，与现有 `hideRunMessages` 对称：`hideRunMessages` 隐藏已有 run 的 assistant 消息，`recordInputGuardBlock` 记录无 run 的输入拦截轮。runtime 实现内部经 `SessionMessageStoreGateway.appendSessionMessage` 写入。
- 前端 `requestStore` 删除两处 `GUARD_INPUT_BLOCKED` 分支的 `local-optimistic` 信封构造与 `saveGuardInputBlockTurn` 调用，保留 400 错误的即时提示。
- 前端删除 `guardInputBlockPersistence.ts`，删除 `conversationStore.loadConversation` 末尾的重灌块。
- 前端 `useChatComposerController` 删除 `isInputGuardBlockedTurn` 编辑/重试特例：拦截轮现有后端持久化终态，统一走正常 `editLatest`/`retryLatest`。
- MODIFIED `guardrail-gateway` 的 `Input-blocked round is displayed and survives page refresh` 与 `Input-blocked round produces no model-visible assistant message` 两个场景，把"前端侧持久化、后端不持久化"改为"后端持久化 `visible=true` + `metadata.modelVisibility.excluded` safe marker"。

## Function 影响（OpenSpec Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `guardrail-gateway`（canonical spec `openspec/specs/guardrail-gateway/spec.md`）：MODIFIED 两个 input-blocked 场景，把输入拦截轮的持久化归属从前端移到后端 `visible=true` + `metadata.modelVisibility.excluded` safe marker；新增 `recordInputGuardBlock` runtime command 的契约可见行为。涉及系统质量属性：可靠性/恢复（刷新一致性）、可维护性（消除双数据源）、审计/可追溯性（拦截轮进入服务端持久化与审计面）。

## 影响范围（Impact）

- 主要 owner：`agent-channel-web` 的 submit 路径（`packages/agent-channel-web/src/routes/requests.ts` `submitStagedRequest`）调用新增 runtime command；`agent-runtime` 实现该 command 并经 `SessionMessageStoreGateway.appendSessionMessage` 写入。
- 契约：`agent-contracts/runtime` 的 `RuntimeCommandPort` 新增可选 `recordInputGuardBlock` 方法与 `RecordInputGuardBlockCommand`，复用现有 `SessionMessageRecord`/`VisibilityReason="GUARD_BLOCKED"`/`SessionMessageStoreGateway`，不新增 message role、stream event type 或数据库表。
- 持久化：复用现有 message table 与 `SessionMessage.metadata`，新增消息以 `visible=true` 写入并携带 `metadata.modelVisibility`；新增 `metadata.modelVisibility` additive typed extension（owner `agent-contracts/session`）。context assembly 新增一条排除路径消费它。
- 前端：`agent-web` 的 `requestStore`、`conversationStore`、`useChatComposerController`、`streamingHelpers`（`isInputGuardBlockedTurn` 若无消费者则删除）、`guardInputBlockPersistence`（删除）。
- 兼容性：HTTP 400 `GUARD_INPUT_BLOCKED` 错误码与 `error.message` 不变，前端即时反馈契约不变；旧拦截轮记录不存在（此前后端从不持久化），无迁移负担；retry/edit/supersede、fork/share、hidden visibility 规则不变。
- 安全：拒答语仍由 RobotRouter 返回、NextAgent 透传不改写；`metadata.modelVisibility.excluded=true` 使 context assembly 排除，消息不进 model context；不暴露 raw provider error、credential 或 endpoint。
- 验证：后端 contract test（拦截后 conversation 返回 `visible=true` + `modelVisibility.excluded` 消息对、不调 `runtime.submit`、幂等不重复写、context assembly 排除）、前端回归（无 local-optimistic 信封、无 sessionStorage、刷新由 history 重建、多轮时序正确）、端到端 probe 脚本（真实后端 + stub guardrail 验证 conversation 返回）、`openspec validate --all --strict`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`npm run build`。
- 依赖与并行边界：与 `persist-ts-refresh-stable-completed-turns`（OUTPUT 护栏 safe refusal 持久化，当前 0/22 tasks 未实现、不触及 input guard）共享 `visible=false` + `VisibilityReason="GUARD_BLOCKED"` + `SessionMessageStoreGateway.appendSessionMessage` + conversation 投影面，须串行实施；本 change 仅触及 input-guard 分支与 `RuntimeCommandPort.recordInputGuardBlock`，不与该 change 的 `OUTPUT_GUARD_BLOCKED`/`hideRunMessages`/`CompletedTurnPresentationV1` 路径产生 spec 或 Requirement 交叉。
