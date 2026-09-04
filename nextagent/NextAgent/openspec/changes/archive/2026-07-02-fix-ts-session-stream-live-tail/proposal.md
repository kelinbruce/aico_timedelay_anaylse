## 背景与问题（Why）

当前 Web 会话页刷新或新设备打开历史会话时，前端在没有当前页面内存 cursor 的情况下仍会打开 session-scoped stream，并把 `lastSeenSequence=0` 传给后端。按照现有 runtime stream 语义，`lastSeenSequence=0` 是显式 replay anchor，表示从该 session timeline 开头恢复 stream-visible events。长历史会话因此会在 conversation 已经加载历史消息之后，再通过 stream 被动回放大量旧 timeline events，造成前端 compaction/render 阻塞。

真实职责边界应当保持为：历史对话内容由 `conversation` 的 visible `SessionMessage` 负责；实时增量和断线恢复由 `stream` 负责；执行中会话的未提交 run 内容由 `activeRun + requestId/runId + lastSeenSequence=0` 做 bounded replay。当前问题不是后端支持全会话 replay，而是浏览器普通打开会话时把“没有 cursor”误表达为“从 0 replay 整个 session”。

## 变更范围（What Changes）

- `lastSeenSequence` 仍然是数字型 session timeline cursor；当 query 参数出现时，必须继续是非负 safe integer。
- 显式 `lastSeenSequence=0` 的语义不变，仍表示从 session timeline 开头 replay；带 `requestId/runId` 时仍表示 run-scoped bounded replay。
- Web stream 打开时如果没有提供 `lastSeenSequence` 且没有 `requestId/runId` filter，后端 MUST 按 session live-tail 处理，只交付订阅建立后的 session 新事件，不 replay 既有历史 timeline。
- Web 前端普通打开/刷新会话且当前页面没有内存 cursor 时，MUST 先用 conversation 建立历史视图；没有 `activeRun` 时再打开 no-cursor session live-tail，MUST NOT 发送 `lastSeenSequence=0`。live-tail 建立后 MUST 做一次 opening conversation reconcile，覆盖 conversation snapshot 与 live-tail boundary 之间的提交/activeRun 空窗，并保持去重。
- 只有已有当前页面内存 cursor、activeRun bootstrap、stream 不可用时的 submit/retry/edit bounded recovery 或显式全量 replay 场景才发送 `lastSeenSequence`。已 connected 的 no-cursor live-tail 只是尚未收到 cursor 时，不得因为“无 cursor”而额外启动 run-scoped bounded stream。
- request/run-scoped stream 的 terminal 后关闭语义、session-scoped stream 在单 run terminal 后继续订阅语义保持不变。
- terminal 到达后的普通 UI 收敛 MUST 以 live stream 本地状态为准；conversation refresh 只用于 gap recovery、stream timeout、手动刷新和打开/切换会话，不作为普通 terminal 后覆盖 live/process details 的路径。
- 本 change 不新增 Web API 参数、不增加 conversation response 字段、不恢复 sessionStorage stream cursor、不引入双 stream 常驻模型。

## Capability 影响（Capabilities）

### 新增 Capability
无。

### 修改的 Capability
- `ts-stream-resume-replay`: 修正页面刷新、新设备、断线重连和 activeRun bootstrap 下 `lastSeenSequence` 的发送条件；明确省略 cursor 与显式 `0` 的不同语义。
- `ts-web-sse-ws-transports`: 修正 SSE/WS stream query 语义，明确 no-cursor session stream 是 live-tail，显式 cursor 才是 replay anchor。
- `ts-minimal-agent-kernel`: 修正最小 Web stream 路径中“默认 `lastSeenSequence=0`”的旧基线，改为只有显式 replay 或已有内存 cursor 时传递 cursor。
- `ts-stream-history-consistency`: 明确 conversation 历史、stream live state、activeRun replay 和 terminal 后 UI 收敛的职责边界。
- `ts-core-contracts`: 修正 `RuntimeSessionStreamEventsQuery.lastSeenSequence` 的核心契约形态，明确字段可省略且省略不等于 replay anchor。

## 影响范围（Impact）

- 后端 contract：`RuntimeSessionStreamEventsQuery` 和 Web stream delivery request 的 `lastSeenSequence` 字段需要支持省略；字段类型仍为 `TimelineSequence` 数字，不引入新对象或模式字段。旧的 `RuntimeEventStreamQuery` 继续表示显式 replay anchor，不作为 no-cursor live-tail public/session-facing 契约入口。
- 后端 runtime：需要新增 no-cursor session live-tail 分支，并保持显式 cursor replay 分支不变；live-tail 不得投影或回放历史 stream events。
- Web transport：SSE route 与 WebSocket upgrade 必须一致地区分 query 参数省略和显式 `0`。
- 前端：stream transport URL builder 需要只在有 cursor 时拼接 `lastSeenSequence`；stream hook 需要区分“当前页面还没有 cursor”和“cursor 数值为 0 的显式 replay”。
- UI 恢复：普通 terminal 后不应以 conversation snapshot 覆盖 live/process details；gap、timeout、手动刷新仍可使用 conversation refresh。
- 验证：需要覆盖无 cursor live-tail、显式 `0` replay、run-scoped replay、前端 URL 参数发送规则、activeRun bootstrap、opening conversation reconcile、submit accepted 后 stream 不可靠的 bounded recovery、connected live-tail 下 submit 不启动额外 bounded stream，以及长历史会话刷新不再 replay 历史 stream。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-stream-resume-replay/spec.md`：归档时合并 no-cursor、显式 cursor、activeRun bootstrap、同页面断线恢复和 submit/retry/edit bounded recovery 语义。
- `openspec/specs/ts-web-sse-ws-transports/spec.md`：归档时合并 SSE/WS 等价的 optional cursor query 和 live-tail/replay 边界。
- `openspec/specs/ts-minimal-agent-kernel/spec.md`：归档时修正 Web stream 最小路径不再默认使用 `lastSeenSequence=0`。
- `openspec/specs/ts-stream-history-consistency/spec.md`：归档时合并 conversation 与 live stream 的职责边界和普通 terminal 后不覆盖 live details 的规则。
- `openspec/specs/ts-core-contracts/spec.md`：归档时合并 session-facing optional `lastSeenSequence`、显式 replay anchor、no-cursor live-tail 和 filter 不重置 sequence 的核心契约语义。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/core-contracts.md`：归档时提炼 session-facing optional `lastSeenSequence`、显式 replay anchor 和 `requestId/runId` filter 的接口语义。
- `openspec/designs/architecture/runtime-boundaries.md`：归档时提炼 no-cursor live-tail、显式 replay anchor 和 activeRun bounded replay 的 runtime-owned 流程。
- `openspec/designs/architecture/web-stream-transports.md`：归档时提炼 SSE/WS 对 optional cursor 的一致解析与 delivery 边界。
- `openspec/designs/architecture/stream-projection.md`：归档时提炼 channel 不拥有 replay truth、不用 transport close 生成 terminal 的衔接规则。
- `openspec/designs/modules/agent-runtime.md`：归档时提炼 runtime 拥有 replay/live-tail 语义，channel 只传递 query 和投影 stream envelopes。
- `openspec/designs/modules/agent-channel-web.md`：归档时提炼 SSE/WS 对 optional cursor 的一致解析与 delivery 边界。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：归档时补充上述 specs 到 runtime/channel session 设计的导航。

验证入口：
- OpenSpec strict validation。
- Web stream transport contract tests：SSE/WS optional cursor 与显式 cursor 等价。
- Runtime stream tests：no-cursor session live-tail 不 replay 历史、显式 `0` 仍 replay、run-scoped `0` 仍 bounded replay。
- Frontend stream hook/transport tests：无 cursor 不拼接 `lastSeenSequence`，activeRun bootstrap 显式拼接 `0 + requestId/runId`，已有内存 cursor 后重连传 `N`。
- UI/session tests：长历史会话刷新不触发历史 stream replay；普通 terminal 不用 conversation snapshot 覆盖 live/process details。
